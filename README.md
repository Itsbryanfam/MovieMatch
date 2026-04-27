# 🎬 MovieMatch

A fast-paced, multiplayer web game where players take turns linking movies (and TV shows!) by shared cast members. Last one standing wins!

## ✨ Features

### 🎮 Core Gameplay
- **Real-Time Multiplayer Engine:** Built on Express and Socket.io for instantaneous lobby management and turn-state synchronization across all connected players.
- **Live TMDB Validation:** Integrates directly with The Movie Database (TMDB) API, validating every submission against live production data for accurate cast chains. Top 5 search candidates are checked to handle title ambiguity and alternate spellings.
- **Suspenseful Server-Side Timers:** The timer pressure increases as the chain grows longer (dropping from 60s down to 10s). A 5-second AbortSignal timeout on every TMDB fetch prevents frozen timers from stalled network requests.
- **Randomized Turn Order:** A random player from the lobby is selected to go first every match — no more hosting advantage!

### 🏆 Scoring & Persistence
- **Win Counter:** Each player's total wins are tracked and displayed next to their name in the lobby, persisting across multiple games in the same session.
- **Per-Match Scores:** Players earn 100 points per valid connection, which resets each new game while the win counter carries forward.

### 🔍 Movie Autocomplete Sidebar
- A dedicated **Search Suggestions** panel sits permanently on the right side of the game board.
- As you type, a debounced TMDB search fires and populates up to **5 clickable suggestions** complete with:
  - 🖼️ **Mini movie poster thumbnails** (32px) pulled directly from TMDB
  - Title and release year
- Clicking a suggestion auto-fills the guess input, ready to submit.
- When **Allow TV Shows** is enabled, the autocomplete also searches television series.

### 🖼️ Movie Posters In-Chain
- Every successfully validated answer in the game feed displays a **60px poster thumbnail** alongside the player name, movie title, and shared cast list.
- Shared connecting actors are **bolded** in the cast list for at-a-glance clarity.

### 💬 Lobby Chat
- A live **text chat panel** sits in the bottom half of the right sidebar.
- Messages are sent by pressing **Enter** and broadcast instantly to all players in the lobby via Socket.io.
- Each message shows the sender's player name in accent color.

### ⚙️ Lobby Settings (Host Only)
The lobby host has access to two game mode toggles before starting a match. All players see the settings update in real-time, but only the host can change them.

| Toggle | Description |
|---|---|
| **Hardcore Mode** | Players cannot reuse the same connecting actor from the immediately previous turn. Forces creative lateral thinking each round. |
| **Allow TV Shows** | Expands valid guesses beyond movies to include television series. Autocomplete and validation both switch to TMDB's `/search/multi` endpoint, normalizing title and air date fields automatically. |

### 🎨 UI & Polish
- **Premium Dark UI:** Deep OLED blacks, structural minimalism, glassmorphism panels, and crisp typographic hierarchy with *Plus Jakarta Sans*.
- **Web Audio Soundscapes:** Zero-latency synthesized tones for success chimes, failure buzzes, and high-tension timer sweeps — no audio files required.
- **Animated Chain Feed:** Each new chain entry slides in with a cubic-bezier spring animation.
- **Animated Poster Background:** The lobby screen cycles through a collage of top-rated TMDB movie posters for atmosphere.

---

## 📦 Setup & Installation

1. Requires **Node.js**.
2. Create a `.env` file at the project root with your TMDB Read Access Token:
   ```
   TMDB_READ_TOKEN=your_token_here
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

## 📜 How To Play

1. Enter your **name** and optionally a **Room Code** (leave blank to generate a new room), then hit **Connect to Room**.
2. Share your Room Code with friends so they can join.
3. The host configures **game settings** (Hardcore Mode, TV Shows) and clicks **Start Match**.
4. **Your turn** is indicated by your name highlighting in the left player panel.
5. Type a movie or TV show title in the input field — use the **Search Suggestions** sidebar to find the right title and poster.
6. Press **Enter** or click **Submit** to lock in your guess.

### Rules

| Rule | Description |
|---|---|
| **Rule 1** | The first player may name **any** valid movie or TV show to start the chain. |
| **Rule 2** | Every subsequent player must name a title that shares **at least one cast member** with the previous entry. |
| **Rule 3** | You **cannot reuse** a title already in the chain. |
| **Rule 4 (Hardcore)** | You **cannot connect** using the same actor that linked the two previous entries. |
| **Rule 5** | Run out of time or submit an invalid connection → **eliminated**! |
| **Rule 6** | The **last surviving player** wins the round and earns a Win on the scoreboard! |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Server | Node.js, Express |
| Real-Time | Socket.io |
| Frontend | Vanilla HTML / CSS / JS |
| Movie Data | TMDB API (search/movie, search/multi, credits) |
| Audio | Web Audio API (synthesized, no files) |
| Hosting | Render.com |
