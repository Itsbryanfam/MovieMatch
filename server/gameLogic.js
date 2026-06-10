const redisUtils = require('./redisUtils');
const telemetry = require('./telemetry');
const statsSystem = require('./systems/statsSystem');
const soloObjectivesSystem = require('./systems/soloObjectivesSystem');
// Player hard-cap constant (single source of truth — see server/constants.js).
const { MAX_PLAYERS_PER_LOBBY } = require('./constants');
const logger = require('pino')();

// In-memory map for active turn timeouts.
// Stored in-process (not Redis) because setTimeout handles are not serializable.
const activeTurnTimeouts = new Map();

// T4b audit fix: in-memory map for active game-reset timers, one per lobby.
// Same in-process/not-serializable rationale as activeTurnTimeouts. WHY a map
// (the timers used to be anonymous and never cleared): game N's +25s reset
// could fire several seconds INTO game N+1's recap after a quick host restart,
// flipping the live finished-room back to 'waiting' under the next game's feet.
// Keyed by lobby id so scheduleGameReset can replace-on-schedule (clearing the
// prior timer), startGame can clear it when a new game begins, and the
// lobby-teardown path can clear it on deleteLobby.
const activeGameResetTimers = new Map();

// Post-game viewing window: how long a finished lobby stays 'finished'
// before scheduleGameReset flips it back to 'waiting' (which makes every
// client re-render the lobby and replaces the game-over banner). WHY 25s
// (was a bare 7000 literal — user feedback): the client Chain Premiere
// Recap storyboard runs up to ~12.55s, so a 7s reset pre-empted it AND
// left no time to open/look at the share card before the Share button
// (on the game-over banner) vanished. 25s comfortably covers the full
// recap PLUS opening + reading the share card, while still returning the
// room to the lobby on its own. A single-file named const (the
// RECONNECT_GRACE_MS pattern — server/constants.js is reserved for values
// duplicated across 2+ files); exported only so it is unit-testable.
const GAME_RESET_DELAY_MS = 25000;

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

// Clears the active turn timeout for a room if one is armed.
// Called before arming a new timeout, on game end, and on disconnect.
function clearTurnTimeout(id) {
  if (activeTurnTimeouts.has(id)) {
    clearTimeout(activeTurnTimeouts.get(id));
    activeTurnTimeouts.delete(id);
  }
}

// T4b audit fix: clear a lobby's pending game-reset timer if one is armed.
// Called by scheduleGameReset before arming a fresh one (replace-on-schedule),
// by startGame when a new game begins (so a prior game's reset can't fire into
// the new one), and by the lobby-teardown path on deleteLobby. Same shape as
// clearTurnTimeout — idempotent, safe to call when nothing is armed.
function clearGameResetTimeout(id) {
  if (activeGameResetTimers.has(id)) {
    clearTimeout(activeGameResetTimers.get(id));
    activeGameResetTimers.delete(id);
  }
}

// Audit finding #2: true iff this lobby currently has a server-side turn
// watchdog armed. Exported so the boot-recovery sweep (finding #6) and the
// disconnect/rejoin paths can reason about enforcement without reaching
// into the in-process map.
function hasActiveTurnTimeout(id) {
  return activeTurnTimeouts.has(id);
}

// Audit finding #2: the single place a turn watchdog is armed. Extracted
// verbatim from nextTurn so startGame and rejoin can reuse the identical
// lock-guarded behavior (no duplicated, drift-prone timeout logic).
//
// The watchdog eliminates the current player if the turn deadline passes
// with no submit/forceNextTurn. It takes the submit lock first so it can't
// double-eliminate or skip a turn racing submitMovie/forceNextTurn; if the
// lock is held a submit is in flight and will advance the turn naturally.
// The +4s over the client timer gives the client's forceNextTurn emit time
// to land first, so the server only acts when the client is truly silent.
function armTurnTimeout(io, pubClient, id, state) {
  // Never stack two watchdogs for one lobby — replacing means clearing.
  clearTurnTimeout(id);
  const turnTimeMs = state.turnTime || 45000;
  const timeoutId = setTimeout(async () => {
    // T1 audit fix T1a: lockToken is declared outside the try only so the
    // finally can see it — the acquire itself MUST run INSIDE the try.
    // node-redis v4 rejects every in-flight command when the socket drops,
    // so this first await is exactly where a Redis flap surfaces at
    // watchdog-fire time; with it outside the try, the rejection escaped the
    // async callback (setTimeout discards the returned promise, so nothing
    // can ever handle it) → unhandled rejection → process death → every
    // live game on the instance dropped over one connection blip.
    let lockToken = null;
    try {
      lockToken = await redisUtils.acquireSubmitLock(pubClient, id);
      if (!lockToken) {
        // Lock held → a submit/forceNextTurn is in flight and will advance
        // the turn itself. Bare return: the finally below performs the same
        // activeTurnTimeouts cleanup the pre-T1a early-return did inline.
        return;
      }
      const liveRoom = await redisUtils.getLobby(pubClient, id);
      // Re-check expiry on the FRESH state — another lock holder may have
      // already advanced the turn, in which case turnExpiresAt is now in
      // the future and we no-op.
      if (liveRoom && liveRoom.status === 'playing' &&
          liveRoom.turnExpiresAt && Date.now() > liveRoom.turnExpiresAt) {
        await eliminateCurrentPlayer(io, pubClient, id, liveRoom, "Turn timed out");
      }
    } catch (err) {
      logger.error(err, 'Timeout handler error');
    } finally {
      activeTurnTimeouts.delete(id);
      // T1a: token-guarded release — on the no-lock and acquire-threw paths
      // there is nothing to release, and releasing anyway would burn a second
      // Redis round-trip inside the very outage this restructure survives.
      if (lockToken) {
        await redisUtils.releaseSubmitLock(pubClient, id, lockToken).catch(() => {});
      }
    }
  }, turnTimeMs + 4000);

  activeTurnTimeouts.set(id, timeoutId);

  // Phase 5a: armTurnTimeout is the single point a turn becomes active
  // (nextTurn / startGame / rejoin / recovery sweeps all route here), so it
  // is the one DRY place to drive a bot's move when the turn lands on one.
  // Lazy require — gameLogic ⇄ botSystem ⇄ matchSystem would be a load-time
  // cycle; deferring the require to call time resolves it (identical pattern
  // and rationale to the lobbySystem lazy-require at the checkSoloWin hook
  // ~L528-533). Wrapped so a bot-scheduling fault can never break the
  // watchdog that was just armed above.
  try {
    require('./systems/botSystem').scheduleBotMove(io, pubClient, id, state);
  } catch (e) {
    logger.error(e, 'bot move scheduling hook failed');
  }
}

// SECURITY (audit finding #1): the single source of truth for the
// client-safe projection of a lobby. Extracted from broadcastState so the
// rejoin path can reuse the EXACT same shape — previously rejoinSuccess
// shipped the raw Redis room object, leaking every player's stableId (the
// bearer secret that authenticates a rejoin) and the raw spectator list /
// predictions map. Pure: it must not mutate `state` (the one-shot-flag
// clearing stays in broadcastState, because a rejoin snapshot must not
// consume another player's pending celebration).
function toClientState(state) {
  // L3: Roll the spectator-predictions map up into a tally. The raw map
  // keys are socket ids — exposing them would let an observer correlate
  // which spectator voted which way, which is needless surveillance. The
  // tally is the only thing the client UI needs, and it's a tiny derived value.
  const rawPreds = state.spectatorPredictions || {};
  let tallyYes = 0, tallyNo = 0;
  for (const v of Object.values(rawPreds)) {
    if (v === 'yes') tallyYes++;
    else if (v === 'no') tallyNo++;
  }
  return {
    ...state,
    // Strip stableId from every player — it's the rejoin bearer secret and
    // must never leave the server in any client-bound payload.
    players: state.players.map(({ stableId, ...rest }) => rest),
    // Never ship the raw spectator list (carries stableId + socket ids);
    // only the connected count is needed by the UI.
    spectators: undefined,
    spectatorCount: (state.spectators || []).filter(s => s.connected).length,
    // Strip the raw predictions map; ship just the tally.
    spectatorPredictions: undefined,
    predictionTally: { yes: tallyYes, no: tallyNo },
    chain: (state.chain || []).map(item => ({
      playerId: item.playerId,
      playerName: item.playerName,
      movie: item.movie,
      matchedActors: item.matchedActors || []
    })),
    winner: state.winner || null
  };
}

function broadcastState(io, id, state) {
  // Single client-safe projection — see toClientState for why this is the
  // only place a lobby is allowed to be serialized toward a client.
  const clientState = toClientState(state);
  io.to(id).emit('stateUpdate', clientState);
  // M5: One-shot solo flags are sent in this broadcast and then cleared
  // on the room so the NEXT broadcast (chat, reaction, etc.) doesn't
  // re-fire the same celebration. The client sees the flag exactly once,
  // animates it, and ignores subsequent state updates that don't carry it.
  // Intentionally NOT inside toClientState: a rejoin snapshot must not
  // consume the flag out from under the live broadcast.
  if (state.streakMilestone || state.objectiveJustHit) {
    state.streakMilestone = null;
    state.objectiveJustHit = false;
  }
}

// Records a win for a single player. Goes through redisUtils.recordPlayerWinAtomic
// so the per-player count, leaderboard ZSET, and name lookup are all written in
// one Redis transaction — they can't drift on partial failure the way the
// previous Promise.all pattern could.
async function recordPlayerWin(pubClient, player) {
  // stableId is the canonical identity; fall back to socket.id for older
  // states/tests that didn't carry a stableId.
  await redisUtils.recordPlayerWinAtomic(pubClient, player.stableId || player.id, player.name);
}

// ---------------------------------------------------------------------------
// ELIMINATION
// ---------------------------------------------------------------------------

// T2a (audit P1-3): eliminateCurrentPlayer is the shared elimination tail for
// every submit-lock holder (the turn watchdog, forceNextTurn, the bot whiff,
// quitGame's current-turn branch, the grace-expiry kill, and the submit
// pipeline's failure paths). It used to mutate the caller's SNAPSHOT and
// persist it via checkWinCondition/nextTurn — a full-blob save of state read
// up to ~1.2s earlier (the TMDB aftercare window), which silently REVERTED
// any withLobbyLock write committed in that window (a non-current quit
// resurrected, a spectator join dropped, an equipped title erased). Now:
//   1. the long-await aftercare runs FIRST, on the snapshot, OUTSIDE any
//      lock (chain state cannot change under the caller's submit lock);
//   2. the data commit (mark dead → win-check → turn advance) re-reads FRESH
//      state inside withLobbyLock and re-verifies the snapshot's
//      preconditions — still playing, the SAME player still holds the turn,
//      still alive, plus the caller's opts.extraVerify — declining with no
//      write when the world moved on;
//   3. timer side-effects (the next turn's watchdog) fire AFTER the lock,
//      only when the commit actually landed.
// The old standalone eliminateTeam was folded into the mutator's team branch
// so the team tail commits under the same lock (it had no other callers).
//
// opts.extraVerify(fresh, freshVictim): optional extra precondition checked
// inside the lock. The disconnect-grace path (T2c) passes "still
// disconnected" so a rejoin that lands between its submit-locked pre-check
// and this commit still cancels the kill.
async function eliminateCurrentPlayer(io, pubClient, id, state, reason, opts = {}) {
  // Victim identity is pinned from the caller's snapshot: the submit-lock
  // holder decided WHO dies; the lock below only re-verifies that decision
  // still holds on fresh state — it must never re-target a different player.
  const victim = state.players[state.currentTurnIndex];

  // Phase 7.1 (2) timeout aftercare, hoisted BEFORE the commit lock (T2a):
  // _computeCouldHavePlayed awaits TMDB for up to COULD_HAVE_PLAYED_TIMEOUT_MS
  // — exactly the long-await window the data lock must not span. Computed on
  // the snapshot (the chain can't change while the caller holds the submit
  // lock); the resulting payload is emitted inside the mutator only if the
  // elimination commits. Gating is unchanged: HUMAN (stableId truthy — bots
  // are null), still-connected, timeout-category reason. The team gate was
  // implicit pre-T2a (the team branch returned before this block) and is
  // explicit now that the branch lives inside the mutator.
  let aftercarePayload = null;
  if (victim && victim.stableId && victim.connected && state.gameMode !== 'team' &&
      _categorizeReason(reason) === 'timeout') {
    try {
      // Lazy require — cycle-safe. matchSystem→gameLogic is the existing
      // require edge; adding a top-level require here would create a cycle.
      const ms = require('./systems/matchSystem');
      const botSystem = require('./systems/botSystem');
      const last = (state.chain || [])[(state.chain || []).length - 1];
      if (last && last.movie) {
        // eliminateCurrentPlayer has no ctx TMDB headers (same situation as
        // the bot-turn hook). Reuse botSystem._tmdbHeaders() — the exact
        // env-derived builder the no-ctx bot path already uses.
        const outs = await ms._computeCouldHavePlayed(state, pubClient, botSystem._tmdbHeaders());
        aftercarePayload = {
          lastChainEntry: {
            title: last.movie.title,
            year: last.movie.year,
            cast: ms.topCastNames(last.movie.cast),
          },
          reason,
          timedOut: true,
          // Only include `outs` when the suggestion lookup returned results;
          // omit the key entirely when null so the client can distinguish
          // "no suggestions available" from an empty array.
          ...(outs && outs.length ? { outs } : {}),
        };
      }
    } catch (e) {
      // Aftercare is best-effort — never let it break the elimination path.
      logger.error(e, 'timeout aftercare failed');
    }
  }

  // T2a: the data commit — fresh re-read, re-verify, mutate — all inside the
  // per-lobby mutex so it composes with every other lobbymut writer. NOTE
  // (lock ordering, see redisUtils): this runs with the caller's submit lock
  // held — lobbymut-inside-submit is the legal order; the mutator itself
  // must never call anything that takes the submit lock.
  let advanced = false;  // a new turn started → arm watchdog post-lock
  let committed = false; // decline = no write, no emits, no side-effects
  const room = await redisUtils.withLobbyLock(pubClient, id, async (fresh) => {
    const freshVictim = fresh.players[fresh.currentTurnIndex];
    // Re-verify the snapshot's preconditions on FRESH state. Any mismatch
    // means another writer resolved this turn first (or the game ended):
    // eliminating anyway would kill the wrong player or double-advance.
    if (fresh.status !== 'playing' ||
        !victim || !freshVictim ||
        freshVictim.id !== victim.id ||
        !freshVictim.isAlive ||
        (opts.extraVerify && !opts.extraVerify(fresh, freshVictim))) {
      // Belt-and-braces carried over from the old code (which win-checked
      // even when the indexed player was missing or already dead): a
      // win-check on the fresh room heals an all-dead-but-still-playing
      // room. It no-ops on any healthy room and, when it does fire, it
      // persists + broadcasts internally itself.
      await checkWinCondition(io, pubClient, id, fresh);
      return false; // decline — nothing to persist beyond what win-check did
    }

    // L3: settle spectator predictions BEFORE the elimination notification
    // (same order as pre-T2a) — on FRESH state so the cleared map persists.
    _settlePredictions(io, id, fresh, /* outcome */ 'no');

    if (fresh.gameMode === 'team') {
      // Team branch (the old standalone eliminateTeam, folded in so the team
      // tail commits under this same lock). Emit-then-mark preserves the old
      // eliminateTeam ordering exactly.
      const teamId = freshVictim.teamId ?? 0;
      const teamLabel = teamId === 0 ? '🔴 Red' : '🔵 Blue';
      // Structured payload: `kind` lets the client dispatch effects (sounds,
      // shakes, vibration) without brittle substring matching on `msg`.
      io.to(id).emit('notification', { msg: `Team ${teamLabel} eliminated: ${reason}`, kind: 'elimination' });
      fresh.players.forEach(p => {
        if (p.teamId === teamId) p.isAlive = false;
      });
    } else {
      freshVictim.isAlive = false;
      io.to(id).emit('notification', { msg: `${freshVictim.name} eliminated: ${reason}`, kind: 'elimination' });
      // H6: Telemetry — `reason` is a free-form string so we bucket it into a
      // small set of stable categories. Fire-and-forget (never awaited), and
      // emitted inside the mutator so a DECLINED elimination is never counted.
      telemetry.track(pubClient, 'eliminated', {
        mode: fresh.gameMode,
        reasonCategory: _categorizeReason(reason),
        chainLength: (fresh.chain || []).length,
      });
      // The aftercare card rides INSIDE the commit so it (a) only fires when
      // the elimination actually lands and (b) keeps its historical position:
      // after the room-wide notification, before any win notification.
      if (aftercarePayload) {
        io.to(freshVictim.id).emit('youWereEliminated', aftercarePayload);
      }
    }

    // Win-check on FRESH state. When it fires it persists/broadcasts itself
    // (it remains a standalone entry point for the non-submit quit/grace
    // else-branches, so it keeps its own save — a harmless double-write of
    // the same object inside this lock); when the game continues, the
    // advance below mutates fresh and the lock's save persists everything.
    await checkWinCondition(io, pubClient, id, fresh);
    if (fresh.status === 'playing') {
      // Synchronous turn advance on the fresh room. Arming the watchdog is
      // an in-process timer side-effect and stays OUTSIDE the lock.
      advanced = _applyTurnAdvance(fresh);
    }
    committed = true;
  });

  // Side-effects AFTER the lock, only for a committed advance. The win paths
  // already broadcast + schedule their reset inside checkWinCondition; a
  // declined commit must produce no observable effect at all.
  if (committed && room && room.status === 'playing' && advanced) {
    armTurnTimeout(io, pubClient, id, room);
    broadcastState(io, id, room);
  }
}

// L3: Settle the spectator-prediction tally for the just-resolved turn.
// `outcome` is 'yes' (the player got it) or 'no' (they didn't). Emits a
// one-shot `predictionResult` to everyone in the room with per-vote
// accuracy + the totals so the client can show "X of Y called it."
// Clears the predictions map so the next turn starts fresh — without
// this, votes would carry across turns and pollute the next tally.
function _settlePredictions(io, id, state, outcome) {
  const preds = state.spectatorPredictions || {};
  const entries = Object.entries(preds);
  if (entries.length === 0) {
    // No spectator votes this turn — nothing to settle. Skip the broadcast
    // so we don't add chatter to a quiet room.
    return;
  }
  let correct = 0;
  // Each spectator's vote correctness — sent as a map keyed by socketId so
  // each spectator can look up THEIR own outcome client-side and ignore
  // everyone else's. The map is small (one entry per voting spectator)
  // and not sensitive (a spectator already knows their own vote).
  const perVoter = {};
  for (const [socketId, vote] of entries) {
    const isCorrect = vote === outcome;
    if (isCorrect) correct++;
    perVoter[socketId] = isCorrect;
  }
  io.to(id).emit('predictionResult', {
    outcome,
    correct,
    total: entries.length,
    perVoter,
  });
  // Clear so the next turn's tally starts at zero. The next state
  // broadcast naturally reflects predictionTally: { yes: 0, no: 0 }.
  state.spectatorPredictions = {};
}

// Bucket free-form elimination reasons into stable categories for telemetry.
// New reason strings drift over time (copy edits, i18n); the category set
// stays fixed so dashboards don't break.
function _categorizeReason(reason) {
  if (typeof reason !== 'string') return 'unknown';
  const r = reason.toLowerCase();
  if (r.includes('quit')) return 'quit';
  if (r.includes('disconnect')) return 'disconnect';
  if (r.includes('timed out') || r.includes("time's up")) return 'timeout';
  if (r.includes('too many invalid title')) return 'too_many_typos';
  if (r.includes('hardcore')) return 'hardcore_actor_reuse';
  if (r.includes('already used')) return 'movie_already_used';
  if (r.includes('api error') || r.includes('timeout')) return 'tmdb_error';
  if (r.includes('invalid movie connection')) return 'no_shared_cast';
  return 'other';
}

// ---------------------------------------------------------------------------
// TURN MANAGEMENT
// ---------------------------------------------------------------------------

// T2a: the synchronous core of a turn advance, extracted from nextTurn so the
// lobbymut commit paths (eliminateCurrentPlayer's mutator here, the submit
// pipeline's success commit in matchSystem) can apply it to the FRESH in-lock
// room. Pure mutation — no Redis, no timers, no emits — so it is always safe
// inside a withLobbyLock mutator. Returns false when no live player exists
// (callers skip arming a watchdog for a dead room).
function _applyTurnAdvance(state) {
  let iterations = 0;
  do {
    state.currentTurnIndex = (state.currentTurnIndex + 1) % state.players.length;
    iterations++;
  } while (!state.players[state.currentTurnIndex].isAlive && iterations < state.players.length);

  // Guard: all players ended up dead — checkWinCondition should have caught this,
  // but don't arm a new timer on a dead player if it somehow slips through.
  if (!state.players[state.currentTurnIndex].isAlive) return false;

  // H1: Reset the per-turn "title not found" retry budget. The counter is
  // scoped to a single player's turn — once the turn advances (whether via
  // a successful play or an elimination), the next player starts fresh.
  state.currentTurnRetries = 0;

  // T2a: a new turn always starts with a clean validation flag. This also
  // self-heals a flag stranded by a process crash mid-submit, which would
  // otherwise block every future submit via the pre-lock isValidating check.
  state.isValidating = false;

  resetTimer(state);
  return true;
}

// T2b (audit P1-3): nextTurn used to mutate the caller's snapshot and save
// the whole blob — under the submit lock only, so any lobbymut write that
// committed since the snapshot was read got silently reverted. The submit
// pipeline now advances the turn INSIDE its own commit mutator (matchSystem,
// via applyTurnAdvance), and this exported orchestrator commits the same way:
// fresh re-read under withLobbyLock, re-verify that the chain/turn position
// is unchanged since the caller's snapshot, advance on the fresh room, then
// arm/broadcast after the lock. A caller whose snapshot went stale gets a
// clean decline instead of a clobbering save.
async function nextTurn(io, pubClient, id, state) {
  // Snapshot expectations for the in-lock re-verify: if either moved, some
  // other writer already resolved this turn and advancing again would skip
  // a player.
  const expectedTurnIndex = state.currentTurnIndex;
  const expectedChainLen = (state.chain || []).length;

  let advanced = false; // side-channel: withLobbyLock returns the room even on decline
  const room = await redisUtils.withLobbyLock(pubClient, id, async (fresh) => {
    // Authoritative win re-check on FRESH state (the old code checked the
    // snapshot). When it fires it persists/broadcasts internally; declining
    // the lock save afterwards is correct — there is nothing further to write.
    await checkWinCondition(io, pubClient, id, fresh);
    if (fresh.status !== 'playing') return false;
    if (fresh.currentTurnIndex !== expectedTurnIndex) return false;
    if ((fresh.chain || []).length !== expectedChainLen) return false;
    // T2a helper: index advance + retry/flag/timer resets, applied to fresh.
    if (!_applyTurnAdvance(fresh)) return false;
    advanced = true;
  });

  if (advanced && room) {
    // Audit finding #2: arm the server watchdog through the shared helper so
    // startGame (first turn) and rejoin (current player returning within
    // grace) get the exact same enforcement nextTurn does. armTurnTimeout
    // self-clears any previous handle, which is why the old explicit
    // clearTurnTimeout call is gone. Post-lock per the R1 pattern (io/timer
    // side-effects never extend the mutex section).
    armTurnTimeout(io, pubClient, id, room);
    broadcastState(io, id, room);
  }
}

// Audit finding #6: turn watchdogs (and reconnect-grace timers) live in an
// in-process Map — game STATE is in Redis and survives a restart, but the
// timers don't. After a deploy/crash/scale event an in-flight game would
// sit in Redis with an expired turnExpiresAt and no process scheduled to
// act on it (a soft-lock, same family as finding #2).
//
// This boot sweep re-arms a server watchdog for every still-playing lobby.
// armTurnTimeout's watchdog re-reads fresh state and only eliminates if the
// deadline has actually passed, so:
//   - a turn that expired during the downtime resolves within one watchdog
//     cycle instead of hanging forever,
//   - a turn still within its timer keeps ticking normally.
// Best-effort and idempotent — safe to call once at boot; a Redis hiccup
// here must never prevent the server from starting.
async function recoverActiveTurns(io, pubClient) {
  let rearmed = 0;
  try {
    const lobbies = await redisUtils.getAllLobbies(pubClient);
    for (const room of lobbies) {
      if (!room || room.status !== 'playing') continue;
      armTurnTimeout(io, pubClient, room.id, room);
      rearmed++;
    }
  } catch (err) {
    logger.error(err, 'recoverActiveTurns sweep failed');
  }
  return rearmed;
}

// Phase 2 R2: steady-state companion to recoverActiveTurns. Watchdogs are
// in-process; recoverActiveTurns only re-arms at boot, so a mid-game
// crash/deploy/scale event on another instance can leave a playing lobby in
// Redis with an expired turn and no process watching it. This sweep (run on
// an interval, on every instance) arms a watchdog for any playing lobby THIS
// instance is not already watching. It MUST gate on !hasActiveTurnTimeout:
// re-arming a healthy in-flight timer every tick would clear+reset it
// forever and turns would never expire. Safe across instances because
// armTurnTimeout is idempotent + submit-lock-guarded + re-reads fresh state
// — only one instance's watchdog ever actually eliminates. Best-effort: a
// Redis hiccup must never throw out of the interval callback.
async function sweepMissingTurnWatchdogs(io, pubClient) {
  let armed = 0;
  try {
    const lobbies = await redisUtils.getAllLobbies(pubClient);
    for (const room of lobbies) {
      if (!room || room.status !== 'playing') continue;
      if (hasActiveTurnTimeout(room.id)) continue; // already watched here
      armTurnTimeout(io, pubClient, room.id, room);
      armed++;
    }
  } catch (err) {
    logger.error(err, 'sweepMissingTurnWatchdogs failed');
  }
  return armed;
}

function promoteSpectators(state) {
  if (!state.spectators || state.spectators.length === 0) return;
  // Disconnected spectators don't get promoted — they wouldn't be there to play.
  const connected = state.spectators.filter(s => s.connected);
  // Same hard cap enforced in lobbySystem.joinLobby — now a shared
  // constant so the two can no longer silently disagree.
  const slotsAvailable = MAX_PLAYERS_PER_LOBBY - state.players.length;
  const promoted = connected.slice(0, slotsAvailable);

  promoted.forEach(s => {
    // Recompute team sizes inside the loop — the previous iteration may have
    // just added to one team, so each promotion looks at the current state,
    // not a snapshot from before the loop. The old `state.players.length % 2`
    // pattern ignored team imbalance entirely (e.g. on restart after a 4-vs-1
    // game it would land new players on team 0 first, worsening the gap).
    const t0 = state.players.filter(p => p.teamId === 0).length;
    const t1 = state.players.filter(p => p.teamId === 1).length;
    state.players.push({
      id: s.id, name: s.name, isHost: false, isAlive: true,
      connected: true, score: 0, wins: s.wins || 0,
      // Assign to the smaller team. Ties go to team 0 (consistent with the
      // initial join order in joinLobby, which also favors team 0 first).
      teamId: t0 <= t1 ? 0 : 1,
      stableId: s.stableId
    });
  });

  // Anything beyond slotsAvailable stays in spectators — they'll get a shot next round.
  state.spectators = connected.slice(slotsAvailable);
}

// finishedAt is the per-finish generation token stamped by the win handlers.
// The reset timer captures it and re-verifies it inside the lock so a stale
// timer cannot reset a NEWER finished game (T4b).
function scheduleGameReset(io, pubClient, id, finishedAt) {
  // T4b audit fix: track the timer in activeGameResetTimers and clear any
  // prior one first (replace-on-schedule). Pre-fix the timers were anonymous
  // and never cleared, so a quick host-restart could let game N's reset fire
  // into game N+1's recap. Now at most one reset timer exists per lobby and it
  // is cancellable on game start / lobby teardown.
  clearGameResetTimeout(id);
  // .unref() so this best-effort cleanup timer never by itself keeps a Node
  // process (or a Jest worker) alive past test teardown. The timer still fires
  // for the entire lifetime of a running server — .unref() only stops it from
  // pinning a process that would otherwise exit. A missed reset on abrupt
  // shutdown is harmless; the lobby status is re-checked inside the callback.
  const timeoutId = setTimeout(async () => {
    // The timer fired — drop our map entry so a later clear is a no-op and the
    // map doesn't leak handles for lobbies that already reset.
    activeGameResetTimers.delete(id);
    try {
      // T4b: the finished→waiting read-modify-write previously ran UNLOCKED
      // (getLobby → mutate → saveLobby), so a concurrent lobbymut write landing
      // in that window (a late join, a settings change, the next game starting)
      // was silently clobbered by this full-blob save. Run the whole RMW inside
      // withLobbyLock on a FRESH in-lock re-read; the mutator returns false to
      // DECLINE (no save, no broadcast) when the room is no longer the same
      // finished game, mirroring the T2 commit discipline. broadcast happens
      // OUTSIDE the lock on the room the helper returns (the R1 pattern).
      let didReset = false;
      const room = await redisUtils.withLobbyLock(pubClient, id, (liveState) => {
        // Re-verify on the lobbymut-fresh room: still finished, AND the SAME
        // finished game we scheduled for. A different finishedAt means game N+1
        // started and finished in the reset window — resetting it here would
        // clobber the newer game's recap. status !== 'finished' means a restart
        // or new start already moved on. Either way: decline.
        if (!liveState || liveState.status !== 'finished') return false;
        if (finishedAt != null && liveState.finishedAt !== finishedAt) return false;
        // M4: capture the just-finished chain length so the public lobby
        // browser can advertise it on the next listing. Done BEFORE the
        // reset so we don't accidentally read 0 from the freshly-cleared
        // chain. Persists across the reset (it's metadata, not game state).
        liveState.lastChainLength = (liveState.chain || []).length;
        liveState.status = 'waiting';
        liveState.finishedAt = null; // generation consumed — clear the token
        liveState.players = liveState.players.filter(p => p.connected);
        promoteSpectators(liveState);
        if (liveState.players.length > 0 && !liveState.players.some(p => p.isHost)) {
          liveState.players[0].isHost = true;
        }
        didReset = true;
      });
      if (didReset && room) broadcastState(io, id, room);
    } catch (err) {
      logger.error(err, 'Game reset error');
    }
  }, GAME_RESET_DELAY_MS);
  timeoutId.unref();
  activeGameResetTimers.set(id, timeoutId);
}

function resetTimer(state) {
  if (state.gameMode === 'speed') {
    // Speed mode: flat 15s every turn, no reduction logic.
    state.turnDurationMs = 15000;
  } else if (state.gameMode === 'daily') {
    // H2: Daily Challenge is async-style casual play. A flat 60s timer
    // gives the player time to think without the shrinking-pressure
    // mechanic that would punish anyone who hesitates. The timer still
    // exists (so a tab-out doesn't leave the daily run hanging forever)
    // but the cadence is intentionally relaxed.
    state.turnDurationMs = 60000;
  } else {
    // Classic/team/solo: every 2 successful turns the time limit shrinks by
    // 5 seconds, floored at 10s. timerMultiplier increments each turn.
    const reduction = Math.floor(state.timerMultiplier / 2) * 5;
    state.turnDurationMs = Math.max(10, 60 - reduction) * 1000;
  }
  // Persist BOTH fields so the client can render the timer bar correctly:
  // turnDurationMs is the bar's denominator, turnExpiresAt drives the countdown.
  // Without turnDurationMs, the client would have to assume 60s — which is
  // wrong in speed mode and after hardcore-shrink in classic.
  state.turnExpiresAt = Date.now() + state.turnDurationMs;
}

// ---------------------------------------------------------------------------
// WIN CONDITION CHECKS (one per game mode)
// ---------------------------------------------------------------------------

async function checkTeamWin(io, pubClient, id, state) {
  const teamAlive = [false, false];
  state.players.forEach(p => {
    if (p.isAlive && p.teamId !== undefined) teamAlive[p.teamId] = true;
  });
  if (teamAlive.filter(Boolean).length > 1) return; // both teams still alive

  clearTurnTimeout(id);
  state.status = 'finished';
  state.turnExpiresAt = null;
  // T4b audit fix: stamp a per-finish generation token. scheduleGameReset
  // captures this value and re-verifies it inside the lock so a stale reset
  // timer from a PRIOR finished game can't flip a NEWER finished game back to
  // 'waiting'. Date.now() is monotonic-enough here (two finishes a millisecond
  // apart still differ across a host-restart-then-replay).
  state.finishedAt = Date.now();

  const winningTeamId = teamAlive[0] ? 0 : 1;
  const winningPlayers = state.players.filter(p => p.teamId === winningTeamId);
  await Promise.all(winningPlayers.map(p => {
    p.wins = (p.wins || 0) + 1;
    return recordPlayerWin(pubClient, p);
  }));

  const teamLabel = winningTeamId === 0 ? '🔴 Red' : '🔵 Blue';
  state.winner = {
    name: `Team ${teamLabel}`,
    teamId: winningTeamId,
    players: winningPlayers.map(p => p.name),
    score: winningPlayers.reduce((sum, p) => sum + p.score, 0),
    isTeamWin: true
  };
  io.to(id).emit('notification', { msg: `Team ${teamLabel} wins!`, kind: 'win' });
  // H6: Telemetry — fired exactly once per game-end. teamSize covers
  // imbalanced 1v2 / 2v1 setups that could happen on disconnects.
  telemetry.track(pubClient, 'game_won', {
    mode: state.gameMode,
    chainLength: (state.chain || []).length,
    isTeamWin: true,
    teamSize: winningPlayers.length,
  });
  // H5: Per-player win bump for each winning teammate. Same fire-and-
  // forget pattern as recordGamePlayed — statsSystem swallows errors.
  Promise.all(
    winningPlayers
      .filter(p => p.stableId)
      .map(p => statsSystem.recordGameWon(pubClient, p.stableId, 'team', (state.chain || []).length))
  ).catch(() => {});
  await redisUtils.saveLobby(pubClient, id, state);
  broadcastState(io, id, state);
  scheduleGameReset(io, pubClient, id, state.finishedAt);
}

async function checkSoloWin(io, pubClient, id, state) {
  const alive = state.players.filter(p => p.isAlive);
  if (alive.length > 0) return; // player still alive

  clearTurnTimeout(id);
  state.status = 'finished';
  state.turnExpiresAt = null;
  // T4b: per-finish generation token (see checkTeamWin) — guards the reset
  // timer against firing on a newer game that also finished.
  state.finishedAt = Date.now();

  const solo = state.players[0];
  const isDaily = state.gameMode === 'daily';

  // H2: Daily runs do NOT increment the global wins counter or feed the
  // global leaderboard — they're a separate scoring track tracked by
  // dailySystem (per-day attempt records + per-day leaderboard). Mixing
  // the two would let a daily streak inflate the all-time leaderboard
  // and dilute the original "win an MP game" meaning of a global win.
  if (solo && !isDaily) {
    solo.wins = (solo.wins || 0) + 1;
    await recordPlayerWin(pubClient, solo);
  }

  // H2: For daily mode, the displayed "chain length" excludes the seed
  // (the seed was supplied, not earned), so the winner.chainLength shown
  // on the result card matches what the daily leaderboard records.
  const earnedLength = isDaily
    ? Math.max(0, state.chain.length - 1)
    : state.chain.length;

  // M5: Solo runs get bonus points from streak milestones and objective
  // hits — see commitPlay. Daily skips bonuses (those would skew the
  // daily leaderboard which scores by chain length, not points).
  const bonusPoints = (!isDaily && state.gameMode === 'solo') ? (state.bonusPoints | 0) : 0;
  const finalScore = earnedLength + bonusPoints;

  state.winner = {
    name: solo ? solo.name : 'Solo Player',
    chainLength: earnedLength,
    bonusPoints,
    isSolo: true,
    isDaily,
    puzzleNumber: state.dailyPuzzleNumber || null,
    date: state.dailyDate || null,
    score: finalScore,
    objectiveHit: !!state.objectiveHit,
  };

  // H2: Persist the daily attempt as 'done' and update the per-day
  // leaderboard ZSET. Done before saveLobby/broadcastState so the client's
  // very next request for daily state sees the finalized record.
  if (isDaily) {
    // Lazy-require to avoid an import cycle: lobbySystem requires gameLogic
    // (for nextTurn), and gameLogic now needs to call back into lobbySystem
    // for the daily-finalize hook. Top-level require here would create a
    // circular dependency that resolves to {} on Node's first eval pass.
    const lobbySystem = require('./systems/lobbySystem');
    await lobbySystem.finalizeDailyOnGameEnd(pubClient, state);
  }

  // H6: Telemetry — solo "wins" are really survival completions; the
  // chainLength field is the player's score and the most useful number to
  // aggregate (avg/p50/p95 chain length tells us if Solo is too easy/hard).
  telemetry.track(pubClient, 'game_won', {
    mode: isDaily ? 'daily' : 'solo',
    chainLength: earnedLength,
    isSolo: true,
    isDaily,
  });
  // H5: Per-player stats bump. Daily and solo both count toward
  // gamesPlayed (already incremented at startGame) but only solo counts
  // toward `wins` — daily uses its own scoring track per the H2 design
  // decision in checkSoloWin above (see the `!isDaily` guard). For both,
  // longestChain reflects the run's chain length.
  if (solo && solo.stableId) {
    statsSystem.recordGameWon(
      pubClient,
      solo.stableId,
      isDaily ? 'daily' : 'solo',
      earnedLength
    ).catch(() => {});
  }
  await redisUtils.saveLobby(pubClient, id, state);
  broadcastState(io, id, state);
  scheduleGameReset(io, pubClient, id, state.finishedAt);
}

async function checkClassicWin(io, pubClient, id, state) {
  const alivePlayers = state.players.filter(p => p.isAlive);

  if (alivePlayers.length === 1 && state.players.length > 1) {
    clearTurnTimeout(id);
    state.status = 'finished';
    state.turnExpiresAt = null;
    // T4b: per-finish generation token (see checkTeamWin).
    state.finishedAt = Date.now();

    const winner = alivePlayers[0];
    winner.wins = (winner.wins || 0) + 1;
    await recordPlayerWin(pubClient, winner);
    state.winner = { name: winner.name, score: winner.score, id: winner.id };
    io.to(id).emit('notification', { msg: `${winner.name} wins!`, kind: 'win' });
    // H6: Telemetry — classic & speed share this code path; carry through
    // the actual mode so dashboards can distinguish them.
    telemetry.track(pubClient, 'game_won', {
      mode: state.gameMode || 'classic',
      chainLength: (state.chain || []).length,
      playerCount: state.players.length,
      finalScore: winner.score,
    });
    // H5: Per-player stats bump for the winner.
    if (winner.stableId) {
      statsSystem.recordGameWon(
        pubClient,
        winner.stableId,
        state.gameMode || 'classic',
        (state.chain || []).length
      ).catch(() => {});
    }
    await redisUtils.saveLobby(pubClient, id, state);
    broadcastState(io, id, state);
    scheduleGameReset(io, pubClient, id, state.finishedAt);

  } else if (alivePlayers.length === 0) {
    // All players eliminated simultaneously (e.g. both disconnect at once).
    // No winner; game ends without awarding points.
    clearTurnTimeout(id);
    state.status = 'finished';
    state.turnExpiresAt = null;
    // T4b: per-finish generation token (see checkTeamWin).
    state.finishedAt = Date.now();
    await redisUtils.saveLobby(pubClient, id, state);
    broadcastState(io, id, state);
    scheduleGameReset(io, pubClient, id, state.finishedAt);
  }
}

async function checkWinCondition(io, pubClient, id, state) {
  if (state.gameMode === 'team')    return checkTeamWin(io, pubClient, id, state);
  // H2: daily routes through the solo win path — both are single-player
  // "did the player still survive?" checks. The solo handler special-
  // cases gameMode === 'daily' to skip the global wins increment and to
  // call into dailySystem.finalizeDailyAttempt.
  if (state.gameMode === 'solo' || state.gameMode === 'daily') return checkSoloWin(io, pubClient, id, state);
  /* classic / speed */             return checkClassicWin(io, pubClient, id, state);
}

// ---------------------------------------------------------------------------
// GAME START
// ---------------------------------------------------------------------------

// T2c-ii (audit P1-3): startGame used to mutate the caller's snapshot and
// save it holding NOTHING — so a host double-click ran the whole setup
// twice (duplicate game_started telemetry + duplicate recordGamePlayed per
// player), and the save could clobber any lobbymut write landing in the
// window. The gate + mutation now commit inside withLobbyLock on a FRESH
// re-read; the solo personal-best lookup (the one long await) is hoisted
// BEFORE the lock; telemetry/recordGamePlayed/armTurnTimeout/broadcast fire
// only when the commit landed.
// opts.verifyFresh(fresh): optional caller gate re-checked on the in-lock
// room — startLobby re-verifies the clicking socket still holds the host seat.
async function startGame(io, pubClient, id, state, opts = {}) {
  const mode = state.gameMode || 'classic';

  // Player-count gates on the snapshot: kept here (not only in the mutator)
  // so the clicking host gets their immediate error toast, exactly as
  // before. The mutator below re-validates on the fresh roster and declines
  // silently if it changed in the window — same outcome as losing the race.
  if (mode === 'solo') {
    if (state.players.length < 1) {
      io.to(id).emit('error', 'Need at least 1 player!');
      return;
    }
  } else if (mode === 'team') {
    const team0 = state.players.filter(p => p.teamId === 0);
    const team1 = state.players.filter(p => p.teamId === 1);
    if (team0.length === 0 || team1.length === 0) {
      io.to(id).emit('error', 'Each team needs at least 1 player!');
      return;
    }
    // (The team sort MUTATES turn order, so it moved into the mutator —
    // it must apply to the fresh room, not this snapshot.)
  } else {
    if (state.players.length < 2) {
      io.to(id).emit('error', 'Need at least 2 players!');
      return;
    }
  }

  // T2c-ii: hoist the one long await — the solo personal-best lookup —
  // BEFORE the commit lock (the T2 design: long-await work first, on the
  // snapshot; results applied inside). Best-effort — getStats swallows its
  // own errors, so a Redis blip can't crash the game-start path.
  let personalBestChain = 0;
  if (mode === 'solo') {
    const solo = state.players[0];
    if (solo && solo.stableId) {
      try {
        const stats = await statsSystem.getStats(pubClient, solo.stableId);
        personalBestChain = (stats && stats.byMode && stats.byMode.solo)
          ? (stats.byMode.solo.longestChain | 0)
          : 0;
      } catch {
        personalBestChain = 0;
      }
    }
  }

  // T2c-ii: gate + mutation under the per-lobby mutex, on fresh state.
  let committed = false; // side-channel: withLobbyLock returns the room even on decline
  const room = await redisUtils.withLobbyLock(pubClient, id, (fresh) => {
    // THE double-fire gate: only a 'waiting' room can start. The race
    // loser's fresh read sees 'playing' here and declines — no duplicate
    // telemetry, no duplicate stats, no second setup pass over a live game.
    if (fresh.status !== 'waiting') return false;
    // Caller-supplied fresh gate (startLobby: "clicker is still the host").
    if (opts.verifyFresh && !opts.verifyFresh(fresh)) return false;

    // Re-validate the count gates against the FRESH roster and mode — a
    // join/leave/setGameMode may have landed since the snapshot was read.
    const freshMode = fresh.gameMode || 'classic';
    if (freshMode === 'solo') {
      if (fresh.players.length < 1) return false;
    } else if (freshMode === 'team') {
      if (fresh.players.filter(p => p.teamId === 0).length === 0 ||
          fresh.players.filter(p => p.teamId === 1).length === 0) return false;
      // Sort so all team-0 players come first in the turn order.
      fresh.players.sort((a, b) => (a.teamId ?? 0) - (b.teamId ?? 0));
    } else {
      if (fresh.players.length < 2) return false;
    }

    fresh.status = 'playing';
    fresh.chain = [];
    fresh.usedMovies = [];
    fresh.timerMultiplier = 0;
    fresh.previousSharedActors = [];
    // H1: Initialize the per-turn typo-retry counter. Without this, an old
    // state object loaded from before this field existed would carry whatever
    // stale value its serialized form had, biasing the very first turn.
    fresh.currentTurnRetries = 0;
    fresh.players.forEach(p => { p.isAlive = true; p.score = 0; });

    // M5: Solo-mode-only enrichment — pick an objective for the run and
    // attach the hoisted personal-best chain length so the UI can show it
    // ("Beat your best of 12!"). Other modes don't get either field, which
    // the client checks for before rendering. Daily skips this on purpose:
    // it has its own implicit objective (the daily seed) and its own
    // scoring track via dailySystem.
    if (freshMode === 'solo') {
      const obj = soloObjectivesSystem.pickObjective();
      fresh.objective = soloObjectivesSystem.clientShape(obj);
      fresh.objectiveHit = false;
      fresh.bonusPoints = 0;
      fresh.currentStreak = 0;
      // Hoisted pre-lock. If the mode flipped TO solo inside the gate window
      // (snapshot wasn't solo, so nothing was hoisted) degrade to 0 — the
      // same value a stats miss produces.
      fresh.personalBestChain = (mode === 'solo') ? personalBestChain : 0;
    } else {
      // Defensive: clear the solo-only fields when starting a non-solo
      // game (host could reuse the same lobby across modes via restart).
      fresh.objective = null;
      fresh.objectiveHit = false;
      fresh.bonusPoints = 0;
      fresh.currentStreak = 0;
      fresh.personalBestChain = 0;
    }

    // Classic and speed start at a random index; team and solo always start at 0
    fresh.currentTurnIndex = 0;
    if (freshMode === 'classic' || freshMode === 'speed') {
      fresh.currentTurnIndex = Math.floor(Math.random() * fresh.players.length);
    }
    fresh.isValidating = false;
    // T4b: a new game starts — clear any stale finish-generation token so the
    // public-lobby / recovery code never mistakes this live game for a
    // finished one. (The prior game's reset timer, if any, is cleared below
    // post-commit; this also makes its in-lock finishedAt re-verify decline.)
    fresh.finishedAt = null;

    resetTimer(fresh);
    committed = true;
  });
  if (!committed || !room) return;

  // T4b: a new game is starting on this lobby — cancel any pending game-reset
  // timer left over from the PREVIOUS finished game so it can't fire mid-game
  // and flip this live room back to 'waiting'. Post-commit per the R1 pattern
  // (in-process timer work stays outside the mutex). The finishedAt re-verify
  // in scheduleGameReset's callback is the belt; this clear is the suspenders.
  clearGameResetTimeout(id);

  // Side-effects ONLY for the call that actually started the game (T2c-ii).
  // H6: Telemetry — fired exactly once per game, at the start. Captures the
  // mode mix and player count distribution so we can answer "what modes do
  // people actually play?" and "what's the typical lobby size?" without
  // having to instrument every call site.
  telemetry.track(pubClient, 'game_started', {
    mode: room.gameMode || 'classic',
    playerCount: room.players.length,
    hardcoreMode: !!room.hardcoreMode,
    allowTvShows: !!room.allowTvShows,
  });

  // H5: Per-player gamesPlayed bump. Fire-and-forget — wrapped in
  // Promise.all so they overlap with each other but the broadcast below
  // still happens promptly. statsSystem swallows its own errors so a
  // failed write here can't crash the game-start path.
  Promise.all(
    room.players
      .filter(p => p.stableId)
      .map(p => statsSystem.recordGamePlayed(pubClient, p.stableId, room.gameMode || 'classic'))
  ).catch(() => {});

  // Audit finding #2: arm the server watchdog for the FIRST turn. Without
  // this the opening turn had no server enforcement — the active client
  // could stall the entire table indefinitely by never sending
  // forceNextTurn. Post-lock per the R1 pattern (timer side-effects never
  // extend the mutex section); the lock's save already persisted the room.
  armTurnTimeout(io, pubClient, id, room);

  broadcastState(io, id, room);
}

// ---------------------------------------------------------------------------
// CHAIN VALIDATION (pure — no I/O, exported for testing)
// ---------------------------------------------------------------------------

// H4: Each cast entry can be either a legacy bare string ("Tom Hanks") or
// a current {id, name} object. Normalize both shapes into {id, name} so the
// comparison logic below can prefer id-equality (correct across name
// collisions and punctuation drift) and fall back to case-insensitive name
// match only when one side is missing an id.
//
// Why support both shapes: in-flight rooms loaded from Redis at deploy time
// may still have legacy string casts on chain entries, while a fresh
// candidate fetched after deploy carries object casts. Without normalization
// the very next play in such a room would crash on `.id` access.
function _normalizeActor(a) {
  return typeof a === 'string' ? { id: null, name: a } : a;
}

// True iff a and b refer to the same person. Prefer id-equality (precise);
// fall back to lowercase name match only when at least one side has no id.
function _sameActor(a, b) {
  if (a.id != null && b.id != null) return a.id === b.id;
  if (!a.name || !b.name) return false;
  return a.name.toLowerCase() === b.name.toLowerCase();
}

function validateConnection(lastNodeCast, candidateCast, hardcoreMode, previousSharedActors) {
  const last = (lastNodeCast || []).map(_normalizeActor);
  const cand = (candidateCast || []).map(_normalizeActor);
  const prev = (previousSharedActors || []).map(_normalizeActor);

  const sharedActors = cand.filter(a => last.some(l => _sameActor(l, a)));

  if (sharedActors.length === 0) {
    return { valid: false, reason: "Invalid movie connection." };
  }

  if (hardcoreMode && prev.length > 0) {
    // M1: Hardcore mode is CUMULATIVE — `previousSharedActors` carries every
    // connector used in this chain so far (commitPlay maintains this), so
    // the filter below excludes anyone who has ever connected. Pre-M1 the
    // exclusion was just last turn's connector, which let players ping-pong
    // the same pair of actors and made "Hardcore" a misnomer.
    const newSharedActors = sharedActors.filter(a => !prev.some(p => _sameActor(p, a)));
    if (newSharedActors.length === 0) {
      return { valid: false, reason: "Hardcore Mode: That actor has already connected somewhere in this chain — pick a different one." };
    }
    // Return BOTH shapes so callers don't have to choose:
    //   matchedActors        — bare name strings, what the client renders
    //                          (chain.matchedActors[0] feeds the share-card
    //                          text and the connection label in the chain UI).
    //   matchedActorObjects  — {id, name} entries, what the server stores in
    //                          room.previousSharedActors so the NEXT turn's
    //                          hardcore check can compare by id (precise across
    //                          name collisions and punctuation drift).
    return {
      valid: true,
      matchedActors: newSharedActors.map(a => a.name),
      matchedActorObjects: newSharedActors,
    };
  }

  return {
    valid: true,
    matchedActors: sharedActors.map(a => a.name),
    matchedActorObjects: sharedActors,
  };
}

module.exports = {
  broadcastState,
  // Exported so the rejoin path emits the identical client-safe shape
  // (audit finding #1 — no stableId / raw-spectator leak).
  toClientState,
  // T2a: eliminateTeam is no longer exported — its body was folded into
  // eliminateCurrentPlayer's lobbymut mutator (it had no callers outside
  // this file, and keeping a raw mutate+save path exported would invite a
  // future caller to bypass the commit discipline).
  eliminateCurrentPlayer,
  nextTurn,
  // T2a: the synchronous turn-advance core, exported so matchSystem's submit
  // commit can apply it to the fresh in-lock room (T2b) without nesting a
  // second withLobbyLock inside its mutator.
  applyTurnAdvance: _applyTurnAdvance,
  resetTimer,
  checkWinCondition,
  startGame,
  validateConnection,
  clearTurnTimeout,
  // T4b audit fix: cancel a lobby's pending game-reset timer. Exported so the
  // lobby-teardown path (lobbySystem.handleDisconnect) can clear it alongside
  // clearTurnTimeout/clearBotTimeout before deleteLobby, and so tests can
  // assert the replace-on-schedule / clear-on-start behavior.
  clearGameResetTimeout,
  // Audit finding #2: shared watchdog arming + introspection, reused by
  // startGame, nextTurn, rejoin, and the boot-recovery sweep (#6).
  armTurnTimeout,
  hasActiveTurnTimeout,
  // Audit finding #6: boot-time re-arm of watchdogs for in-flight games
  // (in-process timers don't survive a restart; Redis state does).
  recoverActiveTurns,
  // Phase 2 R2: steady-state periodic re-arm of watchdogs this instance
  // isn't already tracking (multi-instance / mid-game-restart soft-lock).
  sweepMissingTurnWatchdogs,
  promoteSpectators,
  // L3: Exposed for matchSystem.commitPlay's success path. Internal
  // detail otherwise — kept underscore-prefixed in the implementation
  // to flag "module-internal helper" while the public name is the
  // unprefixed alias for cross-module callers.
  settlePredictions: _settlePredictions,
  // Exported solely so game-reset-delay.test.js can pin the post-game
  // viewing window against the recap budget (scheduleGameReset itself is
  // an internal .unref()'d timer and intentionally not exported).
  GAME_RESET_DELAY_MS,
};
