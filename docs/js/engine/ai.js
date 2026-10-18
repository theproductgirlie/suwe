// Computer players. They follow exactly the same rules as a person: they only
// produce the same moves a finger would (a throw, a hop, a pickup), and the
// engine judges them. Mistakes come from the seeded generator in the game
// state, so the same state and level always give the same move.

import { applyMove, expectation, THROW_ORIGIN, MAX_RANGE, TIE_MARK } from "./game.js";
import { squareCenter } from "./court.js";
import { nextFloat } from "./rng.js";

// aim:  how far (in cells) a throw can stray from the middle of the target square.
//       A stone needs to land within about 0.38 of the middle to count.
// jump: chance of botching the big jump or the pickup.
// hop:  chance of a slip on an ordinary hop.
export const LEVELS = {
  easy: { aim: 0.44, jump: 0.22, hop: 0.012 },
  medium: { aim: 0.39, jump: 0.08, hop: 0.003 },
  hard: { aim: 0.3, jump: 0.02, hop: 0 },
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

  // A throw aimed at a point, with the level's wobble.
  const aimAt = (type, c, spread) => {
    const x = c.x + (draw() * 2 - 1) * spread;
    const y = c.y + (draw() * 2 - 1) * spread;
    const dx = x - THROW_ORIGIN.x;
    const dy = y - THROW_ORIGIN.y;
    return { type, angle: Math.atan2(dx, dy), power: Math.hypot(dx, dy) / MAX_RANGE };
  };

  if (e.kind === "throw") {
    move = aimAt("throw", squareCenter(e.target), L.aim);
  } else if (e.kind === "backthrow") {
    move = aimAt("backthrow", squareCenter(chooseHouse(state, level, draw)), L.aim);
  } else if (e.kind === "tiebreak") {
    move = aimAt("tiebreak", TIE_MARK, L.aim * 0.8);
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

// Which free square to try to buy. Easy and medium take any; hard goes for the
// square that gets in the most opponents' way (one they have yet to reach),
// preferring squares nearer the start, which are easier to hit.
function chooseHouse(state, level, draw) {
  const free = [];
  for (let n = 1; n <= 12; n++) if (!state.owners[n - 1]) free.push(n);
  if (level !== "hard") return free[Math.floor(draw() * free.length)];
  const me = state.players[state.current];
  const rivals = state.players.filter((p) => p.id !== me.id && !p.out);
  const score = (n) => rivals.filter((p) => p.target <= n).length;
  return [...free].sort((a, b) => score(b) - score(a) || a - b)[0];
}

// Play the computer's next move. Returns what applyMove returns.
export function playAiMove(state, level) {
  const { move, rng } = planMove(state, level);
  return applyMove({ ...state, rng }, move);
}
