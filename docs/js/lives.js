// Lives: 5 hearts, one comes back every 30 minutes until full again.
// Pure functions; the caller passes `now` (ms) and keeps the saved state.

export const MAX_LIVES = 5;
export const REFILL_MS = 30 * 60 * 1000;

export const freshLives = () => ({ lives: MAX_LIVES, since: null });

// Accepts whatever was saved (or nothing) and returns a valid state.
export function normalizeLives(saved) {
  const n = saved && Number.isInteger(saved.lives) ? saved.lives : MAX_LIVES;
  const lives = Math.min(MAX_LIVES, Math.max(0, n));
  const since = lives < MAX_LIVES && Number.isFinite(saved?.since) ? saved.since : null;
  return { lives, since };
}

// Bring the state up to date: hand back any lives earned while away.
export function tickLives(s, now) {
  let { lives, since } = s;
  if (lives >= MAX_LIVES) return freshLives();
  // No timer running, or the phone clock went backwards: restart the count now.
  if (since === null || since > now) since = now;
  const gained = Math.floor((now - since) / REFILL_MS);
  if (gained > 0) {
    lives = Math.min(MAX_LIVES, lives + gained);
    since += gained * REFILL_MS;
  }
  return lives >= MAX_LIVES ? freshLives() : { lives, since };
}

export function loseLife(s, now) {
  const t = tickLives(s, now);
  if (t.lives <= 0) return t;
  return { lives: t.lives - 1, since: t.since ?? now };
}

export const canPlay = (s, now) => tickLives(s, now).lives > 0;

// Milliseconds until the next heart, or 0 when full.
export function msToNextLife(s, now) {
  const t = tickLives(s, now);
  return t.lives >= MAX_LIVES ? 0 : REFILL_MS - (now - t.since);
}
