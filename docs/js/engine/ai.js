// Computer players. They follow exactly the same rules as a person: they only
// produce the same moves a finger would (a throw, a hop, a pickup), and the
// engine judges them. Mistakes come from the seeded generator in the game
// state, so the same state and level always give the same move.

import { applyMove, expectation, THROW_ORIGIN, MAX_RANGE } from "./game.js";
import { squareCenter } from "./court.js";
import { nextFloat } from "./rng.js";

// aim:  how far (in cells) a throw can stray from the middle of the target square.
//       A stone needs to land within about 0.38 of the middle to count.
// jump: chance of botching the big jump or the pickup.
// hop:  chance of a slip on an ordinary hop.
export const LEVELS = {
  easy: { aim: 0.55, jump: 0.3, hop: 0.02 },
  medium: { aim: 0.4, jump: 0.1, hop: 0.002 },
  hard: { aim: 0.3, jump: 0.03, hop: 0 },
};

export function planMove(state, level) {
  const L = LEVELS[level] ?? LEVELS.medium;
  let rng = state.rng;
  const draw = () => {
    const r = nextFloat(rng);
    rng = r.state;
    return r.value;
  };
  const e = expectation(state);
  let move;

  if (e.kind === "throw") {
    const c = squareCenter(e.target);
    const x = c.x + (draw() * 2 - 1) * L.aim;
    const y = c.y + (draw() * 2 - 1) * L.aim;
    const dx = x - THROW_ORIGIN.x;
    const dy = y - THROW_ORIGIN.y;
    move = { type: "throw", angle: Math.atan2(dx, dy), power: Math.hypot(dx, dy) / MAX_RANGE };
  } else if (e.needsTiming) {
    const slip = draw() < L.jump;
    const mag = slip ? e.zone * (1.1 + draw() * 1.2) : e.zone * 0.7 * draw();
    const timing = Math.min(1, mag) * (draw() < 0.5 ? -1 : 1);
    move = e.kind === "pickup" ? { type: "pickup", timing } : { type: "hop", square: e.to, timing };
  } else if (draw() < L.hop) {
    // A slip: lands in the wrong square.
    move = { type: "hop", square: typeof e.to === "number" ? (e.to % 12) + 1 : 1, timing: 0 };
  } else {
    move = { type: "hop", square: e.to, timing: 0 };
  }
  return { move, rng };
}

// Play the computer's next move. Returns what applyMove returns.
export function playAiMove(state, level) {
  const { move, rng } = planMove(state, level);
  return applyMove({ ...state, rng }, move);
}
