// public/js/ui/ui-qr.js
// Phase 7.8c — thin wrapper around the vendored qrcode-generator lib.
// Pure: takes a DOM element and a URL string, paints an SVG QR inside.
// No game-state, socket, or lobby-semantics coupling.

// Renders the QR. Memoized via mountEl.dataset.qrUrl — if the URL matches
// the last-rendered URL on this mount node, the encode is skipped.
// Silent no-op when window.qrcode is missing (vendored lib failed to load,
// e.g. offline PWA cold-start). The room code text is the existing fallback.
export function renderQR(mountEl, joinUrl) {
  if (typeof window.qrcode !== 'function') return;
  if (mountEl.dataset.qrUrl === joinUrl) return;

  // qrcode(typeNumber, errorCorrectionLevel):
  // - typeNumber=0 → lib chooses the smallest QR symbol that fits the data
  // - 'M'          → ~15% damage tolerance; standard camera-scan default
  const qr = window.qrcode(0, 'M');
  qr.addData(joinUrl);
  qr.make();
  // createSvgTag returns an HTML string like <svg viewBox="..."><rect/>...</svg>.
  // cellSize=4 / margin=0: outer .lobby-qr-svg CSS sizes the result via viewBox
  // so the inline dimensions here don't matter.
  mountEl.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0 });
  mountEl.dataset.qrUrl = joinUrl;
}

// Empties the mount element and clears the memo cache key. Currently
// unused by render*Lobby() — kept for symmetry with renderQR and for
// future lobby-exit cleanup if it ever becomes necessary.
export function clearQR(mountEl) {
  mountEl.textContent = '';
  delete mountEl.dataset.qrUrl;
}
