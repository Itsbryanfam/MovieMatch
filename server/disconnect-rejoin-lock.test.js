// ============================================================================
// disconnect-rejoin-lock.test.js — T1 audit (2026-06-09), fix T1e.
// ============================================================================
// handleDisconnect (including its spectator-removal early path) and
// rejoinLobby each did an UNLOCKED getLobby → mutate → saveLobby. Disconnects
// are the single most frequent event on the site, so a concurrent locked
// write (join, submit commit, settings change) committing between that read
// and the save was silently clobbered by the full-blob overwrite. These pin
// the R1 contract for both paths: the mutation runs INSIDE withLobbyLock
// (read fresh under the lock, persist unless the mutator declines with
// false), io/timer side-effects run OUTSIDE on the room the lock returned,
// and NO saveLobby ever fires outside a lock section.
// ============================================================================

const lobbySystem = require('./systems/lobbySystem');
const redisUtils = require('./redisUtils');

jest.mock('./redisUtils');

describe('T1e — handleDisconnect + rejoinLobby mutate under withLobbyLock', () => {
  let io, ctx, store, nakedSaves, injectOnce, inLock;

  // The injected "concurrent locked writer": consumed by whichever hook runs
  // first — after an UNLOCKED lobby read (models the pre-fix race window) or
  // at lock entry (models a previous lock holder committing just before our
  // lock section, the post-fix reality the mutex serializes against).
  function consumeInjection() {
    if (injectOnce) {
      const fn = injectOnce;
      injectOnce = null;
      fn();
    }
  }

  beforeEach(() => {
    jest.clearAllMocks();
    store = new Map();
    nakedSaves = [];
    injectOnce = null;
    inLock = false;
    io = { to: jest.fn().mockReturnThis(), emit: jest.fn(), sockets: { sockets: new Map() } };
    ctx = { io, pubClient: {}, logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() } };

    redisUtils.getSocketLobby.mockResolvedValue('L1');
    redisUtils.deleteSocketLobby.mockResolvedValue(undefined);
    redisUtils.setSocketLobby.mockResolvedValue(undefined);
    redisUtils.deleteLobby.mockResolvedValue(undefined);

    // Store-backed persistence with real-Redis semantics: every getLobby
    // hands out a FRESH JSON round-trip copy, so a stale-snapshot bug is
    // observable instead of hidden by shared object identity.
    redisUtils.getLobby.mockImplementation(async (_p, id) => {
      const raw = store.get(id);
      const snapshot = raw ? JSON.parse(raw) : null;
      // Unlocked reads are exactly where the pre-fix race window opened —
      // land the concurrent write right after the snapshot was taken.
      if (!inLock) consumeInjection();
      return snapshot;
    });
    redisUtils.saveLobby.mockImplementation(async (_p, id, room) => {
      // The core T1e assertion hook: any save outside a lock section is a
      // lost-update hazard and must be flagged, not silently absorbed.
      if (!inLock) nakedSaves.push(`saveLobby(${id}) outside withLobbyLock`);
      store.set(id, JSON.stringify(room));
    });
    // Faithful withLobbyLock contract (read INSIDE the lock → mutate →
    // persist unless the mutator returned false → return the room) — same
    // shape as the socket.integration.test.js contract mock, plus the
    // lock-entry injection point: a write committed by a PREVIOUS lock
    // holder must be visible to our in-lock read. That visibility is the
    // exact property the fix buys.
    redisUtils.withLobbyLock.mockImplementation(async (pub, id, fn, opts = {}) => {
      consumeInjection(); // concurrent locked writer finished just before us
      inLock = true;
      try {
        const r = (await redisUtils.getLobby(pub, id)) || opts.seedRoom || null;
        if (!r) return null;
        const res = await fn(r);
        if (res !== false) await redisUtils.saveLobby(pub, id, r);
        return r;
      } finally {
        inLock = false;
      }
    });
  });

  // Waiting lobby: 3 humans + 1 bot. The bot sits between the host and the
  // next human ON PURPOSE — host promotion must skip it (Phase 5a rule).
  function waitingRoom() {
    return {
      id: 'L1', status: 'waiting', currentTurnIndex: 0,
      chain: [], usedMovies: [], spectators: [],
      players: [
        { id: 'sock-h', name: 'Host', isHost: true, isAlive: true, connected: true, isBot: false, stableId: 'k_h' },
        { id: 'bot-1', name: 'Bot', isHost: false, isAlive: true, connected: true, isBot: true },
        { id: 'sock-a', name: 'Ann', isHost: false, isAlive: true, connected: true, isBot: false, stableId: 'k_a' },
        { id: 'sock-b', name: 'Ben', isHost: false, isAlive: true, connected: true, isBot: false, stableId: 'k_b' },
      ],
    };
  }

  // Playing lobby with sock-a disconnected (rejoin candidate). The turn is
  // held by sock-b so the rejoin does NOT re-arm a turn watchdog — these
  // tests run real timers and must not leave one armed.
  function playingRejoinRoom() {
    return {
      id: 'L1', status: 'playing', currentTurnIndex: 2,
      chain: [], usedMovies: [], spectators: [], previousSharedActors: [],
      turnExpiresAt: Date.now() + 60000, isValidating: false, gameMode: 'classic',
      players: [
        { id: 'sock-h', name: 'Host', isHost: true, isAlive: true, connected: true, isBot: false, stableId: 'k_h' },
        { id: 'sock-a', name: 'Ann', isHost: false, isAlive: true, connected: false, isBot: false, stableId: 'k_a' },
        { id: 'sock-b', name: 'Ben', isHost: false, isAlive: true, connected: true, isBot: false, stableId: 'k_b' },
      ],
    };
  }

  function concurrentJoinInjection() {
    // A locked join committed by "someone else": adds sock-c to the
    // persisted blob. Whichever path saves a stale snapshot loses them.
    return () => {
      const r = JSON.parse(store.get('L1'));
      r.players.push({ id: 'sock-c', name: 'JustJoined', isHost: false, isAlive: true, connected: true, isBot: false, stableId: 'k_c' });
      store.set('L1', JSON.stringify(r));
    };
  }

  // -------------------------------------------------------------------------
  // handleDisconnect
  // -------------------------------------------------------------------------

  test('handleDisconnect (player path) mutates inside withLobbyLock — no naked saveLobby', async () => {
    store.set('L1', JSON.stringify(waitingRoom()));

    await lobbySystem.handleDisconnect(ctx, 'sock-a');

    expect(redisUtils.withLobbyLock).toHaveBeenCalledTimes(1);
    expect(nakedSaves).toEqual([]);
    // Waiting-state behavior preserved: the player is filtered out entirely.
    const final = JSON.parse(store.get('L1'));
    expect(final.players.some(p => p.id === 'sock-a')).toBe(false);
  });

  test('a concurrent locked write landing before the disconnect lock section is not clobbered', async () => {
    store.set('L1', JSON.stringify(waitingRoom()));
    injectOnce = concurrentJoinInjection();

    await lobbySystem.handleDisconnect(ctx, 'sock-a');

    const final = JSON.parse(store.get('L1'));
    // Pre-fix: the unlocked read snapshotted BEFORE sock-c joined and the
    // full-blob save erased them. Post-fix the in-lock read sees them.
    expect(final.players.some(p => p.id === 'sock-c')).toBe(true);
    // And the disconnect itself still applied on the same fresh room.
    expect(final.players.some(p => p.id === 'sock-a')).toBe(false);
  });

  test('host promotion still lands on the first remaining HUMAN (never the bot)', async () => {
    store.set('L1', JSON.stringify(waitingRoom()));

    await lobbySystem.handleDisconnect(ctx, 'sock-h');

    const final = JSON.parse(store.get('L1'));
    const host = final.players.find(p => p.isHost);
    // Promotion is computed INSIDE the mutator on the fresh room — the bot
    // sits first in array order and must still be skipped.
    expect(host.id).toBe('sock-a');
    expect(nakedSaves).toEqual([]);
  });

  test('spectator-removal early path also routes through the lock', async () => {
    const room = waitingRoom();
    room.spectators = [{ id: 'spec-1', name: 'Watcher', connected: true, stableId: 'k_s' }];
    store.set('L1', JSON.stringify(room));

    await lobbySystem.handleDisconnect(ctx, 'spec-1');

    expect(redisUtils.withLobbyLock).toHaveBeenCalledTimes(1);
    expect(nakedSaves).toEqual([]);
    const final = JSON.parse(store.get('L1'));
    expect(final.spectators).toHaveLength(0);
    // Spectator path must not touch players.
    expect(final.players).toHaveLength(4);
  });

  // -------------------------------------------------------------------------
  // rejoinLobby
  // -------------------------------------------------------------------------

  test('rejoinLobby mutates inside withLobbyLock — no naked saveLobby, side-effects intact', async () => {
    store.set('L1', JSON.stringify(playingRejoinRoom()));
    const socket = { id: 'sock-a2', join: jest.fn(), emit: jest.fn() };

    await lobbySystem.rejoinLobby(ctx, socket, { lobbyId: 'L1', playerId: 'sock-a', stableId: 'k_a' });

    expect(redisUtils.withLobbyLock).toHaveBeenCalledTimes(1);
    expect(nakedSaves).toEqual([]);
    // The mutation (socket-id reassign + reconnect flip) persisted.
    const final = JSON.parse(store.get('L1'));
    const p = final.players.find(pp => pp.stableId === 'k_a');
    expect(p.id).toBe('sock-a2');
    expect(p.connected).toBe(true);
    // Side-effects computed from in-lock values (closure-captured old id)
    // still all fire: room join, mapping swap, success emit.
    expect(socket.join).toHaveBeenCalledWith('L1');
    expect(redisUtils.setSocketLobby).toHaveBeenCalledWith(ctx.pubClient, 'sock-a2', 'L1');
    expect(redisUtils.deleteSocketLobby).toHaveBeenCalledWith(ctx.pubClient, 'sock-a');
    expect(socket.emit).toHaveBeenCalledWith('rejoinSuccess',
      expect.objectContaining({ lobbyId: 'L1', playerId: 'sock-a2' }));
  });

  test('a concurrent locked write landing before the rejoin lock section is not clobbered', async () => {
    store.set('L1', JSON.stringify(playingRejoinRoom()));
    injectOnce = concurrentJoinInjection();
    const socket = { id: 'sock-a2', join: jest.fn(), emit: jest.fn() };

    await lobbySystem.rejoinLobby(ctx, socket, { lobbyId: 'L1', playerId: 'sock-a', stableId: 'k_a' });

    const final = JSON.parse(store.get('L1'));
    // Pre-fix the rejoin's stale full-blob save erased sock-c's locked join.
    expect(final.players.some(p => p.id === 'sock-c')).toBe(true);
    expect(final.players.find(p => p.stableId === 'k_a').connected).toBe(true);
  });

  test('failed rejoin (stableId mismatch) declines the write — store byte-identical', async () => {
    const before = JSON.stringify(playingRejoinRoom());
    store.set('L1', before);
    const socket = { id: 'sock-x', join: jest.fn(), emit: jest.fn() };

    await lobbySystem.rejoinLobby(ctx, socket, { lobbyId: 'L1', playerId: 'sock-a', stableId: 'WRONG' });

    // Same rejection the unlocked version emitted...
    expect(socket.emit).toHaveBeenCalledWith('rejoinFailed', 'Player not found in lobby');
    // ...and the decline signal (mutator → false) means no write AT ALL: a
    // failed rejoin must not even rewrite an identical blob (that save would
    // still race a concurrent locked writer).
    expect(store.get('L1')).toBe(before);
    expect(socket.join).not.toHaveBeenCalled();
  });
});
