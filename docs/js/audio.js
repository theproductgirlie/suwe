// Music and sound effects, all synthesised with Web Audio: no audio files.
//
// The music is a looping Nigerian-flavoured groove (highlife / afrobeat feel):
// conga and djembe-style drums, a shekere shaker, an agogo bell playing a
// son-clave pattern, a bass line and a kalimba (thumb piano) melody over
// G - Em - C - D.
//
// Browsers only allow sound after a tap, so nothing starts until unlock() is
// called from a user gesture.

const NOTE = {
  E2: 82.41, G2: 98, C3: 130.81, D3: 146.83,
  G4: 392, A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, C6: 1046.5, E6: 1318.5,
};

// ---- building blocks -------------------------------------------------------------

const noiseBuffers = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseBuffers.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, b);
  }
  return b;
}

// A pitched blip with a quick attack and exponential decay. f2 slides the pitch.
function tone(ctx, out, { t, f, f2, type = "sine", d = 0.15, a = 0.004, gain = 0.3 }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + d);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  o.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(t + a + d + 0.03);
}

// A burst of filtered noise: shakers, whooshes, drum skins.
function noise(ctx, out, { t, f, f2, q = 1, type = "bandpass", d = 0.1, a = 0.003, gain = 0.2 }) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(f, t);
  if (f2) filter.frequency.exponentialRampToValueAtTime(f2, t + a + d);
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  s.connect(filter);
  filter.connect(g);
  g.connect(out);
  s.start(t);
  s.stop(t + a + d + 0.03);
}

// ---- instruments --------------------------------------------------------------------

export const inst = {
  // Low djembe-style bass drum: a soft, round thump (no noise burst, gentle attack),
  // so it sits under the groove instead of banging.
  djembe(ctx, out, t, gain = 0.5) {
    tone(ctx, out, { t, f: 118, f2: 56, d: 0.17, a: 0.012, gain: gain * 0.62 });
  },
  // Conga: a pitched hand-drum hit (open tone) or a softer slap.
  conga(ctx, out, t, slap = false, gain = 0.3) {
    if (slap) {
      tone(ctx, out, { t, f: 420, f2: 330, d: 0.07, a: 0.006, gain: gain * 0.75 });
      noise(ctx, out, { t, f: 1800, q: 1.2, d: 0.04, a: 0.005, gain: gain * 0.28 });
    } else {
      tone(ctx, out, { t, f: 260, f2: 200, d: 0.16, a: 0.006, gain });
    }
  },
  // Shekere: a soft rattle of beads (a band of high noise, not a harsh hiss).
  shaker(ctx, out, t, gain = 0.1) {
    noise(ctx, out, { t, f: 6800, q: 0.9, type: "bandpass", d: 0.05, a: 0.006, gain: gain * 0.8 });
  },
  // Agogo: a two-pitch bell. Sine partials, not square waves, so it rings instead of buzzing.
  agogo(ctx, out, t, high = false, gain = 0.12) {
    const f = high ? 1210 : 905;
    tone(ctx, out, { t, f, d: 0.2, a: 0.006, gain: gain * 0.55 });
    tone(ctx, out, { t, f: f * 2.76, d: 0.09, a: 0.006, gain: gain * 0.18 });
  },
  // Thumb piano (kalimba): a soft pluck with a bright, short overtone.
  kalimba(ctx, out, t, f, gain = 0.2) {
    tone(ctx, out, { t, f, d: 0.45, type: "triangle", gain });
    tone(ctx, out, { t, f: f * 3, d: 0.08, gain: gain * 0.35 });
  },
  bass(ctx, out, t, f, gain = 0.3) {
    tone(ctx, out, { t, f, d: 0.28, a: 0.01, type: "sine", gain: gain * 0.8 });
  },
};

// ---- the music loop -------------------------------------------------------------------

export const BPM = 104;
export const STEPS = 64; // four bars of sixteenth notes: G - Em - C - D
export const stepSeconds = () => 60 / BPM / 4;

const BASS_ROOT = [NOTE.G2, NOTE.E2, NOTE.C3, NOTE.D3];
const BASS_STEPS = [0, 3, 6, 10, 13];
const DJEMBE_STEPS = [0, 8, 11];
const CONGA_SLAP = [2, 7, 10, 15];
const CONGA_OPEN = [5, 13];
const CLAVE_STEPS = [0, 3, 6, 10, 12]; // son clave 3-2
const MELODY = [
  [[0, NOTE.B4], [3, NOTE.D5], [6, NOTE.G5], [8, NOTE.E5], [10, NOTE.D5], [12, NOTE.B4]],
  [[0, NOTE.G4], [3, NOTE.B4], [6, NOTE.E5], [8, NOTE.D5], [11, NOTE.B4], [14, NOTE.G4]],
  [[0, NOTE.E5], [3, NOTE.G5], [6, NOTE.E5], [8, NOTE.D5], [10, NOTE.B4], [13, NOTE.G4]],
  [[0, NOTE.A4], [3, NOTE.D5], [6, NOTE.A4], [8, NOTE.B4], [11, NOTE.D5], [14, NOTE.B4]],
];

// Schedule one sixteenth-note step of the loop at time t.
export function musicStep(ctx, out, step, t) {
  const bar = Math.floor(step / 16) % 4;
  const s = step % 16;
  // shaker on every step, accented on the off-beats
  inst.shaker(ctx, out, t, s % 4 === 2 ? 0.1 : s % 2 === 0 ? 0.06 : 0.04);
  if (DJEMBE_STEPS.includes(s)) inst.djembe(ctx, out, t, s === 0 ? 0.5 : 0.32);
  if (CONGA_SLAP.includes(s)) inst.conga(ctx, out, t, true);
  if (CONGA_OPEN.includes(s)) inst.conga(ctx, out, t, false);
  const c = CLAVE_STEPS.indexOf(s);
  if (c >= 0) inst.agogo(ctx, out, t, c % 2 === 1, 0.09);
  if (BASS_STEPS.includes(s)) inst.bass(ctx, out, t, s === 6 || s === 13 ? BASS_ROOT[bar] * 2 : BASS_ROOT[bar]);
  for (const [at, f] of MELODY[bar]) if (at === s) inst.kalimba(ctx, out, t, f);
}

// ---- sound effects ----------------------------------------------------------------------

export const SFX = {
  ui: (ctx, out, t) => tone(ctx, out, { t, f: 660, f2: 880, d: 0.06, gain: 0.8 }),
  throw: (ctx, out, t) => noise(ctx, out, { t, f: 400, f2: 2600, q: 0.9, d: 0.28, a: 0.03, gain: 1.4 }),
  land: (ctx, out, t) => {
    tone(ctx, out, { t, f: 170, f2: 60, d: 0.14, gain: 0.85 });
    noise(ctx, out, { t, f: 1800, q: 1, d: 0.05, gain: 0.5 });
  },
  hop: (ctx, out, t) => {
    tone(ctx, out, { t, f: 230, f2: 110, d: 0.09, gain: 0.7 });
    noise(ctx, out, { t, f: 900, q: 1, d: 0.03, gain: 0.25 });
  },
  turn: (ctx, out, t) => tone(ctx, out, { t, f: 500, f2: 760, d: 0.12, type: "triangle", gain: 0.9 }),
  pickup: (ctx, out, t) => {
    tone(ctx, out, { t, f: 520, d: 0.1, type: "triangle", gain: 0.26 });
    tone(ctx, out, { t: t + 0.09, f: 780, d: 0.16, type: "triangle", gain: 0.26 });
  },
  good: (ctx, out, t) => {
    tone(ctx, out, { t, f: NOTE.G5, d: 0.28, gain: 0.24 });
    tone(ctx, out, { t: t + 0.1, f: NOTE.C6, d: 0.4, gain: 0.24 });
  },
  fail: (ctx, out, t) => {
    tone(ctx, out, { t, f: 260, f2: 80, d: 0.4, type: "sawtooth", gain: 0.4 });
    tone(ctx, out, { t: t + 0.05, f: 130, f2: 55, d: 0.35, type: "square", gain: 0.2 });
  },
  buzz: (ctx, out, t) => {
    tone(ctx, out, { t, f: 140, d: 0.12, type: "square", gain: 0.2 });
    tone(ctx, out, { t: t + 0.16, f: 140, d: 0.18, type: "square", gain: 0.2 });
  },
  out: (ctx, out, t) => {
    [NOTE.G4, 330, 262].forEach((f, i) => tone(ctx, out, { t: t + i * 0.16, f, d: 0.26, type: "triangle", gain: 0.26 }));
  },
  circuit: (ctx, out, t) => {
    [NOTE.C5, NOTE.E5, NOTE.G5].forEach((f, i) => tone(ctx, out, { t: t + i * 0.09, f, d: 0.3, gain: 0.22 }));
  },
  house: (ctx, out, t) => {
    [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => {
      tone(ctx, out, { t: t + i * 0.1, f, d: 0.5, gain: 0.24 });
      tone(ctx, out, { t: t + i * 0.1, f: f * 2, d: 0.2, gain: 0.07 });
    });
    for (let i = 0; i < 6; i++) inst.shaker(ctx, out, t + 0.45 + i * 0.07, 0.16);
    inst.agogo(ctx, out, t + 0.45, false, 0.2);
    inst.agogo(ctx, out, t + 0.6, true, 0.2);
    inst.djembe(ctx, out, t, 0.45);
    tone(ctx, out, { t: t + 0.45, f: NOTE.E6, d: 0.8, gain: 0.14 });
  },
  drumroll: (ctx, out, t) => {
    for (let i = 0; i < 12; i++) inst.conga(ctx, out, t + i * (0.11 - i * 0.004), i % 3 === 0, 0.12 + i * 0.015);
    inst.djembe(ctx, out, t + 1.1, 0.5);
  },
  win: (ctx, out, t) => {
    const tune = [[NOTE.G4, 0], [NOTE.B4, 0.14], [NOTE.D5, 0.28], [NOTE.G5, 0.42], [NOTE.D5, 0.7], [NOTE.G5, 0.84], [NOTE.C6, 1.0]];
    tune.forEach(([f, dt]) => inst.kalimba(ctx, out, t + dt, f, 0.3));
    inst.djembe(ctx, out, t, 0.5);
    inst.djembe(ctx, out, t + 1.0, 0.5);
    for (let i = 0; i < 10; i++) inst.shaker(ctx, out, t + 0.7 + i * 0.07, 0.15);
  },
};

// Master chain shared by the live game and the offline checks: two buses into a
// compressor, so layered sounds never clip.
export function buildMaster(ctx, destination = ctx.destination) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  const master = ctx.createGain();
  master.gain.value = 0.85;
  // A last-resort limiter: fast and hard, so a burst of layered sounds can never clip.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.05;
  comp.connect(master);
  master.connect(limiter);
  limiter.connect(destination);
  const music = ctx.createGain();
  const sfx = ctx.createGain();
  music.gain.value = 0.5;
  sfx.gain.value = 1.5;
  music.connect(comp);
  sfx.connect(comp);
  return { music, sfx };
}

// ---- the live player -----------------------------------------------------------------------

export const DEFAULT_PREFS = { music: true, sfx: true, voice: false };

export function createAudio(saved, save = () => {}) {
  const prefs = { ...DEFAULT_PREFS, ...(saved && typeof saved === "object" ? saved : {}) };
  let ctx = null;
  let bus = null;
  let timer = null;
  let nextT = 0;
  let step = 0;

  const persist = () => save({ ...prefs });
  const log = []; // names of the effects played, for tests

  function startMusic() {
    if (timer || !ctx || !prefs.music) return;
    nextT = ctx.currentTime + 0.08;
    step = 0;
    timer = setInterval(() => {
      // Schedule a little ahead of the clock so timing stays tight on slow phones.
      while (nextT < ctx.currentTime + 0.2) {
        musicStep(ctx, bus.music, step % STEPS, nextT);
        nextT += stepSeconds();
        step++;
      }
    }, 40);
  }

  function stopMusic() {
    clearInterval(timer);
    timer = null;
  }

  // Call from a tap or key press: browsers refuse to make sound before one.
  function unlock() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        bus = buildMaster(ctx);
      }
      if (ctx.state === "suspended") ctx.resume();
      startMusic();
    } catch {
      /* no audio on this device: the game is still playable */
    }
  }

  // Save battery: stop when the tab is hidden.
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else ctx.resume();
  });

  return {
    prefs,
    unlock,
    state: () => ctx?.state ?? "none",
    played: () => log,
    time: () => ctx?.currentTime ?? 0, // the audio clock (for tests)
    musicSteps: () => step, // how many music steps have been scheduled (for tests)
    sfx(name) {
      if (!ctx || !prefs.sfx || ctx.state !== "running" || !SFX[name]) return;
      try {
        log.push(name);
        SFX[name](ctx, bus.sfx, ctx.currentTime + 0.01);
      } catch {
        /* a failed effect must never stop the game */
      }
    },
    setMusic(on) {
      prefs.music = on;
      persist();
      if (on) startMusic();
      else stopMusic();
    },
    setSfx(on) {
      prefs.sfx = on;
      persist();
    },
    setVoice(on) {
      prefs.voice = on;
      persist();
      if (!on) window.speechSynthesis?.cancel();
    },
    // Optional spoken voice lines (off by default). Prefers a Nigerian English
    // voice, then British, then any English one the device has.
    speak(text) {
      if (!prefs.voice || !window.speechSynthesis || !text) return;
      try {
        const synth = window.speechSynthesis;
        const voices = synth.getVoices();
        const pick = (re) => voices.find((v) => re.test(v.lang.replace("_", "-")));
        const voice = pick(/^en-NG/i) ?? pick(/^en-GB/i) ?? pick(/^en/i) ?? null;
        synth.cancel();
        const u = new SpeechSynthesisUtterance(text);
        if (voice) {
          u.voice = voice;
          u.lang = voice.lang;
        } else {
          u.lang = "en-NG";
        }
        u.rate = 0.95;
        u.pitch = 1.05;
        synth.speak(u);
      } catch {
        /* ignore */
      }
    },
  };
}
