// Geometry batching for the city: every static surface is emitted straight into
// per-material vertex arrays (world space, world-scaled UVs, vertex tints), then
// turned into one Mesh per material. Frames use collide.js's rotation convention:
// local (u, y, v) → world (ox + u·c + v·s, oy + y, oz − u·s + v·c), c = cos rot, s = sin rot.

export function frame(ox, oy, oz, rot = 0) {
  return { ox, oy, oz, rot, c: Math.cos(rot), s: Math.sin(rot) };
}
// A child frame offset by (du, dy, dv) in F's local axes and rotated by drot.
export function sub(F, du, dy, dv, drot = 0) {
  return frame(F.ox + du * F.c + dv * F.s, F.oy + dy, F.oz - du * F.s + dv * F.c, F.rot + drot);
}
export function P(F, u, y, v) {
  return [F.ox + u * F.c + v * F.s, F.oy + y, F.oz - u * F.s + v * F.c];
}

export class Batches {
  // chunked: split each material into x-bands (Celetná / OTS / Karlova / river / Malá Strana /
  // Nerudova / castle) so frustum culling can skip the parts of the city behind the camera.
  constructor(chunked = false) { this.map = new Map(); this.chunked = chunked; }
  get(key) {
    let b = this.map.get(key);
    if (!b) this.map.set(key, (b = { p: [], n: [], uv: [], c: [], tris: 0 }));
    return b;
  }

  // Raw polygon (convex, CCW seen from the front), flat normal.
  poly(key, pts, uvs, col = WHITE) {
    const b = this.get(this.chunked ? key + '#' + chunkOf(pts[0][0]) : key);
    const [a, bb, c] = pts;
    let nx = (bb[1] - a[1]) * (c[2] - a[2]) - (bb[2] - a[2]) * (c[1] - a[1]);
    let ny = (bb[2] - a[2]) * (c[0] - a[0]) - (bb[0] - a[0]) * (c[2] - a[2]);
    let nz = (bb[0] - a[0]) * (c[1] - a[1]) - (bb[1] - a[1]) * (c[0] - a[0]);
    const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    for (let i = 1; i < pts.length - 1; i++) {
      for (const k of [0, i, i + 1]) {
        b.p.push(pts[k][0], pts[k][1], pts[k][2]);
        b.n.push(nx, ny, nz);
        b.uv.push(uvs[k][0], uvs[k][1]);
        b.c.push(col[0], col[1], col[2]);
      }
      b.tris++;
    }
  }
  // Polygon oriented so its normal faces `dir` (reversed if needed).
  polyF(key, pts, dir, uvs, col = WHITE) {
    const [a, b, c] = pts;
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const u = uvs || pts.map((p, i) => [i & 1, i >> 1]);
    if (nx * dir[0] + ny * dir[1] + nz * dir[2] < 0) this.poly(key, pts.slice().reverse(), u.slice().reverse(), col);
    else this.poly(key, pts, u, col);
  }
  quad(key, p0, p1, p2, p3, uv, col) {
    this.poly(key, [p0, p1, p2, p3], uv || UNIT, col);
  }

  // Box in frame F spanning u0..u1, y0..y1, v0..v1. opt: { mw, mh, col, fit, skip: 'front,bottom', uoff }
  box(key, F, u0, u1, y0, y1, v0, v1, opt = {}) {
    const mw = opt.mw || 1, mh = opt.mh || 1, col = opt.col || WHITE;
    const skip = opt.skip || 'bottom';
    const W = u1 - u0, D = v1 - v0, H = y1 - y0;
    const yb = opt.ybase ?? y0;
    const fu = (len) => (opt.fit ? Math.max(1, Math.round(len / mw)) / len : 1 / mw);
    const vy = (y) => (y - yb) / mh;
    const face = (name, a, b, len) => {
      if (skip.includes(name)) return;
      const k = fu(len), o = opt.uoff || 0;
      this.quad(key, P(F, ...a[0]), P(F, ...a[1]), P(F, ...b[1]), P(F, ...b[0]),
        [[o, vy(y0)], [o + len * k, vy(y0)], [o + len * k, vy(y1)], [o, vy(y1)]], col);
    };
    // each face: bottom-left, bottom-right (as seen from outside), then the same at the top
    face('front', [[u1, y0, v0], [u0, y0, v0]], [[u1, y1, v0], [u0, y1, v0]], W);
    face('back', [[u0, y0, v1], [u1, y0, v1]], [[u0, y1, v1], [u1, y1, v1]], W);
    face('right', [[u1, y0, v1], [u1, y0, v0]], [[u1, y1, v1], [u1, y1, v0]], D);
    face('left', [[u0, y0, v0], [u0, y0, v1]], [[u0, y1, v0], [u0, y1, v1]], D);
    const tw = opt.tmw || mw;
    if (!skip.includes('top')) {
      this.quad(key, P(F, u0, y1, v1), P(F, u1, y1, v1), P(F, u1, y1, v0), P(F, u0, y1, v0),
        [[0, 0], [W / tw, 0], [W / tw, D / tw], [0, D / tw]], opt.topCol || col);
    }
    if (!skip.includes('bottom')) {
      this.quad(key, P(F, u0, y0, v0), P(F, u1, y0, v0), P(F, u1, y0, v1), P(F, u0, y0, v1),
        [[0, 0], [W / tw, 0], [W / tw, D / tw], [0, D / tw]], col);
    }
    void H;
  }

  // Gable roof over u0..u1 × v0..v1, eaves at y=e, ridge height rh, ridge along u.
  // Slopes go to `key`, gable triangles to `gkey` (if given).
  gable(key, F, u0, u1, v0, v1, e, rh, opt = {}) {
    const o = opt.over ?? 0.35, mw = opt.mw || 3, mh = opt.mh || 3, col = opt.col || WHITE;
    const vm = (v0 + v1) / 2;
    const U0 = u0 - o, U1 = u1 + o, V0 = v0 - o, V1 = v1 + o;
    const ee = e - o * rh / ((v1 - v0) / 2);
    const sl = Math.hypot(vm - V0, e + rh - ee);
    const W = U1 - U0;
    const uv = [[0, 0], [W / mw, 0], [W / mw, sl / mh], [0, sl / mh]];
    this.quad(key, P(F, U1, ee, V0), P(F, U0, ee, V0), P(F, U0, e + rh, vm), P(F, U1, e + rh, vm), uv, col);
    this.quad(key, P(F, U0, ee, V1), P(F, U1, ee, V1), P(F, U1, e + rh, vm), P(F, U0, e + rh, vm), uv, col);
    if (opt.gkey) {
      const gm = opt.gmw || 4, gc = opt.gcol || WHITE, D = v1 - v0, gy = opt.gmh || gm;
      const yb = opt.gybase ?? e;
      this.poly(opt.gkey, [P(F, u1, e, v1), P(F, u1, e, v0), P(F, u1, e + rh, vm)],
        [[0, (e - yb) / gy], [D / gm, (e - yb) / gy], [D / 2 / gm, (e + rh - yb) / gy]], gc);
      this.poly(opt.gkey, [P(F, u0, e, v0), P(F, u0, e, v1), P(F, u0, e + rh, vm)],
        [[0, (e - yb) / gy], [D / gm, (e - yb) / gy], [D / 2 / gm, (e + rh - yb) / gy]], gc);
    }
  }

  // Pyramid / spire: square base half-size a at y0, apex at y1 (in frame F at (cu, cv)).
  spire(key, F, cu, cv, a, y0, y1, opt = {}) {
    const col = opt.col || WHITE, m = opt.mw || 3, sides = opt.sides || 4;
    const top = P(F, cu, y1, cv);
    const sl = Math.hypot(a, y1 - y0);
    for (let i = 0; i < sides; i++) {
      const t0 = (i / sides) * Math.PI * 2 + Math.PI / sides, t1 = ((i + 1) / sides) * Math.PI * 2 + Math.PI / sides;
      const r = sides === 4 ? a * Math.SQRT2 : a;
      const pa = P(F, cu + Math.cos(t1) * r, y0, cv + Math.sin(t1) * r);
      const pb = P(F, cu + Math.cos(t0) * r, y0, cv + Math.sin(t0) * r);
      const w = 2 * r * Math.sin(Math.PI / sides);
      this.poly(key, [pa, pb, top], [[0, 0], [w / m, 0], [w / 2 / m, sl / m]], col);
    }
  }

  // Vertical prism (cylinder approximation) around (cu, cv), radius r, y0..y1.
  prism(key, F, cu, cv, r, y0, y1, opt = {}) {
    const n = opt.sides || 8, col = opt.col || WHITE, m = opt.mw || 3, mh = opt.mh || m, r1 = opt.r1 ?? r;
    const circ = 2 * Math.PI * r / n;
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * Math.PI * 2, t1 = ((i + 1) / n) * Math.PI * 2;
      this.quad(key,
        P(F, cu + Math.cos(t1) * r, y0, cv + Math.sin(t1) * r), P(F, cu + Math.cos(t0) * r, y0, cv + Math.sin(t0) * r),
        P(F, cu + Math.cos(t0) * r1, y1, cv + Math.sin(t0) * r1), P(F, cu + Math.cos(t1) * r1, y1, cv + Math.sin(t1) * r1),
        [[i * circ / m, y0 / mh], [(i + 1) * circ / m, y0 / mh], [(i + 1) * circ / m, y1 / mh], [i * circ / m, y1 / mh]], col);
    }
    if (opt.cap) {
      const pts = [], uvs = [];
      for (let i = n - 1; i >= 0; i--) {
        const t = (i / n) * Math.PI * 2;
        pts.push(P(F, cu + Math.cos(t) * r1, y1, cv + Math.sin(t) * r1));
        uvs.push([Math.cos(t) * r1 / m, Math.sin(t) * r1 / m]);
      }
      this.poly(key, pts, uvs, col);
    }
  }

  // Dome (hemisphere-ish) of radius r centred at (cu, y0, cv), squashed by k.
  dome(key, F, cu, cv, r, y0, opt = {}) {
    const n = opt.sides || 16, rings = opt.rings || 6, k = opt.k ?? 1, col = opt.col || WHITE, m = opt.mw || 3;
    const pt = (i, j) => {
      const th = (j / rings) * Math.PI / 2, ph = (i / n) * Math.PI * 2;
      return P(F, cu + Math.cos(ph) * Math.cos(th) * r, y0 + Math.sin(th) * r * k, cv + Math.sin(ph) * Math.cos(th) * r);
    };
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < n; i++) {
        const uv = [[i / n * 6, j / rings * 3], [(i + 1) / n * 6, j / rings * 3], [(i + 1) / n * 6, (j + 1) / rings * 3], [i / n * 6, (j + 1) / rings * 3]];
        if (j === rings - 1) this.poly(key, [pt(i + 1, j), pt(i, j), pt(i, j + 1)], uv, col);
        else this.quad(key, pt(i + 1, j), pt(i, j), pt(i, j + 1), pt(i + 1, j + 1), uv, col);
      }
    }
    void m;
  }

  build(THREE, mats, group) {
    let calls = 0, tris = 0;
    for (const [key, b] of this.map) {
      if (!b.p.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
      g.computeBoundingSphere();
      const mk = key.split('#')[0];
      const mat = mats(mk);
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = 'world:' + mk;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      if (mat.transparent) mesh.renderOrder = 2;
      group.add(mesh);
      calls++; tris += b.tris;
    }
    this.map.clear();
    return { calls, tris };
  }
}

export const WHITE = [1, 1, 1];
const CHUNK_X = [-215, -140, -60, 60, 130, 200];
function chunkOf(x) { let i = 0; while (i < CHUNK_X.length && x > CHUNK_X[i]) i++; return i; }
const UNIT = [[0, 0], [1, 0], [1, 1], [0, 1]];
