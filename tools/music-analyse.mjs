// Measures each music instrument on its own (offline), to find anything harsh:
// peak, how sharp the attack is, and how much of the energy sits in the harsh 2 kHz+ band.
import { launch, sleep } from "./cdp.mjs";

const b = await launch({ url: "http://localhost:5173/" });
await sleep(300);
const rows = await b.evaluate(`(async () => {
  const A = await import("./js/audio.js");
  const SR = 44100;
  const render = async (play, filter) => {
    const ctx = new OfflineAudioContext(1, SR, SR);
    let dest = ctx.destination;
    if (filter) { const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = filter; f.connect(ctx.destination); dest = f; }
    const g = ctx.createGain(); g.connect(dest);
    play(ctx, g, 0.01);
    return (await ctx.startRendering()).getChannelData(0);
  };
  const stat = (d) => { let pk = 0, s = 0; for (const v of d) { pk = Math.max(pk, Math.abs(v)); s += v * v; } return { pk, e: s }; };
  const attack = (d) => { const pk = Math.max(...d.map(Math.abs)); const i = d.findIndex((v) => Math.abs(v) >= 0.9 * pk); return (i / SR - 0.01) * 1000; };
  const list = {
    djembe: (c, o, t) => A.inst.djembe(c, o, t, 0.5),
    conga_slap: (c, o, t) => A.inst.conga(c, o, t, true),
    conga_open: (c, o, t) => A.inst.conga(c, o, t, false),
    shaker: (c, o, t) => A.inst.shaker(c, o, t, 0.13),
    agogo_low: (c, o, t) => A.inst.agogo(c, o, t, false),
    agogo_high: (c, o, t) => A.inst.agogo(c, o, t, true),
    kalimba: (c, o, t) => A.inst.kalimba(c, o, t, 587.33),
    bass: (c, o, t) => A.inst.bass(c, o, t, 98),
  };
  const out = {};
  for (const [name, play] of Object.entries(list)) {
    // average over several renders: the noise is random
    let pk = 0, e = 0, eh = 0, att = 0;
    for (let k = 0; k < 4; k++) {
      const full = await render(play, 0);
      const hi = await render(play, 2000);
      const sf = stat(full), sh = stat(hi);
      pk = Math.max(pk, sf.pk); e += sf.e; eh += sh.e; att += attack(full);
    }
    out[name] = { peak: pk, highShare: eh / e, attackMs: att / 4 };
  }
  return out;
})()`);
console.log("instrument     peak   energy>2kHz  attack");
for (const [n, r] of Object.entries(rows)) {
  console.log(`${n.padEnd(13)} ${r.peak.toFixed(2).padStart(5)}  ${(r.highShare * 100).toFixed(0).padStart(8)}%   ${r.attackMs.toFixed(1).padStart(5)}ms`);
}
await b.close();
