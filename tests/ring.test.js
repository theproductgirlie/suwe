import { test } from "node:test";
import assert from "node:assert/strict";
import { ringPosition, ringSpeed, spread, throwToward } from "../docs/js/ring.js";
import { resolveThrow, THROW_ORIGIN } from "../docs/js/engine/game.js";
import { squareCenter, cellToSquare, COLS, ROWS } from "../docs/js/engine/court.js";

const squareAt = (p) => (p.x >= 0 && p.x < COLS && p.y >= 0 && p.y < ROWS ? cellToSquare(Math.floor(p.x), Math.floor(p.y)) : null);

test("the ring starts on square 1 and walks the squares in hop order, then back", () => {
  assert.deepEqual(ringPosition(0), squareCenter(1));
  const seen = [];
  const speed = ringSpeed(1, null);
  for (let t = 0; t <= 22 / speed; t += 0.01) {
    const sq = squareAt(ringPosition(t, { target: 1 }));
    if (sq && seen.at(-1) !== sq) seen.push(sq);
  }
  // 1..12 going up the court, then 12..1 coming back.
  assert.deepEqual(seen.slice(0, 12), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(seen.slice(12, 23), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
});

test("the ring is faster for higher target squares and on Hard", () => {
  assert.ok(ringSpeed(10, "medium") > ringSpeed(1, "medium"));
  assert.ok(ringSpeed(5, "hard") > ringSpeed(5, "medium"));
  assert.ok(ringSpeed(5, "easy") < ringSpeed(5, "medium"));
  assert.ok(ringSpeed(5, null) === ringSpeed(5, "medium"), "a match between people is a medium one");
});

test("the random miss is bigger on higher squares and on Hard", () => {
  assert.ok(spread({ target: 12 }) > spread({ target: 1 }));
  assert.ok(spread({ target: 6, level: "hard" }) > spread({ target: 6, level: "medium" }));
  assert.ok(spread({ target: 12, level: "hard" }) < 0.5, "still small enough to be fair");
});

test("a place on the court becomes an angle and power that land there", () => {
  for (let n = 1; n <= 12; n++) {
    const c = squareCenter(n);
    const land = resolveThrow(throwToward(c.x, c.y));
    assert.ok(Math.hypot(land.x - c.x, land.y - c.y) < 1e-3, `square ${n} lands in the middle`);
    assert.equal(squareAt(land), n);
  }
  assert.ok(throwToward(THROW_ORIGIN.x, 30).power <= 1, "power never goes past 1");
});

test("the tie-break ring sweeps across the red mark", () => {
  const xs = [];
  for (let t = 0; t < 6; t += 0.05) xs.push(ringPosition(t, { phase: "tiebreak" }).x);
  assert.ok(Math.min(...xs) < 0.2 && Math.max(...xs) > 1.8, "it crosses the width of the court");
});
