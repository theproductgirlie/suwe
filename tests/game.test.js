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
  while ((s.phase === "hop" || s.phase === "pickup") && guard++ < 100) {
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
  s = applyMove(s, { type: "hop", square: 1, timing: 0 }).state;
  s = applyMove(s, { type: "hop", square: 2, timing: 0 }).state;
  assert.equal(s.phase, "hop");
  const stumble = applyMove(s, { type: "hop", square: 4, timing: 0.99 }); // the jump over the stone
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

test("ordinary hops need no timing; only the jump over the stone does", () => {
  const g = createGame();
  g.players[0].target = 3;
  let s = applyMove(g, throwSquare(3)).state; // route: 1, 2, 4 (jump), 5...
  assert.equal(expectation(s).needsTiming, false);
  s = applyMove(s, { type: "hop", square: 1, timing: 0.99 }).state;
  assert.equal(s.phase, "hop", "a wild needle does not matter on a normal hop");
  s = applyMove(s, { type: "hop", square: 2, timing: -0.99 }).state;
  assert.equal(expectation(s).needsTiming, true);
  const r = applyMove(s, { type: "hop", square: 4, timing: 0.99 });
  assert.equal(r.events.find((e) => e.type === "fail").reason, "balance");
});

test("timing: green zone passes, slightly off hits a line, far off loses balance", () => {
  const s = applyMove(createGame(), throwSquare(1)).state; // first hop is the jump over square 1
  assert.equal(expectation(s).needsTiming, true);
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
  assert.ok(balanceZone(12, { skip: true, pickup: true }) >= 0.25);
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

// ---- hearts: a failed turn costs a heart; at 0 the player is out ----

const miss = (s) => applyMove(s, throwSquare(12)); // wrong square for a fresh target 1

test("a failed turn costs the player one heart, a clean course does not", () => {
  let s = createGame();
  assert.equal(s.players[0].lives, 5);
  s = playCourse(applyMove(s, throwSquare(1)).state).state;
  assert.equal(s.players[0].lives, 5, "clean course keeps all hearts");
  const r = miss(s);
  assert.equal(r.state.players[0].lives, 4);
  assert.equal(r.events.find((e) => e.type === "fail").lives, 4);
});

test("players can start with fewer hearts (carried over from before)", () => {
  const s = createGame({ players: [{ id: "a", name: "A", lives: 2 }, { id: "b", name: "B" }] });
  assert.deepEqual(s.players.map((p) => p.lives), [2, 5]);
});

test("at 0 hearts the player is out and the next player plays", () => {
  let s = createGame({ players: [{ id: "a", name: "A", lives: 1 }, { id: "b", name: "B" }] });
  const r = miss(s);
  assert.equal(r.state.players[0].out, true);
  assert.ok(r.events.some((e) => e.type === "out" && e.id === "a"));
  assert.equal(r.state.current, 1);
  assert.equal(r.state.over, false);
});

test("a player who is out is skipped, so the others keep taking turns", () => {
  let s = createGame({
    players: [{ id: "a", name: "A", lives: 1 }, { id: "b", name: "B" }, { id: "c", name: "C" }],
  });
  s = miss(s).state; // A out, B plays
  assert.equal(s.current, 1);
  s = miss(s).state; // B fails, next is C (A skipped)
  assert.equal(s.current, 2);
  s = miss(s).state; // C fails, back to B, not A
  assert.equal(s.current, 1);
  assert.equal(s.players[0].lives, 0);
});

test("the last player standing keeps playing until their hearts run out too", () => {
  let s = createGame({ players: [{ id: "a", name: "A", lives: 1 }, { id: "b", name: "B", lives: 2 }] });
  s = miss(s).state; // A out
  const r1 = miss(s); // B 2 -> 1, B plays again
  assert.equal(r1.state.current, 1);
  assert.equal(r1.state.over, false);
  assert.equal(r1.events.at(-1).type, "turn_end");
  const r2 = miss(r1.state); // B out: nobody left
  assert.equal(r2.state.over, true);
  assert.equal(r2.events.at(-1).type, "match_over");
});

test("solo: running out of hearts ends the match", () => {
  let s = createGame();
  for (let i = 0; i < 4; i++) s = miss(s).state;
  assert.equal(s.over, false);
  s = miss(s).state;
  assert.equal(s.players[0].lives, 0);
  assert.equal(s.over, true);
});

test("nothing can be played once the match is over", () => {
  let s = createGame({ players: [{ id: "a", name: "A", lives: 1 }] });
  s = miss(s).state;
  assert.equal(s.over, true);
  assert.equal(applyMove(s, throwSquare(1)).rejected, "match_over");
});

test("hearts and elimination survive saving", () => {
  let s = createGame({ players: [{ id: "a", name: "A", lives: 1 }, { id: "b", name: "B" }] });
  s = miss(s).state;
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

// ---- houses (Ra Ile), wrong taps, winning, tie-break ----

import { blockedFor, TIE_MARK } from "../docs/js/engine/game.js";

const backAt = (x, y) => ({ ...throwAt(x, y), type: "backthrow" });
const backSquare = (n) => {
  const c = squareCenter(n);
  return backAt(c.x, c.y);
};
const tieAt = (x, y) => ({ ...throwAt(x, y), type: "tiebreak" });
const two = () => createGame({ players: [{ id: "a", name: "A" }, { id: "b", name: "B" }] });

// Play a player straight through all 12 targets, ending at the Ra Ile throw.
function toRaIle(g) {
  let s = g;
  for (let t = 1; t <= 12; t++) {
    s = applyMove(s, throwSquare(t)).state;
    s = playCourse(s).state;
  }
  return s;
}

test("finishing all 12 squares earns the Ra Ile back-throw, not a house yet", () => {
  const s = toRaIle(createGame());
  assert.equal(s.phase, "ra_ile");
  assert.equal(s.owners.every((o) => o === null), true);
  assert.deepEqual(expectation(s), { kind: "backthrow" });
});

test("a back-throw that lands in a free square buys the house", () => {
  let s = toRaIle(createGame());
  const r = applyMove(s, backSquare(7));
  assert.equal(r.state.owners[6], "p1");
  assert.deepEqual(r.state.players[0].houses, [7]);
  const house = r.events.find((e) => e.type === "house");
  assert.equal(house.square, 7);
  assert.equal(r.state.phase, "throw");
  assert.equal(r.state.players[0].target, 1, "the next round starts again at square 1");
  assert.equal(r.state.current, 0, "the player keeps the turn");
  assert.equal(r.state.players[0].lives, 5, "a house costs nothing");
});

test("a missed back-throw gives no house, but the round still restarts at 1", () => {
  const s = toRaIle(createGame());
  for (const m of [backAt(0.5, 1.0), backAt(0.5, 8), backAt(-3, 2)]) {
    const r = applyMove(s, m);
    assert.deepEqual(r.state.players[0].houses, []);
    assert.equal(r.events.some((e) => e.type === "house"), false);
    assert.equal(r.state.phase, "throw");
    assert.equal(r.state.players[0].target, 1);
    assert.equal(r.state.players[0].lives, 5, "no heart lost for a missed back-throw");
  }
});

test("a square that is already owned cannot be bought again", () => {
  let s = toRaIle(createGame());
  s = applyMove(s, backSquare(7)).state;
  s = toRaIle(s);
  assert.equal(s.phase, "ra_ile");
  const r = applyMove(s, backSquare(7));
  assert.deepEqual(r.state.players[0].houses, [7]);
  assert.equal(r.events.some((e) => e.type === "house"), false);
});

test("another player's house is skipped as a target, no throw needed", () => {
  const s = two();
  s.owners[1] = "a"; // A owns square 2
  s.players[0].houses = [2];
  s.players[1].target = 2; // B is due to aim at 2
  const r = applyMove(s, throwSquare(5)); // A misses; B is next
  assert.equal(r.state.current, 1);
  assert.equal(r.state.players[1].target, 3, "B's target moved past A's house");
});

test("a house you own is not blocked for you, but is for everyone else", () => {
  const s = two();
  s.owners[3] = "a";
  assert.deepEqual(blockedFor(s, s.players[0]), []);
  assert.deepEqual(blockedFor(s, s.players[1]), [4]);
});

test("the route jumps over opponents' houses, and the jump needs the needle", () => {
  const steps = buildSteps(5, [3]);
  const out = steps.slice(0, steps.findIndex((x) => x.kind === "turn"));
  assert.deepEqual(out.map((x) => x.to), [1, 2, 4, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(out.filter((x) => x.skip).map((x) => x.to), [4, 6], "over 3 and over 5");
  assert.ok(!steps.some((x) => x.kind === "hop" && x.to === 3), "never lands in the house");
});

test("stepping into an opponent's house ends the turn", () => {
  const s = two();
  s.owners[3] = "b"; // B owns square 4
  s.players[1].houses = [4];
  let r = applyMove(s, throwSquare(1));
  r = applyMove(r.state, { type: "hop", square: 2, timing: 0 }); // 1 is the stone; route starts at 2 (a jump)
  assert.equal(r.state.phase, "hop");
  const bad = applyMove(r.state, { type: "hop", square: 4, timing: 0 });
  assert.equal(bad.events.find((e) => e.type === "fail").reason, "opponent_house");
  assert.equal(bad.state.players[0].lives, 4);
  assert.equal(bad.state.current, 1);
});

test("throwing the stone into an opponent's house is a failed turn", () => {
  const s = two();
  s.owners[2] = "b"; // B owns square 3
  s.players[1].houses = [3];
  const r = applyMove(s, throwSquare(3)); // A's target is 1
  assert.equal(r.events.find((e) => e.type === "fail").reason, "opponent_house");
});

test("the owner may use their own house on the route", () => {
  const s = two();
  s.owners[3] = "a";
  s.players[0].houses = [4];
  const steps = buildSteps(2, blockedFor(s, s.players[0]));
  assert.ok(steps.some((x) => x.kind === "hop" && x.to === 4));
});

test("with every other square owned by opponents the course is done at once", () => {
  const s = two();
  for (let n = 2; n <= 12; n++) s.owners[n - 1] = "b";
  s.players[1].houses = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const r = applyMove(s, throwSquare(1));
  assert.equal(r.state.phase, "ra_ile");
  assert.ok(r.events.some((e) => e.type === "circuit"));
});

test("a tap off the court, on the wrong square, or at HOME too early all lose the turn", () => {
  const s = applyMove(createGame(), throwSquare(1)).state; // route starts at 2
  const out = applyMove(s, { type: "hop", square: "out", timing: 0 });
  assert.equal(out.events.find((e) => e.type === "fail").reason, "outside");
  assert.equal(out.state.players[0].lives, 4);
  assert.equal(applyMove(s, { type: "hop", square: 9, timing: 0 }).events.find((e) => e.type === "fail").reason, "sequence");
  assert.equal(applyMove(s, { type: "hop", square: "start", timing: 0 }).events.find((e) => e.type === "fail").reason, "sequence");
  assert.equal(applyMove(s, { type: "hop", square: 1, timing: 0 }).events.find((e) => e.type === "fail").reason, "stone_square");
});

// Fill the board so the last free square decides the match.
function nearlyFull(aHouses, bHouses) {
  const s = two();
  s.phase = "ra_ile";
  aHouses.forEach((n) => {
    s.owners[n - 1] = "a";
    s.players[0].houses.push(n);
  });
  bHouses.forEach((n) => {
    s.owners[n - 1] = "b";
    s.players[1].houses.push(n);
  });
  return s;
}

test("most houses wins when every square is claimed", () => {
  const s = nearlyFull([1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11]);
  const r = applyMove(s, backSquare(12));
  assert.equal(r.state.over, true);
  assert.deepEqual(r.state.result, { winners: ["a"], reason: "all_claimed", tie: false });
  assert.equal(r.events.at(-1).type, "match_over");
});

test("a tie goes to a closest-stone tie-break; the closer throw wins", () => {
  const s = nearlyFull([1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11]);
  let r = applyMove(s, backSquare(12)); // 6 v 6
  assert.equal(r.state.over, false);
  assert.equal(r.state.phase, "tiebreak");
  assert.deepEqual(r.state.tie.ids, ["a", "b"]);
  assert.equal(r.state.current, 0);
  r = applyMove(r.state, tieAt(TIE_MARK.x + 1.0, TIE_MARK.y)); // A is a cell away
  assert.equal(r.state.over, false);
  assert.equal(r.state.current, 1, "then B throws");
  r = applyMove(r.state, tieAt(TIE_MARK.x + 0.1, TIE_MARK.y)); // B is much closer
  assert.equal(r.state.over, true);
  assert.deepEqual(r.state.result.winners, ["b"]);
  assert.equal(r.state.result.reason, "tiebreak");
});

test("a dead heat in the tie-break throws again, and always ends", () => {
  let r = applyMove(nearlyFull([1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11]), backSquare(12));
  let rounds = 0;
  while (!r.state.over && rounds++ < 20) {
    r = applyMove(r.state, tieAt(TIE_MARK.x + 0.5, TIE_MARK.y));
  }
  assert.equal(r.state.over, true);
  assert.ok(rounds <= 10, "ends within a few rounds");
  assert.equal(r.state.result.winners.length, 1);
  assert.ok(r.events.some((e) => e.type === "match_over"));
});

test("running out of hearts ends the match with the houses so far deciding it", () => {
  const s = createGame({ players: [{ id: "a", name: "A", lives: 1 }, { id: "b", name: "B", lives: 1 }] });
  s.owners[0] = "a";
  s.players[0].houses = [1];
  s.players[1].target = 2;
  let r = applyMove(s, throwSquare(9)); // A fails, out
  r = applyMove(r.state, throwSquare(9)); // B fails, out
  assert.equal(r.state.over, true);
  assert.deepEqual(r.state.result, { winners: ["a"], reason: "out_of_lives", tie: false });
});

test("a whole match with houses replays identically from its moves", () => {
  const play = () => {
    let s = toRaIle(createGame({ seed: 3 }));
    s = applyMove(s, backSquare(9)).state;
    s = toRaIle(s);
    s = applyMove(s, backSquare(2)).state;
    return JSON.stringify(s);
  };
  assert.equal(play(), play());
  assert.deepEqual(JSON.parse(play()).players[0].houses, [9, 2]);
});
