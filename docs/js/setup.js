// The "how many players" screen: seats, names, characters and house colours.

import { drawCharacter, normalizeStyle, STOCK } from "./render/character.js";
import { LEVELS } from "./engine/ai.js";

export const COLORS = ["#e03131", "#1971c2", "#f08c00", "#7048e8", "#0ca678", "#d6336c"];
const MAX_NAME = 12;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * @param {HTMLElement} root
 * @param {{ getMe: () => {name:string, style:object|null}, onStart: (cfg) => void, onBack: () => void }} opts
 */
export function createSetup(root, { getMe, onStart, onBack }) {
  let count = 2;
  let seats = [];

  // Characters a seat can wear: the signed-in/guest look first, then stock kids.
  const chars = () => [
    { id: "me", name: getMe().name, style: getMe().style },
    ...STOCK.map((c, i) => ({ id: `s${i}`, name: c.name, style: c.style })),
  ];

  function defaultSeat(i, me) {
    const taken = new Set(seats.map((s) => s.char));
    const char = i === 0 ? "me" : chars().find((c) => c.id !== "me" && !taken.has(c.id)).id;
    const color = COLORS.find((c) => !seats.some((s) => s.color === c));
    return {
      kind: i === 0 ? "person" : "computer",
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
  }

  const charOf = (seat) => chars().find((c) => c.id === seat.char);

  // A seat's outfit takes the house colour, so the character matches the circle.
  // The exception is a signed-in start.ng player, whose own look must stay
  // recognisable: they get a sash in the house colour instead.
  const keepsOwnOutfit = (seat) => seat.char === "me" && getMe().signedIn;
  const lookOf = (seat) =>
    keepsOwnOutfit(seat) ? charOf(seat).style : { ...normalizeStyle(charOf(seat).style), primaryColor: seat.color };

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

  function render() {
    ensureSeats();
    root.replaceChildren();

    const head = el("div", "setup-head");
    const back = el("button", "link", "‹ Back");
    back.type = "button";
    back.onclick = onBack;
    head.append(back, el("h2", "", "Who dey play?"));
    root.append(head);

    const counts = el("div", "chips");
    for (let n = 1; n <= 4; n++) {
      const b = el("button", n === count ? "chip on" : "chip", n === 1 ? "1 player" : `${n} players`);
      b.type = "button";
      b.onclick = () => {
        count = n;
        render();
      };
      counts.append(b);
    }
    root.append(counts);

    const list = el("div", "seats");
    seats.forEach((seat, i) => list.append(seatCard(seat, i)));
    root.append(list);

    const go = el("button", "big", count === 1 ? "Start practice" : "Start match");
    go.type = "button";
    go.onclick = start;
    root.append(go);
  }

  function seatCard(seat, i) {
    const card = el("div", "seat");
    card.style.setProperty("--c", seat.color);

    const face = el("canvas", "seat-face");
    face.width = 112;
    face.height = 144;
    face.title = "Tap to change character";
    const ctx = face.getContext("2d");
    ctx.translate(0.5, 0.5);
    drawCharacter(ctx, lookOf(seat), 56, 128, 0.95, {
      back: false,
      sash: keepsOwnOutfit(seat) ? seat.color : null,
    });
    face.onclick = () => {
      nextChar(i);
      render();
    };

    const main = el("div", "seat-main");
    const top = el("div", "seat-top");
    top.append(el("b", "", `Player ${i + 1}`));

    if (count > 1 && i > 0) {
      const seg = el("div", "seg");
      for (const kind of ["person", "computer"]) {
        const b = el("button", seat.kind === kind ? "on" : "", kind === "person" ? "Person" : "Computer");
        b.type = "button";
        b.onclick = () => {
          seat.kind = kind;
          if (kind === "computer" && seat.char === "me") nextChar(i);
          if (kind === "person" && !seat.name) seat.name = `Guest ${i + 1}`;
          render();
        };
        seg.append(b);
      }
      top.append(seg);
    }
    main.append(top);

    if (seat.kind === "person") {
      const input = el("input", "name");
      input.type = "text";
      input.maxLength = MAX_NAME;
      input.placeholder = i === 0 ? "Guest" : `Guest ${i + 1}`;
      input.value = seat.name;
      input.autocomplete = "off";
      input.setAttribute("aria-label", `Player ${i + 1} name`);
      input.oninput = () => (seat.name = input.value);
      main.append(input);
    } else {
      const lv = el("div", "seg wide");
      for (const level of Object.keys(LEVELS)) {
        const b = el("button", seat.level === level ? "on" : "", level[0].toUpperCase() + level.slice(1));
        b.type = "button";
        b.onclick = () => {
          seat.level = level;
          render();
        };
        lv.append(b);
      }
      main.append(el("div", "cname", charOf(seat).name), lv);
    }

    const dots = el("div", "dots");
    for (const color of COLORS) {
      const taken = seats.some((s, j) => j !== i && s.color === color);
      const d = el("button", `dot${seat.color === color ? " on" : ""}`);
      d.type = "button";
      d.style.background = color;
      d.disabled = taken;
      d.setAttribute("aria-label", "House colour");
      d.onclick = () => {
        seat.color = color;
        render();
      };
      dots.append(d);
    }
    main.append(dots);

    card.append(face, main);
    return card;
  }

  function start() {
    const players = seats.map((seat, i) => {
      const c = charOf(seat);
      const typed = seat.name.trim().slice(0, MAX_NAME);
      return {
        id: `p${i + 1}`,
        name: seat.kind === "computer" ? c.name : typed || (i === 0 ? getMe().name : `Guest ${i + 1}`),
        color: seat.color,
        ai: seat.kind === "computer" ? seat.level : null,
        look: lookOf(seat),
        sash: keepsOwnOutfit(seat),
      };
    });
    onStart({ players });
  }

  return {
    show() {
      seats = [];
      render();
    },
  };
}
