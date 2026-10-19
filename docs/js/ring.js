// The throw: pull the stone back (a finger or mouse drag, or hold Space) and let go. The aim sways
// left and right by itself while you hold, so you time the release; the stone flies to where the
// red landing circle was at that moment. Pure functions: the screen and the clock stay in main.js.

import { squareCenter } from "./engine/court.js";
import { THROW_ORIGIN, MAX_ANGLE, MAX_RANGE, resolveThrow } from "./engine/game.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// How far the aim sways (degrees each way) and how fast (swings per second), by the computer's level.
// A match between people is a medium one. Squares 7 to 12 sway 30% further.
export const SWAY = {
  easy: { deg: 6, hz: 0.5 },
  medium: { deg: 10, hz: 0.8 },
  hard: { deg: 14, hz: 1.2 },
};
const swayOf = (level) => SWAY[level] ?? SWAY.medium;

export function swayAmplitude(level, target) {
  return swayOf(level).deg * (target >= 7 ? 1.3 : 1); // degrees
}

// The sway (radians) `sec` seconds after the stone was pressed: a sine wave.
export function swayAngle(sec, level, target) {
  return ((swayAmplitude(level, target) * Math.PI) / 180) * Math.sin(2 * Math.PI * swayOf(level).hz * sec);
}

// A drag becomes an aim: the pull from the stone to the finger, the other way, is the direction;
// the length is the distance. Returns null while the finger is not pulled back (down the screen).
export function aimFromPull(stone, finger, maxDrag) {
  const dirX = stone.x - finger.x;
  const dirY = finger.y - stone.y;
  if (dirY <= 4) return null;
  return {
    angle: clamp(Math.atan2(dirX, dirY), -MAX_ANGLE, MAX_ANGLE),
    power: Math.min(1, Math.hypot(dirX, dirY) / maxDrag),
  };
}

// Holding Space instead: the pull grows and shrinks steadily (a sweep takes 2.4 s) and the aim points
// at the square you are throwing at, so one key is enough.
export function keyboardAim(sec, at) {
  const c = typeof at === "number" ? squareCenter(at) : at; // a square number, or a place on the court
  const dx = c.x - THROW_ORIGIN.x;
  const dy = c.y - THROW_ORIGIN.y;
  const t = Math.abs((((sec / 2.4) % 2) + 2) % 2 - 1); // 1 -> 0 -> 1: a triangle wave
  return { angle: clamp(Math.atan2(dx, dy), -MAX_ANGLE, MAX_ANGLE), power: 0.2 + 0.8 * (1 - t) };
}

// Where the stone would land with this aim and this much sway (cells on the court).
export function landing(aim, sway = 0) {
  return resolveThrow({ angle: clamp(aim.angle + sway, -MAX_ANGLE, MAX_ANGLE), power: aim.power });
}

// The same, as the move the engine understands.
export function throwMove(aim, sway = 0) {
  return { angle: clamp(aim.angle + sway, -MAX_ANGLE, MAX_ANGLE), power: aim.power };
}

// A place on the court to an aim (used by tests and by the Space pull to find a power for a distance).
export function throwToward(x, y, from = THROW_ORIGIN) {
  const dx = x - from.x;
  const dy = y - from.y;
  return { angle: clamp(Math.atan2(dx, dy), -MAX_ANGLE, MAX_ANGLE), power: clamp(Math.hypot(dx, dy) / MAX_RANGE, 0, 1) };
}
