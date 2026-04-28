# 🎬 MovieMatch

A fast-paced, real-time multiplayer "last-player-standing" movie/TV chaining game. Link titles by shared cast members. Last one standing wins!

## ✨ Key Features

### 🎮 Game Modes
- **Classic** — Last player standing wins. Timer shrinks every two successful plays.
- **Team (2v2)** — Teams submit back-to-back. One mistake eliminates the whole team.
- **Solo Challenge** — Build the longest chain possible against the clock.
- **Speed Round** — Brutal 15-second flat timer.

### 🌐 Matchmaking & Social
- **Public Lobby Browser** — Browse and join open games instantly.
- **Dynamic Rules** — Toggle Public/Private, Hardcore Mode, and TV Show support.
- **Interactive Chat & Reactions** — Trash talk or cheer with real-time emoji bursts.
- **Shareable Chain Recaps** — Download PNG images or copy text summaries of your runs.
- **Up to 8 Players** per lobby with persistent Redis-backed win tracking.

### ⚡ Recent Improvements
- **TMDB Credits Caching** — Full cast lists cached in Redis for 30 days
- **Server-Side Turn Enforcement** — Hard timeouts prevent stalled games
- **Robust Disconnect/Reconnection** — Automatic rejoin after network drops
- **Security Hardening** — Strict Helmet CSP + per-socket rate limiting
- **Frontend Modularization** — Clean ES6 modules (`utils.js`, `ui.js`, `socketClient.js`, `app.js`)
- **Test Coverage** — 13+ passing tests protecting core logic

### 🛡️ Core Engine
- Authoritative server validation against full TMDB cast lists
- Hardcore mode + TV support via `aggregate_credits`
- Used-movie deduplication by TMDB ID
- Retroactive actor display

---

## 📦 Quick Start

1. Clone the repo:
   ```bash
   git clone https://github.com/Itsbryanfam/MovieMatch.git
   cd MovieMatch

2. Create a `.env` file in the root:
   ```env
   TMDB_READ_TOKEN=your_tmdb_read_token_here
   REDIS_URL=redis://localhost:6379
   ```

3. Install dependencies and start the server:
   ```bash
   npm install
   npm start
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

*Requirements: Node.js ≥18 and a running Redis instance.*

🛠️ Tech Stack

Backend: Node.js + Express + Socket.io + Redis
Frontend: Vanilla HTML/CSS/JS (modular ES6)
Data: TMDB API
Testing: Jest


### 🧪 Testing

```bash
npm test
```

🚀 Deployment
Recommended on Render.com:

Web Service (Node)
Separate Redis instance
Set TMDB_READ_TOKEN and REDIS_URL as environment variables


Enjoy the game! Last player standing wins. Link those movies. 🎬
Made with ❤️ by Bryan Cortez
