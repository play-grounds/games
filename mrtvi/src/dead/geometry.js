// Procedural body parts for the dead. Every part shares one attribute layout so one
// material draws them all:
//   position, normal, aUv, color (linear multiplier: AO, bruising, raw colours),
//   aT = (t along limb 0..1, mask 0 skin | 1 cloth | 2 raw colour, which 0 shirt | 1 trousers),
//   aGore = blood field 0..1 (instance gore level decides how much of it shows).
// Parts hang down −Y from their joint (limbs) or rise +Y from it (torso, head). Front is +Z.
import * as THREE from 'three';
import { rng } from '../layout.js';

export const SKEL = {
  hip: 0.925,              // pelvis height (thigh + shin + foot)
  hipX: 0.09,
  thigh: 0.44,
  shin: 0.42,
  shoulder: [0.175, 0.49, 0.035],
  neck: [0, 0.62, 0.075],
  jaw: [0, 0.062, 0.012],
  uarm: 0.28,
  farm: 0.25,
  head: [0, 0.1, 0.025],   // skull centre relative to the neck pivot
};

function noise3(seed) {
  const R = rng(seed);
  const P = new Uint8Array(512), V = new Float32Array(256);
  for (let i = 0; i < 256; i++) { P[i] = i; V[i] = R(); }
  for (let i = 255; i > 0; i--) { const j = (R() * (i + 1)) | 0; const t = P[i]; P[i] = P[j]; P[j] = t; }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const h = (x, y, z) => V[P[P[P[x & 255] + (y & 255)] + (z & 255)]];
  const s = (t) => t * t * (3 - 2 * t);
  const L = (a, b, t) => a + (b - a) * t;
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const u = s(x - xi), v = s(y - yi), w = s(z - zi);
    return L(
      L(L(h(xi, yi, zi), h(xi + 1, yi, zi), u), L(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
      L(L(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), L(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w);
  };
}
const N = noise3(77), N2 = noise3(91);
const goreField = (x, y, z) => 0.6 * N(x * 16, y * 16, z * 16) + 0.4 * N2(x * 5, y * 5, z * 5);

// Raw: { pos:[], uv:[], idx:[] }. Paint fills colour / aT / aGore per vertex.
function raw() { return { pos: [], uv: [], idx: [] }; }

// Rings: { y, rx, zf, zb?, ox?, oz? }. Seam at the back.
function tube(rings, segs, { uRep = 1, vScale = 1 / 0.6, capTop = true, capBot = true, bulge = 0.4 } = {}) {
  const g = raw();
  for (const r of rings) {
    for (let k = 0; k <= segs; k++) {
      const a = Math.PI + (k / segs) * Math.PI * 2;
      const s = Math.sin(a), c = Math.cos(a);
      const rz = c >= 0 ? r.zf : (r.zb ?? r.zf);
      g.pos.push((r.ox || 0) + r.rx * s, r.y, (r.oz || 0) + rz * c);
      g.uv.push((k / segs) * uRep, r.y * vScale);
    }
  }
  const W = segs + 1;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < segs; k++) {
      const a = i * W + k, b = a + W;
      g.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  // orient outward: test one triangle against the radial direction
  orient(g, 0, g.idx.length, (cx, cy, cz) => [cx - (rings[0].ox || 0), 0, cz - (rings[0].oz || 0)]);
  const cap = (ri, up) => {
    const r = rings[ri];
    const nb = rings[ri + (ri === 0 ? 1 : -1)];
    const dir = Math.sign(r.y - nb.y) || (up ? 1 : -1);
    const c = g.pos.length / 3;
    g.pos.push(r.ox || 0, r.y + dir * Math.min(r.rx, r.zf) * bulge, r.oz || 0);
    g.uv.push(0.5, r.y * vScale);
    const start = g.idx.length;
    for (let k = 0; k < segs; k++) g.idx.push(c, ri * W + k, ri * W + k + 1);
    orient(g, start, g.idx.length, () => [0, dir, 0]);
  };
  if (capTop) cap(0, true);
  if (capBot) cap(rings.length - 1, false);
  g.seams = { W, rings: rings.length, segs };
  return g;
}

function orient(g, i0, i1, want) {
  const P = g.pos, I = g.idx;
  // pick the triangle with the largest area in the range to decide
  let best = 0, flip = false;
  for (let t = i0; t < i1; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const ar = nx * nx + ny * ny + nz * nz;
    if (ar > best) {
      best = ar;
      const w = want((P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3);
      flip = nx * w[0] + ny * w[1] + nz * w[2] < 0;
    }
  }
  if (flip) for (let t = i0; t < i1; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; }
}

function fromThree(geo) {
  const g = raw();
  g.pos = Array.from(geo.attributes.position.array);
  g.uv = Array.from(geo.attributes.uv.array);
  g.idx = Array.from(geo.index.array);
  return g;
}

function merge(...gs) {
  const out = raw();
  for (const g of gs) {
    const off = out.pos.length / 3;
    out.pos.push(...g.pos); out.uv.push(...g.uv);
    for (const i of g.idx) out.idx.push(i + off);
  }
  return out;
}

// paint(x,y,z) → { c:[r,g,b], t, m, w, gore }
function build(g, paint, seamFix = []) {
  const n = g.pos.length / 3;
  const col = new Float32Array(n * 3), aT = new Float32Array(n * 4), gore = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = g.pos[i * 3], y = g.pos[i * 3 + 1], z = g.pos[i * 3 + 2];
    const p = paint(x, y, z);
    col.set(p.c || [1, 1, 1], i * 3);
    const m = p.m ?? 0;
    aT[i * 4] = p.t ?? 0; aT[i * 4 + 1] = m === 1 ? 1 : 0; aT[i * 4 + 2] = p.w ?? 0; aT[i * 4 + 3] = m === 2 ? 1 : 0;
    gore[i] = Math.max(0, Math.min(1, (p.gore ?? 0) + goreField(x, y, z) * 0.85));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
  geo.setAttribute('aUv', new THREE.Float32BufferAttribute(g.uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aT', new THREE.BufferAttribute(aT, 4));
  geo.setAttribute('aGore', new THREE.BufferAttribute(gore, 1));
  geo.setIndex(g.idx);
  geo.computeVertexNormals();
  // weld normals across the uv seams of tubes
  const nrm = geo.attributes.normal.array;
  for (const s of seamFix) {
    for (let r = 0; r < s.rings; r++) {
      const a = (s.base + r * s.W) * 3, b = (s.base + r * s.W + s.segs) * 3;
      for (let k = 0; k < 3; k++) { const v = (nrm[a + k] + nrm[b + k]) / 2; nrm[a + k] = nrm[b + k] = v; }
    }
  }
  geo.computeBoundingSphere();
  return geo;
}
const seam = (g, base = 0) => ({ base, W: g.seams.W, rings: g.seams.rings, segs: g.seams.segs });

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const WHITE = [1, 1, 1];
const DARK = [0.025, 0.018, 0.015];
const WOUND = [0.06, 0.014, 0.012];
const TEETH = [0.36, 0.31, 0.2];
const SHOE = [0.035, 0.03, 0.028];

function torso() {
  const R = [
    { y: 0.0, rx: 0.155, zf: 0.095, zb: 0.105, oz: 0 },
    { y: 0.085, rx: 0.165, zf: 0.1, zb: 0.112, oz: 0 },
    { y: 0.145, rx: 0.152, zf: 0.096, zb: 0.098, oz: 0.004 },
    { y: 0.2, rx: 0.144, zf: 0.094, zb: 0.09, oz: 0.01 },
    { y: 0.29, rx: 0.152, zf: 0.104, zb: 0.094, oz: 0.016 },
    { y: 0.37, rx: 0.168, zf: 0.108, zb: 0.11, oz: 0.02 },
    { y: 0.45, rx: 0.184, zf: 0.1, zb: 0.132, oz: 0.028 },
    { y: 0.51, rx: 0.19, zf: 0.082, zb: 0.122, oz: 0.042 },
    { y: 0.548, rx: 0.13, zf: 0.06, zb: 0.09, oz: 0.055 },
    { y: 0.575, rx: 0.056, zf: 0.05, zb: 0.052, oz: 0.066 },
    { y: 0.635, rx: 0.046, zf: 0.044, zb: 0.046, oz: 0.076 },
  ];
  const g = tube(R, 14);
  return build(g, (x, y, z) => {
    if (y > 0.556) return { c: [0.8, 0.8, 0.8], m: 0, gore: z > 0.07 ? 0.2 : 0 };          // neck
    // V-neck / collar opening
    if (y > 0.47 && z > 0.06 && Math.abs(x) < 0.07 - (0.55 - y) * 0.6) return { c: [0.85, 0.82, 0.8], m: 0, gore: 0.15 };
    // torn shirt, exposed wound on the left flank
    const tear = x < -0.03 && z > 0.02 && y > 0.2 && y < 0.37 && N(x * 30, y * 30, z * 30) > 0.42;
    if (tear) return { c: [0.75, 0.42, 0.38], m: 0, gore: 0.45 };
    if (y < 0.16) {
      const belt = y > 0.125;
      return { c: belt ? [0.35, 0.33, 0.32] : [0.9, 0.9, 0.9], m: 1, w: 1, gore: -0.1 };
    }
    const ao = (Math.abs(x) > 0.15 && y > 0.4 && y < 0.5) ? 0.65 : 1;              // armpits
    return { c: [ao, ao, ao], m: 1, w: 0, gore: z > 0.05 ? 0.12 : -0.05 };
  }, [seam(g)]);
}

function head() {
  const s = new THREE.SphereGeometry(1, 16, 13);
  const g = fromThree(s);
  const [cx, cy, cz] = SKEL.head;
  const eyes = [[-0.36, 0.14, 0.92], [0.36, 0.14, 0.92]].map((v) => { const l = Math.hypot(...v); return v.map((c) => c / l); });
  const nose = [0, -0.1, 1];
  const info = [];
  for (let i = 0; i < g.pos.length; i += 3) {
    let ux = g.pos[i], uy = g.pos[i + 1], uz = g.pos[i + 2];
    let rx = 0.079, ry = 0.102, rz = 0.094, k = 1;
    if (uz < -0.3 && uy > -0.3) rz *= 1.06;                                // occiput
    if (uy < -0.2 && uz > 0) rx *= 1 - 0.28 * sm(-0.2, -0.8, uy) * uz;     // narrow maxilla
    if (Math.abs(ux) > 0.45 && uy < 0.05 && uy > -0.6 && uz > 0.15) k *= 0.93; // hollow cheeks
    if (uy > 0.28 && uy < 0.45 && uz > 0.75) k *= 1.04;                    // brow ridge
    let socket = 0;
    for (const e of eyes) {
      const w = Math.hypot(ux - e[0], uy - e[1], uz - e[2]);
      if (w < 0.33) socket = Math.max(socket, 1 - w / 0.33);
    }
    k *= 1 - 0.16 * socket;
    const wn = Math.hypot(ux - nose[0], uy - nose[1], uz - nose[2]);
    const nasal = wn < 0.17 ? 1 - wn / 0.17 : 0;
    k *= 1 - 0.08 * nasal;
    if (uy < -0.28 && uz > 0.55) k *= 0.97;                                 // receding lips
    g.pos[i] = cx + ux * rx * k; g.pos[i + 1] = cy + uy * ry * k; g.pos[i + 2] = cz + uz * rz * k;
    info.push({ ux, uy, uz, socket, nasal });
  }
  // eyes, nose, mouth and hair are drawn in the fragment shader (aT.z = 2 marks the head)
  return build(g, () => ({ c: WHITE, m: 0, w: 2, gore: 0 }));
}

function jaw() {
  const g = fromThree(new THREE.BoxGeometry(0.1, 0.034, 0.1, 3, 1, 3));
  for (let i = 0; i < g.pos.length; i += 3) {
    let x = g.pos[i], y = g.pos[i + 1], z = g.pos[i + 2];
    const f = (z + 0.05) / 0.1;                    // 0 hinge … 1 chin
    x *= 1 - 0.38 * f;
    y += -0.012 - 0.02 * f;                        // slopes down to the chin
    if (f > 0.9 && y < -0.02) z -= 0.008;          // rounded chin
    g.pos[i] = x; g.pos[i + 1] = y; g.pos[i + 2] = z + 0.052;
  }
  return build(g, (x, y, z) => {
    if (y > -0.016 && z > 0.06) return { c: Math.sin(x * 160) > -0.4 ? TEETH : DARK, m: 2, gore: -1 };
    if (y > -0.016) return { c: WOUND, m: 2, gore: -1 };
    return { c: WHITE, m: 0, gore: 0.45 };
  });
}

function upperArm() {
  const L = SKEL.uarm;
  const g = tube([
    { y: 0.02, rx: 0.046, zf: 0.046 },
    { y: -0.04, rx: 0.05, zf: 0.047 },
    { y: -0.14, rx: 0.042, zf: 0.04 },
    { y: -0.25, rx: 0.036, zf: 0.035 },
    { y: -L, rx: 0.034, zf: 0.033 },
  ], 9, { bulge: 0.8 });
  return build(g, (x, y) => ({ c: WHITE, t: 0.5 * Math.min(1, -y / L), m: 1, w: 0, gore: -0.05 }), [seam(g)]);
}

function foreArm() {
  const L = SKEL.farm;
  const arm = tube([
    { y: 0.01, rx: 0.035, zf: 0.034 },
    { y: -0.06, rx: 0.037, zf: 0.033 },
    { y: -0.2, rx: 0.027, zf: 0.024 },
    { y: -L, rx: 0.024, zf: 0.02 },
  ], 9, { capTop: true, capBot: false });
  const hand = tube([
    { y: -L + 0.005, rx: 0.026, zf: 0.02 },
    { y: -L - 0.02, rx: 0.042, zf: 0.017, oz: 0.004 },
    { y: -L - 0.065, rx: 0.044, zf: 0.016, oz: 0.014 },
    { y: -L - 0.1, rx: 0.034, zf: 0.013, oz: 0.034 },
  ], 8, { capTop: false });
  const nA = arm.pos.length / 3;
  const all = merge(arm, hand);
  return build(all, (x, y) => {
    if (y < -L - 0.003) {
      const nail = y < -L - 0.085;
      return { c: nail ? [0.42, 0.35, 0.32] : [0.85, 0.82, 0.8], t: 1, m: 0, gore: 0.12 };
    }
    return { c: WHITE, t: 0.5 + 0.45 * Math.min(1, -y / L), m: 1, w: 0, gore: 0.05 };
  }, [seam(arm), seam(hand, nA)]);
}

function thigh() {
  const L = SKEL.thigh;
  const g = tube([
    { y: 0.04, rx: 0.08, zf: 0.08 },
    { y: -0.05, rx: 0.088, zf: 0.09 },
    { y: -0.25, rx: 0.07, zf: 0.072 },
    { y: -0.41, rx: 0.056, zf: 0.06 },
    { y: -L, rx: 0.053, zf: 0.056 },
  ], 9, { bulge: 0.5 });
  return build(g, (x, y) => ({ c: WHITE, t: 0.5 * Math.min(1, -y / L), m: 1, w: 1, gore: -0.1 }), [seam(g)]);
}

function shin() {
  const L = SKEL.shin;
  const leg = tube([
    { y: 0.02, rx: 0.052, zf: 0.055 },
    { y: -0.1, rx: 0.055, zf: 0.054, zb: 0.066 },
    { y: -0.33, rx: 0.038, zf: 0.04 },
    { y: -L, rx: 0.034, zf: 0.036 },
  ], 9, { capBot: false });
  const foot = fromThree(new THREE.BoxGeometry(0.095, 0.07, 0.25, 1, 1, 2));
  for (let i = 0; i < foot.pos.length; i += 3) {
    const z = foot.pos[i + 2], y = foot.pos[i + 1];
    if (z > 0.05 && y > 0) foot.pos[i + 1] -= 0.03;      // toe slopes down
    foot.pos[i] *= z < -0.1 ? 0.85 : 1;
    foot.pos[i + 1] += -L - 0.03;
    foot.pos[i + 2] += 0.055;
  }
  const all = merge(leg, foot);
  const nL = leg.pos.length / 3;
  let vi = 0;
  return build(all, (x, y) => {
    const i = vi++;
    if (i >= nL) return { c: y < -L - 0.06 ? [0.015, 0.013, 0.012] : SHOE, t: 1, m: 2, gore: -1 };
    return { c: WHITE, t: 0.5 + 0.45 * Math.min(1, -y / L), m: 1, w: 1, gore: y < -0.3 ? 0.1 : -0.1 };
  }, [seam(leg)]);
}

export function buildParts() {
  return { torso: torso(), head: head(), jaw: jaw(), uarm: upperArm(), farm: foreArm(), thigh: thigh(), shin: shin() };
}
