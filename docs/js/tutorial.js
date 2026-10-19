// How to Play: six short animated slides that teach throwing, hopping, the
// balance needle, picking up the stone, lines and hearts, and buying a house.
// The pictures are a simple top-down court, drawn and animated in code.

import { drawCharacter, DEFAULT_STYLE } from "./render/character.js";

const W = 400;
const H = 290;
const CELL_W = 62;
const CELL_H = 34;
const X0 = (W - 2 * CELL_W) / 2;
const Y_BOTTOM = 240; // bottom edge of the court
const FONT = '"Baloo 2", "Trebuchet MS", system-ui, sans-serif';

const lerp = (a, b, p) => a + (b - a) * p;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
// A 0..1 progress of `t` within [from, to].
const seg = (t, from, to) => clamp01((t - from) / (to - from));

function rect(n) {
  const col = n <= 6 ? 0 : 1;
  const row = n <= 6 ? n - 1 : 12 - n;
  return { x: X0 + col * CELL_W, y: Y_BOTTOM - (row + 1) * CELL_H, w: CELL_W, h: CELL_H };
}
const center = (n) => {
  const r = rect(n);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
};
const START = { x: X0 + CELL_W * 0.5, y: Y_BOTTOM + 30 };
const STONE_HOME = { x: X0 + CELL_W * 1.6, y: Y_BOTTOM + 22 };

function ground(ctx) {
  ctx.fillStyle = "#ead7a6";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#e2c488";
  ctx.fillRect(X0, Y_BOTTOM - 6 * CELL_H, 2 * CELL_W, 6 * CELL_H);
}

function court(ctx, { tint = {}, numbers = true, hot = null, hotAlpha = 1 } = {}) {
  for (const [n, color] of Object.entries(tint)) {
    const r = rect(Number(n));
    ctx.fillStyle = color;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  if (hot) {
    const r = rect(hot);
    ctx.fillStyle = `rgba(255, 214, 10, ${0.45 * hotAlpha})`;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = `rgba(255, 170, 0, ${hotAlpha})`;
    ctx.lineWidth = 3;
    ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
  }
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (let i = 0; i <= 6; i++) {
    ctx.beginPath();
    ctx.moveTo(X0, Y_BOTTOM - i * CELL_H);
    ctx.lineTo(X0 + 2 * CELL_W, Y_BOTTOM - i * CELL_H);
    ctx.stroke();
  }
  for (let i = 0; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(X0 + i * CELL_W, Y_BOTTOM);
    ctx.lineTo(X0 + i * CELL_W, Y_BOTTOM - 6 * CELL_H);
    ctx.stroke();
  }
  if (numbers) {
    ctx.font = `800 17px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(120, 85, 40, 0.5)";
    for (let n = 1; n <= 12; n++) {
      const c = center(n);
      ctx.fillText(String(n), c.x, c.y + 1);
    }
  }
}

function stone(ctx, x, y, lift = 0) {
  ctx.fillStyle = "rgba(40,25,10,0.25)";
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 3, 9, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#6c757d";
  ctx.beginPath();
  ctx.ellipse(x, y - lift, 8, 6.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function kid(ctx, x, y, pose = {}, style = { ...DEFAULT_STYLE, primaryColor: "#d6433b" }) {
  drawCharacter(ctx, style, x, y, 0.42, { back: true, ...pose });
}

function finger(ctx, x, y, pressed = true) {
  ctx.fillStyle = pressed ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.6)";
  ctx.strokeStyle = "rgba(90,50,10,0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function bubble(ctx, text, x, y, color = "#2b8a3e") {
  ctx.font = `800 15px ${FONT}`;
  const w = ctx.measureText(text).width + 22;
  ctx.fillStyle = "#fffefa";
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 16, w, 32, 14);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 1);
}

function arrow(ctx, from, to, color = "#e08a1e") {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - 9 * Math.cos(a - 0.5), to.y - 9 * Math.sin(a - 0.5));
  ctx.lineTo(to.x - 9 * Math.cos(a + 0.5), to.y - 9 * Math.sin(a + 0.5));
  ctx.closePath();
  ctx.fill();
}

// The balance needle, as the game draws it.
function meter(ctx, y, pos, zone) {
  const x = 60;
  const w = W - 120;
  ctx.fillStyle = "#c92a2a";
  ctx.beginPath();
  ctx.roundRect(x, y, w, 16, 8);
  ctx.fill();
  ctx.fillStyle = "#40c057";
  ctx.fillRect(x + w / 2 - (w * zone) / 2, y, w * zone, 16);
  ctx.strokeStyle = "#fffefa";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x, y, w, 16, 8);
  ctx.stroke();
  ctx.fillStyle = "#212529";
  ctx.fillRect(x + w / 2 + (pos * w) / 2 - 3, y - 3, 6, 22);
}

// The route for the stone in square 1: 2, 3, 4 ... (hop positions along the left column).
const OUT = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export const SLIDES = [
  {
    title: "The court",
    text: "Suwe is a hopping game from Nigerian compounds. The court has 12 numbered squares: 1 to 6 up the left side, then 7 to 12 down the right side.",
    draw(ctx, t) {
      ground(ctx);
      const hot = 1 + Math.floor((t * 3) % 12);
      court(ctx, { hot });
      ctx.fillStyle = "#e08a1e";
      arrow(ctx, { x: X0 - 22, y: Y_BOTTOM - 20 }, { x: X0 - 22, y: Y_BOTTOM - 6 * CELL_H + 20 });
      arrow(ctx, { x: X0 + 2 * CELL_W + 22, y: Y_BOTTOM - 6 * CELL_H + 20 }, { x: X0 + 2 * CELL_W + 22, y: Y_BOTTOM - 20 });
      kid(ctx, START.x, START.y);
      stone(ctx, STONE_HOME.x, STONE_HOME.y);
    },
  },
  {
    title: "Throw the stone",
    text: "Drag the stone backwards, then let go. A longer drag throws harder, and the direction sets your aim. The stone must land completely inside the glowing square. A stone on a line is a miss.",
    draw(ctx, t) {
      ground(ctx);
      const k = t % 4.5;
      const pull = seg(k, 0.3, 1.4);
      const fly = seg(k, 1.7, 2.5);
      const landed = k >= 2.5;
      court(ctx, { hot: 1, hotAlpha: 0.6 + 0.4 * Math.sin(t * 5), tint: landed ? { 1: "rgba(47,158,68,0.35)" } : {} });
      kid(ctx, START.x, START.y);
      const home = STONE_HOME;
      const target = center(1);
      if (k < 1.7) {
        const fx = home.x + 8 * pull;
        const fy = home.y + 44 * pull;
        if (pull > 0) {
          ctx.setLineDash([3, 7]);
          ctx.strokeStyle = "rgba(60,30,0,0.8)";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(home.x, home.y);
          ctx.lineTo(target.x, target.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeStyle = "rgba(90,50,10,0.8)";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(home.x, home.y);
          ctx.lineTo(fx, fy);
          ctx.stroke();
          finger(ctx, fx, fy);
        }
        stone(ctx, home.x, home.y);
      } else {
        const x = lerp(home.x, target.x, fly);
        const y = lerp(home.y, target.y, fly);
        stone(ctx, x, y, Math.sin(Math.PI * fly) * 40);
      }
      if (landed) bubble(ctx, "Inside the square!", W / 2, 26);
    },
  },
  {
    title: "Hop through the court",
    text: "Hop on one foot through the squares, in order. Tap the glowing square to hop there. Wrong tap, a line, or the stone's square? Your turn ends.",
    draw(ctx, t) {
      ground(ctx);
      const k = (t * 1.6) % (OUT.length + 1.5);
      const idx = Math.min(OUT.length - 1, Math.floor(k));
      const next = OUT[Math.min(OUT.length - 1, idx + 1)];
      court(ctx, { hot: next, tint: { 1: "rgba(108,117,125,0.35)" } });
      stone(ctx, center(1).x, center(1).y);
      const a = center(OUT[idx]);
      const b = center(next);
      const p = k >= OUT.length ? 1 : k - idx;
      const x = lerp(a.x, b.x, p);
      const y = lerp(a.y, b.y, p);
      kid(ctx, x, y + 14, { oneLeg: true, lift: Math.sin(Math.PI * p) * 14 });
      finger(ctx, b.x + 14, b.y + 10, Math.sin(t * 6) > 0);
      bubble(ctx, "Skip the stone's square", W / 2, 20, "#e08a1e");
    },
  },
  {
    title: "The balance needle",
    text: "Jumping over a square, and picking up the stone, need good balance. Tap when the needle is in the green. Higher squares have a smaller green zone.",
    draw(ctx, t) {
      ground(ctx);
      const pos = Math.sin(t * 2.4);
      const inGreen = Math.abs(pos) < 0.3;
      court(ctx, { hot: 3, tint: { 2: "rgba(108,117,125,0.35)" } });
      stone(ctx, center(2).x, center(2).y);
      const jump = (Math.sin(t * 2.4 * 0.5) + 1) / 2;
      kid(ctx, lerp(center(1).x, center(3).x, jump), lerp(center(1).y, center(3).y, jump) + 14, {
        oneLeg: true,
        lift: Math.sin(Math.PI * jump) * 18,
      });
      meter(ctx, 262, pos, 0.3);
      bubble(ctx, inGreen ? "Now!" : "Wait for the green...", W / 2, 20, inGreen ? "#2b8a3e" : "#c92a2a");
    },
  },
  {
    title: "Turn and pick up",
    text: "Hop to the last square, turn around, and hop back. At the square before the stone, tap Pick up with the needle in the green. Then hop home.",
    draw(ctx, t) {
      ground(ctx);
      const k = t % 6;
      const goOut = seg(k, 0, 2);
      const turn = seg(k, 2, 2.6);
      const back = seg(k, 2.6, 4.2);
      const bend = seg(k, 4.2, 4.8);
      const home = seg(k, 4.9, 5.7);
      court(ctx, { tint: { 3: "rgba(108,117,125,0.35)" } });
      const holding = k > 4.5;
      if (!holding) stone(ctx, center(3).x, center(3).y);
      let pos;
      if (k < 2) pos = { x: lerp(center(2).x, center(12).x, goOut), y: lerp(center(2).y, center(12).y, goOut) };
      else if (k < 4.2) pos = { x: lerp(center(12).x, center(4).x, back), y: lerp(center(12).y, center(4).y, back) };
      else if (k < 4.9) pos = center(4);
      else pos = { x: lerp(center(4).x, START.x, home), y: lerp(center(4).y, START.y - 8, home) };
      kid(ctx, pos.x, pos.y + 14, {
        oneLeg: true,
        lift: k < 2 || (k > 2.6 && k < 4.2) ? 6 : 0,
        back: k < 2.3,
        bend: k > 4.2 && k < 4.9 ? Math.sin(Math.PI * bend) : 0,
        hold: holding,
        facing: k > 2 && k < 2.6 ? Math.abs(Math.cos(Math.PI * turn)) || 0.05 : 1,
      });
      if (k > 2 && k < 2.8) bubble(ctx, "Turn around", W / 2, 20, "#e08a1e");
      if (k > 4.2 && k < 5) bubble(ctx, "Pick up!", W / 2, 20, "#2b8a3e");
    },
  },
  {
    title: "Lines, hearts and turns",
    text: "Touch a chalk line, enter the stone's square, tap the wrong square or lose your balance, and your turn ends. You lose a heart too. Next turn you start again from the same square. At 0 hearts you are out, and the others carry on.",
    draw(ctx, t) {
      ground(ctx);
      const k = t % 4;
      const stumble = seg(k, 1, 1.8);
      court(ctx, { tint: { 1: "rgba(108,117,125,0.35)" } });
      stone(ctx, center(1).x, center(1).y);
      const a = center(2);
      const b = { x: X0 + CELL_W / 2, y: Y_BOTTOM - 2 * CELL_H };
      const x = lerp(a.x, b.x, seg(k, 0, 1));
      const y = lerp(a.y, b.y, seg(k, 0, 1));
      kid(ctx, x, y + 14, { oneLeg: stumble === 0, tilt: stumble * 0.9, lift: k < 1 ? Math.sin(Math.PI * k) * 10 : 0 });
      if (k > 1) {
        ctx.fillStyle = "rgba(224,49,49,0.9)";
        ctx.fillRect(X0, Y_BOTTOM - 2 * CELL_H - 2, 2 * CELL_W, 4);
        bubble(ctx, "No match line o!", W / 2, 20, "#c92a2a");
      }
      for (let i = 0; i < 5; i++) {
        ctx.font = `800 22px ${FONT}`;
        ctx.textAlign = "center";
        ctx.fillStyle = i < 5 - (k > 1.8 ? 1 : 0) ? "#c92a2a" : "rgba(60,40,20,0.25)";
        ctx.fillText("♥", W - 96 + i * 20, 258);
      }
    },
  },
  {
    title: "Buy a house: Ra Ile",
    text: "Finish all 12 squares, then throw the stone backwards over your shoulder. Land completely in a free square and it becomes your house. Others must jump over it. Most houses wins!",
    draw(ctx, t) {
      ground(ctx);
      const k = t % 5;
      const fly = seg(k, 1, 2);
      const landed = k >= 2;
      court(ctx, {
        tint: {
          3: "rgba(59,120,201,0.35)",
          ...(landed ? { 9: "rgba(214,67,59,0.4)" } : {}),
        },
      });
      // someone else's house
      const c3 = center(3);
      ctx.fillStyle = "#3b78c9";
      ctx.font = `800 11px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("Tunde", c3.x, c3.y + 11);
      kid(ctx, START.x, START.y, { back: false });
      const from = STONE_HOME;
      const to = center(9);
      if (!landed) {
        const x = lerp(from.x, to.x, fly);
        const y = lerp(from.y, to.y, fly);
        stone(ctx, k < 1 ? from.x : x, k < 1 ? from.y : y, k < 1 ? 0 : Math.sin(Math.PI * fly) * 55);
      } else {
        ctx.fillStyle = "#d6433b";
        ctx.beginPath();
        ctx.moveTo(to.x - 12, to.y - 2);
        ctx.lineTo(to.x, to.y - 14);
        ctx.lineTo(to.x + 12, to.y - 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(to.x - 8, to.y - 2, 16, 10);
        ctx.font = `800 12px ${FONT}`;
        ctx.fillText("You", to.x, to.y + 21);
        bubble(ctx, "You Don Buy House!", W / 2, 20, "#d6433b");
      }
      if (k < 1) bubble(ctx, "Back to the court...", W / 2, 20, "#e08a1e");
    },
  },
];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * @param {HTMLElement} root
 * @param {{ onClose: () => void, onTry: () => void }} opts
 */
export function createTutorial(root, { onClose, onTry }) {
  let index = 0;
  let raf = 0;
  let t0 = 0;
  let canvas;
  let ctx;

  root.replaceChildren();
  const back = el("button", "setup-back", "‹  Back");
  back.type = "button";
  back.onclick = onClose;
  const title = el("h2", "setup-title");
  const sub = el("p", "setup-sub");
  canvas = el("canvas", "tut-canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx = canvas.getContext("2d");
  const text = el("p", "tut-text");
  const dots = el("div", "tut-dots");
  const nav = el("div", "tut-nav");
  const prev = el("button", "opt", "Back");
  const next = el("button", "big go", "Next");
  prev.type = next.type = "button";
  nav.append(prev, next);
  root.append(back, title, sub, canvas, text, dots, nav);

  function show(i) {
    index = Math.max(0, Math.min(SLIDES.length - 1, i));
    const s = SLIDES[index];
    title.textContent = s.title;
    sub.textContent = `Step ${index + 1} of ${SLIDES.length}`;
    text.textContent = s.text;
    dots.replaceChildren(
      ...SLIDES.map((_, n) => {
        const d = el("i", n === index ? "on" : "");
        d.onclick = () => show(n);
        return d;
      }),
    );
    prev.style.visibility = index === 0 ? "hidden" : "visible";
    next.textContent = index === SLIDES.length - 1 ? "Try it now" : "Next";
    t0 = performance.now();
  }
  prev.onclick = () => show(index - 1);
  next.onclick = () => (index === SLIDES.length - 1 ? onTry() : show(index + 1));

  function frame(now) {
    const t = (now - t0) / 1000;
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.clearRect(0, 0, W, H);
    try {
      SLIDES[index].draw(ctx, t);
    } catch (err) {
      console.error(err);
    }
    raf = requestAnimationFrame(frame);
  }

  return {
    // Runs only while the screen is showing.
    start() {
      show(0);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(raf);
    },
    show,
    get index() {
      return index;
    },
  };
}
