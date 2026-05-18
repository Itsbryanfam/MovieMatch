// public/js/ui/name-prompts.js
//
// WHY (Phase 7.3 MI-02): the 3 name overlays' app-specific config — titles,
// fields, and the exact submit side-effect chains — extracted as PURE,
// deps-injected builders. This is the project's established seam pattern
// (daily-name-prompt.test.js:13-15): app.js's socket-heavy DOMContentLoaded
// is not unit-testable, so the testable logic is pulled into a pure module
// and app.js becomes thin glue. The builders return plain config consumed
// by createPromptModal; they never touch sockets/DOM directly (deps are
// injected) so their side-effect order is pinned by unit tests, which is
// what guarantees the zero-behaviour-change refactor.

// showNamePrompt — invite-link join (room code known, name unknown).
// Legacy order preserved EXACTLY: setItem → playerNameInput → overlay.remove
// (close) → showScreen → emit joinLobby → history.replaceState.
export function buildNamePromptConfig({ roomCode, deps }) {
  return {
    title: 'Join Game',
    subtitle: 'Room ' + roomCode,
    fields: [{ placeholder: 'Enter your name', maxLength: 24, gap: '1rem' }],
    primary: {
      label: 'Join Game',
      onSubmit([rawName], { invalid, close }) {
        const name = rawName.trim();
        if (!name) { invalid(0); return; } // legacy: cue + keep open, no effects
        deps.localStorage.setItem('mm_playerName', name);
        const pn = deps.getPlayerNameInput();
        if (pn) pn.value = name;
        close(); // == legacy overlay.remove()
        deps.showScreen('lobby');
        deps.socket.emit('joinLobby', {
          name, lobbyId: roomCode, stableId: deps.getStableId(),
        });
        deps.history.replaceState({}, '', deps.getPathname());
      },
    },
    closeOnBackdrop: false, // legacy showNamePrompt had NO backdrop escape
    focusDelayMs: 100,
  };
}

// showJoinPrompt — manual join (name + optional room code).
export function buildJoinPromptConfig({ deps }) {
  const prefill = deps.localStorage.getItem('mm_playerName') || '';
  return {
    title: 'Join a Room', // no subtitle → factory applies --solo title spacing
    fields: [
      { label: 'Your Name', placeholder: 'Enter your name', value: prefill, maxLength: 24, gap: '1rem' },
      { label: 'Room Code', placeholder: 'Leave blank to create new', maxLength: 6, uppercase: true, gap: '1.5rem' },
    ],
    primary: {
      label: 'Join Game',
      onSubmit([rawName, rawCode], { invalid, close }) {
        const name = rawName.trim();
        const code = rawCode.trim().toUpperCase(); // legacy uppercased the code
        if (!name) { invalid(0); return; }
        deps.localStorage.setItem('mm_playerName', name);
        const pn = deps.getPlayerNameInput();
        if (pn) pn.value = name;
        close();
        deps.prepareAudio(); // legacy: prepareAudio BEFORE showScreen/emit
        deps.showScreen('lobby');
        deps.socket.emit('joinLobby', {
          name, lobbyId: code, stableId: deps.getStableId(),
        });
      },
    },
    secondary: { label: 'Back', onClick({ close }) { close(); } },
    closeOnBackdrop: true,
    focusDelayMs: 100,
    // legacy: focus the code field if the name was prefilled, else the name.
    focusIndex: prefill ? 1 : 0,
  };
}

// showDailyNamePrompt — HL-01 socket-free seam: caller owns the emit via
// onConfirm. Class names are a test contract (daily-name-prompt.test.js).
export function buildDailyPromptConfig({ prefill = '', onConfirm } = {}) {
  return {
    overlayClass: 'daily-name-overlay',
    title: '🗓️ Daily Challenge',
    subtitle: 'Pick a name to track your score on the daily leaderboard.',
    fields: [{ placeholder: 'Enter your name', value: prefill || '', maxLength: 24, gap: '1rem' }],
    primary: {
      label: 'Start Daily Challenge',
      className: 'daily-name-go',
      onSubmit([rawName], { invalid, close }) {
        const name = rawName.trim();
        if (!name) { invalid(0); return; }
        close();
        if (onConfirm) onConfirm(name); // socket-free — caller emits
      },
    },
    secondary: { label: 'Maybe later', className: 'daily-name-cancel', onClick({ close }) { close(); } },
    closeOnBackdrop: true,
    focusDelayMs: 0, // no entrance transition → focus synchronously
  };
}
