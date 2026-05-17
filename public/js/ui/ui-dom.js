// ui/ui-dom.js — cached DOM element refs + initUIElements(). WHY: every
// other ui-* module imports these LIVE bindings from here so the screen/
// element refs have exactly one owner (initUIElements assigns them once;
// ES-module live bindings propagate the assignment to all importers
// including the barrel).

// ====================== UI.JS ======================
// Audit finding #9: escapeHtml import removed — all former call sites now
// build user-controlled content with createElement/textContent (structural
// DOM), so the manual-escaping helper is no longer needed in this module.

export const MODE_DESCRIPTIONS = {
    classic: 'Last player standing wins. Timer shrinks each round.',
    team: 'Teams submit back-to-back. One failure eliminates the whole team.',
    solo: 'One player vs the chain. Survive as long as you can!',
    speed: '⚡ 15 seconds flat every turn. No exceptions. Chaos guaranteed.'
};

// DOM elements
export let lobbyScreen, heroScreen, gameScreen, waitingRoom, posterCarousel;
export let playerNameInput, lobbyIdInput, joinBtn, startBtn, lobbyPlayersList;
export let lobbyCodeDisplay, lobbySettings, hardcoreToggle, tvShowsToggle, publicRoomToggle;
export let joinPanel, privatePanel, publicPanel, showPublicBtn, showPrivateBtn;
export let backToJoinBtn, backToJoinBtn2, refreshLobbiesBtn, publicLobbiesList;
export let heroPlayBtn, heroCodeBtn, heroDailyBtn, howToPlayModal, creditsModal;
export let howToPlayBtn, creditsBtn, closeHowToPlay, closeCredits;
export let gamePlayersList, chainDisplay, movieInput, submitBtn, inputArea;
export let turnIndicator, hintText, autocompleteContainer, mobileAcDropdown;
export let chatMessages, chatInput, timerBar, timeText, notificationOverlay, notificationText;
export let logo, teamScreen, modeChips, modeDescription, teamLobbyCode;
export let teamRedList, teamBlueList, joinRedBtn, joinBlueBtn, teamBackBtn, teamStartBtn, teamHint;
export let shareModal, shareCanvas, closeShareModal, downloadCardBtn, copyCardBtn;
export let leaderboardBtn, leaderboardModal, closeLeaderboard, leaderboardList;

// Initialize DOM references
export function initUIElements() {
  lobbyScreen = document.getElementById('lobby-screen');
  heroScreen = document.getElementById('hero-screen');
  gameScreen = document.getElementById('game-screen');
  waitingRoom = document.getElementById('waiting-room');
  posterCarousel = document.getElementById('poster-carousel');
  playerNameInput = document.getElementById('player-name');
  lobbyIdInput = document.getElementById('lobby-id-input');
  joinBtn = document.getElementById('join-btn');
  startBtn = document.getElementById('start-btn');
  lobbyPlayersList = document.getElementById('lobby-players');
  lobbyCodeDisplay = document.getElementById('lobby-code-display');
  lobbySettings = document.getElementById('lobby-settings');
  hardcoreToggle = document.getElementById('hardcore-toggle');
  tvShowsToggle = document.getElementById('tv-shows-toggle');
  publicRoomToggle = document.getElementById('public-room-toggle');
  joinPanel = document.getElementById('join-panel');
  privatePanel = document.getElementById('private-panel');
  publicPanel = document.getElementById('public-panel');
  showPublicBtn = document.getElementById('show-public-btn');
  showPrivateBtn = document.getElementById('show-private-btn');
  backToJoinBtn = document.getElementById('back-to-join-btn');
  backToJoinBtn2 = document.getElementById('back-to-join-btn-2');
  refreshLobbiesBtn = document.getElementById('refresh-lobbies-btn');
  publicLobbiesList = document.getElementById('public-lobbies-list');
  heroPlayBtn = document.getElementById('hero-play-btn');
  heroCodeBtn = document.getElementById('hero-code-btn');
  heroDailyBtn = document.getElementById('hero-daily-btn');
  howToPlayModal = document.getElementById('how-to-play-modal');
  creditsModal = document.getElementById('credits-modal');
  howToPlayBtn = document.getElementById('how-to-play-btn');
  creditsBtn = document.getElementById('credits-btn');
  closeHowToPlay = document.getElementById('close-how-to-play');
  closeCredits = document.getElementById('close-credits');
  gamePlayersList = document.getElementById('game-players');
  chainDisplay = document.getElementById('chain-display');
  movieInput = document.getElementById('movie-input');
  submitBtn = document.getElementById('submit-btn');
  inputArea = document.getElementById('input-area');
  turnIndicator = document.getElementById('turn-indicator');
  hintText = document.getElementById('hint-text');
  autocompleteContainer = document.getElementById('autocomplete-container');
  mobileAcDropdown = document.getElementById('mobile-ac-dropdown');
  chatMessages = document.getElementById('chat-messages');
  chatInput = document.getElementById('chat-input');
  timerBar = document.getElementById('timer-bar');
  timeText = document.getElementById('time-text');
  notificationOverlay = document.getElementById('notification-overlay');
  notificationText = document.getElementById('notification-text');
  logo = document.querySelector('.logo');
  teamScreen = document.getElementById('team-screen');
  modeChips = document.querySelectorAll('.mode-chip');
  modeDescription = document.getElementById('mode-description');
  teamLobbyCode = document.getElementById('team-lobby-code');
  teamRedList = document.getElementById('team-red-list');
  teamBlueList = document.getElementById('team-blue-list');
  joinRedBtn = document.getElementById('join-red-btn');
  joinBlueBtn = document.getElementById('join-blue-btn');
  teamBackBtn = document.getElementById('team-back-btn');
  teamStartBtn = document.getElementById('team-start-btn');
  teamHint = document.getElementById('team-hint');
  shareModal = document.getElementById('share-modal');
  shareCanvas = document.getElementById('share-canvas');
  closeShareModal = document.getElementById('close-share-modal');
  downloadCardBtn = document.getElementById('download-card-btn');
  copyCardBtn = document.getElementById('copy-card-btn');

  leaderboardBtn = document.getElementById('leaderboard-btn');
  leaderboardModal = document.getElementById('leaderboard-modal');
  closeLeaderboard = document.getElementById('close-leaderboard');
  leaderboardList = document.getElementById('leaderboard-list');
}

// Shared low-level DOM helper used by ui-render (chain board) and
// ui-autocomplete (suggestion items) — and available to any future ui-*
// module. Lives here (the DOM-primitives leaf) so neither render nor
// autocomplete depends on the other.
// WHY: attaching a poster fallback is a pure DOM operation with no
// game-state or render dependency; placing it in ui-render would force
// ui-autocomplete to pull in render's whole transitive closure for a
// 10-line helper, creating a bad sideways coupling.
export function attachPosterFallback(img, posterClass) {
  img.onerror = () => {
    // Guard against re-entrancy: once swapped there's no <img> to error again.
    if (!img.parentNode) return;
    const placeholder = document.createElement('div');
    placeholder.className = posterClass + ' placeholder';
    img.replaceWith(placeholder);
  };
}
