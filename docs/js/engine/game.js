// Suwe rules engine: one pure function, applyMove(state, move) -> { state, events }.
//
// No screen code, no clock, no Math.random. Anything the player does with
// timing or aim arrives as recorded numbers inside the move, so the same state
// plus the same moves always give the same result. State is plain JSON.
//
// Moves:
//   { type: "throw",  angle, power }     angle in radians (0 = straight up the court), power 0..1
//   { type: "hop",    square, timing }   square is 1..12 or "start"; timing in -1..1, only judged on a jump over the stone
//   { type: "pickup", timing }
//
// Events (for the renderer to animate; the engine never waits on them):
//   throw, hop, turn, pickup, fail, out, match_over, course_done, advance, circuit, turn_end

import { SQUARES, START_POINT, squareCenter, stoneSquare, locate, isSquare } from "./court.js";
import { seedState } from "./rng.js";

export const START_LIVES = 5;
export const STONE_RADIUS = 0.075;
export const THROW_ORIGIN = Object.freeze({ x: 0.95, y: -0.6 });
export const MAX_RANGE = 8;
export const MAX_ANGLE = 1.2;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round4 = (v) => Math.round(v * 1e4) / 1e4;

export function createGame({ seed = 1, players = [{ id: "p1", name: "Guest" }] } = {}) {
  return {
    rng: seedState(seed),
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color ?? null, // house colour
      ai: p.ai ?? null, // null = a person, otherwise "easy" | "medium" | "hard"
      look: p.look ?? null, // start.ng style fields, kept so a saved match can be redrawn
      houses: [],
      lives: p.lives ?? START_LIVES, // a failed turn costs one; at 0 the player is out
      out: false,
      target: 1,
      circuits: 0,
      stats: { throws: 0, hits: 0, mistakes: 0 },
    })),
    current: 0,
    turnNo: 1,
    over: false, // true once nobody has lives left
    phase: "throw", // throw | hop | pickup
    at: "start", // where the current player stands: "start" or a square
    facing: "away", // away from us while going out, toward us on the way back
    holding: false, // stone in hand
    stone: null, // { x, y, square } while it lies on the court
    turn: null, // { target, steps, i } while hopping
  };
}

// --- throwing -----------------------------------------------------------------

export function resolveThrow({ angle, power }, from = THROW_ORIGIN) {
  const a = clamp(angle, -MAX_ANGLE, MAX_ANGLE);
  const d = clamp(power, 0, 1) * MAX_RANGE;
  return { x: round4(from.x + Math.sin(a) * d), y: round4(from.y + Math.cos(a) * d) };
}

// --- the hopping route --------------------------------------------------------

// Out: every square but the stone's, in order. Turn at the last one. Back: hop
// down to the square before the stone, pick it up, then carry on home.
export function buildSteps(T) {
  const steps = [];
  const last = T === 12 ? 11 : 12;
  let prev = "start";
  for (let n = 1; n <= last; n++) {
    if (n === T) continue;
    const skip = prev === "start" ? T === 1 && n === 2 : prev + 1 === T && n === prev + 2;
    steps.push({ kind: "hop", to: n, skip });
    prev = n;
  }
  steps.push({ kind: "turn" });
  const pickupAt = T === 12 ? 11 : T + 1;
  for (let n = last - 1; n >= pickupAt; n--) steps.push({ kind: "hop", to: n, skip: false });
  steps.push({ kind: "pickup", at: pickupAt });
  for (let n = pickupAt - 1; n >= 1; n--) steps.push({ kind: "hop", to: n, skip: false });
  steps.push({ kind: "hop", to: "start", skip: false });
  return steps;
}

// --- balance ------------------------------------------------------------------

// Half-width of the green zone on the -1..1 balance needle. Only the big jump
// over the stone's square and the pickup need it; ordinary hops are just taps.
// Higher squares get a narrower zone.
export function balanceZone(target, { skip = false, pickup = false } = {}) {
  let w = 0.7 - 0.025 * target;
  if (skip) w *= 0.85;
  if (pickup) w *= 0.9;
  return Math.max(0.25, w);
}

// null = steady. "line" = a bit off, foot lands on a chalk line. "balance" = way off.
function judge(timing, zone) {
  const a = Math.abs(timing);
  if (a <= zone) return null;
  return a <= zone * 1.5 ? "line" : "balance";
}

// What the current player has to do next, for the UI.
export function expectation(state) {
  const p = state.players[state.current];
  if (state.phase === "throw") return { kind: "throw", target: p.target };
  const step = state.turn.steps[state.turn.i];
  if (state.phase === "pickup") {
    return { kind: "pickup", needsTiming: true, zone: balanceZone(p.target, { pickup: true }) };
  }
  return {
    kind: "hop",
    to: step.to,
    needsTiming: step.skip,
    zone: balanceZone(p.target, { skip: step.skip }),
  };
}

export function accuracy(player) {
  return player.stats.throws ? Math.round((player.stats.hits / player.stats.throws) * 100) : 0;
}

// --- applying a move ----------------------------------------------------------

function pointOf(at) {
  return at === "start" ? { x: START_POINT.x, y: 0 } : squareCenter(at);
}

function fail(s, events, reason, at = null) {
  const p = s.players[s.current];
  p.stats.mistakes++;
  p.lives = Math.max(0, p.lives - 1);
  events.push({ type: "fail", reason, at, lives: p.lives });
  s.turnNo++;
  s.phase = "throw";
  s.at = "start";
  s.facing = "away";
  s.holding = false;
  s.stone = null;
  s.turn = null;
  if (p.lives === 0) {
    p.out = true;
    events.push({ type: "out", id: p.id, name: p.name });
  }
  // The turn goes to the next player who still has lives (it may be the same one).
  const n = s.players.length;
  let next = -1;
  for (let i = 1; i <= n && next < 0; i++) {
    if (!s.players[(s.current + i) % n].out) next = (s.current + i) % n;
  }
  if (next < 0) {
    s.over = true;
    events.push({ type: "match_over" });
  } else {
    s.current = next;
    events.push({ type: "turn_end", next: s.players[next].id });
  }
  return { state: s, events };
}

// Move on after a step is done: auto-run the turn-around, then wait for input.
function nextStep(s, events) {
  s.turn.i++;
  while (s.turn.steps[s.turn.i]?.kind === "turn") {
    events.push({ type: "turn" });
    s.facing = "toward";
    s.turn.i++;
  }
  s.phase = s.turn.steps[s.turn.i].kind === "pickup" ? "pickup" : "hop";
}

function courseDone(s, events) {
  const p = s.players[s.current];
  const T = p.target;
  events.push({ type: "course_done", target: T });
  s.phase = "throw";
  s.at = "start";
  s.facing = "away";
  s.holding = false;
  s.stone = null;
  s.turn = null;
  if (T === SQUARES) {
    p.target = 1;
    p.circuits++;
    events.push({ type: "circuit", circuits: p.circuits });
  } else {
    p.target = T + 1;
    events.push({ type: "advance", from: T, to: p.target });
  }
}

export function applyMove(prev, move) {
  const s = structuredClone(prev);
  const events = [];
  const p = s.players[s.current];
  const reject = (why) => ({ state: prev, events: [], rejected: why });
  if (s.over) return reject("match_over");

  if (move.type === "throw") {
    if (s.phase !== "throw") return reject("wrong_phase");
    const land = resolveThrow(move);
    const sq = stoneSquare(land.x, land.y, STONE_RADIUS);
    p.stats.throws++;
    if (sq === p.target) {
      p.stats.hits++;
      s.stone = { x: land.x, y: land.y, square: sq };
      s.turn = { target: p.target, steps: buildSteps(p.target), i: 0 };
      s.phase = "hop";
      events.push({ type: "throw", from: THROW_ORIGIN, to: land, hit: true, square: sq });
      return { state: s, events };
    }
    // A stone that lies partly on a chalk line is not "in". Landing wholly in
    // another square, or off the court, is a plain miss.
    const reason = sq === null && locate(land.x, land.y).square !== null ? "line_stone" : "miss";
    events.push({ type: "throw", from: THROW_ORIGIN, to: land, hit: false, square: sq, reason });
    return fail(s, events, reason);
  }

  if (move.type === "hop") {
    if (s.phase !== "hop") return reject("wrong_phase");
    const sq = move.square;
    if (sq !== "start" && !isSquare(sq)) return reject("bad_square");
    const step = s.turn.steps[s.turn.i];
    if (sq !== step.to) {
      // Entering the stone's square, or breaking the sequence.
      const reason = s.stone && sq === s.stone.square ? "stone_square" : "sequence";
      return fail(s, events, reason, sq === "start" ? null : pointOf(sq));
    }
    const reason = step.skip ? judge(move.timing, balanceZone(p.target, { skip: true })) : null;
    if (reason) {
      const dest = pointOf(step.to);
      if (reason === "balance") return fail(s, events, reason, dest);
      // Foot lands on the chalk line short of the square.
      const from = pointOf(s.at);
      const dx = dest.x - from.x;
      const dy = dest.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const at = { x: round4(dest.x - (dx / len) * 0.5), y: round4(dest.y - (dy / len) * 0.5) };
      return fail(s, events, reason, at);
    }
    events.push({ type: "hop", from: s.at, to: step.to, skip: step.skip });
    s.at = step.to;
    if (step.to === "start") {
      courseDone(s, events);
    } else {
      nextStep(s, events);
    }
    return { state: s, events };
  }

  if (move.type === "pickup") {
    if (s.phase !== "pickup") return reject("wrong_phase");
    if (judge(move.timing, balanceZone(p.target, { pickup: true }))) {
      return fail(s, events, "balance", pointOf(s.at));
    }
    events.push({ type: "pickup", at: s.at });
    s.stone = null;
    s.holding = true;
    nextStep(s, events);
    return { state: s, events };
  }

  return reject("unknown_move");
}
