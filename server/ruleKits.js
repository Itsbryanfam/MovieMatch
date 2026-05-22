// server/ruleKits.js — Phase 6c Constrained Custom Rule Kits catalog.
// SERVER-AUTHORITATIVE single source (CommonJS), mirroring server/heroPuzzle.js
// and the themesSystem.listThemes()→client pattern. Each kit is a named PRESET
// composing the EXISTING room rule fields (theme + gameMode + the two boolean
// toggles). No new rule pipeline: lobbySystem.selectRuleKit looks a kit up
// here and writes the same fields setTheme/setGameMode/toggleSetting already
// write, validated against the same whitelists. The client gets only the
// display shape (listKits) to render chips, and echoes a kitId back.
const RULE_KITS = Object.freeze([
  Object.freeze({ id: 'date_night',        label: 'Date Night',        icon: '💘', theme: 'romance',      mode: 'classic', hardcore: false, tvShows: false }),
  Object.freeze({ id: 'after_dark',        label: 'After Dark',        icon: '🎃', theme: 'horror',       mode: 'classic', hardcore: false, tvShows: false }),
  Object.freeze({ id: 'hardcore_sprint',   label: 'Hardcore Sprint',   icon: '🔥', theme: 'any',         mode: 'speed',   hardcore: true,  tvShows: false }),
  Object.freeze({ id: 'decade_drift',      label: 'Decade Drift',      icon: '📼', theme: 'decade_1990s', mode: 'classic', hardcore: false, tvShows: false }),
  Object.freeze({ id: 'saturday_cartoons', label: 'Saturday Cartoons', icon: '🎨', theme: 'animation',    mode: 'classic', hardcore: false, tvShows: true }),
  Object.freeze({ id: 'classic_open',      label: 'Classic Open',      icon: '🎬', theme: 'any',         mode: 'classic', hardcore: false, tvShows: false }),
]);

// Look up a kit by id, or null. Used by the selectRuleKit handler.
function getKit(kitId) {
  return RULE_KITS.find(k => k.id === kitId) || null;
}

// Display shape for the client chip strip (id + label + icon only). Mirrors
// themesSystem.clientShape — the client never needs the rule fields (the
// server applies them authoritatively in selectRuleKit).
function listKits() {
  return RULE_KITS.map(k => ({ id: k.id, label: k.label, icon: k.icon }));
}

module.exports = { RULE_KITS, getKit, listKits };
