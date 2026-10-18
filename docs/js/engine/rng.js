// Seeded generator (mulberry32). The state is a plain integer, so it saves
// into a match and replays identically. The engine never calls Math.random.

export function seedState(seed) {
  return seed >>> 0;
}

// Returns { value, state }: value in [0, 1), and the next state to keep.
export function nextFloat(state) {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: s };
}
