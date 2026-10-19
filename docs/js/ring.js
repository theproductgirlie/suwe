// The throw: press and hold the stone, a red mark circles the square you are aiming at, let go and
// the stone flies where the mark was (plus a small miss). Pure functions: the screen and the random numbers stay
// in main.js, so the pace and the miss can be tested.

import { squareCenter } from "./engine/court.js";
import { THROW_ORIGIN, TIE_MARK, MAX_ANGLE, MAX_RANGE } from "./engine/game.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// How hard the match is: the computer's level (a match with people is a medium one).
export const LEVEL_FACTOR = { easy: 0.85, medium: 1, hard: 1.35 };
export const levelFactor = (level) => LEVEL_FACTOR[level] ?? 1;

// How fast the red mark goes round (radians per second): slow and steady, a little quicker for
// higher target squares and a lot quicker on Hard.
export const ringSpeed = (target, level) => (2.3 + 0.12 * target) * levelFactor(level);

// Where the red mark is `sec` seconds after the stone was pressed. It circles the square you are
// aiming at, crossing it and the squares around it, so you let go when it is on the square.
// For Ra Ile (any empty square) it circles the whole court; for the tie-break it circles the red mark.
export function ringPosition(sec, { phase = "throw", target = 1, level = null } = {}) {
  const f = levelFactor(level);
  const w = phase === "throw" ? ringSpeed(target, level) : 2.2 * f;
  const a = sec * w - Math.PI / 2; // starts at the top of the circle
  if (phase === "tiebreak") return { x: TIE_MARK.x + 1.1 * Math.cos(a), y: TIE_MARK.y + 0.9 * Math.sin(a) };
  if (phase === "ra_ile") return { x: 1 + 0.95 * Math.cos(a), y: 3 + 2.6 * Math.sin(a) };
  const c = squareCenter(target);
  return { x: c.x + 0.62 * Math.cos(a), y: c.y + 0.62 * Math.sin(a) };
}

// The radius (in cells) of the small random miss: bigger on higher squares and on Hard.
export function spread({ phase = "throw", target = 1, level = null } = {}) {
  const base = phase === "tiebreak" ? 0.12 : 0.04 + 0.01 * target;
  return base * levelFactor(level);
}

// A place on the court to the move the engine understands (an angle and a power from the throwing spot).
export function throwToward(x, y, from = THROW_ORIGIN) {
  const dx = x - from.x;
  const dy = y - from.y;
  return { angle: clamp(Math.atan2(dx, dy), -MAX_ANGLE, MAX_ANGLE), power: clamp(Math.hypot(dx, dy) / MAX_RANGE, 0, 1) };
}
