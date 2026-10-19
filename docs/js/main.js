import { DEFAULT_STYLE, normalizeStyle } from "./render/character.js";
import { createDirector } from "./director.js";
import { createSetup, levelStars } from "./setup.js";
import { createAudio } from "./audio.js";
import { createTutorial } from "./tutorial.js";
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

function renderAudioButtons() {
  const p = audio.prefs;
  const set = (id, label, on) => {
    const b = $(id);
    b.textContent = `${label}: ${on ? "On" : "Off"}`;
    b.classList.toggle("off", !on);
  };
  set("opt-music", "Music", p.music);
  set("opt-sfx", "Sound effects", p.sfx);
  set("opt-voice", "Voice lines", p.voice);
  set("pause-music", "Music", p.music);
  set("pause-sfx", "Sound effects", p.sfx);
  set("pause-voice", "Voice lines", p.voice);
  const quiet = !p.music && !p.sfx;
  $("sound-btn").textContent = quiet ? "Sound off" : "Sound on";
  $("sound-btn").classList.toggle("off", quiet);
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
// In a match, one button turns everything on or off.
$("sound-btn").addEventListener("click", () => {
  const on = !audio.prefs.music && !audio.prefs.sfx;
  audio.setMusic(on);
  audio.setSfx(on);
  renderAudioButtons();
});
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

const director = createDirector({
  style: DEFAULT_STYLE,
  say,
  onFlash: (f) => (director.view.flash = { ...f, t0: performance.now(), dur: 700 }),
  onTurn: () => startTurn(),
  onOver: (result) => showResults(result),
  onHouse: (e) => celebrate(e),
  sfx: (name) => audio.sfx(name),
});
const view = director.view;

function fit() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  scene.resize(window.innerWidth, window.innerHeight, dpr);
}
addEventListener("resize", fit);
fit();
// The court's numbers use the bundled font: redraw the backdrop once it has loaded.
document.fonts?.load('800 40px "Baloo 2"').then(fit, () => {});

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
  if (solo()) say(announced ? "Throw again!" : "Oya, throw!", { speech: announced ? "" : "Oya, throw" });
  else if (p.ai) say(`${p.name} is playing...`);
  else say(`${p.name}, your turn!`, { speech: "Oya, your turn" });
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
        tag.textContent = levelStars(p.ai);
        tag.title = `${p.ai} computer`;
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
  saveMatch();
  view.aim = null;
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
  const delay = ["throw", "ra_ile", "tiebreak"].includes(game.phase) ? 900 : 450;
  aiTimer = setTimeout(() => {
    aiTimer = null;
    if (id !== matchId || paused || !game || game.over || director.busy || !current().ai) return;
    commit(playAiMove(game, current().ai));
  }, delay);
}

// --- input --------------------------------------------------------------------------------------
const MIN_POWER = 0.12;
let drag = null;
const humanTurn = () => game && !paused && !game.over && !director.busy && !current().ai;

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

async function showLeaderboard() {
  const status = $("lb-status");
  const table = $("lb-table");
  table.hidden = true;
  status.textContent = "Loading...";
  const reply = await loadLeaderboard(10);
  if (document.body.dataset.mode !== "leaderboard") return;
  if (!reply?.ok) {
    status.textContent = onStartNg() ? "Couldn't reach start.ng. Try again in a moment." : "The leaderboard works on suwe.start.ng.";
    return;
  }
  const entries = reply.entries ?? [];
  if (!entries.length) {
    status.textContent = "No scores yet. Beat the computer on Medium or Hard to be first!";
    return;
  }
  status.textContent = "";
  const rows = entries.map((e) => {
    const tr = document.createElement("tr");
    if (me.id != null && e.player_id === me.id) tr.className = "me";
    const st = e.stats ?? {};
    const cells = [e.rank, e.name, st.houses ?? e.score, `${st.accuracy ?? 0}%`, st.mistakes ?? 0, fmt((st.seconds ?? 0) * 1000)];
    cells.forEach((v) => {
      const td = document.createElement("td");
      td.textContent = String(v);
      tr.append(td);
    });
    return tr;
  });
  $("lb-rows").replaceChildren(...rows);
  table.hidden = false;
}

// --- screens ---------------------------------------------------------------------------------------
const SCREENS = ["menu", "setup", "gate", "results", "howto", "settings", "leaderboard"];
function mode(m) {
  document.body.dataset.mode = m;
  for (const id of SCREENS) $(id).hidden = id !== m;
  if (m === "howto") tutorial.start();
  else tutorial.stop();
  if (m === "menu") renderMenu();
  if (m === "settings") renderSettings();
  if (m === "leaderboard") showLeaderboard();
  renderLives(true);
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

// The menu button: sign in first when needed, then play.
function renderPlayButton() {
  const btn = $("play");
  btn.disabled = !meReady;
  btn.textContent = !meReady ? "Loading..." : needsSignIn() ? "Sign in to play" : "Play SUWE";
  btn.classList.toggle("go", meReady && !needsSignIn());
}

$("play").addEventListener("click", () => {
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
let pauseOffset = 0; // total time spent paused, to keep the animation clock honest

function setPaused(on) {
  if (on === paused) return;
  if (on && (!game || game.over || document.body.dataset.mode !== "play")) return;
  paused = on;
  document.body.classList.toggle("paused", on);
  $("pause-menu").setAttribute("aria-hidden", String(!on));
  $("menu-btn").classList.toggle("on", on);
  $("menu-btn").textContent = on ? "Close" : "Menu";
  if (on) {
    pausedAt = performance.now();
    clearTimeout(aiTimer);
    aiTimer = null;
    drag = null;
    view.aim = null;
    saveMatch();
  } else {
    const away = performance.now() - pausedAt;
    pauseOffset += away;
    meterStart += away; // the balance needle carries on from where it was
  }
}

$("menu-btn").addEventListener("click", () => setPaused(!paused));
$("pause-scrim").addEventListener("click", () => setPaused(false));
$("pause-resume").addEventListener("click", () => setPaused(false));
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.body.dataset.mode === "play") setPaused(!paused);
});
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
  $("continue").hidden = !loadSave();
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
function frame(t) {
  // While paused the animation clock stands still, so nothing jumps ahead on resume.
  if (!paused) director.update(t - pauseOffset);
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
  card.account.textContent = p.account ? `@${p.account}` : unsigned ? "Sign in to play" : "Local test";
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
