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

const g = (path) => ev(`__suwe.game.${path}`);

// Menu -> Play -> 2 players, both people -> Start.
await ev(`document.getElementById('play').click()`);
await sleep(200);
await ev(`document.querySelectorAll('.seat')[1].querySelector('.seg button').click()`); // seat 2: Person
await ev(`document.querySelector('#setup .big').click()`);
await sleep(500);
check((await phase()) === "throw" && (await g("current")) === 0, "starts at throw phase, player 1");
check((await g("players.length")) === 2 && (await g("players[1].ai")) === null, "two people");
await b.shot("shots/s2-1-start.png");

// 1. Player 1 throws into the wrong square: miss, turn passes to player 2, target kept.
await throwAt(4);
await idle();
check((await g("current")) === 1, "miss: turn passed to player 2");
check((await g("players[0].target")) === 1 && (await g("turnNo")) === 2, "miss: player 1 keeps target 1");
await b.shot("shots/s2-2-player2.png");

// 2. Player 2 throws into square 1 (with a shot of the aim), then hops the course.
await throwAt(1, { shoot: "shots/s2-3-aim.png" });
await sleep(350);
await b.shot("shots/s2-4-stone-flying.png");
await idle();
check((await phase()) === "hop", "good throw starts the hop phase");
await playCourse(true);
await idle();
check((await phase()) === "throw" && (await g("players[1].target")) === 2, "player 2 cleared square 1, target is now 2");
check((await g("current")) === 1, "a clean course keeps the turn");
await b.shot("shots/s2-5-after-course.png");

// 3. Player 2 throws at 2, hops 1 (no timing needed), then fails the big jump in the red.
await throwAt(2);
await idle();
check((await ev("__suwe.zone()")) > 0, "zone available");
await tapWhenGreen(1);
await idle();
check((await g("turn.i")) === 1 && (await g("current")) === 1, "ordinary hop went through");
for (let i = 0; i < 600; i++) {
  const [n, z] = [await ev("__suwe.needle()"), await ev("__suwe.zone()")];
  if (Math.abs(n) > Math.min(0.97, z * 2.2)) break;
  await sleep(10);
}
const pos = await ev("__suwe.px(0.5, 2.5)"); // square 3, the jump over the stone in 2
await b.tap(pos.x, pos.y);
await sleep(500);
await b.shot("shots/s2-6-fail.png");
await idle();
check((await g("current")) === 0, "fail: turn passed back to player 1");
check((await g("players[1].target")) === 2, "fail: player 2 resumes at target 2 next time");
await b.shot("shots/s2-7-player1.png");

// 4. Player 1 plays a clean course on their own target 1.
await throwAt(1);
await idle();
await playCourse();
await idle();
check((await g("players[0].target")) === 2 && (await g("current")) === 0, "player 1 advanced to 2 and kept the turn");
check((await g("players[1].target")) === 2, "player 2 progress untouched");

const played = await ev(`__suwe.audio.played()`);
const heard = new Set(played);
for (const name of ["throw", "land", "hop", "turn", "pickup", "good", "fail"]) {
  check(heard.has(name), `gameplay played the "${name}" sound`);
}
check(played.length > 30, `${played.length} sound effects played during the run`);

console.log(b.problems.length ? `PROBLEMS:\n${b.problems.join("\n")}` : "no console errors");
await b.close();
process.exit(fails.length || b.problems.length ? 1 : 0);
