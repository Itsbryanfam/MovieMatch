// server/constants.js
//
// Shared server-side constants. WHY: values duplicated across modules
// drift when one site is changed and the others are missed (the
// 2026-05-16 review flagged the 8-player cap living in two files with
// only a hand-written "same value used here" comment to keep them in
// sync). One source of truth removes that whole bug class.
//
// Scope (YAGNI): ONLY values genuinely duplicated across 2+ source
// files with identical meaning belong here. Timer values were reviewed
// and deliberately left out — they are either single-file named consts
// (RECONNECT_GRACE_MS in lobbySystem, TMDB/MUTEX in redisUtils) or the
// same number with *different* meaning (speed-turn 15000 vs grace
// 15000), which must NOT be collapsed.

// Hard maximum players in a single lobby. Enforced at join time
// (lobbySystem.joinLobby), used to size spectator promotion
// (gameLogic.promoteSpectators) and to filter the public-lobby list.
const MAX_PLAYERS_PER_LOBBY = 8;

// Phase 7.5.3 (Pick-Your-Own-Colour): the frozen seat-hue palette. WHY a
// server mirror: the server is CommonJS and cannot import the client ES
// module public/js/ui/red-carpet.js (line 39) where SEAT_HUES is the
// authoritative client copy. selectColor validates the requested hue
// against THIS list server-side — the setTheme whitelist precedent (a
// malicious client must not set an off-palette chair colour). This array
// MUST stay byte-identical to red-carpet.js:39; a test pins the exact
// literal on BOTH sides so an edit to either fails CI.
const SEAT_HUES = Object.freeze([350, 25, 45, 140, 188, 220, 270, 312]);

module.exports = { MAX_PLAYERS_PER_LOBBY, SEAT_HUES };
