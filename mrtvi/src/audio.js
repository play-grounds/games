// MRTVÍ audio: routing, spatialisation, ambience scheduling. All synthesis is in
// ./audio/synth.js (pure functions on any BaseAudioContext, so tests can render offline).
import * as S from './audio/synth.js';

const rr = (a, b) => a + (b - a) * Math.random();

export function create(game) {
  const L = game.layout;
  let ctx = null, B = null;
  let comp, master, sfxDry, outdoorLP, revIn, streetIn, streetSend, roomSend, echoIn, echoSend, ambBus;
  const amb = {};                       // persistent ambience nodes
  const pre = { moan: [], snarl: [], bark: [], caw: [], bell: null, ms: 0, done: false };
  const lis = { x: 0, y: 0, z: 0 };
  const voices = [];                    // active groans
  let inside = 0, dread = 0, t0 = 0, nextGust = 0, nextDog = 0, nextCrow = 0, nextBeat = 0, alarmDone = false;
  let lastExt = -1, lastSelf = 0, v3 = null;

  const running = () => !!ctx && ctx.state === 'running';
  const now = () => ctx.currentTime + 0.01;

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });
    B = S.makeBuffers(ctx);
    comp = new DynamicsCompressorNode(ctx, { threshold: -16, knee: 12, ratio: 5, attack: 0.003, release: 0.25 });
    master = S.gain(ctx, 0.9);
    comp.connect(master).connect(ctx.destination);
    sfxDry = S.gain(ctx, 1); sfxDry.connect(comp);
    outdoorLP = S.filt(ctx, 'lowpass', 20000, 0.5); outdoorLP.connect(comp);
    // reverbs: street (stone canyon) and room, crossfaded by game.interior.inside
    const streetConv = new ConvolverNode(ctx, { buffer: S.makeIR(ctx, 'street') });
    const roomConv = new ConvolverNode(ctx, { buffer: S.makeIR(ctx, 'room') });
    streetIn = S.gain(ctx, 1); streetIn.connect(streetConv); streetConv.connect(S.gain(ctx, 0.55)).connect(outdoorLP);
    roomConv.connect(S.gain(ctx, 0.45)).connect(comp);
    revIn = S.gain(ctx, 1);
    streetSend = S.gain(ctx, 1); roomSend = S.gain(ctx, 0);
    revIn.connect(streetSend).connect(streetIn); revIn.connect(roomSend).connect(roomConv);
    // discrete façade echoes (gunshots, bells)
    echoIn = S.gain(ctx, 1); echoSend = S.gain(ctx, 1); echoIn.connect(echoSend);
    const eo = S.filt(ctx, 'lowpass', 3000);
    for (const [d, a] of [[0.13, 0.45], [0.31, 0.3]]) { const dl = new DelayNode(ctx, { delayTime: d, maxDelayTime: 1 }); echoSend.connect(dl).connect(S.gain(ctx, a)).connect(eo); }
    const d3 = new DelayNode(ctx, { delayTime: 0.62, maxDelayTime: 1 }), fb = S.gain(ctx, 0.38), fl = S.filt(ctx, 'lowpass', 1800);
    echoSend.connect(d3); d3.connect(fl).connect(fb).connect(d3); d3.connect(S.gain(ctx, 0.35)).connect(eo);
    eo.connect(S.gain(ctx, 0.6)).connect(streetIn); eo.connect(S.gain(ctx, 0.5)).connect(outdoorLP);
    ambBus = S.gain(ctx, 1); ambBus.connect(outdoorLP);
    startAmbience();
    t0 = ctx.currentTime;
    nextDog = t0 + rr(12, 30); nextCrow = t0 + rr(20, 40); nextGust = t0;
    prerender();
    selfTick();
  }

  function startAmbience() {
    const t = ctx.currentTime;
    // wind: low body + whistle through ruins
    amb.windBP = S.filt(ctx, 'bandpass', 380, 0.6); amb.windG = S.gain(ctx, 0.08); amb.windPan = ctx.createStereoPanner();
    S.noise(ctx, B.brown, t, 1e6, 0.93).connect(amb.windBP).connect(amb.windG).connect(amb.windPan).connect(ambBus);
    amb.whBP = S.filt(ctx, 'bandpass', 900, 9); amb.whG = S.gain(ctx, 0.01);
    S.noise(ctx, B.pink, t, 1e6, 1.04).connect(amb.whBP).connect(amb.whG).connect(amb.windPan);
    // gentle rain hiss
    amb.rainG = S.gain(ctx, 0.03);
    S.noise(ctx, B.white, t, 1e6, 0.97).connect(S.filt(ctx, 'highpass', 2000)).connect(S.filt(ctx, 'lowpass', 7000)).connect(amb.rainG).connect(ambBus);
    // dread drone: beating sub pair, low saw, tritone layer that opens with dread, rumble
    amb.droneG = S.gain(ctx, 0.03); amb.droneG.connect(sfxDry);
    const dlp = S.filt(ctx, 'lowpass', 140, 0.7); dlp.connect(amb.droneG);
    for (const [f, ty, a] of [[36.7, 'sine', 0.6], [36.95, 'sine', 0.6], [55, 'sawtooth', 0.35], [55.3, 'sawtooth', 0.3]]) S.osc(ctx, ty, f, t, 1e6).connect(S.gain(ctx, a)).connect(dlp);
    amb.dreadLP = S.filt(ctx, 'lowpass', 200, 2); amb.dreadG = S.gain(ctx, 0);
    for (const f of [77.8, 78.2, 116.5]) S.osc(ctx, 'sawtooth', f, t, 1e6).connect(S.gain(ctx, 0.3)).connect(amb.dreadLP);
    amb.dreadLP.connect(amb.dreadG).connect(sfxDry);
    S.noise(ctx, B.brown, t, 1e6, 0.5).connect(S.filt(ctx, 'lowpass', 90)).connect(S.gain(ctx, 0.5)).connect(amb.droneG);
    const lfo = S.osc(ctx, 'sine', 0.13, t, 1e6); lfo.connect(S.gain(ctx, 0.01)).connect(amb.droneG.gain);
  }

  // Render reusable voices once, off the main thread.
  async function prerender() {
    try {
      const sr = ctx.sampleRate, specs = [], r = S.prng(4242);
      for (let i = 0; i < 7; i++) specs.push({ k: 'moan', len: 2.6, f: (c, b, o, t) => S.groan(c, b, o, t, { seed: 100 + i, dur: 1.4 + r() * 1.1, level: 1 }) });
      for (let i = 0; i < 5; i++) specs.push({ k: 'snarl', len: 1.3, f: (c, b, o, t) => S.groan(c, b, o, t, { seed: 200 + i, snarl: 1, dur: 0.7 + r() * 0.5, level: 1 }) });
      specs.push({ k: 'bell', len: 14, f: (c, b, o, t) => S.bell(c, b, o, t, 128) });
      for (let i = 0; i < 3; i++) specs.push({ k: 'bark', len: 0.3, f: (c, b, o, t) => S.bark(c, b, o, t, 300 + i) });
      for (let i = 0; i < 3; i++) specs.push({ k: 'caw', len: 0.5, f: (c, b, o, t) => S.caw(c, b, o, t, 400 + i) });
      const t1 = performance.now();
      await Promise.all(specs.map(async (s) => {
        const oc = new OfflineAudioContext(1, Math.ceil(s.len * sr), sr);
        s.f(oc, B, oc.destination, 0);                 // AudioBuffers are shareable across same-rate contexts
        const buf = await oc.startRendering(), d = buf.getChannelData(0);
        let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
        if (pk > 0) for (let i = 0; i < d.length; i++) d[i] *= 0.9 / pk;
        if (s.k === 'bell') pre.bell = buf; else pre[s.k].push(buf);
      }));
      pre.ms = performance.now() - t1; pre.done = true;
    } catch (e) { console.warn('[audio] prerender failed, using live synthesis', e); }
  }

  // ---- routing helpers ----
  function audioPos(x, y, z) {
    // Inside an interior cell, map city coordinates so the door is where the listener stands.
    if (inside > 0.5 && Math.abs(x - L.INTERIOR.x) > 500) return [x - L.PHARMACY_DOOR.x + lis.x, y, z - L.PHARMACY_DOOR.z + lis.z];
    return [x, y, z];
  }
  function place(x, y, z, o = {}) {
    const [px, py, pz] = audioPos(x, y, z);
    const dist = Math.hypot(px - lis.x, py - lis.y, pz - lis.z), ref = o.ref ?? 4;
    const input = S.gain(ctx, o.gain ?? 1);
    const air = S.filt(ctx, 'lowpass', S.clamp(20000 * Math.exp(-dist / (o.air ?? 110)), 700, 20000), 0.5);
    const p = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: ref, rolloffFactor: o.rolloff ?? 1, maxDistance: 10000, positionX: px, positionY: py, positionZ: pz });
    input.connect(air).connect(p).connect(o.outdoor ? outdoorLP : sfxDry);
    const send = S.gain(ctx, (o.wet ?? 0.3) * Math.sqrt(ref / Math.max(dist, ref)));
    air.connect(send).connect(o.outdoor ? streetIn : revIn);
    let echo = null;
    if (o.echo) { echo = S.gain(ctx, o.echo); air.connect(echo).connect(echoIn); }
    return {
      input, dist, gainAtListener: ref / Math.max(dist, ref),
      done(sec) { setTimeout(() => { for (const n of [input, air, p, send, echo]) try { n && n.disconnect(); } catch {} }, sec * 1000 + 300); },
    };
  }
  function local(o = {}) {
    const input = S.gain(ctx, o.gain ?? 1);
    input.connect(sfxDry);
    const send = S.gain(ctx, o.wet ?? 0.15); input.connect(send).connect(revIn);
    let echo = null;
    if (o.echo) { echo = S.gain(ctx, o.echo); input.connect(echo).connect(echoIn); }
    return { input, done(sec) { setTimeout(() => { for (const n of [input, send, echo]) try { n && n.disconnect(); } catch {} }, sec * 1000 + 300); } };
  }
  function playBuf(buf, out, t, rate = 1) {
    const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate; s.connect(out); s.start(t); return s;
  }
  const pick = (a) => a[(Math.random() * a.length) | 0];
  function oneShot(fn, o, secs) { if (!running()) return; try { const n = local(o); fn(ctx, B, n.input, now()); n.done(secs); } catch (e) { console.warn('[audio]', e); } }

  // ---- ambience ----
  function farPoint(dmin, dmax) {
    const a = Math.random() * Math.PI * 2, d = rr(dmin, dmax);
    return [lis.x + Math.cos(a) * d, lis.z + Math.sin(a) * d];
  }
  function dogs(t) {
    const [x, z] = farPoint(120, 260);
    const n = 2 + ((Math.random() * 4) | 0), pl = place(x, lis.y + 1, z, { ref: 10, outdoor: true, wet: 0.9, air: 160, gain: 0.9 });
    let tt = t;
    for (let i = 0; i < n; i++) {
      if (pre.done) playBuf(pick(pre.bark), pl.input, tt, rr(0.95, 1.05)); else S.bark(ctx, B, pl.input, tt, (Math.random() * 1e6) | 0);
      tt += rr(0.3, 0.7);
    }
    pl.done(tt - t + 4);
  }
  function crows(t) {
    const [x, z] = farPoint(40, 110);
    const n = 1 + ((Math.random() * 3) | 0), pl = place(x, lis.y + 18, z, { ref: 8, outdoor: true, wet: 0.7, air: 200, gain: 0.5 });
    let tt = t;
    for (let i = 0; i < n; i++) {
      if (pre.done) playBuf(pick(pre.caw), pl.input, tt, rr(0.92, 1.08)); else S.caw(ctx, B, pl.input, tt, (Math.random() * 1e6) | 0);
      tt += rr(0.45, 0.8);
    }
    pl.done(tt - t + 4);
  }
  function carAlarm(t) {
    const [x, z] = farPoint(150, 190);
    const pl = place(x, lis.y, z, { ref: 25, outdoor: true, wet: 0.8, air: 250, gain: 0.7 });
    S.alarm(ctx, B, pl.input, t, 20);
    pl.done(24);
  }

  function tick(dt) {
    if (!running()) return;
    try {
      const t = ctx.currentTime, T = game.THREE, cam = game.camera;
      // listener follows camera
      if (cam && T) {
        v3 = v3 || { p: new T.Vector3(), f: new T.Vector3(), u: new T.Vector3(), q: new T.Quaternion() };
        cam.getWorldPosition(v3.p); cam.getWorldDirection(v3.f); cam.getWorldQuaternion(v3.q); v3.u.set(0, 1, 0).applyQuaternion(v3.q);
        lis.x = v3.p.x; lis.y = v3.p.y; lis.z = v3.p.z;
        const Ls = ctx.listener;
        if (Ls.positionX) {
          Ls.positionX.value = lis.x; Ls.positionY.value = lis.y; Ls.positionZ.value = lis.z;
          Ls.forwardX.value = v3.f.x; Ls.forwardY.value = v3.f.y; Ls.forwardZ.value = v3.f.z;
          Ls.upX.value = v3.u.x; Ls.upY.value = v3.u.y; Ls.upZ.value = v3.u.z;
        } else { Ls.setPosition(lis.x, lis.y, lis.z); Ls.setOrientation(v3.f.x, v3.f.y, v3.f.z, v3.u.x, v3.u.y, v3.u.z); }
      }
      // interior vs street acoustics
      const inTarget = game.interior?.inside ? 1 : 0;
      if (inTarget !== inside) {
        inside = inTarget;
        streetSend.gain.setTargetAtTime(1 - inside, t, 0.1); roomSend.gain.setTargetAtTime(inside, t, 0.1);
        echoSend.gain.setTargetAtTime(1 - inside, t, 0.1);
        outdoorLP.frequency.setTargetAtTime(inside ? 650 : 20000, t, 0.15);
        ambBus.gain.setTargetAtTime(inside ? 0.6 : 1, t, 0.3);
      }
      // wind gusts
      if (t >= nextGust) {
        const g = rr(0.15, 0.6), tau = rr(0.8, 2.5);
        amb.windG.gain.setTargetAtTime(0.03 + g * 0.22, t, tau);
        amb.windBP.frequency.setTargetAtTime(250 + g * 500, t, tau);
        amb.whBP.frequency.setTargetAtTime(rr(650, 1400), t, tau * 1.5);
        amb.whG.gain.setTargetAtTime(g > 0.45 ? g * 0.05 : 0.004, t, tau);
        amb.windPan.pan.setTargetAtTime(rr(-0.6, 0.6), t, tau * 2);
        nextGust = t + rr(2.5, 8);
      }
      if (t >= nextDog) { dogs(t + 0.05); nextDog = t + rr(25, 60); }
      if (t >= nextCrow) { crows(t + 0.05); nextCrow = t + rr(25, 60); }
      if (!alarmDone && t - t0 > 60) { alarmDone = true; carAlarm(t + 0.05); }
      // dread: player noise + proximity of the dead
      const P = game.player?.pos;
      let d = Infinity;
      if (P) { try { const n = game.dead?.nearest?.(P.x, P.z); if (Number.isFinite(n)) d = n; } catch {} }
      const prox = S.clamp((25 - d) / 20, 0, 1), loud = S.clamp(+game.player?.noise || 0, 0, 1);
      const target = S.clamp(0.35 * loud + 0.8 * prox, 0, 1);
      dread += (target - dread) * Math.min(1, (dt || 0.016) * 1.5);
      amb.droneG.gain.setTargetAtTime(0.03 + 0.17 * dread, t, 0.3);
      amb.dreadG.gain.setTargetAtTime(0.1 * dread ** 1.5, t, 0.3);
      amb.dreadLP.frequency.setTargetAtTime(200 + 900 * dread, t, 0.3);
      const hp = game.player?.health ?? 100;
      if ((d < 6 || (hp < 25 && game.player?.alive !== false)) && t >= nextBeat) {
        const rate = d < 6 ? 95 + 55 * (1 - d / 6) : 75;
        S.heartbeat(ctx, B, sfxDry, t + 0.02, rate);
        nextBeat = t + 60 / rate;
      }
      // groan voice bookkeeping
      for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end < t) voices.splice(i, 1);
    } catch (e) { if (!tick._w) { tick._w = 1; console.warn('[audio] update', e); } }
  }

  // Self-drive when main's loop doesn't call update (keeps ambience + listener alive).
  function selfTick() {
    const f = (ms) => {
      const dt = Math.min(0.1, (ms - (lastSelf || ms)) / 1000); lastSelf = ms;
      if (performance.now() - lastExt > 200) tick(dt);
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }

  return {
    get ctx() { return ctx; },
    resume() {
      try {
        if (!ctx) build();
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      } catch (e) { console.warn('[audio] resume', e); }
    },
    update(dt) { lastExt = performance.now(); tick(dt); },

    footstep(surface = 'cobble', loud = 0.6) { oneShot((c, b, o, t) => S.footstep(c, b, o, t, surface, loud), { gain: 0.55, wet: 0.12 }, 0.6); },
    swing() { oneShot(S.swing, { gain: 0.5, wet: 0.08 }, 0.5); },
    hitFlesh() { oneShot(S.hitFlesh, { gain: 0.8, wet: 0.15 }, 0.5); },
    gunshot() { oneShot(S.gunshot, { gain: 1, wet: 0.9, echo: 0.8 }, 5); },
    dryFire() { oneShot(S.dryFire, { gain: 0.5, wet: 0.05 }, 0.3); },
    reload() { oneShot(S.reload, { gain: 0.5, wet: 0.05 }, 1.6); },
    hurt() { oneShot(S.hurt, { gain: 0.8, wet: 0.1 }, 1.6); },
    heartbeat(rate = 80) { oneShot((c, b, o, t) => S.heartbeat(c, b, o, t, rate), { gain: 1, wet: 0 }, 1); },
    pickup() { oneShot(S.pickup, { gain: 0.6, wet: 0.15 }, 1.8); },
    door() { oneShot(S.door, { gain: 0.6, wet: 0.2 }, 2); },
    deliver() { oneShot(S.chord, { gain: 0.8, wet: 0.5 }, 9); },

    groan(x, z, intensity = 0.5) {
      if (!running()) return;
      try {
        const ins = Math.abs(x - L.INTERIOR.x) < 500;
        const y = ins ? lis.y : L.heightAt(x, z) + 1.55;
        const [px, py, pz] = audioPos(x, y, z);
        const dist = Math.hypot(px - lis.x, py - lis.y, pz - lis.z);
        if (dist > 110) return;
        const t = now();
        for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end < t) voices.splice(i, 1);
        if (voices.length >= 6) {
          let far = 0; for (let i = 1; i < voices.length; i++) if (voices[i].dist > voices[far].dist) far = i;
          if (voices[far].dist <= dist) return;            // all current voices are closer — drop
          const v = voices.splice(far, 1)[0];
          v.input.gain.setTargetAtTime(0, t, 0.03); try { v.src && v.src.stop(t + 0.15); } catch {}
        }
        const k = S.clamp(intensity, 0, 1), snarl = k > 0.65 && Math.random() < 0.75;
        const pl = place(x, y, z, { ref: 3, rolloff: 1.1, wet: 0.35, gain: 0.45 + 0.6 * k });
        let len, src = null;
        if (pre.done) {
          const buf = pick(snarl ? pre.snarl : pre.moan), rate = rr(0.88, 1.1);
          src = playBuf(buf, pl.input, t, rate); len = buf.duration / rate;
        } else len = S.groan(ctx, B, pl.input, t, { seed: (Math.random() * 1e6) | 0, snarl, level: 1 });
        voices.push({ input: pl.input, src, dist, end: t + len });
        pl.done(len + 1);
      } catch (e) { console.warn('[audio] groan', e); }
    },

    chime(hour) {
      if (!running()) return;
      try {
        const n = ((Math.round(hour) % 12) + 12) % 12 || 12, C = L.CLOCK;
        const y = L.heightAt(C.x, C.z) + 45, t = now() + 0.3, gap = 2.4;
        const pl = place(C.x, y, C.z, { ref: 45, outdoor: true, wet: 0.7, echo: 0.5, air: 400, gain: 0.9 });
        const ex = L.TYN?.x ?? C.x + 40, ez = L.TYN?.z ?? C.z - 40;          // faint echo off the far side of the square
        const pe = place(ex, y - 20, ez, { ref: 45, outdoor: true, wet: 0.9, air: 150, gain: 0.12 });
        for (let i = 0; i < n; i++) {
          const ti = t + i * gap, rate = rr(0.997, 1.003);
          if (pre.bell) { playBuf(pre.bell, pl.input, ti, rate); playBuf(pre.bell, pe.input, ti + 0.38, rate); }
          else { S.bell(ctx, B, pl.input, ti); }
        }
        pl.done(n * gap + 12); pe.done(n * gap + 12);
      } catch (e) { console.warn('[audio] chime', e); }
    },

    _debug() { return { state: ctx?.state, pre: pre.done, prerenderMs: pre.ms, voices: voices.length, dread, inside, lis: { ...lis } }; },
  };
}
