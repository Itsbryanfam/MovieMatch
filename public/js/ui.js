// ui.js — barrel. WHY: ui.js grew to 1734 lines; it is now split into
// focused public/js/ui/* modules. This barrel re-exports every prior
// symbol so existing importers (app.js, socketClient.js, client-tests/*)
// keep `import { … } from './ui.js'` working byte-for-byte — the split
// is a pure internal reorganisation with zero consumer changes.
export * from './ui/ui-dom.js';
export * from './ui/ui-render.js';
export * from './ui/ui-notifications.js';
export * from './ui/feedback.js';   // Phase 7.2: feedback router (toast/gameEvent/submissionPill)
export * from './ui/modal.js';   // Phase 7.3: shared prompt-modal factory (MI-02)
export * from './ui/name-prompts.js';   // Phase 7.3: per-prompt config builders (MI-02)
export * from './ui/timer-panic.js';   // Phase 7.4: pure timer-severity seam (Panic Timer)
export * from './ui/daily-ritual.js';   // Phase 7.4: pure daily-ritual seams (countdown + streak)
export * from './ui/red-carpet.js';   // Phase 7.5: pure Red Carpet seams (arrival diff / card model / Roll-Camera gating / marquee)
export * from './ui/ui-autocomplete.js';
export * from './ui/ui-sharecard.js';
export * from './ui/ui-panels.js';
export * from './ui/recap-player.js';   // Phase 7.6: Chain Premiere Recap driver (playRecap/cancelRecap)
export * from './ui/turn-motion.js';   // Phase 7.7: pure per-turn motion timeline + clutch-save predicate
export * from './ui/hero-puzzle.js';   // Phase 7.9: pure Playable Hero seam (bank + picker + classifier)
