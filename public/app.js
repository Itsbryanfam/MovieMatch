const socket = io();

// UI Elements
const lobbyScreen = document.getElementById('lobby-screen');
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

const gamePlayersList = document.getElementById('game-players');
const chainDisplay = document.getElementById('chain-display');
const movieInput = document.getElementById('movie-input');
const submitBtn = document.getElementById('submit-btn');
const inputArea = document.getElementById('input-area');
const turnIndicator = document.getElementById('turn-indicator');
const hintText = document.getElementById('hint-text');
const autocompleteContainer = document.getElementById('autocomplete-container');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');

const timerBar = document.getElementById('timer-bar');
const timeText = document.getElementById('time-text');
const notificationOverlay = document.getElementById('notification-overlay');
const notificationText = document.getElementById('notification-text');
const logo = document.querySelector('.logo');

// State
let myPlayerId = null;
let currentLobbyId = null;
let gameState = null;
let debounceTimeout = null;
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
        
        gameScreen.classList.remove('active');
        lobbyScreen.classList.add('active');
        
        waitingRoom.classList.add('hidden');
        lobbyPanel.classList.remove('hidden');
    }
});

joinBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (!name) return alert('Enter a name!');
    
    // Resume audio context on first user interaction
    if (!audioCtx) audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    socket.emit('joinLobby', { 
        name, 
        lobbyId: lobbyIdInput.value.trim() 
    });
});

startBtn.addEventListener('click', () => {
    socket.emit('startLobby', currentLobbyId);
});

hardcoreToggle.addEventListener('change', (e) => {
    socket.emit('toggleHardcore', { lobbyId: currentLobbyId, state: e.target.checked });
});

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

function submitMovie() {
    const movie = movieInput.value.trim();
    if (!movie) return;
    autocompleteContainer.innerHTML = '<div class="empty-hint">Type a movie to see suggestions...</div>';
    socket.emit('submitMovie', { lobbyId: currentLobbyId, movie });
    movieInput.value = '';
}

// --- SOCKET EVENTS ---

socket.on('receiveChat', ({ playerName, msg }) => {
    const hint = chatMessages.querySelector('.empty-hint');
    if (hint) hint.remove();

    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="chat-author">${playerName}:</span>${msg}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

socket.on('autocompleteResults', (results) => {
    if (!results || results.length === 0) {
        autocompleteContainer.innerHTML = '<div class="empty-hint">No results found.</div>';
        return;
    }
    autocompleteContainer.innerHTML = '';
    
    results.forEach(movie => {
        const div = document.createElement('div');
        div.className = 'autocomplete-item';
        const imgTag = movie.poster ? `<img src="${movie.poster}" alt="Poster" class="mini-poster">` : `<div class="mini-poster placeholder"></div>`;
        div.innerHTML = `
            ${imgTag}
            <div class="ac-text">
                <div class="ac-title">${movie.title}</div>
                <span class="year">(${movie.year})</span>
            </div>
        `;
        div.addEventListener('click', () => {
            movieInput.value = movie.title;
            autocompleteContainer.innerHTML = '<div class="empty-hint">Press Submit to lock it in!</div>';
            movieInput.focus();
        });
        autocompleteContainer.appendChild(div);
    });
});

socket.on('joined', (data) => {
    currentLobbyId = data.lobbyId;
    myPlayerId = data.playerId;
    
    lobbyPanel.classList.add('hidden');
    waitingRoom.classList.remove('hidden');
    lobbyCodeDisplay.innerText = currentLobbyId;
});

socket.on('error', (msg) => {
    alert(msg);
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

socket.on('stateUpdate', (state) => {
    gameState = state;
    
    if (state.status === 'playing') {
        lobbyScreen.classList.remove('active');
        gameScreen.classList.add('active');
        renderGame();
    } else if (state.status === 'waiting') {
        gameScreen.classList.remove('active');
        lobbyScreen.classList.add('active');
        renderLobby();
    } else if (state.status === 'finished') {
        renderGame();
        // The notification will be handled separately
    }
});

socket.on('tick', (timeRemaining) => {
    timeText.innerText = timeRemaining + 's';
    
    const percentage = (timeRemaining / 60) * 100; // rough approx for colors
    timerBar.style.width = Math.max(0, percentage) + '%';
    
    if (timeRemaining <= 10) {
        timerBar.style.backgroundColor = 'var(--timer-red)';
        playTick();
    } else if (timeRemaining <= 30) {
        timerBar.style.backgroundColor = 'var(--timer-yellow)';
    } else {
        timerBar.style.backgroundColor = 'var(--timer-green)';
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
    lobbyPlayersList.innerHTML = '';
    
    let amIHost = false;

    gameState.players.forEach(p => {
        const li = document.createElement('li');
        let label = p.name;
        if (p.id === myPlayerId) {
            label += ' (You)';
            if (p.isHost) amIHost = true;
        }
        if (p.isHost) {
            label += ' 👑';
        }
        if (p.wins > 0) {
            label += ` (${p.wins} Wins)`;
        }
        li.innerText = label;
        lobbyPlayersList.appendChild(li);
    });
    
    lobbySettings.style.display = 'flex';
    hardcoreToggle.checked = gameState.hardcoreMode || false;
    hardcoreToggle.disabled = !amIHost;
    tvShowsToggle.checked = gameState.allowTvShows || false;
    tvShowsToggle.disabled = !amIHost;

    if (gameState.players.length >= 2) {
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

function renderGame() {
    // Render Players Sidebar
    gamePlayersList.innerHTML = '';
    gameState.players.forEach((p, index) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${p.name}</span> <span>${p.score}</span>`;
        if (!p.isAlive) li.classList.add('eliminated');
        if (index === gameState.currentTurnIndex && p.isAlive) li.classList.add('active-turn');
        gamePlayersList.appendChild(li);
    });

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
                <div class="player-name">${item.playerName}</div>
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
    if (gameState.status === 'playing') {
        if (activePlayer && activePlayer.id === myPlayerId) {
            inputArea.classList.remove('disabled-area');
            movieInput.disabled = false;
            submitBtn.disabled = false;
            movieInput.focus();
            turnIndicator.innerText = "It's your turn!";
            if (gameState.chain.length > 0) {
                hintText.innerText = "Name a movie sharing an actor with the previous one!";
            } else {
                hintText.innerText = "Start the chain! Name ANY valid movie.";
            }
        } else {
            inputArea.classList.add('disabled-area');
            movieInput.disabled = true;
            submitBtn.disabled = true;
            turnIndicator.innerText = `Waiting for ${activePlayer?.name}...`;
            hintText.innerText = "Their time is ticking...";
        }
    } else {
        inputArea.classList.add('disabled-area');
        turnIndicator.innerText = "Game Over";
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
