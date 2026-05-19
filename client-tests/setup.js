// Stub AudioContext — jsdom doesn't ship it, but utils.js constructs one
// when sounds play. The render-chain tests trigger playSuccess() as a
// side effect of appending a chain item, so we need a no-op stub.
class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.destination = {};
    this.state = 'running';
  }
  createOscillator() {
    return {
      type: '',
      frequency: { setValueAtTime() {} },
      connect() {},
      start() {},
      stop() {},
    };
  }
  createGain() {
    return {
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {},
    };
  }
  resume() {
    return Promise.resolve();
  }
}

window.AudioContext = FakeAudioContext;
window.webkitAudioContext = FakeAudioContext;

// Stub clipboard so the in-game invite button test (and any other clipboard
// callers) doesn't blow up — jsdom omits navigator.clipboard.
if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: () => Promise.resolve(),
      write: () => Promise.resolve(),
    },
    configurable: true,
  });
}

// jsdom doesn't implement Element.scrollIntoView. ui.js calls it inside the
// player-sidebar render to keep the active turn's row visible. Without the
// stub, any test that triggers a render of the game screen (e.g. the timer-bar
// regression test) throws "scrollIntoView is not a function" inside a
// setTimeout callback and crashes the test runner instead of failing cleanly.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

// Phase 7.6 Task 2: jsdom has no canvas rendering engine — getContext('2d')
// returns null by default, causing generateShareCard to throw when it sets
// ctx.fillStyle. Stub a minimal no-op 2D context so the canvas-path tests
// verify the function returns a canvas element without needing pixel layout
// (the visual correctness is the user-side eyeball, per spec §5).
// WHY additive here (not jest-canvas-mock): avoids a new dev-dependency;
// all we need is that draw calls don't throw, not that they produce pixels.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function (type) {
    if (type !== '2d') return null;
    const noop = () => {};
    const noopReturn = () => ({
      setValueAtTime: noop, addColorStop: noop,
    });
    return {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textBaseline: '',
      textAlign: '',
      fillRect: noop,
      strokeRect: noop,
      clearRect: noop,
      fillText: noop,
      strokeText: noop,
      measureText: () => ({ width: 0 }),
      beginPath: noop,
      closePath: noop,
      moveTo: noop,
      lineTo: noop,
      arcTo: noop,
      stroke: noop,
      fill: noop,
      drawImage: noop,
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
      save: noop,
      restore: noop,
      scale: noop,
      rotate: noop,
      translate: noop,
      clip: noop,
      setTransform: noop,
    };
  };
}
