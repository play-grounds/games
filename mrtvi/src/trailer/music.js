// MRTVÍ trailer score: ~80 s of WebAudio synthesis following CUES in ./timeline.js.
// renderScore(ctx, dest, t0, { from }) schedules the whole score into any BaseAudioContext
// (live or offline) with trailer time T mapped to ctx time t0 + T, skipping everything
// before `from`. createScore(game) wraps it for the live trailer: it plays on the game's
// own AudioContext (game.audio.ctx) straight into the game's final limiter
// (game.audio.musicIn; its own limiter only when standalone), so score + game together stay ≤ −1 dBFS. Key: D minor, the same D1/A1 as the game drone.
import * as S from '../audio/synth.js';
import { CUES, LENGTH } from './timeline.js';

const sstep = (a, b, x) => { const t = S.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const D1 = 36.71, D2 = 73.42, A2 = 110, D3 = 146.83, F3 = 174.61, D6 = 1174.66;
const STOP = CUES.find((c) => c.kind === 'stop')?.t ?? 72;
const LOGO = CUES.find((c) => c.kind === 'logo')?.t ?? 74;
const END = LENGTH + 8;                                     // logo tail runs past the picture

// Long dark hall for the score (separate from the game's street/room IRs).
function hallIR(ctx, len = 7, rt = 5.5) {
  const sr = ctx.sampleRate, n = Math.floor(len * sr), buf = ctx.createBuffer(2, n, sr), r = S.prng(1747);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch); let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, env = 10 ** (-3 * t / rt) * Math.min(1, t / 0.08) * (1 - sstep(len * 0.8, len, t));
      const cut = 900 + 5000 * Math.exp(-t / 0.6), a = 1 - Math.exp(-2 * Math.PI * cut / sr);
      lp += a * ((r() * 2 - 1) * env - lp); d[i] = lp * 0.5;
    }
  }
  return buf;
}

export function renderScore(ctx, dest, t0, { from = 0 } = {}) {
  const B = S.makeBuffers(ctx), srcs = [];
  const at = (T) => t0 + T;
  const track = (n) => { srcs.push(n); return n; };
  // Sources never start before `from` (a seek lands mid-layer: start now, envelopes via curve()).
  const osc = (type, f, T0, T1) => { const a = Math.max(T0, from); return track(S.osc(ctx, type, f, at(a), Math.max(0.01, T1 - a))); };
  const noise = (buf, T0, T1, rate = 1) => { const a = Math.max(T0, from); return track(S.noise(ctx, buf, at(a), Math.max(0.01, T1 - a), rate)); };
  // Automate `param` along fn(T) for T in [T0, T1] (clipped to `from`), sampled at `hz`.
  const curve = (param, fn, T0, T1, hz = 20) => {
    const a = Math.max(T0, from); if (T1 - a < 0.05) return false;
    const n = Math.max(2, Math.ceil((T1 - a) * hz) + 1), c = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i] = fn(a + (T1 - a) * i / (n - 1));
    param.setValueAtTime(c[0], at(a)); param.setValueCurveAtTime(c, at(a), T1 - a);
    return a;
  };
  // One-shots may start a little late after a seek; older ones are skipped (never refire).
  const shotAt = (T, late = 0.5) => (T >= from - 0.02 ? T : from - T < late ? from : null);

  // ---- buses: main (cut hard at STOP) and logo, both with a long hall send ----
  const out = S.gain(ctx, 1); out.connect(dest);
  const cut = S.gain(ctx, 1); cut.connect(out);
  if (from < STOP) { cut.gain.setValueAtTime(1, at(STOP - 0.015)); cut.gain.linearRampToValueAtTime(0, at(STOP)); }
  else cut.gain.value = 0;
  const main = S.gain(ctx, 1); main.connect(cut);
  // after the cuts: drop back, then a hard final push into the cut
  curve(main.gain, (T) => 1 - 0.45 * sstep(57, 61, T) + 0.5 * sstep(68.5, 71.9, T) ** 1.3, 56, STOP, 30);
  const hall = new ConvolverNode(ctx, { buffer: hallIR(ctx) }); hall.connect(S.gain(ctx, 0.5)).connect(cut);   // main's tail is cut too
  const mainWet = S.gain(ctx, 1); mainWet.connect(hall);
  const logoHall = new ConvolverNode(ctx, { buffer: hallIR(ctx, 9, 7) }); logoHall.connect(S.gain(ctx, 0.6)).connect(out);
  const logo = S.gain(ctx, 1); logo.connect(out);
  const send = (node, dry, wet, wetBus = mainWet, dryBus = main) => {
    if (dry) node.connect(S.gain(ctx, dry)).connect(dryBus);
    if (wet) node.connect(S.gain(ctx, wet)).connect(wetBus);
  };

  // ---- drone-in: detuned low saws through a slowly moving lowpass + sub ----
  const drone = CUES.find((c) => c.kind === 'drone-in');
  if (drone && from < STOP) {
    const T0 = drone.t, T1 = STOP + 0.02;
    const env = (T) => 0.05 * sstep(T0, T0 + 3, T) + 0.05 * sstep(T0 + 2, T0 + 12, T) + 0.04 * sstep(16, 40, T) + 0.13 * sstep(42, 58, T) + 0.0 * sstep(58, 69, T) + 0.2 * sstep(68.5, 71.9, T);
    const g = S.gain(ctx, 0); curve(g.gain, env, T0, T1);
    const lp = S.filt(ctx, 'lowpass', 200, 1.4); lp.connect(g);
    curve(lp.frequency, (T) => 110 + 240 * sstep(0, 30, T) + 450 * sstep(40, 58, T) + 700 * sstep(58, 72, T) + 60 * Math.sin(T * 2 * Math.PI * 0.07), T0, T1, 10);
    for (const [f, a] of [[D2, 0.22], [D2 * 1.004, 0.22], [D2 * 0.996, 0.18], [A2 * 1.002, 0.13], [D3 * 0.998, 0.08], [F3, 0.05]]) osc('sawtooth', f, T0, T1).connect(S.gain(ctx, a)).connect(lp);
    const sub = S.gain(ctx, 0); curve(sub.gain, (T) => (0.03 * sstep(T0, T0 + 2, T) + 0.03 * sstep(T0 + 2, T0 + 14, T)) * (1 + 0.8 * sstep(42, 70, T)), T0, T1);
    osc('sine', D1, T0, T1).connect(sub); osc('sine', D2, T0, T1).connect(S.gain(ctx, 0.3)).connect(sub);
    send(g, 0.8, 0.35); send(sub, 1, 0);
    // distant rain + wind
    const rain = S.gain(ctx, 0); curve(rain.gain, (T) => 0.012 * sstep(T0, T0 + 5, T) * (1 - 0.4 * sstep(42, 60, T)), T0, T1);
    noise(B.white, T0, T1, 0.97).connect(S.filt(ctx, 'highpass', 1800)).connect(S.filt(ctx, 'lowpass', 6000)).connect(rain);
    const wbp = S.filt(ctx, 'bandpass', 400, 0.8);
    curve(wbp.frequency, (T) => 330 + 160 * Math.sin(T * 0.31) + 90 * Math.sin(T * 0.83 + 1), T0, T1, 10);
    const wind = S.gain(ctx, 0); curve(wind.gain, (T) => (0.03 + 0.015 * Math.sin(T * 0.23 + 2)) * sstep(T0, T0 + 6, T), T0, T1, 10);
    noise(B.brown, T0, T1, 0.9).connect(wbp).connect(wind);
    send(rain, 1, 0.2); send(wind, 1, 0.3);
  }

  // ---- pulse-in: heartbeat, 60 bpm rising gently ----
  const pulse = CUES.find((c) => c.kind === 'pulse-in');
  if (pulse && from < STOP) {
    const pb = S.gain(ctx, 0.25); send(pb, 0.7, 0.12);
    const pAmp = (T) => 1 - 0.4 * sstep(58, 62, T) + 0.4 * sstep(68.5, 71.5, T);
    const bpm = (T) => 60 + 8 * sstep(30, 50, T) + 14 * sstep(50, 72, T);
    for (let T = pulse.t; T < STOP - 0.4; T += 60 / bpm(T)) {
      if (T < from) continue;
      const g = S.gain(ctx, (0.35 + 0.45 * sstep(pulse.t, 58, T)) * pAmp(T)); g.connect(pb);
      S.heartbeat(ctx, B, g, at(T), 60);
    }
  }

  // ---- hit: braam — sub boom, low brass swell, metallic transient, long tail ----
  function hit(T, k = 1, bus = main, wet = mainWet) {
    const t = at(T), end = T + 5;
    const sub = osc('sine', 58, T, end); sub.frequency.setValueAtTime(58, t); sub.frequency.exponentialRampToValueAtTime(30, t + 1.2);
    const sg = S.gain(ctx, 0); S.perc(sg.gain, t, 0.006, 0.9 * k, 3); sub.connect(sg);
    send(sg, 1, 0.15, wet, bus);
    const brass = S.gain(ctx, 0); brass.gain.setValueAtTime(0, t); brass.gain.linearRampToValueAtTime(0.32 * k, t + 0.08);
    brass.gain.setTargetAtTime(0, t + 0.6, 1.1);
    const blp = S.filt(ctx, 'lowpass', 180, 2.5); blp.frequency.setValueAtTime(180, t);
    blp.frequency.linearRampToValueAtTime(1500, t + 0.12); blp.frequency.setTargetAtTime(220, t + 0.3, 0.8);
    const sh = S.shaper(ctx, 2.5); sh.connect(blp).connect(brass);
    for (const [f, a] of [[D2, 0.3], [D2 * 1.006, 0.3], [A2 * 0.997, 0.2], [D1 * 2.003, 0.2], [D3, 0.12]]) osc('sawtooth', f, T, end).connect(S.gain(ctx, a)).connect(sh);
    send(brass, 0.9, 0.55, wet, bus);
    const mt = S.gain(ctx, 0); S.perc(mt.gain, t, 0.001, 0.25 * k, 0.5);
    noise(B.white, T, T + 0.6).connect(S.filt(ctx, 'bandpass', 3200, 3)).connect(mt);
    for (const f of [523, 1187, 1913, 2741]) { const g = S.gain(ctx, 0); S.perc(g.gain, t, 0.001, 0.05 * k, 0.9); osc('sine', f, T, T + 1).connect(g).connect(mt); }
    send(mt, 0.5, 1, wet, bus);
  }

  // ---- riser: noise sweep + rising shepard tones + accelerating pulse, ending on next cue ----
  function riser(T0, T1) {
    const D = T1 - T0, p = (T) => S.clamp((T - T0) / D, 0, 1);
    const rb = S.gain(ctx, 0); curve(rb.gain, (T) => (0.01 + (D > 10 ? 0.12 : 0.2) * p(T) ** 2.2) * (1 + 4 * sstep(T1 - 3.5, T1, T)), T0, T1, 50);
    send(rb, 1, 0.4);
    const bp = S.filt(ctx, 'bandpass', 300, 1.5); curve(bp.frequency, (T) => 250 * 24 ** p(T), T0, T1, 50);
    noise(B.pink, T0, T1).connect(bp).connect(S.gain(ctx, 0.6)).connect(rb);
    const tl = S.filt(ctx, 'lowpass', 2500, 0.7); tl.connect(S.gain(ctx, 0.5)).connect(rb);
    const N = 5, oct = D / 8 * 1.5;                       // ~1.5 octaves per 8 s
    for (let v = 0; v < N; v++) {
      const pos = (T) => (p(T) * oct / 3 + v / N) % 1;   // position in a 3-octave window
      const o = osc('triangle', 110, T0, T1), g = S.gain(ctx, 0);
      curve(o.frequency, (T) => 110 * 2 ** (pos(T) * 3), T0, T1, 100);
      curve(g.gain, (T) => 0.25 * Math.sin(Math.PI * pos(T)) ** 2, T0, T1, 100);
      o.connect(g).connect(tl);
    }
    // accelerating low ticks: interval 0.6 s → 0.07 s
    for (let T = T0; T < T1 - 0.03;) {
      const q = p(T);
      if (T >= from) {
        const t = at(T), g = S.gain(ctx, 0); S.perc(g.gain, t, 0.002, 0.15 + 0.2 * q, 0.12);
        const o = osc('sine', 90 + 60 * q, T, T + 0.2); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
        o.connect(g); send(g, 1, 0.15);
      }
      T += 0.6 * (0.07 / 0.6) ** q;
    }
  }

  // ---- bell: bronze bell in D, under the world chime ----
  function bell(T) { const g = S.gain(ctx, 0.6); send(g, 0.7, 0.9); S.bell(ctx, B, g, at(T), D3); }

  // ---- logo: enormous bell + sub boom, long tail, faint high string ----
  function logoHit(T) {
    const t = at(T);
    const bg = S.gain(ctx, 1.1); send(bg, 0.7, 1, logoHall, logo); S.bell(ctx, B, bg, t, D2);
    const bg2 = S.gain(ctx, 0.3); send(bg2, 0.5, 0.8, logoHall, logo); S.bell(ctx, B, bg2, t + 0.01, D3 * 1.002);
    hit(T, 1.4, logo, logoHall);
    const sub = osc('sine', D1 * 1.5, T, T + 8); sub.frequency.setValueAtTime(D1 * 1.5, t); sub.frequency.exponentialRampToValueAtTime(D1, t + 0.8);
    const sg = S.gain(ctx, 0); S.perc(sg.gain, t, 0.01, 1, 7); sub.connect(sg).connect(logo);
    const st = S.gain(ctx, 0); st.gain.setValueAtTime(0, t + 0.8); st.gain.linearRampToValueAtTime(0.02, t + 2.5);
    st.gain.setTargetAtTime(0, t + 3.5, 1.4);
    const slp = S.filt(ctx, 'lowpass', 2600, 0.7); slp.connect(st);
    const vib = osc('sine', 5.2, T, T + 9); const vg = S.gain(ctx, 4); vib.connect(vg);
    for (const df of [-1.5, 0, 1.7]) { const o = osc('sawtooth', D6 + df, T + 0.7, T + 9); vg.connect(o.frequency); o.connect(slp); }
    send(st, 0.6, 0.9, logoHall, logo);
  }

  // ---- opening hook: a low boom + swell at t=0 so the first second has weight ----
  { const T = shotAt(0); if (T != null) hit(T, 0.3); }

  // ---- swell under "…and they come" (card at 37): brass-ish crescendo to 41, falls away into the riser ----
  function swell(T0, Tp, T1) {
    if (T1 <= from) return;
    const g = S.gain(ctx, 0); curve(g.gain, (T) => 0.2 * (T < Tp ? sstep(T0, Tp, T) ** 2 : 1 - sstep(Tp, T1, T)), T0, T1, 30);
    const lp = S.filt(ctx, 'lowpass', 200, 2); curve(lp.frequency, (T) => 150 + 1300 * (T < Tp ? sstep(T0, Tp, T) ** 2 : 1 - sstep(Tp, T1, T)), T0, T1, 30);
    const sh = S.shaper(ctx, 2); sh.connect(lp).connect(g);
    for (const [f, a] of [[D2, 0.3], [D2 * 1.007, 0.3], [A2 * 0.996, 0.22], [F3 * 1.003, 0.1], [D3, 0.12]]) osc('sawtooth', f, T0, T1).connect(S.gain(ctx, a)).connect(sh);
    send(g, 0.8, 0.6);
  }
  swell(36.5, 41, 42.5);

  CUES.forEach((c, i) => {
    if (c.kind === 'riser') { const next = CUES[i + 1]?.t ?? c.t + 8; if (next > from) riser(Math.max(c.t, 0), next); return; }
    const T = shotAt(c.t, c.kind === 'logo' ? 1.5 : 0.5); if (T == null) return;
    if (c.kind === 'hit' && T < STOP) hit(T, T < 40 ? 0.35 : 0.42);
    else if (c.kind === 'bell' && T < STOP) bell(T);
    else if (c.kind === 'logo') logoHit(T);
  });

  return {
    out, srcs, end: at(END),
    kill(when, fade = 0.02) {
      out.gain.cancelScheduledValues(when); out.gain.setValueAtTime(out.gain.value, when); out.gain.linearRampToValueAtTime(0, when + fade);
      for (const s of srcs) try { s.stop(when + fade + 0.01); } catch {}
      const k = new ConstantSourceNode(ctx, { offset: 0 });       // disconnect on the audio clock, not wall time
      k.connect(out); k.onended = () => { try { k.disconnect(); out.disconnect(); } catch {} };
      k.start(when); k.stop(when + fade + 0.2);
    },
  };
}

// Output chain: limiter keeping peaks ≤ −1 dBFS, music level sitting under the game.
// limit=false: dest already has a limiter (game.audio.musicIn) — plain gain, with the ≈+1.4 dB
// makeup the bypassed limiter would have added so the score keeps its level.
export function makeOutput(ctx, dest = ctx.destination, level = 0.6, limit = true) {
  if (!limit) { const g = S.gain(ctx, level * 1.17); g.connect(dest); return g; }
  const lim = new DynamicsCompressorNode(ctx, { threshold: -2.5, knee: 2, ratio: 20, attack: 0.002, release: 0.3 });
  const g = S.gain(ctx, level); lim.connect(g).connect(dest);
  return lim;
}

export function createScore(game) {
  let ctx = null, outIn = null, sess = null, t0 = 0, own = false;
  const getCtx = () => {
    if (ctx) return ctx;
    ctx = game?.audio?.ctx || null;
    if (!ctx) { own = true; ctx = new (window.AudioContext || window.webkitAudioContext)(); console.warn('[music] game.audio.ctx unavailable — using own AudioContext'); }
    const mi = !own && game?.audio?.musicIn;              // one limiter for score + game
    const shared = !!(mi && mi.context === ctx);
    outIn = makeOutput(ctx, shared ? mi : ctx.destination, 0.6, !shared);
    return ctx;
  };
  function schedule(from) {
    const c = getCtx(), now = c.currentTime;
    if (sess) sess.kill(now);
    from = Math.max(0, from);
    if (from >= END) { sess = null; return; }
    t0 = now + 0.06 - from;
    try { sess = renderScore(c, outIn, t0, { from }); } catch (e) { console.warn('[music]', e); sess = null; }
  }
  return {
    start() { try { if (own && ctx.state === 'suspended') ctx.resume(); schedule(0); } catch (e) { console.warn('[music] start', e); } },
    update(t) {
      if (!sess || !ctx || ctx.state !== 'running') return;
      const expect = ctx.currentTime - t0;
      if (Math.abs(t - expect) > 0.35) schedule(t);    // seek / skip / stall: reschedule from t
    },
    stop() { if (sess && ctx) { sess.kill(ctx.currentTime, 0.3); sess = null; } },
  };
}
