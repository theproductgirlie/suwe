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
  check((await ev(`document.querySelector('.seat .cname').textContent`)) === "Test Player", "player 1 is the (test) start.ng player, shown by name");
  check((await ev(`document.querySelectorAll('.seat')[0].querySelector('input.name')`)) === null, "player 1's name can't be edited");
  check(!(await ev(`document.getElementById('setup').innerText`)).includes("Guest"), "no 'Guest' anywhere on the setup screen");
  await ev(`[...document.querySelectorAll('.chip')].find(c => c.textContent.startsWith('4')).click()`);
  await sleep(100);
  check((await ev(`document.querySelectorAll('.seat').length`)) === 4, "can pick 4 players");
  await ev(`(() => { const i = document.querySelectorAll('.seat')[2].querySelector('input.name'); i.value = 'Bola'; i.dispatchEvent(new Event('input')); })()`);
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(400);
  const names = await ev(`__suwe.game.players.map(p => p.name)`);
  check(names[0] === "Test Player" && names[2] === "Bola" && names[1] === "Player 2", `names typed in setup reach the game (${names.join(", ")})`);
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
  check((await ev(`document.getElementById('toast').textContent`)) === "Throw again!", "solo wording after a miss");
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

// ---- 6. Hearts per match: solo runs out -> match over, saved hearts are 0, Play blocked ----
await session("", async (b, ev) => {
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  await ev(`[...document.querySelectorAll('.chip')].find(c => c.textContent.startsWith('1')).click()`);
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(400);
  check((await ev(`document.querySelector('.chip-p').textContent`)).includes("♥5"), "scoreboard shows 5 hearts");
  await badThrow(b, ev);
  await idle(ev);
  check((await ev(`document.querySelector('.chip-p').textContent`)).includes("♥4"), "a failed turn costs a heart (♥4)");
  check((await ev(`__suwe.lives.lives`)) === 4, "your saved hearts dropped too");
  for (let i = 0; i < 4; i++) {
    await badThrow(b, ev);
    await idle(ev);
  }
  await sleep(600);
  check((await ev(`document.getElementById('results').hidden`)) === false, "out of hearts: results screen shows");
  check((await ev(`document.getElementById('results-why').textContent`)) === "Everybody ran out of hearts", "results say why the match ended");
  check((await ev(`__suwe.lives.lives`)) === 0, "saved hearts are 0");
  await ev(`document.getElementById('gate-back').click()`);
  await sleep(200);
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  check((await ev(`document.getElementById('gate-title').textContent`)) === "No lives left", "cannot start another match at 0 hearts");
});

// ---- 7. You run out first, the next player carries on ----
await session("", async (b, ev) => {
  for (let i = 0; i < 4; i++) await ev(`__suwe.spendLife()`); // you have 1 heart left
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  await ev(`document.querySelectorAll('.seat')[1].querySelector('.seg button').click()`); // seat 2: Person
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(400);
  check((await ev(`__suwe.game.players[0].lives`)) === 1, "you start the match with your saved single heart");
  await badThrow(b, ev);
  await idle(ev);
  check((await ev(`__suwe.game.players[0].out`)) === true, "you are out");
  check((await ev(`__suwe.game.current`)) === 1 && (await ev(`__suwe.game.over`)) === false, "player 2 plays on, match continues");
  check((await ev(`document.querySelectorAll('.chip-p.out').length`)) === 1, "your chip is greyed out");
  await badThrow(b, ev);
  await idle(ev);
  check((await ev(`__suwe.game.current`)) === 1, "player 2 keeps the turns, you are skipped");
  check((await ev(`__suwe.game.players[1].lives`)) === 4, "player 2 lost a heart for the miss");
});

// ---- 8. House colour changes the outfit (setup preview and in the game) ----
await session("", async (b, ev) => {
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  const torso = () => ev(`(() => { const c = document.querySelector('.seat-face').getContext('2d'); const d = c.getImageData(120, 126, 1, 1).data; return [d[0], d[1], d[2]]; })()`);
  const near = (a, hex) => {
    const n = parseInt(hex.slice(1), 16);
    return Math.abs(a[0] - (n >> 16)) + Math.abs(a[1] - ((n >> 8) & 255)) + Math.abs(a[2] - (n & 255)) < 30;
  };
  const first = await torso();
  check(near(first, "#d6433b"), `seat 1 outfit starts in its house colour (rgb ${first})`);
  await ev(`document.querySelectorAll('.seat')[0].querySelectorAll('.dot')[4].click()`); // teal (blue is taken by seat 2)
  await sleep(100);
  const second = await torso();
  check(near(second, "#3c9e72"), `picking teal turns the preview outfit teal (rgb ${second})`);
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(300);
  check((await ev(`__suwe.game.players[0].look.primaryColor`)) === "#3c9e72", "the match uses the same outfit colour");
  check((await ev(`__suwe.game.players[1].look.primaryColor`)) === (await ev(`__suwe.game.players[1].color`)), "computer's outfit matches its colour too");
});

// ---- 8b. Colours: taken ones say who has them; nothing changes for other players; never a repeat ----
await session("", async (b, ev) => {
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  await ev(`[...document.querySelectorAll('.chip')].find(c => c.textContent.startsWith('4')).click()`);
  await sleep(100);
  const colours = () => ev(`[...document.querySelectorAll('.seat')].map(s => s.style.getPropertyValue('--c'))`);
  const start = await colours();
  check(new Set(start).size === 4, "4 players start with 4 different colours");
  // Player 1 taps player 2's colour.
  await ev(`document.querySelectorAll('.seat')[0].querySelectorAll('.dot')[1].click()`);
  check(JSON.stringify(await colours()) === JSON.stringify(start), "tapping a taken colour changes nobody's colour");
  check((await ev(`document.getElementById('toast').textContent`)) === "Player 2 has this colour", "it says which player has it");
  check((await ev(`document.querySelectorAll('.seat')[0].querySelectorAll('.dot')[1].textContent`)) === "P2", "taken dot shows the owner's label (P2)");
  // Player 1 picks a free colour: only player 1 changes.
  await ev(`document.querySelectorAll('.seat')[0].querySelectorAll('.dot')[5].click()`);
  const after = await colours();
  check(after[0] !== start[0] && after.slice(1).every((c, i) => c === start[i + 1]), "picking a free colour only changes that player");
  // Hammer it: random clicks never make two players share a colour or touch another seat.
  let bad = 0;
  for (let n = 0; n < 80; n++) {
    const seat = n % 4, dot = (n * 5 + 1) % 6;
    const before = await colours();
    await ev(`document.querySelectorAll('.seat')[${seat}].querySelectorAll('.dot')[${dot}].click()`);
    const now = await colours();
    if (new Set(now).size !== 4 || now.some((c, i) => i !== seat && c !== before[i])) bad++;
  }
  check(bad === 0, "80 random taps: no repeated colours, no other player disturbed");
  const size = await ev(`document.querySelector('.dot').getBoundingClientRect().width`);
  check(size >= 32, `colour dots are big enough to tap (${size}px)`);
});

// ---- 8c. Computers only play 1-on-1 ----
await session("", async (b, ev) => {
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  const cpuTags = () => ev(`document.querySelectorAll('.tag.level').length`);
  const toggles = () => ev(`document.querySelectorAll('.seg.track').length`);
  check((await cpuTags()) === 1 && (await toggles()) === 1, "2 players: seat 2 is a computer by default and can be switched");
  for (const n of [1, 3, 4]) {
    await ev(`[...document.querySelectorAll('.chip')].find(c => c.textContent.startsWith('${n}')).click()`);
    await sleep(100);
    check((await cpuTags()) === 0 && (await toggles()) === 0, `${n} player(s): no computer seats and no Computer switch`);
  }
  // Switching 2 -> 3 turns the computer into a person, and the match has no AI.
  await ev(`[...document.querySelectorAll('.chip')].find(c => c.textContent.startsWith('2')).click()`);
  await sleep(100);
  await ev(`[...document.querySelectorAll('.chip')].find(c => c.textContent.startsWith('3')).click()`);
  await sleep(100);
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(300);
  check((await ev(`__suwe.game.players.length`)) === 3 && (await ev(`__suwe.game.players.every(p => p.ai === null)`)), "a 3-player match has only people");
});

// ---- 8d. Desktop: sensible proportions and a row of cards ----
{
  const b = await launch({ url: "http://localhost:5173/?debug", width: 1280, height: 800, scale: 1, mobile: false });
  const ev = (js) => b.evaluate(js);
  await sleep(400);
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  await ev(`[...document.querySelectorAll('.chip')].find(c => c.textContent.startsWith('4')).click()`);
  await sleep(150);
  const tops = await ev(`[...document.querySelectorAll('.seat')].map(s => Math.round(s.getBoundingClientRect().top))`);
  check(tops.length === 4 && new Set(tops).size === 1, "desktop: 4 player cards sit in one row");
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(400);
  const court = await ev(`(() => { const a = __suwe.px(0, 0), b = __suwe.px(2, 0); const t = __suwe.px(0, 6); return { w: b.x - a.x, h: a.y - t.y }; })()`);
  check(court.w > 200 && court.w < 0.4 * 1280, `desktop: court is a sensible width (${Math.round(court.w)}px of 1280)`);
  check(court.h / court.w > 1 && court.h / court.w < 2.2, `desktop: court keeps its proportions (h/w ${(court.h / court.w).toFixed(2)})`);
  await b.close();
}

// ---- 9. Wrong taps while hopping lose the turn and a heart ----
await session("", async (b, ev) => {
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  await ev(`document.querySelectorAll('.seat')[1].querySelector('.seg button').click()`); // seat 2: Person
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(300);
  const aimed = async (x, y) => {
    const o = { x: 0.95, y: -0.6 };
    const dx = x - o.x, dy = y - o.y;
    const angle = Math.atan2(dx, dy), power = Math.hypot(dx, dy) / 8;
    const s = await ev("__suwe.px(0.95, -0.6)");
    const len = power * 844 * 0.22;
    const fx = s.x - Math.sin(angle) * len, fy = s.y + Math.cos(angle) * len;
    await b.touch("touchStart", s.x, s.y);
    await b.touch("touchMove", fx, fy);
    await sleep(50);
    await b.touch("touchEnd", fx, fy);
  };
  await aimed(0.5, 0.5);
  await idle(ev);
  check((await ev(`__suwe.game.phase`)) === "hop", "stone in square 1, hopping");
  const wrong = await ev("__suwe.px(1.5, 4.5)"); // square 9; the right one is 2
  await b.tap(wrong.x, wrong.y);
  await idle(ev);
  check((await ev(`__suwe.game.players[0].lives`)) === 4, "tapping a different number loses a heart");
  check((await ev(`__suwe.game.current`)) === 1, "...and the turn");
  // Player 2: throw, then tap off the court.
  await aimed(0.5, 0.5);
  await idle(ev);
  await b.tap(8, 300);
  await idle(ev);
  check((await ev(`__suwe.game.players[1].lives`)) === 4, "tapping off the court loses a heart too");
});

// ---- 10. Ra Ile buys a house; the square shows the owner ----
await session("", async (b, ev) => {
  await ev(`(async () => {
    const g = await import("./js/engine/game.js");
    const s = g.createGame({ players: [
      { id: "a", name: "Ada", color: "#d6433b", look: null },
      { id: "b", name: "Bola", color: "#1971c2", look: null },
    ] });
    s.phase = "ra_ile";
    window.__suwe.load(s);
  })()`);
  await sleep(500);
  await b.tap(30, 400); // any real tap lets the browser start sound
  await sleep(300);
  check((await ev(`document.getElementById('hint').textContent`)).startsWith("Ra Ile!"), "hint explains Ra Ile");
  const o = { x: 0.95, y: -0.6 };
  const dx = 1.5 - o.x, dy = 3.5 - o.y; // square 9 is the right column, 4th row up
  const angle = Math.atan2(dx, dy), power = Math.hypot(dx, dy) / 8;
  const s = await ev("__suwe.px(0.95, -0.6)");
  const len = power * 844 * 0.22;
  const fx = s.x - Math.sin(angle) * len, fy = s.y + Math.cos(angle) * len;
  await b.touch("touchStart", s.x, s.y);
  await b.touch("touchMove", fx, fy);
  await sleep(50);
  await b.touch("touchEnd", fx, fy);
  await sleep(1500);
  check((await ev(`document.getElementById('celebrate').hidden`)) === false, "celebration shows");
  check((await ev(`document.querySelector('#celebrate h2').textContent`)) === "You Don Buy House!", "it says 'You Don Buy House!'");
  check((await ev(`__suwe.audio.played().includes('house')`)) === true, "the house fanfare plays");
  await b.shot("shots/h1-celebrate.png");
  await idle(ev);
  await sleep(300);
  check((await ev(`JSON.stringify(__suwe.game.owners[8])`)) === '"a"', "square 9 now belongs to Ada");
  check((await ev(`document.querySelector('.chip-p').textContent`)).includes("⌂1"), "scoreboard shows 1 house");
  await b.shot("shots/h2-house-on-court.png");
});

// ---- 11. A tied full board goes to the tie-break; the closer stone wins; results screen ----
await session("", async (b, ev) => {
  await ev(`(async () => {
    const g = await import("./js/engine/game.js");
    const s = g.createGame({ players: [
      { id: "a", name: "Ada", color: "#d6433b", look: null },
      { id: "b", name: "Bola", color: "#1971c2", look: null },
    ] });
    for (let n = 1; n <= 5; n++) { s.owners[n - 1] = "a"; s.players[0].houses.push(n); }
    for (let n = 6; n <= 11; n++) { s.owners[n - 1] = "b"; s.players[1].houses.push(n); }
    s.phase = "ra_ile";
    window.__suwe.load(s);
  })()`);
  await sleep(400);
  await b.tap(30, 400); // any real tap lets the browser start sound
  await sleep(300);
  const drag = async (x, y) => {
    const o = { x: 0.95, y: -0.6 };
    const dx = x - o.x, dy = y - o.y;
    const angle = Math.atan2(dx, dy), power = Math.hypot(dx, dy) / 8;
    const s = await ev("__suwe.px(0.95, -0.6)");
    const len = power * 844 * 0.22;
    const fx = s.x - Math.sin(angle) * len, fy = s.y + Math.cos(angle) * len;
    await b.touch("touchStart", s.x, s.y);
    await b.touch("touchMove", fx, fy);
    await sleep(50);
    await b.touch("touchEnd", fx, fy);
  };
  await drag(1.5, 0.5); // Ada buys the last square, 12: 6 v 6
  await idle(ev);
  await sleep(300);
  check((await ev(`__suwe.game.phase`)) === "tiebreak", "6 v 6 starts the tie-break");
  await b.shot("shots/h3-tiebreak.png");
  await drag(2.0, 3.0); // Ada: a bit off the mark at (1, 3)
  await idle(ev);
  await drag(1.05, 3.0); // Bola: very close
  await idle(ev);
  await sleep(800);
  check((await ev(`document.getElementById('results').hidden`)) === false, "results screen shows");
  check((await ev(`__suwe.audio.played().includes('drumroll') && __suwe.audio.played().includes('win')`)) === true, "tie-break drum roll and win jingle play");
  check((await ev(`document.getElementById('results-winner').textContent`)) === "Bola", "the closer stone (Bola) wins");
  check((await ev(`document.getElementById('results-why').textContent`)) === "Won the tie-break throw", "results say it was the tie-break");
  check((await ev(`document.querySelectorAll('#results-rows tr').length`)) === 2, "results list both players");
  await b.shot("shots/h4-results.png");
});

// ---- 12. Signed-in start.ng player keeps their own outfit; shows a sash in the house colour ----
await session("&signedin", async (b, ev) => {
  check((await ev(`document.getElementById('player-name').textContent`)) === "Abimbola", "card shows the start.ng character's name");
  check((await ev(`document.getElementById('player-account').textContent`)) === "@abimbola", "card shows @account");
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  check((await ev(`document.querySelector('.seat .cname').textContent`)) === "Abimbola", "seat 1 uses the start.ng name");
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(300);
  check((await ev(`__suwe.game.players[0].look.primaryColor`)) === "#7048e8", "their own outfit colour is kept");
  check((await ev(`__suwe.game.players[0].sash`)) === true, "the house colour shows as a sash instead");
  check((await ev(`__suwe.game.players[0].name`)) === "Abimbola", "the match uses their start.ng name");
});

// ---- 13. On start.ng (mapped locally): not signed in means no playing, only a sign-in button ----
{
  const b = await launch({
    url: "http://suwe-test.start.ng:5173/",
    args: ["--host-resolver-rules=MAP suwe-test.start.ng 127.0.0.1"],
  });
  const ev = (js) => b.evaluate(js);
  const text = () => ev(`document.getElementById('play').textContent`);
  let t = "";
  for (let i = 0; i < 60 && t !== "Sign in to play"; i++) {
    await sleep(250);
    t = await text();
  }
  check(t === "Sign in to play", `not signed in: the menu button says "${t}"`);
  check((await ev(`document.getElementById('player-name').textContent`)) === "Not signed in", "the card says Not signed in");
  check((await ev(`document.getElementById('player-sign-in').hidden`)) === false, "the card has a Sign in button");
  check((await ev(`typeof window.__suwe`)) === "undefined", "no debug hook on start.ng");
  await ev(`document.getElementById('setup').hidden`);
  check((await ev(`document.getElementById('setup').hidden`)) === true, "nothing to play without signing in");
  await b.close();
}

// ---- 14. Sound: starts on the first tap, music runs, toggles work and are remembered ----
{
  const b = await launch({ url: "http://localhost:5173/?debug" });
  const ev = (js) => b.evaluate(js);
  await sleep(400);
  check((await ev(`__suwe.audio.state()`)) === "none", "no sound before the first tap (browser rule)");
  const play = await ev(`(() => { const r = document.getElementById('play').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await b.tap(play.x, play.y); // a real touch counts as a user gesture
  await sleep(1500);
  check((await ev(`__suwe.audio.state()`)) === "running", "the first tap starts the audio engine");
  const steps = await ev(`__suwe.audio.musicSteps()`);
  check(steps >= 8, `music is playing (${steps} steps scheduled in 1.5s)`);
  // Music off: scheduling stops.
  await ev(`document.getElementById('setup').hidden || document.getElementById('menu-btn')`);
  await ev(`document.querySelector('#setup .setup-back')?.click()`);
  await sleep(200);
  await ev(`document.getElementById('opt-music').click()`);
  const s1 = await ev(`__suwe.audio.musicSteps()`);
  await sleep(600);
  const s2 = await ev(`__suwe.audio.musicSteps()`);
  check(s1 === s2, "turning music off stops the beat");
  check((await ev(`document.getElementById('opt-music').textContent`)) === "Music: Off", "button shows Music: Off");
  await ev(`document.getElementById('opt-voice').click()`);
  // Remembered after a reload.
  await ev(`location.reload()`);
  await sleep(1500);
  check((await ev(`document.getElementById('opt-music').textContent`)) === "Music: Off", "Music: Off is remembered after reload");
  check((await ev(`document.getElementById('opt-voice').textContent`)) === "Voice lines: On", "Voice lines: On is remembered too");
  check((await ev(`document.getElementById('opt-sfx').textContent`)) === "Sound effects: On", "sound effects still on");
  // In a match, the Sound button flips everything.
  await ev(`document.getElementById('opt-music').click()`); // music back on
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(300);
  await ev(`document.getElementById('sound-btn').click()`);
  check((await ev(`document.getElementById('sound-btn').textContent`)) === "Sound off", "in a match, Sound button turns everything off");
  check((await ev(`__suwe.audio.prefs.music === false && __suwe.audio.prefs.sfx === false`)), "both music and effects are off");
  await ev(`document.getElementById('sound-btn').click()`);
  check((await ev(`document.getElementById('sound-btn').textContent`)) === "Sound on", "and back on");
  check(b.problems.length === 0, "no console errors with sound running");
  if (b.problems.length) console.log(b.problems.join("\n"));
  await b.close();
}

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
process.exit(fails.length ? 1 : 0);
