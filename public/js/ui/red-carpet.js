// ui/red-carpet.js — pure Red Carpet Lobby seams. Phase 7.5 (Red Carpet
// Lobby). WHY: 7.5 turns the waiting room into a theatrical pre-show. The
// only real logic — which players are *newly arriving* (so the entrance
// animation fires once, not on every idempotent renderLobby re-run), a
// device-local deterministic per-player accent, and the re-voiced
// Roll-Camera start gating — is isolated here as pure, zero-import,
// unit-testable functions (7.2/7.3/7.4 pure-seam discipline); renderLobby
// stays thin glue. Nothing here touches the DOM, the socket, the server,
// localStorage, or any persistent id. The per-player accent has two
// device-local keys: the COLOUR (accentHue) is the room seat SLOT only
// (Phase 7.5.1 — zero identity), and the EMOJI is the room-scoped
// name+':'+socket-id. NEITHER ever involves stableId, so the Phase-1
// daily-leaderboard leak fix is structurally preserved.

// WHY a frozen single-Unicode-scalar film-emoji set: each entry is ONE
// scalar (no variation-selector / ZWJ / skin-tone sequence) so length,
// indexing and cross-platform rendering are predictable. Tests pin
// length/membership/determinism; the specific glyph at a specific index is
// deliberately NOT asserted (cosmetic — over-pinning makes the suite
// brittle, the 7.4 review lesson). Exported so the test can assert
// membership/frozenness without re-hardcoding glyphs.
export const ACCENT_EMOJI = Object.freeze([
  '🎬', '🍿', '🌟', '🎭', '🎪', '🎨', '🚀', '👽', '🦄', '🐉', '🎸', '🦸',
]);

// Phase 7.5.1 (Seat-Table redesign): the per-player accent COLOUR is no
// longer a djb2-hash hue. The 7.5 hash%360 collided for distinct identities
// (two bots rendered the same colour on the live site). It is now a SEAT
// slot index into this frozen 8-entry palette, so for any real lobby (the
// server caps it at 8 = host + 7) every player gets a guaranteed-distinct,
// well-separated hue. WHY hues only (not full colours): the existing
// .entrance-card CSS already wraps the value as `hsl(var(--card-accent),
// 60%, 60%)`, so keeping the contract a bare hue integer is the minimal,
// lowest-risk change. The 8 values are perceptually spread around the wheel;
// tests pin length/range/distinctness/frozenness/determinism, NOT the
// specific hue at a specific index (the 7.5 ACCENT_EMOJI over-pinning
// lesson). Colour now reads ZERO identity — a strict strengthening of the
// no-stableId invariant.
export const SEAT_HUES = Object.freeze([350, 25, 45, 140, 188, 220, 270, 312]);

/**
 * Pure arrival diff. Given the ids already shown this page session and the
 * current player list, returns which ids are NEW (play the entrance
 * animation) and the new acknowledged roster.
 *
 * WHY `seen` = the CURRENT roster (not an ever-growing union): socket ids
 * rotate per connection, so a leave→rejoin yields a NEW id and SHOULD
 * legitimately re-animate; pinning `seen` to the present roster also keeps
 * the set bounded. A still-present-but-disconnected player keeps the same
 * id (disconnect grace keeps them in `players`) so they are NOT re-animated.
 * Pure: never mutates the inputs.
 */
export function diffArrivals(seenIds, players) {
  const seenSet = seenIds instanceof Set
    ? seenIds
    : new Set(Array.isArray(seenIds) ? seenIds : []);
  const list = Array.isArray(players) ? players : [];
  const entering = [];
  const seen = [];
  for (const p of list) {
    // WHY `=== undefined || === null` (NOT a falsy check): a defined non-null
    // id of `0` or `''` is treated as a VALID id and is NOT skipped. Socket
    // ids are always non-empty strings in this codebase; this comment pins the
    // chosen guard semantics so a future reader doesn't "fix" it to falsy.
    if (!p || p.id === undefined || p.id === null) continue;
    const id = p.id;
    seen.push(id);
    if (!seenSet.has(id)) entering.push(id);
  }
  return { entering, seen };
}

// WHY djb2: a tiny, well-known, well-distributed string hash. Pinned
// EXACTLY so the per-player accent is deterministic and reproducible (tests
// assert stability/range; a reviewer can reproduce it). 32-bit via |0,
// read unsigned via >>> 0.
function _djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (((h << 5) + h) + str.charCodeAt(i)) | 0; // h * 33 + c, kept 32-bit
  }
  return h >>> 0;
}

/**
 * Phase 7.8b — unified pure per-seat model for both classic AND team mode.
 *
 * WHY ONE seam not two: the seat <li> shape is identical in both modes
 * (nameplate / crown / you-pill / bot-pill / avatar / kick). Only the
 * color treatment differs — classic has a per-seat SEAT_HUES slot hue
 * (with optional pick-your-own override), team has a single per-team
 * color. The pre-existing playerCardModel is now a thin wrapper around
 * seatModel({...opts, mode:'classic'}), preserving its byte-identical
 * contract for every existing consumer (sentinel-tested + the unedited
 * red-carpet.test.js suite is the proof).
 *
 * ZERO-stableId discipline: same as playerCardModel — reads no persistent
 * identifier. Sentinel-tested.
 *
 * opts.mode === 'classic' → fields: name, isHost, isYou, isBot, wins, label,
 *   accentHue, accentEmoji, hasPickedColor.
 * opts.mode === 'team'    → fields: name, isHost, isYou, isBot, wins, label,
 *   team, accentEmoji.
 */
export function seatModel(player, opts) {
  const p = player || {};
  const o = opts || {};
  // WHY default to 'classic': every caller that omits mode gets classic
  // behaviour — seatModel is fully backwards-compatible as a drop-in.
  const mode = o.mode === 'team' ? 'team' : 'classic';
  const myPlayerId = o.myPlayerId;

  const name = String(p.name == null ? '' : p.name);
  const id = String(p.id == null ? '' : p.id);
  const isHost = !!p.isHost;
  // WHY exact `===` mirror of pre-7.5 ui-render.js:63 (not a != null guard):
  // behaviour-identical label for every real (id, myPlayerId) pair.
  const isYou = p.id === myPlayerId;
  const isBot = !!p.isBot;
  // WHY same guard as playerCardModel: maps malformed wins to 0 (strict
  // intentional superset of pre-7.5 behaviour — byte-identical for real data).
  const wins = (Number.isFinite(p.wins) && p.wins > 0) ? p.wins : 0;

  // Accent emoji unchanged from playerCardModel (room-scoped name+':'+id hash
  // ONLY — NEVER stableId). Shared by both modes as a secondary visual cue.
  const hash = _djb2(name + ':' + id);
  const accentEmoji = ACCENT_EMOJI[hash % ACCENT_EMOJI.length];

  let label = name;
  if (isYou) label += ' (You)';
  if (isHost) label += ' 👑';
  if (wins > 0) label += ` • ${wins} 🏆`;

  const base = { name, isHost, isYou, isBot, wins, accentEmoji, label };

  if (mode === 'team') {
    // Team mode: single team color per side — no per-seat hue, no color pick.
    // WHY defensive collapse to 'red': only 'red'/'blue' are valid team ids;
    // anything else degrades gracefully without throwing. Server cannot emit a
    // third team id so the branch is unreachable in real data but pinned for
    // safety. No accentHue, no hasPickedColor on the returned object.
    const team = o.team === 'blue' ? 'blue' : 'red';
    return { ...base, team };
  }

  // Classic mode: per-seat SEAT_HUES slot hue with optional pick-your-color
  // override. Defensive layers (Number.isInteger + double-modulo) preserved
  // verbatim from the pre-7.8b playerCardModel body.
  // WHY Number.isInteger guard: collapses a non-finite / non-integer /
  // absent / null-opts slot to 0. WHY double-modulo: wraps a NEGATIVE integer
  // into range. Together they always yield a valid in-range index (never
  // undefined, never throws). >7 is unreachable (server caps lobby at 8) but
  // degrades gracefully.
  const rawSlot = Number.isInteger(o.slot) ? o.slot : 0;
  const slotHue =
    SEAT_HUES[((rawSlot % SEAT_HUES.length) + SEAT_HUES.length) % SEAT_HUES.length];
  // WHY hasPickedColor check: an explicitly-claimed, in-palette colorHue
  // overrides the slot default (Phase 7.5.3 pick-your-own-colour). Anything
  // else (absent / non-int / off-palette) falls back to the collision-free
  // slot hue. ZERO identity: colorHue is a frozen-palette integer, NEVER
  // derived from stableId/name/socket-id (sentinel-tested).
  const hasPickedColor =
    Number.isInteger(p.colorHue) && SEAT_HUES.includes(p.colorHue);
  const accentHue = hasPickedColor ? p.colorHue : slotHue;

  return { ...base, accentHue, hasPickedColor };
}

/**
 * Phase 7.5/7.5.1/7.5.3 pure per-player card model. Now a thin wrapper
 * around seatModel({mode:'classic',...}) — preserves the byte-identical
 * output contract for every consumer (red-carpet.test.js + the wrapper-
 * equivalence sentinel in seat-builder.test.js are the regression proof).
 *
 * `label` is byte-identical to pre-7.5 ui-render.js for the only `wins`
 * values the server ever emits — always a non-negative integer — so the
 * card's textual identity line is behaviour-equivalent today (zero copy
 * regression). The `Number.isFinite(p.wins) && p.wins > 0` guard is a
 * deliberate defensive hardening (NOT a Math.floor — pre-7.5 renders a float
 * like 2.7 verbatim, flooring would diverge): it maps malformed wins
 * (NaN / Infinity / negative / non-numeric) to "no trophy badge" instead of
 * mirroring pre-7.5's implicit coercion. For real server data the two are
 * byte-identical; this is a strict intentional superset, not an oversight.
 */
export function playerCardModel(player, opts) {
  // WHY the wrapper merges mode:'classic' last: if a caller somehow passes
  // mode in opts it is overridden, guaranteeing the wrapper is always classic.
  return seatModel(player, { ...(opts || {}), mode: 'classic' });
}

/**
 * Pure Roll-Camera start-button model. Owns the start-gating truth-table.
 *
 * WHY identical gating, re-voiced copy only: the button is enabled IFF
 * (canStart && amIHost), with canStart = solo ? players>=1 : players>=2 —
 * byte-identical to the pre-7.5 ui-render.js logic. ONLY the text changes
 * (the 7.5 premiere voice) + a variant hook for the Task-2 CSS. This makes
 * the behaviour change provably nil (same discipline as 7.4 Task 0's
 * themesSystem copy re-voice with a behavioural-contract guard).
 */
export function rollCameraLabel(args) {
  const a = args || {};
  const amIHost = !!a.amIHost;
  const mode = a.mode || 'classic';
  const playerCount = Number.isFinite(a.playerCount) ? a.playerCount : 0;
  const canStart = mode === 'solo' ? playerCount >= 1 : playerCount >= 2;

  if (canStart && amIHost) {
    return { text: '🎬 Roll Camera', disabled: false, variant: 'ready' };
  }
  if (canStart && !amIHost) {
    return { text: 'Waiting for the director…', disabled: true, variant: 'waiting-host' };
  }
  return { text: 'Waiting for the cast…', disabled: true, variant: 'waiting-cast' };
}

/**
 * Split a room code into single-character marquee cells. Pure; non-string
 * or empty → []. WHY a tested primitive even though the Task-1 glue renders
 * the marquee via CSS on the wrapper (keeping the cross-module-shared
 * `lobbyCodeDisplay.innerText` contract byte-identical for zero socket-
 * handler regression): this keeps the seam complete + symmetrical and the
 * empty/garbage cases unit-pinned for any per-cell treatment.
 */
export function marqueeSegments(code) {
  if (typeof code !== 'string' || code.length === 0) return [];
  return code.split('');
}
