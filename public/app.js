const socket = io();

function escapeHtml(unsafe) {
  if (!unsafe || typeof unsafe !== 'string') return unsafe;
  return unsafe.replace(/[<>&"']/g, m => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;','\'':'&#39;'})[m]);
}

// UI Elements
const lobbyScreen = document.getElementById('lobby-screen');
const heroScreen = document.getElementById('hero-screen');
const gameScreen = document.getElementById('game-screen');
const waitingRoom = document.getElementById('waiting-room');
const lobbyPanel = document.querySelector('.lobby-panel');
const posterCarousel = document.getElementById('poster-carousel');

const playerNameInput = document.getElementById('player-name');
const lobbyIdInput = document.getElementById('lobby-id-input');
const joinBtn = document.getElementById('join-btn');
const startBtn = document.getElementById('start-btn');
const lobbyPlayersList = document.getElementById('lobby-players');
const lobbyCodeDisplay = document.getElementById('lobby-code-display');
const lobbySettings = document.getElementById('lobby-settings');
const hardcoreToggle = document.getElementById('hardcore-toggle');
const tvShowsToggle = document.getElementById('tv-shows-toggle');
const publicRoomToggle = document.getElementById('public-room-toggle');

const joinPanel = document.getElementById('join-panel');
const privatePanel = document.getElementById('private-panel');
const publicPanel = document.getElementById('public-panel');
const showPublicBtn = document.getElementById('show-public-btn');
const showPrivateBtn = document.getElementById('show-private-btn');
const backToJoinBtn = document.getElementById('back-to-join-btn');
const backToJoinBtn2 = document.getElementById('back-to-join-btn-2');
const refreshLobbiesBtn = document.getElementById('refresh-lobbies-btn');
const publicLobbiesList = document.getElementById('public-lobbies-list');

const heroPlayBtn = document.getElementById('hero-play-btn');
const heroCodeBtn = document.getElementById('hero-code-btn');

const howToPlayModal = document.getElementById('how-to-play-modal');
const creditsModal = document.getElementById('credits-modal');
const howToPlayBtn = document.getElementById('how-to-play-btn');
const creditsBtn = document.getElementById('credits-btn');
const closeHowToPlay = document.getElementById('close-how-to-play');
const closeCredits = document.getElementById('close-credits');

const gamePlayersList = document.getElementById('game-players');
const chainDisplay = document.getElementById('chain-display');
const movieInput = document.getElementById('movie-input');
const submitBtn = document.getElementById('submit-btn');
const inputArea = document.getElementById('input-area');
const turnIndicator = document.getElementById('turn-indicator');
const hintText = document.getElementById('hint-text');
const autocompleteContainer = document.getElementById('autocomplete-container');
const mobileAcDropdown = document.getElementById('mobile-ac-dropdown');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');

const timerBar = document.getElementById('timer-bar');
const timeText = document.getElementById('time-text');
const notificationOverlay = document.getElementById('notification-overlay');
const notificationText = document.getElementById('notification-text');
const logo = document.querySelector('.logo');

// Mode selector elements
const teamScreen = document.getElementById('team-screen');
const modeChips = document.querySelectorAll('.mode-chip');
const modeDescription = document.getElementById('mode-description');
const teamLobbyCode = document.getElementById('team-lobby-code');
const teamRedList = document.getElementById('team-red-list');
const teamBlueList = document.getElementById('team-blue-list');
const joinRedBtn = document.getElementById('join-red-btn');
const joinBlueBtn = document.getElementById('join-blue-btn');
const teamBackBtn = document.getElementById('team-back-btn');
const teamStartBtn = document.getElementById('team-start-btn');
const teamHint = document.getElementById('team-hint');

// State
let myPlayerId = null;
let currentLobbyId = null;
let gameState = null;
let debounceTimeout = null;
let currentSelectedMovie = null;
let AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx;

// --- AUDIO SYNTHESIS ---
function playTone(frequency, type, duration) {
    if (!audioCtx) audioCtx = new AudioCtx();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime);
    
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + duration);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + duration);
}

function playSuccess() {
    playTone(600, 'sine', 0.1);
    setTimeout(() => playTone(800, 'sine', 0.2), 100);
}

function playFail() {
    playTone(300, 'sawtooth', 0.3);
    setTimeout(() => playTone(250, 'sawtooth', 0.4), 150);
}

function playTick() {
    playTone(1000, 'square', 0.05);
}

// --- INITIALIZATION ---

logo.addEventListener('click', () => {
    if (currentLobbyId) {
        socket.emit('leaveLobby');
        currentLobbyId = null;
        gameState = null;
        myPlayerId = null;
    }
    
    gameScreen.classList.remove('active');
    lobbyScreen.classList.remove('active');
    heroScreen.classList.add('active');
    
    waitingRoom.classList.add('hidden');
    if(privatePanel) privatePanel.classList.add('hidden');
    if(publicPanel) publicPanel.classList.add('hidden');
    if(joinPanel) joinPanel.classList.remove('hidden');
});

function prepareAudio() {
    if (!audioCtx) audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

// --- PERSISTENT NICKNAME ---
const savedName = localStorage.getItem('mm_playerName');
if (savedName) playerNameInput.value = savedName;
playerNameInput.addEventListener('input', () => {
    localStorage.setItem('mm_playerName', playerNameInput.value.trim());
});

function checkName() {
    const name = playerNameInput.value.trim();
    if (!name) {
        alert('Enter a name first!');
        return false;
    }
    return true;
}

showPrivateBtn.addEventListener('click', () => {
    if (!checkName()) return;
    prepareAudio();
    joinPanel.classList.add('hidden');
    privatePanel.classList.remove('hidden');
});

showPublicBtn.addEventListener('click', () => {
    if (!checkName()) return;
    prepareAudio();
    joinPanel.classList.add('hidden');
    publicPanel.classList.remove('hidden');
    socket.emit('requestPublicLobbies');
});

backToJoinBtn.addEventListener('click', () => {
    privatePanel.classList.add('hidden');
    joinPanel.classList.remove('hidden');
});

backToJoinBtn2.addEventListener('click', () => {
    publicPanel.classList.add('hidden');
    joinPanel.classList.remove('hidden');
});

refreshLobbiesBtn.addEventListener('click', () => {
    publicLobbiesList.innerHTML = '<div class="empty-hint" style="text-align:center; padding: 2rem; color: var(--text-muted); font-style:italic;">Loading lobbies...</div>';
    socket.emit('requestPublicLobbies');
});

joinBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    localStorage.setItem('mm_playerName', name);
    socket.emit('joinLobby', { 
        name, 
        lobbyId: lobbyIdInput.value.trim() 
    });
});

startBtn.addEventListener('click', () => {
    socket.emit('startLobby', currentLobbyId);
});

// --- HERO LOGIC & FLOW C ---

heroPlayBtn.addEventListener('click', () => {
    heroScreen.classList.remove('active');
    lobbyScreen.classList.add('active');
    prepareAudio();
});

heroCodeBtn.addEventListener('click', () => {
    heroScreen.classList.remove('active');
    lobbyScreen.classList.add('active');
    joinPanel.classList.add('hidden');
    privatePanel.classList.remove('hidden');
    lobbyIdInput.focus();
    prepareAudio();
});

// Detect room ID in URL (Flow C)
function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room') || params.get('lobby');
    if (roomId) {
        lobbyIdInput.value = roomId.toUpperCase();
        heroScreen.classList.remove('active');
        lobbyScreen.classList.add('active');
        joinPanel.classList.add('hidden');
        privatePanel.classList.remove('hidden');
        // If we have a saved name, we could even auto-focus the join button
    }
}

checkUrlParams();

// Trigger hero demo animation after short delay
window.addEventListener('DOMContentLoaded', () => {
    const heroDemo = document.querySelector('.hero-demo');
    if (heroDemo) {
        setTimeout(() => {
            heroDemo.classList.add('animate-demo');
        }, 500);
    }
});

// --- MODE SELECTOR ---
const MODE_DESCRIPTIONS = {
    classic: 'Last player standing wins. Timer shrinks each round.',
    team: 'Teams submit back-to-back. One failure eliminates the whole team.',
    solo: 'One player vs the chain. Survive as long as you can!',
    speed: '⚡ 15 seconds flat every turn. No exceptions. Chaos guaranteed.'
};

modeChips.forEach(chip => {
    chip.addEventListener('click', () => {
        const mode = chip.dataset.mode;
        socket.emit('setGameMode', { lobbyId: currentLobbyId, mode });
    });
});

// --- TEAM SCREEN ---
joinRedBtn?.addEventListener('click', () => {
    socket.emit('assignTeam', { lobbyId: currentLobbyId, teamId: 0 });
});
joinBlueBtn?.addEventListener('click', () => {
    socket.emit('assignTeam', { lobbyId: currentLobbyId, teamId: 1 });
});
teamBackBtn?.addEventListener('click', () => {
    teamScreen.classList.add('hidden');
    waitingRoom.classList.remove('hidden');
});
teamStartBtn?.addEventListener('click', () => {
    socket.emit('startLobby', currentLobbyId);
});

hardcoreToggle.addEventListener('change', (e) => {
    socket.emit('toggleHardcore', { lobbyId: currentLobbyId, state: e.target.checked });
});

if(publicRoomToggle) {
    publicRoomToggle.addEventListener('change', (e) => {
        socket.emit('togglePublic', { lobbyId: currentLobbyId, state: e.target.checked });
    });
}

tvShowsToggle.addEventListener('change', (e) => {
    socket.emit('toggleTvShows', { lobbyId: currentLobbyId, state: e.target.checked });
});

submitBtn.addEventListener('click', submitMovie);
movieInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitMovie();
});

movieInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    if (query.length < 2) {
        autocompleteContainer.innerHTML = '<div class="empty-hint">Type a movie to see suggestions...</div>';
        closeMobileAc();
        return;
    }
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
        socket.emit('autocompleteSearch', { query, lobbyId: currentLobbyId });
    }, 400);
});

chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const msg = chatInput.value.trim();
        if (msg && currentLobbyId) {
            socket.emit('sendChat', { lobbyId: currentLobbyId, msg });
            chatInput.value = '';
        }
    }
});

function closeMobileAc() {
    mobileAcDropdown.classList.remove('open');
    mobileAcDropdown.innerHTML = '';
}

function renderAutocompleteResults(results) {
    const isMobile = window.matchMedia('(max-width: 767px)').matches;
    const target = isMobile ? mobileAcDropdown : autocompleteContainer;

    if (!results || results.length === 0) {
        target.innerHTML = '<div class="empty-hint">No results found.</div>';
        if (isMobile) mobileAcDropdown.classList.add('open');
        return;
    }

    target.innerHTML = '';
    results.forEach(movie => {
        const div = document.createElement('div');
        div.className = 'autocomplete-item';
        div.setAttribute('data-tmdb-id', movie.id);
        div.setAttribute('data-media-type', movie.mediaType);
        const imgTag = movie.poster
            ? `<img src="${movie.poster}" alt="Poster" class="mini-poster">`
            : `<div class="mini-poster placeholder"></div>`;
        div.innerHTML = `
            ${imgTag}
            <div class="ac-text">
                <div class="ac-title">${movie.title}</div>
                <span class="year">(${movie.year})</span>
            </div>
        `;
        div.addEventListener('click', () => {
            const tmdbId = div.getAttribute('data-tmdb-id');
            const mediaType = div.getAttribute('data-media-type');

            if (tmdbId && mediaType) {
                socket.emit('submitMovie', { 
                    lobbyId: currentLobbyId, 
                    movie: movie.title, 
                    tmdbId: parseInt(tmdbId), 
                    mediaType: mediaType 
                });
                movieInput.value = '';
                autocompleteContainer.innerHTML = '<div class="empty-hint">Type a movie to see suggestions...</div>';
                closeMobileAc();
            } else {
                movieInput.value = movie.title;
            }
        });
        target.appendChild(div);
    });

    if (isMobile) mobileAcDropdown.classList.add('open');
}

function submitMovie() {
    const movie = movieInput.value.trim();
    if (!movie) return;
    autocompleteContainer.innerHTML = '<div class="empty-hint">Type a movie to see suggestions...</div>';
    closeMobileAc();
    
    if (currentSelectedMovie && currentSelectedMovie.title.toLowerCase() === movie.toLowerCase()) {
        socket.emit('submitMovie', { 
            lobbyId: currentLobbyId, 
            movie, 
            tmdbId: currentSelectedMovie.id, 
            mediaType: currentSelectedMovie.mediaType 
        });
    } else {
        socket.emit('submitMovie', { lobbyId: currentLobbyId, movie });
    }
    
    currentSelectedMovie = null;
    movieInput.value = '';
}

// --- SOCKET EVENTS ---

socket.on('receiveChat', ({ playerName, msg }) => {
    const hint = chatMessages.querySelector('.empty-hint');
    if (hint) hint.remove();

    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="chat-author">${escapeHtml(playerName)}:</span>${escapeHtml(msg)}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

socket.on('autocompleteResults', (results) => {
    renderAutocompleteResults(results);
});


socket.on('joined', (data) => {
    currentLobbyId = data.lobbyId;
    myPlayerId = data.playerId;
    
    if(joinPanel) joinPanel.classList.add('hidden');
    if(privatePanel) privatePanel.classList.add('hidden');
    if(publicPanel) publicPanel.classList.add('hidden');
    
    waitingRoom.classList.remove('hidden');
    lobbyCodeDisplay.innerText = currentLobbyId;
});

socket.on('error', (msg) => {
    alert(msg);
});

socket.on('publicLobbiesList', (lobbies) => {
    if (!publicLobbiesList) return;
    publicLobbiesList.innerHTML = '';
    
    if (!lobbies || lobbies.length === 0) {
        publicLobbiesList.innerHTML = '<div class="empty-hint" style="text-align:center; padding: 2rem; color: var(--text-muted); font-style:italic;">No open lobbies found. Create a private one!</div>';
        return;
    }
    
    lobbies.forEach(lobby => {
        const card = document.createElement('div');
        card.className = 'public-lobby-card';
        
        let tagsHTML = '';
        if (lobby.hardcoreMode) tagsHTML += '<span class="mode-tag">Hardcore</span> ';
        if (lobby.allowTvShows) tagsHTML += '<span class="mode-tag">TV Shows</span>';
        
        card.innerHTML = `
            <div class="public-lobby-info">
                <h3>${escapeHtml(lobby.hostName)}'s Lobby</h3>
                <div class="public-lobby-stats">
                    <span>👥 ${lobby.playerCount} / 8</span>
                    ${tagsHTML ? `<div>${tagsHTML}</div>` : ''}
                </div>
            </div>
            <button class="btn-primary join-public-btn" style="padding: 0.5rem 1rem; width: auto;" data-id="${lobby.id}">Join</button>
        `;
        
        const joinButton = card.querySelector('.join-public-btn');
        joinButton.addEventListener('click', () => {
            const name = playerNameInput.value.trim();
            if (!name) return;
            socket.emit('joinLobby', { name, lobbyId: lobby.id });
        });
        
        publicLobbiesList.appendChild(card);
    });
});

socket.on('posters', (posters) => {
    if (!posterCarousel) return;
    posterCarousel.innerHTML = '';
    
    const rows = 4;
    const postersPerRow = Math.ceil(posters.length / rows);
    
    for (let i = 0; i < rows; i++) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'poster-row';
        
        const rowPosters = posters.slice(i * postersPerRow, (i + 1) * postersPerRow);
        const seamlessPosters = [...rowPosters, ...rowPosters, ...rowPosters, ...rowPosters, ...rowPosters];
        
        seamlessPosters.forEach(url => {
            const img = document.createElement('img');
            img.src = url;
            rowDiv.appendChild(img);
        });
        
        posterCarousel.appendChild(rowDiv);
    }
});

let turnInterval = null;
let lastTickSound = 0;

socket.on('stateUpdate', (state) => {
    gameState = state;
    
    if (state.status === 'playing') {
        lobbyScreen.classList.remove('active');
        gameScreen.classList.add('active');
        resetMobileTab();
        renderGame();
        
        if (turnInterval) clearInterval(turnInterval);
        
        turnInterval = setInterval(() => {
            if (!gameState || !gameState.turnExpiresAt || gameState.status !== 'playing') {
                clearInterval(turnInterval);
                return;
            }
            
            const ms = gameState.turnExpiresAt - Date.now();
            let tr = Math.max(0, Math.ceil(ms / 1000));
            
            timeText.innerText = tr + 's';
            const percentage = (tr / 60) * 100;
            timerBar.style.width = Math.max(0, Math.min(percentage, 100)) + '%';
            
            if (tr <= 10) {
                timerBar.style.backgroundColor = 'var(--timer-red)';
                if (tr > 0 && Math.floor(Date.now() / 1000) > lastTickSound) {
                   playTick();
                   lastTickSound = Math.floor(Date.now() / 1000);
                }
            } else if (tr <= 30) {
                timerBar.style.backgroundColor = 'var(--timer-yellow)';
            } else {
                timerBar.style.backgroundColor = 'var(--timer-green)';
            }
            
            if (tr === 0) {
                socket.emit('forceNextTurn', currentLobbyId);
                clearInterval(turnInterval);
            }
        }, 100);
        
    } else if (state.status === 'waiting') {
        if (turnInterval) clearInterval(turnInterval);
        gameScreen.classList.remove('active');
        lobbyScreen.classList.add('active');
        renderLobby();
    } else if (state.status === 'finished') {
        if (turnInterval) clearInterval(turnInterval);
        renderGame();
    }
});

socket.on('notification', (msg) => {
    showNotification(msg);
    if (msg.includes('eliminated')) {
        playFail();
        // visual shake
        document.querySelector('.board').classList.add('shake');
        setTimeout(() => document.querySelector('.board').classList.remove('shake'), 500);
    } else if (msg.includes('wins')) {
        playSuccess();
        setTimeout(playSuccess, 300);
        setTimeout(playSuccess, 600);
        confetti({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 }
        });
    }
});

// --- RENDER FUNCTIONS ---

function renderLobby() {
    const mode = gameState.gameMode || 'classic';
    const amIHost = !!gameState.players.find(p => p.id === myPlayerId && p.isHost);

    // Sync mode chips
    modeChips.forEach(chip => {
        chip.classList.toggle('active', chip.dataset.mode === mode);
        chip.disabled = !amIHost;
    });
    if (modeDescription) modeDescription.innerText = MODE_DESCRIPTIONS[mode] || '';

    // If Team mode, show team screen; otherwise show waiting room
    if (mode === 'team') {
        waitingRoom.classList.add('hidden');
        teamScreen.classList.remove('hidden');
        renderTeamScreen(amIHost);
        return;
    } else {
        teamScreen.classList.add('hidden');
        waitingRoom.classList.remove('hidden');
    }

    // Lobby code
    lobbyCodeDisplay.innerText = gameState.id || '';

    // Players list
    lobbyPlayersList.innerHTML = '';
    gameState.players.forEach(p => {
        const li = document.createElement('li');
        let label = p.name;
        if (p.id === myPlayerId) label += ' (You)';
        if (p.isHost) label += ' 👑';
        if (p.wins > 0) label += ` • ${p.wins} 🏆`;
        li.innerText = label;
        lobbyPlayersList.appendChild(li);
    });

    lobbySettings.style.display = 'flex';
    hardcoreToggle.checked = gameState.hardcoreMode || false;
    hardcoreToggle.disabled = !amIHost;
    tvShowsToggle.checked = gameState.allowTvShows || false;
    tvShowsToggle.disabled = !amIHost;
    if (publicRoomToggle) {
        // Solo can't be public
        publicRoomToggle.checked = gameState.isPublic || false;
        publicRoomToggle.disabled = !amIHost || mode === 'solo';
    }

    // Start button
    const canStart = mode === 'solo' ? gameState.players.length >= 1 : gameState.players.length >= 2;
    if (canStart) {
        startBtn.style.display = 'block';
        if (amIHost) {
            startBtn.innerText = 'Start Match';
            startBtn.disabled = false;
            startBtn.style.opacity = '1';
            startBtn.style.cursor = 'pointer';
        } else {
            startBtn.innerText = 'Waiting for host...';
            startBtn.disabled = true;
            startBtn.style.opacity = '0.5';
            startBtn.style.cursor = 'not-allowed';
        }
    } else {
        startBtn.style.display = 'none';
        startBtn.disabled = false;
        startBtn.style.opacity = '1';
        startBtn.style.cursor = 'pointer';
        startBtn.innerText = 'Start Match';
    }
}

function renderTeamScreen(amIHost) {
    if (!teamLobbyCode || !teamRedList || !teamBlueList) return;
    teamLobbyCode.innerText = gameState.id || '';

    const myTeamId = gameState.players.find(p => p.id === myPlayerId)?.teamId;

    [teamRedList, teamBlueList].forEach((list, teamId) => {
        list.innerHTML = '';
        gameState.players.filter(p => p.teamId === teamId).forEach(p => {
            const li = document.createElement('li');
            li.className = 'team-player-chip' + (p.id === myPlayerId ? ' is-me' : '');
            let label = escapeHtml(p.name);
            if (p.id === myPlayerId) label += ' (You)';
            if (p.isHost) label += '<span class="chip-host"> 👑</span>';
            li.innerHTML = label;
            list.appendChild(li);
        });
    });

    // Disable join buttons for non-host's own team (don't let you click the team you're already on)
    if (joinRedBtn) joinRedBtn.disabled = myTeamId === 0;
    if (joinBlueBtn) joinBlueBtn.disabled = myTeamId === 1;

    // Start button: host only, each team has ≥1
    const team0 = gameState.players.filter(p => p.teamId === 0);
    const team1 = gameState.players.filter(p => p.teamId === 1);
    const teamsReady = team0.length >= 1 && team1.length >= 1;

    if (teamHint) {
        teamHint.innerText = teamsReady
            ? `${team0.length} vs ${team1.length} — Ready to start!`
            : 'Teams need at least 1 player each.';
    }

    if (teamStartBtn) {
        if (amIHost) {
            teamStartBtn.style.display = teamsReady ? 'block' : 'none';
        } else {
            teamStartBtn.style.display = 'none';
            if (teamHint && teamsReady) teamHint.innerText += ' Waiting for host...';
        }
    }
}


function renderGame() {
    const mode = gameState.gameMode || 'classic';

    // Solo mode layout toggle
    if (mode === 'solo') {
        gameScreen.classList.add('solo-mode-ui');
    } else {
        gameScreen.classList.remove('solo-mode-ui');
    }

    // Speed mode: warm timer always
    if (mode === 'speed') {
        gameScreen.classList.add('speed-mode');
    } else {
        gameScreen.classList.remove('speed-mode');
    }

    // --- SIDEBAR ---
    gamePlayersList.innerHTML = '';

    if (mode === 'team') {
        // Two labeled sections: Red | Blue
        [0, 1].forEach(teamId => {
            const teamLabel = teamId === 0 ? '🔴 Red' : '🔵 Blue';
            const header = document.createElement('li');
            header.style.cssText = 'font-size:0.65rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:' + (teamId === 0 ? '#f87171' : '#60a5fa') + ';padding:0.5rem 0 0.2rem;border-top:1px solid var(--border-subtle);margin-top:0.35rem;';
            if (teamId === 0) header.style.borderTop = 'none';
            header.innerText = teamLabel;
            gamePlayersList.appendChild(header);

            gameState.players.filter(p => p.teamId === teamId).forEach((p, i) => {
                const li = document.createElement('li');
                const idx = gameState.players.indexOf(p);
                li.innerHTML = `<span>${escapeHtml(p.name)}</span> <span>${p.score}</span>`;
                if (!p.isAlive) li.classList.add('eliminated');
                if (idx === gameState.currentTurnIndex && p.isAlive) li.classList.add('active-turn');
                gamePlayersList.appendChild(li);
            });
        });
    } else if (mode === 'solo') {
        // Solo: just show chain badge, hide sidebar list
        gamePlayersList.innerHTML = '<li style="color:var(--text-muted);font-size:0.8rem;">Solo Run</li>';
    } else {
        gameState.players.forEach((p, index) => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${escapeHtml(p.name)}</span> <span>${p.score}</span>`;
            if (!p.isAlive) li.classList.add('eliminated');
            if (index === gameState.currentTurnIndex && p.isAlive) li.classList.add('active-turn');
            gamePlayersList.appendChild(li);
        });
    }

    // Render Chain
    chainDisplay.innerHTML = '';
    let previousActors = [];
    gameState.chain.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'chain-item';
        
        let castHtml = '';
        if (index > 0) {
            // highlight shared actor
            const castItems = item.movie.cast.map(c => {
                if (previousActors.some(pa => pa.toLowerCase() === c.toLowerCase())) {
                    return `<strong>${c}</strong>`;
                }
                return c;
            });
            castHtml = castItems.join(', ');
            div.classList.add('shared-highlight');
        } else {
            castHtml = item.movie.cast.join(', ');
        }

        const imgTag = item.movie.poster ? `<img src="${item.movie.poster}" alt="Poster" class="chain-poster">` : `<div class="chain-poster placeholder"></div>`;
        div.innerHTML = `
            ${imgTag}
            <div class="chain-content">
                <div class="player-name">${escapeHtml(item.playerName)}</div>
                <div class="movie-title">${item.movie.title} <span class="year">(${item.movie.year})</span></div>
                <div class="movie-cast">Cast: ${castHtml}</div>
            </div>
        `;
        chainDisplay.appendChild(div);
        previousActors = item.movie.cast;
        
        // Check if this was just added
        if (index === gameState.chain.length - 1 && item.playerId !== myPlayerId) {
            playSuccess();
        }
    });

    // Auto-scroll chain
    chainDisplay.scrollTop = chainDisplay.scrollHeight;

    // Update Input Area
    const activePlayer = gameState.players[gameState.currentTurnIndex];

    // Solo: show chain badge in turn indicator
    if (mode === 'solo') {
        turnIndicator.innerHTML = `🔗 Chain: <span class="chain-badge">${gameState.chain.length}</span>`;
    }

    if (gameState.status === 'playing') {
        if (activePlayer && activePlayer.id === myPlayerId) {
            inputArea.classList.remove('disabled-area');
            movieInput.disabled = false;
            submitBtn.disabled = false;
            movieInput.focus();
            if (mode === 'team') {
                const teamLabel = (activePlayer.teamId === 0 ? '🔴 Red' : '🔵 Blue');
                turnIndicator.innerText = `${teamLabel} — It's your turn!`;
            } else if (mode !== 'solo') {
                turnIndicator.innerText = "It's your turn!";
            }
            if (gameState.chain.length > 0) {
                hintText.innerText = "Name a movie sharing an actor with the previous one!";
            } else {
                hintText.innerText = "Start the chain! Name ANY valid movie.";
            }
        } else {
            inputArea.classList.add('disabled-area');
            movieInput.disabled = true;
            submitBtn.disabled = true;
            if (mode === 'team') {
                const teamLabel = activePlayer?.teamId === 0 ? '🔴 Red' : '🔵 Blue';
                turnIndicator.innerText = `${teamLabel} — Waiting for ${activePlayer?.name}...`;
            } else {
                turnIndicator.innerText = `Waiting for ${activePlayer?.name}...`;
            }
            hintText.innerText = "Their time is ticking...";
        }
    } else {
        inputArea.classList.add('disabled-area');
        turnIndicator.innerText = 'Game Over';
        // Show game over banner once (check it's not already there)
        if (!chainDisplay.querySelector('.game-over-banner')) {
            showGameOverBanner(gameState.winner);
        }
    }
}

function showNotification(msg) {
    notificationText.innerText = msg;
    notificationOverlay.classList.remove('hidden');
    setTimeout(() => {
        notificationOverlay.classList.add('hidden');
    }, 3000);
}

// --- REACTIONS LOGIC ---
const reactionBtns = document.querySelectorAll('.reaction-btn');

reactionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        if (!currentLobbyId) return;
        socket.emit('sendReaction', { lobbyId: currentLobbyId, emoji: btn.innerText });
        
        // Add a tiny local bump effect to the button for visual clicking feedback
        btn.style.transform = 'scale(0.8)';
        setTimeout(() => btn.style.transform = '', 100);
    });
});

socket.on('receiveReaction', ({ emoji }) => {
    const board = document.querySelector('.game-board');
    if (!board) return;
    
    const el = document.createElement('div');
    el.className = 'floating-emoji';
    el.innerText = emoji;
    
    const randomX = Math.random() * (board.clientWidth - 40);
    el.style.left = randomX + 'px';
    el.style.bottom = '120px';
    
    board.appendChild(el);
    
    setTimeout(() => {
        el.remove();
    }, 2500);
});

// --- MODALS ---
howToPlayBtn.addEventListener('click', () => howToPlayModal.classList.remove('hidden'));
creditsBtn.addEventListener('click', () => creditsModal.classList.remove('hidden'));
closeHowToPlay.addEventListener('click', () => howToPlayModal.classList.add('hidden'));
closeCredits.addEventListener('click', () => creditsModal.classList.add('hidden'));

// Close on backdrop click
howToPlayModal.addEventListener('click', (e) => { if (e.target === howToPlayModal) howToPlayModal.classList.add('hidden'); });
creditsModal.addEventListener('click', (e) => { if (e.target === creditsModal) creditsModal.classList.add('hidden'); });

// Close on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        howToPlayModal.classList.add('hidden');
        creditsModal.classList.add('hidden');
    }
});

// --- MOBILE TAB SWITCHER ---
const mobileTabs = document.getElementById('mobile-tabs');
const gameBoardEl = document.querySelector('.game-board');
const playersPanel = document.querySelector('[data-panel="players"]');
const chatPanel = document.querySelector('[data-panel="chat"]');

if (mobileTabs) {
    mobileTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('.mobile-tab');
        if (!btn) return;

        const tab = btn.dataset.tab;

        // Update active button
        document.querySelectorAll('.mobile-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Reset all panels
        gameBoardEl.classList.remove('mobile-hidden');
        playersPanel.classList.remove('mobile-visible');
        chatPanel.classList.remove('mobile-visible');

        if (tab === 'players') {
            gameBoardEl.classList.add('mobile-hidden');
            playersPanel.classList.add('mobile-visible');
        } else if (tab === 'chat') {
            gameBoardEl.classList.add('mobile-hidden');
            chatPanel.classList.add('mobile-visible');
        }
        // 'board' tab: defaults already set above (board visible)
    });
}

// Reset tab state back to board whenever a new game state arrives (e.g. turn starts)
function resetMobileTab() {
    if (!mobileTabs) return;
    document.querySelectorAll('.mobile-tab').forEach(b => b.classList.remove('active'));
    const boardTab = mobileTabs.querySelector('[data-tab="board"]');
    if (boardTab) boardTab.classList.add('active');
    gameBoardEl.classList.remove('mobile-hidden');
    playersPanel.classList.remove('mobile-visible');
    chatPanel.classList.remove('mobile-visible');
}

// =============================================
// GAME OVER BANNER
// =============================================
function showGameOverBanner(winner) {
    const banner = document.createElement('div');
    banner.className = 'game-over-banner';

    const mode = gameState.gameMode || 'classic';
    let winnerLine, subLine;

    if (winner?.isSolo) {
        winnerLine = `🎬 Solo Complete!`;
        subLine = `🔗 Chain Length: ${winner.chainLength} link${winner.chainLength !== 1 ? 's' : ''}`;
    } else if (winner?.isTeamWin) {
        winnerLine = `🏆 ${winner.name} wins!`;
        const memberNames = (winner.players || []).join(' & ');
        subLine = `${memberNames} • ${winner.score} pts • ${gameState.chain.length} connections`;
    } else if (winner) {
        winnerLine = `🏆 ${winner.name} wins!`;
        subLine = `${gameState.chain.length} connection${gameState.chain.length !== 1 ? 's' : ''} • ${winner.score} pts`;
    } else {
        winnerLine = '🎬 Game Over!';
        subLine = `${gameState.chain.length} connections total`;
    }

    const isHost = gameState.players.find(p => p.id === myPlayerId)?.isHost;

    banner.innerHTML = `
        <div class="game-over-title">${winnerLine}</div>
        <div class="game-over-subtitle">${subLine}</div>
        <div class="game-over-actions">
            <button id="share-results-btn" class="btn-primary">🎬 Share Results</button>
            ${isHost ? '<button id="play-again-btn" class="btn-secondary">↩ Play Again</button>' : ''}
        </div>
    `;
    chainDisplay.appendChild(banner);
    chainDisplay.scrollTop = chainDisplay.scrollHeight;

    document.getElementById('share-results-btn')?.addEventListener('click', () => {
        openShareModal();
    });
    document.getElementById('play-again-btn')?.addEventListener('click', () => {
        socket.emit('restartLobby', currentLobbyId);
    });
}

// =============================================
// SHARE CARD — CHAIN SELECTION SCORING
// =============================================
function scoreChainEntry(item, index, chain) {
    if (index === 0) return -1; // opener always pinned separately
    let score = 0;
    const prev = chain[index - 1];

    // +3 Movie ↔ TV crossover
    if (prev.movie.mediaType && item.movie.mediaType &&
        prev.movie.mediaType !== item.movie.mediaType) {
        score += 3;
    }

    // +2 Obscure connector (actor past position 5 in display cast)
    const actor = (item.matchedActors || [])[0];
    if (actor) {
        const pos = (item.movie.cast || []).findIndex(
            c => c.toLowerCase() === actor.toLowerCase()
        );
        if (pos > 4) score += 2;
    }

    // +1 per decade year gap
    const prevYear = parseInt(prev.movie.year);
    const currYear = parseInt(item.movie.year);
    if (!isNaN(prevYear) && !isNaN(currYear)) {
        score += Math.floor(Math.abs(currYear - prevYear) / 10);
    }

    return score;
}

function selectChainEntries(chain) {
    const MAX = 7;
    if (chain.length <= MAX) return { entries: chain.map((c, i) => ({ ...c, _idx: i })), skipped: 0 };

    const scored = chain.map((item, i) => ({ ...item, _idx: i, _score: scoreChainEntry(item, i, chain) }));

    // Always keep first and last
    const first = scored[0];
    const last = scored[scored.length - 1];

    // Score and sort middle entries, pick top 5
    const middle = scored.slice(1, -1)
        .sort((a, b) => b._score - a._score)
        .slice(0, 5)
        .sort((a, b) => a._idx - b._idx); // restore narrative order

    const entries = [first, ...middle, last];
    const skipped = chain.length - entries.length;
    return { entries, skipped };
}

// =============================================
// SHARE CARD — CANVAS GENERATION
// =============================================
function generateShareCard(state) {
    const W = 600, H = 720;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const COLORS = {
        bg: '#09090b',
        surface: '#18181b',
        border: 'rgba(255,255,255,0.08)',
        accent: '#818cf8',
        accentDark: '#4338ca',
        text: '#f8fafc',
        muted: '#94a3b8',
        star: '#fbbf24',
    };

    // --- Background ---
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);

    // --- Header gradient bar ---
    const headerGrad = ctx.createLinearGradient(0, 0, W, 0);
    headerGrad.addColorStop(0, COLORS.accentDark);
    headerGrad.addColorStop(1, COLORS.accent);
    ctx.fillStyle = headerGrad;
    ctx.fillRect(0, 0, W, 64);

    // --- Logo ---
    ctx.font = 'bold 22px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎬 MovieMatch', 28, 32);

    // --- Chain length label ---
    const chainLen = state.chain.length;
    ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = COLORS.muted;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const labelY = 100;
    ctx.fillText(`CHAIN OF ${chainLen} CONNECTION${chainLen !== 1 ? 'S' : ''}`, 32, labelY);

    // --- Divider ---
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(32, labelY + 10);
    ctx.lineTo(W - 32, labelY + 10);
    ctx.stroke();

    // --- Chain entries ---
    const { entries, skipped } = selectChainEntries(state.chain);
    let y = labelY + 32;
    const lineH = 44;

    entries.forEach((item, i) => {
        const isHighlight = item._score > 0 && item._idx !== 0;
        const isFirst = item._idx === 0;
        const isLast = item._idx === state.chain.length - 1 && state.chain.length > 1;

        // Row background for highlights
        if (isHighlight) {
            ctx.fillStyle = 'rgba(129,140,248,0.07)';
            roundRect(ctx, 28, y - 6, W - 56, lineH - 4, 6);
            ctx.fill();
        }

        // Star badge for highlights
        ctx.textBaseline = 'middle';
        if (isHighlight) {
            ctx.font = '13px sans-serif';
            ctx.fillText('⭐', 32, y + 10);
        }

        // Index number
        ctx.font = `500 13px "Plus Jakarta Sans", sans-serif`;
        ctx.fillStyle = COLORS.muted;
        ctx.textAlign = 'left';
        ctx.fillText(String(item._idx + 1).padStart(2, ' '), isHighlight ? 52 : 32, y + 10);

        // Player name
        ctx.fillStyle = COLORS.text;
        ctx.font = '600 14px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(truncate(item.playerName, 12), 72, y + 10);

        // Movie title
        ctx.fillStyle = COLORS.text;
        ctx.font = '500 14px "Plus Jakarta Sans", sans-serif';
        const titleX = 185;
        const titleStr = `${truncate(item.movie.title, 22)} (${item.movie.year})`;
        ctx.fillText(titleStr, titleX, y + 10);

        // Connecting actor (second line)
        if (!isFirst && item.matchedActors && item.matchedActors.length > 0) {
            ctx.fillStyle = COLORS.accent;
            ctx.font = '500 12px "Plus Jakarta Sans", sans-serif';
            ctx.fillText(`↔ ${item.matchedActors[0]}`, titleX, y + 28);
        }

        // Last move checkmark
        if (isLast) {
            ctx.fillStyle = '#4ade80';
            ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('✓', W - 32, y + 10);
            ctx.textAlign = 'left';
        }

        y += lineH;
    });

    // "+ N more" label
    if (skipped > 0) {
        ctx.font = 'italic 12px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = COLORS.muted;
        ctx.fillText(`+ ${skipped} more connection${skipped !== 1 ? 's' : ''}`, 32, y + 10);
        y += 28;
    }

    // --- Winner section ---
    const winnerY = Math.max(y + 20, H - 140);
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(32, winnerY);
    ctx.lineTo(W - 32, winnerY);
    ctx.stroke();

    if (state.winner) {
        ctx.font = 'bold 26px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = COLORS.accent;
        ctx.textAlign = 'center';
        ctx.fillText(`🏆 ${state.winner.name} wins!`, W / 2, winnerY + 36);

        ctx.font = '500 14px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = COLORS.muted;
        ctx.fillText(`${chainLen} connections  •  ${state.winner.score} pts`, W / 2, winnerY + 60);
    } else {
        ctx.font = 'bold 24px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = COLORS.text;
        ctx.textAlign = 'center';
        ctx.fillText('🎬 Game Over!', W / 2, winnerY + 36);
    }

    // --- Footer ---
    const footerGrad = ctx.createLinearGradient(0, H - 48, 0, H);
    footerGrad.addColorStop(0, 'transparent');
    footerGrad.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = footerGrad;
    ctx.fillRect(0, H - 48, W, 48);

    const siteUrl = window.location.hostname !== 'localhost'
        ? window.location.hostname
        : 'moviematch.it.com';
    ctx.font = '500 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'center';
    ctx.fillText(siteUrl, W / 2, H - 16);

    return canvas;
}

function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

// =============================================
// SHARE MODAL WIRING
// =============================================
const shareModal = document.getElementById('share-modal');
const shareCanvas = document.getElementById('share-canvas');
const closeShareModal = document.getElementById('close-share-modal');
const downloadCardBtn = document.getElementById('download-card-btn');
const copyCardBtn = document.getElementById('copy-card-btn');

// Create toast element
const toast = document.createElement('div');
toast.className = 'copy-toast';
document.body.appendChild(toast);

function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 2500);
}

function openShareModal() {
    // Wait for font to be ready before drawing
    document.fonts.ready.then(() => {
        const generated = generateShareCard(gameState);
        // Copy pixels to the preview canvas
        shareCanvas.width = generated.width;
        shareCanvas.height = generated.height;
        shareCanvas.getContext('2d').drawImage(generated, 0, 0);
        shareModal.classList.remove('hidden');
    });
}

closeShareModal?.addEventListener('click', () => shareModal.classList.add('hidden'));
shareModal?.addEventListener('click', e => { if (e.target === shareModal) shareModal.classList.add('hidden'); });

downloadCardBtn?.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `moviematch-chain-${Date.now()}.png`;
    link.href = shareCanvas.toDataURL('image/png');
    link.click();
    showToast('Downloaded! 🎬');
});

copyCardBtn?.addEventListener('click', async () => {
    try {
        const blob = await new Promise(res => shareCanvas.toBlob(res, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showToast('Image copied to clipboard! 📋');
    } catch {
        // Fallback: copy text recap
        const text = buildTextRecap(gameState);
        navigator.clipboard.writeText(text).catch(() => {});
        showToast('Image unavailable — text recap copied! ✓');
    }
});

function buildTextRecap(state) {
    const lines = ['🎬 MovieMatch\n'];
    lines.push(`Chain of ${state.chain.length} connections:\n`);
    state.chain.forEach((item, i) => {
        const actor = (item.matchedActors || [])[0];
        lines.push(`${i + 1}. ${item.playerName} → ${item.movie.title} (${item.movie.year})${actor ? ` ↔ ${actor}` : ''}`);
    });
    if (state.winner) lines.push(`\n🏆 ${state.winner.name} wins with ${state.winner.score} pts!`);
    const siteUrl = window.location.hostname !== 'localhost' ? window.location.hostname : 'moviematch.it.com';
    lines.push(`\nPlay at ${siteUrl}`);
    return lines.join('\n');
}
