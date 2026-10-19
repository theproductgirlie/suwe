// The throw: press and hold the stone, a ring walks along the squares, let go and the stone flies
// where the ring was (plus a small miss). Pure functions: the screen and the random numbers stay
// in main.js, so the pace and the miss can be tested.

import { squareCenter } from "./engine/court.js";
import { THROW_ORIGIN, TIE_MARK, MAX_ANGLE, MAX_RANGE } from "./engine/game.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// How hard the match is: the computer's level (a match with people is a medium one).
export const LEVEL_FACTOR = { easy: 0.85, medium: 1, hard: 1.35 };
export const levelFactor = (level) => LEVEL_FACTOR[level] ?? 1;

// Squares per second: steady, faster for higher target squares and on Hard.
export const ringSpeed = (target, level) => (1.7 + 0.1 * target) * levelFactor(level);

const tri = (x) => Math.abs((((x % 2) + 2) % 2) - 1) * 2 - 1; // triangle wave, -1..1

// Where the ring is `sec` seconds after the stone was pressed. It walks the squares in hop order,
// 1 to 12 and back. For the tie-break it sweeps across the red mark.
export function ringPosition(sec, { phase = "throw", target = 1, level = null } = {}) {
  const f = levelFactor(level);
  if (phase === "tiebreak") return { x: TIE_MARK.x + 1.15 * tri(sec * 0.9 * f), y: TIE_MARK.y + 0.9 * tri(sec * 0.6 * f + 0.5) };
  const u = (sec * ringSpeed(target, level)) % 22;
  const idx = u <= 11 ? u : 22 - u; // 0 (square 1) to 11 (square 12)
  const i = Math.floor(idx);
  const a = squareCenter(i + 1);
  const b = squareCenter(Math.min(12, i + 2));
  const t = idx - i;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// The radius (in cells) of the small random miss: bigger on higher squares and on Hard.
export function spread({ phase = "throw", target = 1, level = null } = {}) {
  const base = phase === "tiebreak" ? 0.14 : 0.07 + 0.016 * target;
  return base * levelFactor(level);
}

// A place on the court to the move the engine understands (an angle and a power from the throwing spot).
export function throwToward(x, y, from = THROW_ORIGIN) {
  const dx = x - from.x;
  const dy = y - from.y;
  return { angle: clamp(Math.atan2(dx, dy), -MAX_ANGLE, MAX_ANGLE), power: clamp(Math.hypot(dx, dy) / MAX_RANGE, 0, 1) };
}
