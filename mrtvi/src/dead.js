// MRTVÍ — the dead. Up to 300 walkers drawn as 7 instanced body-part meshes, posed in JS
// every frame into instance matrices. AI: idle/wander → hear → investigate → see → chase →
// lunge. Flow field on the collide grid towards the player. See CONTRACT.md (dead.js).
import * as THREE from 'three';
import { rng, heightAt, inRiver, BOUNDS, BRIDGE_HORDE, OTS, MS_SQUARE, RIVER, CASTLE, START, CLOCK, ROUTE } from './layout.js';
import { buildParts, SKEL } from './dead/geometry.js';
import { makeAtlases } from './dead/atlas.js';

const MAXN = 300, ACTIVE_R = 120, CORPSE_MAX = 60;
const FREE = 0, IDLE = 1, WANDER = 2, INVEST = 3, CHASE = 4, DYING = 5, CORPSE = 6;
// attack: ~0.5 s windup with arms raised, damage at the end only if the player is still in reach
const ATK_T = 0.8, ATK_HIT = 0.52, ATK_COOL = 1.2, ATK_RANGE = 1.3, ATK_REACH = 1.6, DEATH_T = 1.25, HIT_T = 0.45;
const WALK = 0.7, WANDER_V = 0.45;
const MAX_ATTACKERS = 2, WAIT_R = 2.1, RISE_T = 1.5, FAR_NOISE = 60;

// --- tiny affine math: 3x4 row-major [r00 r01 r02 tx, r10 r11 r12 ty, r20 r21 r22 tz] ---
const M = () => new Float64Array(12);
function compose(m, tx, ty, tz, pitch, yaw, roll, sx = 1, sy = 1, sz = 1) {
  const cx = Math.cos(pitch), sxn = Math.sin(pitch), cy = Math.cos(yaw), syn = Math.sin(yaw), cz = Math.cos(roll), szn = Math.sin(roll);
  m[0] = (cy * cz + syn * sxn * szn) * sx; m[1] = (-cy * szn + syn * sxn * cz) * sy; m[2] = syn * cx * sz; m[3] = tx;
  m[4] = cx * szn * sx; m[5] = cx * cz * sy; m[6] = -sxn * sz; m[7] = ty;
  m[8] = (-syn * cz + cy * sxn * szn) * sx; m[9] = (syn * szn + cy * sxn * cz) * sy; m[10] = cy * cx * sz; m[11] = tz;
  return m;
}
function mul(o, a, b) {
  for (let r = 0; r < 12; r += 4) {
    const a0 = a[r], a1 = a[r + 1], a2 = a[r + 2];
    o[r] = a0 * b[0] + a1 * b[4] + a2 * b[8];
    o[r + 1] = a0 * b[1] + a1 * b[5] + a2 * b[9];
    o[r + 2] = a0 * b[2] + a1 * b[6] + a2 * b[10];
    o[r + 3] = a0 * b[3] + a1 * b[7] + a2 * b[11] + a[r + 3];
  }
  return o;
}
function store(arr, i, m) {
  const o = i * 16;
  arr[o] = m[0]; arr[o + 1] = m[4]; arr[o + 2] = m[8]; arr[o + 3] = 0;
  arr[o + 4] = m[1]; arr[o + 5] = m[5]; arr[o + 6] = m[9]; arr[o + 7] = 0;
  arr[o + 8] = m[2]; arr[o + 9] = m[6]; arr[o + 10] = m[10]; arr[o + 11] = 0;
  arr[o + 12] = m[3]; arr[o + 13] = m[7]; arr[o + 14] = m[11]; arr[o + 15] = 1;
}
function zero(arr, i) { arr.fill(0, i * 16, i * 16 + 16); }
function pt(m, x, y, z, out, k) {
  out[k] = m[0] * x + m[1] * y + m[2] * z + m[3];
  out[k + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
  out[k + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
}
const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const hash01 = (i, k) => (((i * 2654435761) ^ (k * 2246822519) ^ ((i + k) * 3266489917)) >>> 0) / 4294967296 % 1;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const STUB = { update() {}, count: 0, alive: 0, raycast: () => null, meleeHit: () => false, damage: () => false, nearest: () => Infinity };

export function create(game) {
  const P = game.params || new URLSearchParams();
  if (P.has('nodead')) return STUB;
  const SEED = Math.floor(+P.get('seed') || 0);

  // ---------- population ----------
  const interiorSpawns = (game.interior && (game.interior.spawns || game.interior.deadSpawns)) || [];
  let nWalk, nHorde;
  if (P.has('dead')) {
    const n = clamp(Math.floor(+P.get('dead') || 0), 0, MAXN);
    nHorde = Math.min(40, Math.floor(n * 0.15));
    nWalk = n - nHorde;
  } else { nWalk = 220; nHorde = 40; }
  const nInt = Math.min(interiorSpawns.length, 3, MAXN - nWalk - nHorde);
  const total = nWalk + nHorde + Math.max(0, nInt);
  if (total <= 0) return STUB;
  const cap = Math.min(MAXN, total + 40);

  // ---------- state (SoA) ----------
  const F = () => new Float32Array(cap);
  const x = F(), z = F(), y = F(), h = F(), spd = F(), vx = F(), vz = F(), tx = F(), tz = F(), timer = F(), hp = F();
  const phase = F(), atk = F().fill(-1), hitT = F(), deathT = F(), cool = F(), lastSeen = F(), excite = F(), scale = F();
  const stoop = F(), tilt = F(), seed = F(), sf = F(), lean = F(), fat = F(), headS = F(), urg = F(), fallSign = F();
  const aware = F(), stuckT = F(), stuckX = F(), stuckZ = F(), raiseOff = F(), pdist = F().fill(1e9), tgtV = F();
  const state = new Uint8Array(cap), prio = new Uint8Array(cap), crawler = new Uint8Array(cap), noJaw = new Uint8Array(cap);
  const horde = new Uint8Array(cap), seen = new Uint8Array(cap), armMode = new Uint8Array(cap * 2), dragSide = new Int8Array(cap);
  const gen = new Uint16Array(cap);
  // fresh runners, per-individual chase speed, attack tokens, sitting/feeding, chime goal, horde home
  const fresh = new Uint8Array(cap), tok = new Uint8Array(cap), sitting = new Uint8Array(cap), goal = new Uint8Array(cap);
  const runV = F(), chaseV = F(), burst = F(), burstMax = F(), sit = F(), homeX = F(), homeZ = F();
  const C = new Float32Array(cap * 12);   // head, chest, belly, hips centres (world) for hit tests

  // ---------- rendering ----------
  const atlas = makeAtlases(game);
  const parts = buildParts();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSkinMap = { value: atlas.skin };
    sh.uniforms.uClothMap = { value: atlas.cloth };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aUv; attribute vec4 aT; attribute float aGore;
attribute vec4 aSkin; attribute vec4 aClothA; attribute vec4 aClothB; attribute vec4 aMisc;
varying vec2 vUv2; varying vec4 vT; varying float vGore; varying vec4 vSkin; varying vec4 vCloth; varying vec2 vMisc; varying vec3 vPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vPos = position; vUv2 = aUv; vT = aT; vGore = aGore; vSkin = aSkin; vCloth = aT.z < 0.5 ? aClothA : aClothB; vMisc = aMisc.xy;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uSkinMap; uniform sampler2D uClothMap;
varying vec2 vUv2; varying vec4 vT; varying float vGore; varying vec4 vSkin; varying vec4 vCloth; varying vec2 vMisc; varying vec3 vPos;
vec3 deadFace(vec3 p, vec3 base, float seed) {
  vec3 u = (p - vec3(0.0, 0.1, 0.025)) / vec3(0.079, 0.102, 0.094);
  float front = smoothstep(0.3, 0.65, u.z);
  vec2 q = vec2(abs(u.x), u.y);
  float w = length((q - vec2(0.36, 0.13)) / vec2(1.0, 0.8));
  float sock = (1.0 - smoothstep(0.14, 0.2, w)) * front;
  float ring = (1.0 - smoothstep(0.16, 0.4, w)) * front;
  base *= mix(vec3(1.0), vec3(0.3, 0.22, 0.26), ring);
  float eye = 1.0 - smoothstep(0.045, 0.07, length(q - vec2(0.37, 0.11)));
  base = mix(base, mix(vec3(0.012, 0.01, 0.01), vec3(0.42, 0.42, 0.33), eye), sock);
  float nose = (1.0 - smoothstep(0.8, 1.0, length((q - vec2(0.0, -0.13)) / vec2(0.08, 0.13)))) * front;
  base = mix(base, vec3(0.015, 0.008, 0.008), nose);
  float cheek = smoothstep(0.32, 0.5, q.x) * (1.0 - smoothstep(0.72, 0.88, q.x)) * smoothstep(0.05, -0.12, u.y) * smoothstep(-0.62, -0.35, u.y) * front;
  base *= 1.0 - 0.45 * cheek;
  float my = abs(u.y + 0.47);
  float mouth = step(q.x, 0.44 - 0.6 * my) * step(my, 0.14) * front;
  float teeth = step(my, 0.05) * step(0.3, fract(u.x * 9.0 + 0.5)) * step(q.x, 0.26);
  base = mix(base, mix(vec3(0.06, 0.012, 0.01), vec3(0.2, 0.17, 0.1), teeth), mouth);
  float hl = 0.42 + 0.3 * u.z;
  float hair = smoothstep(hl, hl + 0.1, u.y);
  float bald = smoothstep(0.2, 0.5, sin(u.x * 7.0 + seed * 3.0) * sin(u.z * 6.0 + u.y * 4.0 + seed));
  vec3 hc = fract(seed * 7.31) > 0.75 ? vec3(0.12, 0.11, 0.1) : vec3(0.022, 0.018, 0.015);
  base = mix(base, hc, hair * (1.0 - bald) * 0.95);
  return base;
}`)
      .replace('#include <map_fragment>', `
{
  vec2 gx = dFdx(vUv2), gy = dFdy(vUv2);
  vec2 ss = vec2(0.5);
  float st = floor(vSkin.w + 0.5);
  vec3 sk = textureGrad(uSkinMap, (fract(vUv2) * 0.98 + 0.01 + vec2(mod(st, 2.0), 1.0 - floor(st / 2.0))) * ss, gx * ss, gy * ss).rgb * vSkin.rgb;
  vec2 cs = vec2(1.0 / 3.0, 0.5);
  float ct = floor(vCloth.w + 0.5);
  vec3 cl = textureGrad(uClothMap, (fract(vUv2) * 0.98 + 0.01 + vec2(mod(ct, 3.0), 1.0 - floor(ct / 3.0))) * cs, gx * cs, gy * cs).rgb * vCloth.rgb;
  float isCloth = step(0.5, vT.y) * step(vT.x, vMisc.x);
  vec3 base = mix(mix(sk, cl, isCloth), vec3(1.0), clamp(vT.w, 0.0, 1.0));
  if (vT.z > 1.5) base = deadFace(vPos, base, vSkin.r * 13.7 + vSkin.w);
  float bl = smoothstep(1.0 - vMisc.y, 1.1 - vMisc.y, vGore) * (1.0 - clamp(vT.w, 0.0, 1.0));
  base = mix(base, vec3(0.12, 0.018, 0.012), bl * 0.88);
  diffuseColor.rgb *= base;
}`);
  };
  mat.customProgramCacheKey = () => 'mrtvi-dead-3';

  const meshes = {};
  function mk(name, per) {
    const geo = parts[name];
    const n = cap * per;
    const im = new THREE.InstancedMesh(geo, mat, n);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.instanceMatrix.array.fill(0);
    for (const a of ['aSkin', 'aClothA', 'aClothB', 'aMisc']) {
      geo.setAttribute(a, new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
    }
    im.frustumCulled = false;
    im.name = 'dead_' + name;
    im.userData.per = per;
    game.scene.add(im);
    meshes[name] = im;
    return im.instanceMatrix.array;
  }
  const A = {
    torso: mk('torso', 1), head: mk('head', 1), jaw: mk('jaw', 1),
    uarm: mk('uarm', 2), farm: mk('farm', 2), thigh: mk('thigh', 2), shin: mk('shin', 2),
  };
  const meshList = Object.values(meshes);

  function setLook(i) {
    const R = rng(9001 + i * 7919 + gen[i] * 104729 + SEED * 31337);
    const skinTile = Math.floor(R() * 4);
    // grey-green, bloodless; the module skin is pale so pull it down and towards green
    const v = 0.42 + R() * 0.2;
    const skin = [v * (0.86 + R() * 0.1), v * (0.95 + R() * 0.08), v * (0.78 + R() * 0.1), skinTile];
    // shirts: anything (hi-vis vest rare); trousers: denim, khaki, dark
    const SH = [0, 1, 2, 4, 5, 1, 2, 5, 3], TR = [0, 1, 5, 0, 5];
    const ca = SH[Math.floor(R() * SH.length)], cb = TR[Math.floor(R() * TR.length)];
    const va = 0.42 + R() * 0.38, vb = 0.38 + R() * 0.32;
    const HUE = [[1, 1, 1], [1.12, 0.95, 0.78], [0.86, 0.98, 0.82], [1.12, 0.82, 0.8], [0.88, 0.92, 1.08], [1.05, 1.02, 0.9]];
    const hu = HUE[Math.floor(R() * HUE.length)];
    const clA = [va * hu[0], va * hu[1], va * hu[2], ca];
    const clB = [vb * (0.92 + R() * 0.1), vb * (0.92 + R() * 0.1), vb * (0.9 + R() * 0.1), cb];
    const r1 = R();
    const sleeve = r1 < 0.5 ? 0.93 : r1 < 0.72 ? 0.62 : r1 < 0.92 ? 0.3 : 0.0;
    const trousers = R() < 0.9 ? 1.01 : 0.36;
    const gore = R() < 0.12 ? 0.5 + R() * 0.12 : 0.12 + R() * 0.35;
    // body
    const H = 1.55 + R() * 0.35;
    scale[i] = H / 1.74;
    stoop[i] = 0.12 + R() * 0.38;
    tilt[i] = (R() - 0.5) * 0.7;
    lean[i] = (R() - 0.5) * 0.12;
    fat[i] = 0.88 + R() * 0.3;
    headS[i] = 0.94 + R() * 0.12;
    seed[i] = R() * 100;
    sf[i] = 0.8 + R() * 0.35;
    raiseOff[i] = (R() - 0.5) * 0.4;
    dragSide[i] = R() < 0.5 ? -1 : 1;
    crawler[i] = R() < 0.05 ? 1 : 0;
    noJaw[i] = R() < 0.1 ? 1 : 0;
    const ar = R();
    armMode[i * 2] = armMode[i * 2 + 1] = 0;
    if (ar < 0.3) armMode[i * 2 + (R() < 0.5 ? 0 : 1)] = 1;          // one limp arm
    else if (ar < 0.42) armMode[i * 2 + (R() < 0.5 ? 0 : 1)] = 2;    // one arm gone
    // ~12% are fresh: they run (2.9–3.4 m/s) for a 4–6 s burst, then tire to a shamble-chase
    fresh[i] = !crawler[i] && R() < 0.12 ? 1 : 0;
    runV[i] = 2.9 + R() * 0.5; burstMax[i] = 4 + R() * 2; chaseV[i] = 2.2 + R() * 0.3;
    const set = (name, idx, thr) => {
      const g = meshes[name].geometry.attributes;
      g.aSkin.array.set(skin, idx * 4); g.aClothA.array.set(clA, idx * 4); g.aClothB.array.set(clB, idx * 4);
      g.aMisc.array[idx * 4] = thr; g.aMisc.array[idx * 4 + 1] = gore;
      for (const a of ['aSkin', 'aClothA', 'aClothB', 'aMisc']) g[a].needsUpdate = true;
    };
    set('torso', i, 1.01); set('head', i, 1.01); set('jaw', i, 1.01);
    for (let s = 0; s < 2; s++) { set('uarm', i * 2 + s, sleeve); set('farm', i * 2 + s, sleeve); set('thigh', i * 2 + s, trousers); set('shin', i * 2 + s, trousers); }
  }

  function hide(i) {
    zero(A.torso, i); zero(A.head, i); zero(A.jaw, i);
    for (let s = 0; s < 2; s++) { zero(A.uarm, i * 2 + s); zero(A.farm, i * 2 + s); zero(A.thigh, i * 2 + s); zero(A.shin, i * 2 + s); }
  }

  // ---------- posing ----------
  const mRoot = M(), mPel = M(), mTor = M(), mL = M(), mO = M(), mHead = M(), mUA = M(), mTh = M();
  const UARM = SKEL.uarm, THIGH = SKEL.thigh, SHIN = SKEL.shin, FOOT = SKEL.hip - SKEL.thigh - SKEL.shin;
  const [SHX, SHY, SHZ] = SKEL.shoulder, [NX, NY, NZ] = SKEL.neck, [JX, JY, JZ] = SKEL.jaw, [HX, HY, HZ] = SKEL.head;
  let now = 0;

  function pose(i) {
    const s = scale[i], sd = seed[i], t = now, ph = phase[i];
    const st = state[i];
    const crawl = crawler[i] === 1;
    const d = st >= DYING ? clamp(deathT[i], 0, 1) : 0;
    const k1 = sm(0, 0.35, d), q = clamp((d - 0.15) / 0.85, 0, 1), k2 = q * q;
    const alive = d === 0;
    const wa = alive ? Math.min(1, spd[i] / 0.55) : 0;
    const ex = alive ? excite[i] : 0;
    const hit = alive ? hitT[i] : 0;
    // attack: arms rise over the windup and hold (ak), then the lunge snaps forward (lg)
    const at = alive ? atk[i] : -1;
    const ak = at >= 0 ? (at < ATK_HIT ? sm(0, ATK_HIT * 0.8, at) : 1 - sm(ATK_HIT, ATK_T, at)) : 0;
    const lg = at >= ATK_HIT * 0.75 ? Math.sin(Math.PI * clamp((at - ATK_HIT * 0.75) / (ATK_T - ATK_HIT * 0.75), 0, 1)) : 0;
    const kneel = alive && !crawl ? sit[i] : 0;
    const fs = fallSign[i];

    // root (+ lunge forward, + fall rotation about the feet)
    const fwd = 0.4 * lg - 0.08 * ak * (1 - lg);
    const fallA = crawl ? 0 : fs * 1.48 * k2;
    const lift = 0.12 * Math.abs(Math.sin(fallA));
    compose(mL, 0, lift, fwd, fallA, 0, 0, s, s, s);
    compose(mO, x[i], y[i], z[i], 0, h[i], 0);
    mul(mRoot, mO, mL);

    let tp, ty, tr, hpch, hy, hr, jawO;
    if (crawl) {
      const c2 = Math.sin(2 * ph) * wa;
      compose(mL, 0, 0.12, 0, 0, 0.1 * Math.sin(ph) * wa, 0.07 * Math.sin(ph) * wa);
      mul(mPel, mRoot, mL);
      tp = 1.42 + 0.04 * c2 + 0.13 * d - 0.3 * hit + 0.2 * ak;
      ty = 0.12 * Math.sin(ph) * wa; tr = 0.08 * Math.sin(ph) * wa + lean[i];
      hpch = -1.15 + 0.12 * Math.sin(t * 0.5 + sd) + 0.95 * k2 - 0.3 * ak;
      hy = 0.2 * Math.sin(t * 0.3 + sd) * (1 - ex); hr = tilt[i] * 0.5;
      jawO = 0.1 + 0.25 * ex * (0.5 + 0.5 * Math.sin(t * 7 + sd)) + 0.5 * ak + 0.3 * k2;
      // stumps
      for (let side = 0; side < 2; side++) {
        const sg = side ? 1 : -1;
        compose(mL, SKEL.hipX * sg, 0, 0, 1.45 + 0.12 * Math.sin(ph + sg) * wa, 0, sg * 0.15, 1, 0.42, 1);
        mul(mTh, mPel, mL); store(A.thigh, i * 2 + side, mTh); zero(A.shin, i * 2 + side);
      }
    } else {
      // legs: one drags
      const Aamp = wa * (0.3 + 0.25 * ex);
      const ds = dragSide[i];
      let thL = 0, thR = 0, knL = 0, knR = 0;
      for (let side = 0; side < 2; side++) {
        const sg = side ? 1 : -1;
        let th, kn;
        if (sg === ds) { th = Aamp * 0.45 * Math.sin(ph) + 0.07 * wa; kn = 0.06 + 0.14 * wa * Math.max(0, -Math.cos(ph)); }
        else { th = -Aamp * Math.sin(ph); kn = 0.1 + wa * (0.25 + 0.5 * ex) * Math.max(0, Math.cos(ph)); }
        th -= 0.55 * k1 * (1 - 0.5 * k2) + 0.1 * hit * sg * ds + (1.0 + 0.1 * sg) * kneel;
        kn += 1.15 * k1 * (1 - 0.6 * k2) + 2.45 * kneel;
        if (side) { thR = th; knR = kn; } else { thL = th; knL = kn; }
      }
      const lv = (th, kn) => THIGH * Math.cos(th) + SHIN * Math.cos(th + kn);
      const hipY = Math.max(lv(thL, knL), lv(thR, knR)) + FOOT;
      const pelRoll = 0.05 * ds * wa + 0.05 * Math.sin(ph) * wa;
      compose(mL, 0, hipY, 0, 0, 0.1 * Math.sin(ph) * wa, pelRoll);
      mul(mPel, mRoot, mL);
      for (let side = 0; side < 2; side++) {
        const sg = side ? 1 : -1;
        const drag = sg === ds;
        compose(mL, SKEL.hipX * sg, 0, 0, side ? thR : thL, 0, sg * (0.04 + (drag ? 0.08 * wa : 0)) - pelRoll);
        mul(mTh, mPel, mL); store(A.thigh, i * 2 + side, mTh);
        compose(mL, 0, -THIGH, 0, side ? knR : knL, drag ? sg * 0.25 : 0, 0);
        mul(mO, mTh, mL); store(A.shin, i * 2 + side, mO);
      }
      tp = stoop[i] + 0.05 * Math.sin(2 * ph) * wa + 0.24 * ex - 0.4 * ak + 0.55 * lg - 0.6 * hit + kneel * (0.7 + 0.08 * Math.sin(now * 2.6 + sd)) + 0.03 * Math.sin(t * 0.8 + sd) * (1 - wa)
        + (fs > 0 ? 0.35 : -0.25) * k1;
      ty = -0.14 * Math.sin(ph) * wa + 0.1 * Math.sin(t * 0.3 + sd) * (1 - wa);
      tr = 0.07 * Math.sin(ph) * wa + lean[i] + 0.05 * Math.sin(t * 0.45 + sd * 2) * (1 - wa) - pelRoll * 0.8;
      hpch = (0.38 + 0.15 * Math.sin(t * 0.37 + sd)) * (1 - ex) - tp * (0.35 + 0.5 * ex) - 0.2 * ak - 0.55 * hit + 0.04 * Math.sin(2 * ph) * wa
        + 0.5 * k1 + kneel * (0.35 + 0.25 * Math.sin(now * 3.1 + sd));
      hy = 0.25 * Math.sin(t * 0.21 + sd) * (1 - ex) + 0.08 * Math.sin(ph) * wa;
      hr = tilt[i] * (1 + k2) + 0.13 * Math.sin(t * 0.6 + sd * 3) * (1 - 0.5 * ex);
      jawO = 0.06 + 0.12 * Math.sin(t * 1.1 + sd) ** 2 + ex * 0.28 * (0.5 + 0.5 * Math.sin(t * 7 + sd * 5)) + 0.55 * ak + 0.35 * k2;
    }

    // torso
    compose(mL, 0, 0, 0, tp, ty, tr);
    mul(mTor, mPel, mL);
    compose(mL, 0, 0, 0, 0, 0, 0, fat[i], 1, 0.9 + fat[i] * 0.1);
    mul(mO, mTor, mL); store(A.torso, i, mO);
    // head + jaw
    const hs = headS[i];
    compose(mL, NX, NY, NZ, hpch, hy, hr, hs, hs, hs);
    mul(mHead, mTor, mL); store(A.head, i, mHead);
    if (noJaw[i]) zero(A.jaw, i);
    else { compose(mL, JX, JY, JZ, jawO, 0, 0); mul(mO, mHead, mL); store(A.jaw, i, mO); }
    // arms
    for (let side = 0; side < 2; side++) {
      const sg = side ? 1 : -1;
      const mode = armMode[i * 2 + side];
      const swing = Math.sin(ph + (side ? 0 : Math.PI));
      let pitch, roll, elbow, sy = 1;
      if (crawl) {
        const c = alive ? Math.sin(ph + (side ? 0 : Math.PI)) : 0;
        const raise = alive ? 0.55 + 0.8 * (0.5 + 0.5 * c) * Math.max(0.3, wa) + 0.6 * ak : 0.4 + 0.8 * (sd % 1);
        pitch = -raise - tp; roll = sg * (0.3 + 0.4 * k2); elbow = -0.2 - 0.6 * Math.max(0, -c) * wa;
      } else if (mode === 1 || (d > 0 && mode !== 2)) {
        // limp (or dying): hangs from gravity, swings passively; dead arms flop out
        pitch = -tp * 0.92 + 0.12 * swing * wa + 0.05 - (d > 0 ? (fs > 0 ? -1.2 : 1.1) * k2 * ((sd * (side + 1)) % 1) : 0);
        roll = sg * (0.06 + 0.25 * hit + 1.1 * k2 * ((sd * 3.7 * (side + 2)) % 1));
        elbow = -0.08 - 0.5 * k2 * ((sd * 1.3) % 1);
      } else if (mode === 2) {
        pitch = -tp * 0.8 + 0.15; roll = sg * 0.2; elbow = 0; sy = 0.38;
      } else {
        let raise = (0.25 + 0.5 * wa) * (1 - ex) + 1.25 * ex + raiseOff[i] * sg;
        raise += (1.75 - raise) * ak - 0.4 * hit;
        raise += (0.55 + 0.25 * Math.sin(now * 2.2 + sd + sg) - raise) * kneel;   // pawing at the body
        const sway = 0.18 * swing * wa * (1 - ex) + 0.07 * Math.sin(t * 1.7 + sd + sg) + ex * 0.14 * Math.sin(t * 5 + sg * 2 + sd);
        pitch = -(raise + sway) - tp;
        roll = sg * (0.12 + 0.6 * hit - 0.14 * ex - 0.08 * ak);
        elbow = -(0.25 + 0.35 * Math.min(1, raise)) * (1 - 0.6 * ex) + 0.08 * Math.sin(t * 2.3 + sd + sg);
      }
      compose(mL, SHX * sg * fat[i], SHY, SHZ, pitch, 0, roll, 1, sy, 1);
      mul(mUA, mTor, mL); store(A.uarm, i * 2 + side, mUA);
      if (mode === 2) zero(A.farm, i * 2 + side);
      else { compose(mL, 0, -UARM, 0, elbow, 0, 0); mul(mO, mUA, mL); store(A.farm, i * 2 + side, mO); }
    }
    // hit-test centres
    const k = i * 12;
    pt(mHead, HX, HY, HZ, C, k);
    pt(mTor, 0, 0.38, 0.03, C, k + 3);
    pt(mTor, 0, 0.12, 0.01, C, k + 6);
    pt(mPel, 0, -0.42, 0, C, k + 9);
  }

  // ---------- spawning ----------
  const R = rng(4242 + SEED * 7777);
  const grid = game.collide.grid;
  const walk = (px, pz) => {
    if (inRiver(px, pz)) return false;
    try { return game.collide.walkable(px, pz); } catch { return true; }
  };
  const inCastle = (px, pz) => px > CASTLE.x0 - 2 && px < CASTLE.x1 + 2 && pz > CASTLE.z0 - 2 && pz < CASTLE.z1 + 2;
  const ppos = () => (game.player && game.player.pos) || { x: START.x, y: 0, z: START.z };
  function near(px, pz, r, tries = 12) {
    for (let k = 0; k < tries; k++) {
      const a = R() * Math.PI * 2, rr = k === 0 ? 0 : r * Math.sqrt(R());
      const qx = px + Math.cos(a) * rr, qz = pz + Math.sin(a) * rr;
      if (qx < BOUNDS.x0 + 2 && qx < 1000) continue;
      if (walk(qx, qz)) return [qx, qz];
    }
    return null;
  }
  let spawnPts = ((game.world && game.world.spawns) || []).filter((p) => p && isFinite(p.x) && !inCastle(p.x, p.z));
  if (spawnPts.length < 10) spawnPts = spawnPts.concat(ROUTE.map(([a, b]) => ({ x: a + 6, z: b })).filter((p) => !inCastle(p.x, p.z)));

  const free = [];
  for (let i = cap - 1; i >= 0; i--) free.push(i);
  const corpses = [];
  let alive = 0, killed = 0, pending = 0;

  function spawn(px, pz, o = {}) {
    let i = free.pop();
    if (i === undefined) {
      if (!corpses.length) return -1;
      i = corpses.shift();
    }
    gen[i]++;
    setLook(i);
    if (o.crawler !== undefined) crawler[i] = o.crawler ? 1 : 0;
    x[i] = px; z[i] = pz; y[i] = heightAt(px, pz);
    h[i] = o.h ?? R() * Math.PI * 2;
    hp[i] = 100; spd[i] = 0; vx[i] = vz[i] = 0; atk[i] = -1; hitT[i] = 0; deathT[i] = 0; cool[i] = 0; excite[i] = 0;
    phase[i] = R() * 6.28; prio[i] = 0; seen[i] = 0; horde[i] = o.horde ? 1 : 0;
    if (crawler[i]) fresh[i] = 0;
    tok[i] = 0; aware[i] = 0; goal[i] = 0; burst[i] = burstMax[i]; homeX[i] = px; homeZ[i] = pz;
    sitting[i] = o.sit && !crawler[i] ? 1 : 0; sit[i] = sitting[i];
    state[i] = o.state ?? (R() < 0.6 ? IDLE : WANDER);
    timer[i] = 2 + R() * 10; tx[i] = px; tz[i] = pz; stuckT[i] = 0; stuckX[i] = px; stuckZ[i] = pz;
    alive++;
    pose(i);
    return i;
  }

  function spawnCorpse(px, pz) {
    const i = free.pop();
    if (i === undefined) return -1;
    gen[i]++; setLook(i);
    x[i] = px; z[i] = pz; y[i] = heightAt(px, pz); h[i] = R() * Math.PI * 2;
    hp[i] = 0; spd[i] = 0; vx[i] = vz[i] = 0; atk[i] = -1; hitT[i] = 0; excite[i] = 0; sit[i] = 0; sitting[i] = 0;
    crawler[i] = 0; fallSign[i] = R() < 0.5 ? 1 : -1; deathT[i] = 1; state[i] = CORPSE;
    corpses.push(i);
    pose(i);
    return i;
  }

  {
    const pl = ppos();
    const far = (p) => Math.hypot(p.x - pl.x, p.z - pl.z) > 35 && Math.hypot(p.x - START.x, p.z - START.z) > 30;
    const pts = spawnPts.filter(far);
    const use = pts.length ? pts : spawnPts;
    // seeded shuffle
    const order = use.map((p, k) => [R(), k]).sort((a, b) => a[0] - b[0]).map((a) => use[a[1]]);
    for (let k = 0; k < nWalk && order.length; k++) {
      const p = order[k % order.length];
      const q = near(p.x, p.z, 2 + Math.floor(k / order.length) * 2.5);
      if (q) spawn(q[0], q[1]);
    }
    // the bridge horde: 5 clusters along the deck, alternating sides, so a running player can
    // weave through the lane left on the other side (≥ 3 m) and the gaps between them (~12 m).
    // Each cluster is feeding: two or three kneel over a body and are slow to get up.
    const NCL = 5, CLX = [-36, -18, 0, 18, 36];
    for (let k = 0; k < nHorde; k++) {
      const c = k % NCL, m = Math.floor(k / NCL), side = c % 2 ? -1 : 1;
      const cx = CLX[c], cz = BRIDGE_HORDE.z + side * 2.4;
      if (m === 0) spawnCorpse(cx, cz);
      const feed = m < 3 && !(m === 2 && c % 2);
      const a = (m / 8) * Math.PI * 2 + R() * 0.5, rr = feed ? 0.75 : 1.2 + R() * 1.6;
      let qx = cx + Math.cos(a) * rr * 1.6, qz = cz + Math.sin(a) * rr * 0.55;
      qz = clamp(qz, side > 0 ? 1.1 : -4.1, side > 0 ? 4.1 : -1.1);
      if (!walk(qx, qz)) { const q = near(qx, qz, 1.2); if (!q) continue; [qx, qz] = q; }
      const hd = feed ? Math.atan2(cx - qx, cz - qz) : R() * Math.PI * 2;
      const id = spawn(qx, qz, { horde: true, state: IDLE, h: hd, sit: feed, crawler: m === 3 && c % 2 === 0 ? true : undefined });
      if (id >= 0) timer[id] = 4 + R() * 20;
    }
    for (let k = 0; k < nInt; k++) {
      const p = interiorSpawns[k];
      if (p && isFinite(p.x)) spawn(p.x, p.z, { state: IDLE });
    }
  }
  const target = alive;

  // ---------- flow field ----------
  const NXg = grid.nx, NZg = grid.nz;
  const fdist = new Uint16Array(Math.max(1, NXg * NZg));
  const fq = new Int32Array(Math.max(1, NXg * NZg));
  const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
  const MAXD = 75;
  let fieldOk = false, fieldCell = -1, fieldAge = 1;
  function buildField(px, pz) {
    const gd = grid.data;
    if (!gd) { fieldOk = false; return; }
    const i0 = Math.floor((px - grid.x0) / grid.cell), j0 = Math.floor((pz - grid.z0) / grid.cell);
    if (i0 < 1 || j0 < 1 || i0 >= NXg - 1 || j0 >= NZg - 1) { fieldOk = false; fieldCell = -1; return; }
    let c0 = j0 * NXg + i0;
    if (!gd[c0]) {
      let found = -1;
      for (let r = 1; r <= 2 && found < 0; r++) for (let dj = -r; dj <= r && found < 0; dj++) for (let di = -r; di <= r; di++) {
        const c = c0 + dj * NXg + di; if (c >= 0 && c < gd.length && gd[c]) { found = c; break; }
      }
      if (found < 0) { fieldOk = false; return; }
      c0 = found;
    }
    fdist.fill(65535);
    fdist[c0] = 0;
    let qh = 0, qt = 0; fq[qt++] = c0;
    while (qh < qt) {
      const c = fq[qh++], dc = fdist[c];
      if (dc >= MAXD) continue;
      const ci = c % NXg, cj = (c - ci) / NXg;
      for (let k = 0; k < 8; k++) {
        const ni = ci + DI[k], nj = cj + DJ[k];
        if (ni < 0 || nj < 0 || ni >= NXg || nj >= NZg) continue;
        const n = nj * NXg + ni;
        if (!gd[n] || fdist[n] !== 65535) continue;
        if (k >= 4 && (!gd[c + DI[k]] || !gd[c + DJ[k] * NXg])) continue;
        fdist[n] = dc + 1; fq[qt++] = n;
      }
    }
    fieldOk = true;
  }
  // static fields for the chime drift: east bank → Old Town Square, west bank → Malá Strana square
  function staticField(P0) {
    const out = new Uint16Array(Math.max(1, NXg * NZg)).fill(65535);
    if (!grid.data) return out;
    let qh = 0, qt = 0;
    for (let j = 0; j < NZg; j++) for (let i = 0; i < NXg; i++) {
      const cx = grid.x0 + (i + 0.5) * grid.cell, cz = grid.z0 + (j + 0.5) * grid.cell;
      if (Math.abs(cx - P0.x) < P0.w * 0.3 && Math.abs(cz - P0.z) < P0.d * 0.3 && grid.data[j * NXg + i]) { out[j * NXg + i] = 0; fq[qt++] = j * NXg + i; }
    }
    const gd = grid.data;
    while (qh < qt) {
      const c = fq[qh++], dc = out[c], ci = c % NXg, cj = (c - ci) / NXg;
      for (let k = 0; k < 8; k++) {
        const ni = ci + DI[k], nj = cj + DJ[k];
        if (ni < 0 || nj < 0 || ni >= NXg || nj >= NZg) continue;
        const n = nj * NXg + ni;
        if (!gd[n] || out[n] !== 65535) continue;
        if (k >= 4 && (!gd[c + DI[k]] || !gd[c + DJ[k] * NXg])) continue;
        out[n] = dc + 1; fq[qt++] = n;
      }
    }
    return out;
  }
  const otsDist = staticField(OTS), msDist = staticField(MS_SQUARE);
  const goalField = (i) => (goal[i] === 2 ? msDist : otsDist);
  function flowDir(px, pz, field = fdist) {
    if (field === fdist && !fieldOk) return NaN;
    if (!grid.data) return NaN;
    const i0 = Math.floor((px - grid.x0) / grid.cell), j0 = Math.floor((pz - grid.z0) / grid.cell);
    if (i0 < 1 || j0 < 1 || i0 >= NXg - 1 || j0 >= NZg - 1) return NaN;
    const c = j0 * NXg + i0, gd = grid.data;
    let best = field[c], bk = -1;
    for (let k = 0; k < 8; k++) {
      const n = c + DJ[k] * NXg + DI[k];
      const dn = field[n];
      if (dn < best) {
        if (k >= 4 && (!gd[c + DI[k]] || !gd[c + DJ[k] * NXg])) continue;
        best = dn; bk = k;
      }
    }
    if (bk < 0) return NaN;
    const qx = grid.x0 + (i0 + DI[bk] + 0.5) * grid.cell, qz = grid.z0 + (j0 + DJ[bk] + 0.5) * grid.cell;
    return Math.atan2(qx - px, qz - pz);
  }

  // ---------- separation hash ----------
  const HS = 4096, hhead = new Int32Array(HS), hnext = new Int32Array(cap);
  const hkey = (ix, iz) => ((ix * 73856093) ^ (iz * 19349663)) & (HS - 1);
  const active = new Int32Array(cap);

  // ---------- events ----------
  const isUp = (st) => st >= IDLE && st <= CHASE;
  game.on('noise', (e) => {
    if (!e || !isFinite(e.x)) return;
    const r = e.radius || 10, r2 = r * r;
    const clock = Math.abs(e.x - CLOCK.x) < 1 && Math.abs(e.z - CLOCK.z) < 1;
    for (let i = 0; i < cap; i++) {
      const st = state[i];
      if (!isUp(st) || st === CHASE) continue;
      if (clock && prio[i] >= 2) continue;
      const dx = x[i] - e.x, dz = z[i] - e.z, d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      if (d2 > r2 * 0.5 && ((i * 2654435761 + (now * 10 | 0)) >>> 0) % 2) continue;
      if (sitting[i] && r <= 20 && d2 > 16) continue;          // feeding: deaf to footsteps
      const dn = Math.sqrt(d2), far = dn > FAR_NOISE;
      // far away: only some turn, and they wander over slowly with a wide spread
      if (far && prio[i] >= 1) continue;
      if (far && ((i * 40503 + (now * 3 | 0)) >>> 0) % 3 === 0) continue;
      state[i] = INVEST; prio[i] = 1; sitting[i] = 0;
      const j = far ? Math.min(14, dn * 0.15) : Math.min(4, r * 0.08);
      tx[i] = e.x + (R() - 0.5) * 2 * j; tz[i] = e.z + (R() - 0.5) * 2 * j;
      urg[i] = far ? WALK * 0.8 : r >= 40 ? 1.0 : WALK;
      timer[i] = 15 + dn / urg[i] * (far ? 0.6 : 1.5) + R() * 10;
    }
  });
  // the clock: east-bank dead (and the bridge horde) drift to Old Town Square; the west bank
  // hears it across the river but mills into Malá Strana square instead of crossing.
  game.on('chime', () => {
    for (let i = 0; i < cap; i++) {
      const st = state[i];
      if (!isUp(st) || st === CHASE || x[i] > 1000) continue;
      const west = x[i] < RIVER.x0;
      const G = west ? MS_SQUARE : OTS;
      if (west ? x[i] < CASTLE.x1 + 10 || Math.hypot(x[i] - G.x, z[i] - G.z) > 160 : Math.hypot(x[i] - OTS.x, z[i] - OTS.z) > 250) continue;
      state[i] = INVEST; prio[i] = 2; goal[i] = west ? 2 : 1; sitting[i] = 0;
      tx[i] = G.x + (R() - 0.5) * G.w * 0.7; tz[i] = G.z + (R() - 0.5) * G.d * 0.7;
      timer[i] = 150; urg[i] = horde[i] ? 1.0 : 0.6;
    }
  });

  // ---------- AI helpers ----------
  const tmpPos = { x: 0, y: 0, z: 0 };
  const rayO = { x: 0, y: 0, z: 0 }, rayD = { x: 0, y: 0, z: 0 };
  function canSee(i, d, pl) {
    const player = game.player || {};
    if (player.alive === false) return false;
    const hr = game.time ? game.time.hour : 18;
    const night = hr > 20 || hr < 5;
    const light = !!player.flashlight;
    let range = night ? (light ? 38 : 12) : (light ? 33 : 30);
    const crouch = player.crouch || player.crouching || (player.noise > 0 && player.noise < 0.2);
    if (crouch) range = night && light ? range * 0.7 : Math.min(range, 6);
    if (sitting[i]) range = Math.min(range, 8);               // head down in a body
    if (d > range && d > 3) return false;
    const dx = pl.x - x[i], dz = pl.z - z[i];
    const inv = 1 / (d || 1);
    const cosA = (Math.sin(h[i]) * dx + Math.cos(h[i]) * dz) * inv;
    if (cosA < 0.35 && d > (crouch ? 1.5 : 3)) return false;
    // line of sight
    rayO.x = x[i]; rayO.y = y[i] + (crawler[i] ? 0.4 : 1.55); rayO.z = z[i];
    const ty2 = (pl.y || 0) + 1.4;
    const ddx = pl.x - rayO.x, ddy = ty2 - rayO.y, ddz = pl.z - rayO.z, L = Math.hypot(ddx, ddy, ddz) || 1;
    rayD.x = ddx / L; rayD.y = ddy / L; rayD.z = ddz / L;
    let hit = Infinity;
    try { hit = game.collide.raycast(rayO, rayD, L); } catch { hit = Infinity; }
    return hit >= L - 0.4;
  }

  function startChase(i) {
    if (state[i] !== CHASE) { state[i] = CHASE; groanAt(i, 1); }
    sitting[i] = 0;
    prio[i] = 3; lastSeen[i] = now;
  }

  // ---------- audio ----------
  let groanCool = 0;
  function groanAt(i, intensity) {
    if (groanCool > 0) return;
    groanCool = 0.35;
    try { game.audio && game.audio.groan && game.audio.groan(x[i], z[i], intensity); } catch { /* audio is optional */ }
  }

  // ---------- death ----------
  function die(i, dx, dz) {
    if (!isUp(state[i])) return;
    state[i] = DYING; deathT[i] = 0; atk[i] = -1; hp[i] = 0;
    const fx = Math.sin(h[i]), fz = Math.cos(h[i]);
    const along = dx * fx + dz * fz;
    fallSign[i] = along > 0.2 ? 1 : along < -0.2 ? -1 : (seed[i] % 2 < 1 ? 1 : -1);
    alive--; killed++; pending++;
    corpses.push(i);
    while (corpses.length > CORPSE_MAX) { const c = corpses.shift(); state[c] = FREE; hide(c); free.push(c); }
    game.emit('deadKilled', { x: x[i], z: z[i] });
  }

  let lastRay = { id: -1, part: '', t: -1 };
  function damage(id, dmg, dir, part) {
    if (id < 0 || id >= cap || !isUp(state[id])) return false;
    if (!part && lastRay.id === id && now - lastRay.t < 0.25) part = lastRay.part;
    let dmgv = +dmg || 0;
    if (part === 'head') dmgv *= 2;
    let dx = dir ? dir.x || 0 : 0, dz = dir ? dir.z || 0 : 0;
    const L = Math.hypot(dx, dz);
    if (L > 1e-6) { dx /= L; dz /= L; } else { const pl = ppos(); dx = x[id] - pl.x; dz = z[id] - pl.z; const l2 = Math.hypot(dx, dz) || 1; dx /= l2; dz /= l2; }
    hp[id] -= dmgv;
    const kb = (1.4 + Math.min(3, dmgv / 25)) * (crawler[id] ? 0.3 : 1);
    vx[id] = dx * kb; vz[id] = dz * kb;
    hitT[id] = 1; atk[id] = -1; cool[id] = Math.max(cool[id], 0.5);
    if (hp[id] <= 0) { die(id, dx, dz); return true; }
    if (!game.player || game.player.alive !== false) startChase(id);
    groanAt(id, 0.8);
    return true;
  }

  // ---------- update ----------
  const _pm = new THREE.Matrix4(), _fr = new THREE.Frustum(), _sp = new THREE.Sphere();
  let frame = 0, respawnT = 10, warned = false;
  const stats = { ms: 0, active: 0, posed: 0, chasing: 0, attackers: 0 };

  function update(dt) {
    try { step(Math.min(0.05, dt || 0)); } catch (e) { if (!warned) { warned = true; console.error('[dead]', e); } }
  }

  function step(dt) {
    const t0 = performance.now();
    now += dt; frame++;
    groanCool -= dt;
    const player = game.player || {};
    const pl = ppos();
    const plAlive = player.alive !== false;
    const px = pl.x, pz = pl.z;
    for (let i = 0; i < cap; i++) if (tok[i] && state[i] !== CHASE) tok[i] = 0;

    // flow field ≤ 4 Hz, only when the player's cell changes
    fieldAge += dt;
    if (fieldAge >= 0.25 && grid.data) {
      const ci = Math.floor((px - grid.x0) / grid.cell), cj = Math.floor((pz - grid.z0) / grid.cell);
      const cell = cj * NXg + ci;
      if (cell !== fieldCell) { fieldCell = cell; fieldAge = 0; buildField(px, pz); }
    }

    // pass 1: distances, active list, separation hash
    hhead.fill(-1);
    let na = 0;
    for (let i = 0; i < cap; i++) {
      const st = state[i];
      if (st === FREE || st === CORPSE) continue;
      const dx = x[i] - px, dz = z[i] - pz;
      const d = Math.sqrt(dx * dx + dz * dz);
      pdist[i] = d;
      if (d < ACTIVE_R && st !== DYING) {
        active[na++] = i;
        const k = hkey(Math.floor(x[i] / 1.5), Math.floor(z[i] / 1.5));
        hnext[i] = hhead[k]; hhead[k] = i;
      }
    }
    stats.active = na;

    // attack tokens: at most MAX_ATTACKERS of the chasers may close in and swing at once
    let nt = 0, chasing = 0;
    for (let a = 0; a < na; a++) {
      const i = active[a];
      if (state[i] === CHASE) chasing++;
      if (tok[i] && (state[i] !== CHASE || pdist[i] > WAIT_R + 1.4 || !plAlive)) tok[i] = 0;
      if (tok[i]) nt++;
    }
    stats.chasing = chasing;
    while (nt < MAX_ATTACKERS && plAlive) {
      let bi = -1, bd = WAIT_R + 0.9;
      for (let a = 0; a < na; a++) { const i = active[a]; if (state[i] === CHASE && !tok[i] && pdist[i] < bd && hitT[i] <= 0) { bd = pdist[i]; bi = i; } }
      if (bi < 0) break;
      tok[bi] = 1; nt++;
    }
    stats.attackers = nt;

    let posed = 0;
    for (let i = 0; i < cap; i++) {
      const st = state[i];
      if (st === FREE || st === CORPSE) continue;
      if (st === DYING) {
        deathT[i] += dt / DEATH_T;
        if (deathT[i] >= 1) { deathT[i] = 1; state[i] = CORPSE; }
        y[i] = heightAt(x[i], z[i]);
        pose(i); posed++;
        continue;
      }
      const d = pdist[i];
      if (d >= ACTIVE_R) {
        // coarse: every 16th frame, straight-line moves on the nav grid
        if ((frame + i) % 16 === 0) { coarse(i, dt * 16); pose(i); posed++; }
        continue;
      }
      think(i, dt, d, px, pz, pl, plAlive, player);
      if (d < 50 || ((frame + i) & 1) === 0) { pose(i); posed++; }
    }
    stats.posed = posed;

    // groans: a random nearby walker now and then
    if (groanCool <= 0 && na) {
      const i = active[(R() * na) | 0];
      if (pdist[i] < 40 && R() < 0.08) groanAt(i, state[i] === CHASE ? 1 : 0.35);
    }

    // respawn kills to keep pressure: at most one per 10 s, ≥ 60 m away, never in view, and
    // never while the player already has three or more on their heels
    respawnT -= dt;
    if (respawnT <= 0 && pending > 0 && alive < target && chasing < 3) {
      const yaw = player.yaw || 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const cam = game.camera;
      if (cam && cam.projectionMatrix) { cam.updateMatrixWorld(); _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm); }
      for (let k = 0; k < 16; k++) {
        const p = spawnPts[(R() * spawnPts.length) | 0];
        if (!p) break;
        const q = near(p.x, p.z, 3);
        if (!q) continue;
        const dx = q[0] - px, dz = q[1] - pz, d = Math.hypot(dx, dz);
        if (d < 60 || d > 115) continue;
        if ((dx * fx + dz * fz) / d > 0) continue;                 // anywhere in front of the player
        if (cam && cam.projectionMatrix && x.length) {
          _sp.center.set(q[0], heightAt(q[0], q[1]) + 1, q[1]); _sp.radius = 1.5;
          if (_fr.intersectsSphere(_sp)) continue;
        }
        if (spawn(q[0], q[1]) >= 0) { pending--; respawnT = 10; break; }
      }
      if (respawnT <= 0) respawnT = 1;
    }

    for (const m of meshList) m.instanceMatrix.needsUpdate = true;
    stats.ms = performance.now() - t0;
  }

  function coarse(i, dtc) {
    const st = state[i];
    if (st === CHASE) { state[i] = INVEST; prio[i] = 1; timer[i] = 20; }
    if (state[i] !== INVEST && state[i] !== WANDER) { spd[i] = 0; return; }
    timer[i] -= dtc;
    const dx = tx[i] - x[i], dz = tz[i] - z[i], d = Math.hypot(dx, dz);
    if (d < 2 || timer[i] <= 0) { state[i] = IDLE; prio[i] = 0; timer[i] = 5 + R() * 10; spd[i] = 0; return; }
    const v = (state[i] === INVEST ? urg[i] || WALK : WANDER_V) * sf[i] * (crawler[i] ? 0.35 : 1);
    let base = Math.atan2(dx, dz);
    if (prio[i] === 2 && d > 6) { const f = flowDir(x[i], z[i], goalField(i)); if (f === f) base = f; }
    const step = Math.min(d, v * dtc);
    for (const off of [0, 0.7, -0.7, 1.4, -1.4]) {
      const a = base + off, nx = x[i] + Math.sin(a) * step, nz = z[i] + Math.cos(a) * step;
      if (walk(nx, nz)) { x[i] = nx; z[i] = nz; h[i] = a; y[i] = heightAt(nx, nz); spd[i] = v; phase[i] += dtc * v * 6; return; }
    }
    state[i] = IDLE; timer[i] = 5; spd[i] = 0;
  }

  function wanderTarget(i) {
    const r = horde[i] ? 2.5 : 14;
    for (let k = 0; k < 4; k++) {
      const a = R() * Math.PI * 2, rr = (horde[i] ? 0.5 : 3) + R() * r;
      const bx = horde[i] && prio[i] === 0 ? homeX[i] : x[i], bz = horde[i] && prio[i] === 0 ? homeZ[i] : z[i];
      const qx = bx + Math.sin(a) * rr * (horde[i] ? 1.6 : 1), qz = bz + Math.cos(a) * rr * (horde[i] ? 0.5 : 1);
      if (walk(qx, qz)) { tx[i] = qx; tz[i] = qz; return true; }
    }
    return false;
  }

  function think(i, dt, d, px, pz, pl, plAlive, player) {
    let st = state[i];
    // perception at ~8 Hz, staggered
    if ((frame + i) % 8 === 0 && !api.debug.blind) {
      const vis = plAlive && d < 45 && canSee(i, d, pl);
      seen[i] = vis ? 1 : 0;
      // noticing takes a moment: ~0.5 s up close, ~2 s at 25 m (faster if the player is loud);
      // while it builds the walker stops and turns its head — a beat to back off or slip past
      const pdt = dt * 8;
      if (vis && st !== CHASE) {
        const loud = 1 + 1.5 * clamp(+player.noise || 0, 0, 1);
        aware[i] += pdt * clamp(2.4 - d * 0.08, 0.5, 3) * loud * (prio[i] ? 1.5 : 1);
      } else if (st !== CHASE) aware[i] = Math.max(0, aware[i] - pdt * 0.4);
      if (vis && (st === CHASE || aware[i] >= 1)) {
        if (st !== CHASE) {
          startChase(i);
          // wake the ones shuffling right next to it
          for (let k = 0; k < cap; k++) {
            if (k === i || !isUp(state[k]) || state[k] === CHASE) continue;
            if (sitting[k] || Math.abs(x[k] - x[i]) > 5 || Math.abs(z[k] - z[i]) > 5) continue;
            state[k] = INVEST; prio[k] = 1; tx[k] = px; tz[k] = pz; timer[k] = 20; urg[k] = 1.0;
          }
        }
        lastSeen[i] = now; tx[i] = px; tz[i] = pz;
      }
      st = state[i];
      // a trailing chaser left well behind loses interest now and then (fresh ones bursting don't)
      const bored = st === CHASE && d > 16 && !(fresh[i] && burst[i] > 0) && hash01(i, now | 0) < 0.15 * pdt * (d - 12) / 6;
      if (st === CHASE && (bored || (!vis && (now - lastSeen[i] > 6 || !plAlive || d > 45 || (d > 22 && now - lastSeen[i] > 2))))) {
        aware[i] = 0;
        state[i] = st = INVEST; prio[i] = 1; timer[i] = 15 + d * 1.2; urg[i] = 1.1;
        if (plAlive) { tx[i] = px; tz[i] = pz; }
      }
    }
    if (st === CHASE && seen[i]) { tx[i] = px; tz[i] = pz; }

    hitT[i] = Math.max(0, hitT[i] - dt / HIT_T);
    cool[i] -= dt;
    excite[i] += ((st === CHASE ? 1 : 0) - excite[i]) * Math.min(1, dt * 2.5);

    let want = 0, desired = h[i], turn = 2.2;
    const crawl = crawler[i] === 1;
    // feeding ones take ~1.5 s to get up once something pulls them away
    sit[i] += clamp(sitting[i] - sit[i], -dt / RISE_T, dt / RISE_T);
    if (st === IDLE) {
      timer[i] -= dt;
      if (sitting[i]) timer[i] = Math.max(timer[i], 1);
      else if (timer[i] <= 0) {
        if (wanderTarget(i)) { state[i] = WANDER; timer[i] = 20; } else timer[i] = 4;
      }
    } else if (st === WANDER || st === INVEST) {
      timer[i] -= dt;
      const dx = tx[i] - x[i], dz = tz[i] - z[i], dd = Math.hypot(dx, dz);
      if (dd < 1.2 || timer[i] <= 0) {
        state[i] = IDLE; prio[i] = 0; goal[i] = 0; burst[i] = burstMax[i]; timer[i] = st === INVEST ? 4 + R() * 6 : 3 + R() * 12;
      } else {
        want = st === INVEST ? urg[i] || WALK : WANDER_V;
        desired = Math.atan2(dx, dz);
        if (st === INVEST && prio[i] === 2 && dd > 6) {
          const f = flowDir(x[i], z[i], goalField(i)); if (f === f) desired = f;
        } else if (st === INVEST && fieldOk && (tx[i] - px) ** 2 + (tz[i] - pz) ** 2 < 150 && dd > 4) {
          const f = flowDir(x[i], z[i]); if (f === f) desired = f;
        }
      }
    } else if (st === CHASE) {
      turn = 4;
      if (atk[i] >= 0) {
        const prev = atk[i];
        atk[i] += dt;
        if (prev < ATK_HIT && atk[i] >= ATK_HIT && plAlive && d < ATK_REACH && hitT[i] <= 0) {
          try { player.damage && player.damage(15, { x: x[i], z: z[i] }); } catch { /* player owns its errors */ }
          game.emit('playerHurt', { dmg: 15, from: { x: x[i], z: z[i] } });
          groanAt(i, 1);
        }
        if (atk[i] >= ATK_T) atk[i] = -1;
        desired = Math.atan2(px - x[i], pz - z[i]);
        // the windup shuffles in a little; the player can still step out of reach
        want = atk[i] < ATK_HIT && d > 1.0 ? (fresh[i] && burst[i] > 0 ? runV[i] : 0.3) : 0;
      } else if (!tok[i] && plAlive && d < WAIT_R + 0.5) {
        // waiting for a turn: hold ~2 m off, circle and jostle round the ones in front
        const ox2 = x[i] - px, oz2 = z[i] - pz, inv = 1 / (d || 1), sg = dragSide[i];
        const rad = clamp((WAIT_R - d) * 2.5, -1, 1);
        const vx2 = -oz2 * inv * sg * 0.8 + ox2 * inv * rad, vz2 = ox2 * inv * sg * 0.8 + oz2 * inv * rad;
        desired = Math.atan2(vx2, vz2);
        want = 0.5 + 0.6 * Math.abs(rad);
        turn = 5;
      } else {
        const direct = seen[i] && d < 14 || d < 4;
        desired = Math.atan2(tx[i] - x[i], tz[i] - z[i]);
        if (!direct) { const f = flowDir(x[i], z[i]); if (f === f) desired = f; }
        let base = chaseV[i], lurch = 0.86 + 0.44 * Math.max(0, Math.sin(phase[i]));   // mean ≈ 1, peak < walking pace
        if (fresh[i] && burst[i] > 0) { burst[i] -= dt; base = runV[i]; lurch = 0.93 + 0.22 * Math.max(0, Math.sin(phase[i])); }
        want = base * lurch;
        if (d < ATK_RANGE + (crawl ? 0.2 : 0) && plAlive && tok[i] && cool[i] <= 0 && hitT[i] <= 0) {
          atk[i] = 0; cool[i] = ATK_COOL; want = 0; if (!(fresh[i] && burst[i] > 0)) spd[i] = Math.min(spd[i], 1.4);   // plants its feet: the tell (a running fresh one grabs on the move)
        } else if (d < 1.05) want = 0;
        if (!plAlive && d < 2) want = 0;
      }
    }
    if (hitT[i] > 0 || sit[i] > 0.05) want = 0;
    if (st !== CHASE && aware[i] > 0.25 && seen[i]) { want = 0; desired = Math.atan2(px - x[i], pz - z[i]); turn = 1.5; }
    want *= (st === CHASE ? 1 : sf[i]) * (crawl ? (st === CHASE ? 0.27 : 0.5) : 1);

    // turn, accelerate, move
    const diff = wrapA(desired - h[i]);
    const mt = turn * dt;
    h[i] += diff > mt ? mt : diff < -mt ? -mt : diff;
    if (Math.abs(diff) > 1.4) want *= 0.25;
    spd[i] += clamp(want - spd[i], -4 * dt, 3 * dt);
    const v = spd[i];
    const ox = x[i], oz = z[i];
    let nx = x[i] + Math.sin(h[i]) * v * dt + vx[i] * dt;
    let nz = z[i] + Math.cos(h[i]) * v * dt + vz[i] * dt;
    const kd = Math.exp(-6 * dt); vx[i] *= kd; vz[i] *= kd;
    // gait phase: shuffling steps ~0.45 m, longer when chasing
    phase[i] += dt * (v / (0.42 + 0.25 * excite[i])) * Math.PI * (crawl ? 0.8 : 1);

    // separation
    const ix = Math.floor(nx / 1.5), iz = Math.floor(nz / 1.5);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (let j = hhead[hkey(ix + a, iz + b)]; j >= 0; j = hnext[j]) {
        if (j === i) continue;
        const sx = nx - x[j], sz = nz - z[j], s2 = sx * sx + sz * sz;
        if (s2 < 0.49 && s2 > 1e-6) { const s = Math.sqrt(s2), push = (0.7 - s) * 0.5 / s; nx += sx * push; nz += sz * push; }
      }
    }
    // keep out of the player
    if (plAlive) {
      const sx = nx - px, sz = nz - pz, s2 = sx * sx + sz * sz;
      if (s2 < 0.72 && s2 > 1e-6) { const s = Math.sqrt(s2), k = (0.85 - s) / s; nx += sx * k; nz += sz * k; }
    }
    tmpPos.x = nx; tmpPos.z = nz; tmpPos.y = y[i];
    try { game.collide.resolve(tmpPos, 0.3, y[i]); } catch { /* keep going */ }
    nx = tmpPos.x; nz = tmpPos.z;
    if (nx < 1000 && (inRiver(nx, nz) || nx < BOUNDS.x0 || nx > BOUNDS.x1 || nz < BOUNDS.z0 || nz > BOUNDS.z1)) {
      nx = ox; nz = oz;
      if (state[i] === WANDER || state[i] === INVEST) { state[i] = IDLE; timer[i] = 2; }
    }
    x[i] = nx; z[i] = nz; y[i] = heightAt(nx, nz);

    // stuck → give up on the target
    stuckT[i] += dt;
    if (stuckT[i] > 2.5) {
      const moved = Math.hypot(x[i] - stuckX[i], z[i] - stuckZ[i]);
      if (moved < 0.25 && spd[i] > 0.2 && (state[i] === WANDER || state[i] === INVEST)) {
        if (wanderTarget(i)) { state[i] = WANDER; timer[i] = 10; } else { state[i] = IDLE; timer[i] = 3; }
      }
      stuckT[i] = 0; stuckX[i] = x[i]; stuckZ[i] = z[i];
    }
  }

  // ---------- queries ----------
  const RAD = [0.125, 0.2, 0.18, 0.17], PART = ['head', 'body', 'body', 'legs'];
  function raycast(o, dir, maxDist = 200) {
    const dl = Math.hypot(dir.x, dir.y || 0, dir.z) || 1;
    const dx = dir.x / dl, dy = (dir.y || 0) / dl, dz = dir.z / dl;
    let best = maxDist, bi = -1, bp = '';
    for (let i = 0; i < cap; i++) {
      if (!isUp(state[i])) continue;
      const cx = x[i] - o.x, cy = y[i] + 0.8 - o.y, cz = z[i] - o.z;
      const tca = cx * dx + cy * dy + cz * dz;
      if (tca < -1.5 || tca - 1.5 > best) continue;
      if (cx * cx + cy * cy + cz * cz - tca * tca > 2.1) continue;
      const s = scale[i];
      for (let p = 0; p < 4; p++) {
        if (p === 3 && crawler[i]) continue;
        const k = i * 12 + p * 3;
        const ex = C[k] - o.x, ey = C[k + 1] - o.y, ez = C[k + 2] - o.z;
        const tc = ex * dx + ey * dy + ez * dz;
        const r = RAD[p] * s * (p === 0 ? headS[i] : 1);
        const d2 = ex * ex + ey * ey + ez * ez - tc * tc;
        if (d2 > r * r) continue;
        let th = tc - Math.sqrt(r * r - d2);
        if (th < 0) th = tc;
        if (th >= 0 && th < best) { best = th; bi = i; bp = PART[p]; }
      }
      // lower legs
      if (!crawler[i]) {
        const ex = x[i] - o.x, ey = y[i] + 0.28 * s - o.y, ez = z[i] - o.z;
        const tc = ex * dx + ey * dy + ez * dz, d2 = ex * ex + ey * ey + ez * ez - tc * tc, r = 0.16 * s;
        if (d2 < r * r) { let th = tc - Math.sqrt(r * r - d2); if (th < 0) th = tc; if (th >= 0 && th < best) { best = th; bi = i; bp = 'legs'; } }
      }
    }
    if (bi < 0) return null;
    lastRay = { id: bi, part: bp, t: now };
    return { dist: best, id: bi, part: bp, point: { x: o.x + dx * best, y: o.y + dy * best, z: o.z + dz * best } };
  }

  function meleeHit(o, dir, range = 1.8, dmg = 34) {
    const dl = Math.hypot(dir.x, dir.z) || 1, fx = dir.x / dl, fz = dir.z / dl;
    const L3 = Math.hypot(dir.x, dir.y || 0, dir.z) || 1, dx = dir.x / L3, dy = (dir.y || 0) / L3, dz = dir.z / L3;
    let bi = -1, bd = Infinity;
    for (let i = 0; i < cap; i++) {
      if (!isUp(state[i])) continue;
      const k = i * 12 + 3;
      const vx2 = C[k] - o.x, vz2 = C[k + 2] - o.z;
      const hd = Math.hypot(vx2, vz2);
      if (hd > range + 0.35) continue;
      if (hd > 0.45 && (vx2 * fx + vz2 * fz) / hd < 0.55) continue;
      if (hd < bd) { bd = hd; bi = i; }
    }
    if (bi < 0) return false;
    // head if the swing line passes close to the skull
    const k = bi * 12;
    const ex = C[k] - o.x, ey = C[k + 1] - o.y, ez = C[k + 2] - o.z;
    const tc = ex * dx + ey * dy + ez * dz;
    const miss = ex * ex + ey * ey + ez * ez - tc * tc;
    return damage(bi, dmg, { x: fx, z: fz }, tc > 0 && miss < 0.22 * 0.22 ? 'head' : 'body');
  }

  function nearest(qx, qz) {
    let b = Infinity;
    for (let i = 0; i < cap; i++) {
      if (!isUp(state[i])) continue;
      const dx = x[i] - qx, dz = z[i] - qz, d = dx * dx + dz * dz;
      if (d < b) b = d;
    }
    return Math.sqrt(b);
  }

  const api = {
    update, raycast, meleeHit, nearest,
    damage: (id, dmg, dir, part) => damage(id, dmg, dir, part),
    get count() { return alive + corpses.length; },
    get alive() { return alive; },
    get killed() { return killed; },
    stats,
    meshes: meshList,
    // test / debug hooks
    debug: {
      spawn: (px, pz, o = {}) => spawn(px, pz, o),
      kill: (i) => damage(i, 1e6, { x: 0, z: 1 }),
      clear() { for (let i = 0; i < cap; i++) if (state[i] !== FREE) { if (isUp(state[i])) alive--; state[i] = FREE; hide(i); free.push(i); } corpses.length = 0; },
      info: (i) => ({ x: x[i], z: z[i], y: y[i], h: h[i], state: ['free', 'idle', 'wander', 'invest', 'chase', 'dying', 'corpse'][state[i]], hp: hp[i], crawler: crawler[i], spd: spd[i], d: pdist[i], tok: tok[i], atk: atk[i], fresh: fresh[i], sit: sit[i], horde: horde[i], goal: goal[i] }),
      near(qx, qz, r) { const o = []; for (let i = 0; i < cap; i++) if (isUp(state[i])) { const d = Math.hypot(x[i] - qx, z[i] - qz); if (d < r) o.push({ id: i, x: x[i], z: z[i], d, st: state[i], tok: tok[i], atk: atk[i] }); } return o; },
      states() { const c = {}; for (let i = 0; i < cap; i++) { const n = ['free', 'idle', 'wander', 'invest', 'chase', 'dying', 'corpse'][state[i]]; c[n] = (c[n] || 0) + 1; } return c; },
      set(i, o) { if (o.h !== undefined) h[i] = o.h; if (o.state !== undefined) state[i] = o.state; if (o.crawler !== undefined) crawler[i] = o.crawler; if (o.x !== undefined) { x[i] = o.x; z[i] = o.z; y[i] = heightAt(o.x, o.z); } if (o.tx !== undefined) { tx[i] = o.tx; tz[i] = o.tz; timer[i] = 60; urg[i] = o.v || WALK; } if (o.arm !== undefined) { armMode[i * 2] = o.arm[0]; armMode[i * 2 + 1] = o.arm[1]; } pose(i); },
      STATES: { FREE, IDLE, WANDER, INVEST, CHASE, DYING, CORPSE },
      field: () => ({ ok: fieldOk }),
      get pending() { return pending; }, get target() { return target; }, get respawnT() { return respawnT; },
      atlas,
      cap,
    },
  };
  return api;
}
