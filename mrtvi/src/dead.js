// MRTVÍ — the dead. Up to 300 walkers drawn as 7 instanced body-part meshes, posed in JS
// every frame into instance matrices. AI: idle/wander → hear → investigate → see → chase →
// lunge. Flow field on the collide grid towards the player. See CONTRACT.md (dead.js).
import * as THREE from 'three';
import { rng, heightAt, inRiver, BOUNDS, BRIDGE_HORDE, OTS, RIVER, CASTLE, CASTLE_GATE, START, CLOCK, ROUTE, PHARMACY_DOOR, ST_NICHOLAS } from './layout.js';
import { buildParts, SKEL } from './dead/geometry.js';
import { makeAtlases } from './dead/atlas.js';

const MAXN = 300, ACTIVE_R = 120, CORPSE_MAX = 60;
const FREE = 0, IDLE = 1, WANDER = 2, INVEST = 3, CHASE = 4, DYING = 5, CORPSE = 6;
// attack: ~0.5 s windup with arms raised, damage at the end only if the player is still in reach
const ATK_T = 0.8, ATK_HIT = 0.52, ATK_RANGE = 1.3, ATK_REACH = 1.6, DEATH_T = 1.25, HIT_T = 0.45;
const WALK = 0.7, WANDER_V = 0.45;
const MAX_ATTACKERS = 2, MAX_ATTACKERS_MOB = 3, MOB_N = 5, WAIT_R = 2.1, RISE_T = 1.5, FAR_NOISE = 60;

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
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const STUB = { update() {}, count: 0, alive: 0, seeing: 0, raycast: () => null, meleeHit: () => null, damage: () => false, nearest: () => Infinity };
const VIEW_R = 90, FADE_R0 = 80;   // the dead dither out over 80–90 m instead of popping
// Population (default run): WALK_N street walkers in all — WALK_N − TEACH_N scattered from
// world.spawns plus TEACH_N placed (3 for the opening, 5 feeding just off the route) — + a bridge horde of 14–24 (by seed)
// + up to 3 in the pharmacy, i.e. 142–152 up at the start (+4 bridge corpses). The late
// climax adds CLIMAX 10–14 more once the medicine is past Malá Strana.
const WALK_N = 125, TEACH_N = 8, HORDE_MIN = 14, HORDE_MAX = 24;
// stealth: a blow lands "from behind" within 100° of the back (dot(facing, to-attacker) ≤ 0.17)
const BEHIND_DOT = -0.17;
// west-bank chime gathering points, off the route: below St Nicholas' dome and on Kampa
const KAMPA = { x: -60, z: 50 };

export function create(game) {
  const P = game.params || new URLSearchParams();
  if (P.has('nodead')) return STUB;
  // the run seed comes from main (game.state.seed, itself from ?seed=N); the trailer stays fixed
  const SEED = P.has('trailer') ? 0 : Math.floor(+((game.state && game.state.seed) ?? P.get('seed')) || 0);

  // ---------- population ----------
  const interiorSpawns = (game.interior && (game.interior.spawns || game.interior.deadSpawns)) || [];
  // interior slots are reserved first so a big ?dead=N never empties the pharmacy
  let nWalk, nHorde, nInt;
  const HORDE_N = HORDE_MIN + Math.floor(rng(271 + SEED * 977)() * (HORDE_MAX - HORDE_MIN + 1));
  if (P.has('dead')) {
    const n = clamp(Math.floor(+P.get('dead') || 0), 0, MAXN);
    nInt = Math.min(interiorSpawns.length, 3, n);
    const rest = n - nInt;
    nHorde = Math.min(HORDE_N, Math.floor(rest * 0.15));
    nWalk = rest - nHorde;
  } else { nInt = Math.min(interiorSpawns.length, 3); nWalk = WALK_N; nHorde = HORDE_N; }
  const total = nWalk + nHorde + nInt;
  if (total <= 0) return STUB;
  const cap = Math.min(MAXN, total + 56);

  // ---------- state (SoA) ----------
  const F = () => new Float32Array(cap);
  const x = F(), z = F(), y = F(), h = F(), spd = F(), vx = F(), vz = F(), tx = F(), tz = F(), timer = F(), hp = F();
  const phase = F(), atk = F().fill(-1), hitT = F(), deathT = F(), cool = F(), lastSeen = F(), excite = F(), scale = F();
  const stoop = F(), tilt = F(), seed = F(), sf = F(), lean = F(), fat = F(), headS = F(), urg = F(), fallSign = F();
  const aware = F(), stuckT = F(), stuckX = F(), stuckZ = F(), raiseOff = F(), pdist = F().fill(1e9), tgtV = F();
  const state = new Uint8Array(cap), prio = new Uint8Array(cap), crawler = new Uint8Array(cap), noJaw = new Uint8Array(cap);
  const horde = new Uint8Array(cap), seen = new Uint8Array(cap), armMode = new Uint8Array(cap * 2), dragSide = new Int8Array(cap);
  const gen = new Uint16Array(cap), gcool = F(), fellSnd = new Uint8Array(cap), lastX = F(), lastZ = F();
  // fresh runners, per-individual chase speed, attack tokens, sitting/feeding, chime goal, horde home
  const fresh = new Uint8Array(cap), tok = new Uint8Array(cap), sitting = new Uint8Array(cap), goal = new Uint8Array(cap);
  const teachD = new Uint8Array(cap), hunt = new Uint8Array(cap);   // opening walkers; climax hunters
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
varying vec2 vUv2; varying vec4 vT; varying float vGore; varying vec4 vSkin; varying vec4 vCloth; varying vec2 vMisc; varying vec3 vPos; varying float vFade;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec4 io = vec4(0.0, 0.0, 0.0, 1.0);
#ifdef USE_INSTANCING
io = instanceMatrix * io;
#endif
vFade = 1.0 - smoothstep(${FADE_R0.toFixed(1)}, ${VIEW_R.toFixed(1)}, distance((modelMatrix * io).xz, cameraPosition.xz));
vPos = position; vUv2 = aUv; vT = aT; vGore = aGore; vSkin = aSkin; vCloth = aT.z < 0.5 ? aClothA : aClothB; vMisc = aMisc.xy;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uSkinMap; uniform sampler2D uClothMap;
varying vec2 vUv2; varying vec4 vT; varying float vGore; varying vec4 vSkin; varying vec4 vCloth; varying vec2 vMisc; varying vec3 vPos; varying float vFade;
vec3 deadFace(vec3 p, vec3 base, float seed) {
  vec3 u = (p - vec3(0.0, 0.1, 0.025)) / vec3(0.079, 0.102, 0.094);
  float front = smoothstep(0.3, 0.65, u.z);
  vec2 q = vec2(abs(u.x), u.y);
  float w = length((q - vec2(0.36, 0.13)) / vec2(1.0, 0.8));
  float sock = (1.0 - smoothstep(0.13, 0.21, w)) * front;
  float ring = (1.0 - smoothstep(0.16, 0.42, w)) * front;
  base *= mix(vec3(1.0), vec3(0.62, 0.48, 0.5), ring);
  // sunken, filmed-over eyes: dull and dark, never glowing
  float eye = 1.0 - smoothstep(0.04, 0.065, length(q - vec2(0.37, 0.105)));
  base = mix(base, mix(base * vec3(0.16, 0.12, 0.12), vec3(0.13, 0.13, 0.11), eye), sock);
  float nose = (1.0 - smoothstep(0.8, 1.0, length((q - vec2(0.0, -0.13)) / vec2(0.08, 0.13)))) * front;
  base = mix(base, vec3(0.015, 0.008, 0.008), nose);
  float cheek = smoothstep(0.32, 0.5, q.x) * (1.0 - smoothstep(0.72, 0.88, q.x)) * smoothstep(0.05, -0.12, u.y) * smoothstep(-0.62, -0.35, u.y) * front;
  base *= 1.0 - 0.3 * cheek;
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
// distance fade: screen-door dither (stays opaque, no sorting), gone by VIEW_R
if (vFade < 0.999 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > vFade) discard;
{
  vec2 gx = dFdx(vUv2), gy = dFdy(vUv2);
  vec2 ss = vec2(0.5);
  float st = floor(vSkin.w + 0.5);
  vec3 sk = textureGrad(uSkinMap, (fract(vUv2) * 0.98 + 0.01 + vec2(mod(st, 2.0), 1.0 - floor(st / 2.0))) * ss, gx * ss, gy * ss).rgb * vSkin.rgb;
  vec2 cs = vec2(1.0 / 3.0, 0.5);
  float ct = floor(vCloth.w + 0.5);
  vec3 cl = textureGrad(uClothMap, (fract(vUv2) * 0.98 + 0.01 + vec2(mod(ct, 3.0), 1.0 - floor(ct / 3.0))) * cs, gx * cs, gy * cs).rgb * vCloth.rgb;
  float isCloth = step(0.5, vT.y) * step(vT.x, vMisc.x);
  // raw-colour parts switch crisply: interpolating towards white across a face read as a pale box
  float raw = step(0.5, vT.w);
  vec3 base = mix(mix(sk, cl, isCloth), vec3(1.0), raw);
  if (vT.z > 1.5) base = deadFace(vPos, base, vSkin.r * 13.7 + vSkin.w);
  // blood soaks cloth less and in fewer, cleaner patches (no camouflage blotching)
  float gl = vMisc.y * (1.0 - 0.3 * isCloth);
  float bl = smoothstep(1.0 - gl, 1.06 - gl, vGore) * (1.0 - raw);
  base = mix(base, vec3(0.12, 0.018, 0.012), bl * 0.88);
  diffuseColor.rgb *= base;
  // skin never reads as a black ball: a faint skin-tinted floor (fog still eats it at range)
  float skinM = (1.0 - isCloth) * (1.0 - raw);
  totalEmissiveRadiance += diffuseColor.rgb * vec3(0.12, 0.13, 0.105) * (0.25 + 0.75 * skinM);
}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  {
    // flashlight at arm's length: compress direct light so skin stays rotten, not white
    vec3 lim = diffuseColor.rgb * 0.5 + 0.004;
    reflectedLight.directDiffuse = lim * (vec3(1.0) - exp(-reflectedLight.directDiffuse / lim));
  }`);
  };
  mat.customProgramCacheKey = () => 'mrtvi-dead-7';

  // pose() writes every individual's part matrices into per-individual source arrays (A, LK);
  // pack() copies only the ones in the camera frustum and within VIEW_R into the front of the
  // instance buffers and sets mesh.count — off-screen dead cost no triangles.
  const meshes = {}, LK = {};
  const LOOK_ATTRS = ['aSkin', 'aClothA', 'aClothB', 'aMisc'];
  function mk(name, per) {
    const geo = parts[name];
    const n = cap * per;
    const im = new THREE.InstancedMesh(geo, mat, n);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.instanceMatrix.array.fill(0);
    LK[name] = {};
    for (const a of LOOK_ATTRS) {
      const ba = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
      ba.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(a, ba);
      LK[name][a] = new Float32Array(n * 4);
    }
    im.count = 0;
    im.frustumCulled = false;
    im.name = 'dead_' + name;
    im.userData.per = per;
    game.scene.add(im);
    meshes[name] = im;
    return new Float32Array(n * 16);
  }
  const A = {
    torso: mk('torso', 1), head: mk('head', 1), jaw: mk('jaw', 1),
    uarm: mk('uarm', 2), farm: mk('farm', 2), thigh: mk('thigh', 2), shin: mk('shin', 2),
  };
  const meshList = Object.values(meshes);
  const PARTS = Object.keys(meshes);
  const lookV = new Uint32Array(cap), slotOwner = new Int32Array(cap).fill(-1), slotV = new Uint32Array(cap);
  const visList = new Int32Array(cap);
  const _cfr = new THREE.Frustum(), _cpm = new THREE.Matrix4();
  let hookFrame = -10, packFrame = -1;
  const pstats = { visible: 0 };
  function pack(cam) {
    if (!cam || !cam.projectionMatrix) return;
    _cpm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _cfr.setFromProjectionMatrix(_cpm);
    const me = cam.matrixWorld.elements, cx = me[12], cy = me[13], cz = me[14];
    const pl = _cfr.planes;
    let n = 0;
    for (let i = 0; i < cap; i++) {
      if (state[i] === FREE) continue;
      const dx = x[i] - cx, dz = z[i] - cz;
      if (dx * dx + dz * dz > VIEW_R * VIEW_R) continue;
      // one bounding sphere per individual: feet + 0.9, generous enough for a lunge or a body on the ground
      const sy = y[i] + 0.9, r = 2.0 * scale[i];
      let inside = true;
      for (let k = 0; k < 6; k++) { const q = pl[k]; if (q.normal.x * x[i] + q.normal.y * sy + q.normal.z * z[i] + q.constant < -r) { inside = false; break; } }
      if (inside) visList[n++] = i;
    }
    pstats.visible = n;
    let lookDirty = false;
    for (let k = 0; k < n; k++) {
      const i = visList[k];
      if (slotOwner[k] !== i || slotV[k] !== lookV[i]) { slotOwner[k] = i; slotV[k] = lookV[i]; lookDirty = true; }
    }
    for (const name of PARTS) {
      const im = meshes[name], per = im.userData.per, src = A[name], dst = im.instanceMatrix.array;
      for (let k = 0; k < n; k++) { const i = visList[k]; dst.set(src.subarray(i * per * 16, (i + 1) * per * 16), k * per * 16); }
      im.count = n * per;
      const ia = im.instanceMatrix;
      ia.clearUpdateRanges?.(); ia.addUpdateRange?.(0, Math.max(16, n * per * 16)); ia.needsUpdate = true;
      if (lookDirty) {
        const g = im.geometry.attributes, L = LK[name];
        for (const a of LOOK_ATTRS) {
          const d = g[a].array, s = L[a];
          for (let k = 0; k < n; k++) { const i = visList[k]; d.set(s.subarray(i * per * 4, (i + 1) * per * 4), k * per * 4); }
          g[a].clearUpdateRanges?.(); g[a].addUpdateRange?.(0, Math.max(4, n * per * 4)); g[a].needsUpdate = true;
        }
      }
    }
  }
  // pack against whatever camera is rendering, right before the render list is built
  {
    const prev = game.scene.onBeforeRender;
    game.scene.onBeforeRender = function (renderer, scene, cam, rt) {
      if (typeof prev === 'function') prev.call(this, renderer, scene, cam, rt);
      hookFrame = frame;
      try { pack(cam); } catch (e) { if (!warned) { warned = true; console.error('[dead] pack', e); } }
    };
  }

  function setLook(i) {
    const R = rng(9001 + i * 7919 + gen[i] * 104729 + SEED * 31337);
    const skinTile = Math.floor(R() * 4);
    // grey-green, bloodless; the module skin is pale so pull it down and towards green
    const v = 0.42 + R() * 0.2;
    const skin = [v * (0.86 + R() * 0.1), v * (0.95 + R() * 0.08), v * (0.78 + R() * 0.1), skinTile];
    // clothes read as mid-grey cloth against the dark cobbles: absolute linear values (the atlas
    // tile's own mean is divided out), hues from a worn palette — khaki, faded blue, dirty white,
    // brown, olive, grey, faded red; trousers: denim, khaki, brown, grey
    const SH = [0, 1, 2, 4, 5, 1, 2, 5, 3], TR = [0, 1, 5, 0, 5];
    const ca = SH[Math.floor(R() * SH.length)], cb = TR[Math.floor(R() * TR.length)];
    const cm = (atlas.cloth.userData && atlas.cloth.userData.mean) || [];
    const HUE = [[1.18, 1.05, 0.72], [0.78, 0.92, 1.22], [1.08, 1.06, 0.98], [1.2, 0.95, 0.72], [0.95, 1.04, 0.78], [1, 1, 1], [1.12, 0.9, 0.84]];
    const HV = [0.17, 0.15, 0.21, 0.12, 0.13, 0.15, 0.12];       // dirty white is the light one
    const k = Math.floor(R() * HUE.length), hu = HUE[k];
    const va = HV[k] * (0.8 + R() * 0.4) / (cm[ca] || 0.07);
    const TRH = [[0.8, 0.92, 1.18], [1.15, 1.05, 0.75], [1.15, 0.95, 0.78], [1, 1, 1]];
    const kb = Math.floor(R() * TRH.length), hb = TRH[kb];
    const vb = (kb === 0 ? 0.11 : 0.12) * (0.8 + R() * 0.4) / (cm[cb] || 0.07);
    const clA = [va * hu[0], va * hu[1], va * hu[2], ca];
    const clB = [vb * hb[0] * (0.95 + R() * 0.1), vb * hb[1] * (0.95 + R() * 0.1), vb * hb[2] * (0.95 + R() * 0.1), cb];
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
    lookV[i]++;
    const set = (name, idx, thr) => {
      const g = LK[name];
      g.aSkin.set(skin, idx * 4); g.aClothA.set(clA, idx * 4); g.aClothB.set(clB, idx * 4);
      g.aMisc[idx * 4] = thr; g.aMisc[idx * 4 + 1] = gore;
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
    // the lunge never pushes the head through the player's face (stoop already leans ~0.35 m)
    const fwd = Math.min(0.4 * lg, Math.max(0, pdist[i] - 0.8) / s) - 0.08 * ak * (1 - lg);
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
        // never straight-legged: a sagging, bent-kneed stance (more when they lurch)
        const bend = (0.2 + 0.1 * wa + 0.08 * ex) * (1 - k1) * (1 - kneel);
        th -= bend * 0.55; kn += bend;
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
  // the castle plateau (+2 m: the gate mouth) is off-limits — the camp has to stay safe
  const inCastle = (px, pz) => px > CASTLE.x0 - 2 && px < CASTLE.x1 + 2 && pz > CASTLE.z0 - 2 && pz < CASTLE.z1 + 2;
  // reachable from START on the nav grid (BFS once)
  const reach = new Uint8Array(Math.max(1, grid.nx * grid.nz));
  let reachOk = false;
  if (grid.data) {
    const gd = grid.data, NX = grid.nx, NZ = grid.nz, q = new Int32Array(NX * NZ);
    let i0 = Math.floor((START.x - grid.x0) / grid.cell), j0 = Math.floor((START.z - grid.z0) / grid.cell);
    let c0 = j0 * NX + i0;
    if (!gd[c0]) for (let r = 1; r <= 3 && !gd[c0]; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const c = (j0 + dj) * NX + i0 + di; if (!gd[c0] && c >= 0 && c < gd.length && gd[c]) c0 = c; }
    if (gd[c0]) {
      let qh = 0, qt = 0; q[qt++] = c0; reach[c0] = 1;
      while (qh < qt) {
        const c = q[qh++], ci = c % NX, cj = (c - ci) / NX;
        for (let k = 0; k < 4; k++) {
          const ni = ci + (k === 0 ? 1 : k === 1 ? -1 : 0), nj = cj + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (ni < 0 || nj < 0 || ni >= NX || nj >= NZ) continue;
          const n = nj * NX + ni;
          if (gd[n] && !reach[n]) { reach[n] = 1; q[qt++] = n; }
        }
      }
      reachOk = qt > 100;
    }
  }
  const reachable = (px, pz) => {
    if (px > 1000 || !reachOk) return true;
    const i = Math.floor((px - grid.x0) / grid.cell), j = Math.floor((pz - grid.z0) / grid.cell);
    return i >= 0 && j >= 0 && i < grid.nx && j < grid.nz && reach[j * grid.nx + i] === 1;
  };
  // fair start: nothing at the pharmacy door, nothing hiding in the Karlova bend
  const KB = [104, 11, 85, 6];
  const segD = (px, pz, [ax, az, bx, bz]) => {
    const ux = bx - ax, uz = bz - az, t = clamp(((px - ax) * ux + (pz - az) * uz) / (ux * ux + uz * uz), 0, 1);
    return Math.hypot(px - ax - ux * t, pz - az - uz * t);
  };
  // the opening corridor (Celetná → across Old Town Square to Karlova) keeps a 12 m clear band
  const CORR = [[230, 10], [190, 4], [176, 0], [150, 0], [120, 2]];
  const inCorr = (px, pz) => {
    if (px < 105 || px > 245 || pz > 1000) return false;
    for (let k = 0; k + 1 < CORR.length; k++) if (segD(px, pz, [CORR[k][0], CORR[k][1], CORR[k + 1][0], CORR[k + 1][1]]) < 12) return true;
    return false;
  };
  const banned = (px, pz) => inCastle(px, pz) || Math.hypot(px - PHARMACY_DOOR.x, pz - PHARMACY_DOOR.z) < 8 || segD(px, pz, KB) < 6 || inCorr(px, pz) || !reachable(px, pz);
  const ppos = () => (game.player && game.player.pos) || { x: START.x, y: 0, z: START.z };
  function near(px, pz, r, tries = 12) {
    for (let k = 0; k < tries; k++) {
      const a = R() * Math.PI * 2, rr = k === 0 ? 0 : r * Math.sqrt(R());
      const qx = px + Math.cos(a) * rr, qz = pz + Math.sin(a) * rr;
      if (qx < BOUNDS.x0 + 2 && qx < 1000) continue;
      if (walk(qx, qz) && !banned(qx, qz)) return [qx, qz];
    }
    return null;
  }
  // walkers never spawn on the bridge deck: it belongs to the horde (and its clear lane)
  const onBridge = (px, pz) => px > RIVER.x0 - 8 && px < RIVER.x1 + 8 && Math.abs(pz - BRIDGE_HORDE.z) < 7;
  let spawnPts = ((game.world && game.world.spawns) || []).filter((p) => p && isFinite(p.x) && !banned(p.x, p.z) && !onBridge(p.x, p.z));
  if (spawnPts.length < 10) spawnPts = spawnPts.concat(ROUTE.map(([a, b]) => ({ x: a + 6, z: b })).filter((p) => !banned(p.x, p.z)));

  const free = [];
  for (let i = cap - 1; i >= 0; i--) free.push(i);
  const corpses = [];
  let alive = 0, killed = 0, pending = 0, stealthKills = 0;

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
    teachD[i] = 0; hunt[i] = 0;
    tok[i] = 0; aware[i] = 0; goal[i] = 0; gcool[i] = R() * 3; fellSnd[i] = 0; lastX[i] = px; lastZ[i] = pz; burst[i] = burstMax[i]; homeX[i] = px; homeZ[i] = pz;
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
    crawler[i] = 0; fallSign[i] = R() < 0.5 ? 1 : -1; deathT[i] = 1; fellSnd[i] = 1; state[i] = CORPSE;
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
    const teach = !P.has('trailer') && nWalk >= TEACH_N ? TEACH_N : 0;
    for (let k = 0; k < nWalk - teach && order.length; k++) {
      const p = order[k % order.length];
      const q = near(p.x, p.z, 2 + Math.floor(k / order.length) * 2.5);
      if (q && !onBridge(q[0], q[1])) spawn(q[0], q[1]);
    }
    // the bridge horde: 4 feeding clusters on the north half of the deck. The south lane
    // (z −2 … −4.5) stays clear the whole length so a runner always has a line through.
    const NCL = 4, CLX = [-36, -12, 12, 36], ZMIN = -1.3, ZMAX = 4.3;
    for (let k = 0; k < nHorde; k++) {
      const c = k % NCL, m = Math.floor(k / NCL);
      const cx = CLX[c], cz = BRIDGE_HORDE.z + 2.6;
      if (m === 0) spawnCorpse(cx, cz);
      const feed = m < 3 && !(m === 2 && c % 2);
      const a = (m / 6) * Math.PI * 2 + R() * 0.5, rr = feed ? 0.75 : 1.2 + R() * 1.6;
      let qx = cx + Math.cos(a) * rr * 1.6, qz = clamp(cz + Math.sin(a) * rr * 0.55, ZMIN, ZMAX);
      if (!walk(qx, qz)) { const q = near(qx, qz, 1.2); if (!q || q[1] < ZMIN) continue; [qx, qz] = q; }
      const hd = feed ? Math.atan2(cx - qx, cz - qz) : R() * Math.PI * 2;
      const id = spawn(qx, qz, { horde: true, state: IDLE, h: hd, sit: feed, crawler: m === 4 && c % 2 === 0 ? true : undefined });
      if (id >= 0) timer[id] = 4 + R() * 20;
    }
    // the opening: a lone walker in view ahead of the start, facing away; then on Celetná past
    // the pharmacy one standing with its back to the route (the stealth lesson) and one pacing
    // (the first threat). All slow, none fresh, none within 8 m of the pharmacy door.
    if (teach) {
      const W = -Math.PI / 2;     // heading west, away from a player coming down Celetná
      const T = [[240, 8, Math.atan2(240 - START.x, 8 - START.z), IDLE, 9], [205, 6, W, IDLE, 40], [185, 3, W + 0.4, WANDER, 6]];
      for (const [lx, lz, hd, st0, tm] of T) {
        if (Math.hypot(lx - PHARMACY_DOOR.x, lz - PHARMACY_DOOR.z) < 8) continue;
        const id = spawn(lx, lz, { state: st0, h: hd, crawler: false });
        if (id < 0) continue;
        fresh[id] = 0; timer[id] = tm; teachD[id] = 1;
        if (st0 === WANDER) { tx[id] = lx - 9; tz[id] = lz + 2; timer[id] = 25; }
      }
      // feeding over a body ~3 m off the route, back to a westbound courier: deaf to
      // footsteps, half-blind with their heads down — the ones a careful player can take quietly
      const FEED = [[133, -3], [77, -4], [-88, -3.5], [-150, -9], [-205, -14.5]];
      for (const [fx0, fz0] of FEED) {
        const q = walk(fx0, fz0) && !inCastle(fx0, fz0) ? [fx0, fz0] : near(fx0, fz0, 2);
        if (!q) continue;
        const cx = q[0] - 0.9, cz = q[1];
        if (walk(cx, cz)) spawnCorpse(cx, cz);
        const id = spawn(q[0], q[1], { state: IDLE, h: -Math.PI / 2 + (R() - 0.5) * 0.4, sit: true, crawler: false });
        if (id >= 0) { fresh[id] = 0; timer[id] = 30 + R() * 30; teachD[id] = 1; }
      }
    }
    for (let k = 0; k < nInt; k++) {
      const p = interiorSpawns[k];
      if (p && isFinite(p.x)) spawn(p.x, p.z, { state: IDLE });
    }
  }
  const target = alive;

  // ---------- flow field ----------
  const NXg = grid.nx, NZg = grid.nz;
  // fdist is the live field; a rebuild fills bdist a slice per frame (≤ 1.5 ms) and then swaps,
  // so a long move or a teleport never stalls a frame — the old field steers meanwhile
  let fdist = new Uint16Array(Math.max(1, NXg * NZg)), bdist = new Uint16Array(Math.max(1, NXg * NZg));
  const fq = new Int32Array(Math.max(1, NXg * NZg)), bq = new Int32Array(Math.max(1, NXg * NZg));
  const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
  const MAXD = 75, FIELD_MS = 1.5;
  let fieldOk = false, fieldCell = -1, fieldAge = 1, building = false, bqh = 0, bqt = 0;
  const fstats = { builds: 0, slices: 0, maxSliceMs: 0 };
  function startField(px, pz) {
    const gd = grid.data;
    if (!gd) { fieldOk = false; return false; }
    const i0 = Math.floor((px - grid.x0) / grid.cell), j0 = Math.floor((pz - grid.z0) / grid.cell);
    if (i0 < 1 || j0 < 1 || i0 >= NXg - 1 || j0 >= NZg - 1) { fieldOk = false; fieldCell = -1; building = false; return false; }
    let c0 = j0 * NXg + i0;
    if (!gd[c0]) {
      let found = -1;
      for (let r = 1; r <= 2 && found < 0; r++) for (let dj = -r; dj <= r && found < 0; dj++) for (let di = -r; di <= r; di++) {
        const c = c0 + dj * NXg + di; if (c >= 0 && c < gd.length && gd[c]) { found = c; break; }
      }
      if (found < 0) return false;          // keep the old field
      c0 = found;
    }
    bdist.fill(65535);
    bdist[c0] = 0; bqh = 0; bqt = 0; bq[bqt++] = c0;
    building = true;
    return true;
  }
  // advance the pending BFS; budget in ms (Infinity = finish now)
  function stepField(budget) {
    if (!building) return;
    const gd = grid.data, t0 = performance.now();
    fstats.slices++;
    while (bqh < bqt) {
      const stop = Math.min(bqt, bqh + 256);
      while (bqh < stop) {
        const c = bq[bqh++], dc = bdist[c];
        if (dc >= MAXD) continue;
        const ci = c % NXg, cj = (c - ci) / NXg;
        for (let k = 0; k < 8; k++) {
          const ni = ci + DI[k], nj = cj + DJ[k];
          if (ni < 0 || nj < 0 || ni >= NXg || nj >= NZg) continue;
          const n = nj * NXg + ni;
          if (!gd[n] || bdist[n] !== 65535) continue;
          if (k >= 4 && (!gd[c + DI[k]] || !gd[c + DJ[k] * NXg])) continue;
          bdist[n] = dc + 1; bq[bqt++] = n;
        }
      }
      if (bqh < bqt && performance.now() - t0 > budget) break;
    }
    fstats.maxSliceMs = Math.max(fstats.maxSliceMs, performance.now() - t0);
    if (bqh >= bqt) { const t = fdist; fdist = bdist; bdist = t; fieldOk = true; building = false; fstats.builds++; }
  }
  // static fields for the chime drift: east bank → Old Town Square; west bank → below St Nicholas
  // or onto Kampa (both off the route — Malá Strana square stays passable after the chime).
  // A point goal (no w/d) seeds the walkable cells nearest to it; P0.at gets the centre used.
  function staticField(P0) {
    const out = new Uint16Array(Math.max(1, NXg * NZg)).fill(65535);
    if (!grid.data) return out;
    let qh = 0, qt = 0;
    if (P0.w) {
      for (let j = 0; j < NZg; j++) for (let i = 0; i < NXg; i++) {
        const cx = grid.x0 + (i + 0.5) * grid.cell, cz = grid.z0 + (j + 0.5) * grid.cell;
        if (Math.abs(cx - P0.x) < P0.w * 0.3 && Math.abs(cz - P0.z) < P0.d * 0.3 && grid.data[j * NXg + i]) { out[j * NXg + i] = 0; fq[qt++] = j * NXg + i; }
      }
    } else {
      // nearest reachable walkable cell, then everything within 5 m of it
      let bd = Infinity, bx = P0.x, bz = P0.z;
      for (let j = 0; j < NZg; j++) for (let i = 0; i < NXg; i++) {
        const c = j * NXg + i; if (!grid.data[c] || (reachOk && !reach[c])) continue;
        const cx = grid.x0 + (i + 0.5) * grid.cell, cz = grid.z0 + (j + 0.5) * grid.cell, dd = (cx - P0.x) ** 2 + (cz - P0.z) ** 2;
        if (dd < bd) { bd = dd; bx = cx; bz = cz; }
      }
      P0.at = { x: bx, z: bz };
      for (let j = 0; j < NZg; j++) for (let i = 0; i < NXg; i++) {
        const c = j * NXg + i, cx = grid.x0 + (i + 0.5) * grid.cell, cz = grid.z0 + (j + 0.5) * grid.cell;
        if (grid.data[c] && (cx - bx) ** 2 + (cz - bz) ** 2 < 25 && !inCorr(cx, cz)) { out[c] = 0; fq[qt++] = c; }
      }
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
  const GN = { x: ST_NICHOLAS.x, z: ST_NICHOLAS.z }, GK = { x: KAMPA.x, z: KAMPA.z };
  const otsDist = staticField(OTS), snDist = staticField(GN), kpDist = staticField(GK);
  const goalField = (i) => (goal[i] === 2 ? snDist : goal[i] === 3 ? kpDist : otsDist);
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
  let quietKill = -9;
  const breather = () => now < breatherUntil;
  const isUp = (st) => st >= IDLE && st <= CHASE;
  game.on('noise', (e) => {
    if (!e || !isFinite(e.x) || inCastle(e.x, e.z)) return;
    let r = e.radius || 10;
    // the player's swing noise right after a stealth kill: the bar goes in quietly
    if (now - quietKill < 0.1) { quietKill = -9; if (r <= 12) r = 2; }
    const r2 = r * r;
    const clock = Math.abs(e.x - CLOCK.x) < 1 && Math.abs(e.z - CLOCK.z) < 1;
    for (let i = 0; i < cap; i++) {
      const st = state[i];
      if (!isUp(st) || st === CHASE) continue;
      if (clock && prio[i] >= 2) continue;
      const dx = x[i] - e.x, dz = z[i] - e.z, d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      if (d2 > r2 * 0.5 && ((i * 2654435761 + (now * 10 | 0)) >>> 0) % 2) continue;
      if (sitting[i] && r <= 20 && d2 > 16) continue;          // feeding: deaf to footsteps
      if (r <= 4 && d2 > 2.25) continue;                       // crouched steps: only right next to one
      if (breather() && x[i] > 195 && x[i] < 235 && r < 40) continue;
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
      if (west ? x[i] < CASTLE.x1 + 10 || Math.hypot(x[i] - GN.x, z[i] - GN.z) > 160 : Math.hypot(x[i] - OTS.x, z[i] - OTS.z) > 250) continue;
      // west: the nearer of St Nicholas / Kampa (Kampa only for those already near the river)
      const kampa = west && Math.hypot(x[i] - GK.x, z[i] - GK.z) < Math.hypot(x[i] - GN.x, z[i] - GN.z);
      state[i] = INVEST; prio[i] = 2; goal[i] = west ? (kampa ? 3 : 2) : 1; sitting[i] = 0;
      if (west) { const A0 = (kampa ? GK.at : GN.at) || (kampa ? GK : GN); tx[i] = A0.x + (R() - 0.5) * 6; tz[i] = A0.z + (R() - 0.5) * 6; }
      else { tx[i] = OTS.x + (R() - 0.5) * OTS.w * 0.7; tz[i] = OTS.z + (R() - 0.5) * OTS.d * 0.7; }
      timer[i] = 150; urg[i] = horde[i] ? 1.0 : 0.6;
    }
  });

  // ---------- AI helpers ----------
  const tmpPos = { x: 0, y: 0, z: 0 };
  const rayO = { x: 0, y: 0, z: 0 }, rayD = { x: 0, y: 0, z: 0 };
  function canSee(i, d, pl) {
    const player = game.player || {};
    if (player.alive === false || inCastle(pl.x, pl.z)) return false;
    const hr = game.time ? game.time.hour : 18;
    const night = hr > 20 || hr < 5;
    const light = !!player.flashlight;
    let range = night ? (light ? 38 : 12) : (light ? 33 : 30);
    const crouch = player.crouch || player.crouching || (player.noise > 0 && player.noise < 0.2);
    if (crouch) range = night && light ? range * 0.7 : Math.min(range, 6);
    if (sitting[i]) range = Math.min(range, 5);               // head down in a body
    if (d > range && d > 3) return false;
    const dx = pl.x - x[i], dz = pl.z - z[i];
    const inv = 1 / (d || 1);
    const cosA = (Math.sin(h[i]) * dx + Math.cos(h[i]) * dz) * inv;
    if (cosA < 0.35 && d > (crouch ? 0.9 : 3)) return false;
    // line of sight
    rayO.x = x[i]; rayO.y = y[i] + (crawler[i] ? 0.4 : 1.55); rayO.z = z[i];
    const ty2 = (pl.y || 0) + 1.4;
    const ddx = pl.x - rayO.x, ddy = ty2 - rayO.y, ddz = pl.z - rayO.z, L = Math.hypot(ddx, ddy, ddz) || 1;
    rayD.x = ddx / L; rayD.y = ddy / L; rayD.z = ddz / L;
    let hit = Infinity;
    try { hit = game.collide.raycast(rayO, rayD, L); } catch { hit = Infinity; }
    return hit >= L - 0.4;
  }

  // clear line between two points (walls, parapets, gate cheeks, interior walls)?
  const losO = { x: 0, y: 0, z: 0 }, losD = { x: 0, y: 0, z: 0 };
  function clear(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
    if (L < 0.05) return true;
    losO.x = ax; losO.y = ay; losO.z = az; losD.x = dx / L; losD.y = dy / L; losD.z = dz / L;
    let w = Infinity;
    try { w = game.collide.raycast(losO, losD, L); } catch { w = Infinity; }
    return !(w < L - 0.15);
  }
  function loseInterest(i) {
    hunt[i] = 0; state[i] = IDLE; prio[i] = 0; goal[i] = 0; aware[i] = 0; tok[i] = 0; atk[i] = -1; timer[i] = 6 + R() * 8;
  }

  function startChase(i) {
    if (state[i] !== CHASE) { state[i] = CHASE; groanAt(i, 1); }
    sitting[i] = 0;
    prio[i] = 3; lastSeen[i] = now;
  }

  // ---------- audio ----------
  // per-individual cooldown; hits and attack windups (force) always sound
  // attack tells always sound and are flagged so audio can make them distinct; every other
  // groan (ambient, noticing, pain) shares a global cap of 0.8/s
  let lastGroan = -9;
  function groanAt(i, intensity, force = false, tell = false) {
    if (!force && gcool[i] > 0) return;
    if (!tell && now - lastGroan < 0.6) return;
    gcool[i] = 1.2 + R() * 1.5;
    if (!tell) lastGroan = now;
    try { game.audio && game.audio.groan && (tell ? game.audio.groan(x[i], z[i], intensity, { tell: true }) : game.audio.groan(x[i], z[i], intensity)); } catch { /* audio is optional */ }
  }

  // ---------- death ----------
  function die(i, dx, dz) {
    if (!isUp(state[i])) return;
    state[i] = DYING; deathT[i] = 0; atk[i] = -1; hp[i] = 0; fellSnd[i] = 0;
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
    if (part === 'head') dmgv = Math.max(dmgv * 2, dmgv >= 55 ? 120 : 0);     // a pistol round to the head drops them
    let dx = dir ? dir.x || 0 : 0, dz = dir ? dir.z || 0 : 0;
    const L = Math.hypot(dx, dz);
    if (L > 1e-6) { dx /= L; dz /= L; } else { const pl = ppos(); dx = x[id] - pl.x; dz = z[id] - pl.z; const l2 = Math.hypot(dx, dz) || 1; dx /= l2; dz /= l2; }
    hp[id] -= dmgv;
    const kb = (1.4 + Math.min(3, dmgv / 25)) * (crawler[id] ? 0.3 : 1);
    vx[id] = dx * kb; vz[id] = dz * kb;
    // a committed lunge (past ~60% of the windup) is not stopped by a body blow: trading swings
    // with one that is already coming costs you; a head hit or a heavy one still drops it back
    const committed = atk[id] >= ATK_HIT * 0.6 && part !== 'head' && dmgv < 50 && hp[id] > 0;
    if (committed) { hitT[id] = Math.max(hitT[id], 0.3); vx[id] *= 0.3; vz[id] *= 0.3; }
    else if (part === 'head' || dmgv >= 50) { hitT[id] = 1; atk[id] = -1; cool[id] = Math.max(cool[id], 0.5); }
    else { hitT[id] = 0.6; atk[id] = -1; cool[id] = Math.max(cool[id], 0.3); vx[id] *= 0.6; vz[id] *= 0.6; }   // body blows: a shorter stagger
    if (hp[id] <= 0) { die(id, dx, dz); return true; }
    if (!game.player || game.player.alive !== false) startChase(id);
    groanAt(id, 0.8, true);
    return true;
  }

  // ---------- late climax ----------
  // once the medicine is carried past Malá Strana square (x < −160, or 150 s after the pickup once
  // the player has crossed Malá Strana square, x < −145) a pack comes up Nerudova behind them out of the square, and a
  // few come down from the gate: they know where the player is and never get bored.
  const RT = ROUTE.map(([a, b]) => ({ x: a, z: b })), RS = [0];
  for (let k = 1; k < RT.length; k++) RS.push(RS[k - 1] + Math.hypot(RT[k].x - RT[k - 1].x, RT[k].z - RT[k - 1].z));
  const gateK = RT.findIndex((p) => p.x === CASTLE_GATE.x && p.z === CASTLE_GATE.z);
  const S_GATE = gateK > 0 ? RS[gateK] : RS[RS.length - 1];
  function routeS(px, pz) {
    let bs = 0, bd = Infinity;
    for (let k = 0; k + 1 < RT.length; k++) {
      const a = RT[k], b = RT[k + 1], ux = b.x - a.x, uz = b.z - a.z, L2 = ux * ux + uz * uz || 1;
      const t = clamp(((px - a.x) * ux + (pz - a.z) * uz) / L2, 0, 1), d = Math.hypot(px - a.x - ux * t, pz - a.z - uz * t);
      if (d < bd) { bd = d; bs = RS[k] + t * Math.sqrt(L2); }
    }
    return bs;
  }
  function routeAt(sv) {
    sv = clamp(sv, 0, RS[RS.length - 1]);
    let k = 0; while (k + 2 < RS.length && RS[k + 1] < sv) k++;
    const a = RT[k], b = RT[k + 1], t = clamp((sv - RS[k]) / ((RS[k + 1] - RS[k]) || 1), 0, 1);
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }
  const CL = rng(5150 + SEED * 131);
  const tune = { mob: MAX_ATTACKERS_MOB, gateV: 0.8, packV: 2.9, climax: true };
  const CLIMAX_N = 10 + Math.floor(CL() * 5);
  let medT = -1, climaxT = -1;
  const cstats = { n: 0, behind: 0, ahead: 0, at: null };
  function climax(px, pz) {
    climaxT = now;
    const sp = routeS(px, pz);
    // out of the player's view cone (by yaw; the camera may not have caught up after a teleport)
    const yaw = +(game.player && game.player.yaw) || 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const inView = (qx, qz) => { const dx = qx - px, dz = qz - pz, l = Math.hypot(dx, dz) || 1; return (dx * fx + dz * fz) / l > 0.4; };
    const roomAhead = S_GATE - 5 - sp;
    const nAhead = roomAhead > 40 ? 2 + (CLIMAX_N > 12 ? 1 : 0) : 0;
    for (let k = 0; k < CLIMAX_N; k++) {
      const ahead = k < nAhead;
      let q = null;
      for (let tr = 0; tr < 10 && !q; tr++) {
        // ahead: a few just below the gate, the last push; behind: the pack out of the square
        const sv = ahead ? S_GATE - 8 - CL() * 10 - tr * 2 : sp - 14 - CL() * 14 - tr * 3;
        const c = routeAt(sv), a = CL() * Math.PI * 2, rr = 1 + CL() * 2.5;
        const qx = c.x + Math.cos(a) * rr, qz = c.z + Math.sin(a) * rr;
        if (!walk(qx, qz) || inCastle(qx, qz) || Math.hypot(qx - px, qz - pz) < (ahead ? 40 : 12)) continue;
        if (!ahead && tr < 7 && inView(qx, qz)) continue;
        q = [qx, qz];
      }
      if (!q) continue;
      const id = spawn(q[0], q[1], { state: IDLE, h: Math.atan2(px - q[0], pz - q[1]), crawler: false });
      if (id < 0) continue;
      hunt[id] = 1; startChase(id); tx[id] = px; tz[id] = pz; lastX[id] = px; lastZ[id] = pz;
      // the pack from the square runs to catch up, then shambles at a hard chase
      // the gate ones shamble down slowly, so they are met at the top of the hill
      if (ahead) { fresh[id] = 0; chaseV[id] = tune.gateV + CL() * 0.3; cstats.ahead++; }
      else { fresh[id] = 1; runV[id] = 3.3 + CL() * 0.3; burstMax[id] = burst[id] = 6 + CL() * 3; chaseV[id] = tune.packV + CL() * 0.3; cstats.behind++; }
      cstats.n++; (cstats.pts ||= []).push([Math.round(q[0]), Math.round(q[1])]);
    }
    cstats.at = { x: Math.round(px), z: Math.round(pz), t: +now.toFixed(1) };
  }

  // ---------- update ----------
  const _pm = new THREE.Matrix4(), _fr = new THREE.Frustum(), _sp = new THREE.Sphere();
  let frame = 0, respawnT = 20, warned = false, seeing = 0, lastWindup = -9;
  let victim = -1, victimT = -9, breatherUntil = -1, wasInside = false;
  const stats = { ms: 0, active: 0, posed: 0, chasing: 0, attackers: 0 };

  function update(dt) {
    try { step(Math.min(0.05, dt || 0)); } catch (e) { if (!warned) { warned = true; console.error('[dead]', e); } }
  }

  function step(dt) {
    const t0 = performance.now();
    now += dt; frame++;
    const player = game.player || {};
    const pl = ppos();
    const plAlive = player.alive !== false;
    const px = pl.x, pz = pl.z;
    for (let i = 0; i < cap; i++) if (tok[i] && state[i] !== CHASE) tok[i] = 0;
    const st8 = game.state || {};
    if (st8.hasMedicine && medT < 0) medT = now;
    if (medT >= 0 && climaxT < 0 && tune.climax && plAlive && !P.has('trailer') && px < 52 && px > BOUNDS.x0 && !inCastle(px, pz)
      && (px < -160 || (now - medT > 150 && px < -145))) climax(px, pz);

    // flow field ≤ 4 Hz, only when the player's cell changes; built in ≤ 1.5 ms slices
    fieldAge += dt;
    if (building) stepField(FIELD_MS);
    else if (fieldAge >= 0.25 && grid.data) {
      const ci = Math.floor((px - grid.x0) / grid.cell), cj = Math.floor((pz - grid.z0) / grid.cell);
      const cell = cj * NXg + ci;
      if (cell !== fieldCell) {
        fieldCell = cell; fieldAge = 0;
        if (startField(px, pz)) stepField(fstats.builds ? FIELD_MS : Infinity);   // the very first one at once
      }
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
    const maxAtk = chasing >= MOB_N ? tune.mob : MAX_ATTACKERS;
    while (nt < maxAtk && plAlive) {
      let bi = -1, bd = WAIT_R + 0.9;
      for (let a = 0; a < na; a++) { const i = active[a]; if (state[i] === CHASE && !tok[i] && pdist[i] < bd && hitT[i] <= 0) { bd = pdist[i]; bi = i; } }
      if (bi < 0) break;
      tok[bi] = 1; nt++;
    }
    stats.attackers = nt;

    // hit-stop: while the player's bar sticks in the body, the victim's pose and knockback hold
    const hsId = (+player.hitStop || 0) > 0 && now - victimT < 0.4 ? victim : -1;
    // the pharmacy exit: a 15 s breather on Celetná
    const inside = px > 1000;
    if (wasInside && !inside) breatherUntil = now + 15;
    wasInside = inside;
    let posed = 0;
    for (let i = 0; i < cap; i++) {
      const st = state[i];
      if (st === FREE || st === CORPSE || i === hsId) continue;
      if (st === DYING) {
        deathT[i] += dt / DEATH_T;
        if (!fellSnd[i] && deathT[i] >= 0.97) { fellSnd[i] = 1; try { game.audio?.bodyFall?.(x[i], z[i]); } catch { /* optional */ } }
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

    // groans: 0.4/s + 0.08/s per chaser, from a random nearby walker (a chaser when any are close)
    for (let a = 0; a < na; a++) gcool[active[a]] -= dt;
    if (na && R() < dt * (0.4 + 0.08 * chasing)) {
      let i = active[(R() * na) | 0];
      if (chasing) for (let k = 0; k < 6 && !(state[i] === CHASE && pdist[i] < 40); k++) i = active[(R() * na) | 0];
      if (pdist[i] < 40) groanAt(i, state[i] === CHASE ? 1 : 0.35);
    }
    // seeing: chasers with line of sight to the player
    let nsee = 0;
    for (let a = 0; a < na; a++) { const i = active[a]; if (state[i] === CHASE && seen[i]) nsee++; }
    seeing = nsee;

    // respawn kills to keep pressure: ≥ 60 m away, never in view, and
    // never while the player already has three or more on their heels
    respawnT -= dt;
    // at most one per 20 s, and none at all while the player is still on the east bank
    if (respawnT <= 0 && pending > 0 && alive < target && chasing < 3 && px <= 52) {
      const yaw = player.yaw || 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const cam = game.camera;
      if (cam && cam.projectionMatrix) { cam.updateMatrixWorld(); _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm); }
      for (let k = 0; k < 16; k++) {
        const p = spawnPts[(R() * spawnPts.length) | 0];
        if (!p) break;
        const q = near(p.x, p.z, 3);
        if (!q || onBridge(q[0], q[1])) continue;
        const dx = q[0] - px, dz = q[1] - pz, d = Math.hypot(dx, dz);
        if (d < 60 || d > 115) continue;
        if ((dx * fx + dz * fz) / d > 0) continue;                 // anywhere in front of the player
        if (cam && cam.projectionMatrix && x.length) {
          _sp.center.set(q[0], heightAt(q[0], q[1]) + 1, q[1]); _sp.radius = 1.5;
          if (_fr.intersectsSphere(_sp)) continue;
        }
        if (spawn(q[0], q[1]) >= 0) { pending--; respawnT = 20; break; }
      }
      if (respawnT <= 0) respawnT = 1;
    }

    // nobody rendered us lately (the scene hook was replaced?) → pack against the game camera
    if (frame - hookFrame > 2 && game.camera) pack(game.camera);
    stats.visible = pstats.visible;
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
      let ok = walk(nx, nz) && !(inCastle(nx, nz) && !inCastle(x[i], z[i]));
      if (ok) { try { ok = !game.collide.inside(nx, nz, 0.3, heightAt(nx, nz)); } catch { /* old collide */ } }
      if (ok) { x[i] = nx; z[i] = nz; h[i] = a; y[i] = heightAt(nx, nz); spd[i] = v; phase[i] += dtc * v * 6; return; }
    }
    state[i] = IDLE; timer[i] = 5; spd[i] = 0;
  }

  function wanderTarget(i) {
    const leash = (horde[i] || teachD[i]) && prio[i] === 0;
    const r = horde[i] ? 2.5 : teachD[i] ? 5 : 14;
    for (let k = 0; k < 4; k++) {
      const a = R() * Math.PI * 2, rr = (horde[i] ? 0.5 : 3) + R() * r;
      const bx = leash ? homeX[i] : x[i], bz = leash ? homeZ[i] : z[i];
      const qx = bx + Math.sin(a) * rr * (horde[i] ? 1.6 : 1), qz = bz + Math.cos(a) * rr * (horde[i] ? 0.5 : 1);
      if (horde[i] && prio[i] === 0 && qz < -1.3) continue;      // keep the bridge lane clear
      if (walk(qx, qz) && !inCastle(qx, qz)) { tx[i] = qx; tz[i] = qz; return true; }
    }
    return false;
  }

  function think(i, dt, d, px, pz, pl, plAlive, player) {
    let st = state[i];
    // perception at ~8 Hz, staggered
    if ((frame + i) % 8 === 0 && !api.debug.blind) {
      const calm = breather() && x[i] > 195 && x[i] < 235;     // Celetná breather after the pharmacy
      if (calm && st === CHASE) { loseInterest(i); st = IDLE; }
      const vis = plAlive && d < 45 && !calm && canSee(i, d, pl);
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
        lastSeen[i] = now; tx[i] = px; tz[i] = pz; lastX[i] = px; lastZ[i] = pz;
      }
      st = state[i];
      // a trailing chaser left well behind loses interest now and then (fresh ones bursting don't)
      // a chaser that has lost sight for 2 s beyond 12 m gets bored (fresh ones bursting don't);
      // a crouched player out of sight sheds them much faster
      const lost = !vis && now - lastSeen[i] > 2;
      const crouch = !!(player.crouch || player.crouching);
      const bored = st === CHASE && lost && d > (crouch ? 7 : 12) && !(fresh[i] && burst[i] > 0) && R() < (crouch ? 1.2 : 0.4) * pdt;
      if (st === CHASE && inCastle(px, pz)) { loseInterest(i); st = IDLE; }
      else if (st === CHASE && hunt[i]) { if (!plAlive) loseInterest(i); else { tx[i] = px; tz[i] = pz; } }
      else if (st === CHASE && (bored || (!vis && (now - lastSeen[i] > 6 || !plAlive || d > 45 || (d > 22 && now - lastSeen[i] > 2))))) {
        aware[i] = 0;
        // they go to where they last saw you, not to where you are now
        state[i] = st = INVEST; prio[i] = 1; timer[i] = 8 + d * 0.6; urg[i] = 0.9;
        tx[i] = lastX[i]; tz[i] = lastZ[i];
      }
    }
    if (st === CHASE && (seen[i] || hunt[i])) { tx[i] = px; tz[i] = pz; }

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
        if (prev < ATK_HIT && atk[i] >= ATK_HIT && plAlive && d < ATK_REACH && hitT[i] <= 0.3
          && clear(x[i], y[i] + 1.35 * scale[i], z[i], px, (pl.y || 0) + 1.2, pz)) {
          // player.damage → true when the hit landed (false: i-frames / hit cap); undefined = old player
          let landed = true;
          try { if (player.damage) landed = player.damage(15, { x: x[i], z: z[i] }) !== false; } catch { /* player owns its errors */ }
          if (landed) game.emit('playerHurt', { dmg: 15, from: { x: x[i], z: z[i] } });
          if (landed && api.debug.hurtLog) api.debug.hurtLog.push([fresh[i] && burst[i] > 0 ? 1 : 0, hunt[i], horde[i], +spd[i].toFixed(1), +(player.sprinting ? 1 : 0), stats.chasing, Math.round(now)]);
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
        // straight at the player only with a clear line; behind a barricade they path round it
        const direct = seen[i] && d < 14 || d < 1.5;
        desired = Math.atan2(tx[i] - x[i], tz[i] - z[i]);
        if (!direct) { const f = flowDir(x[i], z[i]); if (f === f) desired = f; }
        let base = chaseV[i], lurch = 0.86 + 0.44 * Math.max(0, Math.sin(phase[i]));   // mean ≈ 1, peak < walking pace
        if (fresh[i] && burst[i] > 0) { burst[i] -= dt; base = runV[i]; lurch = 0.93 + 0.22 * Math.max(0, Math.sin(phase[i])); }
        want = base * lurch;
        // no two windups within 0.25 s: the tells never stack into one double snarl
        if (d < ATK_RANGE + (crawl ? 0.2 : 0) && plAlive && tok[i] && cool[i] <= 0 && hitT[i] <= 0 && now - lastWindup >= 0.25
          && clear(x[i], y[i] + 1.35 * scale[i], z[i], px, (pl.y || 0) + 1.2, pz)) {
          groanAt(i, 1, true, true);                        // ~0.5 s audible tell, even from behind
          lastWindup = now;
          atk[i] = 0; cool[i] = 1.2 + R() * 0.7; want = 0; if (!(fresh[i] && burst[i] > 0)) spd[i] = Math.min(spd[i], 1.4);   // plants its feet: the tell (a running fresh one grabs on the move)
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
    // stride matches the leg swing so planted feet don't skate: step ≈ 2·leg·sin(amp)
    const wa = Math.min(1, v / 0.55), amp = wa * (0.3 + 0.25 * excite[i]);
    const stepLen = crawl ? 0.42 : clamp(1.62 * scale[i] * Math.sin(amp) * 1.08, 0.22, 1.1);
    phase[i] += dt * (v / stepLen) * Math.PI * (crawl ? 0.8 : 1);

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
    if (nx < 1000 && inCastle(nx, nz) && !inCastle(ox, oz)) {
      // the dead stop at the castle gate and lose interest
      nx = ox; nz = oz;
      if (state[i] !== IDLE) loseInterest(i);
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
        const e2 = ex * ex + ey * ey + ez * ez, d2 = e2 - tc * tc;
        if (d2 > r * r) continue;
        let th = tc - Math.sqrt(r * r - d2);
        if (th < 0) th = e2 < r * r ? 0 : tc;              // muzzle already inside the part counts
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
    rayO.x = o.x; rayO.y = o.y; rayO.z = o.z; rayD.x = dx; rayD.y = dy; rayD.z = dz;
    let wall = Infinity;
    try { wall = game.collide.raycast(rayO, rayD, best); } catch { wall = Infinity; }
    if (wall < best - 0.05) return null;
    lastRay = { id: bi, part: bp, t: now };
    return { dist: best, id: bi, part: bp, point: { x: o.x + dx * best, y: o.y + dy * best, z: o.z + dz * best } };
  }

  // the one a swing from o along (fx, fz) would strike: nearest torso in a ~57° cone, no walls
  function pickMelee(o, fx, fz, range) {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < cap; i++) {
      if (!isUp(state[i])) continue;
      const k = i * 12 + 3;
      const vx2 = C[k] - o.x, vz2 = C[k + 2] - o.z;
      const hd = Math.hypot(vx2, vz2);
      if (hd > range + 0.35) continue;
      if (hd > 0.45 && (vx2 * fx + vz2 * fz) / hd < 0.55) continue;
      if (hd >= bd) continue;
      if (!clear(o.x, o.y, o.z, C[k], C[k + 1], C[k + 2])) continue;       // no hits through walls
      bd = hd; bi = i;
    }
    return bi;
  }
  // stealth: unaware (not chasing, not yet noticed — investigating counts) and struck from behind
  function stealthy(i, ox, oz) {
    if (!isUp(state[i]) || state[i] === CHASE || aware[i] >= 1 || hunt[i]) return false;
    const bx = ox - x[i], bz = oz - z[i], bl = Math.hypot(bx, bz) || 1;
    return -(Math.sin(h[i]) * bx + Math.cos(h[i]) * bz) / bl >= BEHIND_DOT;
  }
  const _so = { x: 0, y: 0, z: 0 };
  // for the HUD prompt: the dead the player is aiming at, within crowbar reach, that would drop
  function stealthTarget(range = 1.8) {
    const p = game.player;
    if (!p || !p.pos || p.alive === false) return null;
    const yaw = +p.yaw || 0;
    _so.x = p.pos.x; _so.y = p.pos.y + 1.6; _so.z = p.pos.z;
    const bi = pickMelee(_so, -Math.sin(yaw), -Math.cos(yaw), range);
    return bi >= 0 && stealthy(bi, _so.x, _so.z) ? bi : null;
  }

  function meleeHit(o, dir, range = 1.8, dmg = 34) {
    const dl = Math.hypot(dir.x, dir.z) || 1, fx = dir.x / dl, fz = dir.z / dl;
    const L3 = Math.hypot(dir.x, dir.y || 0, dir.z) || 1, dx = dir.x / L3, dy = (dir.y || 0) / L3, dz = dir.z / L3;
    const bi = pickMelee(o, fx, fz, range);
    if (bi < 0) return null;
    // head if the swing line passes close to the skull
    const k = bi * 12;
    const ex = C[k] - o.x, ey = C[k + 1] - o.y, ez = C[k + 2] - o.z;
    const tc = ex * dx + ey * dy + ez * dz;
    const miss = ex * ex + ey * ey + ez * ez - tc * tc;
    // stealth: an unaware one struck from behind (within 100° of its back) drops in one blow,
    // and killing an unaware one barely makes a sound
    const unaware = state[bi] !== CHASE && aware[bi] < 1;
    const sk = stealthy(bi, o.x, o.z);
    if (api.debug.meleeLog) { const bx = o.x - x[bi], bz = o.z - z[bi], bl = Math.hypot(bx, bz) || 1; api.debug.meleeLog.push([state[bi], +aware[bi].toFixed(2), +(-(Math.sin(h[bi]) * bx + Math.cos(h[bi]) * bz) / bl).toFixed(2), sk ? 1 : 0, sitting[bi]]); }
    victim = bi; victimT = now;
    const part = tc > 0 && miss < 0.22 * 0.22 ? 'head' : 'body';
    const ok = damage(bi, sk ? Math.max(dmg, 1000) : dmg, { x: fx, z: fz }, part);
    if (unaware && !isUp(state[bi])) quietKill = now;
    if (ok && sk) stealthKills++;
    // like raycast: { id, part } on a hit (truthy), null on a miss
    return ok ? { id: bi, part, stealth: sk } : null;
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
    update, raycast, meleeHit, nearest, stealthTarget,
    get stealthKills() { return stealthKills; },
    population: (() => {
      const o = { street: 0, horde: 0, interior: 0, total: 0, corpses: corpses.length };
      for (let i = 0; i < cap; i++) if (isUp(state[i])) { if (horde[i]) o.horde++; else if (x[i] > 1000) o.interior++; else o.street++; o.total++; }
      return o;
    })(),
    damage: (id, dmg, dir, part) => damage(id, dmg, dir, part),
    get count() { return alive + corpses.length; },
    get alive() { return alive; },
    get killed() { return killed; },
    get seeing() { return seeing; },
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
      field: () => ({ ok: fieldOk, building, ...fstats }),
      climax: () => ({ ...cstats, N: CLIMAX_N, hunting: (() => { let n = 0; for (let i = 0; i < cap; i++) if (hunt[i] && state[i] === CHASE) n++; return n; })() }),
      tune,
      triggerClimax: () => { const p = ppos(); climax(p.x, p.z); },
      gather: () => ({ stNicholas: GN.at, kampa: GK.at }),
      centres: (i) => Array.from(C.subarray(i * 12, i * 12 + 12), (v) => +v.toFixed(2)),
      get pending() { return pending; }, get target() { return target; }, get respawnT() { return respawnT; },
      atlas,
      cap,
    },
  };
  return api;
}
