// url-helpers.js — shared URL construction utilities.
// WHY a separate module (not inlined in app.js): ui-render.js needs
// makeJoinUrl for QR codes (Phase 7.8c), but ui-render.js is re-exported
// by the ui.js barrel, and app.js already imports from that barrel —
// importing app.js from ui-render.js would form a cycle. Extracting to a
// leaf module breaks the cycle: both app.js and ui-render.js import from
// url-helpers.js, which imports nothing from the project.

// Phase 7.8c — single source of truth for the invite-link URL format.
// Used by:
//   - the in-game invite button (was inline in app.js)
//   - the click-to-copy on the room code (was inline in app.js)
//   - ui-render.js for the new QR codes
// Output is byte-identical to the prior inline construction.
export function makeJoinUrl(code) {
  return window.location.origin + '?room=' + code;
}
