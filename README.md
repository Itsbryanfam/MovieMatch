# 🎬 MovieMatch

A fast-paced, horizontally-scalable, multiplayer web game where players take turns linking movies (and TV shows!) by shared cast members. Last one standing wins!

## ✨ New & Advanced Features

### 🌐 Public Matchmaking & Discovery
- **Public Lobby Browser:** Users can now "Solo-Queue" by browsing a live list of public rooms directly from the home screen.
- **Dynamic Privacy:** Lobby hosts can toggle `Public Room` status at any time to list/unlist their room from the global browser.
- **Room Capacity:** Supports up to 8 players per lobby for high-energy matchmaking sessions.

### ⚡ Stateless Redis Architecture (V2)
- **Horizontal Scalability:** The backend has been completely refactored from in-memory OOP to a stateless functional architecture using **Redis**.
- **Socket.io Redis Adapter:** Uses a Pub/Sub bridge to allow multiple server instances to synchronize state perfectly — connect on Server A and play with friends on Server B seamlessly.
- **Session Persistence:** Lobby states are persisted in a Redis Key-Value store with a 2-hour TTL, ensuring zero-latency game state recovery and auto-cleanup.

### 🛡️ Enhanced Validation Engine
- **Full Cast Depth:** The server now validates every submission against the **entire credited cast list**, including obscure cameos and uncredited roles, eliminating "false-failure" feedback.
- **TV Aggregate Credits:** For TV shows, the engine now queries the TMDB `aggregate_credits` endpoint, scanning every episode of every season to ensure actors from any era are recognized.
- **Smart UI Slicing:** While the backend validates against 500+ actors, the UI dynamically shrinks the display list to the Top 30 actors + the specific "Matching Actor" to keep the game feed clean.
- **Retroactive Connections:** If an obscure connecting actor isn't in a movie's main display list, the engine automatically injects them into the previous turn's card to visually prove the connection.

### 🎭 UX & Polish
- **How to Play & Credits:** Dedicated modal overlays accessible from the main header for onboarding new players and checking project credits.
- **Trophy Win Counters:** Player wins are now displayed with elegant trophy icons (`• 1 🏆`) to track dominance across sessions.
- **Redis LRU Caching:** Autocomplete searches are cached in Redis for 24 hours to stay under TMDB API rate limits while providing instantaneous suggestions.
- **Premium Dark Aesthetics:** Refined glassmorphism, Jakarta Sans typography, and smooth CSS transitions.

---

## 📦 Setup & Installation

1. Requires **Node.js** and a **Redis** instance (V6+).
2. Create a `.env` file at the project root:
   ```
   TMDB_READ_TOKEN=your_token_here
   REDIS_URL=redis://127.0.0.1:6379
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the server:
   ```bash
   npm start
   ```
5. Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Server** | Node.js, Express |
| **Database** | Redis (State & API Caching) |
| **Real-Time** | Socket.io (with Redis Adapter) |
| **Frontend** | Vanilla HTML5 / CSS3 / ES6+ |
| **Movie Data** | TMDB API (Multi-Search, Aggregate Credits) |
| **Audio** | Web Audio API (Synthesized) |
| **Hosting** | Render.com |

---

## 👨‍💻 Created By

**Bryan Cortez**  
[Twitter (@ItsBryanFam)](https://x.com/ItsBryanFam) | [Email](mailto:cortezfam7@gmail.com)
