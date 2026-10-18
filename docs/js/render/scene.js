// Canvas 2D scene: a Nigerian compound with a chalk Suwe court in 2.5D.
// The static backdrop is drawn once per resize into an offscreen canvas; only
// the moving bits are redrawn each frame, to stay light on low-power phones.

import { COLS, ROWS, cellToSquare, squareRect, squareToCell } from "../engine/court.js";
import { drawCharacter, STOCK } from "./character.js";

const NEAR_SCALE = 1;
const FAR_SCALE = 0.74; // far end of the court is 74% as wide as the near end

// Deterministic wobble for chalk lines (no Math.random: same picture every time).
const wobble = (i) => Math.sin(i * 12.9898) * 0.5;

export function createScene(canvas) {
  const ctx = canvas.getContext("2d", { alpha: false });
  const bg = document.createElement("canvas");
  const bgCtx = bg.getContext("2d", { alpha: false });
  let W = 0;
  let H = 0;
  let L = null; // layout

  function layout() {
    const courtBottom = H * 0.8;
    const courtTop = H * 0.3;
    const cellW = (W * 0.8) / COLS;
    L = { courtBottom, courtTop, cellW, cx: W / 2, wallBottom: H * 0.27 };
  }

  // Court (x,y in cell units) to screen px.
  function project(x, y) {
    const t = y / ROWS;
    const f = t * (1.15 - 0.15 * t);
    const scale = NEAR_SCALE + (FAR_SCALE - NEAR_SCALE) * f;
    return {
      x: L.cx + (x - COLS / 2) * L.cellW * scale,
      y: L.courtBottom - f * (L.courtBottom - L.courtTop),
      scale,
    };
  }

  // Character px-per-unit at a court position (1 unit = 1% of a 100px child).
  const charScale = (y) => (L.cellW / 190) * project(0, y).scale;

  function resize(cssW, cssH, dpr) {
    W = cssW;
    H = cssH;
    canvas.width = bg.width = Math.round(W * dpr);
    canvas.height = bg.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout();
    paintBackdrop(bgCtx);
  }

  function polyPath(c, pts) {
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.closePath();
  }

  function cellPoly(r) {
    return [
      project(r.x, r.y),
      project(r.x + r.w, r.y),
      project(r.x + r.w, r.y + r.h),
      project(r.x, r.y + r.h),
    ];
  }

  function tree(c, x, base, s) {
    c.fillStyle = "#6b4a2b";
    c.beginPath();
    c.roundRect(x - 6 * s, base - 70 * s, 12 * s, 70 * s, 4 * s);
    c.fill();
    const blobs = [
      [0, -92, 34, "#2b8a3e"],
      [-24, -74, 26, "#2f9e44"],
      [24, -76, 26, "#37b24d"],
      [0, -110, 24, "#40c057"],
    ];
    for (const [dx, dy, r, col] of blobs) {
      c.fillStyle = col;
      c.beginPath();
      c.arc(x + dx * s, base + dy * s, r * s, 0, Math.PI * 2);
      c.fill();
    }
  }

  function paintBackdrop(c) {
    // Sky
    const sky = c.createLinearGradient(0, 0, 0, H * 0.3);
    sky.addColorStop(0, "#74c0fc");
    sky.addColorStop(1, "#ffe8a3");
    c.fillStyle = sky;
    c.fillRect(0, 0, W, H);

    // Sun
    c.fillStyle = "rgba(255,244,180,0.9)";
    c.beginPath();
    c.arc(W * 0.82, H * 0.08, W * 0.07, 0, Math.PI * 2);
    c.fill();

    // Trees behind the wall
    const wallTop = L.wallBottom - H * 0.09;
    tree(c, W * 0.14, wallTop + 6, W / 300);
    tree(c, W * 0.86, wallTop + 6, W / 280);

    // Compound wall: painted concrete blocks with a cap
    const wallH = L.wallBottom - wallTop;
    c.fillStyle = "#f1d8a5";
    c.fillRect(0, wallTop, W, wallH);
    c.strokeStyle = "rgba(120,80,30,0.25)";
    c.lineWidth = 1;
    const bw = W / 8;
    for (let row = 0; row < 3; row++) {
      const y = wallTop + (wallH / 3) * row;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(W, y);
      c.stroke();
      for (let i = row % 2 ? -0.5 : 0; i < 9; i++) {
        c.beginPath();
        c.moveTo(i * bw, y);
        c.lineTo(i * bw, y + wallH / 3);
        c.stroke();
      }
    }
    c.fillStyle = "#c79a5b";
    c.fillRect(0, wallTop - 5, W, 7);
    // Painted stripe, Naija green-white-green
    c.fillStyle = "#2b8a3e";
    c.fillRect(0, wallTop + wallH - 7, W, 7);

    // Sandy compound ground
    const ground = c.createLinearGradient(0, L.wallBottom, 0, H);
    ground.addColorStop(0, "#d9b779");
    ground.addColorStop(1, "#e9cf99");
    c.fillStyle = ground;
    c.fillRect(0, L.wallBottom, W, H - L.wallBottom);
    // Sand speckles, fixed pattern
    c.fillStyle = "rgba(150,110,50,0.18)";
    for (let i = 0; i < 90; i++) {
      const px = (Math.abs(Math.sin(i * 91.7)) * W) | 0;
      const py = L.wallBottom + (Math.abs(Math.sin(i * 37.3)) * (H - L.wallBottom)) | 0;
      c.fillRect(px, py, 2, 1.5);
    }

    // Watching children, sitting along the foot of the wall
    const kids = [
      [0.07, 3, 0.5],
      [0.14, 1, 0.42],
      [0.86, 4, 0.42],
      [0.93, 2, 0.5],
    ];
    for (const [fx, si, sc] of kids) {
      drawCharacter(c, STOCK[si % STOCK.length].style, W * fx, L.wallBottom + H * 0.06, sc * (W / 390), {
        shadow: true,
      });
    }

    paintCourt(c);
  }

  function paintCourt(c) {
    const full = { x: 0, y: 0, w: COLS, h: ROWS };
    const outer = cellPoly(full);

    // Swept ground under the court
    polyPath(c, outer);
    c.fillStyle = "#e2c488";
    c.fill();

    // Faint alternating tint so squares read at a glance
    for (let n = 1; n <= 12; n++) {
      const { col, row } = squareToCell(n);
      polyPath(c, cellPoly(squareRect(n)));
      c.fillStyle = (col + row) % 2 ? "rgba(255,255,255,0.10)" : "rgba(120,80,30,0.07)";
      c.fill();
    }

    // Chalk lines
    c.lineCap = "round";
    c.strokeStyle = "rgba(255,255,255,0.95)";
    let k = 0;
    const seg = (x1, y1, x2, y2) => {
      const a = project(x1, y1);
      const b = project(x2, y2);
      c.lineWidth = Math.max(3, 0.1 * L.cellW * a.scale * 0.5);
      c.beginPath();
      c.moveTo(a.x + wobble(k++), a.y + wobble(k++));
      c.lineTo(b.x + wobble(k++), b.y + wobble(k++));
      c.stroke();
    };
    for (let i = 0; i <= ROWS; i++) seg(0, i, COLS, i);
    for (let i = 0; i <= COLS; i++) seg(i, 0, i, ROWS);

    // Numbers
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (let n = 1; n <= 12; n++) {
      const r = squareRect(n);
      const p = project(r.x + 0.5, r.y + 0.5);
      const size = L.cellW * 0.34 * p.scale;
      c.font = `800 ${size}px "Trebuchet MS", system-ui, sans-serif`;
      c.fillStyle = "rgba(255,255,255,0.9)";
      c.strokeStyle = "rgba(90,60,20,0.35)";
      c.lineWidth = size * 0.1;
      c.strokeText(String(n), p.x, p.y);
      c.fillText(String(n), p.x, p.y);
    }
  }

  // Screen px to court cell units (inverse of project).
  function unproject(sx, sy) {
    const f = (L.courtBottom - sy) / (L.courtBottom - L.courtTop);
    const t = (1.15 - Math.sqrt(Math.max(0, 1.3225 - 0.6 * f))) / 0.3;
    const scale = NEAR_SCALE + (FAR_SCALE - NEAR_SCALE) * f;
    return { x: (sx - L.cx) / (L.cellW * scale) + COLS / 2, y: t * ROWS };
  }

  // What a tap means: a square number, "start" (the ground below the court), or null.
  function hitSquare(sx, sy) {
    const { x, y } = unproject(sx, sy);
    if (x >= 0 && x < COLS && y >= 0 && y < ROWS) return cellToSquare(Math.floor(x), Math.floor(y));
    if (y < 0 && y > -2.5 && x > -0.5 && x < COLS + 0.5) return "start";
    return null;
  }

  function pulse(time) {
    return 0.5 + 0.5 * Math.sin(time / 280);
  }

  function drawHint(hint, time) {
    const k = pulse(time);
    if (hint === "start") {
      const pts = [project(0, -0.15), project(COLS, -0.15), project(COLS, -1.6), project(0, -1.6)];
      polyPath(ctx, pts);
      ctx.fillStyle = `rgba(255, 214, 10, ${0.18 + 0.15 * k})`;
      ctx.fill();
      ctx.setLineDash([10, 8]);
      ctx.strokeStyle = `rgba(255, 170, 0, ${0.6 + 0.4 * k})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.setLineDash([]);
      const c = project(COLS / 2, -1.25);
      ctx.font = `800 ${L.cellW * 0.17}px "Trebuchet MS", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(120,70,0,0.75)";
      ctx.fillText("HOME", c.x, c.y);
      return;
    }
    polyPath(ctx, cellPoly(squareRect(hint)));
    ctx.fillStyle = `rgba(255, 214, 10, ${0.25 + 0.2 * k})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 170, 0, ${0.6 + 0.4 * k})`;
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  function drawFlash(flash, time) {
    const age = (time - flash.t0) / flash.dur;
    if (age < 0 || age > 1) return;
    polyPath(ctx, cellPoly(squareRect(flash.square)));
    ctx.fillStyle = flash.color.replace("A", String(0.55 * (1 - age)));
    ctx.fill();
  }

  function drawStone(st) {
    const p = project(st.x, st.y);
    const r = L.cellW * 0.075 * p.scale;
    const h = st.h ?? 0;
    ctx.fillStyle = "rgba(40,25,10,0.3)";
    ctx.beginPath();
    ctx.ellipse(p.x + r * 0.2, p.y + r * 0.5, r * 1.1, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#6c757d";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y - h, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(p.x - r * 0.3, p.y - h - r * 0.3, r * 0.35, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Slingshot band, and a dotted line to where the stone would land.
  function drawAim(aim, time) {
    const from = project(aim.origin.x, aim.origin.y);
    ctx.strokeStyle = "rgba(90,50,10,0.8)";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(aim.fx, aim.fy);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath();
    ctx.arc(aim.fx, aim.fy, 12, 0, Math.PI * 2);
    ctx.fill();

    const to = project(aim.land.x, aim.land.y);
    ctx.setLineDash([2, 9]);
    ctx.strokeStyle = "rgba(60,30,0,0.85)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const r = L.cellW * 0.1 * to.scale * (1 + 0.1 * pulse(time));
    ctx.strokeStyle = "#e03131";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(to.x, to.y, r, r * 0.7, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(to.x - r * 0.5, to.y);
    ctx.lineTo(to.x + r * 0.5, to.y);
    ctx.moveTo(to.x, to.y - r * 0.35);
    ctx.lineTo(to.x, to.y + r * 0.35);
    ctx.stroke();
  }

  /**
   * view: {
   *   hint: square | "start" | null, stone: {x,y,h}|null, flash, aim,
   *   hero: { x, y, style, pose }   // court position, plus drawCharacter pose
   * }
   */
  function draw(view, time) {
    ctx.drawImage(bg, 0, 0, W, H);
    if (view.hint) drawHint(view.hint, time);
    if (view.flash) drawFlash(view.flash, time);
    if (view.stone) drawStone(view.stone);
    if (view.aim) drawAim(view.aim, time);
    const h = view.hero;
    const pos = project(h.x, h.y);
    const cs = charScale(Math.max(0, h.y));
    drawCharacter(ctx, h.style, pos.x, pos.y, cs, h.pose);
  }

  return { resize, draw, project, unproject, hitSquare };
}
