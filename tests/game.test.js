import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  applyMove,
  buildSteps,
  balanceZone,
  expectation,
  accuracy,
  resolveThrow,
  THROW_ORIGIN,
  MAX_RANGE,
} from "../docs/js/engine/game.js";
import { squareCenter } from "../docs/js/engine/court.js";

// A throw aimed at the middle of a square.
function throwAt(x, y) {
  const dx = x - THROW_ORIGIN.x;
  const dy = y - THROW_ORIGIN.y;
  return { type: "throw", angle: Math.atan2(dx, dy), power: Math.hypot(dx, dy) / MAX_RANGE };
}
const throwSquare = (n) => {
  const c = squareCenter(n);
  return throwAt(c.x, c.y);
};

// Play the whole course for the current target with perfect timing.
function playCourse(state) {
  let s = state;
  const all = [];
  let guard = 0;
  while (s.phase !== "throw" && guard++ < 100) {
    const e = expectation(s);
    const move =
      e.kind === "pickup" ? { type: "pickup", timing: 0 } : { type: "hop", square: e.to, timing: 0 };
    const r = applyMove(s, move);
    s = r.state;
    all.push(...r.events);
  }
  return { state: s, events: all };
}

test("every target square can be thrown at and hit", () => {
  for (let t = 1; t <= 12; t++) {
    const g = createGame();
    g.players[0].target = t;
    const r = applyMove(g, throwSquare(t));
    assert.equal(r.state.phase, "hop", `target ${t}`);
    assert.equal(r.state.stone.square, t);
  }
});

test("a throw into the wrong square ends the turn and keeps the target", () => {
  const g = createGame();
  const r = applyMove(g, throwSquare(3));
  assert.equal(r.state.phase, "throw");
  assert.equal(r.state.players[0].target, 1);
  assert.equal(r.state.turnNo, 2);
  assert.equal(r.events.find((e) => e.type === "fail").reason, "miss");
  assert.equal(r.state.stone, null);
});

test("a stone on a chalk line fails; off the court is a plain miss", () => {
  const g = createGame();
  const onLine = applyMove(g, throwAt(0.5, 1.0));
  assert.equal(onLine.events.find((e) => e.type === "fail").reason, "line_stone");
  const outside = applyMove(g, throwAt(0.5, 7.5));
  assert.equal(outside.events.find((e) => e.type === "fail").reason, "miss");
});

test("hopping route skips the stone's square", () => {
  const hops = (T) => buildSteps(T).filter((s) => s.kind === "hop");
  const out = (T) => {
    const steps = buildSteps(T);
    return steps.slice(0, steps.findIndex((s) => s.kind === "turn")).map((s) => s.to);
  };
  assert.deepEqual(out(1), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(out(5), [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(out(12), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  for (let T = 1; T <= 12; T++) {
    const first = buildSteps(T).filter((s) => s.kind === "hop");
    assert.equal(first.at(-1).to, "start", "course ends back at the start");
    assert.ok(hops(T).length > 0);
  }
});

test("jumping over the stone is flagged as a skip", () => {
  const skips = buildSteps(5).filter((s) => s.skip);
  assert.deepEqual(skips.map((s) => s.to), [6]);
  assert.deepEqual(buildSteps(1).filter((s) => s.skip).map((s) => s.to), [2]);
  assert.deepEqual(buildSteps(12).filter((s) => s.skip), []);
});

test("return leg stops to pick up at the square before the stone", () => {
  for (let T = 1; T <= 12; T++) {
    const steps = buildSteps(T);
    const pick = steps.find((s) => s.kind === "pickup");
    assert.equal(pick.at, T === 12 ? 11 : T + 1);
  }
});

test("a clean course advances the target and the turn continues", () => {
  let s = applyMove(createGame(), throwSquare(1)).state;
  const done = playCourse(s);
  assert.equal(done.state.phase, "throw");
  assert.equal(done.state.players[0].target, 2);
  assert.equal(done.state.turnNo, 1, "same turn: a clean course does not end it");
  assert.equal(done.state.at, "start");
  assert.equal(done.state.holding, false);
  const types = done.events.map((e) => e.type);
  assert.ok(types.includes("turn") && types.includes("pickup") && types.includes("advance"));
  assert.equal(types.at(-1), "advance");
});

test("all 12 squares in a row complete a circuit and go back to 1", () => {
  let s = createGame();
  let events = [];
  for (let t = 1; t <= 12; t++) {
    s = applyMove(s, throwSquare(t)).state;
    const done = playCourse(s);
    s = done.state;
    events = done.events;
  }
  assert.equal(s.players[0].target, 1);
  assert.equal(s.players[0].circuits, 1);
  assert.equal(events.at(-1).type, "circuit");
  assert.equal(s.players[0].stats.mistakes, 0);
  assert.equal(accuracy(s.players[0]), 100);
});

test("failure resumes at the same target and keeps progress", () => {
  let s = createGame();
  s = playCourse(applyMove(s, throwSquare(1)).state).state; // target 2
  s = playCourse(applyMove(s, throwSquare(2)).state).state; // target 3
  s = applyMove(s, throwSquare(3)).state; // stone down
  const bad = applyMove(s, { type: "hop", square: 1, timing: 0 }); // wrong order: first hop is 1, allowed
  assert.equal(bad.state.phase, "hop");
  const stumble = applyMove(bad.state, { type: "hop", square: 2, timing: 0.99 });
  assert.equal(stumble.events.find((e) => e.type === "fail").reason, "balance");
  assert.equal(stumble.state.players[0].target, 3, "resumes at the target where it failed");
  assert.equal(stumble.state.phase, "throw");
  assert.equal(stumble.state.stone, null);
  assert.equal(stumble.state.players[0].stats.mistakes, 1);
});

test("stepping in the stone's square or out of order ends the turn", () => {
  let s = applyMove(createGame(), throwSquare(1)).state; // route starts 2
  const inStone = applyMove(s, { type: "hop", square: 1, timing: 0 });
  assert.equal(inStone.events.find((e) => e.type === "fail").reason, "stone_square");
  const outOfOrder = applyMove(s, { type: "hop", square: 5, timing: 0 });
  assert.equal(outOfOrder.events.find((e) => e.type === "fail").reason, "sequence");
  const tooEarlyHome = applyMove(s, { type: "hop", square: "start", timing: 0 });
  assert.equal(tooEarlyHome.events.find((e) => e.type === "fail").reason, "sequence");
});

test("timing: green zone passes, slightly off hits a line, far off loses balance", () => {
  const s = applyMove(createGame(), throwSquare(1)).state;
  const zone = expectation(s).zone;
  const run = (timing) => applyMove(s, { type: "hop", square: 2, timing });
  assert.equal(run(zone * 0.9).state.phase, "hop");
  assert.equal(run(-zone * 0.9).state.phase, "hop");
  assert.equal(run(zone * 1.2).events.find((e) => e.type === "fail").reason, "line");
  assert.equal(run(-zone * 2).events.find((e) => e.type === "fail").reason, "balance");
});

test("harder squares and skips need better timing", () => {
  assert.ok(balanceZone(12) < balanceZone(1));
  assert.ok(balanceZone(5, { skip: true }) < balanceZone(5));
  assert.ok(balanceZone(5, { pickup: true }) < balanceZone(5));
  assert.ok(balanceZone(12, { skip: true, pickup: true }) >= 0.15);
});

test("pickup with bad timing loses balance and fails the turn", () => {
  let s = applyMove(createGame(), throwSquare(1)).state;
  while (s.phase === "hop") s = applyMove(s, { type: "hop", square: expectation(s).to, timing: 0 }).state;
  assert.equal(s.phase, "pickup");
  const r = applyMove(s, { type: "pickup", timing: 0.95 });
  assert.equal(r.events.find((e) => e.type === "fail").reason, "balance");
  assert.equal(r.state.players[0].target, 1);
});

test("moves in the wrong phase are rejected without changing state", () => {
  const g = createGame();
  const r = applyMove(g, { type: "hop", square: 1, timing: 0 });
  assert.equal(r.rejected, "wrong_phase");
  assert.equal(r.state, g);
  assert.equal(applyMove(g, { type: "pickup", timing: 0 }).rejected, "wrong_phase");
  assert.equal(applyMove(g, { type: "dance" }).rejected, "unknown_move");
});

test("applyMove never mutates the state it is given", () => {
  const g = createGame();
  const before = JSON.stringify(g);
  applyMove(g, throwSquare(1));
  applyMove(g, throwSquare(4));
  assert.equal(JSON.stringify(g), before);
});

test("same state plus same moves always gives the same result", () => {
  const script = [throwSquare(1), ...Array(11).fill(0)];
  const play = () => {
    let s = createGame({ seed: 7 });
    const log = [];
    s = applyMove(s, throwSquare(1)).state;
    for (let i = 0; i < 40 && s.phase !== "throw"; i++) {
      const e = expectation(s);
      const r = applyMove(
        s,
        e.kind === "pickup" ? { type: "pickup", timing: 0.1 } : { type: "hop", square: e.to, timing: 0.1 },
      );
      s = r.state;
      log.push(...r.events);
    }
    return JSON.stringify({ s, log });
  };
  assert.equal(script.length, 12);
  assert.equal(play(), play());
});

test("state survives a JSON round trip mid-turn", () => {
  let s = applyMove(createGame(), throwSquare(4)).state;
  s = applyMove(s, { type: "hop", square: 1, timing: 0 }).state;
  const restored = JSON.parse(JSON.stringify(s));
  assert.deepEqual(restored, s);
  const a = applyMove(s, { type: "hop", square: 2, timing: 0 });
  const b = applyMove(restored, { type: "hop", square: 2, timing: 0 });
  assert.deepEqual(a, b);
});

test("throw resolution is clamped and repeatable", () => {
  assert.deepEqual(resolveThrow({ angle: 0, power: 5 }), resolveThrow({ angle: 0, power: 1 }));
  assert.deepEqual(resolveThrow({ angle: 0.3, power: 0.5 }), resolveThrow({ angle: 0.3, power: 0.5 }));
});

test("two players alternate turns after a failure", () => {
  let s = createGame({ players: [{ id: "a", name: "A" }, { id: "b", name: "B" }] });
  assert.equal(s.current, 0);
  s = applyMove(s, throwSquare(5)).state; // A misses
  assert.equal(s.current, 1);
  s = playCourse(applyMove(s, throwSquare(1)).state).state; // B clean
  assert.equal(s.current, 1, "a clean course keeps the turn");
  assert.equal(s.players[1].target, 2);
  assert.equal(s.players[0].target, 1);
});
