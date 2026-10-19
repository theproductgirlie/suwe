// Small DOM helpers and the icon set (inline SVG, stroke icons that take the text colour).

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const PATHS = {
  heart: '<path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.7 4.5 6.4 4.5c2.1 0 3.7 1.1 5.6 3.2 1.9-2.1 3.5-3.2 5.6-3.2 3.7 0 5.5 3.9 4 7.3C19.5 16.4 12 21 12 21z"/>',
  house: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5.5h4V20"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M8 5.5v13l11-6.5z"/>',
  volume: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  book: '<path d="M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5v1.5A3.5 3.5 0 0 0 8 11M16 6h3.5v1.5A3.5 3.5 0 0 1 16 11M12 13v4M8.5 20h7M10 17h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.1"/>',
  back: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  chat: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5z"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  fast: '<path d="m5 5 7 7-7 7M13 5l7 7-7 7"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  throw: '<path d="M5 19c2-8 6-12 14-14M19 5l-1 5M19 5l-5 1"/>',
  hand: '<path d="M7 12V7.5a1.5 1.5 0 0 1 3 0V11M10 11V6a1.5 1.5 0 0 1 3 0v5M13 11V7a1.5 1.5 0 0 1 3 0v6c0 4-2 7-5.5 7S6 17 6 14v-1.5a1.5 1.5 0 0 1 3 0"/>',
};

export function icon(name, size = 22) {
  const span = document.createElement("span");
  span.className = `ico ico-${name}`;
  span.setAttribute("aria-hidden", "true");
  const fill = name === "heart" || name === "house" || name === "play" ? "currentColor" : "none";
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] ?? ""}</svg>`;
  return span;
}

// Fills every <span data-icon="name"> in `root` (used by the static HTML).
export function paintIcons(root = document) {
  for (const s of root.querySelectorAll("[data-icon]")) {
    if (s.dataset.painted) continue;
    s.dataset.painted = "1";
    s.append(icon(s.dataset.icon, Number(s.dataset.size) || 22));
  }
}

// A row of hearts: `filled` full ones and the rest as ghosts.
export function hearts(filled, total) {
  const row = el("span", "hearts");
  for (let i = 0; i < total; i++) {
    const h = icon("heart", 16);
    if (i >= filled) h.classList.add("off");
    row.append(h);
  }
  return row;
}
