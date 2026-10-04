// Pure WebAudio synthesis for MRTVÍ. Every voice takes any BaseAudioContext (live or
// offline), the shared noise kit `B` (makeBuffers), an output node and a start time.
// No state lives here; src/audio.js owns routing, spatialisation and scheduling.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const J = Math.random;                       // per-sound jitter only (allowed by contract)
const rr = (a, b, r = J) => a + (b - a) * r();
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function prng(seed) {
  let s = (Math.imul(seed | 0, 2654435761) >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// ---------- building blocks ----------

export function gain(ctx, v = 1) { const g = ctx.createGain(); g.gain.value = v; return g; }
export function filt(ctx, type, f, Q = 0.707) {
  const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; return b;
}
export function shaper(ctx, drive = 2) {
  const n = 1024, c = new Float32Array(n), k = Math.tanh(drive);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(drive * x) / k; }
  const s = ctx.createWaveShaper(); s.curve = c; s.oversample = '2x'; return s;
}
// Looping noise source from a random offset.
export function noise(ctx, buf, t, dur, rate = 1) {
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
  s.start(t, J() * (buf.duration - 0.1)); s.stop(t + dur + 0.03); return s;
}
export function osc(ctx, type, f, t, dur) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(t); o.stop(t + dur + 0.03); return o;
}
// Percussive envelope: 0 → peak in a, exponential to −80 dB over d.
export function perc(p, t, a, peak, d) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.exponentialRampToValueAtTime(Math.max(1e-5, peak * 1e-4), t + a + d);
  p.linearRampToValueAtTime(0, t + a + d + 0.005);
}
// A gain whose envelope is a train of decaying spikes (grit, crunch, bubbles, rattles).
const SPK = 2000;
function spikeCurve(dur, count, { decay = 0.003, amp = [0.3, 1], t0 = 0, t1 = 1, r = J } = {}) {
  const n = Math.max(2, Math.ceil(dur * SPK)), c = new Float32Array(n);
  for (let k = 0; k < count; k++) {
    const s = (t0 + (t1 - t0) * r()) * dur, a = rr(amp[0], amp[1], r), dk = decay * rr(0.6, 1.5, r);
    for (let i = Math.floor(s * SPK); i < n; i++) {
      const v = a * Math.exp(-(i / SPK - s) / dk);
      if (v < 1e-3) break;
      c[i] += v;
    }
  }
  c[n - 1] = 0;
  return c;
}
function spikeGain(ctx, t, dur, count, o) {
  const g = gain(ctx, 0); g.gain.setValueCurveAtTime(spikeCurve(dur, count, o), t, dur); return g;
}
function chainTo(out, ...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); nodes[nodes.length - 1].connect(out); }

// ---------- noise kit + impulse responses ----------

export function makeBuffers(ctx) {
  const sr = ctx.sampleRate, n = Math.floor(sr * 4), r = prng(99);
  const mk = () => ctx.createBuffer(1, n, sr);
  const white = mk(), pink = mk(), brown = mk();
  const w = white.getChannelData(0), p = pink.getChannelData(0), b = brown.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < n; i++) {
    const x = r() * 2 - 1;
    w[i] = x;
    b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362; b6 = x * 0.115926;
    br = (br + 0.02 * x) / 1.02; b[i] = br;
  }
  const seam = (a) => { const d = a[n - 1] - a[0]; for (let i = 0; i < n; i++) a[i] -= d * i / n; };
  const norm = (a, pk) => { let m = 0, mean = 0; for (let i = 0; i < n; i++) mean += a[i]; mean /= n; for (let i = 0; i < n; i++) { a[i] -= mean; m = Math.max(m, Math.abs(a[i])); } for (let i = 0; i < n; i++) a[i] *= pk / m; };
  seam(b); seam(p); norm(w, 0.9); norm(p, 0.9); norm(b, 0.9);
  return { white, pink, brown };
}

// Procedural impulse responses. 'street': stone canyon — façade slaps, flutter between
// parallel walls, a couple of late echoes off the far end, long darkening tail.
// 'room': small dry interior.
export function makeIR(ctx, kind = 'street') {
  const sr = ctx.sampleRate;
  const P = kind === 'room'
    ? { len: 0.6, rt: 0.42, pre: 0.003, c0: 5000, c1: 1400, early: 18, earlyEnd: 0.025, flutter: 0, echoes: [], tail: 0.35 }
    : { len: 4.2, rt: 3.4, pre: 0.016, c0: 7000, c1: 650, early: 12, earlyEnd: 0.11, flutter: 0.061, echoes: [[0.34, 0.32], [0.72, 0.2], [1.18, 0.11]], tail: 0.22 };
  const n = Math.floor(P.len * sr), buf = ctx.createBuffer(2, n, sr), r = prng(kind === 'room' ? 7 : 3);
  const burst = (d, t, amp, smear) => {
    const i0 = Math.floor(t * sr), m = Math.floor(smear * sr);
    for (let j = 0; j < m * 6 && i0 + j < n; j++) d[i0 + j] += amp * (r() * 2 - 1) * Math.exp(-j / m);
  };
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if (t < P.pre) continue;
      const env = 10 ** (-3 * (t - P.pre) / P.rt) * Math.min(1, (t - P.pre) / 0.05) * (1 - sstep(P.len * 0.85, P.len, t));
      const cut = P.c1 + (P.c0 - P.c1) * Math.exp(-t / (P.rt * 0.25));
      const a = 1 - Math.exp(-2 * Math.PI * cut / sr);
      lp += a * ((r() * 2 - 1) * env - lp);
      d[i] = lp * P.tail * 4;
    }
    for (let k = 0; k < P.early; k++) {
      const t = P.pre + r() * P.earlyEnd;
      burst(d, t, (r() < 0.5 ? -1 : 1) * rr(0.25, 0.7, r) * 10 ** (-3 * t / P.rt), 0.0006);
    }
    if (P.flutter) for (let k = 1; k <= 22; k++) {
      const t = P.pre + k * P.flutter * (1 + (r() - 0.5) * 0.05 + ch * 0.004);
      burst(d, t, 0.38 * 0.8 ** k, 0.0012 + k * 0.0003);
    }
    for (const [t, a] of P.echoes) burst(d, t + ch * 0.007, a, 0.012);
  }
  return buf;
}

// ---------- player / weapons ----------

export function footstep(ctx, B, out, t, surface = 'cobble', loud = 0.6) {
  const g = gain(ctx, 0.25 + 0.75 * clamp(loud, 0, 1)); g.connect(out);
  const v = () => rr(0.8, 1.2);
  // heel thud (all surfaces, quieter on water)
  const thg = gain(ctx, 0);
  perc(thg.gain, t, 0.003, (surface === 'water' ? 0.4 : surface === 'wood' ? 1.1 : 0.9) * v(), rr(0.07, 0.11));
  chainTo(g, noise(ctx, B.brown, t, 0.2), filt(ctx, 'lowpass', surface === 'wood' ? 280 : rr(170, 260), 1.3), thg);
  if (surface === 'cobble' || surface === 'stone' || surface === 'glass') {
    // shoe scuffing grit on stone ('stone' = smoother slabs, a little brighter)
    const br = surface === 'stone' ? 1.5 : 1;
    const sg = gain(ctx, 0); const d = rr(0.06, 0.13);
    perc(sg.gain, t + rr(0, 0.015), rr(0.004, 0.012), 0.3 * v(), d);
    chainTo(g, noise(ctx, B.white, t, d + 0.05), filt(ctx, 'bandpass', rr(900, 2400) * br, 0.9), sg);
    chainTo(g, noise(ctx, B.white, t, 0.13), filt(ctx, 'bandpass', rr(2500, 4000) * br, 1.5), spikeGain(ctx, t, 0.12, 2 + (J() * 4 | 0), { decay: 0.0015, amp: [0.15, 0.5], t1: 0.7 }));
  }
  if (surface === 'tiles') {
    // hard heel tap on ceramic + a small room slap
    const f = rr(1800, 2600);
    const tk = gain(ctx, 2); tk.connect(g);
    click(ctx, B, tk, t + 0.002, f, 0.5, 0.025);
    click(ctx, B, g, t + rr(0.012, 0.02), f * rr(0.85, 0.95), 0.12, 0.02);
    const sl = gain(ctx, 0); perc(sl.gain, t + rr(0.022, 0.03), 0.002, 0.12, 0.05);
    chainTo(g, noise(ctx, B.white, t + 0.02, 0.1), filt(ctx, 'bandpass', rr(1200, 1800), 1.2), sl);
  }
  if (surface === 'wood') {
    const kg = gain(ctx, 0); perc(kg.gain, t, 0.002, 2.4 * v(), rr(0.12, 0.18));
    chainTo(g, noise(ctx, B.white, t, 0.25), filt(ctx, 'bandpass', rr(150, 230), 4), kg);
    const hg = gain(ctx, 0); perc(hg.gain, t, 0.002, 0.4, 0.06);
    chainTo(g, noise(ctx, B.white, t, 0.1), filt(ctx, 'bandpass', rr(500, 750), 2), hg);
    if (J() < 0.3) {   // floorboard creak
      const c = osc(ctx, 'sawtooth', rr(35, 55), t + 0.04, 0.3);
      c.frequency.linearRampToValueAtTime(rr(25, 70), t + 0.3);
      const cg = gain(ctx, 0); perc(cg.gain, t + 0.04, 0.06, 0.5, 0.22);
      chainTo(g, c, filt(ctx, 'bandpass', rr(700, 1100), 12), cg);
    }
  }
  if (surface === 'glass') {
    chainTo(g, noise(ctx, B.white, t, 0.2), filt(ctx, 'bandpass', rr(3500, 6000), 1.5), spikeGain(ctx, t, 0.18, 10 + (J() * 7 | 0), { decay: 0.003, amp: [0.15, 0.6], t1: 0.8 }));
    chainTo(g, noise(ctx, B.white, t, 0.25), filt(ctx, 'bandpass', rr(6000, 8500), 25), spikeGain(ctx, t, 0.24, 4 + (J() * 4 | 0), { decay: 0.015, amp: [0.8, 1.6], t1: 0.5 }));
  }
  if (surface === 'water') {
    const sp = filt(ctx, 'bandpass', 400, 1.2);
    sp.frequency.setValueAtTime(rr(350, 500), t); sp.frequency.exponentialRampToValueAtTime(rr(1800, 2600), t + 0.12);
    const sg = gain(ctx, 0); perc(sg.gain, t, 0.01, 0.9 * v(), rr(0.18, 0.26));
    chainTo(g, noise(ctx, B.white, t, 0.3), sp, sg);
    const lg = gain(ctx, 0); perc(lg.gain, t + 0.02, 0.03, 0.6, 0.25);
    chainTo(g, noise(ctx, B.brown, t, 0.35), filt(ctx, 'lowpass', 420), lg);
    for (let k = 0; k < 2 + (J() * 2 | 0); k++) {   // bubbles rise in pitch
      const tb = t + rr(0.03, 0.2), f = rr(350, 700);
      const b = osc(ctx, 'sine', f, tb, 0.04); b.frequency.exponentialRampToValueAtTime(f * rr(1.8, 2.6), tb + 0.03);
      const bg = gain(ctx, 0); perc(bg.gain, tb, 0.002, 0.12, 0.035);
      chainTo(g, b, bg);
    }
  }
}

export function swing(ctx, B, out, t) {
  const bp = filt(ctx, 'bandpass', 350, 1.8);
  bp.frequency.setValueAtTime(rr(300, 400), t);
  bp.frequency.exponentialRampToValueAtTime(rr(1600, 2200), t + 0.12);
  bp.frequency.exponentialRampToValueAtTime(rr(400, 550), t + 0.32);
  const g = gain(ctx, 0);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1.0, t + 0.11); g.gain.exponentialRampToValueAtTime(0.001, t + 0.33); g.gain.linearRampToValueAtTime(0, t + 0.34);
  const pan = ctx.createStereoPanner(); pan.pan.setValueAtTime(0.6, t); pan.pan.linearRampToValueAtTime(-0.6, t + 0.3);
  chainTo(out, noise(ctx, B.pink, t, 0.36), bp, g, pan);
}

export function hitFlesh(ctx, B, out, t) {
  const sh = shaper(ctx, 1.6), g = gain(ctx, 0.85); sh.connect(g).connect(out);
  const o = osc(ctx, 'sine', 120, t, 0.2); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  const og = gain(ctx, 0); perc(og.gain, t, 0.002, 0.9, 0.18); chainTo(sh, o, og);
  const tg = gain(ctx, 0); perc(tg.gain, t, 0.002, 0.9, 0.12);
  chainTo(sh, noise(ctx, B.brown, t, 0.15), filt(ctx, 'lowpass', 320), tg);
  const sq = filt(ctx, 'bandpass', 1400, 3); sq.frequency.setValueAtTime(rr(1200, 1600), t); sq.frequency.exponentialRampToValueAtTime(rr(300, 400), t + 0.15);
  const sg = gain(ctx, 0); perc(sg.gain, t + 0.005, 0.006, 0.8, 0.2);
  chainTo(sh, noise(ctx, B.white, t, 0.25), sq, sg);
  chainTo(sh, noise(ctx, B.white, t, 0.25), filt(ctx, 'bandpass', rr(500, 750), 6), spikeGain(ctx, t, 0.22, 6, { decay: 0.008, amp: [0.8, 2], t0: 0.12, t1: 0.9 }));
  chainTo(sh, noise(ctx, B.white, t, 0.06), filt(ctx, 'bandpass', rr(1900, 2600), 1), spikeGain(ctx, t, 0.06, 3 + (J() * 3 | 0), { decay: 0.0025, amp: [0.5, 1], t1: 0.65 }));
}

export function gunshot(ctx, B, out, t) {
  const sh = shaper(ctx, 2.5), g = gain(ctx, 1.0); sh.connect(g).connect(out);
  const cg = gain(ctx, 0); perc(cg.gain, t, 0.0004, 1.6, 0.03);
  chainTo(sh, noise(ctx, B.white, t, 0.05), filt(ctx, 'highpass', 1800), cg);
  const bg = gain(ctx, 0); perc(bg.gain, t, 0.001, 1.3, 0.24);
  chainTo(sh, noise(ctx, B.pink, t, 0.3), filt(ctx, 'lowpass', 1400, 0.9), bg);
  const o = osc(ctx, 'sine', 160, t, 0.3); o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
  const og = gain(ctx, 0); perc(og.gain, t, 0.001, 1.0, 0.22); chainTo(sh, o, og);
  const mg = gain(ctx, 0); perc(mg.gain, t + 0.045, 0.0005, 0.25, 0.03);   // slide cycling
  chainTo(g, noise(ctx, B.white, t + 0.04, 0.06), filt(ctx, 'bandpass', 3000, 3), mg);
}

// Hit confirmation: a tiny dry tick (~3 kHz).
export function hitMarker(ctx, B, out, t) {
  const p = rr(0.94, 1.06);                                    // ±6 % pitch so a burst of hits doesn't machine-gun
  click(ctx, B, out, t, 3000 * p, 0.3, 0.008);
  const o = osc(ctx, 'sine', 3000 * p, t, 0.06), g = gain(ctx, 0); perc(g.gain, t, 0.0008, 0.5, 0.035); chainTo(out, o, g);
}
// Headshot: sharper, brighter tick + a short wet bone crunch underneath.
export function headshot(ctx, B, out, t) {
  const p = rr(0.94, 1.06);
  click(ctx, B, out, t, 4100 * p, 1.0, 0.01);
  const o = osc(ctx, 'sine', 4100 * p, t, 0.03), g = gain(ctx, 0); perc(g.gain, t, 0.0004, 0.3, 0.008); chainTo(out, o, g);
  chainTo(out, noise(ctx, B.white, t + 0.006, 0.09), filt(ctx, 'bandpass', rr(800, 1100), 1.4), spikeGain(ctx, t + 0.006, 0.08, 6 + (J() * 4 | 0), { decay: 0.005, amp: [0.5, 1.0] }));
  const k = osc(ctx, 'sine', 180, t, 0.08); k.frequency.exponentialRampToValueAtTime(70, t + 0.06);
  const kg = gain(ctx, 0); perc(kg.gain, t + 0.004, 0.001, 0.6, 0.04); chainTo(out, k, kg);
}

function click(ctx, B, out, t, f, amp, ring = 0.03) {
  const g = gain(ctx, 0); perc(g.gain, t, 0.0005, amp, 0.02);
  chainTo(out, noise(ctx, B.white, t, 0.04), filt(ctx, 'bandpass', f, 4), g);
  const pg = gain(ctx, 0); perc(pg.gain, t, 0.0005, amp * 3, ring);
  chainTo(out, noise(ctx, B.white, t, ring + 0.02), filt(ctx, 'bandpass', f * 1.37, 30), pg);
}
function slide(ctx, B, out, t, d, f0, f1, amp) {
  const bp = filt(ctx, 'bandpass', f0, 2); bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + d);
  const g = gain(ctx, 0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + d * 0.3); g.gain.linearRampToValueAtTime(0, t + d);
  chainTo(out, noise(ctx, B.white, t, d + 0.02), bp, g);
}
export function dryFire(ctx, B, out, t) {
  click(ctx, B, out, t, 2600, 0.9, 0.04);
  click(ctx, B, out, t + 0.018, 3400, 0.4, 0.02);
}
export function reload(ctx, B, out, t) {
  click(ctx, B, out, t, 2500, 0.5);
  slide(ctx, B, out, t + 0.08, 0.18, 1500, 900, 0.25);
  click(ctx, B, out, t + 0.72, 1200, 0.8);
  click(ctx, B, out, t + 0.75, 3000, 0.5);
  slide(ctx, B, out, t + 1.05, 0.12, 1200, 2600, 0.3);
  click(ctx, B, out, t + 1.2, 1800, 1.0, 0.05);
}

// ---------- voices ----------

function glottal(ctx, r, tilt) {
  const N = 64, re = new Float32Array(N), im = new Float32Array(N);
  for (let n = 1; n < N; n++) im[n] = (1 + (r() - 0.5) * 0.4) / n ** tilt;
  return ctx.createPeriodicWave(re, im);
}

// The dead. Glottal source with jittered pitch and period-doubling AM (vocal fry),
// through three gliding formant bandpasses + a chest lowpass, breathy noise, and wet
// gurgle (bubbly AM noise + rising sine bubbles), soft-saturated.
export function groan(ctx, B, out, t, o = {}) {
  const r = prng(o.seed ?? 1), snarl = o.snarl ? 1 : 0;
  const dur = o.dur ?? (snarl ? 0.7 + r() * 0.5 : 1.4 + r() * 1.1);
  const f0 = o.f0 ?? (snarl ? 105 + r() * 35 : 70 + r() * 45);
  const src = ctx.createOscillator(); src.setPeriodicWave(glottal(ctx, r, 1.2 - 0.3 * snarl));
  const K = Math.max(8, Math.ceil(dur * 40)), pc = new Float32Array(K), shape = (r() * 3) | 0, wf = 1.5 + r() * 2;
  let jit = 0;
  for (let k = 0; k < K; k++) {
    const u = k / (K - 1);
    const c = shape === 0 ? 0.9 + 0.3 * Math.sin(Math.PI * u) - 0.15 * u
      : shape === 1 ? 1.15 - 0.4 * u : 1 + 0.1 * Math.sin(u * Math.PI * 2 * wf);
    jit = jit * 0.6 + (r() - 0.5) * (0.1 + 0.06 * snarl);
    let f = f0 * c * (1 + jit);
    if (r() < 0.05 + 0.05 * snarl) f *= 0.5;      // fry break
    pc[k] = clamp(f, 30, 400);
  }
  src.frequency.setValueCurveAtTime(pc, t, dur);
  src.start(t); src.stop(t + dur + 0.05);
  // period doubling: AM at f0/2 makes alternate cycles weaker → creak
  const am = gain(ctx, 0.62);
  const lfo = ctx.createOscillator(); lfo.type = 'triangle';
  lfo.frequency.setValueCurveAtTime(pc.map((x) => x * 0.5), t, dur); lfo.start(t); lfo.stop(t + dur + 0.05);
  const lg = gain(ctx, 0.28 + 0.12 * snarl + r() * 0.1); lfo.connect(lg).connect(am.gain);
  src.connect(am);
  const mix = gain(ctx, 1);
  const vA = [rr(380, 520, r), rr(750, 1000, r), rr(2200, 2600, r)];
  const vB = snarl ? [rr(700, 850, r), rr(1150, 1400, r), rr(2500, 2900, r)] : [rr(550, 720, r), rr(950, 1250, r), rr(2300, 2700, r)];
  const fg = [1.8, 1.2, 0.6], fq = [6, 9, 12], mid = t + dur * (0.35 + r() * 0.4);
  const breath = gain(ctx, 0), breathPeak = 0.35 + 0.25 * snarl;
  const bps = vA.map((f, i) => {
    const b = filt(ctx, 'bandpass', f, fq[i]);
    b.frequency.setValueAtTime(f, t); b.frequency.linearRampToValueAtTime(vB[i], mid); b.frequency.linearRampToValueAtTime(f * rr(0.9, 1.05, r), t + dur);
    am.connect(b); breath.connect(b); b.connect(gain(ctx, fg[i])).connect(mix);
    return b;
  });
  chainTo(mix, am, filt(ctx, 'lowpass', 320, 1), gain(ctx, 0.18));            // chest
  // amplitude envelope with irregular swells
  const E = Math.max(8, Math.ceil(dur * 60)), ec = new Float32Array(E);
  let sw = 1;
  for (let k = 0; k < E; k++) {
    const u = k / (E - 1);
    sw = clamp(sw + (r() - 0.5) * 0.25, 0.55, 1);
    ec[k] = sstep(0, snarl ? Math.min(0.12, 0.05 / dur) : 0.22, u) * (1 - sstep(0.62, 1, u)) * sw;   // snarl: full within ~50 ms
  }
  ec[E - 1] = 0;
  breath.gain.setValueCurveAtTime(ec.map((x) => x * breathPeak), t, dur);
  chainTo(breath, noise(ctx, B.pink, t, dur));
  chainTo(mix, breath, filt(ctx, 'highpass', 1500), gain(ctx, 0.15));
  // gurgle: throat-band noise in wet bursts + rising bubbles
  const gN = Math.round(dur * rr(8, 22, r));
  chainTo(mix, noise(ctx, B.white, t, dur), filt(ctx, 'bandpass', rr(280, 600, r), 3), spikeGain(ctx, t, dur, gN, { decay: 0.012, amp: [0.3, 1.1], t0: 0.1, t1: 0.95, r }));
  const BN = Math.ceil(dur * 1000), bf = new Float32Array(BN).fill(200), bgc = new Float32Array(BN);
  for (let k = 0, nb = Math.round(dur * rr(3, 9, r)); k < nb; k++) {
    const s = Math.floor(rr(0.1, 0.9, r) * BN), L = Math.floor(rr(12, 30, r)), f = rr(220, 520, r);
    for (let i = 0; i < L && s + i < BN; i++) { bf[s + i] = f * (1 + 0.9 * i / L); bgc[s + i] = Math.max(bgc[s + i], 0.12 * Math.sin(Math.PI * i / L)); }
  }
  bgc[BN - 1] = 0;
  const bo = ctx.createOscillator(); bo.frequency.setValueCurveAtTime(bf, t, dur); bo.start(t); bo.stop(t + dur + 0.05);
  const bg = gain(ctx, 0); bg.gain.setValueCurveAtTime(bgc, t, dur); bo.connect(bg).connect(mix);
  const env = gain(ctx, 0); env.gain.setValueCurveAtTime(ec, t, dur);
  chainTo(out, mix, shaper(ctx, 1.8), env, gain(ctx, o.level ?? 0.9));
  return dur;
}

// A body hitting the ground: heavy low thud, cloth/gear rustle, a small gear knock.
export function bodyFall(ctx, B, out, t) {
  const tg = gain(ctx, 0); perc(tg.gain, t, 0.002, 0.9, 0.25);
  chainTo(out, noise(ctx, B.brown, t, 0.35), filt(ctx, 'lowpass', rr(160, 200), 1.1), gain(ctx, 2.2), tg);
  const o = osc(ctx, 'sine', rr(70, 85), t, 0.25); o.frequency.exponentialRampToValueAtTime(38, t + 0.15);
  const og = gain(ctx, 0); perc(og.gain, t, 0.003, 0.5, 0.18); chainTo(out, o, og);
  const t2 = t + rr(0.09, 0.16), sg = gain(ctx, 0); perc(sg.gain, t2, 0.004, 0.45, 0.12);   // second (limb) impact
  chainTo(out, noise(ctx, B.brown, t2, 0.2), filt(ctx, 'lowpass', 220), gain(ctx, 1.8), sg);
  const rg = gain(ctx, 0); rg.gain.setValueAtTime(0, t); rg.gain.linearRampToValueAtTime(0.07, t + 0.02); rg.gain.exponentialRampToValueAtTime(0.001, t + 0.4); rg.gain.linearRampToValueAtTime(0, t + 0.41);
  chainTo(out, noise(ctx, B.pink, t, 0.45), filt(ctx, 'bandpass', rr(1200, 2200), 0.8), rg);
  chainTo(out, noise(ctx, B.white, t, 0.4), filt(ctx, 'bandpass', rr(2500, 3500), 1.2), spikeGain(ctx, t, 0.38, 5 + (J() * 5 | 0), { decay: 0.004, amp: [0.04, 0.12], t1: 0.8 }));
  if (J() < 0.6) click(ctx, B, out, t + rr(0.05, 0.2), rr(1400, 2400), 0.05, 0.04);
  return 0.6;
}

export function hurt(ctx, B, out, t) {
  const r = J, sh = shaper(ctx, 1.4); sh.connect(gain(ctx, 0.85)).connect(out);
  const f0 = rr(105, 135);
  const s = ctx.createOscillator(); s.setPeriodicWave(glottal(ctx, r, 1.1));
  s.frequency.setValueAtTime(f0 * 1.2, t); s.frequency.exponentialRampToValueAtTime(f0 * 0.8, t + 0.3);
  s.start(t); s.stop(t + 0.4);
  const vg = gain(ctx, 0); perc(vg.gain, t, 0.015, 1, 0.32); s.connect(vg);
  for (const [f, q, a] of [[rr(560, 650), 6, 3], [rr(1000, 1150), 9, 1.8], [2450, 12, 0.9]]) chainTo(sh, vg, filt(ctx, 'bandpass', f, q), gain(ctx, a));
  chainTo(sh, vg, filt(ctx, 'lowpass', 300), gain(ctx, 0.4));
  // shaky exhale, then a ragged inhale
  const eg = gain(ctx, 0); eg.gain.setValueAtTime(0, t + 0.2); eg.gain.linearRampToValueAtTime(0.5, t + 0.27); eg.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
  const trem = gain(ctx, 0.7), tl = osc(ctx, 'sine', rr(6, 9), t, 1.4), tlg = gain(ctx, 0.3); tl.connect(tlg).connect(trem.gain);
  chainTo(sh, noise(ctx, B.pink, t + 0.2, 0.7), filt(ctx, 'bandpass', 1300, 0.8), eg, trem);
  const ig = gain(ctx, 0); ig.gain.setValueAtTime(0, t + 0.85); ig.gain.linearRampToValueAtTime(0.25, t + 1.15); ig.gain.linearRampToValueAtTime(0, t + 1.2);
  chainTo(sh, noise(ctx, B.white, t + 0.85, 0.4), filt(ctx, 'bandpass', 2300, 1), ig, trem);
}

export function heartbeat(ctx, B, out, t, rate = 80) {
  const gap = clamp(60 / rate * 0.36, 0.18, 0.34), amp = clamp(0.5 + (rate - 60) / 120, 0.5, 1);
  const sh = shaper(ctx, 2.2); sh.connect(out);
  for (const [dt, a, f] of [[0, 1, 70], [gap, 0.7, 60]]) {
    const tt = t + dt;
    const o = osc(ctx, 'sine', f, tt, 0.2); o.frequency.exponentialRampToValueAtTime(f * 0.6, tt + 0.1);
    const g = gain(ctx, 0); perc(g.gain, tt, 0.008, a * amp, 0.15); chainTo(sh, o, g);
    const ng = gain(ctx, 0); perc(ng.gain, tt, 0.005, a * amp * 0.5, 0.08);
    chainTo(sh, noise(ctx, B.brown, tt, 0.12), filt(ctx, 'lowpass', 140), ng);
  }
}

export function pickup(ctx, B, out, t) {
  chainTo(out, noise(ctx, B.white, t, 0.3), filt(ctx, 'bandpass', rr(4000, 5000), 3), spikeGain(ctx, t, 0.28, 10 + (J() * 5 | 0), { decay: 0.003, amp: [0.5, 1.6] }));
  const rg = gain(ctx, 0); perc(rg.gain, t, 0.04, 0.35, 0.25);
  chainTo(out, noise(ctx, B.pink, t, 0.35), filt(ctx, 'bandpass', 2500, 0.7), rg);
  for (const [f, dt] of [[392, 0.05], [587.3, 0.17]]) {
    const g = gain(ctx, 0); perc(g.gain, t + dt, 0.02, 0.12, 1.3);
    chainTo(out, osc(ctx, 'sine', f, t + dt, 1.4), g);
    const g2 = gain(ctx, 0); perc(g2.gain, t + dt, 0.02, 0.03, 0.6);
    chainTo(out, osc(ctx, 'sine', f * 2.01, t + dt, 0.7), g2);
  }
}

export function door(ctx, B, out, t) {
  click(ctx, B, out, t, 2000, 0.6, 0.04);
  const dur = rr(0.8, 1.2), t1 = t + 0.08;
  const K = Math.ceil(dur * 30), fc = new Float32Array(K), ec = new Float32Array(K);
  let f = rr(20, 30);
  for (let k = 0; k < K; k++) {
    const u = k / (K - 1);
    f = clamp(f + (J() - 0.45) * 10, 12, 75); fc[k] = f;
    ec[k] = sstep(0, 0.1, u) * (1 - sstep(0.8, 1, u)) * rr(0.5, 1);
  }
  ec[K - 1] = 0;
  const s = ctx.createOscillator(); s.type = 'sawtooth'; s.frequency.setValueCurveAtTime(fc, t1, dur); s.start(t1); s.stop(t1 + dur + 0.05);
  const eg = gain(ctx, 0); eg.gain.setValueCurveAtTime(ec, t1, dur); s.connect(eg);
  for (const [fr, q, a] of [[rr(500, 700), 8, 2.2], [rr(1100, 1500), 10, 1.5], [rr(2200, 2600), 12, 0.8]]) chainTo(out, eg, filt(ctx, 'bandpass', fr, q), gain(ctx, a));
  const fg = gain(ctx, 0); fg.gain.setValueCurveAtTime(ec.map((x) => x * 0.08), t1, dur);
  chainTo(out, noise(ctx, B.white, t1, dur), filt(ctx, 'bandpass', 1800, 2), fg);
  const tg = gain(ctx, 0); perc(tg.gain, t1 + dur, 0.003, 1, 0.3);
  chainTo(out, noise(ctx, B.brown, t1 + dur, 0.35), filt(ctx, 'lowpass', 160), tg);
  return dur + 0.4;
}

export function chord(ctx, B, out, t) {
  const lp = filt(ctx, 'lowpass', 500, 0.5);
  lp.frequency.setValueAtTime(500, t); lp.frequency.exponentialRampToValueAtTime(1800, t + 2.5); lp.frequency.exponentialRampToValueAtTime(600, t + 8);
  const g = gain(ctx, 0);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 1.4); g.gain.setValueAtTime(0.5, t + 3.5);
  g.gain.exponentialRampToValueAtTime(0.001, t + 8.5); g.gain.linearRampToValueAtTime(0, t + 8.6);
  lp.connect(g).connect(out);
  const sub = osc(ctx, 'sine', 73.42, t, 8.6); sub.connect(gain(ctx, 0.25)).connect(g);
  for (const f of [146.83, 220, 293.66, 369.99, 440, 659.25]) for (const c of [-6, 6]) {
    const o = osc(ctx, 'sawtooth', f, t, 8.6); o.detune.value = c + rr(-2, 2); o.connect(gain(ctx, 0.07)).connect(lp);
  }
  for (const [f, dt] of [[880, 0.1], [1318.5, 0.6]]) {
    const bg = gain(ctx, 0); perc(bg.gain, t + dt, 0.01, 0.05, 3);
    chainTo(out, osc(ctx, 'sine', f, t + dt, 3.1), bg);
  }
  return 8.7;
}

// Heavy bronze bell: inharmonic partials (hum, prime, minor-third tierce, quint, nominal…),
// lower ones ringing longest, beating doublets, plus a short metallic strike transient.
export function bell(ctx, B, out, t, f = 128) {
  const sum = gain(ctx, 0.45); sum.connect(out);
  const P = [[0.5, 0.3, 16], [1, 0.45, 12], [1.19, 0.38, 9], [1.5, 0.18, 6], [2, 0.55, 7], [2.51, 0.22, 4.5], [2.66, 0.18, 3.5], [3.01, 0.14, 2.5], [4.16, 0.09, 1.5], [5.43, 0.06, 0.9], [6.79, 0.04, 0.5]];
  for (const [r, a, d] of P) {
    const parts = r <= 2 ? [[0, a * 0.65], [rr(0.4, 1.2), a * 0.35]] : [[0, a]];
    for (const [df, aa] of parts) {
      const o = osc(ctx, 'sine', f * r + df, t, d); const g = gain(ctx, 0);
      perc(g.gain, t, 0.002, aa, d); o.connect(g).connect(sum);
    }
  }
  const sg = gain(ctx, 0); perc(sg.gain, t, 0.001, 0.5, 0.05);
  chainTo(sum, noise(ctx, B.white, t, 0.08), filt(ctx, 'bandpass', 2600, 1), sg);
  const cg = gain(ctx, 0); perc(cg.gain, t, 0.001, 0.1, 0.08);
  chainTo(sum, osc(ctx, 'sine', f * 8.7, t, 0.1), cg);
  return 16;
}

// ---------- ambience voices ----------

export function bark(ctx, B, out, t, seed = 1) {
  const r = prng(seed), f0 = 380 + r() * 180;
  const s = osc(ctx, 'sawtooth', f0, t, 0.2);
  s.frequency.setValueAtTime(f0 * 0.85, t); s.frequency.linearRampToValueAtTime(f0 * 1.1, t + 0.03); s.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + 0.16);
  const g = gain(ctx, 0); perc(g.gain, t, 0.008, 1, 0.17); s.connect(g);
  for (const [f, q, a] of [[rr(600, 800, r), 5, 2], [rr(1200, 1500, r), 6, 1.4], [2600, 8, 0.6]]) chainTo(out, g, filt(ctx, 'bandpass', f, q), gain(ctx, a));
  const ng = gain(ctx, 0); perc(ng.gain, t, 0.003, 0.3, 0.08);
  chainTo(out, noise(ctx, B.white, t, 0.1), filt(ctx, 'bandpass', 1500, 1), ng);
  return 0.25;
}

export function caw(ctx, B, out, t, seed = 1) {
  const r = prng(seed), f0 = 550 + r() * 200, d = 0.32 + r() * 0.1;
  const s = osc(ctx, 'sawtooth', f0, t, d); s.frequency.exponentialRampToValueAtTime(f0 * 0.75, t + d);
  const am = gain(ctx, 0.5), l = osc(ctx, 'square', 55 + r() * 25, t, d), lg = gain(ctx, 0.5); l.connect(lg).connect(am.gain);
  s.connect(am);
  chainTo(am, noise(ctx, B.white, t, d), filt(ctx, 'bandpass', 2000, 2), gain(ctx, 0.5));
  const g = gain(ctx, 0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.03); g.gain.setValueAtTime(1, t + d * 0.6); g.gain.linearRampToValueAtTime(0, t + d);
  am.connect(g);
  for (const [f, q, a] of [[1300, 4, 1.4], [2100, 5, 1], [3300, 6, 0.5]]) chainTo(out, g, filt(ctx, 'bandpass', f, q), gain(ctx, a));
  return d;
}

// Car alarm: whoop siren, beeps, warble, then the battery dies (sagging, stuttering, cut).
export function alarm(ctx, B, out, t, dur = 20) {
  const R = 400, N = Math.ceil(dur * R), fc = new Float32Array(N), gc = new Float32Array(N);
  let cut = 0;
  for (let i = 0; i < N; i++) {
    const s = i / R, q = s / dur;
    let f, a = 1;
    if (q < 0.25) f = 750 + 850 * ((s * 2.5) % 1);
    else if (q < 0.5) { f = 1400; a = (s * 2.5) % 1 < 0.5 ? 1 : 0; }
    else if (q < 0.75) f = Math.floor(s * 9) % 2 ? 950 : 1350;
    else {
      const u = (q - 0.75) / 0.25;
      f = (750 + 850 * ((s * (2.5 - 1.5 * u)) % 1)) * (1 - 0.4 * u);
      if (cut > 0) { cut--; a = 0; } else if (Math.random() < u * 0.02) cut = Math.floor(Math.random() * R * 0.25 * u);
      a *= 1 - 0.5 * u;
    }
    fc[i] = f; gc[i] = a;
  }
  gc[N - 1] = 0;
  const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueCurveAtTime(fc, t, dur); o.start(t); o.stop(t + dur + 0.05);
  const g = gain(ctx, 0); g.gain.setValueCurveAtTime(gc, t, dur);
  chainTo(out, o, filt(ctx, 'bandpass', 1800, 1.2), shaper(ctx, 2), g, gain(ctx, 0.6));
  return dur;
}
