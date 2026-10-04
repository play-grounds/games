// MRTVÍ mix: bus graph, ambience bed, per-sound levels, one-shot chains and the
// prerender catalogue. Pure functions on any BaseAudioContext so test/audio.mjs can
// render the real chain offline and measure loudness.
import * as S from './synth.js';

// Output gain (into the sfx bus) and reverb/echo sends per sound.
export const LEVEL = {
  footstep: { gain: 3.2, wet: 0.12 },
  swing: { gain: 2.7, wet: 0.08 },
  hitFlesh: { gain: 0.8, wet: 0.15 },
  gunshot: { gain: 2.6, wet: 0.9, echo: 0.8 },
  dryFire: { gain: 3.0, wet: 0.05 },
  reload: { gain: 1.3, wet: 0.05 },
  hitMarker: { gain: 1.5, wet: 0 },          // ≈ 2.5 dB under a headshot tick
  headshot: { gain: 1.5, wet: 0.04 },
  hurt: { gain: 2.0, wet: 0.1 },
  heartbeat: { gain: 1, wet: 0 },          // plus the 0.35 heartbeat bus
  pickup: { gain: 0.6, wet: 0.15 },
  door: { gain: 0.6, wet: 0.2 },
  deliver: { gain: 0.8, wet: 0.5 },
};
export const HEART = 0.35;
export const MUSIC_IN = 1.17;
export const TICK_REPEAT = 0.708;                        // a tick within 250 ms of the last one: −3 dB
export const groanGain = (k) => 0.24 + 0.3 * S.clamp(k, 0, 1);   // full-intensity groan at 3 m ≈ −21, ≥ 10 dB under a gunshot
// Spatial settings for the dead: close ref so the last metres get loud (≈ +6 dB from 3 m to 1.5 m).
export const GROAN = { ref: 1.5, rolloff: 1, wet: 0.35 };
export const BODYFALL = { ref: 1.5, rolloff: 1, wet: 0.3, gain: 2.4 };
export const stepGain = (loud) => 0.25 + 0.75 * S.clamp(loud, 0, 1);   // footstep() inner gain

export function buildBus(ctx) {
  const b = {};
  b.comp = new DynamicsCompressorNode(ctx, { threshold: -10, knee: 12, ratio: 3, attack: 0.010, release: 0.25 });
  b.master = S.gain(ctx, 0.9);
  b.limiter = new DynamicsCompressorNode(ctx, { threshold: -2, knee: 0, ratio: 20, attack: 0.001, release: 0.1 });
  b.trim = S.gain(ctx, 0.8);                                    // offsets the compressor's built-in makeup gain
  b.comp.connect(b.master).connect(b.limiter).connect(b.trim).connect(ctx.destination);
  // Trailer score input: straight into the one limiter (≈ unity: undoes trim and the limiter's makeup).
  b.music = S.gain(ctx, MUSIC_IN); b.music.connect(b.limiter);
  b.sfxDry = S.gain(ctx, 1); b.sfxDry.connect(b.comp);
  b.heart = S.gain(ctx, HEART); b.heart.connect(b.sfxDry);
  b.outdoorLP = S.filt(ctx, 'lowpass', 20000, 0.5); b.outdoorLP.connect(b.comp);
  // reverbs: street (stone canyon) and room, crossfaded by game.interior.inside
  const streetConv = new ConvolverNode(ctx, { buffer: S.makeIR(ctx, 'street') });
  const roomConv = new ConvolverNode(ctx, { buffer: S.makeIR(ctx, 'room') });
  b.streetIn = S.gain(ctx, 1); b.streetIn.connect(streetConv); streetConv.connect(S.gain(ctx, 0.55)).connect(b.outdoorLP);
  roomConv.connect(S.gain(ctx, 0.45)).connect(b.comp);
  b.revIn = S.gain(ctx, 1);
  b.streetSend = S.gain(ctx, 1); b.roomSend = S.gain(ctx, 0);
  b.revIn.connect(b.streetSend).connect(b.streetIn); b.revIn.connect(b.roomSend).connect(roomConv);
  // discrete façade echoes (gunshots, bells)
  b.echoIn = S.gain(ctx, 1); b.echoSend = S.gain(ctx, 1); b.echoIn.connect(b.echoSend);
  const eo = S.filt(ctx, 'lowpass', 3000);
  for (const [d, a] of [[0.13, 0.45], [0.31, 0.3]]) { const dl = new DelayNode(ctx, { delayTime: d, maxDelayTime: 1 }); b.echoSend.connect(dl).connect(S.gain(ctx, a)).connect(eo); }
  const d3 = new DelayNode(ctx, { delayTime: 0.62, maxDelayTime: 1 }), fb = S.gain(ctx, 0.25), fl = S.filt(ctx, 'lowpass', 1800);
  b.echoSend.connect(d3); d3.connect(fl).connect(fb).connect(d3); d3.connect(S.gain(ctx, 0.35)).connect(eo);
  eo.connect(S.gain(ctx, 0.6)).connect(b.streetIn); eo.connect(S.gain(ctx, 0.5)).connect(b.outdoorLP);
  b.ambBus = S.gain(ctx, 1); b.ambBus.connect(b.outdoorLP);
  return b;
}

// Persistent ambience. The drone goes post-compressor (its 0.25 Hz beating would pump it).
export function startAmbience(ctx, B, bus, t = ctx.currentTime) {
  const amb = {};
  // wind: low body + whistle through ruins
  amb.windBP = S.filt(ctx, 'bandpass', 380, 0.6); amb.windG = S.gain(ctx, 0.08); amb.windPan = ctx.createStereoPanner();
  const wind = S.noise(ctx, B.brown, t, 1e6, 0.93);
  wind.connect(amb.windBP).connect(amb.windG).connect(amb.windPan).connect(bus.ambBus);
  amb.whBP = S.filt(ctx, 'bandpass', 900, 9); amb.whG = S.gain(ctx, 0.01);
  S.noise(ctx, B.pink, t, 1e6, 1.04).connect(amb.whBP).connect(amb.whG).connect(amb.windPan);
  // gentle rain hiss; its 4 s loop is hidden by a slow ±3 % playback-rate drift
  amb.rainG = S.gain(ctx, 0.03);
  const rain = S.noise(ctx, B.white, t, 1e6, 0.97);
  rain.connect(S.filt(ctx, 'highpass', 2000)).connect(S.filt(ctx, 'lowpass', 7000)).connect(amb.rainG).connect(bus.ambBus);
  S.osc(ctx, 'sine', 0.07, t, 1e6).connect(S.gain(ctx, 0.97 * 0.03)).connect(rain.playbackRate);
  S.osc(ctx, 'sine', 0.053, t, 1e6).connect(S.gain(ctx, 0.93 * 0.03)).connect(wind.playbackRate);
  // dread drone: beating sub pair, low saw, tritone layer that opens with dread, rumble
  amb.droneG = S.gain(ctx, 0.03); amb.droneG.connect(bus.master);
  const dlp = S.filt(ctx, 'lowpass', 140, 0.7); dlp.connect(amb.droneG);
  for (const [f, ty, a] of [[36.7, 'sine', 0.6], [36.95, 'sine', 0.6], [55, 'sawtooth', 0.35], [55.3, 'sawtooth', 0.3]]) S.osc(ctx, ty, f, t, 1e6).connect(S.gain(ctx, a)).connect(dlp);
  amb.dreadLP = S.filt(ctx, 'lowpass', 200, 2); amb.dreadG = S.gain(ctx, 0);
  for (const f of [77.8, 78.2, 116.5]) S.osc(ctx, 'sawtooth', f, t, 1e6).connect(S.gain(ctx, 0.3)).connect(amb.dreadLP);
  amb.dreadLP.connect(amb.dreadG).connect(bus.master);
  S.noise(ctx, B.brown, t, 1e6, 0.5).connect(S.filt(ctx, 'lowpass', 90)).connect(S.gain(ctx, 0.5)).connect(amb.droneG);
  const lfo = S.osc(ctx, 'sine', 0.13, t, 1e6); lfo.connect(S.gain(ctx, 0.01)).connect(amb.droneG.gain);
  return amb;
}
export function setDread(amb, t, dread) {
  amb.droneG.gain.setTargetAtTime(0.03 + 0.04 * dread, t, 0.3);   // post-compressor; kept low so steps/snarls/heart cut through
  amb.dreadG.gain.setTargetAtTime(0.035 * dread ** 1.5, t, 0.3);
  amb.dreadLP.frequency.setTargetAtTime(200 + 500 * dread, t, 0.3);
}

// Non-spatial one-shot chain: gain → dry bus (+ reverb / echo sends).
export function localChain(ctx, bus, o = {}) {
  const input = S.gain(ctx, o.gain ?? 1);
  input.connect(o.out || bus.sfxDry);
  const nodes = [input];
  if (o.wet) { const send = S.gain(ctx, o.wet); input.connect(send).connect(bus.revIn); nodes.push(send); }
  if (o.echo) { const echo = S.gain(ctx, o.echo); input.connect(echo).connect(bus.echoIn); nodes.push(echo); }
  return { input, nodes, level: o.gain ?? 1 };
}
// Spatial chain at p=[x,y,z] relative to listener lis={x,y,z}: gain → air lowpass → panner.
export function spatialChain(ctx, bus, p, lis, o = {}) {
  const dist = Math.hypot(p[0] - lis.x, p[1] - lis.y, p[2] - lis.z), ref = o.ref ?? 4;
  const input = S.gain(ctx, o.gain ?? 1);
  const air = S.filt(ctx, 'lowpass', S.clamp(20000 * Math.exp(-dist / (o.air ?? 110)), 700, 20000), 0.5);
  const pan = new PannerNode(ctx, { panningModel: dist > 30 ? 'equalpower' : 'HRTF', distanceModel: 'inverse', refDistance: ref, rolloffFactor: o.rolloff ?? 1, maxDistance: 10000, positionX: p[0], positionY: p[1], positionZ: p[2] });
  input.connect(air).connect(pan).connect(o.outdoor ? bus.outdoorLP : bus.sfxDry);
  const send = S.gain(ctx, (o.wet ?? 0.3) * Math.sqrt(ref / Math.max(dist, ref)));
  air.connect(send).connect(o.outdoor ? bus.streetIn : bus.revIn);
  const nodes = [input, air, pan, send];
  if (o.echo) { const echo = S.gain(ctx, o.echo); air.connect(echo).connect(bus.echoIn); nodes.push(echo); }
  const gAt = ref / (ref + (o.rolloff ?? 1) * (Math.max(dist, ref) - ref));   // 'inverse' distance model
  return { input, nodes, dist, gainAtListener: gAt, level: (o.gain ?? 1) * gAt };
}

// Prerender catalogue: everything played often or many at once. Ordered by urgency.
// norm: peak-normalise to 0.9 (voices whose absolute level is set by the caller).
export const SURFACES = ['cobble', 'stone', 'wood', 'tiles', 'glass', 'water'];
export function voiceSpecs(seed) {
  const r = S.prng(seed), sp = [];
  for (const s of SURFACES) for (let i = 0; i < 4; i++) sp.push({ k: 'step_' + s, len: 0.5, f: (c, b, o, t) => S.footstep(c, b, o, t, s, 1) });
  for (let i = 0; i < 4; i++) sp.push({ k: 'gunshot', len: 0.45, f: S.gunshot });
  for (let i = 0; i < 4; i++) sp.push({ k: 'swing', len: 0.4, ch: 2, f: S.swing });
  for (let i = 0; i < 4; i++) sp.push({ k: 'hitFlesh', len: 0.45, f: S.hitFlesh });
  for (let i = 0; i < 3; i++) sp.push({ k: 'bodyFall', len: 0.6, f: S.bodyFall });
  for (let i = 0; i < 14; i++) { const s = (r() * 1e9) | 0, d = 1.4 + r() * 1.1; sp.push({ k: 'moan', len: d + 0.2, norm: 1, f: (c, b, o, t) => S.groan(c, b, o, t, { seed: s, dur: d, level: 1 }) }); }
  for (let i = 0; i < 8; i++) { const s = (r() * 1e9) | 0, d = 0.7 + r() * 0.5; sp.push({ k: 'snarl', len: d + 0.2, norm: 1, f: (c, b, o, t) => S.groan(c, b, o, t, { seed: s, snarl: 1, dur: d, level: 1 }) }); }
  for (let i = 0; i < 3; i++) sp.push({ k: 'bark', len: 0.3, norm: 1, f: (c, b, o, t) => S.bark(c, b, o, t, 300 + i) });
  for (let i = 0; i < 3; i++) sp.push({ k: 'caw', len: 0.5, norm: 1, f: (c, b, o, t) => S.caw(c, b, o, t, 400 + i) });
  sp.push({ k: 'bell', len: 14, norm: 1, f: (c, b, o, t) => S.bell(c, b, o, t, 128) });
  return sp;
}
export async function renderSpec(s, B, sr) {
  const oc = new OfflineAudioContext(s.ch || 1, Math.ceil(s.len * sr), sr);
  s.f(oc, B, oc.destination, 0.002);              // AudioBuffers are shareable across same-rate contexts
  const buf = await oc.startRendering();
  if (s.norm) {
    const d = buf.getChannelData(0); let pk = 0;
    for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
    if (pk > 0) for (let i = 0; i < d.length; i++) d[i] *= 0.9 / pk;
  }
  return buf;
}
