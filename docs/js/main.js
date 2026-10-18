import { createScene } from "./render/scene.js";
import { DEFAULT_STYLE } from "./render/character.js";
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

let game = createGame({ seed: Date.now() >>> 0, players: [{ id: "you", name: "You" }] });

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
});
const view = director.view;

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

const HINTS = {
  throw: "Drag the stone back, then let go to throw",
  hop: "Tap the glowing square when the needle is in the green",
  pickup: "Tap Pick up when the needle is in the green",
};

let meterStart = performance.now();
let lastKey = "";

function refreshHud() {
  const p = game.players[game.current];
  $("target").textContent = `Target ${p.target}`;
  $("turn").textContent = `Turn ${game.turnNo}${p.circuits ? ` · Round ${p.circuits + 1}` : ""}`;
  [...pips.children].forEach((d, i) => d.classList.toggle("done", i + 1 < p.target));
  [...pips.children].forEach((d, i) => d.classList.toggle("now", i + 1 === p.target));
  $("hint").textContent = HINTS[game.phase];
  $("pickup").hidden = game.phase !== "pickup";
  $("meter").hidden = game.phase === "throw";
  if (game.phase !== "throw") {
    const e = expectation(game);
    $("zone").style.width = `${e.zone * 100}%`;
  }
  const e = expectation(game);
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
  const period = 2300 - 80 * p.target;
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
    if (sq !== null) submit({ type: "hop", square: sq, timing: needle(performance.now()) });
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
  game = createGame({ seed: Date.now() >>> 0, players: [{ id: "you", name: "You" }] });
  director.home();
  lastKey = "";
  refreshHud();
  say("Oya, your turn");
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
  if (game.phase !== "throw" && !busy) {
    const n = needle(t);
    $("needle").style.left = `${50 + n * 50}%`;
  }
  scene.draw(view, t);
  requestAnimationFrame(frame);
}
refreshHud();
say("Oya, your turn");
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
  view.hero.style = p.style ?? DEFAULT_STYLE;
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
