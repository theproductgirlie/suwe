// The "Who's playing?" screen: how many players, then a card per seat with a
// name, a character and a house colour.
//
// A computer can only be the opponent in a 2-player match. With 1 player it is
// solo practice, and with 3 or 4 players every seat is a person.

import { drawCharacter, normalizeStyle, STOCK } from "./render/character.js";
import { LEVELS } from "./engine/ai.js";
import { icon } from "./ui.js";

// The computer's level, shown as stars instead of a label.
export const levelStars = (level) => ({ easy: "★☆☆", medium: "★★☆", hard: "★★★" })[level] ?? "★★☆";

export const COLORS = ["#d6433b", "#3b78c9", "#e08a1e", "#7c4ddf", "#3c9e72", "#c93b6e"];
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

  // A seat's outfit takes the house colour, so the character matches the circle.
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

  function readyText() {
    const cpu = seats.filter((s) => s.kind === "computer").length;
    if (count === 1) return "Solo practice, just you and the stone";
    if (count === 2) return cpu ? "1 person and the computer ready to jump" : "2 players ready to jump";
    return `${count} players ready to jump`;
  }

  const COUNT_LABELS = ["solo", "or vs CPU", "players", "players"];

  function render() {
    ensureSeats();
    root.replaceChildren();

    const back = el("button", "setup-back");
    back.type = "button";
    back.setAttribute("aria-label", "Back");
    back.onclick = onBack;

    const head = el("div", "setup-head");
    const titles = el("div", "page-head");
    titles.append(el("h2", "setup-title", "Who\u2019s playing?"), el("p", "setup-sub", "Everybody gets their own colour"));
    const counts = el("div", "tabs");
    for (let n = 1; n <= 4; n++) {
      const b = el("button", n === count ? "chip on" : "chip");
      b.type = "button";
      b.append(el("b", "", String(n)), el("span", "", COUNT_LABELS[n - 1]));
      b.onclick = () => {
        count = n;
        render();
      };
      counts.append(b);
    }
    head.append(titles, counts);

    const note = el("p", "setup-note");
    note.append(icon("info", 22), document.createTextNode("Pass and play on one phone. Want the computer? Pick 2."));

    const list = el("div", "seats");
    list.style.setProperty("--n", String(count));
    seats.forEach((seat, i) => list.append(seatCard(seat, i)));

    // The bar stays at the bottom: who is ready, and Start.
    const bar = el("div", "setup-bar");
    const ready = el("div", "ready");
    const dots = el("span", "color-dots");
    for (const seat of seats) {
      const d = document.createElement("i");
      d.style.background = seat.color;
      dots.append(d);
    }
    const text = el("div", "ready-text");
    text.append(el("span", "", readyText()));
    const bn = el("p", "bar-note");
    bn.append(icon("info", 18), document.createTextNode("Pass and play on one screen. Want the computer? Pick 2 players."));
    text.append(bn);
    ready.append(dots, text);
    const go = el("button", "big go", "Start match");
    go.type = "button";
    go.onclick = start;
    bar.append(ready, go);

    root.append(back, head, note, list, bar);
  }

  function seatCard(seat, i) {
    const card = el("div", i === 0 ? "seat me" : "seat");
    card.style.setProperty("--c", seat.color);

    const head = el("div", "seat-head");
    const face = el("canvas", "seat-face");
    face.width = 240;
    face.height = 240;
    face.title = "Tap to change character";
    const ctx = face.getContext("2d");
    drawCharacter(ctx, lookOf(seat), 120, 226, 1.55, {
      back: false,
      sash: keepsOwnOutfit(seat) ? seat.color : null,
    });
    face.onclick = () => {
      nextChar(i);
      render();
    };
    const badgeText = i === 0 ? "P1 \u00b7 You" : `P${i + 1}`;
    head.append(face, el("span", "badge", badgeText));

    const body = el("div", "seat-body");
    body.append(el("span", "badge", badgeText));

    if (i === 0) {
      // Player 1 is the start.ng player: their own name, not editable.
      body.append(el("label", "lbl", "Signed in as"), el("div", "cname", getMe().name));
    } else if (seat.kind === "person") {
      body.append(el("label", "lbl", "Name"));
      const input = el("input", "name");
      input.type = "text";
      input.maxLength = MAX_NAME;
      input.placeholder = `Player ${i + 1}`;
      input.value = seat.name;
      input.autocomplete = "off";
      input.setAttribute("aria-label", `Player ${i + 1} name`);
      input.oninput = () => (seat.name = input.value);
      body.append(input);
    } else {
      const cn = el("div", "cname", charOf(seat).name);
      const tag = el("span", "tag level", levelStars(seat.level));
      tag.title = `${seat.level[0].toUpperCase()}${seat.level.slice(1)} computer`;
      cn.append(tag);
      body.append(cn);
    }

    // Person or Computer: only the second seat of a 2-player match can be a computer.
    if (count === 2 && i === 1) {
      const seg = el("div", "seg track");
      for (const kind of ["person", "computer"]) {
        const b = el("button", seat.kind === kind ? "on" : "", kind === "person" ? "Person" : "Computer");
        b.type = "button";
        b.onclick = () => {
          seat.kind = kind;
          if (kind === "computer" && seat.char === "me") nextChar(i);
          if (kind === "person" && !seat.name) seat.name = `Player ${i + 1}`;
          render();
        };
        seg.append(b);
      }
      body.append(seg);
    }

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
      // A colour another player holds shows their label and says so when tapped.
      const owner = seats.findIndex((s, j) => j !== i && s.color === color);
      const d = el("button", `dot${seat.color === color ? " on" : ""}${owner >= 0 ? " taken" : ""}`);
      d.type = "button";
      d.style.background = color;
      d.style.setProperty("--cc", color);
      d.setAttribute("aria-label", owner >= 0 ? `Colour used by player ${owner + 1}` : "House colour");
      if (owner >= 0) {
        d.textContent = `P${owner + 1}`;
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

    card.append(head, body);
    return card;
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
