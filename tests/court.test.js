import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SQUARES,
  squareToCell,
  cellToSquare,
  squareRect,
  squareCenter,
  locate,
  stoneSquare,
  LINE_HALF,
} from "../docs/js/engine/court.js";
import { seedState, nextFloat } from "../docs/js/engine/rng.js";

test("12 squares in two columns of six", () => {
  assert.equal(SQUARES, 12);
  const left = [];
  const right = [];
  for (let n = 1; n <= 12; n++) (squareToCell(n).col === 0 ? left : right).push(n);
  assert.deepEqual(left, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(right, [7, 8, 9, 10, 11, 12]);
});

test("U-shape: 1 bottom-left, 6 top-left, 7 top-right, 12 bottom-right", () => {
  assert.deepEqual(squareToCell(1), { col: 0, row: 0 });
  assert.deepEqual(squareToCell(6), { col: 0, row: 5 });
  assert.deepEqual(squareToCell(7), { col: 1, row: 5 });
  assert.deepEqual(squareToCell(12), { col: 1, row: 0 });
});

test("cell and square numbers round-trip", () => {
  for (let n = 1; n <= 12; n++) {
    const { col, row } = squareToCell(n);
    assert.equal(cellToSquare(col, row), n);
  }
});

test("invalid squares throw", () => {
  assert.throws(() => squareToCell(0));
  assert.throws(() => squareToCell(13));
  assert.throws(() => squareToCell(1.5));
});

test("squareRect and squareCenter agree", () => {
  assert.deepEqual(squareRect(1), { x: 0, y: 0, w: 1, h: 1 });
  assert.deepEqual(squareCenter(7), { x: 1.5, y: 5.5 });
});

test("locate: inside, on a line, outside", () => {
  assert.deepEqual(locate(0.5, 0.5), { square: 1, onLine: false });
  assert.deepEqual(locate(1.5, 0.5), { square: 12, onLine: false });
  assert.equal(locate(0.5, 1 + LINE_HALF / 2).onLine, true);
  assert.equal(locate(1 - LINE_HALF / 2, 0.5).onLine, true);
  assert.deepEqual(locate(-0.2, 0.5), { square: null, onLine: false });
  assert.deepEqual(locate(0.5, 6.2), { square: null, onLine: false });
});

test("stone must land completely inside a square", () => {
  assert.equal(stoneSquare(0.5, 0.5, 0.1), 1);
  assert.equal(stoneSquare(0.5, 1.05, 0.1), null, "touching the line between 1 and 2");
  assert.equal(stoneSquare(0.95, 0.5, 0.1), null, "touching the centre line");
  assert.equal(stoneSquare(-0.5, 0.5, 0.1), null, "outside the court");
  assert.equal(stoneSquare(1.5, 5.5, 0.1), 7);
});

test("rng: same seed gives the same sequence, state is resumable", () => {
  const run = (seed, n) => {
    let s = seedState(seed);
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = nextFloat(s);
      out.push(r.value);
      s = r.state;
    }
    return out;
  };
  assert.deepEqual(run(42, 20), run(42, 20));
  assert.notDeepEqual(run(42, 5), run(43, 5));
  assert.ok(run(7, 200).every((v) => v >= 0 && v < 1));
  const a = nextFloat(seedState(9));
  const b = nextFloat(a.state);
  assert.deepEqual(b, nextFloat(a.state), "resuming from saved state is deterministic");
});
