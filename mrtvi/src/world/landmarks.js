// Landmarks: Charles Bridge + towers, Old Town Hall + astronomical clock, Týn, Powder Tower,
// the pharmacy, St Nicholas, the Castle walls/gate and St Vitus. Each reserves its footprint
// in the occupancy grid before the street lots are placed.

export function buildLandmarks(W) {
  const { B, L, H, R, frame, sub, P, solid, stamp, reserveAxis, metres, THREE } = W;
  const sm = metres('stone')[0], rm = metres('roof')[0], wm = metres('wall')[0];
  const BLACK = [0.42, 0.4, 0.37];       // blackened sandstone tint
  const SOOT = [0.3, 0.29, 0.27];
  const out = {};

  // Small helpers -----------------------------------------------------------
  const stoneBox = (F, u0, u1, y0, y1, v0, v1, col = BLACK, skip = 'bottom') => B.box('stone', F, u0, u1, y0, y1, v0, v1, { mw: sm, mh: sm, col, skip });
  // Gothic spire with four corner pinnacles over a square (half size a) at height y0.
  function gothicSpire(F, cu, cv, a, y0, y1, key = 'slate', col = [0.8, 0.8, 0.85]) {
    B.spire(key, F, cu, cv, a, y0, y1, { col, mw: 2 });
    for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const pu = cu + du * a, pv = cv + dv * a;
      B.prism(key.endsWith('Far') ? 'stoneFar' : 'stone', F, pu, pv, a * 0.16, y0 - 2, y0 + 1.2, { sides: 6, col: key.endsWith('Far') ? [0.3, 0.29, 0.27] : BLACK, mw: sm });
      B.spire(key, F, pu, pv, a * 0.16, y0 + 1.2, y0 + 1.2 + (y1 - y0) * 0.28, { col, mw: 2 });
    }
  }
  // ---- arches ---------------------------------------------------------------
  // Arch profile across a passage of width w centred on v = vc, springing at ys.
  // 'round' = Baroque semicircle, 'pointed' = Gothic two-centred arch (radius k·w).
  function archCurve(vc, w, ys, kind = 'round', n = 14, k = 0.7) {
    const pts = [];
    if (kind === 'round') {
      const r = w / 2;
      for (let i = 0; i <= n; i++) { const t = Math.PI - (i / n) * Math.PI; pts.push([vc + Math.cos(t) * r, ys + Math.sin(t) * r]); }
      return pts;
    }
    const Rr = w * k, ca = (Rr - w / 2) / Rr, amax = Math.acos(ca), h = n >> 1;
    for (let i = 0; i <= h; i++) { const a = (i / h) * amax; pts.push([vc - w / 2 + Rr - Rr * Math.cos(a), ys + Rr * Math.sin(a)]); }
    for (let i = h - 1; i >= 0; i--) { const a = (i / h) * amax; pts.push([vc + w / 2 - Rr + Rr * Math.cos(a), ys + Rr * Math.sin(a)]); }
    return pts;
  }
  const archRise = (w, kind, k = 0.7) => (kind === 'round' ? w / 2 : w * k * Math.sin(Math.acos((w * k - w / 2) / (w * k))));
  // A passage through a wall slab u0..u1 (frame F): spandrels between the arch and yTop on
  // both faces, the vault (intrados) through the depth, and a moulded archivolt ring.
  function archway(F, u0, u1, vc, w, ys, yTop, o = {}) {
    const kind = o.kind || 'round', key = o.key || 'stone', col = o.col || BLACK, m = o.m || sm;
    const ring = o.ringKey || key, rcol = o.ringCol || col.map((c) => Math.min(1, c * 1.25));
    const pts = archCurve(vc, w, ys, kind, o.n || 16, o.k);
    const uW = [F.c, 0, -F.s];
    const cy = ys, cv = vc;
    for (const [u, sg] of [[u0, -1], [u1, 1]]) {
      const dir = uW.map((a) => a * sg);
      for (let i = 0; i < pts.length - 1; i++) {
        const [va, ya] = pts[i], [vb, yb] = pts[i + 1];
        B.polyF(key, [P(F, u, ya, va), P(F, u, yb, vb), P(F, u, yTop, vb), P(F, u, yTop, va)], dir,
          [[va / m, ya / m], [vb / m, yb / m], [vb / m, yTop / m], [va / m, yTop / m]], col);
        // archivolt: a band standing proud of the face, following the curve
        const nrm = (v, y) => { const L2 = Math.hypot(v - cv, y - cy) || 1; return [(v - cv) / L2, (y - cy) / L2]; };
        const [na, nya] = nrm(va, ya), [nb, nyb] = nrm(vb, yb), bw = o.ring ?? 0.55, uo = u + sg * 0.14;
        const qa = [va + na * bw, ya + nya * bw], qb = [vb + nb * bw, yb + nyb * bw];
        B.polyF(ring, [P(F, uo, ya, va), P(F, uo, yb, vb), P(F, uo, qb[1], qb[0]), P(F, uo, qa[1], qa[0])], dir,
          [[0, 0], [1, 0], [1, 0.3], [0, 0.3]], rcol);
        const vm = (va + vb) / 2, ym = (ya + yb) / 2, inw = [(cv - vm) * F.s, cy - ym, (cv - vm) * F.c];
        B.polyF(ring, [P(F, u, ya, va), P(F, u, yb, vb), P(F, uo, yb, vb), P(F, uo, ya, va)], inw, [[0, 0], [1, 0], [1, 0.1], [0, 0.1]], rcol);
        B.polyF(ring, [P(F, u, qa[1], qa[0]), P(F, u, qb[1], qb[0]), P(F, uo, qb[1], qb[0]), P(F, uo, qa[1], qa[0])], inw.map((a) => -a), [[0, 0], [1, 0], [1, 0.1], [0, 0.1]], rcol);
      }
      // jamb mouldings below the springing
      if (o.jambs !== false) for (const s of [-1, 1]) {
        const v0 = vc + s * w / 2, v1 = v0 + s * (o.ring ?? 0.55);
        B.box(ring, F, Math.min(u, u + sg * 0.14), Math.max(u, u + sg * 0.14), o.y0 ?? -0.3, ys, Math.min(v0, v1), Math.max(v0, v1), { mw: m, mh: m, col: rcol, skip: 'bottom' });
      }
    }
    // vault through the depth
    for (let i = 0; i < pts.length - 1; i++) {
      const [va, ya] = pts[i], [vb, yb] = pts[i + 1];
      const vm = (va + vb) / 2, ym = (ya + yb) / 2;
      const inw = [(cv - vm) * F.s, cy - ym - 0.5, (cv - vm) * F.c];
      B.polyF(key, [P(F, u0, ya, va), P(F, u1, ya, va), P(F, u1, yb, vb), P(F, u0, yb, vb)], inw,
        [[u0 / m, i * 0.4], [u1 / m, i * 0.4], [u1 / m, (i + 1) * 0.4], [u0 / m, (i + 1) * 0.4]], (o.vaultCol || SOOT));
    }
    // keystone
    if (kind === 'round' && o.keystone !== false) {
      const top = ys + w / 2;
      for (const [u, sg] of [[u0, -1], [u1, 1]]) B.box(ring, F, Math.min(u, u + sg * 0.3), Math.max(u, u + sg * 0.3), top - 0.2, top + 0.9, vc - 0.45, vc + 0.45, { mw: m, mh: m, col: rcol });
    }
  }
  W.archway = archway;
  W.archRise = archRise;

  // Crenellated parapet on top of a rectangle.
  function gallery(F, u0, u1, v0, v1, y, col = BLACK, key = 'stone') {
    B.box(key, F, u0 - 0.5, u1 + 0.5, y - 0.6, y, v0 - 0.5, v1 + 0.5, { mw: sm, mh: sm, col, skip: 'bottom' });
  }

  // ===================== Charles Bridge ====================================
  {
    const RV = L.RIVER, hw = L.BRIDGE.width / 2, F0 = frame(0, 0, 0, 0);
    const piers = [-27, -9, 9, 27];
    // deck
    B.box('cobble', F0, RV.x0, RV.x1, -0.01, 0, -hw, hw, { mw: 4, tmw: 4, skip: 'front,back,left,right,bottom' });
    // spandrels with segmental arches between piers, both faces
    const edges = [RV.x0, ...piers.flatMap((p) => [p - 2, p + 2]), RV.x1];
    const archY = (x, a, b) => {
      const m = (a + b) / 2, h = (b - a) / 2;
      const t = Math.min(1, Math.abs(x - m) / h);
      return -3.6 + 2.5 * Math.sqrt(1 - t * t);
    };
    for (let s = 0; s < edges.length; s += 2) {
      const a = edges[s], b = edges[s + 1], N = 12;
      for (let k = 0; k < N; k++) {
        const xa = a + (b - a) * k / N, xb = a + (b - a) * (k + 1) / N;
        const ya = archY(xa, a, b), yb = archY(xb, a, b);
        const uv = [[xa / sm, ya / sm], [xb / sm, yb / sm], [xb / sm, 0], [xa / sm, 0]];
        // south face (z = +hw+0.5), normal +z
        B.quad('stone', [xa, ya, hw + 0.5], [xb, yb, hw + 0.5], [xb, 0, hw + 0.5], [xa, 0, hw + 0.5], uv, BLACK);
        // north face, normal −z
        B.quad('stone', [xb, yb, -hw - 0.5], [xa, ya, -hw - 0.5], [xa, 0, -hw - 0.5], [xb, 0, -hw - 0.5], uv, BLACK);
        // intrados (facing down)
        B.quad('stone', [xa, ya, -hw - 0.5], [xb, yb, -hw - 0.5], [xb, yb, hw + 0.5], [xa, ya, hw + 0.5], [[0, 0], [1, 0], [1, 3], [0, 3]], SOOT);
      }
    }
    // piers with cutwaters
    for (const p of piers) {
      stoneBox(F0, p - 2, p + 2, RV.bed, 0, -hw - 0.5, hw + 0.5, BLACK, 'bottom,top');
      for (const sgn of [-1, 1]) {
        const z0 = sgn * (hw + 0.5), z1 = sgn * (hw + 4);
        const pts = (y) => [[p - 2, y, z0], [p, y, z1], [p + 2, y, z0]];
        const lo = pts(RV.bed), hi = pts(-1.2);
        B.polyF('stone', [lo[0], lo[1], hi[1], hi[0]], [-1, 0, sgn], null, BLACK);
        B.polyF('stone', [lo[1], lo[2], hi[2], hi[1]], [1, 0, sgn], null, BLACK);
        B.polyF('stone', [hi[0], hi[1], [p, 0.4, z0]], [-1, 1, sgn], null, BLACK);
        B.polyF('stone', [hi[1], hi[2], [p, 0.4, z0]], [1, 1, sgn], null, BLACK);
      }
    }
    // parapets (on the deck edge; walkable deck is |z| < hw)
    for (const sgn of [-1, 1]) {
      const zc = sgn * (hw + 0.25);
      stoneBox(F0, RV.x0 - 0.6, RV.x1 + 0.6, -0.05, 1.05, zc - 0.25, zc + 0.25, BLACK, 'bottom');
      stoneBox(F0, RV.x0 - 0.6, RV.x1 + 0.6, 1.05, 1.2, zc - 0.35, zc + 0.35, [0.5, 0.48, 0.45], 'bottom');
      solid(0, zc, (RV.x1 - RV.x0) / 2 + 0.6, 0.25, 0, -10, 100, true);
    }
    // statues: blackened baroque figures on plinths over the parapet
    const SR = L.rng(31);
    const statues = [];
    for (let k = 0; k < 10; k++) {
      const x = -40.5 + k * 9;
      for (const sgn of [-1, 1]) {
        if (k === 4 && sgn > 0) continue;              // gap: the horde comes through here
        const zc = sgn * (hw + 0.9);
        const F = frame(x, 0, zc, sgn > 0 ? Math.PI : 0); // local v points into the bridge
        stoneBox(F, -0.95, 0.95, -0.05, 2.3, -0.9, 0.9, BLACK, 'bottom');
        stoneBox(F, -1.1, 1.1, 2.3, 2.55, -1.05, 1.05, [0.48, 0.46, 0.43], 'bottom');
        solid(x, zc, 0.95, 0.9, 0, -10, 100, true);
        statues.push([F, SR()]);
      }
    }
    for (const [F, r] of statues) statue(F, r);
    // bridge lamps (dead) between statues
    for (let k = 0; k < 9; k++) {
      const x = -36 + k * 9;
      for (const sgn of [-1, 1]) {
        const F = frame(x, 1.2, sgn * (hw + 0.25), 0);
        B.prism('metal', F, 0, 0, 0.07, 0, 2.8, { sides: 5 });
        B.box('metal', F, -0.22, 0.22, 2.8, 3.35, -0.22, 0.22, { skip: 'bottom' });
        B.spire('metal', F, 0, 0, 0.26, 3.35, 3.65, {});
        W.lamps.push(new THREE.Vector3(x, 4.3, sgn * (hw + 0.25)));
      }
    }
  }

  function statue(F, r) {
    const col = SOOT;
    const kind = Math.floor(r * 4);
    const y0 = 2.55;
    if (kind === 0) {                                  // crucifix group
      B.box('stone', F, -0.12, 0.12, y0, y0 + 4.2, -0.12, 0.12, { col, skip: 'bottom' });
      B.box('stone', F, -1.1, 1.1, y0 + 3.0, y0 + 3.25, -0.12, 0.12, { col });
      B.box('stone', F, -0.2, 0.2, y0 + 1.6, y0 + 3.0, -0.25, -0.12, { col });
      B.box('gold', F, -0.9, 0.9, y0 + 3.6, y0 + 3.75, -0.3, -0.13, { col: [0.6, 0.55, 0.4] });
      return;
    }
    const robe = kind === 3 ? 0.62 : 0.5;
    B.prism('stone', F, 0, 0, robe, y0, y0 + 1.6, { sides: 7, r1: 0.32, col, mw: sm });
    B.prism('stone', F, 0, 0, 0.34, y0 + 1.6, y0 + 2.15, { sides: 7, r1: 0.26, col, mw: sm });
    B.prism('stone', F, 0, 0.03, 0.15, y0 + 2.15, y0 + 2.5, { sides: 6, r1: 0.12, col, cap: true, mw: sm });
    // raised arm / staff
    const Fa = sub(F, 0.32, 0, 0.1, 0);
    B.box('stone', Fa, -0.08, 0.08, y0 + 1.5, y0 + 2.6 + r, -0.08, 0.08, { col });
    if (kind === 1) {                                  // halo of stars (Nepomuk)
      for (let i = 0; i < 5; i++) {
        const a = -0.6 + i * 0.3;
        B.box('gold', F, Math.sin(a) * 0.38 - 0.04, Math.sin(a) * 0.38 + 0.04, y0 + 2.6 + Math.cos(a) * 0.3, y0 + 2.68 + Math.cos(a) * 0.3, -0.02, 0.06, { col: [0.5, 0.45, 0.3] });
      }
    }
    if (kind === 2) {                                  // kneeling second figure
      B.prism('stone', F, -0.55, -0.3, 0.32, y0, y0 + 0.9, { sides: 6, r1: 0.24, col, mw: sm });
      B.prism('stone', F, -0.55, -0.25, 0.12, y0 + 0.9, y0 + 1.2, { sides: 6, col, cap: true, mw: sm });
    }
  }

  // ---- bridge towers ------------------------------------------------------
  const TWR = [0.3, 0.29, 0.27];           // darker albedo: tower silhouettes survive the fog
  const tBox = (F, u0, u1, y0, y1, v0, v1, col = TWR, skip = 'bottom') => B.box('stoneFar', F, u0, u1, y0, y1, v0, v1, { mw: sm, mh: sm, col, skip });
  function gateTower(x0, x1, z0, z1, passZ0, passZ1, topH, roofH, kind = 'pointed') {
    const F = frame(0, 0, 0, 0);
    const w = passZ1 - passZ0, zm = (passZ0 + passZ1) / 2, ys = 4.2, yA = ys + archRise(w, kind) + 0.9;
    // piers
    tBox(F, x0, x1, -0.5, yA, z0, passZ0); solid((x0 + x1) / 2, (z0 + passZ0) / 2, (x1 - x0) / 2, (passZ0 - z0) / 2);
    tBox(F, x0, x1, -0.5, yA, passZ1, z1); solid((x0 + x1) / 2, (z1 + passZ1) / 2, (x1 - x0) / 2, (z1 - passZ1) / 2);
    // body over the passage + the Gothic arch with its vault
    tBox(F, x0, x1, yA, topH, z0, z1);
    archway(F, x0, x1, zm, w, ys, yA, { kind, key: 'stoneFar', col: TWR, ringCol: [0.42, 0.4, 0.37] });
    solid((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, 0, ys + 1.6, topH + roofH);
    // string courses, a statue gallery band and the parapet walk
    tBox(F, x0 - 0.3, x1 + 0.3, yA + 0.4, yA + 0.9, z0 - 0.3, z1 + 0.3, [0.4, 0.38, 0.35]);
    tBox(F, x0 - 0.25, x1 + 0.25, yA + 7.5, yA + 7.9, z0 - 0.25, z1 + 0.25, [0.4, 0.38, 0.35]);
    gallery(F, x0, x1, z0, z1, topH + 0.6, TWR, 'stoneFar');
    // dark lancet windows with a pointed head
    for (const x of [x0 - 0.04, x1 + 0.04]) {
      const e = x > (x0 + x1) / 2;
      for (const zz of [zm - (z1 - z0) * 0.22, zm + (z1 - z0) * 0.22]) {
        const yA2 = yA + 9, yB = topH - 3.5;
        if (yB - yA2 < 2) continue;
        const pts = [[x, yA2, zz - 0.7], [x, yA2, zz + 0.7], [x, yB, zz + 0.7], [x, yB + 0.6, zz + 0.45], [x, yB + 1, zz], [x, yB + 0.6, zz - 0.45], [x, yB, zz - 0.7]];
        B.polyF('dark', pts, [e ? 1 : -1, 0, 0]);
      }
      // blind tracery niches over the arch (statues of the kings in reality)
      for (const zz of [zm - 2.4, zm, zm + 2.4]) {
        const y = yA + 1.6, pts = [[x, y, zz - 0.5], [x, y, zz + 0.5], [x, y + 3.6, zz + 0.5], [x, y + 4.4, zz], [x, y + 3.6, zz - 0.5]];
        B.polyF('dark', pts, [e ? 1 : -1, 0, 0], null, [1.6, 1.6, 1.6]);
      }
    }
    const a = Math.min(x1 - x0, z1 - z0) / 2;
    gothicSpire(F, (x0 + x1) / 2, (z0 + z1) / 2, a, topH + 0.6, topH + roofH, 'slateFar', [0.55, 0.55, 0.6]);
  }
  // Old Town bridge tower (east)
  gateTower(45.6, 55, -9.5, 9.5, -5.6, 5.6, 30, 16);
  reserveAxis(45, 56, -10, 10);
  // Malá Strana towers (west): tall north tower + lower Judith tower, joined by the gate
  {
    const F = frame(0, 0, 0, 0);
    tBox(F, -54.6, -45.6, -0.5, 30, -15, -5.6);
    solid(-50.1, -10.3, 4.5, 4.7);
    gothicSpire(F, -50.1, -10.3, 4.5, 30.6, 46, 'slateFar', [0.55, 0.55, 0.6]);
    gallery(F, -54.6, -45.6, -15, -5.6, 30.6, TWR, 'stoneFar');
    for (const x of [-54.64, -45.56]) for (let y = 12; y < 27; y += 7) {
      const e = x > -50, pts = [[x, y, -11], [x, y, -9.6], [x, y + 3, -9.6], [x, y + 3.7, -10.3], [x, y + 3, -11]];
      B.polyF('dark', pts, [e ? 1 : -1, 0, 0]);
    }
    tBox(F, -54.6, -45.6, -0.5, 18, 5.6, 12);
    solid(-50.1, 8.8, 4.5, 3.2);
    B.gable('roof', sub(F, -50.1, 0, 8.8, Math.PI / 2), -3.2, 3.2, -4.5, 4.5, 18, 4, { mw: rm, mh: rm, gkey: 'stoneFar', gcol: TWR });
    // the gateway between them: a Gothic pointed arch with a vaulted passage
    const w = 11.2, ys = 3.6, yA = ys + archRise(w, 'pointed', 0.62) + 0.7;
    tBox(F, -54.6, -45.6, yA, yA + 3.5, -5.6, 5.6);
    archway(F, -54.6, -45.6, 0, w, ys, yA, { kind: 'pointed', k: 0.62, key: 'stoneFar', col: TWR, ringCol: [0.42, 0.4, 0.37], jambs: false });
    solid(-50.1, 0, 4.5, 5.6, 0, ys + 1.6, yA + 7);
    B.gable('roof', sub(F, -50.1, 0, 0, Math.PI / 2), -5.6, 5.6, -4.5, 4.5, yA + 3.5, 3, { mw: rm, mh: rm, gkey: 'stoneFar', gcol: TWR });
    reserveAxis(-55.5, -45, -16, 13);
  }

  // ===================== Old Town Hall + astronomical clock ================
  {
    const C = L.CLOCK_TOWER, cx0 = C.x - C.w / 2, cx1 = Math.min(C.x + C.w / 2, L.OTS.x - L.OTS.w / 2 - 0.6);
    const cz0 = C.z - C.d / 2, cz1 = C.z + C.d / 2;
    const F = frame(0, 0, 0, 0);
    const shaft = C.h - 24;
    // Pale sandstone shaft (Old Town Hall tower is light, not soot-black), with stepped
    // corner buttresses, string courses and lancet windows.
    const LS = [1, 0.98, 0.94], LS2 = [0.84, 0.82, 0.77];
    const lBox = (u0, u1, y0, y1, v0, v1, col = LS, skip = 'bottom') => B.box('stoneLightFar', F, u0, u1, y0, y1, v0, v1, { mw: sm, mh: sm, col, skip });
    lBox(cx0, cx1, -0.5, shaft, cz0, cz1);
    solid((cx0 + cx1) / 2, (cz0 + cz1) / 2, (cx1 - cx0) / 2, (cz1 - cz0) / 2);
    for (const [x, z] of [[cx0, cz0], [cx1, cz0], [cx1, cz1], [cx0, cz1]]) {
      lBox(x - 0.35, x + 0.35, -0.5, shaft - 6, z - 0.35, z + 0.35, LS2);
    }
    for (let y = 16; y < shaft - 2; y += 9.5) lBox(cx0 - 0.25, cx1 + 0.25, y, y + 0.35, cz0 - 0.25, cz1 + 0.25, LS2);
    // gallery: corbelled walkway with a pierced parapet
    const gy = shaft;
    for (let k = 0; k < 3; k++) lBox(cx0 - 0.25 * (k + 1), cx1 + 0.25 * (k + 1), gy + k * 0.3, gy + k * 0.3 + 0.3, cz0 - 0.25 * (k + 1), cz1 + 0.25 * (k + 1), LS2);
    const go = 0.9, gx0 = cx0 - go, gx1 = cx1 + go, gz0 = cz0 - go, gz1 = cz1 + go;
    lBox(gx0, gx1, gy + 0.9, gy + 1.1, gz0, gz1, LS2);
    for (const [u0, u1, v0, v1] of [[gx0, gx1, gz0, gz0 + 0.25], [gx0, gx1, gz1 - 0.25, gz1], [gx0, gx0 + 0.25, gz0, gz1], [gx1 - 0.25, gx1, gz0, gz1]]) {
      lBox(u0, u1, gy + 1.1, gy + 1.4, v0, v1, LS2);
      lBox(u0, u1, gy + 2.0, gy + 2.2, v0, v1, LS2);
      const alongX = u1 - u0 > v1 - v0, len = alongX ? u1 - u0 : v1 - v0, n = Math.floor(len / 0.8);
      for (let i = 0; i <= n; i++) {
        const t = (alongX ? u0 : v0) + (len * i) / n;
        if (alongX) lBox(t - 0.08, t + 0.08, gy + 1.4, gy + 2.0, v0, v1, LS2);
        else lBox(u0, u1, gy + 1.4, gy + 2.0, t - 0.08, t + 0.08, LS2);
      }
    }
    // upper storey above the gallery (set back), dark openings
    const ux0 = cx0 + 0.4, ux1 = cx1 - 0.4, uz0 = cz0 + 0.4, uz1 = cz1 - 0.4, uy = gy + 1.1, uT = uy + 4.2;
    lBox(ux0, ux1, uy, uT, uz0, uz1, LS);
    for (const [pa, pb, d] of [[[ux0, uz1 + 0.03], [ux1, uz1 + 0.03], [0, 0, 1]], [[ux1, uz0 - 0.03], [ux0, uz0 - 0.03], [0, 0, -1]], [[ux1 + 0.03, uz1], [ux1 + 0.03, uz0], [1, 0, 0]], [[ux0 - 0.03, uz0], [ux0 - 0.03, uz1], [-1, 0, 0]]]) {
      for (const t of [0.3, 0.7]) {
        const x = pa[0] + (pb[0] - pa[0]) * t, z = pa[1] + (pb[1] - pa[1]) * t, ex = (pb[0] - pa[0]) * 0.08, ez = (pb[1] - pa[1]) * 0.08;
        B.polyF('dark', [[x - ex, uy + 0.8, z - ez], [x + ex, uy + 0.8, z + ez], [x + ex, uy + 3.0, z + ez], [x, uy + 3.6, z], [x - ex, uy + 3.0, z - ez]], d);
      }
    }
    // steep pointed roof with four corner turrets (the hall tower's signature)
    const rx = (ux0 + ux1) / 2, rz = (uz0 + uz1) / 2, ra = (ux1 - ux0) / 2 + 0.3;
    B.spire('slateFar', F, rx, rz, ra, uT, C.h, { col: [0.5, 0.5, 0.55], mw: 2 });
    B.prism('metal', F, rx, rz, 0.05, C.h, C.h + 2.2, { sides: 4 });
    B.box('gold', F, rx - 0.12, rx + 0.12, C.h + 1.2, C.h + 1.5, rz - 0.12, rz + 0.12, { col: [0.7, 0.6, 0.35] });
    for (const [x, z] of [[gx0 + 0.3, gz0 + 0.3], [gx1 - 0.3, gz0 + 0.3], [gx1 - 0.3, gz1 - 0.3], [gx0 + 0.3, gz1 - 0.3]]) {
      B.prism('stoneLightFar', F, x, z, 0.75, gy + 1.1, uT + 0.6, { sides: 8, col: LS, mw: sm });
      for (let i = 0; i < 4; i++) {
        const t = (i / 4) * Math.PI * 2 + Math.PI / 4;
        B.polyF('dark', [[x + Math.cos(t) * 0.78 - Math.sin(t) * 0.2, uy + 1, z + Math.sin(t) * 0.78 + Math.cos(t) * 0.2], [x + Math.cos(t) * 0.78 + Math.sin(t) * 0.2, uy + 1, z + Math.sin(t) * 0.78 - Math.cos(t) * 0.2], [x + Math.cos(t) * 0.78, uy + 2.6, z + Math.sin(t) * 0.78]], [Math.cos(t), 0, Math.sin(t)]);
      }
      B.spire('slateFar', F, x, z, 0.85, uT + 0.6, uT + 7.5, { sides: 8, col: [0.5, 0.5, 0.55], mw: 2 });
    }
    // lancet windows on the shaft (south + east)
    for (let y = 20; y < shaft - 4; y += 9.5) {
      B.polyF('dark', [[C.x - 0.6, y, cz1 + 0.03], [C.x + 0.6, y, cz1 + 0.03], [C.x + 0.6, y + 2.6, cz1 + 0.03], [C.x, y + 3.3, cz1 + 0.03], [C.x - 0.6, y + 2.6, cz1 + 0.03]], [0, 0, 1]);
      B.polyF('dark', [[cx1 + 0.03, y, C.z + 0.6], [cx1 + 0.03, y, C.z - 0.6], [cx1 + 0.03, y + 2.6, C.z - 0.6], [cx1 + 0.03, y + 3.3, C.z], [cx1 + 0.03, y + 2.6, C.z + 0.6]], [1, 0, 0]);
    }
    // the chapel oriel on the east face (five-sided bay on a corbel)
    {
      const ox = cx1, oz = C.z - 2.2, oy0 = 9, oy1 = 15.5, r = 1.6;
      const Fo = frame(ox, 0, oz, 0);
      const ring = (rad, y) => Array.from({ length: 6 }, (_, i) => { const t = -Math.PI / 2 + (i / 5) * Math.PI; return [Math.cos(t) * rad, y, Math.sin(t) * rad]; });
      const lo = ring(r, oy0), hi = ring(r, oy1);
      for (let i = 0; i < 5; i++) {
        const q = [lo[i], lo[i + 1], hi[i + 1], hi[i]].map(([u, y, v]) => P(Fo, u, y, v));
        const t = -Math.PI / 2 + ((i + 0.5) / 5) * Math.PI;
        B.polyF('stoneLight', q, [Math.cos(t), 0, Math.sin(t)], [[0, oy0 / sm], [1, oy0 / sm], [1, oy1 / sm], [0, oy1 / sm]], LS);
        const w = q.map((p, j) => [p[0] + Math.cos(t) * 0.03, p[1], p[2] + Math.sin(t) * 0.03]);
        const mid = (A, Bq, k) => A.map((a, j) => a + (Bq[j] - a) * k);
        const b0 = mid(w[0], w[1], 0.25), b1 = mid(w[0], w[1], 0.75);
        B.polyF('dark', [[b0[0], oy0 + 1.4, b0[2]], [b1[0], oy0 + 1.4, b1[2]], [b1[0], oy1 - 1.4, b1[2]], [(b0[0] + b1[0]) / 2, oy1 - 0.8, (b0[2] + b1[2]) / 2], [b0[0], oy1 - 1.4, b0[2]]], [Math.cos(t), 0, Math.sin(t)]);
      }
      // corbel (inverted cone) and the little roof
      for (let i = 0; i < 5; i++) B.polyF('stoneLight', [P(Fo, lo[i][0], oy0, lo[i][2]), P(Fo, lo[i + 1][0], oy0, lo[i + 1][2]), P(Fo, 0, oy0 - 2.4, 0)], [Math.cos(-Math.PI / 2 + ((i + 0.5) / 5) * Math.PI), -0.6, Math.sin(-Math.PI / 2 + ((i + 0.5) / 5) * Math.PI)], null, LS2);
      for (let i = 0; i < 5; i++) B.polyF('slate', [P(Fo, hi[i][0] * 1.12, oy1, hi[i][2] * 1.12), P(Fo, hi[i + 1][0] * 1.12, oy1, hi[i + 1][2] * 1.12), P(Fo, 0, oy1 + 3.2, 0)], [Math.cos(-Math.PI / 2 + ((i + 0.5) / 5) * Math.PI), 0.6, Math.sin(-Math.PI / 2 + ((i + 0.5) / 5) * Math.PI)], null, [0.55, 0.55, 0.6]);
    }
    // the clock: stone surround, dial, calendar disc, little roof above
    const K = L.CLOCK, zf = cz1;
    const sl = (u0, u1, y0, y1, v0, v1, col = [0.7, 0.67, 0.6]) => B.box('stoneLight', F, u0, u1, y0, y1, v0, v1, { mw: sm, mh: sm, col });
    sl(K.x - 3.4, K.x + 3.4, 3.2, K.y + 3.6, zf, zf + 0.45);
    sl(K.x - 3.8, K.x + 3.8, K.y + 3.6, K.y + 4.0, zf, zf + 0.8, [0.62, 0.6, 0.55]);
    for (const du of [-3.55, 3.55]) {                  // pinnacled side piers
      sl(K.x + du - 0.25, K.x + du + 0.25, 3.2, K.y + 5.2, zf, zf + 0.7, [0.62, 0.6, 0.55]);
      B.spire('stoneLight', F, K.x + du, zf + 0.35, 0.3, K.y + 5.2, K.y + 6.6, { col: [0.62, 0.6, 0.55] });
    }
    B.gable('slate', sub(F, K.x, 0, zf + 0.4, 0), -3.6, 3.6, -0.6, 0.6, K.y + 4.0, 1.4, { over: 0.2 });
    // gilded rings around the dial and the calendar
    const goldRing = (cy, r0, r1, n = 40) => {
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, z = zf + 0.53;
        B.polyF('gold', [[K.x + Math.cos(a0) * r0, cy + Math.sin(a0) * r0, z], [K.x + Math.cos(a1) * r0, cy + Math.sin(a1) * r0, z], [K.x + Math.cos(a1) * r1, cy + Math.sin(a1) * r1, z], [K.x + Math.cos(a0) * r1, cy + Math.sin(a0) * r1, z]], [0, 0, 1], null, [0.95, 0.8, 0.45]);
      }
    };
    goldRing(K.y, 2.45, 2.75);
    goldRing(K.y - 4.6, 1.55, 1.78, 32);
    const clockTex = W.T('clockFace');
    const dialR = 2.5;
    const dial = new THREE.Mesh(new THREE.CircleGeometry(dialR, 48), W.mats('clock'));
    dial.position.set(K.x, K.y, zf + 0.5);
    dial.name = 'world:clockDial';
    (W.extraMeshes ||= []).push(dial);
    if (!clockTex) {
      // fallback: gilded ring + hands
      B.prism('gold', frame(K.x, 0, zf + 0.5, 0), 0, 0, 0.1, K.y - 0.05, K.y + 0.05, { sides: 4 });
    }
    // calendar disc below
    const cal = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32), W.mats('clock'));
    cal.position.set(K.x, K.y - 4.6, zf + 0.5);
    cal.rotation.z = 1.3;
    W.extraMeshes.push(cal);
    // apostle windows + skeleton niche hints
    for (const du of [-1.2, 1.2]) B.quad('dark', [K.x + du - 0.35, K.y + 3.0, zf + 0.47], [K.x + du + 0.35, K.y + 3.0, zf + 0.47], [K.x + du + 0.35, K.y + 3.5, zf + 0.47], [K.x + du - 0.35, K.y + 3.5, zf + 0.47]);
    for (const du of [-3.1, 3.1]) B.box('stone', F, K.x + du - 0.2, K.x + du + 0.2, K.y - 1.6, K.y - 0.2, zf + 0.45, zf + 0.85, { col: SOOT });
    // Old Town Hall wings: hall north of the tower facing the square, house of the minute to the west
    reserveAxis(97, 118, -36, -6);
    reserveAxis(97, 118, -6, -0.5);                    // the little square in front of the clock
    const hallX = L.OTS.x - L.OTS.w / 2 - 0.6;
    W.house(frame(hallX, 0, -25, -Math.PI / 2), 18, hallX - 100, { key: 'fw1', storeys: 3, ruined: false, frontGable: false, roofKey: 'roof', wide: true });
    W.house(frame(104, 0, cz1, Math.PI), 8, cz1 - cz0, { key: 'pl5', storeys: 3, ruined: false, frontGable: true });
  }

  // ===================== Týn church ========================================
  {
    const T0 = L.TYN, F = frame(0, 0, 0, 0);
    const zf = T0.z + 3;                       // front of towers
    reserveAxis(T0.x - 13, T0.x + 13, T0.z - 36, T0.z + 3.2);
    // nave
    B.box('wall', F, T0.x - 9, T0.x + 9, -0.5, 26, zf - 34, zf - 6, { mw: wm, mh: wm, col: [0.55, 0.52, 0.48] });
    B.gable('slate', sub(F, T0.x, 0, zf - 20, Math.PI / 2), -14, 14, -9, 9, 26, 22, { mw: 2, mh: 2 });
    B.polyF('stone', [[T0.x + 9, 26, zf - 6.01], [T0.x - 9, 26, zf - 6.01], [T0.x, 48, zf - 6.01]], [0, 0, 1], [[0, 0], [6, 0], [3, 7]], BLACK);
    solid(T0.x, zf - 18.5, 9.5, 18.5);
    // twin towers
    for (const tx of [T0.x - 6.5, T0.x + 6.5]) {
      stoneBox(F, tx - 3.5, tx + 3.5, -0.5, 46, zf - 7, zf, BLACK);
      gallery(F, tx - 3.5, tx + 3.5, zf - 7, zf, 46.6);
      gothicSpire(F, tx, zf - 3.5, 3.5, 46.6, 80, 'slate', [0.6, 0.6, 0.66]);
      for (let y = 14; y < 42; y += 8) B.quad('dark', [tx - 0.5, y, zf + 0.03], [tx + 0.5, y, zf + 0.03], [tx + 0.5, y + 3, zf + 0.03], [tx - 0.5, y + 3, zf + 0.03]);
      // gilded ball between spires is real; here a tarnished one
    }
    stoneBox(F, T0.x - 3, T0.x + 3, -0.5, 30, zf - 7, zf - 1, BLACK);
    B.spire('stone', F, T0.x, zf - 4, 3, 30, 36, { col: BLACK });
    solid(T0.x, zf - 3.5, 10, 3.5);
  }

  // ===================== Powder Tower ======================================
  {
    const PT = L.POWDER_TOWER;
    // align with Celetná at the tower
    const s = L.STREETS.find((q) => q.name === 'celetna');
    const [ax, az] = s.pts[0], [bx, bz] = s.pts[1];
    const dx = ax - bx, dz = az - bz, len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const t = (PT.x - bx) / dx, cz = bz + dz * t;
    const rot = Math.atan2(-uz, ux);
    const F = frame(PT.x, 0, cz, rot);
    const pass = s.width / 2 + 0.7, hu = 6, hv = 11;
    const ys = 3.4, yA = ys + archRise(pass * 2, 'pointed') + 0.8;
    for (const sg of [-1, 1]) {
      tBox(F, -hu, hu, -0.5, yA, sg > 0 ? pass : -hv, sg > 0 ? hv : -pass);
      const [cx, , czz] = P(F, 0, 0, sg * (pass + hv) / 2);
      solid(cx, czz, hu, (hv - pass) / 2, rot);
    }
    tBox(F, -hu, hu, yA, 44, -hv, hv);
    archway(F, -hu, hu, 0, pass * 2, ys, yA, { kind: 'pointed', key: 'stoneFar', col: TWR, ringCol: [0.42, 0.4, 0.37] });
    solid(PT.x, cz, hu, hv, rot, ys + 1.6, 70);
    for (const u of [-hu - 0.02, hu + 0.02]) {
      const e = u > 0;
      const p = (y, v) => P(F, u, y, v);
      for (let y = 15; y < 40; y += 9) for (const v of [-5, 5]) {
        const q = [p(y, v - 0.6), p(y, v + 0.6), p(y + 3.2, v + 0.6), p(y + 3.8, v + 0.35), p(y + 4.1, v), p(y + 3.8, v - 0.35), p(y + 3.2, v - 0.6)];
        B.poly('dark', e ? q.slice().reverse() : q, q.map(() => [0, 0]));
      }
    }
    for (let y = 12; y < 44; y += 10) tBox(F, -hu - 0.25, hu + 0.25, y, y + 0.4, -hv - 0.25, hv + 0.25, [0.4, 0.38, 0.35]);
    gallery(F, -hu, hu, -hv, hv, 44.6, TWR, 'stoneFar');
    B.gable('slateFar', sub(F, 0, 0, 0, Math.PI / 2), -hv, hv, -hu, hu, 44.6, 14, { mw: 2, mh: 2, gkey: 'stoneFar', gcol: TWR, over: 0.2, col: [0.6, 0.6, 0.66] });
    for (const v of [-hv, hv]) for (const u of [-hu, hu]) {
      B.prism('stoneFar', F, u, v, 0.6, 40, 47, { sides: 6, col: TWR });
      B.spire('slateFar', F, u, v, 0.6, 47, 53, { col: [0.6, 0.6, 0.66] });
    }
    B.spire('slateFar', F, 0, 0, 1, 58, 66, { col: [0.6, 0.6, 0.66] });
    // reserve footprint but not the street through it
    stamp(F, -hu - 1, hu + 1, -hv - 1, hv + 1, 2, true);
  }

  // ===================== Pharmacy (LÉKÁRNA) =================================
  {
    const D = L.PHARMACY_DOOR;
    const s = L.STREETS.find((q) => q.name === 'celetna');
    // nearest celetna segment to the door
    let best = null;
    for (let i = 0; i < s.pts.length - 1; i++) {
      const [ax, az] = s.pts[i], [bx, bz] = s.pts[i + 1];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      const tt = Math.max(0, Math.min(1, ((D.x - ax) * dx + (D.z - az) * dz) / L2));
      const qx = ax + dx * tt, qz = az + dz * tt, d = Math.hypot(D.x - qx, D.z - qz);
      if (!best || d < best.d) best = { d, qx, qz, dx: dx / Math.sqrt(L2), dz: dz / Math.sqrt(L2) };
    }
    // n = from street towards the door side
    let nx = -best.dz, nz = best.dx;
    if ((D.x - best.qx) * nx + (D.z - best.qz) * nz < 0) { nx = -nx; nz = -nz; }
    const off = s.width / 2 + 0.6;
    const dd = (D.x - best.qx) * nx + (D.z - best.qz) * nz;
    const ox = D.x + nx * (off - dd), oz = D.z + nz * (off - dd);
    const rot = Math.atan2(nx, nz);
    const F = frame(ox, H(ox, oz), oz, rot);
    const w = 12, d = 14;
    stamp(F, -w / 2, w / 2, 0, d, 4);
    W.house(F, w, d, { key: 'pl3', storeys: 3, ruined: false, frontGable: false, wide: false });
    // shopfront: one dark-green backboard carrying the sign, a recessed door in a deep stone
    // frame, boarded windows. Everything sits on the wall or on a bracket — nothing floats.
    const GRN = [0.11, 0.22, 0.14];
    B.box('stoneLight', F, -5.5, 5.5, 0, 0.45, -0.3, 0, { mw: sm, mh: sm, col: [0.62, 0.6, 0.56], skip: 'bottom,back' });   // sill plinth
    B.box('paint', F, -5.3, 5.3, 2.95, 4.1, -0.24, 0, { col: GRN, skip: 'bottom,back' });
    B.box('paint', F, -5.4, 5.4, 4.1, 4.22, -0.32, 0, { col: [0.08, 0.14, 0.1], skip: 'back' });
    B.quad('sign', P(F, 2.1, 3.0, -0.25), P(F, -2.1, 3.0, -0.25), P(F, -2.1, 4.05, -0.25), P(F, 2.1, 4.05, -0.25), [[0, 0], [1, 0], [1, 1], [0, 1]]);
    for (const cu of [-4.1, 4.1]) for (const [a, b, c, d] of [[-0.11, 0.11, -0.36, 0.36], [-0.36, 0.36, -0.11, 0.11]]) B.box('paint', F, cu + a, cu + b, 3.52 + c, 3.52 + d, -0.29, -0.24, { col: [0.3, 0.7, 0.35], skip: 'back' });
    // door: deep jambs + lintel stand proud of the wall so the door reads as recessed
    const DJ = [0.66, 0.63, 0.58];
    for (const sg of [-1, 1]) {
      B.box('stoneLight', F, sg < 0 ? -1.4 : 0.95, sg < 0 ? -0.95 : 1.4, 0, 2.95, -0.42, 0, { mw: sm, mh: sm, col: DJ, skip: 'bottom,back' });
      B.quad('dark', P(F, sg * 0.95, 0, -0.42), P(F, sg * 0.95, 0, 0), P(F, sg * 0.95, 2.6, 0), P(F, sg * 0.95, 2.6, -0.42));
    }
    B.box('stoneLight', F, -1.4, 1.4, 2.6, 2.95, -0.42, 0, { mw: sm, mh: sm, col: DJ, skip: 'back' });
    B.box('paint', F, -0.95, 0.95, 0, 2.6, -0.04, 0, { col: GRN.map((c) => c * 0.8), skip: 'bottom,back' });
    B.box('paint', F, -0.8, -0.05, 1.5, 2.4, -0.07, -0.04, { col: [0.15, 0.27, 0.18], skip: 'back' });
    B.box('paint', F, 0.05, 0.8, 1.5, 2.4, -0.07, -0.04, { col: [0.15, 0.27, 0.18], skip: 'back' });
    B.box('dark', F, -0.7, -0.15, 1.6, 2.3, -0.08, -0.07, { col: [1, 1, 1], skip: 'back' });
    B.box('metal', F, 0.55, 0.65, 1.1, 1.2, -0.13, -0.04, {});
    B.box('stone', F, -1.3, 1.3, 0, 0.12, -0.75, -0.42, { mw: sm, mh: sm, col: [0.5, 0.48, 0.45] });   // worn step
    for (const u of [-3.3, 3.3]) {
      B.box('stoneLight', F, u - 1.5, u + 1.5, 0.45, 2.85, -0.12, 0, { mw: sm, mh: sm, col: DJ, skip: 'bottom,back' });
      B.box('dark', F, u - 1.3, u + 1.3, 0.6, 2.7, -0.14, -0.12, { skip: 'bottom,back' });
      for (let k = 0; k < 3; k++) {
        const Fb = sub(F, u, 1.0 + k * 0.6, -0.2, (k - 1) * 0.04);
        B.box('plank', Fb, -1.45, 1.45, -0.12, 0.12, -0.04, 0.03, { mw: 1, mh: 2, col: [1.4, 1.3, 1.2] });
      }
    }
    // hanging sign on a wall bracket beyond the board
    const su = -5.75;
    B.box('metal', F, su - 0.1, su + 0.1, 3.7, 4.7, -0.06, 0, {});                 // wall plate
    B.box('metal', F, su - 0.03, su + 0.03, 4.55, 4.62, -1.45, 0, {});             // arm
    B.box('metal', F, su - 0.02, su + 0.02, 4.0, 4.6, -0.04, 0, {});
    const sw = 1.2, sh = sw * 0.25, sy = 4.45;
    const sq = (du) => (y, v) => P(F, su + du, y, v);
    const pa = sq(0.03), pb = sq(-0.03);
    for (const v of [-0.2, -0.2 - sw]) B.box('metal', F, su - 0.01, su + 0.01, sy, 4.56, v - 0.01, v + 0.01, {});   // chains
    B.quad('sign', pa(sy - sh, -0.2), pa(sy - sh, -0.2 - sw), pa(sy, -0.2 - sw), pa(sy, -0.2), [[0, 0], [1, 0], [1, 1], [0, 1]]);
    B.quad('sign', pb(sy - sh, -0.2 - sw), pb(sy - sh, -0.2), pb(sy, -0.2), pb(sy, -0.2 - sw), [[0, 0], [1, 0], [1, 1], [0, 1]]);
    B.box('metal', F, su - 0.03, su + 0.03, sy - sh - 0.03, sy + 0.02, -0.23 - sw, -0.17, { skip: 'left,right' });
    // dead lantern on a short bracket beside the door
    B.box('metal', F, 1.75, 1.85, 2.3, 2.38, -0.4, 0, {});
    B.box('metal', F, 1.65, 1.95, 1.9, 2.3, -0.55, -0.3, {});
    B.box('glass', F, 1.68, 1.92, 1.95, 2.25, -0.53, -0.32, {});
    W.lamps.push(new THREE.Vector3(...P(F, 1.8, 2.1, -0.42)));
    out.pharmacy = { F };
  }

  // ===================== St Nicholas (Malá Strana) ==========================
  {
    const s = L.STREETS.find((q) => q.name === 'tomasska');
    const [ax, az] = s.pts[0], [bx, bz] = s.pts[1];
    const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
    let nx = dz, nz = -dx;                       // east of the street
    if (nx < 0) { nx = -nx; nz = -nz; }
    const off = s.width / 2 + 0.7;
    const rot = Math.atan2(nx, nz);
    const F = frame(ax + nx * off, 0, az + nz * off, rot);
    // check: local u must run along the street (towards b)
    const uDir = [Math.cos(rot), -Math.sin(rot)];
    const sgnU = uDir[0] * dx + uDir[1] * dz > 0 ? 1 : -1;
    const U = (u) => u * sgnU;
    const u0 = U(3), u1 = U(38), lo = Math.min(u0, u1), hi = Math.max(u0, u1);
    const nave = { lo, hi, v0: 0, v1: 20 };
    stamp(F, lo - 1, hi + 1, -0.5, 22, 2);
    const col = [0.85, 0.8, 0.7];
    W.facadeWalls('wall', F, lo, hi, nave.v0, nave.v1, [[-0.5, 20, -0.5, 20]], { col });
    void wm;
    // pilasters
    for (let u = lo + 2; u < hi; u += 4) B.box('stone', F, u - 0.35, u + 0.35, 0, 19, -0.25, 0, { col: [0.6, 0.57, 0.52], skip: 'bottom,back' });
    for (let k = 0; k < 2; k++) for (let u = lo + 4; u < hi - 2; u += 4) {
      const y = 4 + k * 8;
      B.quad('dark', P(F, u + 0.7, y, -0.03), P(F, u - 0.7, y, -0.03), P(F, u - 0.7, y + 4, -0.03), P(F, u + 0.7, y + 4, -0.03));
    }
    stoneBox(F, lo - 0.3, hi + 0.3, 19.4, 20.4, -0.4, nave.v1 + 0.4, [0.62, 0.58, 0.52]);
    B.gable('copper', F, lo, hi, nave.v0, nave.v1, 20.4, 7, { mw: 3, mh: 3, gkey: 'wall', gcol: col });
    const [cx, , cz] = P(F, (lo + hi) / 2, 0, 10);
    solid(cx, cz, (hi - lo) / 2, 10, rot);
    // the dome over the crossing
    const du = U(14);
    B.prism('wall', F, du, 10, 8.2, 24, 32, { sides: 16, col, mw: 4 });
    for (let i = 0; i < 16; i += 2) {
      const a = (i / 16) * Math.PI * 2;
      const wu = du + Math.cos(a) * 8.25, wv = 10 + Math.sin(a) * 8.25;
      const tu = -Math.sin(a) * 0.6, tv = Math.cos(a) * 0.6;
      B.quad('dark', P(F, wu + tu, 26, wv + tv), P(F, wu - tu, 26, wv - tv), P(F, wu - tu, 30, wv - tv), P(F, wu + tu, 30, wv + tv));
    }
    B.prism('stone', F, du, 10, 8.6, 32, 33, { sides: 16, col: [0.6, 0.57, 0.52] });
    B.dome('copper', F, du, 10, 8.3, 33, { sides: 20, rings: 7, k: 1.35 });
    B.prism('wall', F, du, 10, 1.6, 33 + 8.3 * 1.35 - 0.5, 33 + 8.3 * 1.35 + 3.2, { sides: 8, col });
    B.dome('copper', F, du, 10, 1.9, 33 + 8.3 * 1.35 + 3.2, { sides: 8, rings: 3, k: 1 });
    B.spire('copper', F, du, 10, 0.3, 33 + 8.3 * 1.35 + 5, 33 + 8.3 * 1.35 + 8, { sides: 6 });
    // belfry near the square
    const bu = U(6), bv = 15;
    B.box('wall', F, bu - 3.5, bu + 3.5, -0.5, 38, bv - 3.5, bv + 3.5, { mw: 4, mh: 4, col });
    for (let y = 22; y < 36; y += 7) B.quad('dark', P(F, bu + 0.8, y, bv - 3.53), P(F, bu - 0.8, y, bv - 3.53), P(F, bu - 0.8, y + 4, bv - 3.53), P(F, bu + 0.8, y + 4, bv - 3.53));
    stoneBox(F, bu - 3.8, bu + 3.8, 38, 39, bv - 3.8, bv + 3.8, [0.6, 0.57, 0.52]);
    B.dome('copper', F, bu, bv, 3.6, 39, { sides: 12, rings: 4, k: 1.2 });
    B.prism('copper', F, bu, bv, 0.9, 43, 45, { sides: 8 });
    B.spire('copper', F, bu, bv, 0.9, 45, 50, { sides: 8 });
  }

  // ===================== Castle: walls, gate, St Vitus ======================
  {
    const C = L.CASTLE, G = L.CASTLE_GATE, top = L.HILL.height;
    const F = frame(0, top, 0, 0);
    const th = 2.5, wh = 10;
    const gz0 = G.z - G.width / 2 - 0.6, gz1 = G.z + G.width / 2 + 0.6;
    const runs = [
      [C.x0, C.x1, C.z0, C.z0 + th],                   // north
      [C.x0, C.x1, C.z1 - th, C.z1],                   // south
      [C.x0, C.x0 + th, C.z0, C.z1],                   // west
      [C.x1 - th, C.x1, C.z0, gz0],                    // east, north of gate
      [C.x1 - th, C.x1, gz1, C.z1],                    // east, south of gate
    ];
    const WC = [0.82, 0.79, 0.73], SL = [0.78, 0.75, 0.69];
    for (const [x0, x1, z0, z1] of runs) {
      B.box('wall', F, x0, x1, -3, wh, z0, z1, { mw: wm, mh: wm, col: WC });
      B.box('stone', F, x0 - 0.3, x1 + 0.3, -3, 1.2, z0 - 0.3, z1 + 0.3, { mw: sm, mh: sm, col: BLACK, skip: 'bottom,top' });
      solid((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2);
      reserveAxis(x0, x1 - 0.05, z0, z1 - 0.05);
      // Baroque coping instead of crenellations: string course + moulded cornice
      B.box('stoneLight', F, x0 - 0.15, x1 + 0.15, wh - 2.4, wh - 2.1, z0 - 0.15, z1 + 0.15, { mw: sm, mh: sm, col: SL, skip: 'bottom,top' });
      B.box('stoneLight', F, x0 - 0.35, x1 + 0.35, wh - 0.1, wh + 0.35, z0 - 0.35, z1 + 0.35, { mw: sm, mh: sm, col: SL });
      B.box('stoneLight', F, x0 - 0.15, x1 + 0.15, wh + 0.35, wh + 0.6, z0 - 0.15, z1 + 0.15, { mw: sm, mh: sm, col: [0.7, 0.67, 0.62] });
    }
    // ---- the gate: a Baroque triumphal portal after the Matthias Gate --------------------
    {
      const xb = C.x1 - 4, xf = C.x1 + 2.5, zA = gz0 - 5, zB = gz1 + 5, w = gz1 - gz0, ys = 4.6;
      const yA = ys + w / 2 + 0.7, yC = wh + 2.6;            // arch crown → body, cornice
      const wb = (u0, u1, y0, y1, v0, v1, col = WC, skip = 'bottom') => B.box('wall', F, u0, u1, y0, y1, v0, v1, { mw: wm, mh: wm, col, skip, fit: false });
      const lb = (u0, u1, y0, y1, v0, v1, col = SL, skip = 'bottom') => B.box('stoneLight', F, u0, u1, y0, y1, v0, v1, { mw: sm, mh: sm, col, skip });
      for (const [z0, z1] of [[zA, gz0], [gz1, zB]]) {
        wb(xb, xf, -3, yC, z0, z1);
        lb(xb - 0.2, xf + 0.2, -3, 1.4, z0 - 0.2, z1 + 0.2, [0.6, 0.58, 0.54], 'bottom');      // rusticated plinth
        for (let y = 1.4; y < ys; y += 0.6) lb(xf, xf + 0.1, y + 0.05, y + 0.55, z0 + 0.1, z1 - 0.1, [0.74, 0.71, 0.66], 'bottom,back');
        solid(C.x1 - 0.75, (z0 + z1) / 2, 3.25, (z1 - z0) / 2, 0, top - 3, top + 30);
      }
      wb(xb, xf, yA, yC, gz0, gz1);
      archway(F, xb, xf, G.z, w, ys, yA, { kind: 'round', key: 'wall', col: WC, m: wm, ringKey: 'stoneLight', ringCol: SL, ring: 0.7, y0: 1.4, vaultCol: [0.55, 0.53, 0.5] });
      solid(C.x1 - 0.75, G.z, 3.25, w / 2, 0, top + ys + 1.6, top + yC + 6);
      // paired pilasters on the outer face, with capitals
      for (const zc of [gz0 - 1.1, gz0 - 3.7, gz1 + 1.1, gz1 + 3.7]) {
        lb(xf, xf + 0.45, 1.4, yC - 1.4, zc - 0.5, zc + 0.5);
        lb(xf, xf + 0.6, yC - 1.6, yC - 1.2, zc - 0.65, zc + 0.65, [0.7, 0.67, 0.62]);
        lb(xb - 0.45, xb, 1.4, yC - 1.4, zc - 0.5, zc + 0.5);
      }
      // niches between the pilasters
      for (const zc of [gz0 - 2.4, gz1 + 2.4]) {
        const y0 = 4, y1 = 7.6, x = xf + 0.02;
        B.polyF('dark', [[x, y0 + top, zc - 0.55], [x, y0 + top, zc + 0.55], [x, y1 + top, zc + 0.55], ...Array.from({ length: 5 }, (_, i) => { const t = (i + 1) / 6 * Math.PI; return [x, y1 + top + Math.sin(t) * 0.55, zc + Math.cos(t) * 0.55]; }), [x, y1 + top, zc - 0.55]], [1, 0, 0], null, [1.3, 1.3, 1.3]);
      }
      // entablature: architrave, frieze, projecting cornice
      lb(xb - 0.25, xf + 0.25, yC - 1.4, yC - 0.9, zA - 0.25, zB + 0.25, [0.7, 0.67, 0.62]);
      wb(xb - 0.1, xf + 0.1, yC - 0.9, yC - 0.1, zA - 0.1, zB + 0.1, [0.86, 0.83, 0.77]);
      lb(xb - 0.7, xf + 0.7, yC - 0.1, yC + 0.45, zA - 0.7, zB + 0.7, SL);
      // attic with a dark inscription tablet, crowned by a second cornice
      const aA = gz0 - 2.2, aB = gz1 + 2.2;
      wb(xb + 0.6, xf - 0.2, yC + 0.45, yC + 3.2, aA, aB, [0.84, 0.81, 0.75]);
      B.quad('dark', [xf - 0.17, top + yC + 1.0, aB - 1.4], [xf - 0.17, top + yC + 1.0, aA + 1.4], [xf - 0.17, top + yC + 2.6, aA + 1.4], [xf - 0.17, top + yC + 2.6, aB - 1.4], null, [1.4, 1.35, 1.2]);
      lb(xb + 0.3, xf + 0.1, yC + 3.2, yC + 3.6, aA - 0.3, aB + 0.3, SL);
      // volutes sweeping down from the attic, and trophies over each pilaster pair
      for (const sg of [-1, 1]) {
        const zc = sg < 0 ? aA : aB;
        for (let i = 0; i < 4; i++) lb(xb + 0.8, xf - 0.4, yC + 0.45, yC + 2.8 - i * 0.65, zc + sg * i * 0.35, zc + sg * (i + 1) * 0.35, [0.74, 0.71, 0.66]);
      }
      for (const zc of [gz0 - 2.4, gz1 + 2.4, zA + 0.6, zB - 0.6]) {
        const xm = xf - 0.6;
        lb(xm - 0.55, xm + 0.55, yC + 0.45, yC + 1.6, zc - 0.55, zc + 0.55, [0.7, 0.67, 0.62]);
        lb(xm - 0.7, xm + 0.7, yC + 1.6, yC + 1.8, zc - 0.7, zc + 0.7, SL);
        // trophy: armour block, shield, crossed staves, ball finial
        B.box('stone', F, xm - 0.35, xm + 0.35, yC + 1.8, yC + 2.9, zc - 0.32, zc + 0.32, { mw: sm, mh: sm, col: [0.4, 0.38, 0.35] });
        B.box('stone', F, xm + 0.3, xm + 0.42, yC + 1.95, yC + 2.75, zc - 0.5, zc + 0.5, { mw: sm, mh: sm, col: [0.45, 0.43, 0.4] });
        for (const d of [-1, 1]) B.box('stone', sub(F, xm, 0, zc, d * 0.5), -0.05, 0.05, yC + 1.8, yC + 3.8, -0.05, 0.05, { col: [0.35, 0.33, 0.3] });
        B.prism('stone', F, xm, zc, 0.22, yC + 2.9, yC + 3.3, { sides: 8, r1: 0.3, col: [0.42, 0.4, 0.37] });
        B.dome('stone', F, xm, zc, 0.3, yC + 3.3, { sides: 8, rings: 3, col: [0.42, 0.4, 0.37] });
      }
      // two flagpoles with tattered flags
      for (const zc of [aA + 0.4, aB - 0.4]) {
        B.prism('metal', F, xf - 1, zc, 0.06, yC + 3.6, yC + 10, { sides: 5 });
        B.quad('cloth3', [xf - 1, top + yC + 9.8, zc], [xf - 1, top + yC + 8.4, zc], [xf - 3.2, top + yC + 8.6, zc + 0.1], [xf - 3.0, top + yC + 9.9, zc + 0.15], [[0, 1], [0, 0], [3, 0], [3, 1]]);
      }
    }
    // forecourt outside the gate (Hradčanské náměstí) stays open
    reserveAxis(C.x1 + 0.5, C.x1 + 16, G.z - 18, G.z + 18);

    // ---- St Vitus, north of the castle walls -----------------------------------------
    // Gothic cathedral silhouette: tall clerestory nave over low aisles with flying
    // buttresses, a chevet apse, twin west spires and the great south tower with its
    // green copper helmet. Far-fog materials so it reads from the bridge and the quay.
    const vz = C.z0 - 18, vx0 = C.x0 + 12, vx1 = C.x1 - 14;
    reserveAxis(C.x0 - 10, C.x1 + 4, C.z0 - 34, C.z0 - 0.5);
    const Fv = frame(0, top - 1, 0, 0);
    const SV = [0.3, 0.29, 0.28], SV2 = [0.38, 0.36, 0.34];
    const vb = (u0, u1, y0, y1, v0, v1, col = SV, skip = 'bottom') => B.box('stoneFar', Fv, u0, u1, y0, y1, v0, v1, { mw: sm, mh: sm, col, skip });
    const nh = 34, ah = 17, hw = 7, aw = 12;
    vb(vx0, vx1, -2, nh, vz - hw, vz + hw);                         // clerestory nave
    for (const sg of [-1, 1]) {                                       // aisles
      vb(vx0 + 2, vx1 - 4, -2, ah, sg < 0 ? vz - aw : vz + hw, sg < 0 ? vz - hw : vz + aw, SV2);
      B.gable('slateFar', Fv, vx0 + 2, vx1 - 4, sg < 0 ? vz - aw : vz + hw, sg < 0 ? vz - hw : vz + aw, ah, 2.5, { mw: 2, mh: 2, col: [0.42, 0.44, 0.44] });
    }
    B.gable('slateFar', Fv, vx0, vx1, vz - hw, vz + hw, nh, 14, { mw: 2, mh: 2, col: [0.38, 0.4, 0.4], gkey: 'stoneFar', gcol: SV });
    solid((vx0 + vx1) / 2, vz, (vx1 - vx0) / 2, aw);
    // buttress piers with pinnacles + flying buttresses to the clerestory
    for (let x = vx0 + 6; x < vx1 - 4; x += 5.5) {
      for (const sg of [-1, 1]) {
        const zo = vz + sg * (aw + 1.2);
        vb(x - 0.7, x + 0.7, -2, ah + 7, Math.min(zo, zo - sg * 2.4), Math.max(zo, zo - sg * 2.4), SV);
        B.spire('slateFar', Fv, x, zo - sg * 1.2, 0.75, ah + 7, ah + 12.5, { col: [0.35, 0.36, 0.36] });
        // flyer: a sloping slab from the pier top to the nave wall
        const y0 = ah + 6, y1 = nh - 4, za = zo - sg * 1.2, zb = vz + sg * hw;
        for (const [xa, xc] of [[x - 0.3, x + 0.3]]) {
          const pa = (xx, y, z) => [xx, y + top - 1, z];
          B.polyF('stoneFar', [pa(xa, y0, za), pa(xa, y1, zb), pa(xa, y1 + 1.1, zb), pa(xa, y0 + 1.6, za)], [-1, 0, 0], null, SV);
          B.polyF('stoneFar', [pa(xc, y0, za), pa(xc, y1, zb), pa(xc, y1 + 1.1, zb), pa(xc, y0 + 1.6, za)], [1, 0, 0], null, SV);
          B.polyF('stoneFar', [pa(xa, y0 + 1.6, za), pa(xc, y0 + 1.6, za), pa(xc, y1 + 1.1, zb), pa(xa, y1 + 1.1, zb)], [0, 1, sg], null, SV);
          B.polyF('stoneFar', [pa(xa, y0, za), pa(xc, y0, za), pa(xc, y1, zb), pa(xa, y1, zb)], [0, -1, -sg], null, SV);
        }
        // tall clerestory lancets and aisle windows
        const zz = vz + sg * (hw + 0.04), xs = x + 2.75;
        if (xs < vx1 - 2) {
          const q = [[xs - 1.1, ah + 3, zz], [xs + 1.1, ah + 3, zz], [xs + 1.1, nh - 4, zz], [xs + 0.6, nh - 2.7, zz], [xs, nh - 2.2, zz], [xs - 0.6, nh - 2.7, zz], [xs - 1.1, nh - 4, zz]];
          B.polyF('dark', q.map((p) => [p[0], p[1] + top - 1, p[2]]), [0, 0, sg]);
          const za2 = vz + sg * (aw + 0.04);
          const q2 = [[xs - 0.8, 4, za2], [xs + 0.8, 4, za2], [xs + 0.8, ah - 4, za2], [xs, ah - 2.8, za2], [xs - 0.8, ah - 4, za2]];
          B.polyF('dark', q2.map((p) => [p[0], p[1] + top - 1, p[2]]), [0, 0, sg]);
        }
      }
    }
    // chevet: polygonal apse with radiating buttress spikes and a conical roof
    B.prism('stoneFar', Fv, vx1, vz, hw + 0.2, -2, nh, { sides: 10, col: SV, mw: sm });
    B.spire('slateFar', Fv, vx1, vz, hw + 0.6, nh, nh + 12, { sides: 10, col: [0.38, 0.4, 0.4] });
    for (let i = 0; i < 6; i++) {
      const t = -Math.PI / 2 + (i + 0.5) / 6 * Math.PI, bx = vx1 + Math.cos(t) * (hw + 3), bz = vz + Math.sin(t) * (hw + 3);
      B.prism('stoneFar', Fv, bx, bz, 0.8, -2, ah + 6, { sides: 4, col: SV });
      B.spire('slateFar', Fv, bx, bz, 0.8, ah + 6, ah + 12, { sides: 4, col: [0.35, 0.36, 0.36] });
    }
    // copper flèche over the crossing
    const cxr = (vx0 + vx1) / 2 + 4;
    B.prism('copperFar', Fv, cxr, vz, 1.4, nh + 12, nh + 17, { sides: 8, r1: 1.0 });
    B.spire('copperFar', Fv, cxr, vz, 1.0, nh + 17, nh + 32, { sides: 8 });
    // twin west towers with open-work Gothic spires
    for (const sz of [vz - hw + 1, vz + hw - 1]) {
      vb(vx0 - 8, vx0 + 0.5, -2, 60, sz - 4, sz + 4);
      for (const [x, z] of [[vx0 - 8, sz - 4], [vx0 + 0.5, sz - 4], [vx0 + 0.5, sz + 4], [vx0 - 8, sz + 4]]) vb(x - 0.6, x + 0.6, -2, 56, z - 0.6, z + 0.6, SV2);
      for (let y = 26; y < 56; y += 10) B.polyF('dark', [[vx0 - 8.04, y + top - 1, sz - 0.9], [vx0 - 8.04, y + top - 1, sz + 0.9], [vx0 - 8.04, y + top + 5, sz + 0.9], [vx0 - 8.04, y + top + 6.4, sz], [vx0 - 8.04, y + top + 5, sz - 0.9]], [-1, 0, 0]);
      gallery(Fv, vx0 - 8, vx0 + 0.5, sz - 4, sz + 4, 60.6, SV, 'stoneFar');
      gothicSpire(Fv, vx0 - 3.75, sz, 3.6, 60.6, 98, 'slateFar', [0.36, 0.37, 0.38]);
    }
    vb(vx0 - 8, vx0 + 0.5, -2, 40, vz - hw + 3, vz + hw - 3, SV);     // west front between the towers
    B.polyF('dark', Array.from({ length: 14 }, (_, i) => { const t = (i / 14) * Math.PI * 2; return [vx0 - 8.04, top - 1 + 28 + Math.sin(t) * 3.2, vz + Math.cos(t) * 3.2]; }), [-1, 0, 0]);   // rose window
    solid(vx0 - 3.75, vz, 4.25, hw + 3);
    // great south tower: Gothic shaft, Renaissance gallery, green copper helmet + lantern
    const tx = (vx0 + vx1) / 2 + 10, tz = vz + aw + 4;
    reserveAxis(tx - 7, tx + 7, tz - 7, tz + 6.5);
    vb(tx - 6, tx + 6, -2, 62, tz - 6, tz + 5.5);
    for (const [x, z] of [[tx - 6, tz + 5.5], [tx + 6, tz + 5.5]]) vb(x - 0.8, x + 0.8, -2, 56, z - 0.8, z + 0.8, SV2);
    B.polyF('dark', [[tx - 1.4, top + 30, tz + 5.54], [tx + 1.4, top + 30, tz + 5.54], [tx + 1.4, top + 52, tz + 5.54], [tx, top + 55, tz + 5.54], [tx - 1.4, top + 52, tz + 5.54]], [0, 0, 1]);
    gallery(Fv, tx - 6, tx + 6, tz - 6, tz + 5.5, 62.6, SV2, 'stoneFar');
    B.prism('stoneFar', Fv, tx, tz, 4.8, 62.6, 70, { sides: 8, col: SV, mw: sm });
    for (let i = 0; i < 8; i++) {
      const t = (i + 0.5) / 8 * Math.PI * 2;
      B.polyF('dark', [[tx + Math.cos(t) * 4.85 - Math.sin(t) * 0.7, top + 63.5, tz + Math.sin(t) * 4.85 + Math.cos(t) * 0.7], [tx + Math.cos(t) * 4.85 + Math.sin(t) * 0.7, top + 63.5, tz + Math.sin(t) * 4.85 - Math.cos(t) * 0.7], [tx + Math.cos(t) * 4.85 + Math.sin(t) * 0.7, top + 67.5, tz + Math.sin(t) * 4.85 - Math.cos(t) * 0.7], [tx + Math.cos(t) * 4.85 - Math.sin(t) * 0.7, top + 67.5, tz + Math.sin(t) * 4.85 + Math.cos(t) * 0.7]], [Math.cos(t), 0, Math.sin(t)]);
    }
    B.dome('copperFar', Fv, tx, tz, 5.4, 70, { sides: 14, rings: 5, k: 1.15 });
    B.prism('copperFar', Fv, tx, tz, 2.0, 76, 79, { sides: 8, r1: 1.7 });
    B.dome('copperFar', Fv, tx, tz, 2.3, 79, { sides: 10, rings: 4, k: 1.3 });
    B.prism('copperFar', Fv, tx, tz, 0.8, 81.8, 84, { sides: 8, r1: 0.6 });
    B.dome('copperFar', Fv, tx, tz, 1.0, 84, { sides: 8, rings: 3, k: 1.4 });
    B.spire('copperFar', Fv, tx, tz, 0.35, 85.3, 96, { sides: 6 });
    B.box('gold', Fv, tx - 0.15, tx + 0.15, 94, 95, tz - 0.6, tz + 0.6, { col: [0.7, 0.6, 0.35] });
    solid(tx, tz, 6, 5.75);
  }

  return out;
}
