// Reads the theme variables from css/theme.css so the 3D scene uses the same colours as the
// page. `watchTheme` calls back when the theme changes (a `data-theme` or class on <html>, or an
// edited style attribute), so a theme switch repaints the court and the children too.

const KEYS = ["sky", "bg", "card", "line", "ink", "soft", "primary", "shade", "accent", "accent-ink", "court", "chalk", "danger"];

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
};

export function readTheme() {
  const css = getComputedStyle(document.documentElement);
  const theme = {};
  for (const k of KEYS) theme[k] = css.getPropertyValue(`--${k}`).trim() || FALLBACK[k];
  return theme;
}

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
