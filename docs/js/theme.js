// Reads the theme variables from css/theme.css so the 3D scene uses the same colours as the
// page. `watchTheme` calls back when the theme changes (a `data-theme` or class on <html>, or an
// edited style attribute), so a theme switch repaints the court and the children too.

const KEYS = ["sky", "bg", "card", "white", "line", "ink", "soft", "primary", "shade", "accent", "accent-ink", "court", "chalk", "danger", "p1", "p2", "p3", "p4", "p5", "p6"];

// Plain fallbacks (the Golden hour values) for when the stylesheet has not loaded.
const FALLBACK = {
  sky: "#ffe6c7",
  bg: "#edb676",
  card: "#fff7ee",
  line: "#f2d5b5",
  ink: "#3b1d12",
  soft: "#86533a",
  primary: "#c4452b",
  shade: "#8a2c18",
  accent: "#2f8f7d",
  "accent-ink": "#ffffff",
  court: "#e2a866",
  chalk: "#fff9f1",
  danger: "#d7263d",
  white: "#ffffff",
  p1: "#e03131",
  p2: "#1971c2",
  p3: "#f08c00",
  p4: "#7048e8",
  p5: "#0ca678",
  p6: "#d6336c",
};

export function readTheme() {
  const css = getComputedStyle(document.documentElement);
  const theme = {};
  for (const k of KEYS) theme[k] = css.getPropertyValue(`--${k}`).trim() || FALLBACK[k];
  return theme;
}

// The six player colours, in order.
export const playerColors = () => {
  const t = readTheme();
  return [t.p1, t.p2, t.p3, t.p4, t.p5, t.p6];
};

export function watchTheme(onChange) {
  let last = JSON.stringify(readTheme());
  const check = () => {
    const now = JSON.stringify(readTheme());
    if (now !== last) {
      last = now;
      onChange(readTheme());
    }
  };
  new MutationObserver(check).observe(document.documentElement, { attributes: true });
  // Stylesheets that arrive late (or a theme file swapped in) also count.
  document.querySelectorAll('link[rel="stylesheet"]').forEach((l) => l.addEventListener("load", check));
  return check;
}
