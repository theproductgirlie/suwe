// Menu, setup, solo, vs-computer, lives and guest-limit flows through the real DOM.
import { launch, sleep } from "./cdp.mjs";

const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) fails.push(msg);
};

async function session(query, fn) {
  const b = await launch({ url: `http://localhost:5173/?debug${query}` });
  const ev = (js) => b.evaluate(js);
  await sleep(300);
  await ev(`window.confirm = () => true`);
  try {
    await fn(b, ev);
  } finally {
    if (b.problems.length) {
      console.log(`PROBLEMS:\n${b.problems.join("\n")}`);
      fails.push("console errors");
    }
    await b.close();
  }
}

const idle = async (ev) => {
  for (let i = 0; i < 400; i++) {
    if (!(await ev("__suwe.busy"))) return;
    await sleep(50);
  }
};
// A throw that surely misses (hard pull straight up, far past the court).
async function badThrow(b, ev) {
  const s = await ev("__suwe.px(0.95, -0.6)");
  await b.touch("touchStart", s.x, s.y);
  await b.touch("touchMove", s.x, s.y + 180);
  await sleep(50);
  await b.touch("touchEnd", s.x, s.y + 180);
}

// ---- 1. Setup screen ----
await session("", async (b, ev) => {
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  check((await ev(`document.querySelectorAll('.seat').length`)) === 2, "setup starts with 2 seats");
  check((await ev(`document.querySelector('.seat input.name').value`)) === "Guest", "player 1 is named Guest, not You");
  await ev(`[...document.querySelectorAll('.chip')].find(c => c.textContent.startsWith('4')).click()`);
  await sleep(100);
  check((await ev(`document.querySelectorAll('.seat').length`)) === 4, "can pick 4 players");
  await ev(`document.querySelectorAll('.seat')[2].querySelector('.seg button').click()`);
  await ev(`(() => { const i = document.querySelectorAll('.seat')[2].querySelector('input.name'); i.value = 'Bola'; i.dispatchEvent(new Event('input')); })()`);
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(400);
  const names = await ev(`__suwe.game.players.map(p => p.name)`);
  check(names[0] === "Guest" && names[2] === "Bola", `names typed in setup reach the game (${names.join(", ")})`);
  const colors = await ev(`__suwe.game.players.map(p => p.color)`);
  check(new Set(colors).size === 4, "each player has a different house colour");
  check((await ev(`document.querySelectorAll('.chip-p').length`)) === 4, "scoreboard shows all 4 players");
});

// ---- 2. Solo: no "your turn", no passing ----
await session("", async (b, ev) => {
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  await ev(`[...document.querySelectorAll('.chip')].find(c => c.textContent.startsWith('1')).click()`);
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(400);
  check((await ev(`document.getElementById('toast').textContent`)) === "Oya, throw!", "solo says 'Oya, throw!' not 'your turn'");
  check((await ev(`document.getElementById('turn').textContent`)).startsWith("Attempt 1"), "solo shows Attempt, not Turn");
  await badThrow(b, ev);
  await idle(ev);
  check((await ev(`__suwe.game.current`)) === 0 && (await ev(`__suwe.game.turnNo`)) === 2, "solo: after a miss it is still you, attempt 2");
  check((await ev(`document.getElementById('toast').textContent`)) === "Oya, throw again", "solo wording after a miss");
  check((await ev(`document.getElementById('turn').textContent`)).startsWith("Attempt 2"), "attempt counter went up");
});

// ---- 3. Versus computer (easy): it plays by itself after you miss ----
await session("", async (b, ev) => {
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  await ev(`document.querySelectorAll('.seat')[1].querySelector('.seg.wide button').click()`); // seat 2 level: Easy
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(400);
  check((await ev(`__suwe.game.players[1].ai`)) === "easy", "seat 2 is an easy computer");
  await badThrow(b, ev);
  await idle(ev);
  check((await ev(`__suwe.game.current`)) === 1, "turn passed to the computer");
  const hint = await ev(`document.getElementById('hint').textContent`);
  check(hint.endsWith("is playing"), `hint says the computer is playing ("${hint}")`);
  // The computer should act and eventually hand the turn back, with nobody touching the screen.
  let back = false;
  for (let i = 0; i < 600 && !back; i++) {
    await sleep(200);
    back = (await ev(`__suwe.game.current`)) === 0;
  }
  check(back, "computer played its turn and passed back to you");
  check((await ev(`__suwe.game.players[1].stats.throws`)) > 0, "computer threw the stone");
  // While the computer plays, touching the screen does nothing.
});

// ---- 4. Lives ----
await session("", async (b, ev) => {
  check((await ev(`document.querySelectorAll('#menu-lives .row span:not(.off)').length`)) === 5, "menu shows 5 full hearts");
  for (let i = 0; i < 5; i++) await ev(`__suwe.spendLife()`);
  await sleep(1200);
  check((await ev(`document.querySelectorAll('#menu-lives .row span:not(.off)').length`)) === 0, "hearts all empty after 5 losses");
  const note = await ev(`document.querySelector('#menu-lives small').textContent`);
  check(/^Next life in (29:\d\d|30:00)$/.test(note), `countdown shown (${note})`);
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  check((await ev(`document.getElementById('gate').hidden`)) === false, "no lives: Play is blocked");
  check((await ev(`document.getElementById('gate-title').textContent`)) === "No lives left", "gate says no lives left");
  check((await ev(`document.getElementById('setup').hidden`)) === true, "setup (solo too) is not reachable");
});

// ---- 5. Guest limit (only on with ?guestlimit locally) ----
await session("&guestlimit", async (b, ev) => {
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(300);
  await ev(`document.getElementById('menu-btn').click()`);
  await sleep(200);
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  check((await ev(`document.getElementById('gate-title').textContent`)).includes("free match"), "guest: second match is blocked");
});
await session("", async (b, ev) => {
  for (let k = 0; k < 2; k++) {
    await ev(`document.getElementById('play').click()`);
    await sleep(200);
    await ev(`document.querySelector('#setup .big').click()`);
    await sleep(300);
    await ev(`document.getElementById('menu-btn').click()`);
    await sleep(200);
  }
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  check((await ev(`document.getElementById('setup').hidden`)) === false, "locally the guest limit is off, so testing is never blocked");
});

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
process.exit(fails.length ? 1 : 0);
