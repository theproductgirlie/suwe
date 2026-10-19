import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cfg = JSON.parse(readFileSync(new URL("../docs/startng.json", import.meta.url), "utf8"));
const main = readFileSync(new URL("../docs/js/main.js", import.meta.url), "utf8");

test("startng.json follows start.ng's leaderboard rules", () => {
  const stats = cfg.leaderboard.stats;
  assert.ok(stats.length >= 1 && stats.length <= 5, "1 to 5 stats");
  for (const s of stats) {
    assert.match(s.key, /^[a-z][a-z0-9_]{0,23}$/, `key ${s.key}`);
    assert.ok(s.label.length > 0 && s.label.length <= 30, `label ${s.label}`);
    assert.ok(["highest", "lowest"].includes(s.order), "order");
    if (s.format) assert.ok(["number", "time"].includes(s.format), "format");
  }
  assert.equal(new Set(stats.map((s) => s.key)).size, stats.length, "keys are unique");
});

test("the game sends exactly the stats startng.json names", () => {
  const keys = cfg.leaderboard.stats.map((s) => s.key);
  assert.deepEqual(keys, ["houses", "level", "accuracy", "mistakes", "seconds"]);
  const call = main.slice(main.indexOf("await saveScore({"), main.indexOf("});", main.indexOf("await saveScore({")));
  for (const k of keys) assert.ok(call.includes(`${k}:`), `main.js sends ${k}`);
  assert.equal((call.match(/whole\(/g) ?? []).length, keys.length, "every value goes through whole()");
});
