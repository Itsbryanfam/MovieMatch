// ============================================================================
// MATCH SYSTEM — TMDB search, movie validation, and chain building
// ============================================================================
// Pure system functions. No socket event binding, no rate limiting.
// Each function receives a context object { io, pubClient, TMDB_HEADERS, logger }
// and operates on game data through redisUtils.
// ============================================================================

const redisUtils = require('../redisUtils');
const gameLogic = require('../gameLogic');

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
    `https://api.themoviedb.org/3/search/${searchType}?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`,
    { headers: TMDB_HEADERS, signal: AbortSignal.timeout(5000) }
  );

  const searchData = await searchRes.json();
  let results = (searchData.results || []).filter(r => r.media_type !== 'person');

  results = results.slice(0, 5).map(r => ({
    id: r.id,
    title: r.title || r.name || 'Unknown Title',
    year: (r.release_date || r.first_air_date || '').split('-')[0] || 'Unknown',
    poster: r.poster_path ? `https://image.tmdb.org/t/p/w92${r.poster_path}` : null,
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

  let room = await redisUtils.getLobby(pubClient, lobbyId);
  if (!room || room.status !== 'playing' || room.isValidating || (!movie && !tmdbId)) return;

  const player = room.players.find(p => p.id === socket.id);
  if (!player || !player.isAlive || room.players[room.currentTurnIndex].id !== socket.id) return;

  const lockAcquired = await redisUtils.acquireSubmitLock(pubClient, lobbyId);
  if (!lockAcquired) return;

  try {
    room.isValidating = true;
    await redisUtils.saveLobby(pubClient, lobbyId, room);

    try {
      // Step 1: Resolve candidates (by ID or text search)
      const topCandidates = await resolveCandidates(room, movie, tmdbId, mediaType, TMDB_HEADERS);

      if (topCandidates.length === 0) {
        room = await redisUtils.getLobby(pubClient, lobbyId);
        room.isValidating = false;
        await redisUtils.saveLobby(pubClient, lobbyId, room);
        await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, "Title not found!");
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

      // Step 4: Validate against chain
      const result = validateChainConnection(room, candidateMovies);

      if (!result.match) {
        room.isValidating = false;
        await redisUtils.saveLobby(pubClient, lobbyId, room);
        await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, result.reason);
        return;
      }

      // Step 5: Commit the valid play
      commitPlay(room, socket.id, player, result.match, result.matchedActors);

      room.isValidating = false;
      await gameLogic.nextTurn(io, pubClient, lobbyId, room);

    } catch (err) {
      room = await redisUtils.getLobby(pubClient, lobbyId);
      room.isValidating = false;
      await redisUtils.saveLobby(pubClient, lobbyId, room);
      await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, "API Error or Timeout!");
    }
  } finally {
    await redisUtils.releaseSubmitLock(pubClient, lobbyId).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// SUBMIT HELPERS (private — not exported)
// ---------------------------------------------------------------------------

async function resolveCandidates(room, movie, tmdbId, mediaType, headers) {
  let topCandidates = [];

  // Direct TMDB ID lookup (from autocomplete selection)
  if (tmdbId && mediaType) {
    const lookupUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?language=en-US`;
    const detailsRes = await fetch(lookupUrl, { headers, signal: AbortSignal.timeout(5000) });
    const detailsData = await detailsRes.json();
    if (detailsData && detailsData.id) {
      topCandidates = [{
        id: detailsData.id,
        media_type: mediaType,
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
      `https://api.themoviedb.org/3/search/${searchType}?query=${encodeURIComponent(movie)}&include_adult=false&language=en-US&page=1`,
      { headers, signal: AbortSignal.timeout(5000) }
    );
    const searchData = await searchRes.json();
    let results = (searchData.results || []).filter(r => r.media_type !== 'person');

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

      return {
        id: c.id,
        title,
        year: date ? date.split('-')[0] : 'Unknown',
        cast: (credData.cast || []).map(actor => actor.name),
        poster: c.poster_path ? `https://image.tmdb.org/t/p/w92${c.poster_path}` : null,
        mediaType: mt
      };
    } catch (e) {
      logger.error(e, 'Credits fetch error');
      return { id: c.id, title: c.name || c.title, year: 'Unknown', cast: [], poster: null, mediaType: c.media_type || 'movie' };
    }
  }));
}

function validateChainConnection(room, candidateMovies) {
  let matchedActors = [];
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

    const sharedActors = candidate.cast.filter(actor =>
      lastNodeCast.some(lastActor => lastActor.toLowerCase() === actor.toLowerCase())
    );

    if (sharedActors.length > 0) {
      // Hardcore mode: can't reuse the same connecting actor as the previous turn
      if (room.hardcoreMode && room.previousSharedActors.length > 0) {
        const newSharedActors = sharedActors.filter(actor =>
          !room.previousSharedActors.some(pActor => pActor.toLowerCase() === actor.toLowerCase())
        );
        if (newSharedActors.length === 0) {
          failReason = "Hardcore Mode: You cannot reuse the exact same connecting actor from the previous turn!";
          continue;
        }
        room.previousSharedActors = newSharedActors;
        matchedActors = newSharedActors;
      } else {
        room.previousSharedActors = sharedActors;
        matchedActors = sharedActors;
      }
      return { match: candidate, matchedActors };
    }
  }

  return { match: null, reason: failReason };
}

function commitPlay(room, socketId, player, validMatch, matchedActors) {
  // Trim cast for display (keep top 30 + any matched actors)
  const displayCast = validMatch.cast.slice(0, 30);
  matchedActors.forEach(actor => {
    if (!displayCast.some(d => d.toLowerCase() === actor.toLowerCase())) {
      displayCast.push(actor);
    }
    // Backfill matched actor into previous chain node if missing
    if (room.chain.length > 0) {
      const prevNode = room.chain[room.chain.length - 1];
      if (!prevNode.movie.cast.some(d => d.toLowerCase() === actor.toLowerCase())) {
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

  room.timerMultiplier++;
}

// ---------------------------------------------------------------------------
// FORCE NEXT TURN
// ---------------------------------------------------------------------------

async function forceNextTurn(ctx, socket, lobbyId) {
  const { io, pubClient } = ctx;

  let room = await redisUtils.getLobby(pubClient, lobbyId);
  if (!room || room.status !== 'playing' || room.isValidating) return;
  if (!room.players.find(p => p.id === socket.id)) return;
  if (!room.turnExpiresAt) return;

  const now = Date.now();
  if (now >= room.turnExpiresAt) {
    await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, room, "Time's up!");
  } else {
    const delay = (room.turnExpiresAt - now) + 500;
    if (delay > 0 && delay < 65000) {
      setTimeout(async () => {
        const freshRoom = await redisUtils.getLobby(pubClient, lobbyId);
        if (!freshRoom || freshRoom.status !== 'playing' || freshRoom.isValidating) return;
        if (freshRoom.turnExpiresAt === room.turnExpiresAt && Date.now() >= freshRoom.turnExpiresAt) {
          await gameLogic.eliminateCurrentPlayer(io, pubClient, lobbyId, freshRoom, "Time's up!");
        }
      }, delay);
    }
  }
}

module.exports = {
  autocompleteSearch,
  submitMovie,
  forceNextTurn,
  levenshtein,
};
