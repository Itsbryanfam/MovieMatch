<div align="center">

# 🎬 MovieMatch

[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://socket.io/)
[![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)

**A fast-paced, real-time multiplayer "last-player-standing" movie/TV chaining game.**
*Link titles by shared cast members. Outsmart your friends. Last one standing wins!*

![MovieMatch Banner](public/og-image.png)

</div>

---

## 🎮 Game Modes

| Mode | Icon | Description |
| :--- | :---: | :--- |
| **Classic** | ⚔️ | Last player standing wins. Timer shrinks every two successful plays. |
| **Team (2v2)** | 🤝 | Teams submit back-to-back. One mistake eliminates the whole team. |
| **Solo Challenge** | 🎯 | Build the longest chain possible against the clock. |
| **Speed Round** | ⚡ | Brutal 15-second flat timer for pure chaos. |

---

## 🕹️ How to Play

1. **Name a Movie** — Type any movie or TV show into the search bar on your turn.
2. **Connect the Cast** — Your pick must share at least one actor with the previous title.
3. **Beat the Clock** — Don't freeze! The timer shrinks as the game progresses.
4. **Survival of the Smartest** — Fumble a connection or run out of time, and you're out!

---

## ✨ Key Features

### 🌐 Matchmaking & Social
* **Public Lobby Browser** — Browse and join open games instantly.
* **Interactive Chat & Reactions** — Trash talk or cheer with real-time emoji bursts.
* **Shareable Chain Recaps** — Download beautiful PNG summaries of your cinematic runs.
* **Persistent Trophies** — Track wins securely via Redis backend.

### 🛡️ Core Engine & Security
* **Authoritative Validation** — Cross-referenced against full TMDB cast lists.
* **Hardcore Mode** — Ban reusing the exact same connecting actor back-to-back.
* **TV Show Support** — Expands the pool via `aggregate_credits`.
* **Robust Reconnection** — Automatically rejoin matches after network drops.

---

## 📦 Quick Start

### 📋 Prerequisites
> [!IMPORTANT]
> Ensure you have **Node.js (v18+)** and a running **Redis** server.

### 🚀 Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Itsbryanfam/MovieMatch.git
   cd MovieMatch
   ```

2. **Configure Environment:**
   Create a `.env` file in the root directory:
   ```env
   TMDB_READ_TOKEN=your_tmdb_read_token_here
   REDIS_URL=redis://localhost:6379
   ```

3. **Launch the App:**
   ```bash
   npm install
   npm start
   ```

4. **Play!**
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🧪 Testing & Quality

Keep the engine running smoothly:
```bash
npm test
```

---

## 🚀 Deployment

Optimized for platforms like **Render.com**:
1. Deploy the Node.js server as a **Web Service**.
2. Provision a separate **Redis** instance.
3. Map `TMDB_READ_TOKEN` and `REDIS_URL` environment variables.

---

<div align="center">
Made with ❤️ by <strong>Bryan Cortez</strong>
</div>
