// ============================================================================
// MATCH SYSTEM — TMDB search, movie validation, and chain building
// ============================================================================
// Pure system functions. No socket event binding, no rate limiting.
// Each function receives a context object { io, pubClient, TMDB_HEADERS, logger }
// and operates on game data through redisUtils.
// ============================================================================

const redisUtils = require('../redisUtils');
const gameLogic = require('../gameLogic');
const telemetry = require('../telemetry');
const statsSystem = require('./statsSystem');
const soloObjectivesSystem = require('./soloObjectivesSystem');
const themesSystem = require('./themesSystem');
// Phase 5b: local fallback movie DB (leaf module — fs/path only, no cycle).
const fallbackMovies = require('./fallbackMovies');
// T4c audit fix: shared 5s TMDB fetch ceiling (was a local duplicate const
// below). constants.js is a leaf module — no require cycle.
const { TMDB_FETCH_TIMEOUT_MS } = require('../constants');

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w92';
// T4c: TMDB_FETCH_TIMEOUT_MS now imported from ../constants (see import above).

// Phase 6a — Post-Game Learning Breakdown.
// Upper bound on the best-effort "a move you could have played" computation.
// On a TMDB cache HIT (the common case — same person-filmography/details the
// Phase 5a bot cache holds) this completes in tens of ms; the bound only
// trips on a cache MISS, where we omit the suggestion rather than stall the
// elimination. Fail-closed: the H3 card already renders fine without it.
const COULD_HAVE_PLAYED_TIMEOUT_MS = 1200;
// A non-difficulty "always finds a move" profile for the SUGGESTION use of
// generateBotMove. whiff:0 ⇒ `rng() < 0` is never true ⇒ it never blanks.
// Plain literal consumed read-only by generateBotMove — no botSystem change.
// popularityFloor:4 is the lowest (most permissive) floor — maximizes the
// chance a suggestion exists whenever any valid move does.
// retryCap:3 bounds per-actor TMDB attempts so a cache miss still resolves
// within COULD_HAVE_PLAYED_TIMEOUT_MS.
const SUGGESTION_BOT_PROFILE = { whiff: 0, popularityFloor: 4, retryCap: 3 };

// H1: Per-turn budget for "title not found" retries before falling back to
// elimination. A typo or off-canon title is almost never a strategic mistake —
// eliminating on the first miss made early-game frustration the #1 player
// pain point. Three swings is enough to recover from typos but small enough
// that a determined troll can't stall the game indefinitely (the existing
// 8-submits-per-10s socket rate limit is a hard ceiling on top of this).
const MAX_TITLE_NOT_FOUND_RETRIES = 3;

// ---------------------------------------------------------------------------
// CAST-ENTRY HELPERS (H4)
// ---------------------------------------------------------------------------
// A cast entry is `{id, name}` post-H4, but in-flight rooms loaded from
// Redis at deploy time may still hold legacy bare-string entries. These
// helpers normalize on the fly so the rest of the file can stay shape-
// agnostic without each call site re-implementing the fallback.

function _toActor(a) {
  return typeof a === 'string' ? { id: null, name: a } : a;
}

// True iff two cast entries refer to the same person. Prefers id-equality
// when both sides have one (precise across name collisions like two
// "Sam Rockwell"s); falls back to case-insensitive name match otherwise.
function _castEntryMatches(a, b) {
  const x = _toActor(a);
  const y = _toActor(b);
  if (x.id != null && y.id != null) return x.id === y.id;
  if (!x.name || !y.name) return false;
  return x.name.toLowerCase() === y.name.toLowerCase();
}

// ---------------------------------------------------------------------------
// STRING SIMILARITY (for fuzzy movie title matching)
// ---------------------------------------------------------------------------

function levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
      else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

// ---------------------------------------------------------------------------
// AUTOCOMPLETE — TMDB search for the input field
// ---------------------------------------------------------------------------

async function autocompleteSearch(ctx, socket, { query, lobbyId }) {
  const { pubClient, TMDB_HEADERS } = ctx;

  const room = await redisUtils.getLobby(pubClient, lobbyId);
  if (!room) return;
  if (!room.players.find(p => p.id === socket.id)) return;

  const searchType = room.allowTvShows ? 'multi' : 'movie';
  const searchRes = await fetch(
    `${TMDB_API_BASE}/search/${searchType}?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`,
    { headers: TMDB_HEADERS, signal: AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS) }
  );

  const searchData = await searchRes.json();
  let results = (searchData.results || []).filter(r => r.media_type !== 'person');

  // L1: Theme filter — drop suggestions that don't match the lobby's
  // theme so the autocomplete only shows playable picks. Without this,
  // a player in a Horror-themed lobby would see The Avengers as a
  // suggestion and get rejected on submit, which feels like a bug.
  if (room.theme && room.theme !== 'any') {
    results = results.filter(r => themesSystem.matchesTheme(room.theme, r));
  }

  results = results.slice(0, 5).map(r => ({
    id: r.id,
    title: r.title || r.name || 'Unknown Title',
    year: (r.release_date || r.first_air_date || '').split('-')[0] || 'Unknown',
    poster: r.poster_path ? `${TMDB_POSTER_BASE}${r.poster_path}` : null,
    mediaType: r.media_type || (r.title ? 'movie' : 'tv'),
    media_type: r.media_type || (r.title ? 'movie' : 'tv')
  }));

  socket.emit('autocompleteResults', results);
}

// ---------------------------------------------------------------------------
// SUBMIT MOVIE — The core validation pipeline
// ---------------------------------------------------------------------------
// Flow:
//   1. Acquire Redis lock (prevents concurrent submits)
//   2. Resolve movie (by TMDB ID or fuzzy text search)
//   3. Fetch credits for top candidates
//   4. Validate chain connection (shared actors with previous entry)
//   5. Apply hardcore mode rules (no actor reuse)
//   6. Update chain, score, and advance turn
//   7. Release lock
// ---------------------------------------------------------------------------

async function submitMovie(ctx, socket, { lobbyId, movie, tmdbId, mediaType, posterHint }) {
  const { io, pubClient, TMDB_HEADERS, logger } = ctx;

  // Pre-lock quick-reject (avoids contending on the lock when clearly invalid)
  let room = await redisUtils.getLobby(pubClient, lobbyId);
  if (!room || room.status !== 'playing' || room.isValidating || (!movie && !tmdbId)) return;
  const preCheck = room.players.find(p => p.id === socket.id);
  if (!preCheck || !preCheck.isAlive || room.players[room.currentTurnIndex].id !== socket.id) return;

  // acquireSubmitLock now returns a unique token on success (or null if held).
  // The token is required by releaseSubmitLock so the Lua compare-and-delete
  // can refuse to release a lock that has expired and been re-acquired by
  // someone else.
  //
  // T2b (audit P1-3): the submit lock stays the PIPELINE-level dedup — one
  // submission/turn-advance in flight per lobby. It is NOT the data lock any
  // more: every write of the lobby blob below goes through withLobbyLock on
  // a room re-read inside that lock (see the LOCK ORDERING RULE in
  // redisUtils.js — lobbymut nests inside submit, never the reverse).
  const lockToken = await redisUtils.acquireSubmitLock(pubClient, lobbyId);
  if (!lockToken) return;

  try {
    // T2b: the old post-lock re-read + isValidating=true + full-blob save
    // raced lobbymut writers in its tiny read→save window. Now ONE lobbymut
    // section does it: re-read fresh inside the mutex, re-verify the same
    // preconditions the old re-read checked, set the flag, persist. The
    // returned fresh room becomes the pipeline's working snapshot.
    let flagged = false; // side-channel: withLobbyLock returns the room even when the mutator declines
    room = await redisUtils.withLobbyLock(pubClient, lobbyId, (fresh) => {
      if (fresh.status !== 'playing' || fresh.isValidating) return false;
      const p = fresh.players.find(pp => pp.id === socket.id);
      if (!p || !p.isAlive || fresh.players[fresh.currentTurnIndex].id !== socket.id) return false;
      fresh.isValidating = true;
      flagged = true;
    });
    if (!flagged || !room) return;
    // `let` (not const): re-derived from the freshly re-read room after the
    // post-enrich re-read below, so commitPlay / attemptFailed use the player
    // from the same object graph as the room they persist.
    let player = room.players.find(p => p.id === socket.id);

    try {
      // Step 1: Resolve candidates (by ID or text search)
      const topCandidates = await resolveCandidates(room, movie, tmdbId, mediaType, TMDB_HEADERS);

      if (topCandidates.length === 0) {
        // H1: A "title not found" is almost always a typo or an off-canon
        // title TMDB doesn't index — not a strategic mistake. Instead of
        // immediately eliminating, allow up to MAX_TITLE_NOT_FOUND_RETRIES
        // per turn. The turn timer is NOT reset, so the player still pays
        // for fumbling in lost seconds; they just keep their life. Whether
        // the limit is hit determines elimination vs. a private retry hint.
        //
        // T2b: the strike used to be an unlocked re-read + full-blob save —
        // a lobbymut write landing during the TMDB search above was clobbered
        // by it. Increment the counter and release the flag on FRESH state
        // inside the mutex instead.
        let retriesUsed = 0;
        const struck = await redisUtils.withLobbyLock(pubClient, lobbyId, (fresh) => {
          // Default the counter to 0 for older states that pre-date this field.
          fresh.currentTurnRetries = (fresh.currentTurnRetries || 0) + 1;
          retriesUsed = fresh.currentTurnRetries;
          fresh.isValidating = false;
        });
        // Lobby vanished mid-pipeline — nothing to strike, nothing to emit
        // (the old code's unguarded re-read would have thrown to the catch).
        if (!struck) return;
        room = struck;
        const retriesLeft = MAX_TITLE_NOT_FOUND_RETRIES - retriesUsed;

        if (retriesLeft >= 0) {
          // Emit only to the submitting socket — nobody else needs to learn
          // about typos (no broadcast = no leaked strategy, no chat noise).
          // `retriesLeft` lets the client warn the player as they approach
          // the elimination threshold so it doesn't feel arbitrary.
          // `originalInput` lets the client restore the typed text into the
          // input field so the player can edit a typo instead of retyping.
          socket.emit('submissionRejected', {
            reason: 'Title not found',
            message: movie ? `"${movie}" — couldn't find that title.` : "Couldn't find that title.",
            retriesLeft,
            originalInput: typeof movie === 'string' ? movie : '',
          });
          // H6: Track every typo retry so we can see if H1's budget is too
          // tight or too generous. `usedAutocomplete` is the most useful
          // signal: a high typo rate among autocomplete users means search
          // ranking is bad; among non-autocomplete users it means the
          // autocomplete UI isn't discoverable.
          telemetry.track(pubClient, 'submit_rejected', {
            mode: room.gameMode,
            retriesUsed,
            usedAutocomplete: !!tmdbId,
          });
          return;
        }

        // Out of retries: fall through to elimination with a clearer reason
        // than the original "Title not found!" so the eliminated player and
        // spectators understand what actually happened.
        await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, "Too many invalid title attempts");
        return;
      }

      // Step 2: Fetch credits for each candidate
      const candidateMovies = await enrichWithCredits(topCandidates, pubClient, TMDB_HEADERS, logger);

      // Sweep fix (issue 3): if the client provided a posterHint from the
      // autocomplete result — where the SEARCH endpoint's poster_path was
      // known to exist (the user just saw the poster in the dropdown) —
      // and the direct-details fetch above came back with a null poster
      // (a known TMDB quirk where /movie/{id}?language=en-US can return
      // null for titles whose primary poster lacks an English-tagged
      // variant, e.g. Dune: Part Two), use the hint as a fallback so the
      // chain entry doesn't render the empty-frame placeholder for a
      // movie that demonstrably has a poster. SECURITY: validate the
      // hint matches the EXACT canonical shape this server emits
      // (https://image.tmdb.org/t/p/<size>/<path>) so a hostile client
      // can't inject an arbitrary off-TMDB URL into the broadcast chain.
      if (_isValidPosterHint(posterHint)) {
        for (const c of candidateMovies) {
          if (!c.poster) c.poster = posterHint;
        }
      }

      // Step 3: Re-read room (may have changed during async fetches). T2b:
      // this stays an UNLOCKED read — reads can't clobber anything, and the
      // payloads below want the freshest names — while the authoritative
      // verify now lives in the commit mutator further down.
      room = await redisUtils.getLobby(pubClient, lobbyId);
      if (room.status !== 'playing' || room.players[room.currentTurnIndex].id !== socket.id) {
        // T2b: the early-out used to save THIS whole (post-enrich, stale)
        // snapshot just to clear the flag — the exact full-blob clobber this
        // task removes. Clear the flag on fresh state under the mutex.
        await redisUtils.withLobbyLock(pubClient, lobbyId, (fresh) => { fresh.isValidating = false; });
        return;
      }

      // Re-derive `player` from the FRESHLY re-read room. The binding from
      // before the enrich points at the PRE-enrich room object; commitPlay and
      // the attemptFailed payload below must use the player from the same
      // object graph as the `room` they mutate/persist — otherwise a player
      // record that changed during the async resolve/enrich window would be
      // committed/rendered with stale data. (submitBotMove mirrors this.)
      player = room.players.find(p => p.id === socket.id);

      // Step 4: Validate against chain
      const result = validateChainConnection(room, candidateMovies);

      if (!result.match) {
        // Broadcast the failed attempt to everyone in the room before
        // eliminating the player. Without this, only the failing player
        // sees what they tried — others just see "X was eliminated" and
        // have to ask aloud what was attempted. Skipped for "Title not
        // found" upstream (those are usually typos, not strategy).
        const triedTitle = candidateMovies[0]?.title || movie || 'Unknown';
        io.to(lobbyId).emit('attemptFailed', {
          playerName: player.name,
          movieTitle: triedTitle,
          // Phase 7.8: include poster + year so the client can render the
          // ghost as a faded reel-node visually integrated into the
          // Constellation board (a broken-bridge "what they tried" card at
          // the end of the reel), rather than the legacy red-sliver below
          // the cast panel. poster is the same TMDB image URL the chain
          // entries use (null when TMDB had no poster_path for this title
          // and the PR#41 posterHint fallback didn't fill it in).
          poster: candidateMovies[0]?.poster || null,
          year: candidateMovies[0]?.year || '',
          reason: result.reason,
        });

        // H3: Private "why were you eliminated?" payload to the failing
        // player only. Carries the cast lists of both their guess and the
        // last chain entry so the client can render a side-by-side
        // comparison ("here's what was needed, here's what you picked").
        // Trimmed to top 10 cast members so the payload stays small and
        // the UI doesn't get visually overwhelming.
        //
        // Only sent when there's actually something to compare — i.e. there
        // was a candidate movie AND a previous chain entry. First-move
        // failures (chain.length === 0) can't happen by definition (the
        // first move is always valid), so the check is defensive.
        const triedCandidate = candidateMovies[0];
        const lastChainEntry = room.chain.length > 0 ? room.chain[room.chain.length - 1] : null;
        if (triedCandidate && lastChainEntry) {
          // Phase 7.1 Task 1: use topCastNames (shared helper) so both the
          // invalid-connection path here and the timeout path (Task 2) produce
          // the same wire shape without duplicating the slice+map logic.
          // Phase 6a: best-effort, fail-closed "what would have worked".
          // Awaited before the private emit so it rides the existing single
          // youWereEliminated event (no new event by design). Bounded by
          // COULD_HAVE_PLAYED_TIMEOUT_MS; worst case (TMDB cache miss) this
          // delays the room-wide elimination by that bound — acceptable and
          // bounded; the common path is a cache hit (tens of ms).
          // Phase 7.1 Task 1: result is now an array of {title,year,viaActor}
          // outs (up to 3) rather than a single couldHavePlayed object.
          const outs = await _computeCouldHavePlayed(room, pubClient, TMDB_HEADERS);
          socket.emit('youWereEliminated', {
            yourGuess: {
              title: triedCandidate.title,
              year: triedCandidate.year,
              cast: topCastNames(triedCandidate.cast),
            },
            lastChainEntry: {
              title: lastChainEntry.movie.title,
              year: lastChainEntry.movie.year,
              cast: topCastNames(lastChainEntry.movie.cast),
            },
            reason: result.reason,
            // Additive + optional: omitted entirely on miss/error/timeout so
            // the client (and every existing H3 assertion) sees no change.
            ...(outs && outs.length ? { outs } : {}),
          });
        }

        // T2b: release the flag on FRESH state under the mutex (was a stale
        // full-blob save), then eliminate — eliminateCurrentPlayer re-reads
        // and re-verifies under lobbymut itself (T2a). Two short sections
        // instead of one: the flag release must persist even if the
        // elimination then declines (a stuck true flag blocks every future
        // submit via the pre-lock check).
        await redisUtils.withLobbyLock(pubClient, lobbyId, (fresh) => { fresh.isValidating = false; });
        await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, result.reason);
        return;
      }

      // Step 5: Commit the valid play. T2b core: commitPlay used to mutate
      // the post-enrich SNAPSHOT and rely on nextTurn's full-blob save —
      // reverting every lobbymut write that landed during the (up to ~5s of)
      // resolve/enrich awaits above. Now validation stays on the snapshot
      // (chain/turn can't move while we hold the submit lock) and the COMMIT
      // re-reads fresh inside the mutex, re-verifies, then replays the play
      // and the turn advance onto the fresh room in ONE atomic section — a
      // torn two-section commit could persist the chain entry without the
      // advance and let the watchdog kill the very player who just played.
      const expectedChainLen = room.chain.length;
      let committed = false; // side-channel: withLobbyLock returns the room even on decline
      const committedRoom = await redisUtils.withLobbyLock(pubClient, lobbyId, async (fresh) => {
        // Re-verify the snapshot's preconditions on FRESH state. A status
        // flip (a concurrent quit ended the game) or a turn/chain move means
        // this play no longer applies — decline with no write.
        if (fresh.status !== 'playing') return false;
        const freshPlayer = fresh.players.find(pp => pp.id === socket.id);
        if (!freshPlayer || !freshPlayer.isAlive || fresh.players[fresh.currentTurnIndex].id !== socket.id) return false;
        if ((fresh.chain || []).length !== expectedChainLen) return false;

        // Pass the object form of matched actors too so previousSharedActors
        // carries ids — required for id-precise hardcore-mode comparison on
        // the next turn. freshPlayer belongs to the fresh object graph, the
        // same invariant the old post-enrich re-derive protected.
        commitPlay(fresh, socket.id, freshPlayer, result.match, result.matchedActors, result.matchedActorObjects);

        // L3: Settle spectator predictions for this turn — outcome is 'yes'
        // (the player got it). Inside the commit so the predictionResult
        // only fires for a play that actually landed, and the cleared map
        // persists with it.
        gameLogic.settlePredictions(io, lobbyId, fresh, 'yes');

        fresh.isValidating = false;

        // Win-check on fresh state before advancing — a successful play can
        // never END a game by itself, but a concurrent lobbymut kill (quit
        // else-branch) may have left this player the last one standing
        // during our TMDB window; the fresh check resolves that correctly
        // (it persists/broadcasts internally when it fires).
        await gameLogic.checkWinCondition(io, pubClient, lobbyId, fresh);
        if (fresh.status === 'playing') {
          // Synchronous advance on the fresh room (the submitter is alive,
          // so a live next player always exists). Watchdog arming is an
          // in-process side-effect and runs after the lock.
          gameLogic.applyTurnAdvance(fresh);
        }
        committed = true;
      });
      if (!committed || !committedRoom) return;

      // Post-commit side-effects — only for a play that actually persisted.
      // H6: Telemetry — successful play. `usedAutocomplete` distinguishes
      // pick-from-suggestions players from raw-typers; `chainLength` after
      // commit lets us study mode-specific chain length distributions.
      telemetry.track(pubClient, 'submit_success', {
        mode: committedRoom.gameMode,
        chainLength: committedRoom.chain.length,
        usedAutocomplete: !!tmdbId,
        mediaType: result.match.mediaType,
      });

      // H5: Per-player play count + favoriteConnector tracking. We pass
      // the matched actor names from the validation result so the stats
      // hash gets the connector for THIS turn — daily/solo first-move
      // plays have an empty matchedActors array (no connector to learn
      // from), which the stats helper already tolerates.
      if (player.stableId) {
        statsSystem.recordPlay(
          pubClient,
          player.stableId,
          result.matchedActors || []
        ).catch(() => {});
      }

      // T2b: the next turn's watchdog + broadcast, post-lock (the R1
      // pattern: io/timer side-effects stay outside the mutex). The finished
      // case already broadcast inside checkWinCondition above.
      if (committedRoom.status === 'playing') {
        gameLogic.armTurnTimeout(io, pubClient, lobbyId, committedRoom);
        gameLogic.broadcastState(io, lobbyId, committedRoom);
      }

    } catch (err) {
      // T2b: the cleanup used to be an unlocked re-read + full-blob save
      // (clobber-prone) with a null-guard for a Redis blip. The lobbymut
      // helper gives both for free: null when the lobby is gone (skip — the
      // outer finally still releases the submit lock), otherwise the flag is
      // released on FRESH state and the locked eliminate runs on that room.
      const cleared = await redisUtils.withLobbyLock(pubClient, lobbyId, (fresh) => { fresh.isValidating = false; });
      if (cleared) {
        await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, cleared, "API Error or Timeout!");
      }
    }
  } finally {
    // Pass the token so the Lua release script can verify ownership before
    // deleting. .catch swallows release errors — failing to release is
    // recoverable (the 30s TTL cleans it up); we don't want a Redis blip on
    // cleanup to mask the original error from the try block.
    await redisUtils.releaseSubmitLock(pubClient, lobbyId, lockToken).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// SUBMIT HELPERS (private — not exported)
// ---------------------------------------------------------------------------

// Audit finding #8: the direct-ID path used to interpolate the raw client
// mediaType/tmdbId into the TMDB URL and the credits cache key with zero
// validation, and never checked room.allowTvShows. Whitelist both:
//   - tmdbId must be a positive integer (rejects "7 OR 1=1", floats, paths).
//   - mediaType must be exactly 'movie', or 'tv' only when the lobby allows
//     TV (closes the movie-only-room bypass; the fuzzy path already gates on
//     allowTvShows). Anything else → no direct candidate (caller falls back
//     to fuzzy text search, which is itself movie-only when TV is disabled).
function _validatedDirectLookup(room, tmdbId, mediaType) {
  const idNum = Number(tmdbId);
  if (!Number.isInteger(idNum) || idNum <= 0) return null;
  if (mediaType !== 'movie' && mediaType !== 'tv') return null;
  if (mediaType === 'tv' && !room.allowTvShows) return null;
  return { id: idNum, mediaType };
}

// Sweep fix (issue 3): whitelist the autocomplete-passed posterHint so a
// hostile client can't inject an arbitrary URL into the broadcast chain.
// Accepts ONLY the canonical TMDB image shape this server itself emits:
//   https://image.tmdb.org/t/p/<size>/<path>.<ext>
// where <size> is a TMDB image-config token (w92/w154/w185/w342/original/…
// — TMDB-defined; we allow any [a-z0-9_]+) and <path> is the leading-slash
// poster_path (single segment, [A-Za-z0-9_-]+ + optional extension). Length
// is capped so a giant string can't be smuggled into Redis storage even if
// the regex were ever relaxed.
const _POSTER_HINT_RE = /^https:\/\/image\.tmdb\.org\/t\/p\/[a-z0-9_]+\/[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/;
const _POSTER_HINT_MAX_LEN = 200;
function _isValidPosterHint(hint) {
  return typeof hint === 'string'
    && hint.length > 0
    && hint.length <= _POSTER_HINT_MAX_LEN
    && _POSTER_HINT_RE.test(hint);
}

// Phase 5b: a fallback entry → the EXACT candidate shape resolveCandidates'
// live blocks produce, so enrichWithCredits/validateChainConnection stay
// shape-agnostic. mediaType is always 'movie' (the fallback DB is movies-only).
function _fallbackCandidate(entry) {
  return {
    id: entry.id,
    media_type: 'movie',
    name: entry.title,
    title: entry.title,
    release_date: `${entry.year}-01-01`,
    first_air_date: undefined,
    poster_path: null,
  };
}

// Top-10 cast names — the wire shape both elimination paths send so the
// self-elim card renders identically. Exported so gameLogic's timeout emit
// (Task 2) doesn't re-implement the trim.
function topCastNames(cast) {
  return (cast || []).slice(0, 10).map(a => typeof a === 'string' ? a : (a && a.name) || '');
}

// Phase 7.1 Task 1: compute up to 3 "you could have played X" outs for the
// eliminated player, using enumerateConnectingMoves (the read-side enumerator
// from Phase 7.1 Task 0) instead of the single-move generateBotMove call.
// Each out carries viaActor so the self-elim card can show the bridging actor.
// Contract: NEVER throws, NEVER returns partial data, and never blocks the
// caller beyond COULD_HAVE_PLAYED_TIMEOUT_MS. Any miss/error/timeout → null
// (the H3 card degrades gracefully — see ui-notifications legacy path).
// botSystem is lazy-required here because botSystem already lazy-requires
// matchSystem (cycle-safe, mirrors botSystem.js's lazy require of matchSystem).
async function _computeCouldHavePlayed(room, pubClient, headers) {
  try {
    const work = (async () => {
      const botSystem = require('./botSystem');
      // enumerateConnectingMoves: read-side, fail-closed, returns [] on error.
      // rng:()=>0 ⇒ deterministic most-popular-first ordering of actors.
      // popularityFloor from SUGGESTION_BOT_PROFILE maximises candidate coverage.
      const moves = await botSystem.enumerateConnectingMoves(room, {
        pubClient,
        headers,
        rng: () => 0, // deterministic most-popular-first
        getOrFetchPersonCredits: redisUtils.getOrFetchPersonCredits,
        popularityFloor: SUGGESTION_BOT_PROFILE.popularityFloor,
        dailySeed: [], // unused by enumerateConnectingMoves (only generateBotMove consults it); passed for deps-shape parity
      }, { limit: 3 });
      if (!moves || moves.length === 0) return null;
      const outs = [];
      // Dedupe by display title (not tmdbId) because the enumerator already
      // deduped by tmdbId; two distinct tmdbIds sharing the same on-card title
      // string are indistinguishable to the player — showing both is confusing.
      const seenTitles = new Set();
      for (const mv of moves) {
        // Resolve each candidate id → title/year via the same direct-ID path
        // submitBotMove uses (cached). movie arg is null ⇒ no fuzzy search.
        // Call via module.exports so jest.spyOn(matchSystem,'resolveCandidates')
        // intercepts in tests — same spy-able pattern as botSystem.js line ~333.
        const cands = await module.exports.resolveCandidates(room, null, mv.tmdbId, mv.mediaType, headers);
        const top = cands && cands[0];
        if (!top || !top.id) continue;
        const title = top.title || top.name;
        if (!title || seenTitles.has(title)) continue;
        seenTitles.add(title);
        const year = (`${top.release_date || top.first_air_date || ''}`).split('-')[0] || '';
        outs.push({ title, year, viaActor: (mv.viaActor && mv.viaActor.name) || '' });
        if (outs.length >= 3) break;
      }
      return outs.length ? outs : null;
    })();
    // Capture the timer id so we can cancel it once the race settles, and
    // .unref() it so a pending suggestion timer never by itself pins a Jest
    // worker / Node process past shutdown — same discipline as
    // scheduleBotMove's timer (botSystem.js).
    const handle = { id: null };
    const timeout = new Promise((resolve) => {
      handle.id = setTimeout(() => resolve(null), COULD_HAVE_PLAYED_TIMEOUT_MS);
      if (handle.id && typeof handle.id.unref === 'function') handle.id.unref();
    });
    // If the timeout wins the race, `work` may still reject LATER (slow TMDB
    // that ultimately errors). Without this no-op catch that late rejection
    // is unhandled and exits Node 18+. The race still observes the rejection
    // on the fast-reject path, so the outer catch below stays the handler
    // for that path.
    work.catch(() => {});
    try {
      return await Promise.race([work, timeout]);
    } finally {
      // work won → cancel the pending timer (no leak, no stray fire);
      // timeout won → harmless no-op on an already-fired timer.
      clearTimeout(handle.id);
    }
  } catch (e) {
    return null; // best-effort: a missing suggestion must never break elimination
  }
}

async function resolveCandidates(room, movie, tmdbId, mediaType, headers) {
  let topCandidates = [];

  // Direct TMDB ID lookup (from autocomplete selection) — only on a
  // server-validated (id, mediaType) pair. See _validatedDirectLookup.
  const direct = _validatedDirectLookup(room, tmdbId, mediaType);
  if (direct) {
    const lookupUrl = `${TMDB_API_BASE}/${direct.mediaType}/${direct.id}?language=en-US`;
    try {
      const detailsRes = await fetch(lookupUrl, { headers, signal: AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS) });
      // .ok === false (NOT !ok): in standard Node/undici a real Response.ok is
      // always a boolean, so in production this is exactly equivalent to !ok
      // for a non-OK HTTP response (network/timeout rejects are caught below
      // regardless). The stricter check is DELIBERATE — a resolved object with
      // no `ok` property (undefined), as in the pre-existing fetch mocks in
      // matchSystem.botmove.test.js, must be treated as success, not routed to
      // fallback. Do NOT change to !ok (it would break those mocks / alter
      // healthy-path behavior under them).
      if (detailsRes.ok === false) throw new Error(`TMDB details ${detailsRes.status}`);
      const detailsData = await detailsRes.json();
      if (detailsData && detailsData.id) {
        topCandidates = [{
          id: detailsData.id,
          // Use the validated mediaType, never the raw client string.
          media_type: direct.mediaType,
          name: detailsData.name,
          title: detailsData.title || detailsData.name,
          release_date: detailsData.release_date,
          first_air_date: detailsData.first_air_date,
          poster_path: detailsData.poster_path
        }];
      }
    } catch (e) {
      // Deliberately broad: this is a FAILURE-ONLY path. A genuine TMDB
      // network/timeout/non-OK lands here and we serve local data instead of
      // eliminating the player. A programming error in the healthy block would
      // also land here → fallback-or-[] → the existing eliminate path (same net
      // outcome the pre-catch code had via submit's outer catch). Narrowing
      // (instanceof checks) was considered and deferred — not worth the risk on
      // a failure-only path; revisit only if prod monitoring shows fallback
      // hits during healthy TMDB uptime.
      // Phase 5b: TMDB details unreachable. If we have this movie locally,
      // resolve from it so the player isn't eliminated by an outage. Movies
      // only (direct.mediaType may be 'tv' — the fallback DB has no TV);
      // otherwise topCandidates stays [] → the existing typo/eliminate path.
      if (direct.mediaType === 'movie') {
        const fb = fallbackMovies.getFallbackById(direct.id);
        if (fb) topCandidates = [_fallbackCandidate(fb)];
      }
    }
  }

  // Fuzzy text search fallback
  if (topCandidates.length === 0 && movie) {
    const searchType = room.allowTvShows ? 'multi' : 'movie';
    try {
      const searchRes = await fetch(
        `${TMDB_API_BASE}/search/${searchType}?query=${encodeURIComponent(movie)}&include_adult=false&language=en-US&page=1`,
        { headers, signal: AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS) }
      );
      // .ok === false (NOT !ok): in standard Node/undici a real Response.ok is
      // always a boolean, so in production this is exactly equivalent to !ok
      // for a non-OK HTTP response (network/timeout rejects are caught below
      // regardless). The stricter check is DELIBERATE — a resolved object with
      // no `ok` property (undefined), as in the pre-existing fetch mocks in
      // matchSystem.botmove.test.js, must be treated as success, not routed to
      // fallback. Do NOT change to !ok (it would break those mocks / alter
      // healthy-path behavior under them).
      if (searchRes.ok === false) throw new Error(`TMDB search ${searchRes.status}`);
      const searchData = await searchRes.json();
      let results = (searchData.results || []).filter(r => r.media_type !== 'person');

      // L1: Apply theme filter BEFORE the levenshtein sort — otherwise we
      // could end up picking the closest-string-match result that doesn't
      // fit the theme and still letting it through downstream. Filtering
      // first means the candidates we hand to validation are already
      // theme-compliant.
      if (room.theme && room.theme !== 'any') {
        results = results.filter(r => themesSystem.matchesTheme(room.theme, r));
      }

      results.sort((a, b) => {
        const titleA = (a.media_type === 'tv' ? a.name : a.title || a.name || '').toLowerCase();
        const titleB = (b.media_type === 'tv' ? b.name : b.title || b.name || '').toLowerCase();
        const target = movie.toLowerCase();
        return levenshtein(titleA, target) - levenshtein(titleB, target);
      });

      topCandidates = results.slice(0, 5);
    } catch (e) {
      // Deliberately broad: this is a FAILURE-ONLY path. A genuine TMDB
      // network/timeout/non-OK lands here and we serve local data instead of
      // eliminating the player. A programming error in the healthy block would
      // also land here → fallback-or-[] → the existing eliminate path (same net
      // outcome the pre-catch code had via submit's outer catch). Narrowing
      // (instanceof checks) was considered and deferred — not worth the risk on
      // a failure-only path; revisit only if prod monitoring shows fallback
      // hits during healthy TMDB uptime.
      // Phase 5b: TMDB search unreachable. Rank the LOCAL DB by title with
      // the SAME levenshtein + theme filter the live path uses. Map to a NEW
      // array first (allFallback() returns the loader cache BY REFERENCE —
      // sorting it in place would corrupt the cache for every later lookup).
      const target = movie.toLowerCase();
      // Intermediate projection: carry the raw entry (`raw`) through the theme
      // filter + levenshtein sort so _fallbackCandidate runs only on the
      // sliced top 5 — not on all ~1060 entries. (Also: .map() makes a NEW
      // array so the sort never mutates allFallback()'s by-reference cache.)
      let local = fallbackMovies.allFallback().map(entry => ({
        // TMDB-shaped just enough for matchesTheme + the sort key.
        id: entry.id, title: entry.title, media_type: 'movie',
        release_date: `${entry.year}-01-01`, raw: entry,
      }));
      if (room.theme && room.theme !== 'any') {
        local = local.filter(r => themesSystem.matchesTheme(room.theme, r));
      }
      local.sort((a, b) =>
        levenshtein(a.title.toLowerCase(), target) - levenshtein(b.title.toLowerCase(), target));
      topCandidates = local.slice(0, 5).map(r => _fallbackCandidate(r.raw));
    }
  }

  return topCandidates;
}

async function enrichWithCredits(candidates, pubClient, headers, logger) {
  return Promise.all(candidates.map(async (c) => {
    try {
      const mt = c.media_type || 'movie';
      const title = mt === 'tv' ? c.name : c.title;
      const date = mt === 'tv' ? c.first_air_date : c.release_date;
      const credData = await redisUtils.getOrFetchCredits(pubClient, c.id, mt, headers);

      // H4: cast is now an array of {id, name} objects rather than bare
      // names. The id is what validateConnection compares against (so two
      // actors named "Sam Rockwell" stay distinct), while the name is what
      // the client renders. Pre-H4, ambiguous-name collisions and TMDB
      // punctuation drift ("Robert Downey Jr." vs "Robert Downey, Jr.")
      // could cause silent false negatives that eliminated players unfairly.
      return {
        id: c.id,
        title,
        year: date ? date.split('-')[0] : 'Unknown',
        cast: (credData.cast || []).map(actor =>
          // getOrFetchCredits already shapes entries as {id, name}, but
          // tolerate a bare string here to keep this function defensive
          // against any future change to the cache shape.
          typeof actor === 'string' ? { id: null, name: actor } : actor
        ),
        poster: c.poster_path ? `${TMDB_POSTER_BASE}${c.poster_path}` : null,
        mediaType: mt
      };
    } catch (e) {
      logger.error(e, 'Credits fetch error');
      return { id: c.id, title: c.name || c.title, year: 'Unknown', cast: [], poster: null, mediaType: c.media_type || 'movie' };
    }
  }));
}

// Pure validation — no side effects on `room`. The caller (commitPlay) is
// responsible for writing previousSharedActors after deciding to commit.
// Keeping this side-effect-free means the function can be re-run safely on
// retry paths without leaving stale state behind on a later failure.
function validateChainConnection(room, candidateMovies) {
  let failReason = "Invalid movie connection.";
  const lastNode = room.chain.length > 0 ? room.chain[room.chain.length - 1] : null;
  const lastNodeCast = lastNode ? lastNode.movie.cast : [];

  for (let i = 0; i < candidateMovies.length; i++) {
    const candidate = candidateMovies[i];
    const uniqueKey = `${candidate.mediaType}:${candidate.id}`;

    if (room.usedMovies.includes(uniqueKey)) {
      if (i === 0) failReason = "Movie already used!";
      continue;
    }

    // First movie in chain — always valid
    if (!lastNode) return { match: candidate, matchedActors: [] };

    const result = gameLogic.validateConnection(
      lastNodeCast, candidate.cast, room.hardcoreMode, room.previousSharedActors
    );

    if (result.valid) {
      // Pass through both shapes so commitPlay can store the id-bearing
      // object form on previousSharedActors (precise hardcore matching) AND
      // the bare-name form on the chain entry (client-rendered display).
      return {
        match: candidate,
        matchedActors: result.matchedActors,           // [name, ...]
        matchedActorObjects: result.matchedActorObjects, // [{id, name}, ...]
      };
    }

    if (i === 0) failReason = result.reason;
  }

  return { match: null, reason: failReason };
}

function commitPlay(room, socketId, player, validMatch, matchedActors, matchedActorObjects) {
  // H4: Store the id-bearing form on the room so the next turn's hardcore
  // check can compare by id. Falls back to a name-only object array when the
  // caller didn't pass objects (e.g. first move in chain has no matched
  // actors at all, so the array is empty either way).
  //
  // M1: Hardcore mode is now CUMULATIVE — once any actor has been used as a
  // connector in this chain, they're locked out for the rest of the game.
  // Pre-M1 the list was overwritten each turn, which only blocked the
  // immediately-previous connector and let chains ping-pong A→B→A→B in
  // perpetuity. The cumulative set is what most players expect from "no
  // actor reuse" and is what the lobby copy now claims.
  //
  // Outside hardcore mode the cumulative list is harmless — validateConnection
  // only consults it when hardcoreMode is true. We grow it unconditionally so
  // toggling hardcore mid-game (host change, future feature) doesn't reset
  // history.
  const newConnectorObjs = matchedActorObjects && matchedActorObjects.length > 0
    ? matchedActorObjects
    : matchedActors.map(name => ({ id: null, name }));

  const prior = Array.isArray(room.previousSharedActors) ? room.previousSharedActors : [];
  // Dedupe by id when both sides have one, otherwise by lowercase name.
  // Without this, a chain that re-connects via the same already-locked
  // actor in non-hardcore mode would pile up duplicate entries forever.
  const seen = new Set();
  const dedupKey = (a) => {
    const obj = typeof a === 'string' ? { id: null, name: a } : a;
    return obj.id != null ? `id:${obj.id}` : `name:${(obj.name || '').toLowerCase()}`;
  };
  const merged = [];
  for (const a of [...prior, ...newConnectorObjs]) {
    const k = dedupKey(a);
    if (k === 'name:' || seen.has(k)) continue;
    seen.add(k);
    merged.push(typeof a === 'string' ? { id: null, name: a } : a);
  }
  room.previousSharedActors = merged;

  // Trim cast for display (keep top 30 + any matched actors).
  // H4: cast entries are now {id, name} objects, so equality and append
  // logic work in object terms. The matched-actor lookup below uses the
  // object form when available (precise) and the bare name otherwise.
  const displayCast = validMatch.cast.slice(0, 30);
  // Build a lookup of matched actors as objects for the backfill below — we
  // need ids when present so we don't accidentally double-push the same
  // person under a slightly different name spelling.
  const matchedObjs = (matchedActorObjects && matchedActorObjects.length > 0)
    ? matchedActorObjects
    : matchedActors.map(name => ({ id: null, name }));

  matchedObjs.forEach(actor => {
    if (!displayCast.some(d => _castEntryMatches(d, actor))) {
      displayCast.push(actor);
    }
    // Backfill matched actor into previous chain node if missing — keeps
    // the chain self-consistent for the share card and chain replay.
    if (room.chain.length > 0) {
      const prevNode = room.chain[room.chain.length - 1];
      if (!prevNode.movie.cast.some(d => _castEntryMatches(d, actor))) {
        prevNode.movie.cast.push(actor);
      }
    }
  });
  validMatch.cast = displayCast;

  // Record the play
  const uniqueMatchKey = `${validMatch.mediaType}:${validMatch.id}`;
  room.usedMovies.push(uniqueMatchKey);

  const lightweightMovie = {
    id: validMatch.id,
    title: validMatch.title,
    poster: validMatch.poster,
    year: validMatch.year,
    cast: validMatch.cast,
    mediaType: validMatch.mediaType
  };

  room.chain.push({ playerId: player.id, playerName: player.name, movie: lightweightMovie, matchedActors });

  const pIndex = room.players.findIndex(p => p.id === socketId);
  if (pIndex > -1) room.players[pIndex].score += 100;

  // M5: Solo-only streak + objective bookkeeping. Other modes don't read
  // these fields, so the work is conditional both for performance and to
  // keep the broadcast state lean.
  if (room.gameMode === 'solo') {
    // Streak grows on every successful play. Milestones (3 / 5 / 10 / 15)
    // award a flat bonus equal to the streak count — bigger streaks pay
    // more. Capped at 15 so a player who's a Tom-Hanks expert chaining
    // 50 doesn't earn ever-growing bonuses; we want the milestones to
    // feel like checkpoints, not an arithmetic series.
    room.currentStreak = (room.currentStreak | 0) + 1;
    const STREAK_MILESTONES = [3, 5, 10, 15];
    if (STREAK_MILESTONES.includes(room.currentStreak)) {
      room.bonusPoints = (room.bonusPoints | 0) + room.currentStreak;
      // Flag the milestone for the broadcast — client clears it after
      // showing the celebration so subsequent stateUpdates don't re-fire.
      room.streakMilestone = room.currentStreak;
    } else {
      room.streakMilestone = null;
    }

    // Objective check — first satisfaction wins the one-shot bonus.
    // matchesObjective via the server-side lookup keeps test functions
    // out of the serialized state (they aren't Redis-safe anyway).
    if (room.objective && !room.objectiveHit) {
      const obj = soloObjectivesSystem.getObjectiveById(room.objective.id);
      if (obj && obj.test(lightweightMovie)) {
        room.objectiveHit = true;
        room.bonusPoints = (room.bonusPoints | 0) + soloObjectivesSystem.OBJECTIVE_BONUS_POINTS;
        // Flag for the same one-shot client celebration pattern.
        room.objectiveJustHit = true;
      }
    }
  }

  room.timerMultiplier++;
}

// ---------------------------------------------------------------------------
// FORCE NEXT TURN
// ---------------------------------------------------------------------------

async function forceNextTurn(ctx, socket, lobbyId) {
  const { io, pubClient } = ctx;

  // Take the same lock submitMovie uses. If a submit is in flight, this
  // returns null and we skip — that submit will advance the turn naturally.
  // Without the lock, multiple players seeing an expired timer simultaneously
  // could each call eliminateCurrentPlayer, double-eliminating or skipping turns.
  const lockToken = await redisUtils.acquireSubmitLock(pubClient, lobbyId);
  if (!lockToken) return;

  try {
    // Re-read room state INSIDE the lock — the previous holder may have
    // already eliminated the current player and armed a new timer, so
    // any state we read before the lock was held is stale.
    const room = await redisUtils.getLobby(pubClient, lobbyId);
    if (!room || room.status !== 'playing' || room.isValidating) return;
    // Only participants in the room may force-advance the turn.
    if (!room.players.find(p => p.id === socket.id)) return;
    if (!room.turnExpiresAt) return;

    // Re-check expiry against the FRESH state — if the previous lock holder
    // advanced the turn, turnExpiresAt is now in the future and we no-op.
    if (Date.now() >= room.turnExpiresAt) {
      await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, "Time's up!");
    }
  } finally {
    await redisUtils.releaseSubmitLock(pubClient, lobbyId, lockToken).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// SUBMIT BOT MOVE (Phase 5a) — the socket-free twin of submitMovie
// ---------------------------------------------------------------------------
// A bot has no socket, so it cannot reuse submitMovie (which gates on
// socket.id and emits private rejection payloads to the submitting socket).
// This runs the IDENTICAL lock→resolve→enrich→validate→commit→nextTurn
// pipeline, but: identifies the player by botId, never emits to a socket,
// skips the human typo-retry budget (the bot submits a concrete TMDB id),
// and on ANY miss/error gracefully eliminates the bot via the existing
// engine path (room-wide notification only — eliminateCurrentPlayer does no
// per-socket emit, so a socketless bot is safe). Kept here, beside
// submitMovie, so the submit-lock orchestration lives in one reviewed place.
async function submitBotMove(ctx, lobbyId, botId, chosenMove) {
  const { io, pubClient, TMDB_HEADERS, logger } = ctx;
  const { tmdbId, mediaType } = chosenMove || {};

  // Pre-lock quick reject (mirror submitMovie's pre-lock checks but by botId).
  let room = await redisUtils.getLobby(pubClient, lobbyId);
  if (!room || room.status !== 'playing' || room.isValidating || tmdbId == null) return;
  const pre = room.players.find(p => p.id === botId);
  if (!pre || !pre.isAlive || room.players[room.currentTurnIndex].id !== botId) return;

  const lockToken = await redisUtils.acquireSubmitLock(pubClient, lobbyId);
  if (!lockToken) return;

  try {
    // T2b: identical conversion to submitMovie — the post-lock re-read +
    // flag write happens in ONE lobbymut section on fresh state; the
    // returned room is the pipeline's working snapshot.
    let flagged = false; // side-channel: withLobbyLock returns the room even when the mutator declines
    room = await redisUtils.withLobbyLock(pubClient, lobbyId, (fresh) => {
      if (fresh.status !== 'playing' || fresh.isValidating) return false;
      const p = fresh.players.find(pp => pp.id === botId);
      if (!p || !p.isAlive || fresh.players[fresh.currentTurnIndex].id !== botId) return false;
      fresh.isValidating = true;
      flagged = true;
    });
    if (!flagged || !room) return;
    // `let` (not const): re-derived from the freshly re-read room after the
    // post-enrich re-read below (mirrors submitMovie).
    let botPlayer = room.players.find(p => p.id === botId);

    try {
      // movie arg is null — the bot always submits a concrete TMDB id, so
      // resolveCandidates takes its validated direct-ID branch (no fuzzy
      // search, no typo budget). _validatedDirectLookup still sanitizes it (positive-int id, movie/tv mediaType).
      const topCandidates = await resolveCandidates(room, null, tmdbId, mediaType, TMDB_HEADERS);
      if (topCandidates.length === 0) {
        // Couldn't resolve the bot's own pick (rare: TMDB blip). Treat like a
        // human who ran out of moves — graceful, fair, game continues.
        // T2b: flag release moves onto FRESH state under lobbymut (was a
        // stale full-blob save); the eliminate then re-verifies under its
        // own lobbymut commit (T2a).
        const cleared = await redisUtils.withLobbyLock(pubClient, lobbyId, (fresh) => { fresh.isValidating = false; });
        if (cleared) {
          await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, cleared, "Bot couldn't find a move");
        }
        return;
      }

      const candidateMovies = await enrichWithCredits(topCandidates, pubClient, TMDB_HEADERS, logger);

      // T2b: unchanged UNLOCKED re-read (fresher names for the payloads; the
      // authoritative verify lives in the commit mutator below).
      room = await redisUtils.getLobby(pubClient, lobbyId);
      if (room.status !== 'playing' || room.players[room.currentTurnIndex].id !== botId) {
        // T2b: flag release on fresh state (was a stale full-blob save).
        await redisUtils.withLobbyLock(pubClient, lobbyId, (fresh) => { fresh.isValidating = false; });
        return;
      }

      // Re-derive `botPlayer` from the FRESHLY re-read room (same rationale as
      // submitMovie's post-enrich re-derive: the binding above is the
      // PRE-enrich object; the attemptFailed payload / commitPlay below must
      // use the player from the same graph as the persisted `room`).
      botPlayer = room.players.find(p => p.id === botId);

      const result = validateChainConnection(room, candidateMovies);
      if (!result.match) {
        // A correctly-generated move connects by construction; reaching here
        // means a stale/edge pick. Broadcast the failed attempt (room-wide,
        // bot-safe) then eliminate the bot — no private socket payload.
        const triedTitle = candidateMovies[0]?.title || 'Unknown';
        // Phase 7.8: same payload extension as the player path above —
        // poster + year so the bot's failed attempt also surfaces as a
        // ghost reel-node in the Constellation board rather than the
        // legacy red sliver. Wire format identical to the player path so
        // a single client handler covers both.
        io.to(lobbyId).emit('attemptFailed', {
          playerName: botPlayer.name,
          movieTitle: triedTitle,
          poster: candidateMovies[0]?.poster || null,
          year: candidateMovies[0]?.year || '',
          reason: result.reason,
        });
        // T2b: flag release on fresh state under lobbymut (was a stale
        // full-blob save), then the T2a-locked eliminate.
        await redisUtils.withLobbyLock(pubClient, lobbyId, (fresh) => { fresh.isValidating = false; });
        await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, result.reason);
        return;
      }

      // Identical commit path to submitMovie (T2b): validation happened on
      // the snapshot; the COMMIT re-reads fresh inside lobbymut, re-verifies,
      // and replays the play + turn advance onto the fresh room atomically.
      const expectedChainLen = room.chain.length;
      let committed = false; // side-channel: withLobbyLock returns the room even on decline
      const committedRoom = await redisUtils.withLobbyLock(pubClient, lobbyId, async (fresh) => {
        if (fresh.status !== 'playing') return false;
        // commitPlay scores by id (players.findIndex(p => p.id === botId)) so
        // the bot id works; the fresh-derived player keeps the same-object-
        // graph invariant the old post-enrich re-derive protected.
        const freshBot = fresh.players.find(pp => pp.id === botId);
        if (!freshBot || !freshBot.isAlive || fresh.players[fresh.currentTurnIndex].id !== botId) return false;
        if ((fresh.chain || []).length !== expectedChainLen) return false;

        commitPlay(fresh, botId, freshBot, result.match, result.matchedActors, result.matchedActorObjects);
        // Spectator-prediction settle ('yes' = play succeeded), same as submitMovie.
        gameLogic.settlePredictions(io, lobbyId, fresh, 'yes');
        fresh.isValidating = false;
        // Fresh win-check + advance — same rationale as submitMovie's commit.
        await gameLogic.checkWinCondition(io, pubClient, lobbyId, fresh);
        if (fresh.status === 'playing') {
          gameLogic.applyTurnAdvance(fresh);
        }
        committed = true;
      });
      if (!committed || !committedRoom) return;
      // Watchdog + broadcast post-lock, only for a committed, still-running
      // game (the finished case broadcast inside checkWinCondition).
      if (committedRoom.status === 'playing') {
        gameLogic.armTurnTimeout(io, pubClient, lobbyId, committedRoom);
        gameLogic.broadcastState(io, lobbyId, committedRoom);
      }
    } catch (err) {
      // Same shape as submitMovie's catch (T2b): the lobbymut helper both
      // null-guards a Redis blip (returns null → skip; the outer finally
      // still releases the submit lock) and releases the flag on FRESH state
      // instead of saving the stale snapshot. No socket to notify.
      const cleared = await redisUtils.withLobbyLock(pubClient, lobbyId, (fresh) => { fresh.isValidating = false; });
      if (cleared) {
        await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, cleared, "Bot couldn't find a move");
      }
    }
  } finally {
    await redisUtils.releaseSubmitLock(pubClient, lobbyId, lockToken).catch(() => {});
  }
}

module.exports = {
  autocompleteSearch,
  submitMovie,
  forceNextTurn,
  // Phase 5a: the bot commit reuses the EXACT same pipeline as submitMovie.
  // Exported so submitBotMove (and only it) can drive them without a socket.
  resolveCandidates,
  enrichWithCredits,
  validateChainConnection,
  commitPlay,
  submitBotMove,
  // Phase 7.1 Task 1: exported for unit tests + Task 2 reuse (timeout path).
  // _computeCouldHavePlayed is the fail-closed outs builder; topCastNames is
  // the shared cast-trim helper so both elimination paths produce the same shape.
  _computeCouldHavePlayed,
  topCastNames,
  // Sweep fix (issue 3): exported so the security whitelist for the
  // autocomplete-passed posterHint can be unit-tested in isolation.
  _isValidPosterHint,
};
