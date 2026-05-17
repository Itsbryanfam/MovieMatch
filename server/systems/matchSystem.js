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

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w92';
const TMDB_FETCH_TIMEOUT_MS = 5000;

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

async function submitMovie(ctx, socket, { lobbyId, movie, tmdbId, mediaType }) {
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
  const lockToken = await redisUtils.acquireSubmitLock(pubClient, lobbyId);
  if (!lockToken) return;

  try {
    // Re-read after acquiring lock — disconnects may have mutated state during acquisition
    room = await redisUtils.getLobby(pubClient, lobbyId);
    if (!room || room.status !== 'playing' || room.isValidating) return;
    // `let` (not const): re-derived from the freshly re-read room after the
    // post-enrich re-read below, so commitPlay / attemptFailed use the player
    // from the same object graph as the room they persist.
    let player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isAlive || room.players[room.currentTurnIndex].id !== socket.id) return;

    room.isValidating = true;
    await redisUtils.saveLobby(pubClient, lobbyId, room);

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
        room = await redisUtils.getLobby(pubClient, lobbyId);
        // Default the counter to 0 for older states that pre-date this field.
        room.currentTurnRetries = (room.currentTurnRetries || 0) + 1;
        const retriesUsed = room.currentTurnRetries;
        const retriesLeft = MAX_TITLE_NOT_FOUND_RETRIES - retriesUsed;

        room.isValidating = false;
        await redisUtils.saveLobby(pubClient, lobbyId, room);

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

      // Step 3: Re-read room (may have changed during async fetches)
      room = await redisUtils.getLobby(pubClient, lobbyId);
      if (room.status !== 'playing' || room.players[room.currentTurnIndex].id !== socket.id) {
        room.isValidating = false;
        await redisUtils.saveLobby(pubClient, lobbyId, room);
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
          // Cast may be {id, name} objects (post-H4) or bare strings on
          // legacy in-flight rooms — normalize to plain names for the
          // wire format so the client doesn't have to handle both shapes.
          const namesOnly = (cast) =>
            (cast || []).slice(0, 10).map(a => typeof a === 'string' ? a : (a && a.name) || '');
          socket.emit('youWereEliminated', {
            yourGuess: {
              title: triedCandidate.title,
              year: triedCandidate.year,
              cast: namesOnly(triedCandidate.cast),
            },
            lastChainEntry: {
              title: lastChainEntry.movie.title,
              year: lastChainEntry.movie.year,
              cast: namesOnly(lastChainEntry.movie.cast),
            },
            reason: result.reason,
          });
        }

        room.isValidating = false;
        await redisUtils.saveLobby(pubClient, lobbyId, room);
        await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, result.reason);
        return;
      }

      // Step 5: Commit the valid play. Pass the object form of matched
      // actors too so previousSharedActors carries ids — required for
      // id-precise hardcore-mode comparison on the next turn.
      commitPlay(room, socket.id, player, result.match, result.matchedActors, result.matchedActorObjects);

      // H6: Telemetry — successful play. `usedAutocomplete` distinguishes
      // pick-from-suggestions players from raw-typers; `chainLength` after
      // commit lets us study mode-specific chain length distributions.
      telemetry.track(pubClient, 'submit_success', {
        mode: room.gameMode,
        chainLength: room.chain.length,
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

      // L3: Settle spectator predictions for this turn — outcome is 'yes'
      // (the player got it). Done before nextTurn (which resets the timer
      // and broadcasts) so the predictionResult lands first and the next
      // tally starts clean. The settle helper clears the predictions map
      // on the room object so the upcoming broadcast reflects an empty
      // tally for the next active player.
      gameLogic.settlePredictions(io, lobbyId, room, 'yes');

      room.isValidating = false;
      await gameLogic.nextTurn(io, pubClient, lobbyId, room);

    } catch (err) {
      // Guard the re-read: if Redis is briefly unavailable at cleanup time,
      // getLobby returns null and `room.isValidating = false` would throw a
      // TypeError that escapes past the outer finally as an unhandled
      // rejection. The lock is still released by finally; we just skip the
      // (now-unreachable) state cleanup. Mirrors submitBotMove's catch.
      room = await redisUtils.getLobby(pubClient, lobbyId);
      if (room) {
        room.isValidating = false;
        await redisUtils.saveLobby(pubClient, lobbyId, room);
        await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, "API Error or Timeout!");
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

async function resolveCandidates(room, movie, tmdbId, mediaType, headers) {
  let topCandidates = [];

  // Direct TMDB ID lookup (from autocomplete selection) — only on a
  // server-validated (id, mediaType) pair. See _validatedDirectLookup.
  const direct = _validatedDirectLookup(room, tmdbId, mediaType);
  if (direct) {
    const lookupUrl = `${TMDB_API_BASE}/${direct.mediaType}/${direct.id}?language=en-US`;
    const detailsRes = await fetch(lookupUrl, { headers, signal: AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS) });
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
  }

  // Fuzzy text search fallback
  if (topCandidates.length === 0 && movie) {
    const searchType = room.allowTvShows ? 'multi' : 'movie';
    const searchRes = await fetch(
      `${TMDB_API_BASE}/search/${searchType}?query=${encodeURIComponent(movie)}&include_adult=false&language=en-US&page=1`,
      { headers, signal: AbortSignal.timeout(TMDB_FETCH_TIMEOUT_MS) }
    );
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
    room = await redisUtils.getLobby(pubClient, lobbyId);
    if (!room || room.status !== 'playing' || room.isValidating) return;
    // `let` (not const): re-derived from the freshly re-read room after the
    // post-enrich re-read below (mirrors submitMovie).
    let botPlayer = room.players.find(p => p.id === botId);
    if (!botPlayer || !botPlayer.isAlive || room.players[room.currentTurnIndex].id !== botId) return;

    room.isValidating = true;
    await redisUtils.saveLobby(pubClient, lobbyId, room);

    try {
      // movie arg is null — the bot always submits a concrete TMDB id, so
      // resolveCandidates takes its validated direct-ID branch (no fuzzy
      // search, no typo budget). _validatedDirectLookup still sanitizes it (positive-int id, movie/tv mediaType).
      const topCandidates = await resolveCandidates(room, null, tmdbId, mediaType, TMDB_HEADERS);
      if (topCandidates.length === 0) {
        // Couldn't resolve the bot's own pick (rare: TMDB blip). Treat like a
        // human who ran out of moves — graceful, fair, game continues.
        room.isValidating = false;
        await redisUtils.saveLobby(pubClient, lobbyId, room);
        await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, "Bot couldn't find a move");
        return;
      }

      const candidateMovies = await enrichWithCredits(topCandidates, pubClient, TMDB_HEADERS, logger);

      room = await redisUtils.getLobby(pubClient, lobbyId);
      if (room.status !== 'playing' || room.players[room.currentTurnIndex].id !== botId) {
        room.isValidating = false;
        await redisUtils.saveLobby(pubClient, lobbyId, room);
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
        io.to(lobbyId).emit('attemptFailed', { playerName: botPlayer.name, movieTitle: triedTitle, reason: result.reason });
        room.isValidating = false;
        await redisUtils.saveLobby(pubClient, lobbyId, room);
        await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, result.reason);
        return;
      }

      // Identical commit path to submitMovie. commitPlay scores by id
      // (room.players.findIndex(p => p.id === botId)) so the bot id works.
      // botPlayer was re-derived from the fresh post-enrich room above, so it
      // belongs to the same object graph as `room` — consistent with
      // submitMovie's matching re-derive.
      commitPlay(room, botId, botPlayer, result.match, result.matchedActors, result.matchedActorObjects);
      // Spectator-prediction settle ('yes' = play succeeded), same as submitMovie.
      gameLogic.settlePredictions(io, lobbyId, room, 'yes');
      room.isValidating = false;
      await gameLogic.nextTurn(io, pubClient, lobbyId, room);
    } catch (err) {
      // Same shape as submitMovie's catch: clear the flag, then eliminate
      // (room-wide reason only). No socket to notify. Null-guard the re-read:
      // a Redis blip at cleanup makes getLobby return null and the unguarded
      // `room.isValidating = false` would escape the outer finally as an
      // unhandled rejection. Mirrors submitMovie's guarded catch.
      room = await redisUtils.getLobby(pubClient, lobbyId);
      if (room) {
        room.isValidating = false;
        await redisUtils.saveLobby(pubClient, lobbyId, room);
        await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, "Bot couldn't find a move");
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
};
