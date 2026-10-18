import { createScene } from "./render/scene.js";
import { DEFAULT_STYLE, normalizeStyle } from "./render/character.js";
import { createDirector } from "./director.js";
import { createSetup } from "./setup.js";
import {
  createGame,
  applyMove,
  expectation,
  resolveThrow,
  accuracy,
  THROW_ORIGIN,
  MAX_ANGLE,
} from "./engine/game.js";
import { playAiMove } from "./engine/ai.js";
import {
  MAX_LIVES,
  freshLives,
  normalizeLives,
  tickLives,
  loseLife,
  canPlay,
  msToNextLife,
} from "./lives.js";
import { onStartNg, signInUrl, watchPlayer } from "./startng.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const canvas = $("stage");
const scene = createScene(canvas);

// --- tiny safe storage ---------------------------------------------------------
const store = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode or full: the game still plays, it just won't remember */
    }
  },
};

// --- who is playing on this phone (start.ng) --------------------------------------
let me = { signedIn: false, name: "Guest", account: null, style: DEFAULT_STYLE, face: null };

// --- lives -------------------------------------------------------------------------
let lives = tickLives(normalizeLives(store.get("suwe.lives")), Date.now());
function saveLives() {
  store.set("suwe.lives", lives);
}

// A life is lost when you lose a match, whoever you played. Called when a match
// ends (the win rules arrive with houses).
function spendLife() {
  lives = loseLife(lives, Date.now());
  saveLives();
  renderLives();
}

function fmt(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function heartsInto(el, big) {
  const now = Date.now();
  lives = tickLives(lives, now);
  const hearts = Array.from({ length: MAX_LIVES }, (_, i) => {
    const h = document.createElement("span");
    h.textContent = "♥";
    if (i >= lives.lives) h.className = "off";
    return h;
  });
  const next = msToNextLife(lives, now);
  const note = document.createElement("small");
  note.textContent = next ? `Next life in ${fmt(next)}` : "";
  if (big) {
    const row = document.createElement("div");
    row.className = "row";
    row.append(...hearts);
    el.replaceChildren(row, note);
  } else {
    note.textContent = next ? fmt(next) : "";
    el.replaceChildren(...hearts, note);
  }
}

let lastLifeKey = "";
function renderLives(force) {
  const now = Date.now();
  const t = tickLives(lives, now);
  const key = `${t.lives}:${Math.ceil(msToNextLife(t, now) / 1000)}`;
  if (!force && key === lastLifeKey) return;
  lastLifeKey = key;
  lives = t;
  heartsInto($("menu-lives"), true);
  heartsInto($("hud-lives"), false);
}
setInterval(() => renderLives(), 1000);

// --- toast (voice line bubble) --------------------------------------------------------
let toastTimer;
function say(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1600);
}

// --- match state -------------------------------------------------------------------------
let game = null;
let matchId = 0;
const players = () => game.players;
const current = () => game.players[game.current];
const solo = () => game.players.length === 1;

const director = createDirector({
  style: DEFAULT_STYLE,
  say,
  onFlash: (f) => (director.view.flash = { ...f, t0: performance.now(), dur: 700 }),
  onTurn: () => startTurn(),
  onOver: (result) => showResults(result),
  onHouse: (e) => celebrate(e),
});
const view = director.view;

function fit() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  scene.resize(window.innerWidth, window.innerHeight, dpr);
}
addEventListener("resize", fit);
fit();

// Whose turn it is: they take the court, the others wait beside the start.
function applyLooks() {
  const p = current();
  view.hero.style = normalizeStyle(p.look);
  view.hero.color = p.color;
  view.hero.sash = p.sash;
  view.waiting = game.players
    .filter((q) => q !== p)
    .map((q, i) => ({
      style: normalizeStyle(q.look),
      color: q.color,
      sash: q.sash,
      x: 1.7 + i * 0.5,
      y: -1.1,
    }));
}

let announced = false;
function startTurn() {
  applyLooks();
  const p = current();
  if (solo()) say(announced ? "Oya, throw again" : "Oya, throw!");
  else say(p.ai ? `${p.name} dey play...` : `Oya, ${p.name}, your turn`);
  announced = true;
  refreshHud();
}

// --- HUD ------------------------------------------------------------------------------------
const pips = $("pips");
for (let n = 1; n <= 12; n++) {
  const d = document.createElement("i");
  d.textContent = n;
  pips.append(d);
}

function hintText(e) {
  const p = current();
  if (p.ai) return `${p.name} is playing`;
  if (e.kind === "throw") return "Drag the stone back, then let go to throw";
  if (e.kind === "backthrow") return "Ra Ile! Drag back and throw over your shoulder to buy a house";
  if (e.kind === "tiebreak") return "Tie-break! Throw the stone closest to the red mark";
  if (e.kind === "pickup") return "Tap Pick up when the needle is in the green";
  if (e.needsTiming) return "Big jump! Tap the glowing square with the needle in the green";
  return e.to === "start" ? "Tap HOME to finish. Wrong tap = you miss!" : "Tap the glowing square. Wrong tap = you miss!";
}

function renderBoard() {
  const board = $("board");
  board.replaceChildren(
    ...players().map((p) => {
      const chip = document.createElement("div");
      chip.className = `chip-p${p === current() ? " now" : ""}${p.out ? " out" : ""}`;
      chip.style.setProperty("--c", p.color ?? "#999");
      const name = document.createElement("b");
      name.textContent = p.name;
      const line = document.createElement("span");
      line.textContent = p.out ? "OUT" : `♥${p.lives} ⌂${p.houses.length} Sq${p.target}`;
      if (p.ai) {
        const tag = document.createElement("em");
        tag.className = "ai";
        tag.textContent = p.ai;
        line.append(tag);
      }
      chip.append(name, line);
      return chip;
    }),
  );
}

let meterStart = performance.now();
let lastKey = "";

function refreshHud() {
  if (!game) return;
  const p = current();
  renderBoard();
  $("turn").textContent = `${solo() ? "Attempt" : "Turn"} ${game.turnNo}${p.circuits ? ` · Round ${p.circuits + 1}` : ""}`;
  [...pips.children].forEach((d, i) => {
    d.classList.toggle("done", i + 1 < p.target);
    d.classList.toggle("now", i + 1 === p.target);
  });
  const e = expectation(game);
  $("hint").textContent = hintText(e);
  const mine = !p.ai;
  $("pickup").hidden = !(mine && game.phase === "pickup");
  $("meter").hidden = !(mine && e.needsTiming);
  if (e.needsTiming) $("zone").style.width = `${e.zone * 100}%`;
  view.hint = e.kind === "throw" ? e.target : e.kind === "hop" ? e.to : null;
  view.mark = game.phase === "tiebreak" ? { x: e.mark.x, y: e.mark.y } : null;
  const key = `${game.turnNo}:${game.phase}:${game.turn?.i ?? ""}`;
  if (key !== lastKey) {
    lastKey = key;
    meterStart = performance.now();
  }
}

function needle(now) {
  const period = 2800 - 60 * current().target;
  return Math.sin(((now - meterStart) / period) * Math.PI * 2);
}

// --- playing a move ---------------------------------------------------------------------------
// Player 1 is the person holding the phone: their hearts are the saved ones.
function syncHearts() {
  const now = Date.now();
  let t = tickLives(lives, now);
  while (t.lives > game.players[0].lives) t = loseLife(t, now);
  if (t.lives !== lives.lives) {
    lives = t;
    saveLives();
    renderLives(true);
  }
}

function commit(r) {
  if (r.rejected) return;
  game = r.state;
  syncHearts();
  view.aim = null;
  view.hint = null;
  $("meter").classList.add("locked");
  director.play(r.events);
}
const submit = (move) => commit(applyMove(game, move));

// The computer takes its turn a moment after the picture has settled.
let aiTimer = null;
function scheduleAi() {
  if (aiTimer || !game || game.over || director.busy || !current().ai) return;
  const id = matchId;
  const delay = ["throw", "ra_ile", "tiebreak"].includes(game.phase) ? 900 : 450;
  aiTimer = setTimeout(() => {
    aiTimer = null;
    if (id !== matchId || !game || game.over || director.busy || !current().ai) return;
    commit(playAiMove(game, current().ai));
  }, delay);
}

// --- input --------------------------------------------------------------------------------------
const MIN_POWER = 0.12;
let drag = null;
const humanTurn = () => game && !game.over && !director.busy && !current().ai;

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

// Each throwing phase uses the same drag; only the kind of move differs.
const THROW_MOVE = { throw: "throw", ra_ile: "backthrow", tiebreak: "tiebreak" };

canvas.addEventListener("pointerdown", (e) => {
  if (!humanTurn()) return;
  if (THROW_MOVE[game.phase]) {
    const s = stonePx();
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 64) return;
    drag = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    moveDrag(e);
  } else if (game.phase === "hop") {
    // Any tap is a hop. The wrong square, the stone's square, someone's house or
    // somewhere off the court all count as a miss, whether meant or not.
    const sq = scene.hitSquare(e.clientX, e.clientY) ?? "out";
    submit({ type: "hop", square: sq, timing: needle(performance.now()) });
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
  if (!cancel && a && a.power >= MIN_POWER) {
    submit({ type: THROW_MOVE[game.phase], angle: a.angle, power: a.power });
  }
}
canvas.addEventListener("pointerup", (e) => endDrag(e, false));
canvas.addEventListener("pointercancel", (e) => endDrag(e, true));

$("pickup").addEventListener("click", () => {
  if (humanTurn() && game.phase === "pickup") submit({ type: "pickup", timing: needle(performance.now()) });
});

// --- screens ---------------------------------------------------------------------------------------
function mode(m) {
  document.body.dataset.mode = m;
  $("menu").hidden = m !== "menu";
  $("setup").hidden = m !== "setup";
  $("gate").hidden = m !== "gate";
  $("results").hidden = m !== "results";
  renderLives(true);
}

const GUEST_MATCH_LIMIT = 1;
// Enforced on start.ng, or locally with ?guestlimit, so local testing never locks you out.
const guestLimitOn = () => onStartNg() || params.has("guestlimit");
const guestMatchesUsed = () => store.get("suwe.guestMatches") ?? 0;

// "You Don Buy House": a short celebration over the court.
let celebrateTimer;
function celebrate(e) {
  const box = $("celebrate");
  box.style.setProperty("--c", e.color ?? "#e03131");
  $("celebrate-sub").textContent = `${e.name}: Na your house be this! Square ${e.square}`;
  const confetti = $("confetti");
  if (!confetti.children.length) {
    const colors = ["#f03e3e", "#fcc419", "#40c057", "#339af0", "#be4bdb", "#ff922b"];
    for (let i = 0; i < 28; i++) {
      const c = document.createElement("i");
      c.style.left = `${(i * 37) % 100}%`;
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = `${(i % 7) * 0.12}s`;
      c.style.animationDuration = `${1.4 + (i % 5) * 0.2}s`;
      confetti.append(c);
    }
  }
  box.hidden = false;
  clearTimeout(celebrateTimer);
  celebrateTimer = setTimeout(() => (box.hidden = true), 2300);
}

let matchStart = 0;
function endMatchState() {
  matchId++;
  clearTimeout(aiTimer);
  aiTimer = null;
}

function showResults(result) {
  const g = game;
  const names = result.winners.map((id) => g.players.find((p) => p.id === id).name);
  $("results-title").textContent = result.tie ? "It's a draw" : "Winner!";
  $("results-winner").textContent = names.join(" & ");
  $("results-why").textContent =
    result.reason === "tiebreak"
      ? "Won the tie-break throw"
      : result.reason === "all_claimed"
        ? "Every square has been claimed"
        : "Everybody ran out of hearts";
  const rows = g.players.map((p) => {
    const tr = document.createElement("tr");
    if (result.winners.includes(p.id)) tr.className = "win";
    const nameCell = document.createElement("td");
    const dot = document.createElement("i");
    dot.style.background = p.color ?? "#999";
    nameCell.append(dot, p.name);
    tr.append(nameCell);
    for (const v of [p.houses.length, `${accuracy(p)}%`, p.stats.mistakes]) {
      const td = document.createElement("td");
      td.textContent = v;
      tr.append(td);
    }
    return tr;
  });
  $("results-rows").replaceChildren(...rows);
  $("results-time").textContent = `Match time ${fmt(Date.now() - matchStart)}`;
  $("results-hearts").textContent = lives.lives
    ? ""
    : `You have no hearts left. Next one in ${fmt(msToNextLife(lives, Date.now()))}.`;
  game = null;
  endMatchState();
  director.reset();
  view.hint = null;
  mode("results");
}

function showGate(title, text, signIn) {
  $("gate-back").textContent = "Back";
  $("gate-title").textContent = title;
  $("gate-text").textContent = text;
  $("gate-signin").hidden = !signIn;
  mode("gate");
}

$("gate-back").addEventListener("click", () => mode("menu"));
$("results-again").addEventListener("click", () => $("play").click());
$("results-menu").addEventListener("click", () => mode("menu"));
$("gate-signin").href = signInUrl();

$("play").addEventListener("click", () => {
  lives = tickLives(lives, Date.now());
  if (!canPlay(lives, Date.now())) {
    showGate(
      "No lives left",
      `You need a life to play. Your next life comes in ${fmt(msToNextLife(lives, Date.now()))}.`,
      false,
    );
    return;
  }
  if (!me.signedIn && guestLimitOn() && guestMatchesUsed() >= GUEST_MATCH_LIMIT) {
    showGate(
      "You don play your free match",
      "Guests get one match. Sign in with start.ng to keep playing and get on the leaderboard.",
      onStartNg(),
    );
    return;
  }
  setup.show();
  mode("setup");
});

const setup = createSetup($("setup"), {
  getMe: () => ({ name: me.name, style: me.style, signedIn: me.signedIn }),
  onBack: () => mode("menu"),
  onStart: (cfg) => startMatch(cfg),
  say,
});

function startMatch(cfg) {
  if (!me.signedIn) store.set("suwe.guestMatches", guestMatchesUsed() + 1);
  matchId++;
  clearTimeout(aiTimer);
  aiTimer = null;
  const players = cfg.players.map((p, i) => (i === 0 ? { ...p, lives: tickLives(lives, Date.now()).lives } : p));
  game = createGame({ seed: Date.now() >>> 0, players });
  announced = false;
  lastKey = "";
  matchStart = Date.now();
  director.reset();
  mode("play");
  startTurn();
}

$("menu-btn").addEventListener("click", () => {
  if (!confirm("Leave this match?")) return;
  endMatchState();
  game = null;
  director.reset();
  view.hint = null;
  mode("menu");
});

// --- frame loop ---------------------------------------------------------------------------------------
let wasBusy = false;
function frame(t) {
  director.update(t);
  const busy = director.busy;
  if (game) {
    if (wasBusy && !busy) {
      $("meter").classList.remove("locked");
      refreshHud();
    }
    if (!busy) scheduleAi();
    if (!$("meter").hidden && !busy) $("needle").style.left = `${50 + needle(t) * 50}%`;
  }
  wasBusy = busy;
  scene.draw(view, t);
  requestAnimationFrame(frame);
}
mode("menu");
view.hint = null;
requestAnimationFrame(frame);

// Debug hook for scripted runs: open with ?debug
if (params.has("debug")) {
  window.__suwe = {
    get game() {
      return game;
    },
    get lives() {
      return lives;
    },
    submit,
    get busy() {
      return director.busy;
    },
    needle: () => needle(performance.now()),
    px: (x, y) => scene.project(x, y),
    zone: () => (game.phase === "throw" ? 1 : expectation(game).zone),
    spendLife,
    // Drop in a crafted match state (for tests).
    load(state) {
      game = state;
      matchStart = Date.now();
      director.reset();
      mode("play");
      for (const h of state.owners.map((o, i) => [o, i + 1]).filter(([o]) => o)) {
        const p = state.players.find((q) => q.id === h[0]);
        director.view.houses.push({ square: h[1], color: p.color, name: p.name });
      }
      startTurn();
    },
  };
}

// --- start.ng player card (the character rule) ---------------------------------------------------------
const card = {
  root: $("player-card"),
  face: $("player-face"),
  name: $("player-name"),
  account: $("player-account"),
  signIn: $("player-sign-in"),
};
card.signIn.href = signInUrl();

function showPlayer(p) {
  me = { ...p, style: p.style ?? DEFAULT_STYLE };
  card.name.textContent = p.name;
  card.account.textContent = p.account ? `@${p.account}` : "Not signed in";
  if (p.face) card.face.src = p.face;
  card.face.hidden = !p.face;
  card.signIn.hidden = p.signedIn || !onStartNg();
  card.root.hidden = false;
}

// Plays fine without start.ng: show a guest until (and unless) it answers.
showPlayer(me);
watchPlayer(showPlayer);
