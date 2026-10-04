// MRTVÍ audio: listener, spatial placement, voice management, ambience scheduling.
// Synthesis lives in ./audio/synth.js, bus graph / levels / prerender catalogue in
// ./audio/mix.js (both pure, so tests render the real chain offline).
import * as S from './audio/synth.js';
import * as M from './audio/mix.js';

const rr = (a, b) => a + (b - a) * Math.random();
const MAX_SHOTS = 24, MAX_GROANS = 6;

export function create(game) {
  const L = game.layout;
  let ctx = null, B = null, bus = null, amb = null;
  const pre = { buf: {}, ms: 0, done: false, n: 0 };          // pre.buf[kind] = AudioBuffer[]
  const lis = { x: 0, y: 0, z: 0 };
  const voices = [];                    // active groans
  const shots = [];                     // all active buffered one-shots {level, end, input, src}
  let inside = 0, dread = 0, t0 = 0, nextGust = 0, nextDog = 0, nextCrow = 0, nextBeat = 0, alarmDone = false;
  let lastExt = -1, lastSelf = 0, v3 = null, building = false;

  const running = () => !!ctx && ctx.state === 'running';
  const now = () => ctx.currentTime + 0.01;

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    building = true;
    ctx = new AC({ latencyHint: 'interactive' });
    B = S.makeBuffers(ctx);
    bus = M.buildBus(ctx);
    amb = M.startAmbience(ctx, B, bus);
    t0 = ctx.currentTime;
    nextDog = t0 + rr(12, 30); nextCrow = t0 + rr(20, 40); nextGust = t0;
    prerender();
    selfTick();
  }

  // Render reusable voices in the background, a chunk per macrotask; each kind is usable
  // as soon as its first variant lands (live synthesis until then).
  async function prerender() {
    try {
      const specs = M.voiceSpecs((Math.random() * 1e9) | 0), sr = ctx.sampleRate, t1 = performance.now();
      for (let i = 0; i < specs.length; i += 8) {
        await Promise.all(specs.slice(i, i + 8).map(async (s) => {
          const buf = await M.renderSpec(s, B, sr);
          (pre.buf[s.k] ||= []).push(buf); pre.n++;
        }));
        await new Promise((r) => setTimeout(r, 0));
      }
      pre.ms = performance.now() - t1; pre.done = true;
    } catch (e) { console.warn('[audio] prerender failed, using live synthesis', e); }
  }
  const has = (k) => pre.buf[k]?.length > 0;
  const pick = (a) => a[(Math.random() * a.length) | 0];

  // ---- routing / voice management ----
  function audioPos(x, y, z) {
    // Inside an interior cell, map city coordinates so the door is where the listener stands.
    if (inside > 0.5 && Math.abs(x - L.INTERIOR.x) > 500) return [x - L.PHARMACY_DOOR.x + lis.x, y, z - L.PHARMACY_DOOR.z + lis.z];
    return [x, y, z];
  }
  const place = (x, y, z, o) => M.spatialChain(ctx, bus, audioPos(x, y, z), lis, o);
  // Disconnect a chain once `sec` of audio time has played. Timed by a silent source on the
  // context clock (not setTimeout), so a suspended / hidden tab can't cut scheduled sounds.
  function release(ch, sec) {
    const k = new ConstantSourceNode(ctx, { offset: 0 }), t = ctx.currentTime;
    k.connect(ch.input);
    k.onended = () => { try { k.disconnect(); } catch {} for (const n of ch.nodes) try { n.disconnect(); } catch {} };
    k.start(t); k.stop(t + sec + 0.3);
  }
  function playBuf(buf, out, t, rate = 1) {
    const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate; s.connect(out); s.start(t); return s;
  }
  function stopShot(v, t) {
    v.input.gain.cancelScheduledValues(t); v.input.gain.setTargetAtTime(0, t, 0.015);
    try { v.src && v.src.stop(t + 0.08); } catch {}
    v.end = t;
  }
  // Admit a one-shot of loudness `level`; returns false if it is the quietest of a full set.
  function admit(level, t) {
    for (let i = shots.length - 1; i >= 0; i--) if (shots[i].end < t) shots.splice(i, 1);
    if (shots.length < MAX_SHOTS) return true;
    let q = 0; for (let i = 1; i < shots.length; i++) if (shots[i].level < shots[q].level) q = i;
    if (shots[q].level >= level) return false;
    stopShot(shots.splice(q, 1)[0], t);
    return true;
  }
  // Play a prerendered kind through a chain; falls back to live synthesis.
  function fire(kind, ch, t, live, rate = 1) {
    let src = null, len;
    if (has(kind)) { const b = pick(pre.buf[kind]); src = playBuf(b, ch.input, t, rate); len = b.duration / rate; }
    else len = live(ctx, B, ch.input, t) || 1;
    const v = { level: ch.level, end: t + len, input: ch.input, src };
    shots.push(v); release(ch, len + 0.3);
    return v;
  }
  function localShot(kind, opt, live, gainMul = 1) {
    if (!running()) return;
    try {
      const t = now(), o = { ...opt, gain: opt.gain * gainMul };
      if (!admit(o.gain, t)) return;
      fire(kind, M.localChain(ctx, bus, o), t, live, rr(0.97, 1.03));
    } catch (e) { console.warn('[audio]', e); }
  }
  function oneShot(fn, o, secs) {
    if (!running()) return;
    try { const ch = M.localChain(ctx, bus, o); fn(ctx, B, ch.input, now()); release(ch, secs); } catch (e) { console.warn('[audio]', e); }
  }
  let lastTick = -1;
  function tickShot(fn, o) {                       // hit / headshot ticks: 3 dB down when < 250 ms apart
    if (!running()) return;
    const t = ctx.currentTime, near = t - lastTick < 0.25; lastTick = t;
    oneShot(fn, near ? { ...o, gain: o.gain * M.TICK_REPEAT } : o, 0.4);
  }

  // ---- ambience ----
  function farPoint(dmin, dmax) {
    const a = Math.random() * Math.PI * 2, d = rr(dmin, dmax);
    return [lis.x + Math.cos(a) * d, lis.z + Math.sin(a) * d];
  }
  function calls(kind, synth, n, gap, o, y) {
    const [x, z] = farPoint(...o.d);
    const ch = place(x, lis.y + y, z, o), t = now();
    let tt = t;
    for (let i = 0; i < n; i++) {
      if (has(kind)) playBuf(pick(pre.buf[kind]), ch.input, tt, rr(0.93, 1.07)); else synth(ctx, B, ch.input, tt, (Math.random() * 1e6) | 0);
      tt += rr(...gap);
    }
    release(ch, tt - t + 4);
  }
  const dogs = () => calls('bark', S.bark, 2 + ((Math.random() * 4) | 0), [0.3, 0.7], { d: [120, 260], ref: 10, outdoor: true, wet: 0.9, air: 160, gain: 0.9 }, 1);
  const crows = () => calls('caw', S.caw, 1 + ((Math.random() * 3) | 0), [0.45, 0.8], { d: [40, 110], ref: 8, outdoor: true, wet: 0.7, air: 200, gain: 0.5 }, 18);
  function carAlarm(t) {
    const [x, z] = farPoint(150, 190);
    const ch = place(x, lis.y, z, { ref: 25, outdoor: true, wet: 0.8, air: 250, gain: 0.7 });
    S.alarm(ctx, B, ch.input, t, 20);
    release(ch, 24);
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
        bus.streetSend.gain.setTargetAtTime(1 - inside, t, 0.1); bus.roomSend.gain.setTargetAtTime(inside, t, 0.1);
        bus.echoSend.gain.setTargetAtTime(1 - inside, t, 0.1);
        bus.outdoorLP.frequency.setTargetAtTime(inside ? 650 : 20000, t, 0.15);
        bus.ambBus.gain.setTargetAtTime(inside ? 0.6 : 1, t, 0.3);
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
      if (t >= nextDog) { dogs(); nextDog = t + rr(25, 60); }
      if (t >= nextCrow) { crows(); nextCrow = t + rr(25, 60); }
      if (!alarmDone && t - t0 > 60) { alarmDone = true; carAlarm(t + 0.05); }
      // dread: player noise + proximity of the dead
      const P = game.player?.pos;
      let d = Infinity;
      if (P) { try { const n = game.dead?.nearest?.(P.x, P.z); if (Number.isFinite(n)) d = n; } catch {} }
      const prox = S.clamp((25 - d) / 20, 0, 1), loud = S.clamp(+game.player?.noise || 0, 0, 1);
      const target = S.clamp(0.35 * loud + 0.8 * prox, 0, 1);
      dread += (target - dread) * Math.min(1, (dt || 0.016) * 1.5);
      M.setDread(amb, t, dread);
      const hp = game.player?.health ?? 100;
      if ((d < 6 || (hp < 25 && game.player?.alive !== false)) && t >= nextBeat) {
        const rate = d < 6 ? 95 + 55 * (1 - d / 6) : 75;
        S.heartbeat(ctx, B, bus.heart, t + 0.02, rate);
        nextBeat = t + 60 / rate;
      }
      for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end < t) voices.splice(i, 1);
      for (let i = shots.length - 1; i >= 0; i--) if (shots[i].end < t) shots.splice(i, 1);
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
    get musicIn() { return bus?.music || null; },     // trailer score feeds the game's limiter
    resume() {                                            // idempotent; safe to call every gesture
      try {
        if (!ctx && !building) build();
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      } catch (e) { console.warn('[audio] resume', e); }
    },
    update(dt) { lastExt = performance.now(); tick(dt); },

    footstep(surface = 'cobble', loud = 0.6) {
      const s = M.SURFACES.includes(surface) ? surface : 'cobble';
      localShot('step_' + s, M.LEVEL.footstep, (c, b, o, t) => { S.footstep(c, b, o, t, s, 1); return 0.5; }, M.stepGain(loud));
    },
    swing() { localShot('swing', M.LEVEL.swing, (c, b, o, t) => { S.swing(c, b, o, t); return 0.4; }); },
    hitFlesh() { localShot('hitFlesh', M.LEVEL.hitFlesh, (c, b, o, t) => { S.hitFlesh(c, b, o, t); return 0.45; }); },
    gunshot() { localShot('gunshot', M.LEVEL.gunshot, (c, b, o, t) => { S.gunshot(c, b, o, t); return 0.45; }); },
    dryFire() { oneShot(S.dryFire, M.LEVEL.dryFire, 0.3); },
    reload() { oneShot(S.reload, M.LEVEL.reload, 1.6); },
    hitMarker() { tickShot(S.hitMarker, M.LEVEL.hitMarker); },
    headshot() { tickShot(S.headshot, M.LEVEL.headshot); },
    hurt() { oneShot(S.hurt, M.LEVEL.hurt, 1.6); },
    heartbeat(rate = 80) { oneShot((c, b, o, t) => S.heartbeat(c, b, o, t, rate), { ...M.LEVEL.heartbeat, out: bus?.heart }, 1); },
    pickup() { oneShot(S.pickup, M.LEVEL.pickup, 1.8); },
    door() { oneShot(S.door, M.LEVEL.door, 2); },
    deliver() { oneShot(S.chord, M.LEVEL.deliver, 9); },

    bodyFall(x, z) {
      if (!running()) return;
      try {
        const ins = Math.abs(x - L.INTERIOR.x) < 500, y = ins ? lis.y - 1.4 : L.heightAt(x, z) + 0.2;
        const ch = place(x, y, z, M.BODYFALL);
        if (ch.dist > 80) { release(ch, 0); return; }
        const t = now();
        if (!admit(ch.level, t)) { release(ch, 0); return; }
        fire('bodyFall', ch, t, S.bodyFall, rr(0.9, 1.08));
      } catch (e) { console.warn('[audio] bodyFall', e); }
    },

    // opts.tell: an attack tell — always a fast-onset snarl.
    groan(x, z, intensity = 0.5, opts) {
      if (!running()) return;
      try {
        const ins = Math.abs(x - L.INTERIOR.x) < 500;
        const y = ins ? lis.y : L.heightAt(x, z) + 1.55;
        const [px, py, pz] = audioPos(x, y, z);
        const dist = Math.hypot(px - lis.x, py - lis.y, pz - lis.z);
        if (dist > 110) return;
        const t = now();
        for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end < t) voices.splice(i, 1);
        if (voices.length >= MAX_GROANS) {
          let far = 0; for (let i = 1; i < voices.length; i++) if (voices[i].dist > voices[far].dist) far = i;
          if (voices[far].dist <= dist) return;            // all current voices are closer — drop
          stopShot(voices.splice(far, 1)[0], t);
        }
        const k = S.clamp(intensity, 0, 1), snarl = !!opts?.tell || (k > 0.65 && Math.random() < 0.75);
        const ch = place(x, y, z, { ...M.GROAN, gain: M.groanGain(k) });
        if (!admit(ch.level, t)) { release(ch, 0); return; }
        const v = fire(snarl ? 'snarl' : 'moan', ch, t, (c, b, o, tt) => S.groan(c, b, o, tt, { seed: (Math.random() * 1e6) | 0, snarl, level: 1 }), rr(0.82, 1.15));
        v.dist = dist; voices.push(v);
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
          if (has('bell')) { playBuf(pre.buf.bell[0], pl.input, ti, rate); playBuf(pre.buf.bell[0], pe.input, ti + 0.38, rate); }
          else { S.bell(ctx, B, pl.input, ti); }
        }
        release(pl, n * gap + 12); release(pe, n * gap + 12);
      } catch (e) { console.warn('[audio] chime', e); }
    },

    _debug() {
      const t = ctx ? ctx.currentTime : 0;
      return { state: ctx?.state, pre: pre.done, prerenderMs: pre.ms, prerendered: pre.n, voices: voices.length, shots: shots.filter((s) => s.end >= t).length, dread, inside, lis: { ...lis } };
    },
  };
}
