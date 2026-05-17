// sw-routing.js — pure SW request-routing decision. UMD: attached to `self`
// (so sw.js can importScripts it) AND module.exports (so Jest can require
// it). ONE source of truth — the decision table is never duplicated.
// WHY a separate file: a classic service worker can't be imported as an ES
// module, and we still want the logic unit-tested in the jsdom project.
(function (root) {
  function swDecision(input) {
    var method = input && input.method;
    var url = input && input.url;
    var origin = input && input.origin;
    // Never cache mutations.
    if (method && method !== 'GET') return 'bypass';
    var u;
    try { u = new URL(url); } catch (e) { return 'bypass'; }
    // Never touch third-party traffic (TMDB images, Google Fonts, etc.).
    if (u.origin !== origin) return 'bypass';
    // Never touch the realtime transport — caching socket.io polling would
    // corrupt the session. (WebSocket upgrades don't fire fetch at all.)
    if (u.pathname.indexOf('/socket.io') === 0) return 'bypass';
    // Everything else same-origin GET (navigations + static): network-first
    // so a deploy is picked up immediately; cache is only an offline net.
    return 'network-first';
  }
  root.swDecision = swDecision;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { swDecision: swDecision };
  }
})(typeof self !== 'undefined' ? self : this);
