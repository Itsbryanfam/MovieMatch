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
