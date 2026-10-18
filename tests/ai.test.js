import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame, applyMove } from "../docs/js/engine/game.js";
import { planMove, playAiMove, LEVELS } from "../docs/js/engine/ai.js";

// One computer playing alone: how far does it get in a fixed number of moves?
function progress(level, seed, moves = 400) {
  let s = createGame({ seed, players: [{ id: "c", name: "C", ai: level, lives: 100000 }] });
  let rejected = 0;
  for (let i = 0; i < moves; i++) {
    const r = playAiMove(s, level);
    if (r.rejected) rejected++;
    s = r.state;
  }
  const p = s.players[0];
  return { cleared: p.circuits * 12 + p.target - 1, rejected, mistakes: p.stats.mistakes };
}

test("same state and level always give the same computer move", () => {
  const g = createGame({ seed: 5 });
  assert.deepEqual(planMove(g, "medium"), planMove(g, "medium"));
  assert.deepEqual(playAiMove(g, "hard"), playAiMove(g, "hard"));
});

test("the computer never makes an illegal move, at any level", () => {
  for (const level of Object.keys(LEVELS)) {
    for (let seed = 1; seed <= 20; seed++) assert.equal(progress(level, seed).rejected, 0, `${level} ${seed}`);
  }
});

test("harder levels get further and make fewer mistakes", () => {
  const total = (level) => {
    let cleared = 0;
    let mistakes = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = progress(level, seed);
      cleared += r.cleared;
      mistakes += r.mistakes;
    }
    return { cleared, mistakes };
  };
  const easy = total("easy");
  const medium = total("medium");
  const hard = total("hard");
  assert.ok(medium.cleared > easy.cleared, `medium ${medium.cleared} > easy ${easy.cleared}`);
  assert.ok(hard.cleared > medium.cleared, `hard ${hard.cleared} > medium ${medium.cleared}`);
  assert.ok(easy.mistakes > medium.mistakes && medium.mistakes > hard.mistakes);
});

test("easy still gets things right sometimes, hard still slips sometimes", () => {
  let easyHits = 0;
  let hardFails = 0;
  for (let seed = 1; seed <= 40; seed++) {
    easyHits += progress("easy", seed).cleared;
    hardFails += progress("hard", seed).mistakes;
  }
  assert.ok(easyHits > 0);
  assert.ok(hardFails > 0);
});

test("a computer's turn is replayable from its recorded moves", () => {
  const g = createGame({ seed: 11 });
  const a = playAiMove(g, "medium");
  const { move, rng } = planMove(g, "medium");
  const b = applyMove({ ...g, rng }, move);
  assert.deepEqual(a, b);
});
