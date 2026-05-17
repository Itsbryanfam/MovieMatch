// ui.js — barrel. WHY: ui.js grew to 1734 lines; it is now split into
// focused public/js/ui/* modules. This barrel re-exports every prior
// symbol so existing importers (app.js, socketClient.js, client-tests/*)
// keep `import { … } from './ui.js'` working byte-for-byte — the split
// is a pure internal reorganisation with zero consumer changes.
export * from './ui/ui-dom.js';
export * from './ui/ui-render.js';
export * from './ui/ui-notifications.js';
export * from './ui/ui-autocomplete.js';
export * from './ui/ui-sharecard.js';
export * from './ui/ui-panels.js';
