// ============================================================================
// lock-unification.test.js — T2 audit (2026-06-09): one write discipline for
// the lobby blob (audit P1-3 "dual lock classes").
// ============================================================================
// lock:submit:<id> (the pipeline dedup) and lock:lobbymut:<id> (withLobbyLock,
// the data-commit mutex) guard the SAME Redis key but never took each other.
// A submit-lock holder read the room, awaited long TMDB work (up to ~1.2s in
// _computeCouldHavePlayed), then saveLobby'd the whole stale blob — silently
// REVERTING any lobbymut-committed write that landed in that window (a quit
// marked dead resurrected; a spectator join vanished; an equipped title
// erased). T2 makes every data commit performed under the submit lock go
// through withLobbyLock with a fresh re-read + re-verify; these tests pin
// that contract for each converted tail.
// ============================================================================

const gameLogic = require('./gameLogic');
const matchSystem = require('./systems/matchSystem');
const redisUtils = require('./redisUtils');
const telemetry = require('./telemetry');

jest.mock('./redisUtils');
global.fetch = jest.fn();

// telemetry.track is fire-and-forget and swallows its own errors in prod, but
// spying it out keeps the bare {} pubClient harness from depending on
// telemetry's Redis surface — and lets the T2c startLobby test COUNT
// game_started events precisely.
let trackSpy;
beforeEach(() => {
  jest.clearAllMocks();
  trackSpy = jest.spyOn(telemetry, 'track').mockImplementation(() => {});
});
afterEach(() => {
  // Restore every spy (telemetry, matchSystem, gameLogic) so spies on shared
  // module objects can never leak across describes.
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Store-backed redisUtils mock with REAL-Redis semantics (the harness shape
// from disconnect-rejoin-lock.test.js / commit b1a6022): every getLobby hands
// out a FRESH JSON round-trip copy so a stale-snapshot bug is observable
// instead of hidden by shared object identity; any saveLobby outside a lock
// section is flagged as a lost-update hazard; an injection hook can land a
// "concurrent lobbymut writer" after the Nth read — i.e. exactly between a
// pipeline's snapshot and its commit.
// ---------------------------------------------------------------------------
function makeStoreHarness() {
  const h = {
    store: new Map(),
    nakedSaves: [],
    reads: 0,
    injectAfterRead: null, // { afterRead: n, fn } — fn fires right after the nth getLobby returns its snapshot
    inLock: false,
    seed(id, room) { h.store.set(id, JSON.stringify(room)); },
    snapshot(id) { return JSON.parse(h.store.get(id)); },
    // Models a concurrent withLobbyLock writer committing to the store.
    mutateStore(id, fn) { const r = JSON.parse(h.store.get(id)); fn(r); h.store.set(id, JSON.stringify(r)); },
  };

  redisUtils.getLobby.mockImplementation(async (_p, id) => {
    const raw = h.store.get(id);
    const snap = raw ? JSON.parse(raw) : null;
    h.reads++;
    // Land the injected concurrent write right AFTER this snapshot was taken
    // — the snapshot now predates the store, which is the exact pre-fix race.
    if (h.injectAfterRead && h.reads === h.injectAfterRead.afterRead) {
      h.injectAfterRead.fn();
    }
    return snap;
  });
  redisUtils.saveLobby.mockImplementation(async (_p, id, room) => {
    // Core T2 assertion hook: a save outside a lock section is exactly the
    // full-blob clobber this task eliminates — flag it, don't absorb it.
    if (!h.inLock) h.nakedSaves.push(`saveLobby(${id}) outside withLobbyLock`);
    h.store.set(id, JSON.stringify(room));
  });
  // Faithful withLobbyLock contract (read fresh INSIDE the lock → mutate →
  // persist unless the mutator returned false → return the room) — same
  // shape as the production helper and the T1e test mock.
  redisUtils.withLobbyLock.mockImplementation(async (pub, id, fn, opts = {}) => {
    h.inLock = true;
    try {
      const r = (await redisUtils.getLobby(pub, id)) || opts.seedRoom || null;
      if (!r) return null;
      const res = await fn(r);
      if (res !== false) await redisUtils.saveLobby(pub, id, r);
      return r;
    } finally {
      h.inLock = false;
    }
  });
  redisUtils.acquireSubmitLock.mockResolvedValue('tok-t2');
  redisUtils.releaseSubmitLock.mockResolvedValue(undefined);
  return h;
}

// io double that records to(roomOrSocket).emit(...) in order — the eliminate
// tail emits both room-wide notifications and a private youWereEliminated.
function mkIo() {
  const emits = [];
  const io = {
    to: jest.fn((id) => ({ emit: (ev, payload) => emits.push({ id, ev, payload }) })),
    emit: jest.fn(),
    sockets: { sockets: new Map() },
  };
  return { io, emits };
}

// ---------------------------------------------------------------------------
// T2b — the submit pipeline's success commit re-reads fresh under lobbymut
// ---------------------------------------------------------------------------
describe('T2b — submit pipeline commit under lobbymut', () => {
  // The success commit arms the next turn's watchdog — clear it.
  afterEach(() => gameLogic.clearTurnTimeout('L1'));

  test('a lobbymut kill landing between the validation snapshot and the commit survives, and the move still applies', async () => {
    const h = makeStoreHarness();
    const { io } = mkIo();
    const ctx = { io, pubClient: {}, TMDB_HEADERS: { Authorization: 'Bearer t', accept: 'application/json' }, logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() } };
    h.seed('L1', {
      id: 'L1', status: 'playing', gameMode: 'classic', currentTurnIndex: 0,
      isValidating: false, turnExpiresAt: Date.now() + 60000, timerMultiplier: 0,
      chain: [{ playerId: 'sock-b', playerName: 'Ben', movie: { id: 1, title: 'First', year: '2000', cast: [{ id: 42, name: 'Shared' }], mediaType: 'movie' }, matchedActors: [] }],
      usedMovies: ['movie:1'], previousSharedActors: [], hardcoreMode: false,
      spectators: [], allowTvShows: false, isPublic: false, currentTurnRetries: 0,
      players: [
        { id: 'sock-1', name: 'Sub', isHost: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 'k_s' },
        { id: 'sock-x', name: 'Xena', isHost: false, isAlive: true, connected: true, score: 0, wins: 0, teamId: 1, stableId: 'k_x' },
        { id: 'sock-b', name: 'Ben', isHost: false, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 'k_b' },
      ],
    });
    // Direct-ID resolve for the submitted movie; its credits share actor 42
    // with the chain head, so the play validates.
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 2, title: 'Second', release_date: '2005-01-01', poster_path: null }) });
    redisUtils.getOrFetchCredits.mockResolvedValue({ cast: [{ id: 42, name: 'Shared' }, { id: 7, name: 'Other' }] });

    // The pipeline's reads are: (1) pre-lock quick-reject, (2) in-lock
    // validation-flag commit, (3) the post-enrich snapshot the play is
    // validated against, (4) the in-lock success commit. Land the concurrent
    // lobbymut write (a non-current quit marking Xena dead) right AFTER read
    // #3 — the snapshot now predates it, the exact audit P1-3 window.
    h.injectAfterRead = {
      afterRead: 3,
      fn: () => h.mutateStore('L1', (r) => { r.players[1].isAlive = false; }),
    };

    await matchSystem.submitMovie(ctx, { id: 'sock-1', emit: jest.fn() }, { lobbyId: 'L1', movie: 'Second', tmdbId: 2, mediaType: 'movie' });

    const final = h.snapshot('L1');
    // Pre-T2b the success save was the stale post-enrich snapshot: Xena came
    // back to life. The commit must re-read fresh and keep her dead.
    expect(final.players[1].isAlive).toBe(false);
    // The submitted move still applied on that same fresh room...
    expect(final.chain).toHaveLength(2);
    expect(final.chain[1].movie.id).toBe(2);
    expect(final.usedMovies).toContain('movie:2');
    // ...the submitter scored, and the turn advanced PAST the dead player.
    expect(final.players[0].score).toBe(100);
    expect(final.currentTurnIndex).toBe(2);
    // The validation flag is released for the next turn.
    expect(final.isValidating).toBe(false);
    // No save anywhere in the pipeline may bypass the mutex — this catches
    // the validation-flag write and any failure-path save too.
    expect(h.nakedSaves).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T2a — the eliminate/advance tail commits under lobbymut
// ---------------------------------------------------------------------------
describe('T2a — eliminate/advance tail commits under lobbymut', () => {
  // armTurnTimeout fires post-commit on the still-playing path — never leak
  // its real timer past the test.
  afterEach(() => gameLogic.clearTurnTimeout('L1'));

  // 3 players so an elimination leaves the game running (turn must advance,
  // not finish) — the advance is part of the tail under test.
  function playingRoom() {
    return {
      id: 'L1', status: 'playing', gameMode: 'classic', currentTurnIndex: 0,
      isValidating: false, turnExpiresAt: Date.now() - 1000, timerMultiplier: 0,
      chain: [{ playerId: 'sock-b', playerName: 'Ben', movie: { id: 1, title: 'First', year: '2000', cast: [{ id: 42, name: 'Shared' }], mediaType: 'movie' }, matchedActors: [] }],
      usedMovies: ['movie:1'], previousSharedActors: [], hardcoreMode: false,
      spectators: [], allowTvShows: false, isPublic: false,
      players: [
        { id: 'sock-v', name: 'Vic', isHost: true, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 'k_v' },
        { id: 'sock-b', name: 'Ben', isHost: false, isAlive: true, connected: true, score: 0, wins: 0, teamId: 1, stableId: 'k_b' },
        { id: 'sock-c', name: 'Cat', isHost: false, isAlive: true, connected: true, score: 0, wins: 0, teamId: 0, stableId: 'k_c' },
      ],
    };
  }

  test('an equipped-title write landing mid-aftercare survives the elimination commit', async () => {
    const h = makeStoreHarness();
    const { io, emits } = mkIo();
    h.seed('L1', playingRoom());
    // The submit-lock holder's STALE snapshot — read before the title write.
    const staleSnapshot = h.snapshot('L1');
    // Concurrent lobbymut writer (setEquippedTitle) commits DURING the long
    // aftercare await — the exact ~1.2s _computeCouldHavePlayed window the
    // audit flagged. The spy stands in for the slow TMDB work itself.
    jest.spyOn(matchSystem, '_computeCouldHavePlayed').mockImplementation(async () => {
      h.mutateStore('L1', (r) => { r.players[1].titleLabel = 'Cinephile'; });
      return [{ title: 'Speed', year: '1994', viaActor: 'Shared' }];
    });

    await gameLogic.eliminateCurrentPlayer(io, {}, 'L1', staleSnapshot, 'Turn timed out');

    const final = h.snapshot('L1');
    // Pre-T2a the tail saved the stale snapshot and ERASED the title; the
    // commit must re-read fresh under lobbymut and preserve it.
    expect(final.players[1].titleLabel).toBe('Cinephile');
    // The elimination itself still applied on that same fresh room...
    expect(final.players[0].isAlive).toBe(false);
    // ...the turn advanced to the next live player...
    expect(final.currentTurnIndex).toBe(1);
    // ...and the timed-out human still got their private learning card.
    expect(emits.some(e => e.ev === 'youWereEliminated' && e.id === 'sock-v')).toBe(true);
    // No save may bypass the mutex anywhere in the eliminate tail.
    expect(h.nakedSaves).toEqual([]);
  });

  test('elimination declines on fresh re-verify when the turn already moved on', async () => {
    const h = makeStoreHarness();
    const { io, emits } = mkIo();
    h.seed('L1', playingRoom());
    const staleSnapshot = h.snapshot('L1');
    // Aftercare stub — this test pins the verify, not the suggestion engine.
    jest.spyOn(matchSystem, '_computeCouldHavePlayed').mockResolvedValue(null);
    // A previous lock holder advanced the turn after our snapshot was taken:
    // "the current player" is now Ben, not Vic.
    h.mutateStore('L1', (r) => { r.currentTurnIndex = 1; });

    await gameLogic.eliminateCurrentPlayer(io, {}, 'L1', staleSnapshot, 'Turn timed out');

    const final = h.snapshot('L1');
    // Eliminating off the stale view would kill the WRONG player — the fresh
    // re-verify must decline instead: nobody dies, nothing is announced.
    expect(final.players.every(p => p.isAlive)).toBe(true);
    expect(emits.some(e => e.ev === 'notification' && e.payload?.kind === 'elimination')).toBe(false);
  });
});
