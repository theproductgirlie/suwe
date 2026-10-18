import { START_POINT } from "./engine/court.js";
import { createScene } from "./render/scene.js";
import { DEFAULT_STYLE } from "./render/character.js";
import { onStartNg, signInUrl, watchPlayer } from "./startng.js";

const canvas = document.getElementById("stage");
const scene = createScene(canvas);

// Step 1 preview state. The rules engine will own this from step 2.
const state = {
  target: 1,
  stone: { x: 0.9, y: -0.5 },
  players: [{ style: DEFAULT_STYLE, x: START_POINT.x, y: START_POINT.y }],
};

function fit() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  scene.resize(window.innerWidth, window.innerHeight, dpr);
}
addEventListener("resize", fit);
fit();

function frame(t) {
  scene.draw(state, t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- start.ng player card (the character rule) -------------------------------
const card = {
  root: document.getElementById("player-card"),
  face: document.getElementById("player-face"),
  name: document.getElementById("player-name"),
  account: document.getElementById("player-account"),
  signIn: document.getElementById("player-sign-in"),
};
card.signIn.href = signInUrl();

function showPlayer(p) {
  state.players[0].style = p.style ?? DEFAULT_STYLE;
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
