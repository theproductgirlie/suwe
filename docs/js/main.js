import { DEFAULT_STYLE, normalizeStyle, drawCharacter } from "./render/character.js";
import { icon, paintIcons, hearts, el } from "./ui.js";
import { ROWS, squareCenter } from "./engine/court.js";
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

// A row in the pause menu / settings: icon, label, and a switch.
const TOGGLES = {
  music: { ico: "music", label: "Music" },
  sfx: { ico: "volume", label: "Sound effects" },
  voice: { ico: "chat", label: "Voice lines", note: 'Reads key phrases aloud, like "Try again"' },
};
function paintToggle(btn, key, on) {
  const t = TOGGLES[key];
  const text = el("span");
  text.append(el("b", "", t.label));
  if (t.note) text.append(el("small", "", t.note));
  btn.replaceChildren(icon(t.ico, 26), text, el("span", "switch"));
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
  sb.replaceChildren(icon(quiet ? "mute" : "volume", 24), el("span", "btn-text", quiet ? "Sound off" : "Sound on"));
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
  line.replaceChildren(icon("heart", 15), document.createTextNode(`${lives.lives} of ${MAX_LIVES} lives${next ? ` · +1 in ${fmt(next)}` : ""}`));
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
  if (m === "play") {
    if (isDesktop()) {
      scene.setLayout({ nearY: H - 215, farY: 150, cx: W / 2, maxCell: Math.min(W * 0.2, H * 0.22), pitch: 52 }, { ground: true });
    } else {
      const top = $("hud").getBoundingClientRect().bottom + 26;
      const bottom = $("move").getBoundingClientRect().top - 100;
      scene.setLayout({ nearY: Math.max(bottom, top + 220), farY: top, cx: W / 2, maxCell: W * 0.4, pitch: 46 }, { ground: true });
    }
  } else if (m === "menu") {
    if (isDesktop()) scene.setLayout({ nearY: H * 0.95, farY: H * 0.42, cx: W * 0.74, maxCell: H * 0.16, pitch: 44 }, { ground: false });
    else scene.setLayout({ nearY: H * 0.97, farY: H * 0.58, cx: W / 2, maxCell: W * 0.34, pitch: 38 }, { ground: false });
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

// The home screen: the child stands on one leg by the court, with the stone beside them.
function menuStage() {
  director.reset();
  const desk = isDesktop();
  view.hero.style = normalizeStyle(me.style);
  view.hero.color = null;
  view.hero.sash = false;
  view.hero.x = desk ? -0.75 : 1.0;
  view.hero.y = desk ? 1.5 : ROWS + 0.5;
  Object.assign(view.hero.pose, { back: true, oneLeg: true, lift: 0, bend: 0, tilt: 0, hold: false, facing: 1 });
  view.stone = { x: view.hero.x + (desk ? 0.8 : 0.85), y: view.hero.y - 0.05, h: 0 };
  view.waiting = [];
  view.houses = [];
  view.hint = null;
  view.mark = null;
  view.flash = null;
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
      x: 1.7 + i * 0.5,
      y: -1.1,
    }));
}

let announced = false;
function startTurn() {
  hideMiss();
  applyLooks();
  const p = current();
  if (!skipping) {
    if (solo()) say(announced ? "Throw again!" : "Oya, throw!", { speech: announced ? "" : "Oya, throw" });
    else if (!p.ai) say(`${p.name}, your turn!`, { speech: "Oya, your turn" });
  }
  announced = true;
  refreshHud();
}

// --- HUD ------------------------------------------------------------------------------------
const pips = $("pips");
for (let n = 1; n <= 12; n++) pips.append(document.createElement("i"));

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// What the player is asked to do, as the "Your move" card.
function moveInfo(e) {
  const p = current();
  const desk = isDesktop();
  const tap = desk ? "Click" : "Tap";
  if (e.kind === "throw")
    return { ico: "throw", kind: "Throw", title: `Throw at square ${e.target}`, desc: "Drag the stone back, then let go to throw.", tip: "Land inside the square without touching a chalk line" };
  if (e.kind === "backthrow")
    return { ico: "throw", kind: "Ra Ile", title: "Throw over your shoulder", desc: "Drag back and throw over your shoulder to buy a house.", tip: "Land on an empty square to buy a house" };
  if (e.kind === "tiebreak")
    return { ico: "throw", kind: "Tie-break", title: "Closest to the mark", desc: "Throw the stone closest to the red mark.", tip: "Drag back, then let go" };
  if (e.kind === "pickup")
    return { ico: "hand", kind: "Pick up", title: "Pick up the stone", desc: `${tap} Pick up when the needle is in the green.`, tip: "Wrong timing costs a heart" };
  if (e.to === "start")
    return { ico: "up", kind: "Hop", title: `${tap} HOME`, desc: "Hop home to finish the course.", tip: "Wrong square or a chalk line costs a heart" };
  return {
    ico: "up",
    kind: "Hop",
    title: desk ? `Square ${e.to}` : `${tap} square ${e.to}`,
    desc: e.needsTiming
      ? `Jump over square ${p.target}. Your stone is there, so you can't step on it. ${tap} with the needle in the green.`
      : `${tap} the glowing square.`,
    tip: "Wrong square or a chalk line costs a heart",
  };
}

const LEVEL_NAME = { easy: "Easy", medium: "Medium", hard: "Hard" };

function renderBoard() {
  const cur = current();
  const board = $("board");
  board.className = players().length === 1 ? "solo" : "";
  board.replaceChildren(
    ...players().map((p, i) => {
      const card = el("div", `pcard${p === cur ? " now" : ""}${p.out ? " out" : ""}`);
      card.style.setProperty("--c", p.color ?? "#999");
      card.append(el("span", "pbadge", `P${i + 1}`));
      const info = el("div", "pinfo");
      const name = el("div", "pname");
      name.append(el("span", "n-short", i === 0 && !p.ai ? "You" : p.name), el("span", "n-full", p.name));
      if (p.ai) name.append(el("span", "cpu", `· CPU`));
      info.append(name);
      const status = p.out ? "Out of hearts" : p === cur ? "Playing now" : p.ai ? `Computer · ${LEVEL_NAME[p.ai] ?? ""}` : "Up next";
      info.append(el("div", "pstatus", p === cur && p.ai ? `Playing now · Computer` : status));
      const stats = el("div", "pstats");
      stats.append(hearts(p.lives, MAX_LIVES));
      const houses = el("span", "houses");
      houses.append(icon("house", 18), el("span", "h-n", String(p.houses.length)), el("span", "h-label", p.houses.length === 1 ? " house" : " houses"));
      stats.append(houses);
      info.append(stats);
      const prog = el("div", "pprog");
      const done = Math.max(0, Math.min(12, p.target - 1));
      const head = el("div", "progress-head");
      head.append(el("span", "", "Progress"), el("span", "", `${done} of 12`));
      const segs = el("div", "segs");
      for (let n = 1; n <= 12; n++) segs.append(el("i", n <= done ? "done" : n === done + 1 ? "now" : ""));
      prog.append(head, segs);
      info.append(prog);
      card.append(info);
      return card;
    }),
  );
}

let meterStart = performance.now();
let lastKey = "";

function refreshHud() {
  if (!game) return;
  const p = current();
  renderBoard();
  const mine = !p.ai;
  const who = mine && (solo() || p === players()[0]) ? "Your" : `${p.name}'s`;
  const banner = $("banner");
  banner.style.setProperty("--c", p.color ?? "#999");
  banner.replaceChildren(document.createTextNode(`${who} turn`), el("small", "", `· ${solo() ? "Attempt" : "Turn"} ${game.turnNo}${p.circuits ? ` · Round ${p.circuits + 1}` : ""}`));
  // Progress strip (phone): the player whose turn it is.
  const done = Math.max(0, Math.min(12, p.target - 1));
  $("progress").style.setProperty("--c", p.color ?? "#999");
  $("progress-who").textContent = mine ? "Your progress" : `${p.name}'s progress`;
  $("progress-count").textContent = `${done} of 12 squares`;
  [...pips.children].forEach((d, i) => {
    d.className = i < done ? "done" : i === done ? "now" : "";
  });

  const e = expectation(game);
  // "Your move" for a person, "Watching" for the computer.
  $("move-card").hidden = !mine;
  $("watch-card").hidden = mine;
  $("move-label").textContent = mine ? "Your move" : "Watching";
  if (mine) {
    const m = moveInfo(e);
    $("move-icon").replaceChildren(icon(m.ico, 34));
    $("move-kind").textContent = m.kind;
    $("move-title").textContent = m.title;
    $("move-desc").textContent = m.desc;
    $("move-tip").replaceChildren(icon("heart", 18), document.createTextNode(m.tip));
  } else {
    const verb = game.phase === "hop" ? "hopping" : game.phase === "pickup" ? "picking up the stone" : "throwing";
    const title = $("watch-title");
    title.replaceChildren(document.createTextNode(`${p.name} is ${verb}`), el("span", "dots-anim"));
    const sub = $("watch-sub");
    sub.replaceChildren(document.createTextNode(`${LEVEL_NAME[p.ai] ?? ""} `), el("span", "stars", levelStars(p.ai)), document.createTextNode(` · on square ${p.target}`));
    $("skip-note").textContent = `Skipping jumps straight to the result of ${p.name}'s turn. Nothing about the score changes.`;
    const face = $("watch-face");
    let cv = face.firstChild;
    if (!cv) face.append((cv = el("canvas")));
    cv.width = cv.height = 152;
    const c = cv.getContext("2d");
    c.clearRect(0, 0, 152, 152);
    drawCharacter(c, normalizeStyle(p.look), 76, 176, 1.5, { back: false, shadow: false });
  }
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
  requestAnimationFrame(layoutScene);
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

let actor = null; // whoever made the move being shown (the state has already moved on to the next player)
function commit(r) {
  if (r.rejected) return;
  actor = game ? players()[game.current] : null;
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
  const delay = (["throw", "ra_ile", "tiebreak"].includes(game.phase) ? 900 : 450) / speed();
  aiTimer = setTimeout(() => {
    aiTimer = null;
    if (id !== matchId || paused || !game || game.over || director.busy || !current().ai) return;
    commit(playAiMove(game, current().ai));
  }, delay);
}

// --- the "missed" card -------------------------------------------------------------------
const MISS = {
  line_stone: ["On the line!", (who) => `${who} stone touched the chalk.`],
  line: ["On the line!", (who) => `${who} foot touched the chalk.`],
  miss: ["Missed the square!", (who) => `${who} stone did not land in the square.`],
  stone_square: ["That's the stone's square!", () => "The square with the stone in it can't be stepped on."],
  sequence: ["Wrong square!", () => "Hop to the glowing square next."],
  balance: ["Lost your balance!", () => "The needle was out of the green."],
  opponent_house: ["That's someone's house!", () => "A bought square can't be stepped on."],
  outside: ["Out of the court!", () => "Stay inside the chalk."],
};
let missShown = false;
function showMiss(e) {
  if (skipping || !game) return;
  const failed = actor ?? current();
  const failer = players().find((q) => q.id === failed.id) ?? failed; // the new state's copy
  const human = !failer.ai && (solo() || failer.id === players()[0].id);
  const who = human ? "Your" : `${failer.name}'s`;
  const [title, why] = MISS[e.reason] ?? ["Try again!", () => ""];
  $("miss-title").textContent = title;
  $("miss-why").textContent = `${why(who)} ${human ? "Your" : `${failer.name}'s`} turn ends.`.replace("  ", " ");
  const row = $("miss-hearts");
  const left = Math.max(0, e.lives);
  const h = hearts(left, MAX_LIVES);
  if (left < MAX_LIVES) {
    h.children[left].classList.remove("off");
    h.children[left].classList.add("off");
    h.children[left].append(el("span", "lost-badge", "−1"));
  }
  row.replaceChildren(...h.children);
  $("miss-left").textContent = isDesktop() ? `${left} ${left === 1 ? "heart" : "hearts"} left` : `${left} left`;
  $("miss-restart").textContent =
    left === 0
      ? `${human ? "You are" : `${failer.name} is`} out of hearts.`
      : `Next turn ${human ? "you throw" : `${failer.name} throws`} again for square ${failer.target}.`;
  const next = game.over ? null : current();
  $("miss-ok-text").textContent = solo() ? "OK, throw again" : `OK, ${next && next.id !== failer.id ? `${next.name}'s turn` : "go on"}`;
  $("miss-art").replaceChildren(missArt());
  $("miss").hidden = false;
  missShown = true;
  updateMissTimer(0);
}
function updateMissTimer(left) {
  $("miss-bar").style.width = `${Math.max(0, Math.min(1, left / 2000)) * 100}%`;
  const sec = Math.max(0, Math.ceil(left / 1000));
  $("miss-count").textContent = isDesktop() ? `Continues in ${sec || 2}s` : `Continues by itself in ${sec || 2}s`;
}
function hideMiss() {
  if (!missShown) return;
  missShown = false;
  $("miss").hidden = true;
}
function okMiss() {
  if (!missShown) return;
  director.release();
}
$("miss-ok").addEventListener("click", okMiss);

// A stone on a chalk line, with a red cross: the picture on the missed card.
function missArt() {
  const wrap = document.createElement("span");
  wrap.innerHTML = `<svg viewBox="0 0 110 110" aria-hidden="true"><circle cx="55" cy="58" r="46" fill="var(--sky)"/><rect x="16" y="62" width="78" height="9" rx="4.5" fill="var(--soft)" opacity=".45"/><ellipse cx="55" cy="57" rx="20" ry="12" fill="color-mix(in srgb, var(--ink) 55%, var(--chalk))"/><ellipse cx="49" cy="53" rx="6" ry="3.2" fill="var(--chalk)" opacity=".6"/><circle cx="84" cy="22" r="15" fill="var(--danger)" stroke="var(--card)" stroke-width="4"/><path d="m78 16 12 12M90 16 78 28" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>`;
  return wrap.firstChild;
}

// --- skipping the computer's turn ------------------------------------------------------------
function skipComputer() {
  if (!game || game.over || !current().ai || skipping) return;
  const id = matchId;
  skipping = true;
  clearTimeout(aiTimer);
  aiTimer = null;
  hideMiss();
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
  $("speed-text").textContent = fast ? "2× speed on" : "2× speed";
});

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

let lbHasScores = null; // unknown until the board has been loaded once
function renderLbHint() {
  $("lb-hint").textContent = lbHasScores === false ? "Top spot is open" : "See the best wins";
}

function lbRow(cls, rank, face, name, sub, val) {
  const r = el("div", `lb-row ${cls}`);
  const who = el("div");
  who.append(el("span", "who-name", name));
  if (sub) who.append(el("small", "", sub));
  r.append(el("span", "rank", String(rank)), el("span", "face", face), who, el("span", "val", val));
  return r;
}

function fillPlaceholders(list) {
  list.append(el("h4", "", "Places to win"));
  ["This could be you", "Open", "Open", "Open", "Open"].forEach((n, i) => list.append(lbRow(i === 0 ? "first" : "open", i + 1, i === 0 ? "You?" : "", n, "", "–")));
}

async function showLeaderboard() {
  const empty = $("lb-empty");
  const list = $("lb-list");
  const status = $("lb-status");
  empty.hidden = false;
  $("lb-play").hidden = true;
  list.replaceChildren();
  status.textContent = "Loading...";
  const reply = await loadLeaderboard(10);
  if (document.body.dataset.mode !== "leaderboard") return;
  if (!reply?.ok) {
    status.textContent = onStartNg() ? "Couldn't reach start.ng. Try again in a moment." : "The leaderboard works on suwe.start.ng.";
    $("lb-play").hidden = false;
    fillPlaceholders(list);
    return;
  }
  const entries = reply.entries ?? [];
  lbHasScores = entries.length > 0;
  renderLbHint();
  if (!entries.length) {
    status.textContent = "Beat the computer on Medium or Hard and your win lands here first. Nobody on start.ng has done it yet.";
    $("lb-play").hidden = false;
    fillPlaceholders(list);
    return;
  }
  empty.hidden = true;
  list.append(el("h4", "", "Best wins"));
  entries.forEach((e, i) => {
    const st = e.stats ?? {};
    const initials = String(e.name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
    const row = lbRow(`${i === 0 ? "first" : ""}${me.id != null && e.player_id === me.id ? " me" : ""}`, e.rank, initials, e.name, `${st.accuracy ?? 0}% accuracy · ${st.mistakes ?? 0} mistakes · ${fmt((st.seconds ?? 0) * 1000)}`, plural(st.houses ?? e.score ?? 0, "house"));
    list.append(row);
  });
}

// --- screens ---------------------------------------------------------------------------------------
const SCREENS = ["menu", "setup", "gate", "results", "howto", "settings", "leaderboard"];
function mode(m) {
  document.body.dataset.mode = m;
  for (const id of SCREENS) $(id).hidden = id !== m;
  if (m === "howto") tutorial.start();
  else tutorial.stop();
  if (m !== "play") hideMiss();
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
    drag = null;
    view.aim = null;
    saveMatch();
    const others = players().filter((q) => q !== players()[0]);
    $("pause-sub").textContent = `${others.length ? `vs ${others.map((q) => q.name).join(", ")}` : "Solo practice"} · Turn ${game.turnNo} · you're on square ${players()[0].target}`;
    $("pause-dots").replaceChildren(
      ...players().map((q) => {
        const d = document.createElement("i");
        d.style.background = q.color ?? "#999";
        return d;
      }),
    );
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

// --- keyboard (desktop): Esc pause, M sound, Space hop, S skip the computer, Enter continue ---
addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.("input, textarea, select")) return;
  const playing = document.body.dataset.mode === "play";
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === "Escape" && playing) setPaused(!paused);
  else if (key === "m" && playing) toggleMute();
  else if (key === "Enter" && missShown) {
    e.preventDefault();
    okMiss();
  } else if (key === "s" && playing && !paused) skipComputer();
  else if (key === " " && playing && humanTurn() && !missShown) {
    e.preventDefault();
    document.activeElement?.blur?.();
    if (game.phase === "hop") submit({ type: "hop", square: expectation(game).to, timing: needle(performance.now()) });
    else if (game.phase === "pickup") submit({ type: "pickup", timing: needle(performance.now()) });
  }
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
    const vs = others.length ? `vs ${others.map((q) => q.name).join(", ")}` : "Solo";
    $("saved-line").textContent = `${vs} · Turn ${g.turnNo} · Square ${g.players[0].target}`;
    $("saved-dots").replaceChildren(
      ...g.players.map((q) => {
        const i = document.createElement("i");
        i.style.background = q.color ?? "#999";
        return i;
      }),
    );
  }
  $("howto-new").hidden = Boolean(store.get("suwe.seenTutorial"));
  renderLbHint();
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
const tip = $("tip");
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
    if (missShown) updateMissTimer(director.gateLeft(animT));
  }
  // "Tap here": a label on the glowing square, for the person whose turn it is.
  const showTip = game && document.body.dataset.mode === "play" && !paused && !busy && !current().ai && game.phase === "hop" && Number.isInteger(view.hint);
  tip.hidden = !showTip;
  if (showTip) {
    const c = squareCenter(view.hint);
    const pt = scene.project(c.x, c.y + 0.3);
    tip.textContent = isDesktop() ? "Click to hop" : "Tap here";
    tip.style.left = `${pt.x}px`;
    tip.style.top = `${pt.y}px`;
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
