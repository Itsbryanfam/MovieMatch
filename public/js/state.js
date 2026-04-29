// ============================================================================
// STATE — Client-side data layer
// ============================================================================
// Pure state management. No DOM manipulation, no socket calls.
// Single source of truth for all game state, player identity, and session data.
//
// Both socketClient.js (network) and app.js (input) import from here
// instead of passing state through getter functions.
// ============================================================================

// ---------------------------------------------------------------------------
// SESSION STATE
// ---------------------------------------------------------------------------

let socket = null;
let currentLobbyId = null;
let myPlayerId = null;
let gameState = null;
let isSpectator = false;

// ---------------------------------------------------------------------------
// TIMER STATE
// ---------------------------------------------------------------------------

let turnInterval = null;
let lastTickSound = 0;

// ---------------------------------------------------------------------------
// ACCESSORS
// ---------------------------------------------------------------------------

export function getSocket()         { return socket; }
export function getCurrentLobbyId() { return currentLobbyId; }
export function getMyPlayerId()     { return myPlayerId; }
export function getGameState()      { return gameState; }
export function getIsSpectator()    { return isSpectator; }
export function getTurnInterval()   { return turnInterval; }
export function getLastTickSound()  { return lastTickSound; }

export function setSocket(s)           { socket = s; }
export function setCurrentLobbyId(id)  { currentLobbyId = id; }
export function setMyPlayerId(id)      { myPlayerId = id; }
export function setGameState(state)    { gameState = state; }
export function setIsSpectator(val)    { isSpectator = val; }
export function setTurnInterval(ref)   { turnInterval = ref; }
export function setLastTickSound(val)  { lastTickSound = val; }

// ---------------------------------------------------------------------------
// STATE TRANSITIONS
// ---------------------------------------------------------------------------

/** Called when joining a lobby (from 'joined' socket event) */
export function onJoined(data) {
  currentLobbyId = data.lobbyId;
  myPlayerId = data.playerId;
  isSpectator = data.isSpectator || false;
  // Persist so a page refresh can attempt rejoin during the grace period
  if (!isSpectator) {
    sessionStorage.setItem('mm_lobbyId', data.lobbyId);
    sessionStorage.setItem('mm_playerId', data.playerId);
  }
}

/** Called when receiving a state update from the server */
export function onStateUpdate(state) {
  gameState = state;

  // Detect spectator promotion
  if (isSpectator && state.status === 'waiting' && state.players?.find(p => p.id === myPlayerId)) {
    isSpectator = false;
    return 'promoted'; // caller shows notification
  }
  return null;
}

/** Called when successfully reconnecting */
export function onRejoined(data) {
  currentLobbyId = data.lobbyId;
  myPlayerId = data.playerId;
  gameState = data.state;
}

/** Called when leaving a lobby (logo click or explicit leave) */
export function resetSession() {
  if (turnInterval) {
    clearInterval(turnInterval);
    turnInterval = null;
  }
  currentLobbyId = null;
  myPlayerId = null;
  gameState = null;
  isSpectator = false;
  lastTickSound = 0;
  sessionStorage.removeItem('mm_lobbyId');
  sessionStorage.removeItem('mm_playerId');
}

/** Clear the turn timer interval */
export function clearTurnTimer() {
  if (turnInterval) {
    clearInterval(turnInterval);
    turnInterval = null;
  }
}
