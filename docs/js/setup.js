// The "Who's playing?" screen: how many players, then a row per seat with a character, a name
// and a colour. A computer can only be the opponent in a 2-player match: with 1 player it is
// solo practice, and with 3 or 4 players every seat is a person.

import { drawCharacter, normalizeStyle, STOCK } from "./render/character.js";
import { LEVELS } from "./engine/ai.js";
import { playerColors } from "./theme.js";

// The computer's level, shown as stars.
export const levelStars = (level) => ({ easy: "★☆☆", medium: "★★☆", hard: "★★★" })[level] ?? "★★☆";

// The six player colours come from css/theme.css.
export const COLORS = playerColors();
const MAX_NAME = 14;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * @param {HTMLElement} root
 * @param {{ getMe: () => {name:string, style:object|null, signedIn:boolean}, onStart: (cfg) => void, onBack: () => void, say?: (t:string) => void }} opts
 */
export function createSetup(root, { getMe, onStart, onBack, say = () => {} }) {
  let count = 1;
  let seats = [];

  // Characters a seat can wear: the start.ng player first, then stock kids.
  const chars = () => [
    { id: "me", name: getMe().name, style: getMe().style },
    ...STOCK.map((c, i) => ({ id: `s${i}`, name: c.name, style: c.style })),
  ];

  function defaultSeat(i, me) {
    const taken = new Set(seats.map((s) => s.char));
    const char = i === 0 ? "me" : chars().find((c) => c.id !== "me" && !taken.has(c.id)).id;
    const color = COLORS.find((c) => !seats.some((s) => s.color === c));
    return {
      kind: i === 0 || count !== 2 ? "person" : "computer",
      name: i === 0 ? me.name : "",
      level: "medium",
      char,
      color,
    };
  }

  function ensureSeats() {
    const me = getMe();
    while (seats.length < count) seats.push(defaultSeat(seats.length, me));
    seats.length = count;
    // Computers only play 1-on-1: with 3 or 4 players every seat is a person.
    if (count !== 2) {
      seats.forEach((s, i) => {
        if (s.kind === "computer") {
          s.kind = "person";
          if (s.char === "me" && i > 0) s.char = chars().find((c) => c.id !== "me").id;
        }
      });
    }
  }

  const charOf = (seat) => chars().find((c) => c.id === seat.char);

  // A seat's outfit takes the house colour, so the character matches the swatch.
  // The exception is a signed-in start.ng player, whose own look must stay
  // recognisable: they get a sash in the house colour instead.
  const keepsOwnOutfit = (seat) => seat.char === "me" && getMe().signedIn;
  const lookOf = (seat) =>
    keepsOwnOutfit(seat)
      ? charOf(seat).style
      : { ...normalizeStyle(charOf(seat).style), primaryColor: seat.color };

  function nextChar(i) {
    const list = chars();
    const used = new Set(seats.filter((_, j) => j !== i).map((s) => s.char));
    let k = list.findIndex((c) => c.id === seats[i].char);
    for (let n = 0; n < list.length; n++) {
      k = (k + 1) % list.length;
      const c = list[k];
      if (used.has(c.id)) continue;
      if (c.id === "me" && seats[i].kind === "computer") continue;
      seats[i].char = c.id;
      return;
    }
  }

  const seatName = (seat, i) => (i === 0 ? "You" : seat.kind === "computer" ? charOf(seat).name : seat.name.trim() || `Player ${i + 1}`);

  function readyText() {
    if (count === 1) return "Solo practice, just you and the stone";
    const names = seats.map(seatName);
    if (count === 2) {
      const s = seats[1];
      return s.kind === "computer" ? `You vs ${names[1]} (computer, ${s.level})` : `You vs ${names[1]} (friend)`;
    }
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }

  function render() {
    ensureSeats();
    root.replaceChildren();

    const back = el("button", "setup-back");
    back.type = "button";
    back.setAttribute("aria-label", "Back");
    back.onclick = onBack;

    const head = el("div", "setup-head");
    head.append(el("h2", "setup-title", "Who’s playing?"));

    const counts = el("div", "tabs");
    for (let n = 1; n <= 4; n++) {
      const b = el("button", n === count ? "chip on" : "chip", n === 1 ? "1 player" : `${n} players`);
      b.type = "button";
      b.onclick = () => {
        count = n;
        render();
      };
      counts.append(b);
    }

    const list = el("div", "seats");
    list.style.setProperty("--n", String(count));
    seats.forEach((seat, i) => list.append(seatRow(seat, i)));

    // The bar stays at the bottom: who is playing, and Start.
    const bar = el("div", "setup-bar");
    bar.append(el("p", "ready", readyText()));
    const go = el("button", "big", "Start match");
    go.type = "button";
    go.onclick = start;
    bar.append(go);

    root.append(back, head, el("p", "setup-label", "How many players?"), counts, list, bar);
  }

  function seatRow(seat, i) {
    const row = el("div", i === 0 ? "seat me" : "seat");
    row.style.setProperty("--c", seat.color);

    const head = el("div", "seat-head");
    const face = el("canvas", "seat-face");
    face.width = 180;
    face.height = 220;
    face.title = "Tap to change character";
    drawCharacter(face.getContext("2d"), lookOf(seat), 90, 206, 1.75, {
      back: false,
      shadow: false,
      sash: keepsOwnOutfit(seat) ? seat.color : null,
    });
    face.onclick = () => {
      nextChar(i);
      render();
    };
    head.append(face);

    const body = el("div", "seat-body");
    const top = el("div", "seat-top");

    if (i === 0) {
      // Player 1 is the start.ng player: their own name, not editable.
      top.append(el("div", "cname", getMe().name), el("span", "you", "YOU"));
    } else if (seat.kind === "person") {
      const input = el("input", "name");
      input.type = "text";
      input.maxLength = MAX_NAME;
      input.placeholder = `Player ${i + 1}`;
      input.value = seat.name;
      input.autocomplete = "off";
      input.setAttribute("aria-label", `Player ${i + 1} name`);
      input.oninput = () => {
        seat.name = input.value;
        root.querySelector(".ready").textContent = readyText();
      };
      top.append(input);
    } else {
      const cn = el("div", "cname", charOf(seat).name);
      const tag = el("span", "tag level", levelStars(seat.level));
      tag.hidden = true; // the level buttons below say it; kept for screen readers
      tag.title = `${seat.level[0].toUpperCase()}${seat.level.slice(1)} computer`;
      cn.append(tag);
      top.append(cn);
    }

    // Friend or Computer: only the second seat of a 2-player match can be a computer.
    if (count === 2 && i === 1) {
      const seg = el("div", "seg track");
      for (const kind of ["person", "computer"]) {
        const b = el("button", seat.kind === kind ? "on" : "", kind === "person" ? "Friend" : "Computer");
        b.type = "button";
        b.onclick = () => {
          seat.kind = kind;
          if (kind === "computer" && seat.char === "me") nextChar(i);
          if (kind === "person" && !seat.name) seat.name = `Player ${i + 1}`;
          render();
        };
        seg.append(b);
      }
      top.append(seg);
    }
    body.append(top);

    if (seat.kind === "computer") {
      const lv = el("div", "seg wide levels");
      for (const level of Object.keys(LEVELS)) {
        const b = el("button", seat.level === level ? "on" : "", level[0].toUpperCase() + level.slice(1));
        b.type = "button";
        b.onclick = () => {
          seat.level = level;
          render();
        };
        lv.append(b);
      }
      body.append(lv);
    }

    const dots = el("div", "dots");
    for (const color of COLORS) {
      // A colour another player holds is shown pale and says so when tapped.
      const owner = seats.findIndex((s, j) => j !== i && s.color === color);
      const d = el("button", `dot${seat.color === color ? " on" : ""}${owner >= 0 ? " taken" : ""}`);
      d.type = "button";
      d.style.background = color;
      d.style.setProperty("--cc", color);
      d.setAttribute("aria-label", owner >= 0 ? `Colour used by player ${owner + 1}` : "Player colour");
      if (owner >= 0) {
        d.onclick = () => say(`Player ${owner + 1} has this colour`);
      } else {
        d.onclick = () => {
          seat.color = color;
          render();
        };
      }
      dots.append(d);
    }
    body.append(dots);

    row.append(head, body);
    return row;
  }

  function start() {
    // Never start with a repeated colour.
    const used = new Set();
    for (const seat of seats) {
      if (used.has(seat.color)) {
        seat.color = COLORS.find((c) => !used.has(c) && !seats.some((s) => s.color === c)) ?? seat.color;
      }
      used.add(seat.color);
    }
    const players = seats.map((seat, i) => {
      const c = charOf(seat);
      const typed = seat.name.trim().slice(0, MAX_NAME);
      return {
        id: `p${i + 1}`,
        name: i === 0 ? getMe().name : seat.kind === "computer" ? c.name : typed || `Player ${i + 1}`,
        color: seat.color,
        ai: seat.kind === "computer" ? seat.level : null,
        look: lookOf(seat),
        sash: keepsOwnOutfit(seat),
      };
    });
    onStart({ players });
  }

  return {
    // opts.count: open with this many players (the tutorial's "Try it now" opens solo practice).
    show(opts = {}) {
      seats = [];
      count = opts.count ?? 1; // always opens as a solo player unless asked otherwise
      render();
    },
  };
}
