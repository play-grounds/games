import { BOUNDS, inRiver } from './layout.js';

// Oriented boxes in XZ with a Y range, in a spatial hash. See CONTRACT.md.
const HC = 8;

export function create() {
  const boxes = [];
  const hash = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;

  function addBox(x, z, hx, hz, rot = 0, y0 = -10, y1 = 100) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const b = { x, z, hx, hz, c, s, y0, y1 };
    const ex = Math.abs(c) * hx + Math.abs(s) * hz, ez = Math.abs(s) * hx + Math.abs(c) * hz;
    b.ex = ex; b.ez = ez;
    boxes.push(b);
    for (let i = Math.floor((x - ex) / HC); i <= Math.floor((x + ex) / HC); i++) {
      for (let j = Math.floor((z - ez) / HC); j <= Math.floor((z + ez) / HC); j++) {
        const k = key(i, j);
        let a = hash.get(k);
        if (!a) hash.set(k, (a = []));
        a.push(b);
      }
    }
    return b;
  }

  const seen = new Set();
  function near(x, z, r, out) {
    out.length = 0; seen.clear();
    for (let i = Math.floor((x - r) / HC); i <= Math.floor((x + r) / HC); i++) {
      for (let j = Math.floor((z - r) / HC); j <= Math.floor((z + r) / HC); j++) {
        const a = hash.get(key(i, j));
        if (!a) continue;
        for (const b of a) if (!seen.has(b)) { seen.add(b); out.push(b); }
      }
    }
    return out;
  }

  // world → box local: rotation by +rot about Y maps local (u,v) to world (u c + v s, −u s + v c)
  const local = (b, x, z) => {
    const dx = x - b.x, dz = z - b.z;
    return [dx * b.c - dz * b.s, dx * b.s + dz * b.c];
  };
  const world = (b, u, v) => [b.x + u * b.c + v * b.s, b.z - u * b.s + v * b.c];

  const tmp = [];
  function resolve(pos, r, y = pos.y ?? 0) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const b of near(pos.x, pos.z, r + 1, tmp)) {
        if (y + 1.8 < b.y0 || y + 0.3 > b.y1) continue;
        const [u, v] = local(b, pos.x, pos.z);
        const cu = Math.max(-b.hx, Math.min(b.hx, u)), cv = Math.max(-b.hz, Math.min(b.hz, v));
        const du = u - cu, dv = v - cv, d = Math.hypot(du, dv);
        if (d >= r) continue;
        if (d < 1e-6) {                       // centre inside: push out along the shallowest axis
          const pu = b.hx - Math.abs(u), pv = b.hz - Math.abs(v);
          if (pu < pv) [pos.x, pos.z] = world(b, Math.sign(u || 1) * (b.hx + r), v);
          else [pos.x, pos.z] = world(b, u, Math.sign(v || 1) * (b.hz + r));
          moved = true; continue;
        }
        const k = (r - d) / d;
        const [wx, wz] = world(b, u + du * k, v + dv * k);
        pos.x = wx; pos.z = wz; moved = true;
      }
      if (!moved) break;
    }
    return pos;
  }

  function inside(x, z, pad = 0, y = 0) {
    for (const b of near(x, z, pad + 1, tmp)) {
      if (y + 1.8 < b.y0 || y + 0.3 > b.y1) continue;
      const [u, v] = local(b, x, z);
      if (Math.abs(u) < b.hx + pad && Math.abs(v) < b.hz + pad) return true;
    }
    return false;
  }

  // 3D ray vs boxes. Walks the hash along the ray in 4 m steps.
  function raycast(o, d, maxDist = 200) {
    const L = Math.hypot(d.x, d.z) || 1e-9;
    let best = Infinity;
    const checked = new Set();
    for (let s = 0; s <= maxDist + HC; s += 4) {
      if (s > best) break;
      const px = o.x + d.x * s, pz = o.z + d.z * s;
      for (const b of near(px, pz, 4, tmp)) {
        if (checked.has(b)) continue;
        checked.add(b);
        const t = rayBox(b, o, d);
        if (t < best) best = t;
      }
      if (L < 1e-6) break;
    }
    return best <= maxDist ? best : Infinity;
  }

  function rayBox(b, o, d) {
    const [ou, ov] = local(b, o.x, o.z);
    const du = d.x * b.c - d.z * b.s, dv = d.x * b.s + d.z * b.c;
    let t0 = 0, t1 = Infinity;
    const slab = (oo, dd, lo, hi) => {
      if (Math.abs(dd) < 1e-9) return oo >= lo && oo <= hi;
      let a = (lo - oo) / dd, c = (hi - oo) / dd;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      return t0 <= t1;
    };
    if (!slab(ou, du, -b.hx, b.hx)) return Infinity;
    if (!slab(ov, dv, -b.hz, b.hz)) return Infinity;
    if (!slab(o.y, d.y, b.y0, b.y1)) return Infinity;
    return t0;
  }

  const grid = { cell: 2, x0: BOUNDS.x0, z0: BOUNDS.z0, nx: 0, nz: 0, data: null };
  function finalize() {
    grid.nx = Math.ceil((BOUNDS.x1 - BOUNDS.x0) / grid.cell);
    grid.nz = Math.ceil((BOUNDS.z1 - BOUNDS.z0) / grid.cell);
    grid.data = new Uint8Array(grid.nx * grid.nz);
    for (let j = 0; j < grid.nz; j++) {
      for (let i = 0; i < grid.nx; i++) {
        const x = grid.x0 + (i + 0.5) * grid.cell, z = grid.z0 + (j + 0.5) * grid.cell;
        grid.data[j * grid.nx + i] = inRiver(x, z) || inside(x, z, 0.3, heightOf(x, z)) ? 0 : 1;
      }
    }
  }
  let heightOf = () => 0;

  function walkable(x, z) {
    if (x > 1000) return !inside(x, z, 0.3);
    if (!grid.data) return !inRiver(x, z) && !inside(x, z, 0.3);
    const i = Math.floor((x - grid.x0) / grid.cell), j = Math.floor((z - grid.z0) / grid.cell);
    if (i < 0 || j < 0 || i >= grid.nx || j >= grid.nz) return false;
    return grid.data[j * grid.nx + i] === 1;
  }

  return {
    boxes, addBox, resolve, raycast, inside, walkable, finalize, grid,
    setHeight(fn) { heightOf = fn; },
  };
}
