import { test } from "node:test";
import assert from "node:assert/strict";
import { ringPosition, ringSpeed, spread, throwToward } from "../docs/js/ring.js";
import { resolveThrow, THROW_ORIGIN, TIE_MARK } from "../docs/js/engine/game.js";
import { squareCenter, cellToSquare, COLS, ROWS } from "../docs/js/engine/court.js";

const squareAt = (p) => (p.x >= 0 && p.x < COLS && p.y >= 0 && p.y < ROWS ? cellToSquare(Math.floor(p.x), Math.floor(p.y)) : null);

test("the red mark circles the square you aim at, so it crosses that square on every turn", () => {
  for (const target of [1, 2, 5, 9, 12]) {
    const c = squareCenter(target);
    let inside = 0;
    let outside = 0;
    for (let t = 0; t < 8; t += 0.02) {
      const p = ringPosition(t, { target });
      assert.ok(Math.hypot(p.x - c.x, p.y - c.y) < 0.63, "it never wanders off the target");
      if (squareAt(p) === target) inside++;
      else outside++;
    }
    assert.ok(inside > 0 && outside > 0, `square ${target}: sometimes on it, sometimes off it`);
  }
});

test("it goes round slowly, a little faster for higher squares and a lot faster on Hard", () => {
  assert.ok(ringSpeed(1, "medium") < 3.5, "slow enough to time");
  assert.ok(ringSpeed(10, "medium") > ringSpeed(1, "medium"));
  assert.ok(ringSpeed(5, "hard") > ringSpeed(5, "medium") * 1.3);
  assert.ok(ringSpeed(5, "easy") < ringSpeed(5, "medium"));
  assert.equal(ringSpeed(5, null), ringSpeed(5, "medium"), "a match between people is a medium one");
});

test("the random miss is small, and bigger on higher squares and on Hard", () => {
  assert.ok(spread({ target: 12 }) > spread({ target: 1 }));
  assert.ok(spread({ target: 6, level: "hard" }) > spread({ target: 6, level: "medium" }));
  assert.ok(spread({ target: 12, level: "hard" }) < 0.35);
});

test("Ra Ile's mark goes round the whole court and the tie-break's goes round the red mark", () => {
  const seen = new Set();
  for (let t = 0; t < 10; t += 0.02) {
    const sq = squareAt(ringPosition(t, { phase: "ra_ile" }));
    if (sq) seen.add(sq);
  }
  assert.ok(seen.size >= 8, `it passes over many squares (${seen.size})`);
  for (let t = 0; t < 5; t += 0.1) {
    const p = ringPosition(t, { phase: "tiebreak" });
    assert.ok(Math.hypot(p.x - TIE_MARK.x, (p.y - TIE_MARK.y) * (1.1 / 0.9)) < 1.12, "it stays around the mark");
  }
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
