// Three.js scene: a real 3D Nigerian compound with a chalk Suwe court.
//
// World units are court cells: x runs across the court (centred on 0), z runs away from the
// player (court y = -z), and y is up. A perspective camera looks down the court from behind the
// throwing line. project()/unproject()/hitSquare() keep the names and meaning they have in
// scene-2d.js, so touch aiming and the HUD work unchanged.
//
//   - the ground and the court are 3D meshes; every colour comes from css/theme.css (js/theme.js)
//   - children are built from simple shapes from their start.ng style (see figure() below)
//   - the stone is a lit sphere that really flies through the air
//   - houses, hints, flashes and marks are decals lying on the court
//   - only the sling-shot aiming line is drawn flat on the screen (it follows the finger)
//   - setLayout() tells the camera where on the screen the court should sit (phone, desktop, menu)

import * as THREE from "../vendor/three.module.min.js";
import { COLS, ROWS, cellToSquare, squareRect, squareToCell } from "../engine/court.js";
import { normalizeStyle } from "./character.js";
import { readTheme, watchTheme } from "../theme.js";

const FONT = '"Baloo 2", "Trebuchet MS", system-ui, sans-serif';
const K = 0.0037; // world units per character unit (a 100-unit child is 0.37 of a cell tall)
const K_H = 0.0075; // the director's stone heights (screen px) to world units

const wx = (x) => x - COLS / 2;
const wz = (y) => -y;

// Shared geometry (never disposed).
const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 14);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const PLANE = new THREE.PlaneGeometry(1, 1);
const FRUSTUM = new THREE.CylinderGeometry(13, 18, 1, 16);
const CONE = new THREE.ConeGeometry(1, 1, 8);
const TORUS = new THREE.TorusGeometry(1, 0.22, 8, 20);
// Hair: the crown of the head, and a shell round the back that leaves the face (at -z) open.
const HAIR_TOP = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, 1.15);
const HAIR_BACK = new THREE.SphereGeometry(1, 20, 14, (3 * Math.PI) / 2 + 1.05, Math.PI * 2 - 2.1, 0, 2.15);
const HAT_TOP = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);

// The stone is a warm grey: the ink colour mixed halfway to the chalk.
const stoneColor = (theme) => new THREE.Color(theme.ink).lerp(new THREE.Color(theme.chalk), 0.5);

const shade = (hex, amt) => {
  const c = new THREE.Color(hex);
  const f = amt / 255;
  c.r = Math.max(0, Math.min(1, c.r + f));
  c.g = Math.max(0, Math.min(1, c.g + f));
  c.b = Math.max(0, Math.min(1, c.b + f));
  return c;
};

// ---------------------------------------------------------------------------------------------
// Children
// ---------------------------------------------------------------------------------------------

// A child, built from shapes. Local axes: +x is the child's right, +y up, and the face is at -z,
// so with no rotation the child faces away from the camera, up the court. Everything inside
// `unit` is in character units (100 = a child's height) and scaled by K.
function figure(style, theme) {
  const st = normalizeStyle(style);
  const female = st.body === "female";
  const mats = [];
  const lambert = (color, opts = {}) => {
    const m = new THREE.MeshLambertMaterial({ color, ...opts });
    mats.push(m);
    return m;
  };
  const skin = lambert(st.skinColor);
  const skinDark = lambert(shade(st.skinColor, -28));
  const shirt = lambert(st.primaryColor);
  const under = lambert(st.secondaryColor);
  const hair = lambert(st.hairColor, { side: THREE.DoubleSide });
  const shoe = lambert(theme.chalk);
  const dark = new THREE.MeshBasicMaterial({ color: theme.ink });
  mats.push(dark);
  const stoneMat = lambert(stoneColor(theme));
  const sashMat = lambert("#ffffff");

  const root = new THREE.Group(); // position on the court, tilt
  const turn = new THREE.Group(); // which way the child faces
  const body = new THREE.Group(); // lifts off the ground when hopping
  const unit = new THREE.Group(); // character units
  unit.scale.setScalar(K);
  root.add(turn);
  turn.add(body);
  body.add(unit);

  const add = (geo, mat, x, y, z, sx, sy, sz, parent = unit) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  };

  // A round-ended limb between two points (re-aimed every frame).
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const limb = (mat, r) => {
    const cyl = add(CYL, mat, 0, 0, 0, r, 1, r);
    const a = add(SPHERE, mat, 0, 0, 0, r, r, r);
    const b = add(SPHERE, mat, 0, 0, 0, r, r, r);
    return (p, q) => {
      dir.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      const len = Math.max(0.001, dir.length());
      cyl.position.set((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2);
      cyl.scale.set(r, len, r);
      cyl.quaternion.setFromUnitVectors(up, dir.divideScalar(len));
      a.position.set(p[0], p[1], p[2]);
      b.position.set(q[0], q[1], q[2]);
    };
  };
  const legL = limb(skin, 4.6);
  const legR = limb(skin, 4.6);
  const legR2 = limb(skin, 4.6); // the raised leg's lower part
  const armL = limb(skin, 3.6);
  const armR = limb(skin, 3.6);

  const shoeL = add(SPHERE, shoe, -7, 2, -1.5, 6, 3.4, 8.5);
  const shoeR = add(SPHERE, shoe, 7, 2, -1.5, 6, 3.4, 8.5);

  const garment = female ? add(FRUSTUM, under, 0, 48, 0, 1, 28, 0.72) : add(BOX, under, 0, 45, 0, 24, 26, 16);
  const torso = add(CYL, shirt, 0, 65, 0, 15, 30, 9.5);
  const sash = add(BOX, sashMat, 0, 65, 0, 7, 30, 20.5);
  sash.rotation.z = -0.78;
  sash.visible = false;
  const neck = add(CYL, skinDark, 0, 80, 0, 3, 8, 3);

  // Things that ride on the upper body (so they dip with the bob): [mesh, base y].
  const riders = [];
  const ride = (m) => {
    riders.push([m, m.position.y]);
    return m;
  };

  const head = new THREE.Group();
  unit.add(head);
  add(SPHERE, skin, 0, 0, 0, 13, 14, 12.5, head);
  // Face (at -z)
  add(SPHERE, dark, -5, -1, -11.2, 1.9, 2.5, 1.2, head);
  add(SPHERE, dark, 5, -1, -11.2, 1.9, 2.5, 1.2, head);
  add(BOX, dark, 0, -6, -11.6, 6, 1.4, 1, head);

  switch (st.hair) {
    case "bald":
      break;
    case "afro":
      add(SPHERE, hair, 0, 4, 2, 19, 17, 17, head);
      break;
    default:
      add(HAIR_TOP, hair, 0, 1, 0, 13.8, 15.2, 13.2, head);
      add(HAIR_BACK, hair, 0, 1, 0, 13.8, 14.6, 13.2, head);
      if (st.hair === "braids") {
        for (const dx of [-12, -7, 7, 12]) add(CYL, hair, dx, -9, 2, 1.7, 22, 1.7, head);
      } else if (st.hair === "dreads") {
        for (const dx of [-13, -9, -4, 4, 9, 13]) add(CYL, hair, dx, -6, 3, 1.8, 18, 1.8, head);
      } else if (st.hair === "bun") {
        add(SPHERE, hair, 0, 16, 2, 6.5, 6.5, 6.5, head);
      } else if (st.hair === "ponytail") {
        const tail = add(CYL, hair, 0, -2, 18, 2.6, 22, 2.6, head);
        tail.rotation.x = 1.0;
      }
  }

  switch (st.hat) {
    case "cap":
      add(HAT_TOP, lambert(st.primaryColor), 0, 4, 0, 14.5, 11, 14, head);
      add(BOX, lambert(shade(st.primaryColor, -25)), 0, 5, -16, 20, 2.4, 14, head);
      break;
    case "beanie": {
      const band = lambert(shade(st.secondaryColor, 30));
      add(HAT_TOP, lambert(st.secondaryColor), 0, 3, 0, 14.6, 13, 14.2, head);
      add(CYL, band, 0, 3, 0, 14.9, 5, 14.5, head);
      add(SPHERE, band, 0, 17, 0, 3.4, 3.4, 3.4, head);
      break;
    }
    case "tophat": {
      const black = lambert("#212529");
      add(CYL, black, 0, 12, 0, 18, 3, 18, head);
      add(CYL, black, 0, 24, 0, 10.5, 24, 10.5, head);
      add(CYL, lambert(st.primaryColor), 0, 17, 0, 10.8, 4, 10.8, head);
      break;
    }
    case "crown": {
      const gold = lambert("#fcc419");
      add(CYL, gold, 0, 13, 0, 11.5, 6, 11, head);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(CONE, gold, Math.sin(a) * 10, 21, Math.cos(a) * 9.5, 3.2, 9, 3.2, head);
      }
      break;
    }
  }

  if (st.accessory === "glasses") {
    const g = lambert("#212529");
    for (const dx of [-5, 5]) add(TORUS, g, dx, -1, -11.6, 4.2, 4.2, 4.2, head);
  } else if (st.accessory === "beard") {
    add(SPHERE, hair, 0, -6, -4, 12.5, 9, 9.5, head);
  } else if (st.accessory === "earrings") {
    const gold = lambert("#ffd43b");
    add(SPHERE, gold, -13, -5, 0, 2.4, 2.4, 2.4, head);
    add(SPHERE, gold, 13, -5, 0, 2.4, 2.4, 2.4, head);
  } else if (st.accessory === "scarf") {
    const sc = lambert("#f08c00");
    ride(add(TORUS, sc, 0, 80, 0, 11, 11, 11)).rotation.x = Math.PI / 2;
    ride(add(BOX, sc, 7, 70, -9, 6, 15, 3));
  } else if (st.accessory === "backpack") {
    ride(add(BOX, lambert(shade(st.secondaryColor, -15)), 0, 64, 12.5, 24, 24, 9));
    ride(add(BOX, lambert(shade(st.secondaryColor, 25)), 0, 62, 17.2, 16, 3, 1.4));
  }

  const heldStone = add(SPHERE, stoneMat, 0, 0, 0, 5, 4, 5);

  // Ground marks (stay on the ground when the child hops or tips over).
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 20),
    new THREE.MeshBasicMaterial({ color: theme.ink, transparent: true, opacity: 0.28, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.014;
  shadow.renderOrder = 6;
  mats.push(shadow.material);
  root.add(shadow);
  // The ring under the feet, in the player's colour: filled at 30% with a thin outline.
  const ringMat = new THREE.MeshBasicMaterial({ color: theme.chalk, side: THREE.DoubleSide, depthWrite: false });
  const ringFillMat = new THREE.MeshBasicMaterial({ color: theme.chalk, transparent: true, opacity: 0.3, depthWrite: false });
  mats.push(ringMat, ringFillMat);
  const ring = new THREE.Group();
  const ringLine = new THREE.Mesh(new THREE.RingGeometry(0.945, 1, 40), ringMat);
  const ringFill = new THREE.Mesh(new THREE.CircleGeometry(0.945, 40), ringFillMat);
  ringLine.rotation.x = ringFill.rotation.x = -Math.PI / 2;
  ringLine.position.y = 0.0165;
  ringFill.position.y = 0.0155;
  ringLine.renderOrder = 8;
  ringFill.renderOrder = 7;
  ring.add(ringFill, ringLine);
  ring.scale.set(0.27, 1, 0.27 * 0.8);
  root.add(ring);

  // pose as in the 2D version: {back, facing, bob, lift, oneLeg, shadow, bend, tilt, hold}
  function apply(pose = {}, spec = {}) {
    const { back = false, facing = 1, bob: bob0 = 0, lift = 0, oneLeg = false, bend = 0, tilt = 0, hold = false } = pose;
    const bob = bob0 + bend * 14;
    const dy = -bob; // the 2D version had y pointing down

    // Which way the child faces: 0 = away from the camera, PI = towards it. `facing` is the
    // cosine of the turn while the child spins round (the 2D version squashed sideways).
    const a = Math.acos(Math.max(-1, Math.min(1, facing)));
    turn.rotation.y = back ? a : Math.PI - a;
    root.rotation.z = -tilt;
    body.position.y = lift * K;
    shadow.visible = pose.shadow !== false;
    const sh = 0.2 - lift * 0.0004;
    shadow.scale.set(sh, sh * 0.62, 1);

    legL([-7, 40, 0], [-7, 4 + dy * 0.2, 0]);
    shoeL.position.y = 2 + dy * 0.2;
    if (oneLeg) {
      legR([7, 40, 0], [13, 22, 3]);
      legR2([13, 22, 3], [4, 17, 6]);
      shoeR.position.set(4, 16, 6);
      shoeR.scale.set(5, 3, 7);
    } else {
      legR([7, 40, 0], [7, 4 + dy * 0.2, 0]);
      legR2([7, 4, 0], [7, 4, 0]);
      shoeR.position.set(7, 2 + dy * 0.2, -1.5);
      shoeR.scale.set(6, 3.4, 8.5);
    }

    const armSwing = oneLeg ? 10 : 0;
    const handX = 24 - bend * 6;
    const handY = (54 - bob + armSwing) * (1 - bend) + 8 * bend;
    armL([-14, 74 + dy, 0], [-24, 54 + dy + armSwing * 0.3, 0]);
    armR([14, 74 + dy, 0], [handX, handY, 0]);
    heldStone.visible = hold;
    heldStone.position.set(handX, handY, -2);

    garment.position.y = (female ? 48 : 45) + dy * 0.5;
    torso.position.y = 65 + dy;
    neck.position.y = 80 + dy;
    head.position.set(0, 94 + dy, 0);
    sash.position.y = 65 + dy;
    const sashColor = spec.sash ?? null;
    sash.visible = !!sashColor;
    if (sashColor) sashMat.color.set(sashColor);
    for (const [m, y] of riders) m.position.y = y + dy;

    const ringColor = spec.ring ?? null;
    ring.visible = !!ringColor;
    if (ringColor) {
      ringMat.color.set(ringColor);
      ringFillMat.color.set(ringColor);
    }
  }
  apply();

  return {
    root,
    apply,
    dispose() {
      for (const m of mats) m.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------------------------

// Canvas colours: a theme hex with an alpha.
const css = (hex, a) => {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

export function createScene(canvas) {
  // Throws if WebGL is unavailable; main.js then falls back to scene-2d.js.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;

  let theme = readTheme();
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 90);

  world.add(new THREE.AmbientLight(0xffffff, 2.35));
  const sun = new THREE.DirectionalLight(0xfff0cc, 1.45);
  sun.position.set(-3, 8, 4);
  world.add(sun);

  const canvasTex = (cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  };
  const makeCanvas = (w, h) => {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    return cv;
  };
  const basic = (opts) => new THREE.MeshBasicMaterial({ depthWrite: false, ...opts });

  // --- ground: swept sand with speckles (colours from the theme) ---
  const groundTex = (() => {
    const t = new THREE.CanvasTexture(makeCanvas(256, 256));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(26, 18);
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  })();
  function paintGround() {
    const cv = groundTex.image;
    const c = cv.getContext("2d");
    c.fillStyle = theme.bg;
    c.fillRect(0, 0, 256, 256);
    c.fillStyle = css(theme.soft, 0.16);
    for (let i = 0; i < 160; i++) {
      c.fillRect((Math.abs(Math.sin(i * 91.7)) * 256) | 0, (Math.abs(Math.sin(i * 37.3)) * 256) | 0, 3, 2);
    }
    c.fillStyle = css(theme.chalk, 0.18);
    for (let i = 0; i < 90; i++) {
      c.fillRect((Math.abs(Math.sin(i * 51.3)) * 256) | 0, (Math.abs(Math.sin(i * 73.1)) * 256) | 0, 2, 2);
    }
    groundTex.needsUpdate = true;
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 160), new THREE.MeshBasicMaterial({ map: groundTex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -10);
  world.add(ground);

  // --- the court ---
  const courtGroup = new THREE.Group();
  world.add(courtGroup);
  const flatQuad = (parent, x, y, w, h, mat, lift, order) => {
    const m = new THREE.Mesh(PLANE, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(wx(x + w / 2), lift, wz(y + h / 2));
    m.scale.set(w, h, 1);
    m.renderOrder = order;
    parent.add(m);
    return m;
  };
  const courtMat = basic({ color: theme.court });
  flatQuad(courtGroup, 0, 0, COLS, ROWS, courtMat, 0.004, 1);
  const tintMats = [];
  for (let n = 1; n <= 12; n++) {
    const { col, row } = squareToCell(n);
    const r = squareRect(n);
    const light = (col + row) % 2;
    const mat = basic({ color: light ? theme.chalk : theme.soft, transparent: true, opacity: light ? 0.1 : 0.08 });
    mat.userData.light = Boolean(light);
    tintMats.push(mat);
    flatQuad(courtGroup, r.x, r.y, r.w, r.h, mat, 0.006, 2);
  }
  // Chalk lines: slightly wobbly strips, deterministic so the picture is the same every time.
  const chalkMat = basic({ color: theme.chalk });
  {
    const wob = (i) => Math.sin(i * 12.9898) * 0.012;
    let k = 0;
    const strip = (x1, y1, x2, y2) => {
      const len = Math.hypot(x2 - x1, y2 - y1) + 0.08;
      const m = new THREE.Mesh(PLANE, chalkMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = y2 === y1 ? 0 : Math.PI / 2; // horizontal lines run along x, vertical along z
      m.position.set(wx((x1 + x2) / 2) + wob(k++), 0.009, wz((y1 + y2) / 2) + wob(k++));
      m.scale.set(len, 0.085, 1);
      m.renderOrder = 3;
      courtGroup.add(m);
    };
    for (let i = 0; i <= ROWS; i++) strip(0, i, COLS, i);
    for (let i = 0; i <= COLS; i++) strip(i, 0, i, ROWS);
  }
  // The numbers are drawn on the ground; rebuilt on resize (the font may load late) and on a theme change.
  const numbers = [];
  function buildNumbers() {
    for (const m of numbers) {
      courtGroup.remove(m);
      m.material.map.dispose();
      m.material.dispose();
    }
    numbers.length = 0;
    for (let n = 1; n <= 12; n++) {
      const cv = makeCanvas(160, 160);
      const c = cv.getContext("2d");
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.font = `800 118px ${FONT}`;
      c.lineJoin = "round";
      c.strokeStyle = css(theme.ink, 0.3);
      c.lineWidth = 12;
      c.strokeText(String(n), 80, 84);
      c.fillStyle = css(theme.chalk, 0.95);
      c.fillText(String(n), 80, 84);
      const r = squareRect(n);
      numbers.push(flatQuad(courtGroup, r.x + 0.2, r.y + 0.2, 0.6, 0.6, basic({ map: canvasTex(cv), transparent: true }), 0.011, 4));
    }
  }

  // --- decals lying on the court: houses, hints, flashes, the mark ---
  const decalGroup = new THREE.Group();
  world.add(decalGroup);
  const makePool = () => {
    const items = [];
    let used = 0;
    return {
      begin() {
        used = 0;
      },
      next() {
        if (used === items.length) {
          const m = new THREE.Mesh(PLANE, basic({ transparent: true }));
          m.rotation.x = -Math.PI / 2;
          decalGroup.add(m);
          items.push(m);
        }
        const m = items[used++];
        m.visible = true;
        return m;
      },
      end() {
        for (let i = used; i < items.length; i++) items[i].visible = false;
      },
    };
  };
  const quadPool = makePool();
  const labelPool = makePool();
  const quad = (x, y, w, h, color, opacity, lift, order) => {
    const m = quadPool.next();
    m.position.set(wx(x + w / 2), lift, wz(y + h / 2));
    m.scale.set(w, h, 1);
    m.material.color.set(color);
    m.material.opacity = opacity;
    m.renderOrder = order;
  };
  const outline = (r, color, opacity, t, lift, order) => {
    quad(r.x - t, r.y - t, r.w + 2 * t, t, color, opacity, lift, order);
    quad(r.x - t, r.y + r.h, r.w + 2 * t, t, color, opacity, lift, order);
    quad(r.x - t, r.y, t, r.h, color, opacity, lift, order);
    quad(r.x + r.w, r.y, t, r.h, color, opacity, lift, order);
  };
  const labelCache = new Map();
  const label = (key, w, h, paint) => {
    let t = labelCache.get(key);
    if (!t) {
      const cv = makeCanvas(w, h);
      paint(cv.getContext("2d"), w, h);
      t = canvasTex(cv);
      labelCache.set(key, t);
    }
    return t;
  };
  const putLabel = (tex, x, y, w, h, lift, order) => {
    const m = labelPool.next();
    if (m.material.map !== tex) {
      m.material.map = tex;
      m.material.needsUpdate = true;
    }
    m.material.color.set("#ffffff");
    m.material.opacity = 1;
    m.position.set(wx(x + w / 2), lift, wz(y + h / 2));
    m.scale.set(w, h, 1);
    m.renderOrder = order;
  };
  const pulse = (time) => 0.5 + 0.5 * Math.sin(time / 280);

  function drawHint(hint, time) {
    const k = pulse(time);
    if (hint === "start") {
      const r = { x: 0, y: -1.6, w: COLS, h: 1.45 };
      quad(r.x, r.y, r.w, r.h, theme.accent, 0.18 + 0.15 * k, 0.012, 5);
      outline(r, theme.accent, 0.6 + 0.4 * k, 0.05, 0.013, 5);
      const tex = label("home", 256, 96, (c, w, h) => {
        c.font = `800 64px ${FONT}`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillStyle = css(theme.ink, 0.7);
        c.fillText("HOME", w / 2, h / 2);
      });
      putLabel(tex, 0.5, -1.55, 1, 0.375, 0.014, 5);
      return;
    }
    const r = squareRect(hint);
    quad(r.x, r.y, r.w, r.h, theme.accent, 0.28 + 0.22 * k, 0.012, 5);
    outline(r, theme.accent, 0.7 + 0.3 * k, 0.045, 0.013, 5);
  }

  function drawHouses(houses) {
    for (const h of houses) {
      const r = squareRect(h.square);
      quad(r.x, r.y, r.w, r.h, h.color, 0.33, 0.012, 5);
      outline(r, h.color, 1, 0.04, 0.013, 5);
      const tex = label(`house:${h.name}:${h.color}`, 256, 256, (c, w, hh) => {
        // A little house in the corner (so the number stays readable) and the owner's name.
        const gx = 0.16 * w;
        const gy = (1 - 0.8) * hh;
        const u = 12;
        c.fillStyle = h.color;
        c.beginPath();
        c.moveTo(gx - u * 1.3, gy);
        c.lineTo(gx, gy - u * 1.5);
        c.lineTo(gx + u * 1.3, gy);
        c.closePath();
        c.fill();
        c.fillRect(gx - u * 0.9, gy, u * 1.8, u * 1.3);
        c.font = `800 34px ${FONT}`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.lineJoin = "round";
        c.lineWidth = 9;
        c.strokeStyle = css(theme.chalk, 0.95);
        c.strokeText(h.name, w / 2, (1 - 0.2) * hh);
        c.fillStyle = h.color;
        c.fillText(h.name, w / 2, (1 - 0.2) * hh);
      });
      putLabel(tex, r.x, r.y, r.w, r.h, 0.014, 5);
    }
  }

  // The red mark to throw at in a tie-break.
  function drawMark(m, time) {
    const tex = label("mark", 128, 128, (c) => {
      c.strokeStyle = theme.danger;
      c.lineWidth = 10;
      c.beginPath();
      c.arc(64, 64, 44, 0, Math.PI * 2);
      c.moveTo(34, 34);
      c.lineTo(94, 94);
      c.moveTo(94, 34);
      c.lineTo(34, 94);
      c.stroke();
    });
    const s = 0.38 * (1 + 0.08 * pulse(time));
    putLabel(tex, m.x - s / 2, m.y - s / 2, s, s, 0.015, 6);
  }

  // flash: {square, hit, t0, dur}: green for a good throw, red for a miss.
  function drawFlash(flash, time) {
    const age = (time - flash.t0) / flash.dur;
    if (age < 0 || age > 1) return;
    const r = squareRect(flash.square);
    quad(r.x, r.y, r.w, r.h, flash.hit ? theme.accent : theme.danger, 0.55 * (1 - age), 0.016, 6);
  }

  // --- the stone ---
  const stoneMat = new THREE.MeshLambertMaterial({ color: stoneColor(theme) });
  const stone = new THREE.Mesh(SPHERE, stoneMat);
  stone.scale.set(0.085, 0.07, 0.085);
  stone.visible = false;
  world.add(stone);
  const stoneShadowMat = basic({ color: theme.ink, transparent: true, opacity: 0.3 });
  const stoneShadow = new THREE.Mesh(new THREE.CircleGeometry(1, 20), stoneShadowMat);
  stoneShadow.rotation.x = -Math.PI / 2;
  stoneShadow.renderOrder = 6;
  stoneShadow.visible = false;
  world.add(stoneShadow);

  // --- children on the court: slot 0 is the hero, then the waiting players ---
  const slots = [];
  function childAt(i, style) {
    const key = JSON.stringify(normalizeStyle(style));
    let s = slots[i];
    if (!s || s.key !== key) {
      if (s) {
        world.remove(s.fig.root);
        s.fig.dispose();
      }
      s = { key, fig: figure(style, theme) };
      world.add(s.fig.root);
      slots[i] = s;
    }
    return s.fig;
  }

  // --- theme: repaint everything that takes its colour from css/theme.css ---
  function applyTheme(next) {
    theme = next;
    paintGround();
    courtMat.color.set(theme.court);
    chalkMat.color.set(theme.chalk);
    for (const m of tintMats) m.color.set(m.userData.light ? theme.chalk : theme.soft);
    stoneMat.color.copy(stoneColor(theme));
    stoneShadowMat.color.set(theme.ink);
    for (const t of labelCache.values()) t.dispose();
    labelCache.clear();
    // Children are rebuilt with the new shoes, eyes and shadows on the next frame.
    slots.forEach((s) => {
      if (!s) return;
      world.remove(s.fig.root);
      s.fig.dispose();
    });
    slots.length = 0;
    buildNumbers();
  }
  paintGround();
  watchTheme(applyTheme);

  // --- the camera ---
  let W = 1;
  let H = 1;
  let pitch = (31 * Math.PI) / 180; // how far the camera looks down (the layout can change it)
  const TARGET = new THREE.Vector3(0, 0, -ROWS / 2 + 0.4);
  const v3 = new THREE.Vector3();
  // Where on the screen the court sits (set by main.js for each screen and window size):
  // the y of its near and far edge, the x of its middle, the widest a cell may be, and the camera tilt (degrees).
  let layout = null;

  function aim(dist) {
    camera.clearViewOffset();
    camera.position.set(TARGET.x, TARGET.y + Math.sin(pitch) * dist, TARGET.z + Math.cos(pitch) * dist);
    camera.lookAt(TARGET);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }
  const screenOf = (x, y, z) => {
    v3.set(x, y, z).project(camera);
    return { x: ((v3.x + 1) / 2) * W, y: ((1 - v3.y) / 2) * H };
  };
  function fitCamera() {
    camera.aspect = W / H;
    const L = layout ?? { nearY: H * 0.7, farY: H * 0.25, cx: W / 2, maxCell: Math.min(W * 0.45, H * 0.2) };
    pitch = ((L.pitch ?? 31) * Math.PI) / 180;
    const wantSpan = L.nearY - L.farY;
    const maxCell = L.maxCell ?? Math.min((W * 0.8) / COLS, H * 0.2);
    const tooBig = (d) => {
      aim(d);
      const span = screenOf(0, 0, 0).y - screenOf(0, 0, -ROWS).y;
      const cell = screenOf(1, 0, 0).x - screenOf(0, 0, 0).x;
      return span > wantSpan || cell > maxCell;
    };
    let lo = 3;
    let hi = 80;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (tooBig(mid)) lo = mid;
      else hi = mid;
    }
    aim(hi);
    const nearY = screenOf(0, 0, 0).y;
    const midX = screenOf(0, 0, -ROWS / 2).x;
    camera.setViewOffset(W, H, midX - L.cx, nearY - L.nearY, W, H);
    camera.updateMatrixWorld();
  }

  // --- screen overlay, only for the sling-shot line ---
  const overlayScene = new THREE.Scene();
  const overlayCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  const overlayCv = makeCanvas(2, 2);
  const octx = overlayCv.getContext("2d");
  const overlayTex = canvasTex(overlayCv);
  overlayTex.minFilter = THREE.LinearFilter;
  overlayTex.generateMipmaps = false;
  const overlayMesh = new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({ map: overlayTex, transparent: true, depthTest: false, depthWrite: false }));
  overlayScene.add(overlayMesh);

  function resize(cssW, cssH, ratio) {
    W = cssW;
    H = cssH;
    const dpr = Math.min(ratio, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    overlayCv.width = Math.round(W * dpr);
    overlayCv.height = Math.round(H * dpr);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    overlayTex.dispose();
    overlayCam.left = 0;
    overlayCam.right = W;
    overlayCam.top = H;
    overlayCam.bottom = 0;
    overlayCam.updateProjectionMatrix();
    overlayMesh.scale.set(W, H, 1);
    overlayMesh.position.set(W / 2, H / 2, 0);
    fitCamera();
    buildNumbers();
  }

  // layout: {nearY, farY, cx, maxCell?}; ground: show the 3D ground (off on the menu, where the page paints a hill)
  function setLayout(next, opts = {}) {
    layout = next;
    if (opts.ground !== undefined) ground.visible = opts.ground;
    if (W > 1) fitCamera();
  }

  // Court (x,y in cell units) to screen px; `scale` is the px width of one cell there.
  function project(x, y) {
    const p = screenOf(wx(x), 0, wz(y));
    const q = screenOf(wx(x + 1), 0, wz(y));
    return { x: p.x, y: p.y, scale: Math.abs(q.x - p.x) };
  }

  // Screen px to court cell units, on the ground.
  function unproject(sx, sy) {
    v3.set((sx / W) * 2 - 1, 1 - (sy / H) * 2, 0.5).unproject(camera);
    const o = camera.position;
    const d = v3.sub(o);
    if (d.y >= -1e-6) return { x: 0, y: 1e3 }; // above the horizon
    const t = -o.y / d.y;
    return { x: o.x + d.x * t + COLS / 2, y: -(o.z + d.z * t) };
  }

  // What a tap means: a square number, "start" (the ground below the court), or null.
  function hitSquare(sx, sy) {
    const { x, y } = unproject(sx, sy);
    if (x >= 0 && x < COLS && y >= 0 && y < ROWS) return cellToSquare(Math.floor(x), Math.floor(y));
    if (y < 0 && y > -2.5 && x > -0.5 && x < COLS + 0.5) return "start";
    return null;
  }

  // While the stone is held: a halo on the stone, the red glowing band to the finger, faint arcs at the
  // two ends of the sway, the red dotted arc to the red landing circle, and the circle itself.
  function arcPoints(from, to, n = 24) {
    const lift = Math.min(160, 40 + Math.hypot(to.x - from.x, to.y - from.y) * 0.45);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t - Math.sin(Math.PI * t) * lift });
    }
    return pts;
  }
  function drawHold(h, time) {
    const c = octx;
    const from = project(h.origin.x, h.origin.y);
    c.lineCap = "round";
    c.lineJoin = "round";

    // The stone's halo (its touch area is at least 64 px wide).
    c.strokeStyle = "rgba(255,255,255,0.95)";
    c.lineWidth = 4;
    c.beginPath();
    c.arc(from.x, from.y - 4, 28, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = "rgba(255,255,255,0.35)";
    c.lineWidth = 12;
    c.beginPath();
    c.arc(from.x, from.y - 4, 34, 0, Math.PI * 2);
    c.stroke();

    // The two ends of the sway, faintly.
    for (const g of h.ghosts ?? []) {
      const to = project(g.x, g.y);
      c.setLineDash([2, 10]);
      c.strokeStyle = css(theme.chalk, 0.5);
      c.lineWidth = 3;
      c.beginPath();
      arcPoints(from, to).forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      c.stroke();
    }
    c.setLineDash([]);

    // The elastic band: a red glowing band from the stone to the finger.
    if (h.finger) {
      c.save();
      c.shadowColor = theme.danger;
      c.shadowBlur = 16;
      c.strokeStyle = theme.danger;
      c.lineWidth = 7;
      c.beginPath();
      c.moveTo(from.x - 11, from.y - 6);
      c.lineTo(h.finger.x, h.finger.y);
      c.moveTo(from.x + 11, from.y - 6);
      c.lineTo(h.finger.x, h.finger.y);
      c.stroke();
      c.restore();
      c.fillStyle = "#fff";
      c.beginPath();
      c.arc(h.finger.x, h.finger.y, 16, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "rgba(255,255,255,0.5)";
      c.lineWidth = 4;
      c.beginPath();
      c.arc(h.finger.x, h.finger.y, 30, 0, Math.PI * 2);
      c.stroke();
    }

    if (!h.land) return;
    const to = project(h.land.x, h.land.y);

    // The red glowing dotted arc to the landing circle.
    c.save();
    c.shadowColor = theme.danger;
    c.shadowBlur = 14;
    c.setLineDash([2, 12]);
    c.strokeStyle = theme.danger;
    c.lineWidth = 6;
    c.beginPath();
    arcPoints(from, to).forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.stroke();
    c.restore();

    // The red landing circle.
    const rx = to.scale * 0.17 * (1 + 0.05 * Math.sin(time / 120));
    const ry = rx * 0.78;
    c.save();
    c.shadowColor = theme.danger;
    c.shadowBlur = 18;
    c.fillStyle = theme.danger;
    c.beginPath();
    c.ellipse(to.x, to.y, rx, ry, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
    c.strokeStyle = "#fff";
    c.lineWidth = 4;
    c.beginPath();
    c.ellipse(to.x, to.y, rx, ry, 0, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = "#fff";
    c.beginPath();
    c.arc(to.x, to.y, 4, 0, Math.PI * 2);
    c.fill();
  }

  /**
   * view: {
   *   hint: square | "start" | null, stone: {x,y,h}|null, flash, hold, houses, mark, cleared, redLine,
   *   hero: { x, y, style, pose }   // court position, plus the pose (see character.js)
   * }
   */
  function draw(view, time) {
    quadPool.begin();
    labelPool.begin();
    if (view.houses) drawHouses(view.houses);
    if (view.hint) drawHint(view.hint, time);
    if (view.mark) drawMark(view.mark, time);
    if (view.flash) drawFlash(view.flash, time);
    // The squares the player on the court has cleared, tinted in their colour.
    if (view.cleared) for (const n of view.cleared.squares) {
      const r = squareRect(n);
      quad(r.x, r.y, r.w, r.h, view.cleared.color, 0.42, 0.007, 3);
    }
    // The chalk line that was touched, in red.
    if (view.redLine) quad(-0.03, view.redLine.y - 0.05, COLS + 0.06, 0.1, theme.danger, 1, 0.02, 7);
    quadPool.end();
    labelPool.end();

    const st = view.stone;
    stone.visible = stoneShadow.visible = !!st;
    if (st) {
      const h = (st.h ?? 0) * K_H;
      stone.position.set(wx(st.x), 0.06 + h, wz(st.y));
      stoneShadow.position.set(wx(st.x) + 0.02, 0.018, wz(st.y) + 0.01);
      const s = 0.085 * (1 - Math.min(0.5, h * 0.35));
      stoneShadow.scale.set(s * 1.15, s * 0.7, 1);
    }

    const waiting = view.waiting ?? [];
    waiting.forEach((w, i) => {
      const f = childAt(i + 1, w.style);
      f.root.visible = true;
      f.root.position.set(wx(w.x), 0, wz(w.y));
      f.apply({ back: true, bob: Math.sin(time / 500) }, { ring: w.color, sash: w.sash ? w.color : null });
    });
    for (let i = waiting.length + 1; i < slots.length; i++) if (slots[i]) slots[i].fig.root.visible = false;

    const h = view.hero;
    const hero = childAt(0, h.style);
    hero.root.position.set(wx(h.x), 0, wz(h.y));
    hero.apply(h.pose, { ring: h.color, sash: h.sash ? h.color : null });

    renderer.clear();
    renderer.render(world, camera);
    if (view.hold) {
      octx.clearRect(0, 0, W, H);
      drawHold(view.hold, time);
      overlayTex.needsUpdate = true;
      renderer.clearDepth();
      renderer.render(overlayScene, overlayCam);
    }
  }

  return { resize, draw, project, unproject, hitSquare, setLayout };
}
