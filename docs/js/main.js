import { createScene } from "./render/scene.js";
import { DEFAULT_STYLE, STOCK } from "./render/character.js";
import { createDirector } from "./director.js";
import {
  createGame,
  applyMove,
  expectation,
  resolveThrow,
  THROW_ORIGIN,
  MAX_ANGLE,
} from "./engine/game.js";
import { onStartNg, signInUrl, watchPlayer } from "./startng.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const scene = createScene(canvas);

// Pass-and-play for now: you, then a second player on the same phone.
const PLAYERS = [
  { id: "you", name: "You" },
  { id: "p2", name: STOCK[1].name },
];
const styles = { you: DEFAULT_STYLE, p2: STOCK[1].style };
const newGame = () => createGame({ seed: Date.now() >>> 0, players: PLAYERS });
let game = newGame();

// --- toast (voice line bubble) --------------------------------------------------
let toastTimer;
function say(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1600);
}

const director = createDirector({
  style: DEFAULT_STYLE,
  say,
  onFlash: (f) => (director.view.flash = { ...f, t0: performance.now(), dur: 700 }),
  onTurn: (id) => startTurn(id),
});
const view = director.view;

// Whose turn it is: they take the court, the others wait beside the start.
function applyLooks() {
  const id = game.players[game.current].id;
  view.hero.style = styles[id];
  view.waiting = game.players
    .filter((p) => p.id !== id)
    .map((p, i) => ({ style: styles[p.id], x: 1.7 + i * 0.5, y: -1.1 }));
}

function startTurn(id) {
  const me = game.players.find((p) => p.id === id);
  applyLooks();
  say(`Oya, ${me.name === "You" ? "your turn" : `${me.name}, your turn`}`);
  refreshHud();
}

function fit() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  scene.resize(window.innerWidth, window.innerHeight, dpr);
}
addEventListener("resize", fit);
fit();

// --- HUD ----------------------------------------------------------------------
const pips = $("pips");
for (let n = 1; n <= 12; n++) {
  const d = document.createElement("i");
  d.textContent = n;
  pips.append(d);
}

function hintText(e) {
  if (e.kind === "throw") return "Drag the stone back, then let go to throw";
  if (e.kind === "pickup") return "Tap Pick up when the needle is in the green";
  if (e.needsTiming) return "Big jump! Tap the glowing square with the needle in the green";
  return e.to === "start" ? "Tap HOME to finish" : "Tap the glowing square";
}

let meterStart = performance.now();
let lastKey = "";

function refreshHud() {
  const p = game.players[game.current];
  $("target").textContent = `${p.name} · Target ${p.target}`;
  $("turn").textContent = `Turn ${game.turnNo}${p.circuits ? ` · Round ${p.circuits + 1}` : ""}`;
  [...pips.children].forEach((d, i) => d.classList.toggle("done", i + 1 < p.target));
  [...pips.children].forEach((d, i) => d.classList.toggle("now", i + 1 === p.target));
  const e = expectation(game);
  $("hint").textContent = hintText(e);
  $("pickup").hidden = game.phase !== "pickup";
  $("meter").hidden = !e.needsTiming;
  if (e.needsTiming) $("zone").style.width = `${e.zone * 100}%`;
  view.hint = e.kind === "throw" ? e.target : e.kind === "hop" ? e.to : null;
  // Restart the needle for each new thing to do.
  const key = `${game.turnNo}:${game.phase}:${game.turn?.i ?? ""}`;
  if (key !== lastKey) {
    lastKey = key;
    meterStart = performance.now();
  }
}

function needle(now) {
  const p = game.players[game.current];
  const period = 2800 - 60 * p.target;
  return Math.sin(((now - meterStart) / period) * Math.PI * 2);
}

// --- playing a move -------------------------------------------------------------
function submit(move) {
  const r = applyMove(game, move);
  if (r.rejected) return;
  game = r.state;
  view.aim = null;
  view.hint = null;
  $("meter").classList.add("locked");
  director.play(r.events);
}

// --- input ------------------------------------------------------------------------
const MIN_POWER = 0.12;
let drag = null;

function stonePx() {
  return scene.project(THROW_ORIGIN.x, THROW_ORIGIN.y);
}

function aimFrom(x, y) {
  const s = stonePx();
  const dirX = s.x - x;
  const dirY = y - s.y;
  if (dirY <= 4) return null; // must pull back (down the screen)
  const maxDrag = window.innerHeight * 0.22;
  const power = Math.min(1, Math.hypot(dirX, dirY) / maxDrag);
  const angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, Math.atan2(dirX, dirY)));
  return { power, angle };
}

canvas.addEventListener("pointerdown", (e) => {
  if (director.busy) return;
  if (game.phase === "throw") {
    const s = stonePx();
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 64) return;
    drag = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    moveDrag(e);
  } else if (game.phase === "hop") {
    const sq = scene.hitSquare(e.clientX, e.clientY);
    // A stray tap on some other square is ignored. Only the stone's square
    // (a real mistake in Suwe) or the glowing one counts.
    const ok = sq === expectation(game).to || sq === game.stone?.square;
    if (sq !== null && ok) submit({ type: "hop", square: sq, timing: needle(performance.now()) });
  }
});

function moveDrag(e) {
  const a = aimFrom(e.clientX, e.clientY);
  view.aim = a
    ? { origin: THROW_ORIGIN, fx: e.clientX, fy: e.clientY, land: resolveThrow(a), ...a }
    : null;
}

canvas.addEventListener("pointermove", (e) => {
  if (drag === e.pointerId) moveDrag(e);
});

function endDrag(e, cancel) {
  if (drag !== e.pointerId) return;
  drag = null;
  const a = aimFrom(e.clientX, e.clientY);
  view.aim = null;
  if (!cancel && a && a.power >= MIN_POWER) submit({ type: "throw", angle: a.angle, power: a.power });
}
canvas.addEventListener("pointerup", (e) => endDrag(e, false));
canvas.addEventListener("pointercancel", (e) => endDrag(e, true));

$("pickup").addEventListener("click", () => {
  if (!director.busy && game.phase === "pickup") {
    submit({ type: "pickup", timing: needle(performance.now()) });
  }
});

$("reset").addEventListener("click", () => {
  game = newGame();
  director.home();
  lastKey = "";
  startTurn("you");
});

// --- frame loop ---------------------------------------------------------------------
let wasBusy = false;
function frame(t) {
  director.update(t);
  const busy = director.busy;
  if (wasBusy && !busy) {
    $("meter").classList.remove("locked");
    refreshHud();
  }
  wasBusy = busy;
  if (!$("meter").hidden && !busy) {
    const n = needle(t);
    $("needle").style.left = `${50 + n * 50}%`;
  }
  scene.draw(view, t);
  requestAnimationFrame(frame);
}
startTurn("you");
requestAnimationFrame(frame);

// Debug hook for scripted runs: open with ?debug
if (new URLSearchParams(location.search).has("debug")) {
  window.__suwe = {
    get game() {
      return game;
    },
    submit,
    get busy() {
      return director.busy;
    },
    needle: () => needle(performance.now()),
    px: (x, y) => scene.project(x, y),
    zone: () => (game.phase === "throw" ? 1 : expectation(game).zone),
  };
}

// --- start.ng player card (the character rule) -----------------------------------
const card = {
  root: $("player-card"),
  face: $("player-face"),
  name: $("player-name"),
  account: $("player-account"),
  signIn: $("player-sign-in"),
};
card.signIn.href = signInUrl();

function showPlayer(p) {
  styles.you = p.style ?? DEFAULT_STYLE;
  applyLooks();
  card.name.textContent = p.name;
  card.account.textContent = p.account ? `@${p.account}` : "Not signed in";
  if (p.face) card.face.src = p.face;
  card.face.hidden = !p.face;
  card.signIn.hidden = p.signedIn || !onStartNg();
  card.root.hidden = false;
}

// Plays fine without start.ng: show a guest until (and unless) it answers.
showPlayer({ signedIn: false, name: "Guest", account: null, style: DEFAULT_STYLE, face: null });
watchPlayer(showPlayer);
