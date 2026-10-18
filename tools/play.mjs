// Plays Suwe through the real touch UI in a phone-sized headless Chrome.
// Needs the dev server running (npm run serve). Screenshots go to shots/.
import { launch, sleep } from "./cdp.mjs";

const b = await launch({ url: "http://localhost:5173/?debug" });
const H = 844;
const ev = (js) => b.evaluate(js);
const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) fails.push(msg);
};
const phase = () => ev("__suwe.game.phase");
const target = () => ev("__suwe.game.players[0].target");
const idle = async () => {
  for (let i = 0; i < 200; i++) {
    if (!(await ev("__suwe.busy"))) return;
    await sleep(50);
  }
  throw new Error("animation never finished");
};

// Drag the stone back so it lands in the centre of `square`.
async function throwAt(square, { shoot = null, offset = [0, 0] } = {}) {
  const c = await ev(`(() => { const r = __suwe.game; return null })()`);
  const geo = await ev(`(() => {
    const cell = (n) => n <= 6 ? { x: 0.5, y: n - 0.5 } : { x: 1.5, y: 12 - n + 0.5 };
    return cell(${square});
  })()`);
  const o = { x: 0.95, y: -0.6 };
  const dx = geo.x + offset[0] - o.x;
  const dy = geo.y + offset[1] - o.y;
  const angle = Math.atan2(dx, dy);
  const power = Math.hypot(dx, dy) / 8;
  const s = await ev("__suwe.px(0.95, -0.6)");
  const len = power * H * 0.22;
  const fx = s.x - Math.sin(angle) * len;
  const fy = s.y + Math.cos(angle) * len;
  await b.touch("touchStart", s.x, s.y);
  await sleep(40);
  await b.touch("touchMove", (s.x + fx) / 2, (s.y + fy) / 2);
  await b.touch("touchMove", fx, fy);
  await sleep(60);
  if (shoot) await b.shot(shoot);
  await b.touch("touchEnd", fx, fy);
}

// Tap `square` (or "start") once the needle is comfortably in the green.
async function tapWhenGreen(square) {
  const pos =
    square === "start"
      ? await ev("__suwe.px(1, -1)")
      : await ev(`__suwe.px(${square <= 6 ? 0.5 : 1.5}, ${square <= 6 ? square - 0.5 : 12 - square + 0.5})`);
  for (let i = 0; i < 400; i++) {
    const [n, z] = [await ev("__suwe.needle()"), await ev("__suwe.zone()")];
    if (Math.abs(n) < z * 0.4) break;
    await sleep(10);
  }
  await b.tap(pos.x, pos.y);
}

const expectedNext = () => ev(`(() => { const g = __suwe.game; const s = g.turn?.steps[g.turn.i]; return s ? (s.kind === 'pickup' ? 'pickup' : s.to) : null })()`);

async function playCourse(shots = false) {
  let n = 0;
  while ((await phase()) !== "throw" && n++ < 60) {
    await idle();
    if ((await phase()) === "throw") break;
    const next = await expectedNext();
    if (process.env.TRACE) console.log("  next:", next, "needle", (await ev("__suwe.needle()")).toFixed(2), "zone", (await ev("__suwe.zone()")).toFixed(2));
    if (shots && n === 3) await b.shot("shots/s2-hop.png");
    if (next === "pickup") {
      await b.shot("shots/s2-pickup-ready.png");
      const btn = await ev(`(() => { const r = document.getElementById('pickup').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`);
      for (let i = 0; i < 400; i++) {
        const [nd, z] = [await ev("__suwe.needle()"), await ev("__suwe.zone()")];
        if (Math.abs(nd) < z * 0.4) break;
        await sleep(10);
      }
      await b.tap(btn.x, btn.y);
    } else {
      await tapWhenGreen(next);
    }
  }
}

await sleep(500);
check((await phase()) === "throw" && (await target()) === 1, "starts at throw phase, target 1");
await b.shot("shots/s2-1-start.png");

// 1. A bad throw (into square 4) ends the turn and keeps target 1.
await throwAt(4);
await idle();
check((await phase()) === "throw" && (await target()) === 1, "miss: still target 1, back to throwing");
check((await ev("__suwe.game.turnNo")) === 2, "miss: turn counter advanced");

// 2. A good throw into square 1, with a screenshot of the aim.
await throwAt(1, { shoot: "shots/s2-2-aim.png" });
await sleep(350);
await b.shot("shots/s2-3-stone-flying.png");
await idle();
check((await phase()) === "hop", "good throw into square 1 starts the hop phase");
await b.shot("shots/s2-4-after-throw.png");

// 3. Hop the whole course with good timing.
await playCourse(true);
await idle();
check((await phase()) === "throw", "course finished, back to throwing");
check((await target()) === 2, "target advanced to square 2");
check((await ev("__suwe.game.turnNo")) === 2, "clean course kept the turn");
await b.shot("shots/s2-5-after-course.png");

// 4. Throw at 2, then fail the first hop by tapping with the needle in the red.
await throwAt(2);
await idle();
for (let i = 0; i < 400; i++) {
  const [n, z] = [await ev("__suwe.needle()"), await ev("__suwe.zone()")];
  if (Math.abs(n) > Math.min(0.97, z * 2.2)) break;
  await sleep(10);
}
const first = await ev(`(() => { const s = __suwe.game.turn.steps[0].to; return s })()`);
const pos = await ev(`__suwe.px(${first <= 6 ? 0.5 : 1.5}, ${first <= 6 ? first - 0.5 : 12 - first + 0.5})`);
await b.tap(pos.x, pos.y);
await sleep(500);
await b.shot("shots/s2-6-fail.png");
await idle();
check((await phase()) === "throw" && (await target()) === 2, "fail: resumes at the same target (2)");
check((await ev("__suwe.game.players[0].stats.mistakes")) === 2, "mistakes counted (2)");

console.log(b.problems.length ? `PROBLEMS:\n${b.problems.join("\n")}` : "no console errors");
await b.close();
process.exit(fails.length || b.problems.length ? 1 : 0);
