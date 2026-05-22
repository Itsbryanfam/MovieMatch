// server/achievements.js — Phase 6b Achievements catalog + pure derivation.
// SERVER-AUTHORITATIVE single source of truth (CommonJS), mirroring the
// server/heroPuzzle.js lineage. The client never receives thresholds — the
// requestMyStats handler runs deriveEarned server-side and ships only the
// earned id set + a display catalog (clientCatalog). WHY server-side (not the
// client ESM seam the spec sketched): the equip path must re-derive the earned
// set to validate (defense at the persistence boundary), and a Node CommonJS
// module cannot synchronously require an ESM browser seam in this no-build
// project — so the catalog lives once, on the server, exactly like heroPuzzle.

// Each achievement is pure DATA: id (stable wire value, never changed), title
// (the equippable display string), description (the locked-row unlock hint),
// statPath (dotted path into the getStats() shape), threshold (earned when the
// stat is >= this). No predicate FUNCTIONS — one generic comparator
// (deriveEarned) reads statPath, keeping the catalog declarative + testable.
const ACHIEVEMENTS = Object.freeze([
  Object.freeze({ id: 'first_steps',         title: 'First Steps',            description: 'Play your first game.',       statPath: 'gamesPlayed',             threshold: 1 }),
  Object.freeze({ id: 'getting_hang',        title: 'Getting the Hang of It', description: 'Play 10 games.',              statPath: 'gamesPlayed',             threshold: 10 }),
  Object.freeze({ id: 'regular',             title: 'Regular',                description: 'Play 50 games.',              statPath: 'gamesPlayed',             threshold: 50 }),
  Object.freeze({ id: 'first_win',           title: 'First Win',              description: 'Win your first game.',        statPath: 'wins',                    threshold: 1 }),
  Object.freeze({ id: 'on_a_roll',           title: 'On a Roll',              description: 'Win 10 games.',               statPath: 'wins',                    threshold: 10 }),
  Object.freeze({ id: 'chain_builder',       title: 'Chain Builder',          description: 'Reach a chain of 10.',        statPath: 'longestChain',            threshold: 10 }),
  Object.freeze({ id: 'chain_master',        title: 'Chain Master',           description: 'Reach a chain of 25.',        statPath: 'longestChain',            threshold: 25 }),
  Object.freeze({ id: 'well_connected',      title: 'Well Connected',         description: 'Contribute 100 chain links.', statPath: 'totalPlays',              threshold: 100 }),
  Object.freeze({ id: 'team_player',         title: 'Team Player',            description: 'Win a team game.',            statPath: 'byMode.team.won',         threshold: 1 }),
  Object.freeze({ id: 'speed_demon',         title: 'Speed Demon',            description: 'Win a speed game.',           statPath: 'byMode.speed.won',        threshold: 1 }),
  Object.freeze({ id: 'solo_artist',         title: 'Solo Artist',            description: 'Win a solo game.',            statPath: 'byMode.solo.won',         threshold: 1 }),
  Object.freeze({ id: 'daily_devotee',       title: 'Daily Devotee',          description: 'Play 7 daily challenges.',    statPath: 'byMode.daily.played',     threshold: 7 }),
  Object.freeze({ id: 'signature_connector', title: 'Signature Connector',    description: 'Use one connector 5+ times.', statPath: 'favoriteConnector.count', threshold: 5 }),
]);

// Safe nested getter: walks a dotted path, returning 0 for any missing/null
// intermediate or non-numeric leaf. WHY default 0: every threshold is a
// positive number, so a missing stat is correctly "not earned" without the
// caller null-checking favoriteConnector / byMode.* etc.
function _statValue(stats, statPath) {
  if (!stats || typeof stats !== 'object') return 0;
  let cur = stats;
  for (const key of statPath.split('.')) {
    if (cur == null || typeof cur !== 'object') return 0;
    cur = cur[key];
  }
  return (typeof cur === 'number' && Number.isFinite(cur)) ? cur : 0;
}

// Pure derivation: array of earned achievement ids for a getStats()-shaped
// object. Never throws on partial/empty/garbage input.
function deriveEarned(stats) {
  return ACHIEVEMENTS
    .filter(a => _statValue(stats, a.statPath) >= a.threshold)
    .map(a => a.id);
}

// id → display title string, or null for an unknown id. The equip path uses
// this to resolve the stored id into the label attached to the broadcast
// player object (so clients render the string with no catalog lookup).
function titleLabel(id) {
  const found = ACHIEVEMENTS.find(a => a.id === id);
  return found ? found.title : null;
}

// Wire shape for the client wall: id/title/description only (no thresholds).
function clientCatalog() {
  return ACHIEVEMENTS.map(a => ({ id: a.id, title: a.title, description: a.description }));
}

module.exports = { ACHIEVEMENTS, deriveEarned, titleLabel, clientCatalog };
