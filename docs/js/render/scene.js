// Three.js scene: a real 3D Nigerian compound with a chalk Suwe court.
//
// World units are court cells: x runs across the court (centred on 0), z runs away from the
// player (court y = -z), and y is up. A perspective camera looks down the court from behind the
// throwing line. project()/unproject()/hitSquare() keep the names and meaning they have in
// scene-2d.js, so touch aiming and the HUD work unchanged.
//
//   - sky, sun, ground, compound wall, trees and the court are 3D meshes
//   - children are built from simple shapes from their start.ng style (see figure() below)
//   - the stone is a lit sphere that really flies through the air
//   - houses, hints, flashes and marks are decals lying on the court
//   - only the sling-shot aiming line is drawn flat on the screen (it follows the finger)

import * as THREE from "../vendor/three.module.min.js";
import { COLS, ROWS, cellToSquare, squareRect, squareToCell } from "../engine/court.js";
import { normalizeStyle, STOCK } from "./character.js";

const FONT = '"Baloo 2", "Trebuchet MS", system-ui, sans-serif';
const K = 0.0072; // world units per character unit (a 100-unit child is 0.72 of a cell tall)
const K_H = 0.0075; // the director's stone heights (screen px) to world units
const WALL_Z = -ROWS - 2.3;

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
function figure(style) {
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
  const shoe = lambert("#f1f3f5");
  const dark = new THREE.MeshBasicMaterial({ color: "#1b1209" });
  mats.push(dark);
  const stoneMat = lambert("#6c757d");
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
    new THREE.MeshBasicMaterial({ color: 0x281908, transparent: true, opacity: 0.28, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.014;
  shadow.renderOrder = 6;
  mats.push(shadow.material);
  root.add(shadow);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthWrite: false });
  mats.push(ringMat);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 28), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.016;
  ring.scale.set(0.27, 0.27 * 0.8, 1);
  ring.renderOrder = 7;
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
    if (ringColor) ringMat.color.set(ringColor);
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
// The scene
// ---------------------------------------------------------------------------------------------

export function createScene(canvas) {
  // Throws if WebGL is unavailable; main.js then falls back to scene-2d.js.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setClearColor(0xe9cf99, 1);
  renderer.autoClear = false;

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

  // --- sky, sun ---
  {
    const cv = makeCanvas(2, 256);
    const c = cv.getContext("2d");
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#74c0fc");
    g.addColorStop(0.55, "#bfe3f7");
    g.addColorStop(1, "#ffe8a3");
    c.fillStyle = g;
    c.fillRect(0, 0, 2, 256);
    world.background = canvasTex(cv);
    const sc = makeCanvas(128, 128);
    const s = sc.getContext("2d");
    const rg = s.createRadialGradient(64, 64, 8, 64, 64, 64);
    rg.addColorStop(0, "rgba(255,248,200,1)");
    rg.addColorStop(0.55, "rgba(255,244,180,0.9)");
    rg.addColorStop(1, "rgba(255,244,180,0)");
    s.fillStyle = rg;
    s.fillRect(0, 0, 128, 128);
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(sc), depthWrite: false, fog: false }));
    sunSprite.position.set(2.6, 6.2, WALL_Z - 10);
    sunSprite.scale.setScalar(9);
    sunSprite.renderOrder = -1;
    world.add(sunSprite);
  }

  // --- ground: swept sand with speckles ---
  {
    const cv = makeCanvas(256, 256);
    const c = cv.getContext("2d");
    c.fillStyle = "#dfc287";
    c.fillRect(0, 0, 256, 256);
    c.fillStyle = "rgba(150,110,50,0.20)";
    for (let i = 0; i < 160; i++) {
      c.fillRect((Math.abs(Math.sin(i * 91.7)) * 256) | 0, (Math.abs(Math.sin(i * 37.3)) * 256) | 0, 3, 2);
    }
    c.fillStyle = "rgba(255,240,200,0.18)";
    for (let i = 0; i < 90; i++) {
      c.fillRect((Math.abs(Math.sin(i * 51.3)) * 256) | 0, (Math.abs(Math.sin(i * 73.1)) * 256) | 0, 2, 2);
    }
    const tex = canvasTex(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(26, 18);
    // The compound floor stops at the wall...
    const depth = 14 - WALL_Z;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, depth), new THREE.MeshBasicMaterial({ map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, 14 - depth / 2);
    world.add(ground);
    // ...and beyond it is a strip of grass for the trees, then the sky.
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(120, 16), new THREE.MeshBasicMaterial({ color: "#8fcf72" }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(0, -0.01, WALL_Z - 8);
    world.add(grass);
  }

  // --- compound wall: painted blocks, a cap and a green stripe ---
  {
    const cv = makeCanvas(1024, 256);
    const c = cv.getContext("2d");
    c.fillStyle = "#f1d8a5";
    c.fillRect(0, 0, 1024, 256);
    c.strokeStyle = "rgba(120,80,30,0.28)";
    c.lineWidth = 3;
    const bw = 128;
    const rows = 3;
    for (let row = 0; row <= rows; row++) {
      const y = (256 / rows) * row;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(1024, y);
      c.stroke();
      for (let i = row % 2 ? -0.5 : 0; i < 9; i++) {
        c.beginPath();
        c.moveTo(i * bw, y);
        c.lineTo(i * bw, y + 256 / rows);
        c.stroke();
      }
    }
    c.fillStyle = "#2b8a3e";
    c.fillRect(0, 256 - 26, 1024, 26);
    const tex = canvasTex(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(5, 1);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(46, 1.05, 0.35), new THREE.MeshLambertMaterial({ map: tex }));
    wall.position.set(0, 0.525, WALL_Z);
    world.add(wall);
    const cap = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: "#c79a5b" }));
    cap.scale.set(46, 0.14, 0.62);
    cap.position.set(0, 1.12, WALL_Z);
    world.add(cap);
  }

  // --- trees behind the wall ---
  {
    const trunk = new THREE.MeshLambertMaterial({ color: "#6b4a2b" });
    const leaves = ["#2b8a3e", "#2f9e44", "#37b24d", "#40c057"].map((col) => new THREE.MeshLambertMaterial({ color: col }));
    const tree = (x, z, s) => {
      const g = new THREE.Group();
      const t = new THREE.Mesh(CYL, trunk);
      t.scale.set(0.2, 2.4, 0.2);
      t.position.y = 1.2;
      g.add(t);
      const blobs = [
        [0, 2.9, 0, 1.2, 0],
        [-0.9, 2.3, 0.1, 0.95, 1],
        [0.9, 2.35, 0.1, 0.95, 2],
        [0, 3.7, 0, 0.85, 3],
      ];
      for (const [dx, dy, dz, r, i] of blobs) {
        const b = new THREE.Mesh(SPHERE, leaves[i]);
        b.position.set(dx, dy, dz);
        b.scale.setScalar(r);
        g.add(b);
      }
      g.position.set(x, 0, z);
      g.scale.setScalar(s);
      world.add(g);
    };
    tree(-2.1, WALL_Z - 1.6, 1.0);
    tree(2.4, WALL_Z - 1.9, 0.9);
    tree(-4.6, WALL_Z - 2.6, 1.1);
    tree(5.0, WALL_Z - 3, 1.2);
    tree(-9, WALL_Z - 3, 1.2);
    tree(9.5, WALL_Z - 3.4, 1.3);
  }

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
  flatQuad(courtGroup, 0, 0, COLS, ROWS, basic({ color: "#e2c488" }), 0.004, 1);
  for (let n = 1; n <= 12; n++) {
    const { col, row } = squareToCell(n);
    const r = squareRect(n);
    const light = (col + row) % 2;
    flatQuad(courtGroup, r.x, r.y, r.w, r.h, basic({ color: light ? "#ffffff" : "#785019", transparent: true, opacity: light ? 0.1 : 0.07 }), 0.006, 2);
  }
  // Chalk lines: slightly wobbly strips, deterministic so the picture is the same every time.
  {
    const chalk = basic({ color: "#ffffff" });
    const wob = (i) => Math.sin(i * 12.9898) * 0.012;
    let k = 0;
    const strip = (x1, y1, x2, y2) => {
      const len = Math.hypot(x2 - x1, y2 - y1) + 0.08;
      const m = new THREE.Mesh(PLANE, chalk);
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
  // The numbers are drawn on the ground; rebuilt on resize because the font may load late.
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
      c.strokeStyle = "rgba(90,60,20,0.38)";
      c.lineWidth = 12;
      c.strokeText(String(n), 80, 84);
      c.fillStyle = "rgba(255,255,255,0.92)";
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
      quad(r.x, r.y, r.w, r.h, "#ffd60a", 0.18 + 0.15 * k, 0.012, 5);
      outline(r, "#ffaa00", 0.6 + 0.4 * k, 0.05, 0.013, 5);
      const tex = label("home", 256, 96, (c, w, h) => {
        c.font = `800 64px ${FONT}`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillStyle = "rgba(120,70,0,0.8)";
        c.fillText("HOME", w / 2, h / 2);
      });
      putLabel(tex, 0.5, -1.55, 1, 0.375, 0.014, 5);
      return;
    }
    const r = squareRect(hint);
    quad(r.x, r.y, r.w, r.h, "#ffd60a", 0.25 + 0.2 * k, 0.012, 5);
    outline(r, "#ffaa00", 0.6 + 0.4 * k, 0.045, 0.013, 5);
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
        c.strokeStyle = "rgba(255,255,255,0.95)";
        c.strokeText(h.name, w / 2, (1 - 0.2) * hh);
        c.fillStyle = h.color;
        c.fillText(h.name, w / 2, (1 - 0.2) * hh);
      });
      putLabel(tex, r.x, r.y, r.w, r.h, 0.014, 5);
    }
  }

  // The red mark to throw at in a tie-break.
  const markTex = label("mark", 128, 128, (c) => {
    c.strokeStyle = "#e03131";
    c.lineWidth = 10;
    c.beginPath();
    c.arc(64, 64, 44, 0, Math.PI * 2);
    c.moveTo(34, 34);
    c.lineTo(94, 94);
    c.moveTo(94, 34);
    c.lineTo(34, 94);
    c.stroke();
  });
  function drawMark(m, time) {
    const s = 0.38 * (1 + 0.08 * pulse(time));
    putLabel(markTex, m.x - s / 2, m.y - s / 2, s, s, 0.015, 6);
  }

  function drawFlash(flash, time) {
    const age = (time - flash.t0) / flash.dur;
    if (age < 0 || age > 1) return;
    const r = squareRect(flash.square);
    const m = /rgba?\(([^)]*)\)/.exec(flash.color);
    const rgb = m
      ? m[1]
          .split(",")
          .slice(0, 3)
          .map((v) => v.trim())
          .join(",")
      : "255,255,255";
    quad(r.x, r.y, r.w, r.h, `rgb(${rgb})`, 0.55 * (1 - age), 0.016, 6);
  }

  // --- the stone ---
  const stone = new THREE.Mesh(SPHERE, new THREE.MeshLambertMaterial({ color: "#7a838b" }));
  stone.scale.set(0.085, 0.07, 0.085);
  stone.visible = false;
  world.add(stone);
  const stoneShadow = new THREE.Mesh(new THREE.CircleGeometry(1, 20), basic({ color: 0x281908, transparent: true, opacity: 0.3 }));
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
      s = { key, fig: figure(style) };
      world.add(s.fig.root);
      slots[i] = s;
    }
    return s.fig;
  }

  // The children watching from beside the wall (re-spaced when the window changes).
  const watchers = new THREE.Group();
  world.add(watchers);
  const WATCH = [
    [-1, 3, 0.62],
    [-0.62, 1, 0.52],
    [0.62, 4, 0.52],
    [1, 2, 0.62],
  ];
  function placeWatchers(edge) {
    if (!watchers.children.length) {
      for (const [side, si, sc] of WATCH) {
        const f = figure(STOCK[si % STOCK.length].style);
        f.apply({ back: false });
        f.root.scale.setScalar(sc);
        f.root.userData.side = side;
        watchers.add(f.root);
      }
    }
    for (const f of watchers.children) f.position.set(f.userData.side * edge, 0, WALL_Z + 0.9);
  }

  // --- the camera ---
  let W = 1;
  let H = 1;
  const PITCH = (31 * Math.PI) / 180;
  const TARGET = new THREE.Vector3(0, 0, -ROWS / 2 + 0.4);
  const v3 = new THREE.Vector3();

  function aim(dist) {
    camera.clearViewOffset();
    camera.position.set(TARGET.x, TARGET.y + Math.sin(PITCH) * dist, TARGET.z + Math.cos(PITCH) * dist);
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
    // Like the 2D layout: the court's near edge sits at 80% of the height, its far edge at 30%,
    // and a wide window keeps the phone's proportions.
    const wantSpan = H * 0.5;
    const maxCellPx = Math.min((W * 0.8) / COLS, H * 0.2);
    const tooBig = (d) => {
      aim(d);
      const span = screenOf(0, 0, 0).y - screenOf(0, 0, -ROWS).y;
      const cell = screenOf(1, 0, 0).x - screenOf(0, 0, 0).x;
      return span > wantSpan || cell > maxCellPx;
    };
    let lo = 3;
    let hi = 60;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (tooBig(mid)) lo = mid;
      else hi = mid;
    }
    aim(hi);
    const nearY = screenOf(0, 0, 0).y;
    camera.setViewOffset(W, H, 0, nearY - H * 0.8, W, H);
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
    // Keep the watching children on screen, beside the wall.
    const wallY = screenOf(0, 0, WALL_Z + 0.9).y;
    const left = unprojectAt(26, wallY, WALL_Z + 0.9);
    placeWatchers(Math.max(1.2, Math.min(2.6, COLS / 2 - left.x - 0.3)));
  }

  // Court (x,y in cell units) to screen px; `scale` is the px width of one cell there.
  function project(x, y) {
    const p = screenOf(wx(x), 0, wz(y));
    const q = screenOf(wx(x + 1), 0, wz(y));
    return { x: p.x, y: p.y, scale: Math.abs(q.x - p.x) };
  }

  // Screen px to court cell units, on the ground (or on the plane z = `atZ`).
  function unprojectAt(sx, sy, atZ = null) {
    v3.set((sx / W) * 2 - 1, 1 - (sy / H) * 2, 0.5).unproject(camera);
    const o = camera.position;
    const d = v3.sub(o);
    if (atZ !== null) {
      const t = (atZ - o.z) / d.z;
      return { x: o.x + d.x * t + COLS / 2, y: -atZ };
    }
    if (d.y >= -1e-6) return { x: 0, y: 1e3 }; // above the horizon
    const t = -o.y / d.y;
    return { x: o.x + d.x * t + COLS / 2, y: -(o.z + d.z * t) };
  }
  const unproject = (sx, sy) => unprojectAt(sx, sy);

  // What a tap means: a square number, "start" (the ground below the court), or null.
  function hitSquare(sx, sy) {
    const { x, y } = unproject(sx, sy);
    if (x >= 0 && x < COLS && y >= 0 && y < ROWS) return cellToSquare(Math.floor(x), Math.floor(y));
    if (y < 0 && y > -2.5 && x > -0.5 && x < COLS + 0.5) return "start";
    return null;
  }

  // Slingshot band, and a dotted line to where the stone would land (drawn flat on screen).
  function drawAim(a, time) {
    const c = octx;
    const from = project(a.origin.x, a.origin.y);
    c.strokeStyle = "rgba(90,50,10,0.8)";
    c.lineWidth = 4;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(from.x, from.y);
    c.lineTo(a.fx, a.fy);
    c.stroke();
    c.fillStyle = "rgba(255,255,255,0.8)";
    c.beginPath();
    c.arc(a.fx, a.fy, 12, 0, Math.PI * 2);
    c.fill();

    const to = project(a.land.x, a.land.y);
    c.setLineDash([2, 9]);
    c.strokeStyle = "rgba(60,30,0,0.85)";
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(from.x, from.y);
    c.lineTo(to.x, to.y);
    c.stroke();
    c.setLineDash([]);
    const r = to.scale * 0.1 * (1 + 0.1 * pulse(time));
    c.strokeStyle = "#e03131";
    c.lineWidth = 3;
    c.beginPath();
    c.ellipse(to.x, to.y, r, r * 0.7, 0, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.moveTo(to.x - r * 0.5, to.y);
    c.lineTo(to.x + r * 0.5, to.y);
    c.moveTo(to.x, to.y - r * 0.35);
    c.lineTo(to.x, to.y + r * 0.35);
    c.stroke();
  }

  /**
   * view: {
   *   hint: square | "start" | null, stone: {x,y,h}|null, flash, aim, houses, mark,
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
    if (view.aim) {
      octx.clearRect(0, 0, W, H);
      drawAim(view.aim, time);
      overlayTex.needsUpdate = true;
      renderer.clearDepth();
      renderer.render(overlayScene, overlayCam);
    }
  }

  return { resize, draw, project, unproject, hitSquare };
}
