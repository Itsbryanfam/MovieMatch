# 🎬 MovieMatch

A fast-paced, highly-polished multiplayer web game where players take turns linking movies by shared actors!

## 🚀 Features

- **Linear-Inspired Premium UI:** Crafted with deep OLED blacks, structural minimalism, crisp typographic hierarchy using "Plus Jakarta Sans", and micro-interactions like staggered feed entrances.
- **Real-Time Multiplayer Engine:** Built on Express and Socket.io for instantaneous lobby management and turn state synchronization.
- **Live TMDB Validation:** Integrates directly with The Movie Database (TMDB) API via backend caching, validating user input securely against live production data for flawlessly accurate chains.
- **Suspenseful Server-side Timers:** As the chain gets longer, the server tightens the timer mechanics (dropping from 60s down to 10s), automatically pausing during live API fetches so nobody loses time to internet lag.
- **Web Audio Context Soundscapes:** Emits lightweight, zero-latency synthesizer sounds mapped to success chimes, failure buzzes, and high-tension timer sweeps. 

## 📦 Setup & Play

1. Requires **Node.js**.
2. **Environment Variable:** Ensure you have the TMDB credentials inserted inside an `.env` file at the root.
3. In your terminal, run:

\`\`\`bash
npm start
\`\`\`

4. Open your browser and go to [http://localhost:3000](http://localhost:3000).
5. Open multiple tabs across different devices on your network to simulate players.
6. Enter a lobby code, connect, and hit **Start Match**!

## 📜 How To Play

- Wait for your turn! Your name will highlight on the left sidebar.
- Type the name of a connecting movie into the sleek input field and hit **Enter** or tap the submit icon. 
- **Rule 1:** The **first player** can type ANY valid movie to start the chain.
- **Rule 2:** The **following players** must type a movie that shares **at least one actor** with the previous movie.
- **Rule 3:** You cannot reuse movies from the current chain!
- **Rule 4:** If you run out of time (the top progress bar vanishes) or fail with an invalid connection, you are eliminated!
- **Rule 5:** The last surviving player triggers the Win celebration!
