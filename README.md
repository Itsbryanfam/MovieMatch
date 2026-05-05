<div align="center">

# MovieMatch

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![Socket.io](https://img.shields.io/badge/Socket.io-4-010101?style=flat-square&logo=socketdotio&logoColor=white)](https://socket.io/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io/)
[![Tests](https://img.shields.io/badge/tests-153%20passing-brightgreen?style=flat-square)](/)
[![Release](https://img.shields.io/badge/release-v1.0.0-blue?style=flat-square)](https://github.com/Itsbryanfam/MovieMatch/releases)

**Real-time multiplayer trivia game — chain movies and TV shows through shared cast members. Last player standing wins. Or play the Daily Challenge solo and chase the leaderboard.**

[Live Demo](https://moviematch.it.com) · [Report a Bug](https://github.com/Itsbryanfam/MovieMatch/issues) · [Releases](https://github.com/Itsbryanfam/MovieMatch/releases)

![MovieMatch Screenshot](public/og-image.png)

</div>

---

## Overview

MovieMatch is a full-stack real-time game built on Node.js, Socket.io, and Redis. Players take turns naming a movie or TV show that shares at least one cast member with the previous title. Get it wrong, run out of time, or disconnect for too long — you're eliminated. The last player standing wins.

Every submission is validated server-side against live TMDB cast data, with **id-based actor matching** so two actors who happen to share a name don't silently false-match. The game state is entirely authoritative and Redis-backed, making it horizontally scalable.

A **Daily Challenge** runs alongside the multiplayer modes — every player on a given UTC day starts from the same seeded movie and chases the longest chain on a per-day leaderboard.

---

## Game Modes

| Mode | Description |
| :--- | :--- |
| **Classic** | Last player standing. Timer shrinks every two successful plays, increasing pressure throughout the game. |
| **Team (2v2)** | Two teams submit back-to-back. One failed connection eliminates the entire team. |
| **Solo** | Single-player survival with rotating per-game objectives, streak bonuses, and a personal-best chain. |
| **Speed** | Fixed 15-second timer for every turn. No exceptions. |
| **Daily Challenge** | Async, one attempt per UTC day. Same seeded starting movie for everyone. Wordle-style share card. |

**Modifiers:**

- **Hardcore Mode** — once any actor connects anywhere in the chain, they're locked out for the rest of the game.
- **TV Shows** — expands the candidate pool to include television series alongside films.
- **Themes** — 10 lobby-wide filters that restrict the candidate pool: 6 genres (Horror, Comedy, Action, Sci-Fi, Romance, Animation) + 4 decades (1980s, 1990s, 2000s, 2010s).

---

## Features

**Gameplay**

- Server-authoritative move validation against full TMDB cast lists
- Adaptive turn timer that shrinks as the game progresses
- 15-second reconnection grace period — disconnecting mid-game doesn't immediately eliminate you
- Page-refresh recovery via `sessionStorage` and persistent stable player IDs (`localStorage`)
- **Title-not-found retries** — typos and off-canon titles get up to 3 free retries per turn instead of instant elimination
- **Id-based actor matching** with name-fallback for legacy chains, eliminating same-name collisions and punctuation drift
- **"Why was I eliminated?" learning card** — losers see a side-by-side cast comparison showing what didn't connect
- **Quit Game button** — graceful in-game forfeit, no 15-second wait for everyone else

**Daily Challenge & Solo Depth**

- One attempt per UTC day per player, NX-locked in Redis
- Deterministic seed via FNV-1a hash → curated 49-movie starter list (extensible)
- Per-day leaderboard ranked by chain length
- Wordle-style "Daily #N" puzzle numbering, copy-result share button
- **Animated chain replay** — re-watch your run beat-by-beat after finishing
- **Solo objectives** — 6 era-based per-game challenges with +5 bonus on hit
- **Streak milestones** at 3 / 5 / 10 / 15 plays awarding scaled bonus points
- **Personal best** chain length surfaced at game start

**Personal Stats**

- Lifetime per-player tracking: games played, wins, longest chain, total plays
- Per-mode breakdown (classic / team / solo / speed / daily)
- "Favorite connector" — the actor you've most used to bridge chains
- 90-day retention; stableId-keyed (anonymous, no account required)

**Matchmaking & Social**

- Public lobby browser with **skill bracket** (🌱 New / 🎯 Casual / 🏆 Vet), **vibe tag** (🗣️ Chatty / 💬 Casual / 🔇 Quiet), and **last-game chain length** on each card
- Private rooms with shareable invite links
- Spectator mode with automatic promotion to player at round end
- **Spectator predictions** — vote will-they-get-it on each turn, see room-wide accuracy after the play resolves
- Real-time lobby chat and emoji reactions
- **Typing indicator** — subtle "X is typing…" presence cue during the active player's turn
- Host controls: kick players, configure game mode / theme / modifiers before the match
- Shareable PNG recap cards of the full movie chain

**First-Time Player Experience**

- **Guided tutorial** — 90-second client-side walkthrough with a hardcoded Marvel chain, gated on `localStorage` so it runs once. Replayable from How-to-Play.

**Audio & Polish**

- `playSfx(name)` API with **sample-or-synth fallback** — drop `/public/sfx/{name}.mp3` files in to upgrade from synthesized SFX to real samples without code changes
- 5 named SFX: success / fail / tick / win / elimination
- **CSS confetti burst** on game-end
- `prefers-reduced-motion` honored at both CSS and JS layers (parallax, haptics, animations)
- Visible focus ring (`:focus-visible`) for keyboard users
- Modal focus trap with focus restoration

**Infrastructure**

- Redis-backed distributed lock (`SET NX PX`) prevents race conditions during concurrent move submissions
- Per-socket Redis rate limiting on all events (join, submit, chat, reactions, typing, predictions, daily, etc.)
- XSS protection — all user content written via DOM APIs, never `innerHTML`
- Graceful shutdown with Redis drain on `SIGTERM`/`SIGINT`
- In-memory poster cache with 30-minute background refresh
- **Lightweight telemetry** — Redis sorted-set sink, 7 instrumented events, admin endpoint at `/api/admin/stats`
- Versioned credits cache key (`credits:v2:`) for safe schema migrations
- 153 tests across 15 suites covering game logic, socket integration, reconnection, validation, telemetry, daily system, stats, themes, solo objectives, and client-side DOM rendering

---

## Architecture

```
client (Vanilla JS ES modules)
  ├── app.js          — input wiring, DOM event binding
  ├── socketClient.js — socket event handlers, screen transitions
  ├── ui.js           — all DOM rendering (no state ownership)
  ├── state.js        — single source of truth for client state
  ├── tutorial.js     — first-time guided walkthrough (client-only)
  └── utils.js        — audio (sample-or-synth), haptics, stable ID

server (Node.js / Express 5)
  ├── server.js               — HTTP server, Redis adapter, admin endpoints
  ├── socketHandlers.js       — socket event routing, rate limiting
  ├── gameLogic.js            — win conditions, turn timers, elimination
  ├── redisUtils.js           — all Redis I/O, credits cache (v2 schema)
  ├── telemetry.js            — event tracking, Redis sorted-set sink
  └── systems/
      ├── lobbySystem.js          — lobby lifecycle, reconnection, daily entry
      ├── matchSystem.js          — TMDB search, id-based validation, chain
      ├── dailySystem.js          — daily seed, attempts, per-day leaderboard
      ├── statsSystem.js          — per-player lifetime stats
      ├── soloObjectivesSystem.js — era-based solo objectives
      └── themesSystem.js         — genre + decade lobby filters

data/
  └── dailyMovies.json    — curated daily-challenge starter list (49 entries)
```

State lives entirely in Redis as serialized lobby objects, daily attempts, leaderboards, and stats hashes — enabling stateless server processes and straightforward horizontal scaling behind a Socket.io Redis adapter.

---

## Getting Started

**Prerequisites:** Node.js 18+, Redis 7+, and a [TMDB API read token](https://developer.themoviedb.org/docs/getting-started).

```bash
git clone https://github.com/Itsbryanfam/MovieMatch.git
cd MovieMatch
npm install
```

Create a `.env` file:

```env
TMDB_READ_TOKEN=your_tmdb_read_token_here
REDIS_URL=redis://localhost:6379
FRONTEND_URL=http://localhost:3000
ADMIN_SECRET=a_long_random_string_for_admin_endpoints
```

```bash
npm start        # production
npm test         # run test suite (153 tests across 15 suites)
```

Open [http://localhost:3000](http://localhost:3000).

**Optional — drop-in audio samples:** Place 5 MP3 files in `public/sfx/` (`success.mp3`, `fail.mp3`, `tick.mp3`, `win.mp3`, `elimination.mp3`) to replace the synthesized fallbacks. No code changes needed; missing files keep using the synth.

---

## Deployment

Designed for PaaS deployment (tested on Render):

1. Deploy as a **Node.js Web Service**
2. Provision a **Redis** instance
3. Set environment variables: `TMDB_READ_TOKEN`, `REDIS_URL`, `FRONTEND_URL`, `ADMIN_SECRET`

For multi-instance deployments, the Socket.io Redis adapter handles cross-process event broadcasting automatically.

**Admin endpoints** (all require `x-admin-secret` header matching `ADMIN_SECRET`):

| Endpoint | Purpose |
| :--- | :--- |
| `GET /api/admin/stats?days=7` | Per-event-type telemetry counts in the time window |
| `GET /api/admin/redis-stats` | Memory + key counts |
| `POST /api/admin/flush-credits` | Drop the cached TMDB credits keys |

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| Runtime | Node.js 18+ |
| Framework | Express 5 |
| Real-time | Socket.io 4 with Redis adapter |
| State store | Redis 7 |
| External API | TMDB (The Movie Database) |
| Frontend | Vanilla JS (ES modules), no build step |
| Testing | Jest — unit, integration, socket tests |

---

<div align="center">
Built by <a href="https://x.com/ItsBryanFam"><strong>Bryan Cortez</strong></a>
</div>
