import { test } from "node:test";
import assert from "node:assert/strict";
import { SWAY, swayAmplitude, swayAngle, aimFromPull, keyboardAim, landing, throwToward } from "../docs/js/ring.js";
import { THROW_ORIGIN } from "../docs/js/engine/game.js";
import { squareCenter, cellToSquare, COLS, ROWS } from "../docs/js/engine/court.js";

const squareAt = (p) => (p.x >= 0 && p.x < COLS && p.y >= 0 && p.y < ROWS ? cellToSquare(Math.floor(p.x), Math.floor(p.y)) : null);
const deg = (r) => (r * 180) / Math.PI;

test("the sway is 6, 10 and 14 degrees on Easy, Medium and Hard, and 30% more on squares 7 to 12", () => {
  assert.equal(swayAmplitude("easy", 3), 6);
  assert.equal(swayAmplitude("medium", 3), 10);
  assert.equal(swayAmplitude("hard", 3), 14);
  assert.ok(Math.abs(swayAmplitude("medium", 7) - 13) < 1e-9);
  assert.ok(Math.abs(swayAmplitude("hard", 12) - 18.2) < 1e-9);
  assert.equal(swayAmplitude(null, 3), 10, "a match between people is a medium one");
});

test("the aim swings left and right as a sine wave at 0.5, 0.8 and 1.2 swings a second", () => {
  assert.equal(swayAngle(0, "medium", 3), 0, "it starts in the middle");
  for (const [level, s] of Object.entries(SWAY)) {
    const peak = swayAngle(1 / (4 * s.hz), level, 3); // a quarter of a swing
    assert.ok(Math.abs(deg(peak) - s.deg) < 1e-6, `${level} peaks at ${s.deg} degrees`);
    assert.ok(Math.abs(swayAngle(1 / s.hz, level, 3)) < 1e-9, `${level} is back in the middle after one swing`);
    assert.ok(swayAngle(3 / (4 * s.hz), level, 3) < 0, `${level} swings to the other side`);
  }
});

test("pulling back sets the aim: the other way from the pull, as far as the pull is long", () => {
  const stone = { x: 200, y: 600 };
  const straight = aimFromPull(stone, { x: 200, y: 700 }, 200);
  assert.ok(Math.abs(straight.angle) < 1e-9 && Math.abs(straight.power - 0.5) < 1e-9);
  const toLeft = aimFromPull(stone, { x: 260, y: 700 }, 200); // finger to the right, aims left
  assert.ok(toLeft.angle < 0);
  assert.ok(aimFromPull(stone, { x: 200, y: 800 }, 200).power > straight.power, "a longer pull goes further");
  assert.equal(aimFromPull(stone, { x: 200, y: 560 }, 200), null, "a push forwards is not a pull");
  assert.equal(aimFromPull(stone, { x: 200, y: 1200 }, 200).power, 1, "power stops at 1");
});

test("holding Space aims at the target square and the pull sweeps from short to long", () => {
  const a = keyboardAim(0, 4);
  const c = squareCenter(4);
  assert.ok(Math.abs(Math.atan2(c.x - THROW_ORIGIN.x, c.y - THROW_ORIGIN.y) - a.angle) < 1e-9);
  const powers = [];
  for (let t = 0; t < 2.4; t += 0.05) powers.push(keyboardAim(t, 4).power);
  assert.ok(Math.min(...powers) <= 0.25 && Math.max(...powers) >= 0.95, "it sweeps through every distance");
});

test("with no sway a place on the court lands in that square, and the sway moves the landing sideways", () => {
  for (let n = 1; n <= 12; n++) {
    const c = squareCenter(n);
    const land = landing(throwToward(c.x, c.y));
    assert.equal(squareAt(land), n, `square ${n}`);
  }
  const aim = throwToward(0.5, 5.5);
  const left = landing(aim, -swayAmplitude("hard", 6) * Math.PI / 180);
  const right = landing(aim, swayAmplitude("hard", 6) * Math.PI / 180);
  assert.ok(right.x - left.x > 1, "on Hard the swing sweeps the landing across more than a square on far squares");
});
