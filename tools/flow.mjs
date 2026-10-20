// Menu, setup, solo, vs-computer, lives and guest-limit flows through the real DOM.
import { launch, sleep } from "./cdp.mjs";

const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) fails.push(msg);
};

// FLOW_FROM=n skips the first n sessions (and the inline blocks), to rerun just the newer checks.
const FROM = Number(process.env.FLOW_FROM ?? 0);
let sessionNo = 0;

// Software WebGL, so the 3D scene runs in a headless browser without a GPU.
const GL = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

async function session(query, fn) {
  if (sessionNo++ < FROM) return;
    const b = await launch({
    url: `http://localhost:5173/?debug${query}`,
    scale: 1,
    args: GL,
  });
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

// The setup now opens as 1 player. Pick a different count when a test needs more seats.
const pick = async (ev, n) => {
  await ev(`[...document.querySelectorAll('.chip')].find(c => c.textContent.startsWith('${n}')).click()`);
  await sleep(100);
};

const idle = async (ev) => {
  for (let i = 0; i < 400; i++) {
    // A person's missed card waits for OK, like a player would press it.
    await ev(`(() => { const m = document.getElementById("pill"); if (m && !m.hidden) m.click(); })()`);
    if (!(await ev("__suwe.busy"))) return;
    await sleep(50);
  }
};
// Hold the stone with the ring pinned where the throw should land (cell units), then let go.
async function holdAt(b, ev, x, y) {
  await ev(`__suwe.ring(${x}, ${y})`);
  const s = await ev("__suwe.px(0.95, -0.6)");
  await b.touch("touchStart", s.x, s.y);
  await sleep(60);
  await b.touch("touchEnd", s.x, s.y);
  await ev(`__suwe.ring()`);
}
// A throw that surely misses (the ring far past the court).
async function badThrow(b, ev) {
  await holdAt(b, ev, 1, 9);
}

// ---- 1. Setup screen ----
await session("", async (b, ev) => {
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  check((await ev(`document.querySelectorAll('.seat').length`)) === 1, "setup starts with 1 player (solo), not 2");
  check((await ev(`document.querySelector('.chip.on').textContent`)).startsWith("1"), "the 1 player option is selected");
  // The start button has the same title whatever the player count.
  for (const n of [1, 2, 3, 4]) {
    await pick(ev, n);
    check((await ev(`document.querySelector('#setup .big').textContent`)) === "Start match", `${n} player(s): the button says "Start match"`);
  }
  await pick(ev, 1);
  await pick(ev, 2);
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
  check((await ev(`document.querySelectorAll('.pcard').length`)) === 4, "scoreboard shows all 4 players");
});

// ---- 2. Solo: no "your turn", no passing ----
await session("", async (b, ev) => {
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  await ev(`[...document.querySelectorAll('.chip')].find(c => c.textContent.startsWith('1')).click()`);
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(400);
  check((await ev(`document.getElementById('toast').textContent`)) === "Oya, throw!", "solo says 'Oya, throw!' not 'your turn'");
  check((await ev(`__suwe.game.turnNo`)) === 1, "solo starts at attempt 1");
  await badThrow(b, ev);
  await idle(ev);
  check((await ev(`__suwe.game.current`)) === 0 && (await ev(`__suwe.game.turnNo`)) === 2, "solo: after a miss it is still you, attempt 2");
  check((await ev(`document.getElementById('toast').textContent`)) === "Throw again!", "solo wording after a miss");
  check((await ev(`__suwe.game.turnNo`)) === 2, "attempt counter went up");
});

// ---- 3. Versus computer (easy): it plays by itself after you miss ----
await session("", async (b, ev) => {
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  await pick(ev, 2);
  await ev(`document.querySelectorAll('.seat')[1].querySelector('.seg.wide button').click()`); // seat 2 level: Easy
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(400);
  check((await ev(`__suwe.game.players[1].ai`)) === "easy", "seat 2 is an easy computer");
  await badThrow(b, ev);
  await idle(ev);
  check((await ev(`__suwe.game.current`)) === 1, "turn passed to the computer");
  const hint = await ev(`document.getElementById('watch-title').textContent`);
  check(/ is (throwing|hopping)/.test(hint) && (await ev(`document.getElementById('watchbar').hidden`)) === false, `the Watching card says the computer is playing ("${hint}")`);
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
  check((await ev(`document.getElementById('profile-lives').textContent`)).includes("5 of 5 lives"), "home shows 5 of 5 lives");
  for (let i = 0; i < 5; i++) await ev(`__suwe.spendLife()`);
  await sleep(1200);
  check((await ev(`document.getElementById('profile-lives').textContent`)).includes("0 of 5 lives"), "lives all gone after 5 losses");
  const note = await ev(`document.getElementById('profile-lives').textContent`);
  check(/\+1 in (29:\d\d|30:00)$/.test(note), `countdown shown (${note})`);
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
  check((await ev(`document.querySelector('.pcard .pstats').textContent`)).startsWith("5 ·"), "scoreboard shows 5 lives");
  await badThrow(b, ev);
  await idle(ev);
  check((await ev(`document.querySelector('.pcard .pstats').textContent`)).startsWith("4 ·"), "a failed turn costs a life (4 lives)");
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
  await pick(ev, 2);
  await ev(`document.querySelectorAll('.seat')[1].querySelector('.seg button').click()`); // seat 2: Person
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(400);
  check((await ev(`__suwe.game.players[0].lives`)) === 1, "you start the match with your saved single heart");
  await badThrow(b, ev);
  await idle(ev);
  check((await ev(`__suwe.game.players[0].out`)) === true, "you are out");
  check((await ev(`__suwe.game.current`)) === 1 && (await ev(`__suwe.game.over`)) === false, "player 2 plays on, match continues");
  check((await ev(`document.querySelectorAll('.pcard.out').length`)) === 1, "your chip is greyed out");
  await badThrow(b, ev);
  await idle(ev);
  check((await ev(`__suwe.game.current`)) === 1, "player 2 keeps the turns, you are skipped");
  check((await ev(`__suwe.game.players[1].lives`)) === 4, "player 2 lost a heart for the miss");
});

// ---- 8. House colour changes the outfit (setup preview and in the game) ----
await session("", async (b, ev) => {
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  await pick(ev, 2);
  const torso = () => ev(`(() => { const c = document.querySelector('.seat-face').getContext('2d'); const d = c.getImageData(90, 92, 1, 1).data; return [d[0], d[1], d[2]]; })()`);
  const near = (a, hex) => {
    const n = parseInt(hex.slice(1), 16);
    return Math.abs(a[0] - (n >> 16)) + Math.abs(a[1] - ((n >> 8) & 255)) + Math.abs(a[2] - (n & 255)) < 30;
  };
  const first = await torso();
  check(near(first, "#e03131"), `seat 1 outfit starts in its house colour (rgb ${first})`);
  await ev(`document.querySelectorAll('.seat')[0].querySelectorAll('.dot')[4].click()`); // teal (blue is taken by seat 2)
  await sleep(100);
  const second = await torso();
  check(near(second, "#0ca678"), `picking teal turns the preview outfit teal (rgb ${second})`);
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(300);
  check((await ev(`__suwe.game.players[0].look.primaryColor`)) === "#0ca678", "the match uses the same outfit colour");
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
  check((await ev(`document.querySelectorAll('.seat')[0].querySelectorAll('.dot')[1].getAttribute('aria-label')`)) === "Colour used by player 2" && (await ev(`document.querySelectorAll('.seat')[0].querySelectorAll('.dot')[1].classList.contains('taken')`)), "a taken colour is pale and says who has it (player 2)");
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
  check((await cpuTags()) === 0 && (await toggles()) === 0, "1 player (the default): no computer");
  await pick(ev, 2);
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
if (!FROM) {
  const b = await launch({ url: "http://localhost:5173/?debug", width: 1280, height: 800, scale: 1, mobile: false, args: GL });
  const ev = (js) => b.evaluate(js);
  await sleep(400);
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  await ev(`[...document.querySelectorAll('.chip')].find(c => c.textContent.startsWith('4')).click()`);
  await sleep(150);
  const tops = await ev(`[...document.querySelectorAll('.seat')].map(s => Math.round(s.getBoundingClientRect().top))`);
  check(tops.length === 4 && new Set(tops).size === 2, "desktop: 4 players sit in two rows of two");
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(400);
  const court = await ev(`(() => { const a = __suwe.px(0, 0), b = __suwe.px(2, 0); const t = __suwe.px(0, 6); return { w: b.x - a.x, h: a.y - t.y }; })()`);
  check(court.w > 200 && court.w < 0.5 * 1280, `desktop: court is a sensible width (${Math.round(court.w)}px of 1280)`);
  check(court.h / court.w > 0.6 && court.h / court.w < 2.2, `desktop: court keeps its proportions (h/w ${(court.h / court.w).toFixed(2)})`);
  await b.close();
}

// ---- 9. Wrong taps while hopping lose the turn and a heart ----
await session("", async (b, ev) => {
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  await pick(ev, 2);
  await ev(`document.querySelectorAll('.seat')[1].querySelector('.seg button').click()`); // seat 2: Person
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(300);
  const aimed = async (x, y) => holdAt(b, ev, x, y);
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
  check((await ev(`document.getElementById('bar-title').textContent`)) === "Throw over your shoulder", "the bar explains Ra Ile");
  await holdAt(b, ev, 1.5, 3.5); // square 9, the right column, 4th row up
  await sleep(1500);
  check((await ev(`document.getElementById('celebrate').hidden`)) === false, "celebration shows");
  check((await ev(`document.querySelector('#celebrate h2').textContent`)) === "You Don Buy House!", "it says 'You Don Buy House!'");
  check((await ev(`__suwe.audio.played().includes('house')`)) === true, "the house fanfare plays");
  await b.shot("shots/h1-celebrate.png");
  await idle(ev);
  await sleep(300);
  check((await ev(`JSON.stringify(__suwe.game.owners[8])`)) === '"a"', "square 9 now belongs to Ada");
  check((await ev(`__suwe.view.houses.length`)) === 1, "the new house shows on the court");
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
  const drag = async (x, y) => holdAt(b, ev, x, y);
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
  check((await ev(`document.getElementById('profile-lives').textContent`)).includes("lives"), "card shows the lives line");
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
if (!FROM) {
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
if (!FROM) {
  const b = await launch({ url: "http://localhost:5173/?debug", scale: 1, args: GL });
  const ev = (js) => b.evaluate(js);
  await sleep(400);
  check((await ev(`__suwe.audio.state()`)) === "none", "no sound before the first tap (browser rule)");
  const play = await ev(`(() => { const r = document.getElementById('play').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await b.tap(play.x, play.y); // a real touch counts as a user gesture
  await sleep(1500);
  check((await ev(`__suwe.audio.state()`)) === "running", "the first tap starts the audio engine");
  const steps = await ev(`__suwe.audio.musicSteps()`);
  const clock = await ev(`__suwe.audio.time()`);
  if (clock < 0.5) {
    // Headless Chrome on some machines has no working audio output, so the audio clock never moves.
    console.log(`SKIP  music scheduling: this machine's audio clock is not running (t=${clock.toFixed(3)}s)`);
  } else {
    check(steps >= 8, `music is playing (${steps} steps scheduled in 1.5s)`);
  }
  // Music off: scheduling stops.
  await ev(`document.querySelector('#setup .setup-back')?.click()`);
  await sleep(200);
  await ev(`document.getElementById('opt-music').click()`);
  const s1 = await ev(`__suwe.audio.musicSteps()`);
  await sleep(600);
  const s2 = await ev(`__suwe.audio.musicSteps()`);
  check(s1 === s2, "turning music off stops the beat");
  check((await ev(`document.getElementById('opt-music').getAttribute('aria-checked')`)) === "false", "button shows Music: Off");
  await ev(`document.getElementById('opt-voice').click()`);
  // Remembered after a reload.
  await ev(`location.reload()`);
  await sleep(1500);
  check((await ev(`document.getElementById('opt-music').getAttribute('aria-checked')`)) === "false", "Music: Off is remembered after reload");
  check((await ev(`document.getElementById('opt-voice').getAttribute('aria-checked')`)) === "true", "Voice lines: On is remembered too");
  check((await ev(`document.getElementById('opt-sfx').getAttribute('aria-checked')`)) === "true", "sound effects still on");
  // In a match, the Sound button flips everything.
  await ev(`document.getElementById('opt-music').click()`); // music back on
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(300);
  await ev(`document.getElementById('sound-btn').click()`);
  check((await ev(`document.getElementById('sound-btn').getAttribute('aria-label')`)) === "Turn sound on", "in a match, Sound button turns everything off");
  check((await ev(`__suwe.audio.prefs.music === false && __suwe.audio.prefs.sfx === false`)), "both music and effects are off");
  await ev(`document.getElementById('sound-btn').click()`);
  check((await ev(`document.getElementById('sound-btn').getAttribute('aria-label')`)) === "Turn sound off", "and back on");
  check(b.problems.length === 0, "no console errors with sound running");
  if (b.problems.length) console.log(b.problems.join("\n"));
  await b.close();
}

// ---- 15. How to play: seven slides, "New" badge, "Try it now" opens solo practice ----
await session("", async (b, ev) => {
  check((await ev(`document.getElementById('howto-new').hidden`)) === false, "How to play shows a New badge at first");
  await ev(`document.getElementById('open-howto').click()`);
  await sleep(300);
  check((await ev(`document.querySelectorAll('.tut-dots i').length`)) === 7, "the tutorial has 7 steps");
  check((await ev(`document.querySelector('.setup-title').textContent`)) === "The court", "it starts with the court");
  for (let i = 0; i < 6; i++) await ev(`document.querySelector('.tut-nav .big').click()`);
  check((await ev(`document.querySelector('.tut-nav .big').textContent`)) === "Try it now", "last step offers Try it now");
  await ev(`document.querySelector('.tut-nav .opt').click()`);
  check((await ev(`document.querySelector('.setup-sub').textContent`)) === "Step 6 of 7", "Back goes to the previous step");
  await ev(`document.querySelector('.tut-nav .big').click()`);
  await ev(`document.querySelector('.tut-nav .big').click()`);
  check((await ev(`document.getElementById('setup').hidden`)) === false, "Try it now opens the player setup");
  check((await ev(`document.querySelector('.chip.on').textContent`)).startsWith("1"), "...set to solo practice");
  await ev(`document.querySelector('#setup .setup-back').click()`);
  check((await ev(`document.getElementById('howto-new').hidden`)) === true, "the New badge is gone after viewing");
  check(b.problems.length === 0, "tutorial animations run without errors");
});

// ---- 16. Settings ----
await session("", async (b, ev) => {
  await ev(`document.getElementById('open-settings').click()`);
  await sleep(200);
  check((await ev(`document.getElementById('settings').hidden`)) === false, "Settings opens");
  check((await ev(`document.getElementById('discard-save').hidden`)) === true, "no saved match to delete yet");
  await ev(`document.getElementById('opt-sfx').click()`);
  check((await ev(`document.getElementById('opt-sfx').getAttribute('aria-checked')`)) === "false", "a sound switch flips");
  await ev(`document.getElementById('settings-back').click()`);
  check((await ev(`document.getElementById('menu').hidden`)) === false, "Back returns to the menu");
});

// ---- 17. Saved matches ----
await session("", async (b, ev) => {
  check((await ev(`document.getElementById('continue').hidden`)) === true, "no Continue button without a saved match");
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  await pick(ev, 2);
  await ev(`document.querySelectorAll('.seat')[1].querySelector('.seg button').click()`); // seat 2: Person
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(300);
  check((await ev(`__suwe.saved !== null`)) === true, "starting a match saves it");
  await holdAt(b, ev, 0.5, 0.5);
  await idle(ev);
  check((await ev(`__suwe.game.phase`)) === "hop", "stone thrown into square 1, mid-turn");
  const before = await ev(`JSON.stringify(__suwe.game)`);
  check((await ev(`JSON.stringify(__suwe.saved.game)`)) === before, "the save matches the match exactly");
  // Close the tab, come back: Continue puts everything back.
  await ev(`location.reload()`);
  await sleep(1500);
  check((await ev(`document.getElementById('continue').hidden`)) === false, "after a reload, Continue match is offered");
  await ev(`document.getElementById('continue').click()`);
  await sleep(300);
  check((await ev(`JSON.stringify(__suwe.game)`)) === before, "the resumed match is identical, mid-hop");
  check((await ev(`document.getElementById('bar-title').textContent`)).length > 0 && (await ev(`__suwe.game.phase`)) === "hop", "and it is playable: waiting for the next hop");
  check((await ev(`__suwe.saved.elapsed >= 0`)) === true, "match time is kept");
  // Pausing keeps the save; starting a new match asks first.
  await ev(`document.getElementById('menu-btn').click()`); // Menu opens the pause drawer...
  await sleep(300);
  await ev(`document.getElementById('pause-leave').click()`); // ...and "Save and go to menu" leaves
  await sleep(200);
  check((await ev(`document.getElementById('continue').hidden`)) === false, "leaving from the pause menu keeps the save");
  let asked = "";
  await ev(`window.confirm = (m) => { window.__asked = m; return false; }`);
  await ev(`document.getElementById('play').click()`);
  asked = await ev(`window.__asked`);
  check(/saved match will be lost/.test(asked ?? "") && (await ev(`document.getElementById('setup').hidden`)) === true, "Play warns before replacing a saved match, and cancel stays put");
  await ev(`window.confirm = () => true`);
  await ev(`document.getElementById('play').click()`);
  check((await ev(`document.getElementById('setup').hidden`)) === false, "confirming goes on to a new match");
  // Settings can delete it.
  await ev(`document.querySelector('#setup .setup-back').click()`);
  await ev(`document.getElementById('open-settings').click()`);
  check((await ev(`document.getElementById('discard-save').hidden`)) === false, "Settings offers to delete the saved match");
  await ev(`document.getElementById('discard-save').click()`);
  check((await ev(`__suwe.saved`)) === null, "deleting works");
});

// ---- 17b. Broken or someone else's saves are ignored ----
await session("", async (b, ev) => {
  for (const [label, value] of [
    ["not JSON", "{oops"],
    ["empty game", JSON.stringify({ v: 1, owner: "local", game: {}, elapsed: 5 })],
    ["wrong version", JSON.stringify({ v: 9, owner: "local", game: {}, elapsed: 5 })],
  ]) {
    await ev(`localStorage.setItem('suwe.match', ${JSON.stringify(value)})`);
    await ev(`location.reload()`);
    await sleep(900);
    check((await ev(`document.getElementById('continue').hidden`)) === true, `a broken save (${label}) is ignored`);
    check((await ev(`localStorage.getItem('suwe.match')`)) === null, `...and cleaned up (${label})`);
  }
  // A real save that belongs to another player.
  await ev(`document.getElementById('play').click()`);
  await sleep(150);
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(300);
  await ev(`document.getElementById('menu-btn').click()`); // pause (a running match re-saves itself)
  await sleep(300);
  await ev(`document.getElementById('pause-leave').click()`);
  await sleep(200);
  await ev(`(() => { const d = JSON.parse(localStorage.getItem('suwe.match')); d.owner = "someone-else"; localStorage.setItem('suwe.match', JSON.stringify(d)); })()`);
  await ev(`location.reload()`);
  await sleep(900);
  check((await ev(`document.getElementById('continue').hidden`)) === true, "another player's saved match is not offered");
});

// ---- 18. Leaderboard and score saving ----
await session("&signedin", async (b, ev) => {
  // Without start.ng there is nothing to show.
  await ev(`document.getElementById('open-lb').click()`);
  await sleep(300);
  check((await ev(`document.getElementById('lb-status').textContent`)).includes("suwe.start.ng"), "locally it says the leaderboard works on suwe.start.ng");
  await ev(`document.getElementById('lb-back').click()`);
  // A fake start.ng answers.
  await ev(`window.__sent = []; __suwe.setTransport(async (msg) => {
    window.__sent.push(msg);
    if (msg.type === 'startng:leaderboard') return { ok: true, entries: [
      { rank: 1, player_id: 7, name: 'Trini', score: 8, stats: { houses: 8, level: 2, accuracy: 91, mistakes: 3, seconds: 400 } },
      { rank: 2, player_id: 42, name: 'Abimbola', score: 6, stats: { houses: 6, level: 2, accuracy: 80, mistakes: 5, seconds: 521 } },
    ] };
    if (msg.type === 'startng:score') return { ok: true, result: { best: msg.stats.houses, improved: true, rank: 2, stats: msg.stats } };
    return null;
  })`);
  await ev(`document.getElementById('open-lb').click()`);
  await sleep(300);
  check((await ev(`document.querySelectorAll('.lb-row').length`)) === 2, "leaderboard lists the players");
  check((await ev(`document.querySelector('.lb-row').textContent`)).includes("Trini") && (await ev(`document.querySelector('.lb-row').textContent`)).includes("91%"), "with houses, accuracy and name");
  check((await ev(`document.querySelectorAll('.lb-row.me').length`)) === 1 && (await ev(`document.querySelector('.lb-row.me').textContent`)).includes("Abimbola"), "my own row is highlighted");
  check((await ev(`document.querySelector('.lb-row.me').textContent`)).includes("8:41"), "match time is shown as m:ss");
  await ev(`document.querySelector('#lb-tabs [data-level="3"]').click()`);
  await sleep(300);
  check((await ev(`document.querySelectorAll('.lb-row.first, .lb-row.open').length`)) > 0 && (await ev(`document.getElementById('lb-status').textContent`)).includes("Hard"), "the Hard tab only lists Hard wins (none yet)");
  await ev(`document.querySelector('#lb-tabs [data-level="2"]').click()`);
  await sleep(300);
  await ev(`window.__sent.length = 0`);
  // Finish a match against a Hard computer: 7 houses v 4, last square decides.
  const finish = async (level, expectText) => {
    await ev(`(async () => {
      const g = await import("./js/engine/game.js");
      const s = g.createGame({ players: [
        { id: "a", name: "Abimbola", color: "#d6433b", look: null },
        ${level ? `{ id: "b", name: "Tunde", color: "#3b78c9", ai: "${level}", look: null }` : `{ id: "b", name: "Bola", color: "#3b78c9", look: null }`},
      ] });
      for (let n = 1; n <= 7; n++) { s.owners[n - 1] = "a"; s.players[0].houses.push(n); }
      for (let n = 8; n <= 11; n++) { s.owners[n - 1] = "b"; s.players[1].houses.push(n); }
      s.players[0].stats = { throws: 20, hits: 15, mistakes: 3 };
      s.phase = "ra_ile";
      window.__suwe.load(s);
    })()`);
    await sleep(300);
    await b.tap(30, 400);
    await sleep(200);
    await holdAt(b, ev, 1.5, 0.5); // square 12
    await idle(ev);
    await sleep(1200);
    return ev(`document.getElementById('results-score').textContent`);
  };
  const msg = await finish("hard");
  const sent = await ev(`JSON.stringify(window.__sent.filter(m => m.type === 'startng:score'))`);
  const scores = JSON.parse(sent);
  check(scores.length === 1, "a finished match vs Hard submits one score");
  const st = scores[0].stats;
  check(JSON.stringify(Object.keys(st)) === JSON.stringify(["houses", "level", "accuracy", "mistakes", "seconds"]), "it sends exactly the five stats");
  check(Object.values(st).every((v) => Number.isInteger(v) && v >= 0 && v <= 1e9), "each a whole number in range");
  check(st.level === 3, "a win against Hard is sent as level 3");
  check(st.houses === 8 && st.mistakes === 3, `with the right values (houses ${st.houses}, mistakes ${st.mistakes})`);
  check(msg.includes("New best") && msg.includes("#2"), `results show the rank ("${msg}")`);
  await ev(`window.__sent.length = 0`);
  const easy = await finish("easy");
  check((await ev(`window.__sent.filter(m => m.type === 'startng:score').length`)) === 0, "Easy matches submit nothing");
  check(easy.includes("Easy matches don't count"), "and the results say why");
  const people = await finish(null);
  check((await ev(`window.__sent.filter(m => m.type === 'startng:score').length`)) === 0 && people === "", "matches between people never submit");
});

// ---- 19. Voice lines: spoken only when switched on, and only key phrases ----
await session("", async (b, ev) => {
  await ev(`window.__said = []; speechSynthesis.speak = (u) => window.__said.push(u.text);`);
  await ev(`document.getElementById('play').click()`);
  await sleep(150);
  await pick(ev, 2);
  await ev(`document.querySelectorAll('.seat')[1].querySelector('.seg button').click()`);
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(500);
  check((await ev(`window.__said.length`)) === 0, "voice is off by default: nothing is spoken");
  await ev(`document.getElementById('opt-voice').click()`); // on
  const badThrow = async () => {
    await holdAt(b, ev, 1, 9);
    await idle(ev);
    await sleep(500);
  };
  await badThrow();
  const said = await ev(`window.__said`);
  check(said.includes("Try again"), `a miss says "Try again" (${said.join(" | ")})`);
  check(said.includes("Oya, your turn"), "the next player is called with \"Oya, your turn\"");
  check(said.every((t) => t.length < 30), "only short key phrases are spoken");
});

// ---- 20. Pause menu: Menu pauses and slides a drawer in; pressing it again goes back ----
await session("", async (b, ev) => {
  const setup2 = (extra) => ev(`(async () => {
    const g = await import("./js/engine/game.js");
    const s = g.createGame({ players: [
      { id: "a", name: "Ada", color: "#d6433b", look: null },
      { id: "b", name: "Tunde", color: "#3b78c9", ai: "medium", look: null },
    ] });
    ${extra}
    window.__suwe.load(s);
  })()`);
  const paused = () => ev(`document.body.classList.contains('paused')`);
  const drawerTop = () => ev(`Math.round(document.getElementById('pause-menu').getBoundingClientRect().top)`);

  // It is the computer's turn: opening the menu straight away must hold it back.
  await setup2("s.current = 1;");
  await ev(`document.getElementById('menu-btn').click()`);
  await sleep(500);
  check((await paused()) === true, "Menu pauses the match");
  check((await paused()) === true, "the match is paused");
  check((await drawerTop()) < 844, `the pause sheet has slid up (top edge ${await drawerTop()}px of 844)`);
  const frozen = await ev(`JSON.stringify(__suwe.game)`);
  await sleep(3500);
  check((await ev(`JSON.stringify(__suwe.game)`)) === frozen, "while paused, the computer does not play");
  // Pressing Menu again goes back, and the computer carries on.
  await ev(`document.getElementById('menu-btn').click()`);
  await sleep(500);
  check((await paused()) === false, "pressing Menu again closes it");
  check((await drawerTop()) >= 844, "...and it slides back out of view");
  check((await paused()) === false, "and it is running again");
  await sleep(3500);
  check((await ev(`__suwe.game.players[1].stats.throws`)) > 0, "after closing, the computer plays again");

  // Your turn: input does nothing while paused.
  await setup2("");
  const dragOnce = async () => holdAt(b, ev, 1, 9);
  await ev(`document.getElementById('menu-btn').click()`);
  await sleep(400);
  const before = await ev(`JSON.stringify(__suwe.game)`);
  await dragOnce();
  await sleep(300);
  check((await ev(`JSON.stringify(__suwe.game)`)) === before, "while paused, throwing does nothing");
  // The dark area behind the menu also closes it.
  await b.tap(195, 60); // above the sheet
  await sleep(400);
  check((await paused()) === false, "tapping the dark area closes the menu");
  // Escape toggles.
  await ev(`dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  check((await paused()) === true, "Esc opens it");
  await ev(`dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  check((await paused()) === false, "Esc closes it");

  // Pausing mid-throw freezes the stone in the air; resuming lets it land.
  await dragOnce();
  await sleep(250);
  await ev(`document.getElementById('menu-btn').click()`);
  await sleep(200);
  const x1 = await ev(`JSON.stringify(__suwe.view.stone)`);
  await sleep(900);
  check((await ev(`JSON.stringify(__suwe.view.stone)`)) === x1, "the stone stays frozen in mid-air while paused");
  await ev(`document.getElementById('pause-resume').click()`);
  await idle(ev);
  check((await paused()) === false && (await ev(`__suwe.busy`)) === false, "Resume lets the throw finish");

  // The menu's items.
  await ev(`document.getElementById('menu-btn').click()`);
  await sleep(300);
  await ev(`document.getElementById('pause-music').click()`);
  check((await ev(`document.getElementById('pause-music').getAttribute('aria-checked')`)) === "false", "sound switches work inside the pause menu");
  await ev(`document.getElementById('pause-howto').click()`);
  await sleep(300);
  check((await ev(`document.getElementById('howto').hidden`)) === false, "How to play opens from the pause menu");
  await ev(`document.querySelector('#howto .setup-back').click()`);
  await sleep(300);
  check((await ev(`document.getElementById('howto').hidden`)) === true && (await paused()) === true, "Back returns to the paused match");
  await ev(`document.getElementById('pause-leave').click()`);
  await sleep(300);
  check((await ev(`document.getElementById('menu').hidden`)) === false, "Save and go to menu goes to the main menu");
  check((await paused()) === false, "and the pause is cleared");
});

// ---- 21. Lives: the 30-minute refill starts at the first lost heart and hearts come back mid-match ----
await session("", async (b, ev) => {
  await ev(`document.getElementById('play').click()`);
  await sleep(200);
  await ev(`document.querySelector('#setup .big').click()`);
  await sleep(600);
  check((await ev(`__suwe.lives.since`)) === null, "full hearts: no refill timer running");
  await badThrow(b, ev);
  await idle(ev);
  await sleep(300);
  const lost = await ev(`JSON.stringify(__suwe.lives)`);
  const L = JSON.parse(lost);
  check(L.lives === 4 && Number.isFinite(L.since), "the first lost heart starts the refill timer straight away");
  check((await ev(`document.getElementById('profile-lives').textContent`)).includes("+1 in 29:"), "and home counts down from 30:00");
  // 31 minutes later, in the middle of the match
  await ev(`__suwe.setLives({ lives: 4, since: Date.now() - 31 * 60000 })`);
  await sleep(1400);
  check((await ev(`__suwe.lives.lives`)) === 5, "after 30 minutes the saved heart is back");
  check((await ev(`__suwe.game.players[0].lives`)) === 5, "and it is back in the match too");
  await badThrow(b, ev);
  await idle(ev);
  await sleep(300);
  check((await ev(`__suwe.game.players[0].lives`)) === 4 && (await ev(`__suwe.lives.lives`)) === 4, "losing a heart after a refill costs one heart, not two");
});

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
process.exit(fails.length ? 1 : 0);
