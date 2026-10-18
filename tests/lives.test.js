import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LIVES,
  REFILL_MS,
  freshLives,
  normalizeLives,
  tickLives,
  loseLife,
  canPlay,
  msToNextLife,
} from "../docs/js/lives.js";

const T0 = 1_000_000;

test("starts with 5 full lives and no timer", () => {
  assert.deepEqual(freshLives(), { lives: 5, since: null });
  assert.equal(msToNextLife(freshLives(), T0), 0);
});

test("losing a life starts the 30 minute timer", () => {
  const s = loseLife(freshLives(), T0);
  assert.deepEqual(s, { lives: 4, since: T0 });
  assert.equal(msToNextLife(s, T0 + 10 * 60000), 20 * 60000);
});

test("a heart comes back after 30 minutes, not before", () => {
  const s = loseLife(freshLives(), T0);
  assert.equal(tickLives(s, T0 + REFILL_MS - 1).lives, 4);
  assert.equal(tickLives(s, T0 + REFILL_MS).lives, 5);
});

test("losing more lives does not restart the timer", () => {
  let s = loseLife(freshLives(), T0);
  s = loseLife(s, T0 + 10 * 60000);
  assert.equal(s.lives, 3);
  assert.equal(s.since, T0);
  assert.equal(tickLives(s, T0 + REFILL_MS).lives, 4, "first heart back on schedule");
  assert.equal(tickLives(s, T0 + 2 * REFILL_MS).lives, 5);
});

test("being away for hours refills, but never above 5", () => {
  let s = freshLives();
  for (let i = 0; i < 5; i++) s = loseLife(s, T0);
  assert.equal(s.lives, 0);
  assert.equal(canPlay(s, T0), false);
  assert.equal(tickLives(s, T0 + 3 * REFILL_MS).lives, 3);
  assert.deepEqual(tickLives(s, T0 + 100 * REFILL_MS), freshLives());
});

test("at 0 lives you cannot lose another and cannot play", () => {
  let s = freshLives();
  for (let i = 0; i < 7; i++) s = loseLife(s, T0);
  assert.equal(s.lives, 0);
  assert.equal(canPlay(s, T0 + REFILL_MS - 1), false);
  assert.equal(canPlay(s, T0 + REFILL_MS), true);
});

test("moving the phone clock backwards does not give or take hearts", () => {
  const s = loseLife(freshLives(), T0);
  const back = tickLives(s, T0 - 5 * REFILL_MS);
  assert.equal(back.lives, 4);
  assert.ok(back.since <= T0 - 5 * REFILL_MS + 1);
});

test("bad saved data is repaired", () => {
  assert.deepEqual(normalizeLives(null), freshLives());
  assert.deepEqual(normalizeLives({ lives: 99, since: 5 }), freshLives());
  assert.deepEqual(normalizeLives({ lives: -3, since: T0 }), { lives: 0, since: T0 });
  assert.deepEqual(normalizeLives({ lives: "x" }), freshLives());
  assert.equal(MAX_LIVES, 5);
});
