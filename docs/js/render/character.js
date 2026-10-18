// Draws a child from start.ng style fields. Art is our own, but body, colours,
// hair, hat and accessory stay recognisable.
//
// Origin is the feet, the child is 100 units tall, y grows upward on screen
// as negative values.

export const DEFAULT_STYLE = Object.freeze({
  body: "male",
  primaryColor: "#2f9e44",
  secondaryColor: "#1c4e80",
  skinColor: "#8d5524",
  hairColor: "#17120f",
  hair: "short",
  hat: "none",
  accessory: "none",
});

const HAIR = ["short", "afro", "braids", "bun", "ponytail", "dreads", "bald"];
const HATS = ["none", "cap", "beanie", "tophat", "crown"];
const ACCESSORIES = ["none", "glasses", "earrings", "beard", "scarf", "backpack"];
const HEX = /^#[0-9a-fA-F]{6}$/;

// Fall back to something sensible for any missing or unknown value.
export function normalizeStyle(style) {
  const s = style && typeof style === "object" ? style : {};
  const color = (v, d) => (typeof v === "string" && HEX.test(v) ? v : d);
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  return {
    body: s.body === "female" ? "female" : "male",
    primaryColor: color(s.primaryColor, DEFAULT_STYLE.primaryColor),
    secondaryColor: color(s.secondaryColor, DEFAULT_STYLE.secondaryColor),
    skinColor: color(s.skinColor, DEFAULT_STYLE.skinColor),
    hairColor: color(s.hairColor, DEFAULT_STYLE.hairColor),
    hair: pick(s.hair, HAIR, DEFAULT_STYLE.hair),
    hat: pick(s.hat, HATS, DEFAULT_STYLE.hat),
    accessory: pick(s.accessory, ACCESSORIES, DEFAULT_STYLE.accessory),
  };
}

// Stock Nigerian children for the computer and extra local players.
export const STOCK = [
  {
    name: "Tunde",
    style: { body: "male", primaryColor: "#e8590c", secondaryColor: "#1c3d6e", skinColor: "#5c3a21", hairColor: "#0e0b09", hair: "short", hat: "cap", accessory: "none" },
  },
  {
    name: "Ngozi",
    style: { body: "female", primaryColor: "#f4c20d", secondaryColor: "#7b2cbf", skinColor: "#6b4226", hairColor: "#0e0b09", hair: "braids", hat: "none", accessory: "earrings" },
  },
  {
    name: "Musa",
    style: { body: "male", primaryColor: "#ffffff", secondaryColor: "#2b8a3e", skinColor: "#8d5524", hairColor: "#0e0b09", hair: "bald", hat: "none", accessory: "none" },
  },
  {
    name: "Amaka",
    style: { body: "female", primaryColor: "#d6336c", secondaryColor: "#1971c2", skinColor: "#3f2a1d", hairColor: "#0e0b09", hair: "afro", hat: "none", accessory: "none" },
  },
  {
    name: "Emeka",
    style: { body: "male", primaryColor: "#1971c2", secondaryColor: "#343a40", skinColor: "#4a2f1d", hairColor: "#0e0b09", hair: "short", hat: "none", accessory: "backpack" },
  },
  {
    name: "Bisi",
    style: { body: "female", primaryColor: "#0ca678", secondaryColor: "#c92a2a", skinColor: "#7a4a2a", hairColor: "#0e0b09", hair: "bun", hat: "none", accessory: "none" },
  },
];

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  const r = c(n >> 16);
  const g = c((n >> 8) & 255);
  const b = c(n & 255);
  return `rgb(${r},${g},${b})`;
}

function ellipse(ctx, x, y, rx, ry, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} style start.ng style fields (normalised here)
 * @param {number} x feet x in canvas px
 * @param {number} y feet y in canvas px
 * @param {number} scale px per character unit (1 = 100px tall)
 * @param {{back?:boolean, facing?:1|-1, bob?:number, lift?:number, oneLeg?:boolean, shadow?:boolean}} [pose]
 */
export function drawCharacter(ctx, style, x, y, scale, pose = {}) {
  const st = normalizeStyle(style);
  const {
    back = false,
    facing = 1,
    bob: bob0 = 0,
    lift = 0,
    oneLeg = false,
    shadow = true,
    bend = 0, // 0..1, bending down to pick up the stone
    tilt = 0, // radians, losing balance
    hold = false, // stone in the right hand
    ring = null, // house colour ring under the feet
    sash = null, // house colour sash, for players whose own outfit must stay as it is
  } = pose;
  const bob = bob0 + bend * 14;
  const female = st.body === "female";
  const skinDark = shade(st.skinColor, -28);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.scale(scale * facing, scale);

  if (shadow) ellipse(ctx, 0, 1, 22 - lift * 0.15, 6, "rgba(40,25,10,0.28)");
  if (ring) {
    ctx.strokeStyle = ring;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.ellipse(0, 1, 27, 8, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.translate(0, -lift);

  // Legs. One-leg pose bends the raised leg up behind the standing leg.
  const legTop = -40;
  ctx.lineCap = "round";
  ctx.lineWidth = 9;
  ctx.strokeStyle = st.skinColor;
  ctx.beginPath();
  ctx.moveTo(-7, legTop);
  ctx.lineTo(-7, -4 + bob * 0.2);
  ctx.stroke();
  ctx.beginPath();
  if (oneLeg) {
    ctx.moveTo(7, legTop);
    ctx.lineTo(13, -22);
    ctx.lineTo(4, -17);
  } else {
    ctx.moveTo(7, legTop);
    ctx.lineTo(7, -4 + bob * 0.2);
  }
  ctx.stroke();
  // Shoes
  ellipse(ctx, -7, -2 + bob * 0.2, 7, 3.5, "#f1f3f5");
  if (!oneLeg) ellipse(ctx, 7, -2 + bob * 0.2, 7, 3.5, "#f1f3f5");
  else ellipse(ctx, 4, -16, 5, 3, "#f1f3f5");

  // Lower garment
  ctx.fillStyle = st.secondaryColor;
  ctx.beginPath();
  if (female) {
    ctx.moveTo(-13, -62 + bob);
    ctx.lineTo(13, -62 + bob);
    ctx.lineTo(18, -34);
    ctx.lineTo(-18, -34);
  } else {
    ctx.moveTo(-12, -58 + bob);
    ctx.lineTo(12, -58 + bob);
    ctx.lineTo(12, -32);
    ctx.lineTo(1, -32);
    ctx.lineTo(0, -44);
    ctx.lineTo(-1, -32);
    ctx.lineTo(-12, -32);
  }
  ctx.closePath();
  ctx.fill();

  // Backpack goes behind the torso when seen from the front, on it from behind.
  if (st.accessory === "backpack" && !back) {
    roundRect(ctx, -18, -78 + bob, 9, 22, 4, shade(st.secondaryColor, -20));
  }

  // Arms
  ctx.lineWidth = 7;
  ctx.strokeStyle = st.skinColor;
  const armSwing = oneLeg ? 10 : 0;
  const handX = 24 - bend * 6;
  const handY = (-54 + bob - armSwing) * (1 - bend) + -8 * bend;
  ctx.beginPath();
  ctx.moveTo(-14, -74 + bob);
  ctx.lineTo(-24, -54 + bob - armSwing * 0.3);
  ctx.moveTo(14, -74 + bob);
  ctx.lineTo(handX, handY);
  ctx.stroke();
  if (hold) ellipse(ctx, handX, handY, 5, 4, "#6c757d");

  // Torso
  roundRect(ctx, -15, -80 + bob, 30, 30, 8, st.primaryColor);
  if (sash) {
    ctx.fillStyle = sash;
    ctx.beginPath();
    ctx.moveTo(-15, -80 + bob);
    ctx.lineTo(-4, -80 + bob);
    ctx.lineTo(15, -54 + bob);
    ctx.lineTo(4, -52 + bob);
    ctx.closePath();
    ctx.fill();
  }
  if (st.accessory === "backpack" && back) {
    roundRect(ctx, -12, -78 + bob, 24, 24, 6, shade(st.secondaryColor, -10));
    ctx.fillStyle = shade(st.secondaryColor, 25);
    ctx.fillRect(-8, -66 + bob, 16, 3);
  }
  if (st.accessory === "scarf") {
    roundRect(ctx, -13, -83 + bob, 26, 7, 3, "#f08c00");
    roundRect(ctx, 6, -80 + bob, 6, 15, 3, "#f08c00");
  }

  // Head
  const hy = -94 + bob;
  roundRect(ctx, -3, -84 + bob, 6, 6, 2, skinDark);
  ellipse(ctx, 0, hy, 13, 14, st.skinColor);

  if (!back) {
    ellipse(ctx, -5, hy - 1, 1.8, 2.4, "#1b1209");
    ellipse(ctx, 5, hy - 1, 1.8, 2.4, "#1b1209");
    ctx.strokeStyle = "#3b1d10";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, hy + 4, 4, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    if (st.accessory === "glasses") {
      ctx.strokeStyle = "#212529";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(-5, hy - 1, 4, 0, Math.PI * 2);
      ctx.moveTo(9, hy - 1);
      ctx.arc(5, hy - 1, 4, 0, Math.PI * 2);
      ctx.moveTo(-1, hy - 1);
      ctx.lineTo(1, hy - 1);
      ctx.stroke();
    }
    if (st.accessory === "beard") {
      ctx.fillStyle = st.hairColor;
      ctx.beginPath();
      ctx.arc(0, hy + 4, 12, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.fill();
    }
  }
  if (st.accessory === "earrings") {
    ellipse(ctx, -13, hy + 5, 2.4, 2.4, "#ffd43b");
    ellipse(ctx, 13, hy + 5, 2.4, 2.4, "#ffd43b");
  }

  drawHair(ctx, st, hy, back);
  drawHat(ctx, st, hy);

  ctx.restore();
}

function drawHair(ctx, st, hy, back) {
  const c = st.hairColor;
  ctx.fillStyle = c;
  ctx.strokeStyle = c;
  switch (st.hair) {
    case "bald":
      return;
    case "afro":
      ellipse(ctx, 0, hy - 5, 19, 17, c);
      if (!back) ellipse(ctx, 0, hy + 2, 11.5, 11, st.skinColor);
      if (!back) redrawFace(ctx, st, hy);
      return;
    case "braids":
      hairCap(ctx, hy, back);
      ctx.lineWidth = 3.2;
      ctx.lineCap = "round";
      for (const dx of [-12, -7, 7, 12]) {
        ctx.beginPath();
        ctx.moveTo(dx, hy - 2);
        ctx.lineTo(dx * 1.2, hy + 16);
        ctx.stroke();
      }
      return;
    case "bun":
      hairCap(ctx, hy, back);
      ellipse(ctx, 0, hy - 17, 6, 6, c);
      return;
    case "ponytail":
      hairCap(ctx, hy, back);
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(10, hy - 10);
      ctx.quadraticCurveTo(24, hy - 4, 18, hy + 12);
      ctx.stroke();
      return;
    case "dreads":
      hairCap(ctx, hy, back);
      ctx.lineWidth = 3.4;
      ctx.lineCap = "round";
      for (const dx of [-13, -9, -4, 4, 9, 13]) {
        ctx.beginPath();
        ctx.moveTo(dx, hy - 8);
        ctx.lineTo(dx * 1.25, hy + 10);
        ctx.stroke();
      }
      return;
    default:
      hairCap(ctx, hy, back);
  }
}

// Short hair: a cap over the top of the head, or the whole head from behind.
function hairCap(ctx, hy, back) {
  ctx.beginPath();
  if (back) {
    ctx.ellipse(0, hy - 1, 13.5, 14.5, 0, 0, Math.PI * 2);
  } else {
    ctx.ellipse(0, hy - 3, 13.5, 12, 0, Math.PI, 0);
    ctx.lineTo(13.5, hy - 3);
    ctx.lineTo(-13.5, hy - 3);
  }
  ctx.fill();
}

function redrawFace(ctx, st, hy) {
  ellipse(ctx, -5, hy - 1, 1.8, 2.4, "#1b1209");
  ellipse(ctx, 5, hy - 1, 1.8, 2.4, "#1b1209");
  ctx.strokeStyle = "#3b1d10";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0, hy + 4, 4, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
}

function drawHat(ctx, st, hy) {
  switch (st.hat) {
    case "cap":
      ctx.fillStyle = st.primaryColor;
      ctx.beginPath();
      ctx.ellipse(0, hy - 6, 14, 10, 0, Math.PI, 0);
      ctx.fill();
      roundRect(ctx, 2, hy - 8, 17, 4, 2, shade(st.primaryColor, -25));
      return;
    case "beanie":
      ctx.fillStyle = st.secondaryColor;
      ctx.beginPath();
      ctx.ellipse(0, hy - 6, 14.5, 12, 0, Math.PI, 0);
      ctx.fill();
      roundRect(ctx, -14.5, hy - 8, 29, 5, 2, shade(st.secondaryColor, 30));
      ellipse(ctx, 0, hy - 19, 3.2, 3.2, shade(st.secondaryColor, 30));
      return;
    case "tophat":
      roundRect(ctx, -17, hy - 11, 34, 4, 2, "#212529");
      roundRect(ctx, -10, hy - 34, 20, 25, 2, "#212529");
      ctx.fillStyle = st.primaryColor;
      ctx.fillRect(-10, hy - 17, 20, 4);
      return;
    case "crown":
      ctx.fillStyle = "#fcc419";
      ctx.beginPath();
      ctx.moveTo(-11, hy - 11);
      ctx.lineTo(-11, hy - 22);
      ctx.lineTo(-5.5, hy - 16);
      ctx.lineTo(0, hy - 24);
      ctx.lineTo(5.5, hy - 16);
      ctx.lineTo(11, hy - 22);
      ctx.lineTo(11, hy - 11);
      ctx.closePath();
      ctx.fill();
      return;
  }
}
