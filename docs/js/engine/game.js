// Suwe rules engine: one pure function, applyMove(state, move) -> { state, events }.
//
// No screen code, no clock, no Math.random. Anything the player does with
// timing or aim arrives as recorded numbers inside the move, so the same state
// plus the same moves always give the same result. State is plain JSON.
//
// Moves:
//   { type: "throw",     angle, power }   angle in radians (0 = straight up the court), power 0..1
//   { type: "hop",       square, timing } square is 1..12, "start", or "out" (a tap off the court);
//                                         timing in -1..1, only judged on a jump over a square
//   { type: "pickup",    timing }
//   { type: "backthrow", angle, power }   Ra Ile: the over-the-shoulder throw that buys a house
//   { type: "tiebreak",  angle, power }   closest stone to TIE_MARK wins a tied match
//
// Events (for the renderer to animate; the engine never waits on them):
//   throw, hop, turn, pickup, fail, out, course_done, advance, circuit, backthrow, house,
//   tiebreak_start, tiebreak_throw, tiebreak_next, turn_end, match_over

import { SQUARES, START_POINT, squareCenter, stoneSquare, locate, isSquare } from "./court.js";
import { seedState } from "./rng.js";

export const START_LIVES = 5;
export const STONE_RADIUS = 0.075;
export const THROW_ORIGIN = Object.freeze({ x: 0.95, y: -0.6 });
export const MAX_RANGE = 8;
export const MAX_ANGLE = 1.2;
export const TIE_MARK = Object.freeze({ x: 1, y: 3 });
const TIE_ROUNDS = 5;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round4 = (v) => Math.round(v * 1e4) / 1e4;

export function createGame({ seed = 1, players = [{ id: "p1", name: "Player" }] } = {}) {
  return {
    rng: seedState(seed),
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color ?? null, // house colour
      ai: p.ai ?? null, // null = a person, otherwise "easy" | "medium" | "hard"
      look: p.look ?? null, // start.ng style fields, kept so a saved match can be redrawn
      sash: Boolean(p.sash), // show the colour as a sash (outfit must stay as the player's own)
      houses: [], // squares this player owns
      lives: p.lives ?? START_LIVES, // a failed turn costs one; at 0 the player is out
      out: false,
      target: 1,
      circuits: 0,
      stats: { throws: 0, hits: 0, mistakes: 0 },
    })),
    owners: Array(SQUARES).fill(null), // owners[n - 1] = id of the player who owns square n
    current: 0,
    turnNo: 1,
    over: false,
    result: null, // { winners: [ids], reason, tie } once over
    tie: null, // { ids, shots, round, i } during a tie-break
    phase: "throw", // throw | hop | pickup | ra_ile | tiebreak
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

// --- houses ---------------------------------------------------------------------

// Squares this player may not enter or throw into: other players' houses.
export function blockedFor(state, player) {
  const out = [];
  for (let n = 1; n <= SQUARES; n++) {
    const o = state.owners[n - 1];
    if (o && o !== player.id) out.push(n);
  }
  return out;
}

// The first square at or after `from` the player can aim at, or null if the
// rest of the course is all other players' houses.
function nextTarget(s, p, from) {
  for (let t = from; t <= SQUARES; t++) {
    const o = s.owners[t - 1];
    if (!o || o === p.id) return t;
  }
  return null;
}

// --- the hopping route --------------------------------------------------------

// Out: every free square but the stone's, in order (other players' houses are
// jumped over). Turn at the last one. Back: hop down to the square before the
// stone, pick it up, then carry on home. A hop that leaps over squares is a
// "skip": it needs the balance needle.
export function buildSteps(T, blocked = []) {
  const avail = [];
  for (let n = 1; n <= SQUARES; n++) if (!blocked.includes(n)) avail.push(n);
  const out = avail.filter((n) => n !== T);
  if (out.length === 0) return [];
  const last = out[out.length - 1];
  const steps = [];
  let prev = 0; // 0 = outside, at the start
  for (const n of out) {
    steps.push({ kind: "hop", to: n, skip: n - prev > 1 });
    prev = n;
  }
  steps.push({ kind: "turn" });
  const above = avail.filter((n) => n > T);
  const pickupAt = above.length ? above[0] : last;
  prev = last;
  for (const n of out.filter((m) => m < last && m >= pickupAt).reverse()) {
    steps.push({ kind: "hop", to: n, skip: prev - n > 1 });
    prev = n;
  }
  steps.push({ kind: "pickup", at: pickupAt });
  prev = pickupAt;
  for (const n of avail.filter((m) => m < pickupAt).reverse()) {
    steps.push({ kind: "hop", to: n, skip: prev - n > 1 });
    prev = n;
  }
  steps.push({ kind: "hop", to: "start", skip: false });
  return steps;
}

// --- balance ------------------------------------------------------------------

// Half-width of the green zone on the -1..1 balance needle. Only the big jump
// over a square and the pickup need it; ordinary hops are just taps.
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

// What the current player has to do next, for the UI and the computer.
export function expectation(state) {
  const p = state.players[state.current];
  if (state.phase === "throw") return { kind: "throw", target: p.target };
  if (state.phase === "ra_ile") return { kind: "backthrow" };
  if (state.phase === "tiebreak") return { kind: "tiebreak", mark: TIE_MARK };
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

function resetStance(s) {
  s.at = "start";
  s.facing = "away";
  s.holding = false;
  s.stone = null;
  s.turn = null;
}

// Decide how the match ended and stop it.
function finish(s, events, reason) {
  const counts = s.players.map((p) => p.houses.length);
  const most = Math.max(...counts);
  const leaders = s.players.filter((p) => p.houses.length === most).map((p) => p.id);
  if (reason === "all_claimed" && leaders.length > 1) {
    s.phase = "tiebreak";
    resetStance(s);
    s.tie = { ids: leaders, shots: {}, round: 1, i: 0 };
    s.current = s.players.findIndex((p) => p.id === leaders[0]);
    events.push({ type: "tiebreak_start", ids: leaders, round: 1 });
    return;
  }
  s.over = true;
  s.result = { winners: leaders, reason, tie: leaders.length > 1 };
  events.push({ type: "match_over", ...s.result });
}

// The player has been all the way round: time to try to buy a house.
function circuitDone(s, events) {
  const p = s.players[s.current];
  p.circuits++;
  p.target = 1;
  s.phase = "ra_ile";
  resetStance(s);
  s.facing = "toward";
  events.push({ type: "circuit", circuits: p.circuits });
}

// Make sure the player's target is a square they may aim at now.
function settleTarget(s, events) {
  const p = s.players[s.current];
  const t = nextTarget(s, p, p.target);
  if (t === null) circuitDone(s, events);
  else p.target = t;
}

function fail(s, events, reason, at = null) {
  const p = s.players[s.current];
  p.stats.mistakes++;
  p.lives = Math.max(0, p.lives - 1);
  events.push({ type: "fail", reason, at, lives: p.lives });
  s.turnNo++;
  s.phase = "throw";
  resetStance(s);
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
    finish(s, events, "out_of_lives");
  } else {
    s.current = next;
    events.push({ type: "turn_end", next: s.players[next].id });
    settleTarget(s, events);
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
  resetStance(s);
  const nt = T < SQUARES ? nextTarget(s, p, T + 1) : null;
  if (nt === null) {
    circuitDone(s, events);
  } else {
    p.target = nt;
    events.push({ type: "advance", from: T, to: nt });
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
      events.push({ type: "throw", from: THROW_ORIGIN, to: land, hit: true, square: sq });
      const steps = buildSteps(p.target, blockedFor(s, p));
      if (steps.length === 0) {
        // Every other square is someone else's house: nothing to hop over.
        s.stone = { x: land.x, y: land.y, square: sq };
        courseDone(s, events);
        return { state: s, events };
      }
      s.stone = { x: land.x, y: land.y, square: sq };
      s.turn = { target: p.target, steps, i: 0 };
      s.phase = "hop";
      return { state: s, events };
    }
    // A stone that lies partly on a chalk line is not "in". Landing wholly in
    // another square, or off the court, is a plain miss; into someone's house is worse.
    const owner = sq === null ? null : s.owners[sq - 1];
    let reason = "miss";
    if (owner && owner !== p.id) reason = "opponent_house";
    else if (sq === null && locate(land.x, land.y).square !== null) reason = "line_stone";
    events.push({ type: "throw", from: THROW_ORIGIN, to: land, hit: false, square: sq, reason });
    return fail(s, events, reason);
  }

  if (move.type === "hop") {
    if (s.phase !== "hop") return reject("wrong_phase");
    const sq = move.square;
    if (sq !== "start" && sq !== "out" && !isSquare(sq)) return reject("bad_square");
    const step = s.turn.steps[s.turn.i];
    if (sq !== step.to) {
      // A tap off the court, the stone's square, someone's house, or just the wrong square.
      const owner = isSquare(sq) ? s.owners[sq - 1] : null;
      let reason = "sequence";
      if (sq === "out") reason = "outside";
      else if (s.stone && sq === s.stone.square) reason = "stone_square";
      else if (owner && owner !== p.id) reason = "opponent_house";
      return fail(s, events, reason, sq === "out" || sq === "start" ? null : pointOf(sq));
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
    if (step.to === "start") courseDone(s, events);
    else nextStep(s, events);
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

  if (move.type === "backthrow") {
    if (s.phase !== "ra_ile") return reject("wrong_phase");
    const land = resolveThrow(move);
    const sq = stoneSquare(land.x, land.y, STONE_RADIUS);
    // Only a square nobody owns can be bought.
    const claimed = sq !== null && s.owners[sq - 1] === null;
    p.stats.throws++;
    events.push({ type: "backthrow", from: THROW_ORIGIN, to: land, square: sq, claimed });
    if (claimed) {
      p.stats.hits++;
      s.owners[sq - 1] = p.id;
      p.houses.push(sq);
      events.push({ type: "house", square: sq, id: p.id, name: p.name, color: p.color });
    }
    // Hit or miss, the next round starts again from square 1.
    s.phase = "throw";
    resetStance(s);
    if (s.owners.every((o) => o !== null)) {
      finish(s, events, "all_claimed");
    } else {
      settleTarget(s, events);
    }
    return { state: s, events };
  }

  if (move.type === "tiebreak") {
    if (s.phase !== "tiebreak") return reject("wrong_phase");
    const land = resolveThrow(move);
    const dist = round4(Math.hypot(land.x - TIE_MARK.x, land.y - TIE_MARK.y));
    const t = s.tie;
    t.shots[p.id] = dist;
    events.push({ type: "tiebreak_throw", id: p.id, name: p.name, to: land, dist });
    t.i++;
    if (t.i < t.ids.length) {
      s.current = s.players.findIndex((q) => q.id === t.ids[t.i]);
      events.push({ type: "tiebreak_next", next: t.ids[t.i] });
      return { state: s, events };
    }
    const best = Math.min(...t.ids.map((id) => t.shots[id]));
    const closest = t.ids.filter((id) => t.shots[id] === best);
    if (closest.length === 1 || t.round >= TIE_ROUNDS) {
      // After several dead heats the first seat wins, so a match always ends.
      s.over = true;
      s.phase = "throw";
      s.result = { winners: [closest[0]], reason: "tiebreak", tie: false };
      s.tie = null;
      events.push({ type: "match_over", ...s.result });
    } else {
      s.tie = { ids: closest, shots: {}, round: t.round + 1, i: 0 };
      s.current = s.players.findIndex((q) => q.id === closest[0]);
      events.push({ type: "tiebreak_start", ids: closest, round: t.round + 1 });
    }
    return { state: s, events };
  }

  return reject("unknown_move");
}
