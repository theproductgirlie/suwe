import { DEFAULT_STYLE, normalizeStyle, drawCharacter } from "./render/character.js";
import { icon, paintIcons, hearts, el } from "./ui.js";
import { COLS, ROWS, squareCenter, cellToSquare } from "./engine/court.js";
import { createDirector } from "./director.js";
import { createSetup, levelStars } from "./setup.js";
import { createAudio } from "./audio.js";
import { createTutorial } from "./tutorial.js";
import {
  createGame,
  applyMove,
  expectation,
  accuracy,
  THROW_ORIGIN,
} from "./engine/game.js";
import { playAiMove } from "./engine/ai.js";
import { ringPosition, spread, throwToward } from "./ring.js";
import {
  MAX_LIVES,
  freshLives,
  normalizeLives,
  tickLives,
  loseLife,
  canPlay,
  msToNextLife,
} from "./lives.js";
import { onStartNg, signInUrl, watchPlayer, saveScore, loadLeaderboard, setTransport } from "./startng.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const canvas = $("stage");
// Three.js renders the scene. `?renderer=2d` (or a device without WebGL) uses the original Canvas 2D one.
const scene = await (async () => {
  if (new URLSearchParams(location.search).get("renderer") !== "2d") {
    try {
      const { createScene } = await import("./render/scene.js");
      return createScene(canvas);
    } catch (err) {
      console.warn("WebGL scene unavailable, using Canvas 2D:", err);
    }
  }
  const { createScene } = await import("./render/scene-2d.js");
  return createScene(canvas);
})();

// --- tiny safe storage ---------------------------------------------------------
const store = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
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

// --- sound --------------------------------------------------------------------------------
const audio = createAudio(store.get("suwe.audio"), (v) => store.set("suwe.audio", v));
// Browsers only allow sound after a tap, and count the moment the finger lifts or
// the click lands (not a drag, and not the touch-down). Try on all of them.
for (const type of ["pointerdown", "pointerup", "touchstart", "touchend", "click", "keydown"]) {
  addEventListener(type, () => audio.unlock(), { capture: true });
}
document.addEventListener(
  "click",
  (e) => {
    if (e.target.closest?.("button, a.big")) audio.sfx("ui");
  },
  true,
);

// A row in the pause menu / settings: icon, label, and a switch.
const TOGGLES = {
  music: { label: "Music" },
  sfx: { label: "Sound effects" },
  voice: { label: "Voice", note: "Reads key moments out loud" },
};
function paintToggle(btn, key, on) {
  const t = TOGGLES[key];
  const text = el("span");
  text.append(el("b", "", t.label));
  if (t.note) text.append(el("small", "", t.note));
  btn.replaceChildren(text, el("span", "switch"));
  btn.setAttribute("aria-checked", String(on));
}

function renderAudioButtons() {
  const p = audio.prefs;
  for (const [key, on] of [["music", p.music], ["sfx", p.sfx], ["voice", p.voice]]) {
    paintToggle($(`opt-${key}`), key, on);
    paintToggle($(`pause-${key}`), key, on);
  }
  const quiet = !p.music && !p.sfx;
  const sb = $("sound-btn");
  sb.replaceChildren(icon(quiet ? "mute" : "volume", 24));
  sb.setAttribute("aria-label", quiet ? "Turn sound on" : "Turn sound off");
}
$("opt-music").addEventListener("click", () => {
  audio.setMusic(!audio.prefs.music);
  renderAudioButtons();
});
$("opt-sfx").addEventListener("click", () => {
  audio.setSfx(!audio.prefs.sfx);
  renderAudioButtons();
});
$("opt-voice").addEventListener("click", () => {
  audio.setVoice(!audio.prefs.voice);
  renderAudioButtons();
});
// In a match, one button (or the M key) turns everything on or off.
function toggleMute() {
  const on = !audio.prefs.music && !audio.prefs.sfx;
  audio.setMusic(on);
  audio.setSfx(on);
  renderAudioButtons();
}
$("sound-btn").addEventListener("click", toggleMute);
paintIcons();
renderAudioButtons();

// --- who is playing on this phone (start.ng) --------------------------------------
// Everyone plays as their start.ng character, so signing in is required on start.ng.
// Anywhere else (local testing) a test player stands in; ?signedin pretends to be a
// signed-in start.ng player, to try the character-keeps-its-outfit path.
const localPlayer = () =>
  params.has("signedin")
    ? {
        signedIn: true,
        id: 42,
        name: "Abimbola",
        account: "abimbola",
        style: {
          body: "female",
          primaryColor: "#7048e8",
          secondaryColor: "#0c6e5a",
          skinColor: "#8d5524",
          hairColor: "#17120f",
          hair: "braids",
          hat: "crown",
          accessory: "earrings",
        },
        face: null,
      }
    : { signedIn: false, name: "Test Player", account: null, style: DEFAULT_STYLE, face: null };
let me = onStartNg()
  ? { signedIn: false, name: "Player", account: null, style: DEFAULT_STYLE, face: null }
  : localPlayer();
let meReady = !onStartNg(); // on start.ng we wait to hear who is playing
const needsSignIn = () => onStartNg() && !me.signedIn;

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

let lastLifeKey = "";
function renderLives(force) {
  const now = Date.now();
  const t = tickLives(lives, now);
  const key = `${t.lives}:${Math.ceil(msToNextLife(t, now) / 1000)}`;
  if (!force && key === lastLifeKey) return;
  lastLifeKey = key;
  lives = t;
  const next = msToNextLife(lives, now);
  const line = $("profile-lives");
  line.replaceChildren(icon("heart", 15), document.createTextNode(`${lives.lives} ${lives.lives === 1 ? "life" : "lives"}${next ? ` · +1 in ${fmt(next)}` : ""}`));
}
setInterval(() => {
  renderLives();
  if (document.body.dataset.mode === "play" && matchHeartsFollowSaved()) {
    saveMatch();
    renderBoard();
  }
}, 1000);

// --- toast (voice line bubble) --------------------------------------------------------
let toastTimer;
// tone: "good" | "bad" tints the bubble. speech: the short phrase to read aloud when
// Voice lines are on (only key lines are spoken, not every message).
function say(text, { tone = "", speech = "" } = {}) {
  const el = $("toast");
  el.textContent = text;
  el.className = `${tone} show`.trim();
  if (speech) audio.speak(speech);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1600);
}

// --- match state -------------------------------------------------------------------------
let game = null;
let matchId = 0;
const players = () => game.players;
const current = () => game.players[game.current];
const solo = () => game.players.length === 1;

// While the computer's turn is skipped, nothing is announced or played.
let skipping = false;
let fast = false; // "2x speed" while the computer plays
const speed = () => (fast && game && !game.over && current().ai ? 2 : 1);

const director = createDirector({
  style: DEFAULT_STYLE,
  say: (text, opts) => {
    if (skipping || !game) return;
    if (text === "Now hop!" && current().ai) return; // that prompt is for a person
    say(text, opts);
  },
  onFlash: (f) => (director.view.flash = { ...f, t0: performance.now(), dur: 700 }),
  onTurn: () => startTurn(),
  onOver: (result) => showResults(result),
  onHouse: (e) => celebrate(e),
  onFail: (e) => showMiss(e),
  sfx: (name) => {
    if (!skipping) audio.sfx(name);
  },
});
const view = director.view;

const desktopQuery = matchMedia("(min-width: 1024px)");
const isDesktop = () => desktopQuery.matches;

// Tell the 3D scene where on the screen the court should sit (it depends on the screen and the window).
function layoutScene() {
  if (!scene.setLayout) return; // the Canvas 2D fallback has a fixed layout
  const W = window.innerWidth;
  const H = window.innerHeight;
  const m = document.body.dataset.mode;
  const cap = Math.min(W * 0.5, H * 0.3);
  if (m === "play") {
    const hudBottom = $("hud").getBoundingClientRect().bottom;
    if (isDesktop()) {
      scene.setLayout({ nearY: H * 0.7, farY: hudBottom + 30, cx: W / 2, maxCell: Math.min(W * 0.2, H * 0.31), pitch: 24 }, { ground: true });
    } else {
      // Fixed by the screen height, so the court never moves while you play.
      const farY = hudBottom + 22;
      scene.setLayout({ nearY: Math.max(H * 0.62, farY + 240), farY, cx: W / 2, maxCell: cap, pitch: 24 }, { ground: true });
    }
  } else if (m === "menu") {
    if (isDesktop()) scene.setLayout({ nearY: H * 1.0, farY: H * 0.5, cx: W * 0.745, maxCell: Math.min(W * 0.17, H * 0.22), pitch: 30 }, { ground: false });
    else scene.setLayout({ nearY: H * 0.62, farY: H * 0.37, cx: W * 0.45, maxCell: Math.min(W * 0.3, H * 0.2), pitch: 30 }, { ground: false });
  }
}

function fit() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  scene.resize(window.innerWidth, window.innerHeight, dpr);
  layoutScene();
}
addEventListener("resize", fit);
fit();
// The court's numbers use the bundled font: redraw once it has loaded.
document.fonts?.load('800 40px "Baloo 2"').then(fit, () => {});

// The home screen: the stone sits on square 1 and the child stands beside the court.
function menuStage() {
  director.reset();
  view.hero.style = normalizeStyle(me.style);
  view.hero.color = null;
  view.hero.sash = false;
  view.hero.x = COLS + 0.95;
  view.hero.y = 1.5;
  Object.assign(view.hero.pose, { back: true, oneLeg: true, lift: 0, bend: 0, tilt: 0, hold: false, facing: 1 });
  view.stone = { x: 0.72, y: 0.4, h: 0 };
  view.waiting = [];
  view.houses = [];
  view.hint = null;
  view.mark = null;
  view.flash = null;
  view.cleared = null;
  view.hold = null;
}

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
      x: 1.8 - i * 0.45,
      y: -1.0,
    }));
}

let announced = false;
function startTurn() {
  if (!game) return;
  hidePill();
  applyLooks();
  const p = current();
  if (!skipping) {
    if (solo()) say(announced ? "Throw again!" : "Oya, throw!", { speech: announced ? "" : "Oya, throw" });
    else if (!p.ai) say(`${p.name}, your turn!`, { speech: "Oya, your turn" });
  }
  announced = true;
  refreshHud();
  showTurnCard();
}

// --- HUD ------------------------------------------------------------------------------------
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const LEVEL_NAME = { easy: "Easy", medium: "Medium", hard: "Hard" };

// The dark pill at the bottom: what to do now.
function setBar(ico, title, sub, withSpace) {
  $("bar-ico").replaceChildren(icon(ico, 28));
  $("bar-title").textContent = title;
  const small = $("bar-sub");
  small.replaceChildren(document.createTextNode(sub));
  if (withSpace && isDesktop()) {
    small.replaceChildren(document.createTextNode("Hold the stone or "), el("kbd", "", "Space"), document.createTextNode(". The red mark spins."));
  }
}

function barInfo(e) {
  const p = current();
  const tap = isDesktop() ? "Click" : "Tap";
  if (e.kind === "throw") return { ico: "target", title: `Throw at square ${e.target}`, sub: isDesktop() ? "Hold the stone or Space, then let go" : "Hold the stone, then let go" };
  if (e.kind === "backthrow") return { ico: "target", title: "Throw over your shoulder", sub: "Hold the stone, let go on an empty square" };
  if (e.kind === "tiebreak") return { ico: "target", title: "Closest to the red mark", sub: "Hold the stone, let go near the mark" };
  if (e.kind === "pickup") return { ico: "hand", title: "Pick up the stone", sub: "Press Pick up with the needle in the green" };
  if (e.to === "start") return { ico: "up", title: `${tap} HOME`, sub: "Hop home to finish the course" };
  return {
    ico: "up",
    title: `${tap} square ${e.to}`,
    sub: e.needsTiming ? `Hop over ${p.target}, your stone is there` : "Hop to the glowing square",
  };
}

// Show the right bottom bar: the dark pill for a person, the computer's controls, or nothing while a miss shows.
function updateBar() {
  if (!game) return;
  const p = current();
  const mine = !p.ai;
  $("bar").hidden = !mine || pillShown;
  $("watchbar").hidden = mine || pillShown;
  if (!mine) {
    const verb = game.phase === "hop" ? "hopping" : game.phase === "pickup" ? "picking up the stone" : "throwing";
    $("watch-title").textContent = `${p.name} is ${verb}…`;
    return;
  }
  const e = expectation(game);
  const info = barInfo(e);
  setBar(info.ico, info.title, info.sub);
}

function renderBoard() {
  const cur = current();
  const board = $("board");
  const many = players().length > 2;
  board.replaceChildren(
    ...players().map((p) => {
      const card = el("div", `pcard${p === cur ? " now" : ""}${p.out ? " out" : ""}${many ? " many" : ""}`);
      card.style.setProperty("--c", p.color ?? "#999");
      const face = el("span", "face");
      const cv = el("canvas");
      cv.width = cv.height = 72;
      drawCharacter(cv.getContext("2d"), normalizeStyle(p.look), 36, 96, 1.0, { back: false, shadow: false });
      face.append(cv);
      const info = el("div", "pinfo");
      info.append(el("div", "pname", i0(p) === 0 && !p.ai && !solo() ? "You" : p.name));
      const stats = el("div", "pstats");
      const done = Math.max(0, Math.min(12, p.target - 1));
      stats.append(icon("heart", 15), document.createTextNode(many ? `${p.lives} · ${done}/12` : `${p.lives} · ${done} of 12`));
      info.append(stats);
      card.append(face, info);
      return card;
    }),
  );
}
const i0 = (p) => players().findIndex((q) => q.id === p.id);

let meterStart = performance.now();
let lastKey = "";

function refreshHud() {
  if (!game) return;
  const p = current();
  renderBoard();
  const mine = !p.ai;
  const who = mine && (solo() || p.id === players()[0].id) ? "Your" : `${p.name}'s`;
  const banner = $("banner");
  banner.replaceChildren(el("i"), document.createTextNode(`${who} turn`));
  banner.firstChild.style.setProperty("--c", p.color ?? "#999");
  const e = expectation(game);
  updateBar();
  $("pickup").hidden = !(mine && game.phase === "pickup");
  $("meter").hidden = !(mine && e.needsTiming);
  if (e.needsTiming) $("zone").style.width = `${e.zone * 100}%`;
  view.hint = e.kind === "throw" ? e.target : e.kind === "hop" ? e.to : null;
  view.mark = game.phase === "tiebreak" ? { x: e.mark.x, y: e.mark.y } : null;
  // The squares this player has cleared, tinted in their colour.
  const done = Math.max(0, Math.min(12, p.target - 1));
  view.cleared = { color: p.color ?? "#999", squares: Array.from({ length: done }, (_, i) => i + 1) };
  const key = `${game.turnNo}:${game.phase}:${game.turn?.i ?? ""}`;
  if (key !== lastKey) {
    lastKey = key;
    meterStart = performance.now();
  }
  requestAnimationFrame(layoutScene);
}

// --- the card that opens a turn (2 seconds) -------------------------------------------------
let turnCardTimer = null;
let turnCardStart = 0;
function showTurnCard() {
  hideTurnCard();
  if (!game || game.over || current().ai) return;
  const e = expectation(game);
  if (!["throw", "backthrow", "tiebreak"].includes(e.kind)) return;
  const p = current();
  const mine = solo() || p.id === players()[0].id;
  $("turncard-kicker").textContent = mine ? "Your turn" : `${p.name}'s turn`;
  const info = barInfo(e);
  $("turncard-title").textContent = info.title;
  $("turncard-sub").textContent = e.kind === "throw" ? (isDesktop() ? "Hold the stone or Space, then let go." : "Hold the stone, then let go.") : info.sub;
  $("turncard").hidden = false;
  turnCardStart = performance.now();
  turnCardTimer = setTimeout(hideTurnCard, 2000);
}
function hideTurnCard() {
  clearTimeout(turnCardTimer);
  turnCardTimer = null;
  $("turncard").hidden = true;
}

function needle(now) {
  const period = 2800 - 60 * current().target;
  return Math.sin(((now - meterStart) / period) * Math.PI * 2);
}

// --- playing a move ---------------------------------------------------------------------------
// Player 1 is the person holding the phone: their hearts are the saved lives. A heart lost in the
// match starts (or keeps running) the 30-minute refill, and a heart that refills while you play
// comes back in the match too.
function syncHearts(before) {
  const now = Date.now();
  let t = tickLives(lives, now);
  const lost = Math.max(0, before.players[0].lives - game.players[0].lives);
  for (let i = 0; i < lost; i++) t = loseLife(t, now);
  if (t.lives !== lives.lives || t.since !== lives.since) {
    lives = t;
    saveLives();
    renderLives(true);
  }
  matchHeartsFollowSaved();
}

// The hearts shown in the match follow the saved lives (a player who is out stays out).
function matchHeartsFollowSaved() {
  if (!game || game.over) return false;
  const p0 = game.players[0];
  if (p0.out || p0.lives === lives.lives) return false;
  p0.lives = lives.lives;
  return true;
}

let actor = null; // whoever made the move being shown (the state has already moved on to the next player)
function commit(r) {
  if (r.rejected) return;
  actor = game ? players()[game.current] : null;
  const before = game;
  game = r.state;
  syncHearts(before);
  saveMatch();
  holdState = null;
  view.hold = null;
  view.hint = null;
  $("meter").classList.add("locked");
  director.play(r.events);
}
const submit = (move) => commit(applyMove(game, move));

// The computer takes its turn a moment after the picture has settled.
let aiTimer = null;
function scheduleAi() {
  if (aiTimer || paused || !game || game.over || director.busy || !current().ai) return;
  const id = matchId;
  const delay = (["throw", "ra_ile", "tiebreak"].includes(game.phase) ? 900 : 450) / speed();
  aiTimer = setTimeout(() => {
    aiTimer = null;
    if (id !== matchId || paused || !game || game.over || director.busy || !current().ai) return;
    commit(playAiMove(game, current().ai));
  }, delay);
}

// --- the "missed" pill -------------------------------------------------------------------
const MISS_TITLE = {
  line: (who) => `${who} stepped on a line`,
  line_stone: (who) => `${who === "You" ? "Your" : `${who}'s`} stone touched a line`,
  miss: (who) => `${who} missed the square`,
  stone_square: (who) => `${who} hopped on the stone's square`,
  sequence: (who) => `${who} hopped to the wrong square`,
  balance: (who) => `${who} lost ${who === "You" ? "your" : "their"} balance`,
  opponent_house: (who) => `${who} stepped in someone's house`,
  outside: (who) => `${who} went off the court`,
};
let pillShown = false;
// Called when someone misses. Returns how long (ms) to show the pill, long enough to read.
function showMiss(e) {
  if (skipping || !game) return 0;
  const failed = actor ?? current();
  const failer = players().find((q) => q.id === failed.id) ?? failed;
  const human = !failer.ai && (solo() || failer.id === players()[0].id);
  const who = human ? "You" : failer.name;
  $("pill-title").textContent = (MISS_TITLE[e.reason] ?? ((w) => `${w} missed`))(who);
  const left = Math.max(0, e.lives);
  const next = game.over ? null : current();
  let tail;
  if (left === 0) tail = `${human ? "You have" : `${failer.name} has`} no hearts left.`;
  else if (solo() || !next || next.id === failer.id) tail = "Throw again.";
  else tail = `${next.id === players()[0].id && !next.ai ? "You play" : `${next.name} plays`} next.`;
  $("pill-sub").textContent = `−1 heart. ${tail}`;
  pillShown = true;
  document.body.classList.add("pill");
  $("pill").hidden = false;
  updateBar();
  return human ? 3300 : 2800;
}
function hidePill() {
  if (!pillShown) return;
  pillShown = false;
  document.body.classList.remove("pill");
  $("pill").hidden = true;
  updateBar();
}
// Tapping the pill carries on straight away.
$("pill").addEventListener("click", () => {
  if (pillShown) director.release();
});

// --- skipping the computer's turn ------------------------------------------------------------
function skipComputer() {
  if (!game || game.over || !current().ai || skipping) return;
  const id = matchId;
  skipping = true;
  clearTimeout(aiTimer);
  aiTimer = null;
  hidePill();
  try {
    director.finish();
    for (let i = 0; i < 600 && game && !game.over && id === matchId && current().ai; i++) {
      commit(playAiMove(game, current().ai));
      director.finish();
    }
  } finally {
    skipping = false;
  }
  if (game && id === matchId) {
    refreshHud();
    say(`${current().name}, your turn!`, { speech: "Oya, your turn" });
  }
}
$("skip-btn").addEventListener("click", skipComputer);
$("speed-btn").addEventListener("click", () => {
  fast = !fast;
  $("speed-btn").classList.toggle("on", fast);
  $("speed-text").textContent = fast ? "2× faster · on" : "2× faster";
  $("speed-btn").classList.toggle("on", fast);
});

// --- input: press and hold the stone; a ring moves along the squares; let go to throw ----------
const humanTurn = () => game && !paused && !game.over && !director.busy && !current().ai && !pillShown;

function stonePx() {
  return scene.project(THROW_ORIGIN.x, THROW_ORIGIN.y);
}

// Each throwing phase works the same way; only the kind of move differs.
const THROW_MOVE = { throw: "throw", ra_ile: "backthrow", tiebreak: "tiebreak" };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// The ring and the small random miss (see ring.js). `level` is the computer's level in this match.
const matchLevel = () => game?.players.find((q) => q.ai)?.ai ?? null;
const ringOpts = () => ({ phase: game.phase === "ra_ile" ? "ra_ile" : game.phase, target: current().target, level: matchLevel() });
const ringAt = (sec) => ringPosition(sec, ringOpts());

let holdState = null; // { t0, id } while the stone is held (id: a pointer id, or "key")
let ringOverride = null; // tests can pin the ring to a place (no random miss then)

function startHold(id) {
  if (holdState || !humanTurn() || !THROW_MOVE[game.phase]) return false;
  hideTurnCard();
  holdState = { t0: performance.now(), id };
  return true;
}
function currentRing() {
  return ringOverride ?? ringAt((performance.now() - holdState.t0) / 1000);
}
function endHold(cancel) {
  if (!holdState) return;
  const pos = currentRing();
  holdState = null;
  view.hold = null;
  updateBar();
  if (cancel || !humanTurn()) return;
  let land = pos;
  if (!ringOverride) {
    const a = Math.random() * Math.PI * 2;
    const r = spread(ringOpts()) * Math.sqrt(Math.random());
    land = { x: pos.x + Math.cos(a) * r, y: pos.y + Math.sin(a) * r };
  }
  submit({ type: THROW_MOVE[game.phase], ...throwToward(land.x, land.y) });
}

canvas.addEventListener("pointerdown", (e) => {
  if (!humanTurn()) return;
  if (THROW_MOVE[game.phase]) {
    const s = stonePx();
    // The stone's touch area is at least 64 x 64 px (here a 60 px radius), clear of every other control.
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 60) return;
    if (startHold(e.pointerId)) canvas.setPointerCapture(e.pointerId);
  } else if (game.phase === "hop") {
    // Any tap is a hop. The wrong square, the stone's square, someone's house or
    // somewhere off the court all count as a miss, whether meant or not.
    const sq = scene.hitSquare(e.clientX, e.clientY) ?? "out";
    submit({ type: "hop", square: sq, timing: needle(performance.now()) });
  }
});
canvas.addEventListener("pointerup", (e) => {
  if (holdState?.id === e.pointerId) endHold(false);
});
canvas.addEventListener("pointercancel", (e) => {
  if (holdState?.id === e.pointerId) endHold(true);
});

$("pickup").addEventListener("click", () => {
  if (humanTurn() && game.phase === "pickup") submit({ type: "pickup", timing: needle(performance.now()) });
});

// --- saved matches ---------------------------------------------------------------------------
// The whole match is plain JSON, so it is saved after every move and can be resumed
// exactly where it was (even in the middle of a hop).
const SAVE_KEY = "suwe.match";
let elapsedBase = 0; // time spent on this match in earlier visits
const matchElapsed = () => elapsedBase + (matchStart ? Date.now() - matchStart : 0);
const owner = () => me.id ?? "local";

function saveMatch() {
  if (!game || game.over) return;
  store.set(SAVE_KEY, { v: 1, owner: owner(), game, elapsed: matchElapsed(), savedAt: Date.now() });
}
const clearSave = () => store.remove(SAVE_KEY);

// A saved match only counts if it is whole and belongs to whoever is playing now.
function loadSave() {
  const d = store.get(SAVE_KEY);
  let stored = false;
  try {
    stored = localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    /* ignore */
  }
  const g = d?.game;
  const ok =
    d?.v === 1 &&
    String(d.owner) === String(owner()) &&
    Number.isFinite(d.elapsed) &&
    g &&
    !g.over &&
    Array.isArray(g.players) &&
    g.players.length >= 1 &&
    g.players.length <= 4 &&
    g.players.every(
      (p) => p && typeof p.id === "string" && Number.isFinite(p.lives) && Number.isFinite(p.target) && Array.isArray(p.houses) && p.stats,
    ) &&
    Array.isArray(g.owners) &&
    g.owners.length === 12 &&
    ["throw", "hop", "pickup", "ra_ile", "tiebreak"].includes(g.phase) &&
    Number.isInteger(g.current) &&
    g.current >= 0 &&
    g.current < g.players.length &&
    (g.phase !== "hop" && g.phase !== "pickup" ? true : Array.isArray(g.turn?.steps));
  if (!ok) {
    if (stored) clearSave(); // unreadable or incomplete: remove it so it can't come back
    return null;
  }
  return d;
}

function resumeMatch() {
  const d = loadSave();
  if (!d) return;
  game = d.game;
  matchId++;
  clearTimeout(aiTimer);
  aiTimer = null;
  announced = true;
  lastKey = "";
  elapsedBase = d.elapsed;
  matchStart = Date.now();
  setPaused(false);
  director.reset();
  director.sync(game);
  matchHeartsFollowSaved(); // lives that came back while you were away
  mode("play");
  startTurn();
  refreshHud();
}

// Keep the clock right if the tab is closed mid-match.
addEventListener("pagehide", saveMatch);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) saveMatch();
});

// --- leaderboard ---------------------------------------------------------------------------------
// Only finished matches against the computer on Medium or Hard count: Easy would flood the board.
const BOARD_COUNTS = (cpu) => cpu && cpu.ai && cpu.ai !== "easy";
const whole = (v) => Math.max(0, Math.min(1_000_000_000, Math.round(v)));

async function submitScore(g, result, elapsedMs) {
  const el = $("results-score");
  el.textContent = "";
  const cpu = g.players.length === 2 ? g.players.find((p) => p.ai) : null;
  if (!cpu) return;
  if (!BOARD_COUNTS(cpu)) {
    el.textContent = "Easy matches don't count for the leaderboard. Try Medium or Hard!";
    return;
  }
  if (!["all_claimed", "tiebreak"].includes(result.reason)) {
    el.textContent = "Only finished matches count for the leaderboard.";
    return;
  }
  if (!me.signedIn) return;
  const human = g.players[0];
  el.textContent = "Saving your score...";
  // Exactly the stats named in startng.json, each a whole number.
  const reply = await saveScore({
    houses: whole(human.houses.length),
    level: whole(cpu.ai === "hard" ? 3 : 2), // 2 = Medium, 3 = Hard (Easy never counts)
    accuracy: whole(accuracy(human)),
    mistakes: whole(human.stats.mistakes),
    seconds: whole(elapsedMs / 1000),
  });
  if (!reply?.ok) el.textContent = "Couldn't save your score this time.";
  else {
    const r = reply.result ?? {};
    el.textContent = r.improved ? `New best! You're #${r.rank} on the leaderboard.` : `Saved. Your best is #${r.rank} on the leaderboard.`;
  }
}

function lbRow(cls, rank, face, name, sub, val) {
  const r = el("div", `lb-row ${cls}`);
  const who = el("div");
  who.append(el("span", "who-name", name));
  if (sub) who.append(el("small", "", sub));
  r.append(el("span", "rank", String(rank)), el("span", "face", face), who, el("span", "val", val));
  return r;
}

// The board keeps each player's single best run, ranked by houses and then by computer level, so a
// player shows on the tab of the level they set that best run on.
let lbLevel = 2; // 2 = Medium, 3 = Hard
const LB_NAME = { 2: "Medium", 3: "Hard" };

function fillPlaceholders(list) {
  const rows = isDesktop() ? 5 : 3;
  for (let i = 0; i < rows; i++) list.append(lbRow(i === 0 ? "first open" : "open", i + 1, "", "Open", "", ""));
}

async function showLeaderboard() {
  const empty = $("lb-empty");
  const list = $("lb-list");
  const status = $("lb-status");
  for (const b of document.querySelectorAll("#lb-tabs .chip")) b.classList.toggle("on", Number(b.dataset.level) === lbLevel);
  empty.hidden = false;
  document.querySelector(".lb-cta").hidden = true;
  list.replaceChildren();
  status.textContent = "Loading...";
  const reply = await loadLeaderboard(50);
  if (document.body.dataset.mode !== "leaderboard") return;
  if (!reply?.ok) {
    status.textContent = onStartNg() ? "Couldn't reach start.ng. Try again in a moment." : "The leaderboard works on suwe.start.ng.";
    document.querySelector(".lb-cta").hidden = false;
    fillPlaceholders(list);
    return;
  }
  const all = reply.entries ?? [];
  const entries = all.filter((e) => (e.stats?.level ?? 2) === lbLevel);
  if (!entries.length) {
    status.textContent = `Beat Tunde on ${LB_NAME[lbLevel]} to take the top spot.`;
    document.querySelector(".lb-cta").hidden = false;
    fillPlaceholders(list);
    return;
  }
  empty.hidden = true;
  document.querySelector(".lb-cta").hidden = true;
  entries.slice(0, 10).forEach((e, i) => {
    const st = e.stats ?? {};
    const initials = String(e.name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
    const row = lbRow(`${i === 0 ? "first" : ""}${me.id != null && e.player_id === me.id ? " me" : ""}`, i + 1, initials, e.name, `${st.accuracy ?? 0}% accuracy · ${st.mistakes ?? 0} mistakes · ${fmt((st.seconds ?? 0) * 1000)}`, plural(st.houses ?? e.score ?? 0, "house"));
    list.append(row);
  });
}
for (const b of document.querySelectorAll("#lb-tabs .chip")) {
  b.addEventListener("click", () => {
    lbLevel = Number(b.dataset.level);
    showLeaderboard();
  });
}

// --- screens ---------------------------------------------------------------------------------------
const SCREENS = ["menu", "setup", "gate", "results", "howto", "settings", "leaderboard"];
function mode(m) {
  document.body.dataset.mode = m;
  for (const id of SCREENS) $(id).hidden = id !== m;
  if (m === "howto") tutorial.start();
  else tutorial.stop();
  if (m !== "play") {
    hidePill();
    hideTurnCard();
  }
  if (m === "menu") {
    renderMenu();
    menuStage();
  }
  if (m === "settings") renderSettings();
  if (m === "leaderboard") showLeaderboard();
  renderLives(true);
  layoutScene();
}

// "You Don Buy House": a short celebration over the court.
let celebrateTimer;
function celebrate(e) {
  const box = $("celebrate");
  box.style.setProperty("--c", e.color ?? "#e03131");
  $("celebrate-sub").textContent = `${e.name} owns square ${e.square}`;
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
  const elapsed = matchElapsed();
  $("results-time").textContent = `Match time ${fmt(elapsed)}`;
  $("results-hearts").textContent = lives.lives
    ? ""
    : `You have no hearts left. Next one in ${fmt(msToNextLife(lives, Date.now()))}.`;
  clearSave();
  setPaused(false);
  submitScore(g, result, elapsed);
  if (!result.tie) audio.speak("Winner");
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

// The Play button: sign in first when needed, then pick the players.
function renderPlayButton() {
  const btn = $("play");
  btn.disabled = !meReady;
  btn.textContent = !meReady ? "Loading..." : needsSignIn() ? "Sign in to play" : "Play";
  btn.classList.toggle("go", meReady && !needsSignIn());
}

function openSetup(opts = {}) {
  if (!meReady) return;
  if (needsSignIn()) {
    location.href = signInUrl();
    return;
  }
  lives = tickLives(lives, Date.now());
  if (!canPlay(lives, Date.now())) {
    showGate(
      "No lives left",
      `You need a life to play. Your next life comes in ${fmt(msToNextLife(lives, Date.now()))}.`,
      false,
    );
    return;
  }
  if (loadSave() && !confirm("Start a new match? Your saved match will be lost.")) return;
  setup.show(opts);
  mode("setup");
}
$("play").addEventListener("click", () => openSetup());
$("lb-play").addEventListener("click", () => openSetup({ count: 2 }));

const setup = createSetup($("setup"), {
  getMe: () => ({ name: me.name, style: me.style, signedIn: me.signedIn }),
  onBack: () => mode("menu"),
  onStart: (cfg) => startMatch(cfg),
  say,
});

function startMatch(cfg) {
  matchId++;
  clearTimeout(aiTimer);
  aiTimer = null;
  const players = cfg.players.map((p, i) => (i === 0 ? { ...p, lives: tickLives(lives, Date.now()).lives } : p));
  game = createGame({ seed: Date.now() >>> 0, players });
  announced = false;
  lastKey = "";
  matchStart = Date.now();
  elapsedBase = 0;
  setPaused(false);
  director.reset();
  saveMatch();
  mode("play");
  startTurn();
}

// --- pause menu ---------------------------------------------------------------------------------
// The Menu button pauses the match and slides a menu in from the right. Pressing it
// again (or Resume, or the dark area, or Esc) closes the menu and carries on.
let paused = false;
let pausedAt = 0;

function setPaused(on) {
  if (on === paused) return;
  if (on && (!game || game.over || document.body.dataset.mode !== "play")) return;
  paused = on;
  document.body.classList.toggle("paused", on);
  $("pause-menu").setAttribute("aria-hidden", String(!on));
  if (on) {
    pausedAt = performance.now();
    clearTimeout(aiTimer);
    aiTimer = null;
    holdState = null;
    view.hold = null;
    saveMatch();
    const others = players().filter((q) => q.id !== players()[0].id);
    $("pause-sub").textContent = `${others.length ? `You vs ${others.map((q) => q.name).join(", ")}` : "Solo practice"} · you're on square ${players()[0].target}`;
    renderAudioButtons();
  } else {
    meterStart += performance.now() - pausedAt; // the balance needle carries on from where it was
  }
}

$("menu-btn").addEventListener("click", () => setPaused(!paused));
$("pause-close").addEventListener("click", () => setPaused(false));
$("pause-scrim").addEventListener("click", () => setPaused(false));
$("pause-resume").addEventListener("click", () => setPaused(false));
$("pause-music").addEventListener("click", () => $("opt-music").click());
$("pause-sfx").addEventListener("click", () => $("opt-sfx").click());
$("pause-voice").addEventListener("click", () => $("opt-voice").click());
let howtoFromPause = false;
$("pause-howto").addEventListener("click", () => {
  howtoFromPause = true;
  mode("howto");
});
$("pause-leave").addEventListener("click", () => {
  saveMatch();
  setPaused(false);
  endMatchState();
  game = null;
  director.reset();
  view.hint = null;
  mode("menu");
});

// --- keyboard (desktop): Esc pause, M sound, Space hold to throw / hop, S skip the computer ---
addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.("input, textarea, select")) return;
  const playing = document.body.dataset.mode === "play";
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === "Escape" && playing) setPaused(!paused);
  else if (key === "m" && playing) toggleMute();
  else if (key === "Enter" && pillShown) {
    e.preventDefault();
    director.release();
  } else if (key === "s" && playing && !paused) skipComputer();
  else if (key === " " && playing && humanTurn()) {
    e.preventDefault();
    if (e.repeat) return;
    document.activeElement?.blur?.();
    if (THROW_MOVE[game.phase]) startHold("key");
    else if (game.phase === "hop") submit({ type: "hop", square: expectation(game).to, timing: needle(performance.now()) });
    else if (game.phase === "pickup") submit({ type: "pickup", timing: needle(performance.now()) });
  }
});
addEventListener("keyup", (e) => {
  if (e.key === " " && holdState?.id === "key") endHold(false);
});

// --- menu, settings and how to play ---------------------------------------------------------------
const tutorial = createTutorial($("howto"), {
  onClose: () => {
    if (howtoFromPause) {
      howtoFromPause = false;
      mode("play");
    } else mode("menu");
  },
  onTry: () => {
    if (howtoFromPause) {
      howtoFromPause = false;
      mode("play"); // back to the paused match
      return;
    }
    store.set("suwe.seenTutorial", true);
    if (needsSignIn()) location.href = signInUrl();
    else {
      setup.show({ count: 1 });
      mode("setup");
    }
  },
});

function renderMenu() {
  const d = loadSave();
  $("continue-card").hidden = !d;
  $("continue").hidden = !d;
  if (d) {
    const g = d.game;
    const others = g.players.slice(1);
    const vs = others.length ? `You vs ${others.map((q) => q.name).join(", ")}` : "Solo practice";
    $("saved-line").textContent = `${vs}, you're on square ${g.players[0].target}`;
  }
  $("howto-new").hidden = Boolean(store.get("suwe.seenTutorial"));
}

function renderSettings() {
  $("discard-save").hidden = !loadSave();
  renderAudioButtons();
}

$("continue").addEventListener("click", () => {
  if (needsSignIn()) location.href = signInUrl();
  else resumeMatch();
});
$("open-howto").addEventListener("click", () => {
  store.set("suwe.seenTutorial", true);
  mode("howto");
});
$("open-lb").addEventListener("click", () => mode("leaderboard"));
$("open-settings").addEventListener("click", () => mode("settings"));
$("settings-back").addEventListener("click", () => mode("menu"));
$("lb-back").addEventListener("click", () => mode("menu"));
$("discard-save").addEventListener("click", () => {
  if (confirm("Delete your saved match?")) {
    clearSave();
    renderSettings();
  }
});

// --- frame loop ---------------------------------------------------------------------------------------
let wasBusy = false;
let animT = 0; // the animation clock: stands still while paused, runs twice as fast on 2x speed
let lastT = null;
let lastBarSquare = null;
function frame(t) {
  const dt = lastT === null ? 0 : Math.min(100, t - lastT);
  lastT = t;
  if (!paused) animT += dt * speed();
  director.update(animT);
  const busy = director.busy;
  if (game) {
    if (wasBusy && !busy) {
      $("meter").classList.remove("locked");
      refreshHud();
    }
    if (!busy) scheduleAi();
    if (!$("meter").hidden && !busy) $("needle").style.left = `${50 + needle(t) * 50}%`;
    // The ring while the stone is held, and the bar that follows it.
    if (holdState && humanTurn()) {
      const ring = currentRing();
      const sec = (performance.now() - holdState.t0) / 1000;
      view.hold = { origin: THROW_ORIGIN, ring, trail: [ringAt(Math.max(0, sec - 0.12)), ringAt(Math.max(0, sec - 0.24)), ringAt(Math.max(0, sec - 0.36))], around: game.phase === "throw" ? squareCenter(current().target) : null };
      if (lastBarSquare !== "held") {
        lastBarSquare = "held";
        const t = current().target;
        setBar("target", game.phase === "throw" ? `Let go on square ${t}` : game.phase === "tiebreak" ? "Let go near the mark" : "Let go on an empty square", "Hold the stone. The red mark spins.", true);
      }
    } else if (view.hold) {
      view.hold = null;
      lastBarSquare = null;
      updateBar();
    }
    if (!$("turncard").hidden) $("turncard-bar").style.width = `${Math.max(0, 1 - (performance.now() - turnCardStart) / 2000) * 100}%`;
  }
  wasBusy = busy;
  scene.draw(view, t);
  requestAnimationFrame(frame);
}
mode("menu");
view.hint = null;
requestAnimationFrame(frame);

// Debug hook for scripted runs: open with ?debug. Never on the live start.ng site.
if (params.has("debug") && !onStartNg()) {
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
    hit: (sx, sy) => scene.hitSquare(sx, sy),
    // Pin the ring to a place (no random miss), or pass nothing to let it move again.
    ring: (x, y) => (ringOverride = x == null ? null : { x, y }),
    setLives: (v) => {
      lives = v;
      saveLives();
      renderLives(true);
    },
    get holding() {
      return Boolean(holdState);
    },
    stonePx: () => stonePx(),
    scene,
    zone: () => (game.phase === "throw" ? 1 : expectation(game).zone),
    spendLife,
    get view() {
      return view;
    },
    audio,
    setTransport,
    get saved() {
      return store.get(SAVE_KEY);
    },
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
  initials: $("player-initials"),
  name: $("player-name"),
  account: $("player-account"),
  signIn: $("player-sign-in"),
};
card.signIn.href = signInUrl();

function showPlayer(p) {
  if (!onStartNg()) p = localPlayer();
  meReady = true;
  me = { ...p, style: p.style ?? DEFAULT_STYLE };
  const unsigned = onStartNg() && !p.signedIn;
  const name = unsigned ? "Not signed in" : p.name;
  card.name.textContent = name;
  card.account.textContent = unsigned ? "Sign in to play" : "";
  if (p.face && !unsigned) card.face.src = p.face;
  card.face.hidden = !p.face || unsigned;
  card.initials.textContent = unsigned
    ? "?"
    : name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join("");
  card.initials.hidden = !card.face.hidden;
  card.signIn.hidden = !unsigned;
  card.root.hidden = false;
  renderPlayButton();
}

// Until start.ng answers we show a waiting state; locally the test player is ready at once.
if (onStartNg()) renderPlayButton();
else showPlayer(me);
watchPlayer(showPlayer);
