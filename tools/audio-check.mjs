// Renders every sound effect and the music loop offline (no speakers needed) and
// checks they are audible, never clip, and contain no broken (NaN) samples.
import { launch, sleep } from "./cdp.mjs";

const b = await launch({ url: "http://localhost:5173/" });
await sleep(300);
const report = await b.evaluate(`(async () => {
  const A = await import("./js/audio.js");
  const SR = 44100;
  const stats = (buf) => {
    const d = buf.getChannelData(0);
    let peak = 0, sum = 0, bad = 0;
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) { bad++; continue; }
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
    }
    return { peak, rms: Math.sqrt(sum / d.length), bad, len: d.length / SR };
  };
  const out = { sfx: {}, music: null };
  // The noise in the sounds is random, so render each one several times and keep the loudest.
  for (const name of Object.keys(A.SFX)) {
    let worst = null;
    for (let take = 0; take < 6; take++) {
      const ctx = new OfflineAudioContext(1, SR * 3, SR);
      const bus = A.buildMaster(ctx);
      A.SFX[name](ctx, bus.sfx, 0.01);
      const s = stats(await ctx.startRendering());
      if (!worst || s.peak > worst.peak) worst = s;
    }
    out.sfx[name] = worst;
  }
  // two full loops of the music, rendered through the same master chain
  const secs = A.stepSeconds() * A.STEPS * 2;
  const ctx = new OfflineAudioContext(1, Math.ceil(SR * (secs + 1)), SR);
  const bus = A.buildMaster(ctx);
  for (let s = 0; s < A.STEPS * 2; s++) A.musicStep(ctx, bus.music, s % A.STEPS, 0.05 + s * A.stepSeconds());
  const buf = await ctx.startRendering();
  out.music = stats(buf);
  // the beat should have shape: loudness per step must vary, not be flat noise
  const d = buf.getChannelData(0);
  const per = Math.floor(A.stepSeconds() * SR);
  const e = [];
  for (let s = 0; s < A.STEPS; s++) { let x = 0; for (let i = 0; i < per; i++) x += d[Math.floor(0.05 * SR) + s * per + i] ** 2; e.push(x / per); }
  const mean = e.reduce((a, c) => a + c, 0) / e.length;
  out.music.stepVariation = Math.sqrt(e.reduce((a, c) => a + (c - mean) ** 2, 0) / e.length) / mean;
  out.music.loopSeconds = A.stepSeconds() * A.STEPS;
  return out;
})()`);

let fails = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) fails++;
};
for (const [name, s] of Object.entries(report.sfx)) {
  check(s.bad === 0 && s.peak >= 0.15 && s.peak <= 0.98, `sfx ${name.padEnd(8)} peak ${s.peak.toFixed(2)} rms ${s.rms.toFixed(3)}`);
}
const m = report.music;
check(m.bad === 0, "music has no broken samples");
check(m.peak > 0.2 && m.peak <= 1, `music is audible and does not clip (peak ${m.peak.toFixed(2)})`);
check(m.rms > 0.02 && m.rms < 0.3, `music loudness is sensible (rms ${m.rms.toFixed(3)})`);
check(m.stepVariation > 0.5, `music has a rhythm, not a flat hiss (variation ${m.stepVariation.toFixed(2)})`);
check(Math.abs(m.loopSeconds - 9.23) < 0.05, `loop is ${m.loopSeconds.toFixed(2)}s (4 bars at 104 BPM)`);
check(b.problems.length === 0, "no console errors");
await b.close();
process.exit(fails ? 1 : 0);
