// Apocalypse dressing: wrecked Škodas, a derailed tram, barricades, the army checkpoint,
// rubble, dead lamps, paper, luggage, blood, laundry, posters, the castle camp (tents,
// burning barrels, survivors). Static stuff is batched; fires flicker via InstancedMesh.
import { Batches } from './geom.js';

export function buildProps(W, landmarks) {
  const { B, L, H, frame, sub, P, solid, THREE, mats } = W;
  const R = L.rng(9001);
  const ri = (a, b) => a + R() * (b - a);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const extra = (W.extraMeshes ||= []);
  void landmarks;

  // ---------- street sampling ----------
  const streets = Object.fromEntries(L.STREETS.map((s) => {
    const segs = [];
    let tot = 0;
    for (let i = 0; i < s.pts.length - 1; i++) {
      const [ax, az] = s.pts[i], [bx, bz] = s.pts[i + 1], len = Math.hypot(bx - ax, bz - az);
      segs.push({ ax, az, dx: (bx - ax) / len, dz: (bz - az) / len, len, t0: tot });
      tot += len;
    }
    return [s.name, { s, segs, len: tot }];
  }));
  // Point on street at arc length t, lateral offset lat (positive = left of travel).
  function at(name, t, lat = 0) {
    const S = streets[name];
    let g = S.segs[S.segs.length - 1];
    for (const q of S.segs) if (t <= q.t0 + q.len) { g = q; break; }
    const tt = t - g.t0;
    const nx = -g.dz, nz = g.dx;
    const x = g.ax + g.dx * tt + nx * lat, z = g.az + g.dz * tt + nz * lat;
    return { x, z, y: H(x, z), dx: g.dx, dz: g.dz, nx, nz, rot: Math.atan2(-g.dz, g.dx), w: S.s.width };
  }
  // frame whose local u runs along the street (rot so that u = (dx, dz))
  const streetFrame = (p, drot = 0) => frame(p.x, p.y, p.z, p.rot + drot);
  // Does an oriented footprint stay out of every *other* street's clear zone?
  function ownStreetOnly(F, hu, hv, name) {
    for (let u = -hu; u <= hu + 1e-6; u += hu) for (let v = -hv; v <= hv + 1e-6; v += hv) {
      const [x, , z] = P(F, u, 0, v);
      if (!L.mustStayClear(x, z, 0.3)) continue;
      const n = L.nearestStreet(x, z);
      if (name === 'plaza') { if (!L.inPlaza(x, z, 0) && n.d < n.street.width / 2 + 0.3) return false; continue; }
      if (L.inPlaza(x, z, 0.5)) return false;
      if (n.street.name !== name && n.d < n.street.width / 2 + 0.3) return false;
    }
    return true;
  }

  // ---------- wrecked Škoda ----------
  const PAINT = [[0.62, 0.55, 0.42], [0.5, 0.18, 0.14], [0.22, 0.3, 0.42], [0.66, 0.64, 0.6], [0.3, 0.38, 0.26], [0.55, 0.42, 0.2]];
  function car(F, o = {}, BB = B) {
    const burned = o.burned ?? R() < 0.45;
    const body = burned ? 'car' : 'paint';
    const c = burned ? [0.35, 0.3, 0.27] : pick(PAINT);
    const box = (k, u0, u1, y0, y1, v0, v1, col = c) => BB.box(k, F, u0, u1, y0, y1, v0, v1, { mw: 1.5, mh: 1.5, col });
    box(body, -2.1, 2.1, 0.32, 0.9, -0.8, 0.8);
    box(body, -2.15, -1.6, 0.4, 0.75, -0.82, 0.82);             // bumper-ish nose
    box(burned ? 'char' : 'dark', -0.95, 0.85, 0.9, 1.38, -0.72, 0.72, [1, 1, 1]);
    box(body, -0.9, 0.8, 1.38, 1.44, -0.7, 0.7);
    for (const [u, v] of [[-1.35, -0.72], [-1.35, 0.72], [1.35, -0.72], [1.35, 0.72]]) {
      if (burned && R() < 0.4) continue;
      BB.box('dark', F, u - 0.32, u + 0.32, burned ? 0.02 : 0, burned ? 0.5 : 0.62, v - 0.12, v + 0.12, { col: [0.6, 0.6, 0.6] });
    }
    if (!burned) {
      BB.box('glass', F, 2.1, 2.12, 0.6, 0.78, -0.65, -0.35, {}); BB.box('glass', F, 2.1, 2.12, 0.6, 0.78, 0.35, 0.65, {});
    }
    if (o.door) box(body, -0.4, 0.6, 0.35, 0.95, 0.8, 0.86);
    if (o.collide !== false) {
      const [x, , z] = P(F, 0, 0, 0);
      solid(x, z, 2.15, 0.85, F.rot, -10, 100, true);
    }
  }
  // Car on a street, parked/abandoned along the edge.
  function streetCar(name, t, side, o = {}) {
    const p0 = at(name, t, 0);
    const lat = side * (p0.w / 2 - 1.05);
    const p = at(name, t, lat);
    const F = streetFrame(p, (R() - 0.5) * 0.35 + (R() < 0.5 ? Math.PI : 0));
    if (!ownStreetOnly(F, 2.2, 0.9, name)) return false;
    car(F, o);
    return true;
  }

  // ---------- sandbags, barricades ----------
  function sandbags(F, u0, u1, rows = 3, o = {}) {
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * 0.3;
      for (let u = u0 - off; u < u1 - 0.3; u += 0.62) {
        const a = Math.max(u0, u), b = Math.min(u1, u + 0.6);
        if (b - a < 0.2) continue;
        const y = r * 0.27, k = 0.85 + R() * 0.2;
        B.box('sand', F, a, b, y, y + 0.29, -0.22 - R() * 0.03, 0.22, { mw: 0.5, mh: 0.5, col: [k, k * 0.97, k * 0.9] });
      }
    }
    if (o.collide !== false) {
      const [x, , z] = P(F, (u0 + u1) / 2, 0, 0);
      solid(x, z, (u1 - u0) / 2, 0.25, F.rot, -10, 100, true);
    }
  }
  function stakes(F, u0, u1, v = 0) {
    for (let u = u0; u < u1; u += 0.45) {
      const h = 1.2 + R() * 0.6;
      B.prism('plank', F, u, v + (R() - 0.5) * 0.2, 0.06, 0, h, { sides: 4, mw: 1, mh: 2 });
      B.spire('plank', F, u, v, 0.06, h, h + 0.25, {});
    }
  }
  function plankWall(F, u0, u1, h = 1.8) {
    for (let y = 0.15; y < h; y += 0.32) {
      const Fp = sub(F, 0, y, 0, (R() - 0.5) * 0.08);
      B.box('plank', Fp, u0 - R() * 0.3, u1 + R() * 0.3, 0, 0.26, -0.04, 0.04, { mw: 1, mh: 2, col: [0.7 + R() * 0.3, 0.7, 0.65] });
    }
    for (const u of [u0 + 0.2, u1 - 0.2]) B.box('plank', F, u - 0.06, u + 0.06, 0, h + 0.2, 0.04, 0.16, { mw: 1, mh: 2 });
    const [x, , z] = P(F, (u0 + u1) / 2, 0, 0);
    solid(x, z, (u1 - u0) / 2, 0.2, F.rot, -10, 100, true);
  }
  // Concrete jersey barrier along u.
  function jersey(F, u0, u1) {
    for (let u = u0; u < u1 - 0.5; u += 2.05) {
      const k = 0.7 + R() * 0.15;
      B.box('stone', F, u, u + 2, 0, 0.3, -0.32, 0.32, { mw: 3, mh: 3, col: [k, k, k * 0.95] });
      B.box('stone', F, u, u + 2, 0.3, 0.85, -0.14, 0.14, { mw: 3, mh: 3, col: [k, k, k * 0.95] });
    }
    const [x, , z] = P(F, (u0 + u1) / 2, 0, 0);
    solid(x, z, (u1 - u0) / 2, 0.32, F.rot, -10, 100, true);
  }

  // ---------- rubble ----------
  function rubble(x, z, r, h, o = {}) {
    const y = H(x, z);
    const n = Math.floor(6 + r * r * 3);
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * r;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      const hh = h * (1 - d / (r + 0.01)) * (0.5 + R() * 0.6) + 0.12;
      const s = 0.25 + R() * 0.6;
      const k = 0.45 + R() * 0.35;
      const key = R() < 0.25 ? 'char' : R() < 0.6 ? 'stone' : pick(['pl0', 'pl2', 'pl5', 'roof']);
      B.box(key, frame(px, y, pz, R() * 3), -s, s, -0.1, hh, -s * 0.8, s * 0.8, { mw: 3, mh: 3, col: [k, k * 0.97, k * 0.92] });
    }
    for (let i = 0; i < Math.floor(r * 2); i++) {     // a beam or two
      const F = frame(x + (R() - 0.5) * r, y, z + (R() - 0.5) * r, R() * 3);
      B.box('char', F, -r * 0.8, r * 0.8, h * 0.4, h * 0.4 + 0.18, -0.09, 0.09, {});
    }
    if (o.collide) solid(x, z, r * 0.6, r * 0.6, 0, -10, 100, true);
  }

  // ---------- lamps ----------
  function lampPost(x, z, o = {}) {
    const y = H(x, z), F = frame(x, y, z, o.rot ?? 0);
    if (o.fallen) {
      const Ff = frame(x, y, z, o.rot ?? R() * 6);
      B.box('metal', Ff, 0, 4.2, 0.02, 0.16, -0.08, 0.08, {});
      B.box('metal', Ff, 4.2, 4.7, 0, 0.45, -0.22, 0.22, {});
      return;
    }
    B.prism('metal', F, 0, 0, 0.16, 0, 0.9, { sides: 6, r1: 0.1 });
    B.prism('metal', F, 0, 0, 0.08, 0.9, 4.1, { sides: 6, r1: 0.06 });
    B.box('metal', F, -0.05, 0.05, 3.9, 4.0, -0.05, 0.6, {});
    B.box('glass', F, -0.2, 0.2, 3.55, 3.95, 0.4, 0.8, {});
    B.spire('metal', F, 0, 0.6, 0.25, 3.95, 4.25, {});
    W.lamps.push(new THREE.Vector3(...P(F, 0, 3.7, 0.6)));
    solid(x, z, 0.16, 0.16, 0, -10, 100, true);
  }
  function wallLamp(F, u, y) {
    B.box('metal', F, u - 0.04, u + 0.04, y + 0.45, y + 0.52, -0.75, 0, {});
    B.box('metal', F, u - 0.04, u + 0.04, y, y + 0.5, -0.06, 0, {});
    B.box('glass', F, u - 0.18, u + 0.18, y - 0.1, y + 0.32, -0.92, -0.56, {});
    B.spire('metal', sub(F, 0, 0, 0), u, -0.74, 0.22, y + 0.32, y + 0.55, {});
    W.lamps.push(new THREE.Vector3(...P(F, u, y, -0.74)));
  }

  // ---------- people (survivors) ----------
  function person(F, o = {}) {
    const coat = o.coat || 'cloth' + Math.floor(R() * 6), pants = o.pants || 'cloth' + Math.floor(R() * 6);
    const c = [1, 1, 1], S = o.scale ?? 1.06;
    const bx = (k, u0, u1, y0, y1, v0, v1, col = c) => B.box(k, F, u0 * S, u1 * S, y0 * S, y1 * S, v0 * S, v1 * S, { mw: 0.5, mh: 0.5, col });
    if (o.sit) {
      bx('plank', -0.3, 0.3, 0, 0.42, -0.25, 0.25);
      for (const s of [-1, 1]) {
        bx(pants, s * 0.11 - 0.07, s * 0.11 + 0.07, 0.42, 0.56, -0.5, 0.05);
        bx(pants, s * 0.11 - 0.07, s * 0.11 + 0.07, 0, 0.5, -0.56, -0.42);
      }
      bx(coat, -0.21, 0.21, 0.5, 1.08, -0.12, 0.14);
      bx(coat, -0.3, -0.2, 0.62, 1.04, -0.35, 0.05); bx(coat, 0.2, 0.3, 0.62, 1.04, -0.35, 0.05);
      bx('skin', -0.1, 0.1, 1.12, 1.36, -0.1, 0.1, [0.95, 0.85, 0.8]);
      bx(coat, -0.12, 0.12, 1.3, 1.42, -0.12, 0.13, [0.6, 0.6, 0.6]);
    } else {
      for (const s of [-1, 1]) bx(pants, s * 0.11 - 0.075, s * 0.11 + 0.075, 0, 0.86, -0.09, 0.09);
      bx('dark', -0.2, -0.03, 0, 0.1, -0.16, 0.1); bx('dark', 0.03, 0.2, 0, 0.1, -0.16, 0.1);
      bx(coat, -0.24, 0.24, 0.82, 1.47, -0.15, 0.15);
      bx(coat, -0.27, 0.27, 1.3, 1.47, -0.16, 0.16);                    // shoulders
      bx(coat, -0.12, 0.12, 1.44, 1.52, -0.12, 0.12, [0.8, 0.8, 0.8]);  // collar
      if (o.long) bx(coat, -0.25, 0.25, 0.45, 0.85, -0.16, 0.16);
      bx(coat, -0.36, -0.25, 0.78, 1.44, -0.09, 0.09); bx(coat, 0.25, 0.36, 0.78, 1.44, -0.09, 0.09);
      bx('dark', -0.245, 0.245, 0.86, 0.92, -0.155, 0.155, [0.6, 0.6, 0.6]);   // belt
      bx('skin', -0.35, -0.26, 0.66, 0.78, -0.06, 0.06, [0.95, 0.85, 0.8]); bx('skin', 0.26, 0.35, 0.66, 0.78, -0.06, 0.06, [0.95, 0.85, 0.8]);
      bx('skin', -0.06, 0.06, 1.47, 1.53, -0.05, 0.05, [0.95, 0.85, 0.8]);
      bx('skin', -0.1, 0.1, 1.53, 1.77, -0.11, 0.1, [0.95, 0.85, 0.8]);
      bx(o.hat || 'dark', -0.11, 0.11, 1.72, 1.82, -0.12, 0.12, [0.7, 0.7, 0.7]);
      if (o.rifle) bx('metal', 0.08, 0.14, 0.75, 1.65, 0.14, 0.2);
      if (o.armband) bx('red', 0.245, 0.37, 1.2, 1.3, -0.1, 0.1);
      if (o.bag) bx('olive', -0.18, 0.18, 0.95, 1.4, 0.13, 0.3);
    }
    const [x, , z] = P(F, 0, 0, 0);
    solid(x, z, 0.32, 0.32, 0, -10, 100, true);
  }

  // =====================================================================
  // Main streets: cars, rubble, lamps
  // =====================================================================
  const carsOn = {
    celetna: [[20, 1], [44, -1], [66, 1, { burned: true }], [90, -1]],
    karlova: [[28, 1], [52, -1]],
    mostecka: [[16, 1, { burned: true }], [40, -1, { door: true }]],
    nerudova: [[14, -1], [38, 1, { burned: true }], [62, -1], [92, 1], [112, -1]],
    karmelitska: [[18, 1], [40, -1, { burned: true }]],
    husova: [], kampa: [],
  };
  for (const [name, list] of Object.entries(carsOn)) for (const [t, side, o] of list) streetCar(name, t, side, o || {});

  // rubble in front of gutted houses (collider only where the street is wide enough)
  for (const lot of W.lots) {
    if (!lot.ruined) continue;
    const [fx, , fz] = P(lot.F, 0, 0, -0.2);
    const n = L.nearestStreet(fx, fz);
    if (L.inPlaza(fx, fz, 1)) { rubble(...P(lot.F, (R() - 0.5) * lot.w * 0.5, 0, -1.2).filter((_, i) => i !== 1), 1.6, 1.0, { collide: true }); continue; }
    if (n.street.width >= 6.5) {
      const [x, , z] = P(lot.F, (R() - 0.5) * lot.w * 0.5, 0, -0.9);
      rubble(x, z, 1.3, 0.9, { collide: true });
    } else {
      const [x, , z] = P(lot.F, (R() - 0.5) * lot.w * 0.5, 0, -0.5);
      rubble(x, z, 0.8, 0.35);
    }
  }
  // lamp posts along wider streets and around plazas
  for (const name of ['celetna', 'karlova', 'mostecka', 'nerudova', 'karmelitska']) {
    const S = streets[name];
    let side = 1;
    for (let t = 8; t < S.len - 4; t += 19 + R() * 6) {
      side = -side;
      const p = at(name, t, side * (S.s.width / 2 - 0.35));
      if (!ownStreetOnly(frame(p.x, 0, p.z, 0), 0.3, 0.3, name)) continue;
      lampPost(p.x, p.z, { rot: p.rot + (side > 0 ? Math.PI / 2 : -Math.PI / 2), fallen: R() < 0.15 });
    }
  }
  for (const pz of [L.OTS, L.MS_SQUARE]) {
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0.5], [1, -0.5]]) {
      const px = pz.x + x * (pz.w / 2 - 1.6), pzz = pz.z + z * (pz.d / 2 - 1.6);
      if (Math.abs(pzz - pz.z) < 6 && Math.abs(x) === 1) continue;
      lampPost(px, pzz, { rot: R() * 6, fallen: R() < 0.2 });
    }
  }

  // wall lanterns and posters on house fronts
  let li = 0;
  for (const lot of W.lots) {
    const [fx, , fz] = P(lot.F, 0, 0, -0.5);
    if (fx < L.CASTLE.x1 + 1 && fx > L.CASTLE.x0 - 1 && fz > L.CASTLE.z0 - 1 && fz < L.CASTLE.z1 + 1) continue;
    const n = L.nearestStreet(fx, fz);
    const F = sub(lot.F, 0, 0, 0);
    if (n.street.width < 7 && !L.inPlaza(fx, fz, 1) && (li++ % 3 === 0)) wallLamp(F, (R() < 0.5 ? -1 : 1) * (lot.w / 2 - 0.9), 4.3);
    if (R() < 0.4) {
      const np = 1 + Math.floor(R() * 3);
      const u = (R() - 0.5) * (lot.w - 2.5);
      for (let i = 0; i < np; i++) {
        const uu = u + i * 0.66 + (R() - 0.5) * 0.1, yy = 1.35 + (R() - 0.5) * 0.25;
        B.quad('poster' + Math.floor(R() * 6), P(F, uu + 0.3, yy, -0.04), P(F, uu - 0.3, yy, -0.04), P(F, uu - 0.3, yy + 0.85, -0.04), P(F, uu + 0.3, yy + 0.85, -0.04), [[1, 0], [0, 0], [0, 1], [1, 1]]);
      }
    }
    if (R() < 0.18) {                                   // blood smear on the wall
      const u = (R() - 0.5) * (lot.w - 2), y0 = 0.2 + R() * 0.4, s = 0.6 + R() * 0.8;
      B.quad('blood', P(F, u + s / 2, y0, -0.05), P(F, u - s / 2, y0, -0.05), P(F, u - s / 2, y0 + s * 1.3, -0.05), P(F, u + s / 2, y0 + s * 1.3, -0.05), [[1, 0], [0, 0], [0, 1], [1, 1]]);
    }
  }

  // laundry across the narrow alleys
  for (const name of ['melantrichova', 'zelezna', 'liliova', 'husova', 'tynska', 'retezova', 'tomasska', 'kampa']) {
    const S = streets[name];
    for (let t = 8 + R() * 6; t < S.len - 6; t += 14 + R() * 12) {
      const p = at(name, t, 0);
      const half = S.s.width / 2 + 0.6, y = p.y + 6 + R() * 2.5;
      const F = frame(p.x, y, p.z, p.rot + Math.PI / 2 + (R() - 0.5) * 0.2);
      B.box('wire', F, -half, half, -0.015, 0.015, -0.015, 0.015, {});
      for (let u = -half + 0.4; u < half - 0.5; u += 0.6 + R() * 0.5) {
        const w = 0.4 + R() * 0.45, h = 0.45 + R() * 0.7, k = 'cloth' + Math.floor(R() * 6);
        const sag = -0.15 * (1 - (u / half) ** 2);
        B.quad(k, P(F, u, sag - h, 0), P(F, u + w, sag - h, 0), P(F, u + w, sag, 0), P(F, u, sag, 0), [[0, 0], [w / 0.5, 0], [w / 0.5, h / 0.5], [0, h / 0.5]]);
        u += w;
      }
    }
  }

  // =====================================================================
  // Army checkpoint at the Old Town end of the bridge (Karlova)
  // =====================================================================
  {
    const KL = streets.karlova.len;
    const p1 = at('karlova', KL - 7, 0);
    const F1 = streetFrame(at('karlova', KL - 7, -(p1.w / 2) + 0.05), Math.PI / 2);   // wall across from the north edge
    sandbags(F1, -2.3, 0, 4);
    stakes(sub(F1, 0, 0, 0.6), -2.2, -0.2);
    // truck on the south side
    const pt = at('karlova', KL - 12.5, p1.w / 2 - 1.3);
    const Ft = streetFrame(pt, 0.05);
    const ob = (u0, u1, y0, y1, v0, v1, k = 'olive', col) => B.box(k, Ft, u0, u1, y0, y1, v0, v1, { mw: 1.5, mh: 1.5, col });
    // Praga V3S-ish army truck: chassis, bonnet + cab, plank bed, canvas tarp on hoops
    ob(-3.3, 3.3, 0.55, 0.8, -0.9, 0.9, 'dark', [1, 1, 1]);            // chassis
    ob(2.4, 3.4, 0.8, 1.75, -0.85, 0.85);                             // bonnet
    ob(3.4, 3.46, 0.85, 1.6, -0.6, 0.6, 'dark', [1, 1, 1]);           // grille
    ob(1.3, 2.4, 0.8, 2.55, -1.1, 1.1);                               // cab
    ob(1.32, 2.42, 2.55, 2.65, -1.0, 1.0);                            // cab roof lip
    ob(2.4, 2.42, 1.75, 2.4, -0.95, 0.95, 'glass', [1, 1, 1]);        // windscreen
    for (const v of [-1.11, 1.11]) ob(1.45, 2.2, 1.7, 2.35, v - 0.01, v + 0.01, 'glass', [1, 1, 1]);
    for (const v of [-1.25, 1.25]) ob(2.0, 3.3, 0.9, 1.0, v - 0.15, v + 0.15, 'olive', [0.8, 0.8, 0.8]);   // mudguards
    ob(-3.3, 1.2, 0.8, 1.35, -1.15, 1.15, 'plank', [0.55, 0.6, 0.45]); // bed sides
    // tarp: a rounded canvas hood over hoops, sagging between them
    {
      const n = 7, r = 1.15, yb = 1.35, yh = 1.55, u0 = -3.3, u1 = 1.15;
      const prof = (i, sag) => { const t = Math.PI * (i / n); return [-Math.cos(t) * r, yb + yh * 0.55 + Math.sin(t) * (yh * 0.65 - sag)]; };
      const hoops = [u0, -2.2, -1.1, 0.05, u1];
      for (let h = 0; h < hoops.length - 1; h++) {
        const ua = hoops[h], ub = hoops[h + 1];
        for (let i = 0; i < n; i++) {
          const [va, ya] = prof(i, 0), [vb, yb2] = prof(i + 1, 0), [vc, yc] = prof(i, 0.08), [vd, yd] = prof(i + 1, 0.08);
          const um = (ua + ub) / 2;
          B.polyF('tarp', [P(Ft, ua, ya, va), P(Ft, ua, yb2, vb), P(Ft, um, yd, vd), P(Ft, um, yc, vc)], [0, 1, 0].map((x, j) => (j === 1 ? ya - yb : 0) + (j !== 1 ? 0 : 1)), [[ua, ya], [ua, yb2], [um, yd], [um, yc]].map(([a, b2]) => [a / 1.5, b2 / 1.5]), [1, 1, 1]);
          B.polyF('tarp', [P(Ft, um, yc, vc), P(Ft, um, yd, vd), P(Ft, ub, yb2, vb), P(Ft, ub, ya, va)], [0, 1, 0], [[um, yc], [um, yd], [ub, yb2], [ub, ya]].map(([a, b2]) => [a / 1.5, b2 / 1.5]), [1, 1, 1]);
        }
        for (const sv of [-1, 1]) B.polyF('tarp', [P(Ft, ua, 1.35, sv * r), P(Ft, ub, 1.35, sv * r), P(Ft, ub, yb + yh * 0.55, sv * r), P(Ft, ua, yb + yh * 0.55, sv * r)], [0, 0, 0], [[ua / 1.5, 0.9], [ub / 1.5, 0.9], [ub / 1.5, 1.7], [ua / 1.5, 1.7]], [0.95, 0.95, 0.95]);
      }
      // end flaps
      for (const [u, d] of [[u0, -1], [u1, 1]]) {
        const pts = [P(Ft, u, 1.35, -r), P(Ft, u, 1.35, r)];
        for (let i = n; i >= 0; i--) { const [v, y] = prof(i, 0); pts.push(P(Ft, u, y, v)); }
        B.polyF('tarp', pts, [Ft.c * d, 0, -Ft.s * d], pts.map((p, i) => [i * 0.2, 0]), [0.85, 0.85, 0.85]);
      }
    }
    for (const u of [-2.3, -1.2, 2.6]) for (const v of [-1.0, 1.0]) {
      ob(u - 0.5, u + 0.5, 0, 1.0, v - 0.16, v + 0.16, 'dark', [1, 1, 1]);
      ob(u - 0.18, u + 0.18, 0.32, 0.68, v + Math.sign(v) * 0.16, v + Math.sign(v) * 0.18, 'metal', [1, 1, 1]);
    }
    solid(pt.x, pt.z, 3.3, 1.15, Ft.rot, -10, 100, true);
    // swung-open boom barrier along the south edge
    const pb = at('karlova', KL - 3.5, p1.w / 2 - 0.3);
    const Fb = streetFrame(pb);
    B.box('metal', Fb, -0.12, 0.12, 0, 1.1, -0.12, 0.12, {});
    for (let i = 0; i < 6; i++) B.box(i % 2 ? 'white' : 'red', Fb, 0.1 + i * 0.6, 0.7 + i * 0.6, 0.95, 1.08, -0.05, 0.05, {});
    solid(pb.x, pb.z, 0.15, 0.15, 0, -10, 100, true);
    // guard booth on the north edge
    const pg = at('karlova', KL - 22, -(p1.w / 2) + 0.75);
    const Fg = streetFrame(pg);
    B.box('plank', Fg, -0.7, 0.7, 0, 2.3, -0.7, 0.7, { mw: 1, mh: 2, col: [0.55, 0.6, 0.45] });
    B.box('dark', Fg, -0.5, 0.5, 1.2, 1.8, 0.69, 0.72, {});
    B.box('olive', Fg, -0.85, 0.85, 2.3, 2.45, -0.85, 0.85, {});
    solid(pg.x, pg.z, 0.7, 0.7, Fg.rot, -10, 100, true);
    B.quad('poster2', P(Fg, 0.3, 1.0, 0.72), P(Fg, -0.3, 1.0, 0.72), P(Fg, -0.3, 1.85, 0.72), P(Fg, 0.3, 1.85, 0.72), [[1, 0], [0, 0], [0, 1], [1, 1]]);
    // concertina wire along the north edge (low, no collider)
    const pw = at('karlova', KL - 10, -(p1.w / 2) + 0.35);
    const Fw = streetFrame(pw);
    for (let u = -2.5; u < 4.5; u += 0.35) B.box('wire', sub(Fw, u, 0, 0, (R() - 0.5) * 1.2), -0.25, 0.25, 0.1 + R() * 0.6, 0.13 + R() * 0.6, -0.02, 0.02, {});
    // floodlight on a tripod by the tower
    const pf = at('karlova', KL - 1.5, -(p1.w / 2) + 0.4);
    B.prism('metal', frame(pf.x, pf.y, pf.z, 0), 0, 0, 0.05, 0, 2.6, { sides: 4 });
    B.box('metal', frame(pf.x, pf.y, pf.z, 0.6), -0.35, 0.35, 2.6, 3.0, -0.2, 0.2, {});
    // jersey barriers on the Malá Strana end of the bridge (narrow mostecká to 6 m)
    const pj = at('mostecka', 6, (streets.mostecka.s.width / 2) - 0.45);
    jersey(streetFrame(pj), -3, 3);
  }

  // =====================================================================
  // Old Town Square: evacuation point that failed, Hus memorial
  // =====================================================================
  {
    const O = L.OTS;
    // Hus memorial: a broad stepped granite plinth, the tall robed figure of Hus and two
    // bronze crowds (the defeated warriors / the exiles) flowing off either side.
    const Fh = frame(O.x + 8, 0, O.z - 14, 0);
    const PATINA = [0.4, 0.46, 0.41], DARKB = [0.28, 0.32, 0.3];
    B.box('stone', Fh, -6.2, 6.2, 0, 0.35, -3.1, 3.1, { mw: 3, mh: 3, col: [0.5, 0.48, 0.45] });
    B.box('stone', Fh, -5.6, 5.6, 0.35, 0.75, -2.6, 2.6, { mw: 3, mh: 3, col: [0.55, 0.53, 0.5] });
    B.box('stone', Fh, -5.0, 5.0, 0.75, 1.3, -2.1, 2.1, { mw: 3, mh: 3, col: [0.45, 0.43, 0.4] });
    B.box('stone', Fh, -1.2, 1.2, 1.3, 2.4, -1.0, 1.0, { mw: 3, mh: 3, col: [0.5, 0.48, 0.44] });   // rock under Hus
    const fig = (u, v, y, h, rot, o = {}) => {                      // a robed bronze figure
      const Ff = sub(Fh, u, 0, v, rot), c = o.col || PATINA, r = o.r || 0.32;
      if (o.kneel) {
        B.prism('copper', Ff, 0, 0, r * 1.15, y, y + h * 0.42, { sides: 7, r1: r * 0.8, col: c });
        B.prism('copper', Ff, 0, -0.05, r * 0.8, y + h * 0.42, y + h * 0.7, { sides: 7, r1: r * 0.55, col: c });
        B.prism('copper', Ff, 0, -0.1, r * 0.42, y + h * 0.7, y + h * 0.83, { sides: 6, r1: r * 0.32, col: c, cap: true });
        return;
      }
      B.prism('copper', Ff, 0, 0, r * 1.25, y, y + h * 0.55, { sides: 8, r1: r * 0.9, col: c });          // robe
      B.prism('copper', Ff, 0, 0, r * 0.95, y + h * 0.55, y + h * 0.82, { sides: 8, r1: r * 0.7, col: c }); // chest/shoulders
      B.prism('copper', Ff, 0, 0.02, r * 0.4, y + h * 0.82, y + h * 0.88, { sides: 6, r1: r * 0.36, col: c });
      B.dome('copper', Ff, 0, 0.02, r * 0.42, y + h * 0.88, { sides: 7, rings: 3, k: 1.3, col: c });
      if (o.arm) B.box('copper', sub(Ff, r * 0.85, 0, 0, 0), -0.08, 0.08, y + h * 0.45, y + h * 0.85, -0.08, 0.3, { col: c });
      if (o.staff) B.box('copper', Ff, r + 0.05, r + 0.13, y, y + h * 1.05, -0.04, 0.04, { col: DARKB });
    };
    fig(0, 0, 2.4, 4.4, 0, { r: 0.5, arm: true });                    // Hus
    const GR = L.rng(1415);
    for (const sg of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const u = sg * (1.6 + i * 0.42 + GR() * 0.2), v = (GR() - 0.5) * 2.6;
        const h = (2.6 - i * 0.15) * (0.85 + GR() * 0.25);
        fig(u, v, 1.3, h, (GR() - 0.5) * 1.2, { kneel: GR() < 0.3, staff: GR() < 0.25, col: GR() < 0.5 ? PATINA : DARKB, r: 0.26 + GR() * 0.06 });
      }
    }
    // a mother and child at the east end, a hooded figure leaning on a pike at the west
    fig(4.4, -0.4, 1.3, 2.2, 0.4, { r: 0.3 }); fig(4.0, 0.3, 1.3, 1.2, 0.2, { r: 0.18 });
    fig(-4.5, 0.2, 1.3, 2.4, -0.3, { staff: true, col: DARKB });
    solid(Fh.ox, Fh.oz, 6.2, 3.1, 0, -10, 100, true);
    // military tents in the south-west quarter
    const tent = (x, z, rot, w, d, h, collapsed) => {
      const F = frame(x, H(x, z), z, rot);
      if (!collapsed) {
        B.box('canvas', F, -w / 2, w / 2, 0, h * 0.55, -d / 2, d / 2, { mw: 0.5, mh: 0.5, col: [0.55, 0.6, 0.45], skip: 'bottom,top' });
        B.gable('canvas', F, -w / 2, w / 2, -d / 2, d / 2, h * 0.55, h * 0.45, { over: 0.15, mw: 0.5, mh: 0.5, col: [0.5, 0.55, 0.4], gkey: 'canvas', gmw: 0.5, gcol: [0.5, 0.55, 0.4] });
        B.box('dark', F, -0.6, 0.6, 0, 1.5, -d / 2 - 0.02, -d / 2, {});
      } else {
        B.gable('canvas', F, -w / 2, w / 2, -d / 2, d / 2, 0.1, 0.9, { over: 0.4, mw: 0.5, mh: 0.5, col: [0.45, 0.5, 0.36], gkey: 'canvas', gmw: 0.5, gcol: [0.45, 0.5, 0.36] });
      }
      solid(x, z, w / 2, d / 2, rot, -10, 100, true);
    };
    tent(O.x - 22, O.z + 15, 0.1, 7, 5, 3.2, false);
    tent(O.x - 10, O.z + 19, -0.05, 6, 4.5, 3.0, true);
    tent(O.x - 24, O.z - 16, 0.3, 6, 4.5, 3.0, true);
    // body bags in rows
    for (let i = 0; i < 14; i++) {
      const x = O.x - 27 + (i % 7) * 1.0, z = O.z + 8 + Math.floor(i / 7) * 2.4;
      const F = frame(x + (R() - 0.5) * 0.2, 0, z, Math.PI / 2 + (R() - 0.5) * 0.2);
      B.box('bag', F, -0.95, 0.95, 0, 0.26, -0.3, 0.3, { col: [0.9, 0.9, 0.9] });
      B.box('bag', F, -0.75, 0.75, 0.26, 0.34, -0.2, 0.2, { col: [0.9, 0.9, 0.9] });
    }
    // ambulance (Avia van): grimy white body with a chamfered roof, red stripe, cab glass,
    // dead blue beacons, split rear doors, mud on the sills
    const Fa = frame(O.x - 12, 0, O.z + 11, 0.3);
    const ab = (u0, u1, y0, y1, v0, v1, k = 'white', col = [0.82, 0.8, 0.74]) => B.box(k, Fa, u0, u1, y0, y1, v0, v1, { mw: 1.5, mh: 1.5, col });
    ab(-2.8, 1.75, 0.45, 2.35, -1.05, 1.05);                          // box body
    ab(-2.72, 1.68, 2.35, 2.55, -0.95, 0.95);                         // chamfered roof
    ab(1.75, 2.75, 0.45, 1.25, -1.0, 1.0);                            // nose
    ab(1.75, 2.45, 1.25, 2.25, -1.0, 1.0);                            // cab
    ab(2.45, 2.47, 1.32, 2.12, -0.92, 0.92, 'glass', [1, 1, 1]);      // windscreen
    for (const v of [-1.06, 1.06]) ab(1.85, 2.35, 1.35, 2.05, v - 0.01, v + 0.01, 'glass', [1, 1, 1]);
    ab(-2.82, 2.77, 1.05, 1.28, -1.07, 1.07, 'red', [1, 1, 1]);       // stripe
    for (const v of [-1.08, 1.08]) { ab(-0.6, -0.2, 1.45, 2.15, v - 0.005, v + 0.005, 'red', [1, 1, 1]); ab(-1.05, 0.25, 1.62, 1.98, v - 0.005, v + 0.005, 'red', [1, 1, 1]); }
    ab(-2.83, -2.81, 0.5, 2.3, -0.01, 0.01, 'dark', [1, 1, 1]);       // rear door split
    ab(-2.83, -2.81, 1.5, 2.1, -0.85, -0.15, 'glass', [1, 1, 1]); ab(-2.83, -2.81, 1.5, 2.1, 0.15, 0.85, 'glass', [1, 1, 1]);
    ab(1.6, 1.9, 2.25, 2.4, -0.5, 0.5, 'metal', [0.6, 0.7, 1.4]);     // beacon bar
    ab(-2.9, 2.85, 0.4, 0.55, -1.08, 1.08, 'dark', [1, 1, 1]);        // bumpers/sills
    for (const u of [-1.8, 1.8]) for (const v of [-0.95, 0.95]) ab(u - 0.38, u + 0.38, 0, 0.76, v - 0.14, v + 0.14, 'dark', [1, 1, 1]);
    solid(Fa.ox, Fa.oz, 2.8, 1.05, 0.3, -10, 100, true);
    // cars dumped on the square
    car(frame(O.x + 22, 0, O.z - 17, 0.9));
    car(frame(O.x + 14, 0, O.z + 16, -0.4), { burned: true });
    car(frame(O.x - 20, 0, O.z - 6, 1.4), { burned: true });
    car(frame(O.x + 26, 0, O.z + 12, 0.2));
    // crates, stretchers
    for (let i = 0; i < 8; i++) {
      const x = O.x - 28 + R() * 12, z = O.z + 17 + R() * 6;
      const F = frame(x, 0, z, R() * 3);
      const s = 0.4 + R() * 0.25;
      B.box('plank', F, -s, s, 0, s * 1.4, -s, s, { mw: 1, mh: 2, col: [0.7, 0.8, 0.6] });
    }
    // sandbag ring around a dead machine-gun post near the town hall side
    const Fs = frame(O.x - 26, 0, O.z - 22, 0.2);
    sandbags(Fs, -2, 2, 3);
    sandbags(sub(Fs, -2.1, 0, 1.3, Math.PI / 2), -1.2, 1.2, 3);
    // overturned car, wheels up
    tilted([O.x + 8, 1.42, O.z + 22], 0.6, Math.PI, 0, (BB, F) => car(F, { burned: true, collide: false }, BB));
    solid(O.x + 8, O.z + 22, 2.2, 0.9, 0.6, -10, 100, true);
  }

  // =====================================================================
  // Malá Strana square: derailed tram, wires
  // =====================================================================
  {
    const M = L.MS_SQUARE;
    const tx = M.x - 3, tz = M.z + 13, trot = 0.38;
    tilted([tx, 0.15, tz], trot, 0.06, 0.02, (BB, F) => tram(BB, F));
    solid(tx, tz, 7.4, 1.3, trot, -10, 100, true);
    // rails
    for (const v of [-0.72, 0.72]) {
      B.box('metal', frame(M.x, 0.0, M.z + 6, 0.1), -24, 24, 0, 0.05, v - 0.04, v + 0.04, { skip: 'bottom' });
    }
    // catenary poles + wires along the square and Mostecká
    const poles = [[M.x - 18, M.z - 20], [M.x + 18, M.z - 20], [M.x - 18, M.z + 20], [M.x + 18, M.z + 20]];
    for (const [x, z] of poles) {
      B.prism('metal', frame(x, 0, z, 0), 0, 0, 0.14, 0, 7.5, { sides: 6, r1: 0.1 });
      solid(x, z, 0.15, 0.15, 0, -10, 100, true);
    }
    const wire = (x0, z0, x1, z1, y) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      B.box('wire', frame((x0 + x1) / 2, y, (z0 + z1) / 2, Math.atan2(-(z1 - z0), x1 - x0)), -len / 2, len / 2, 0, 0.03, -0.015, 0.015, {});
    };
    wire(M.x - 18, M.z - 20, M.x + 18, M.z + 20, 7.0);
    wire(M.x + 18, M.z - 20, M.x - 18, M.z + 20, 7.0);
    wire(M.x - 18, M.z + 20, M.x + 18, M.z + 20, 7.2);
    wire(-52, -3, M.x + 18, M.z - 2, 6.6);
    wire(-52, 3, M.x + 18, M.z + 4, 6.6);
    // a snapped wire hanging down
    B.box('wire', frame(M.x + 4, 0, M.z + 6, 0.4), -0.015, 0.015, 0.6, 6.9, -0.015, 0.015, {});
    car(frame(M.x + 12, 0, M.z - 14, 2.2), { burned: true });
    car(frame(M.x - 14, 0, M.z - 15, -0.3));
    tilted([M.x + 13, 1.42, M.z + 18], -0.5, Math.PI, 0, (BB, F) => car(F, { burned: false, collide: false }, BB));
    solid(M.x + 13, M.z + 18, 2.2, 0.9, -0.5, -10, 100, true);
    // plague column stand-in (Trinity column)
    const Fc = frame(M.x + 6, 0, M.z - 15, 0);
    B.box('stone', Fc, -2, 2, 0, 1.0, -2, 2, { mw: 3, mh: 3, col: [0.45, 0.43, 0.4] });
    B.prism('stone', Fc, 0, 0, 0.55, 1, 11, { sides: 8, r1: 0.4, col: [0.42, 0.4, 0.37] });
    B.box('gold', Fc, -0.6, 0.6, 11, 12.2, -0.2, 0.2, { col: [0.5, 0.45, 0.3] });
    solid(Fc.ox, Fc.oz, 2, 2, 0, -10, 100, true);
  }

  // =====================================================================
  // Barricades on the route (each leaves ≥ 3 m)
  // =====================================================================
  {
    // Mostecká: sandbags from the north edge, 3 m long
    const pm = at('mostecka', 30, -(streets.mostecka.s.width / 2) + 0.05);
    const Fm = streetFrame(pm, Math.PI / 2);
    sandbags(Fm, -3, 0, 3);
    // Nerudova: furniture and planks from the south edge
    const pn = at('nerudova', 68, (streets.nerudova.s.width / 2) - 0.05);
    const Fn = streetFrame(pn, -Math.PI / 2);
    plankWall(Fn, -3.2, 0, 1.6);
    B.box('plank', sub(Fn, -1.5, 0, 0.8, 0.3), -0.6, 0.6, 0, 1.4, -0.35, 0.35, { mw: 1, mh: 2, col: [0.5, 0.4, 0.35] });
    // Celetná far east: full barricade beyond the Powder Tower (map edge)
    const pc = at('celetna', 4, 0);
    const Fc = streetFrame(pc, Math.PI / 2);
    plankWall(Fc, -6, 6, 2.4);
    stakes(sub(Fc, 0, 0, -0.6), -5.5, 5.5);
    car(sub(Fc, -2.5, 0, 1.5, Math.PI / 2 + 0.2), { burned: true });
    sandbags(sub(Fc, 0, 0, -1.2), -5.5, 5.5, 3);
    // Castle forecourt: survivors' car wall either side of the gate, chicane of sandbags
    const G = L.CASTLE_GATE, gx = L.CASTLE.x1 + 9;
    for (const [z0, z1] of [[G.z - 17, G.z - 6.2], [G.z + 6.2, G.z + 17]]) {
      for (let z = z0 + 2.2; z < z1 - 1; z += 4.4) car(frame(gx + (R() - 0.5) * 0.6, H(gx, z), z, Math.PI / 2 + (R() - 0.5) * 0.2), { burned: R() < 0.3 });
    }
    const Fg = frame(gx - 3, H(gx - 3, G.z), G.z - 4.4, Math.PI);
    sandbags(sub(Fg, 0, 0, 0), -1.6, 0.6, 3);
    stakes(frame(gx + 2.6, H(gx + 2.6, G.z), G.z - 9, Math.PI / 2), -3, 3);
    stakes(frame(gx + 2.6, H(gx + 2.6, G.z), G.z + 9, Math.PI / 2), -3, 3);
  }

  // =====================================================================
  // Castle courtyard camp
  // =====================================================================
  {
    const C = L.COURTYARD, top = L.HILL.height;
    const Y = top;
    const fireSpots = [[-300, -32], [-318, 0], [-288, 6], [-326, -40], [-296, -46]];
    // tents
    const tents = [[-328, -48, 0.1], [-318, -48, -0.1], [-306, -50, 0.05], [-288, -50, 0.2], [-330, 8, 0], [-320, 9, 0.1], [-306, 10, -0.1], [-282, -42, 1.5], [-332, -30, 1.6]];
    for (const [x, z, r] of tents) {
      const F = frame(x, Y, z, r);
      const w = 4 + R() * 1.5, d = 3 + R(), h = 2.2 + R() * 0.4;
      const col = pick([[0.55, 0.6, 0.45], [0.6, 0.55, 0.45], [0.4, 0.45, 0.5], [0.65, 0.62, 0.55]]);
      B.box('canvas', F, -w / 2, w / 2, 0, h * 0.4, -d / 2, d / 2, { mw: 0.5, mh: 0.5, col, skip: 'bottom,top' });
      B.gable('canvas', F, -w / 2, w / 2, -d / 2, d / 2, h * 0.4, h * 0.6, { over: 0.2, mw: 0.5, mh: 0.5, col, gkey: 'canvas', gmw: 0.5, gcol: col });
      B.box('dark', F, -0.5, 0.5, 0, 1.3, -d / 2 - 0.02, -d / 2, {});
      solid(x, z, w / 2, d / 2, r, -10, 100, true);
    }
    // fires: barrels + one camp fire ring
    for (const [x, z] of fireSpots) {
      B.prism('rust', frame(x, Y, z, 0), 0, 0, 0.32, 0, 0.92, { sides: 10, mw: 1.5 });
      B.prism('ember', frame(x, Y, z, 0), 0, 0, 0.3, 0.86, 0.9, { sides: 10, cap: true });
      solid(x, z, 0.34, 0.34, 0, -10, 100, true);
      W.fires.push(new THREE.Vector3(x, Y + 1.0, z));
      // a crate seat or two
      for (let i = 0; i < 2; i++) {
        const a = R() * 6.28, F = frame(x + Math.cos(a) * 1.6, Y, z + Math.sin(a) * 1.6, a);
        B.box('plank', F, -0.3, 0.3, 0, 0.45, -0.25, 0.25, { mw: 1, mh: 2 });
      }
    }
    // supplies: crates, jerrycans, pallets, water barrels
    for (let i = 0; i < 26; i++) {
      const x = C.x - C.w / 2 + 2 + R() * 12, z = C.z - C.d / 2 + 2 + R() * (C.d - 4);
      if (Math.abs(z - L.MEDIC.z) < 12) continue;
      const F = frame(x, Y, z, R() * 0.4);
      const k = R();
      if (k < 0.5) { B.box('plank', F, -0.45, 0.45, 0, 0.7, -0.35, 0.35, { mw: 1, mh: 2, col: [0.7, 0.75, 0.6] }); if (R() < 0.5) B.box('plank', F, -0.4, 0.4, 0.7, 1.3, -0.3, 0.3, { mw: 1, mh: 2 }); }
      else if (k < 0.8) B.box('olive', F, -0.18, 0.18, 0, 0.48, -0.08, 0.08, {});
      else B.prism('metal', F, 0, 0, 0.3, 0, 0.9, { sides: 8, col: [0.3, 0.45, 0.6] });
    }
    // sandbag walls inside the gate, leaving the gate lane open
    const G = L.CASTLE_GATE;
    sandbags(frame(C.x + C.w / 2 - 3, Y, G.z - 9.5, Math.PI / 2), -5, 5, 4);
    sandbags(frame(C.x + C.w / 2 - 3, Y, G.z + 9.5, Math.PI / 2), -5, 5, 4);
    // the survivors
    person(frame(L.MEDIC.x, Y, L.MEDIC.z, -Math.PI / 2), { coat: 'cloth4', pants: 'cloth1', long: true, armband: true, hat: 'dark' });
    B.box('plank', frame(L.MEDIC.x + 1.4, Y, L.MEDIC.z - 1.6, 0.2), -0.9, 0.9, 0.65, 0.75, -0.4, 0.4, { mw: 1, mh: 2, col: [0.8, 0.8, 0.75] });   // field table
    for (const [du, dv] of [[-0.8, -0.35], [0.8, -0.35], [-0.8, 0.35], [0.8, 0.35]]) B.box('metal', frame(L.MEDIC.x + 1.4, Y, L.MEDIC.z - 1.6, 0.2), du - 0.03, du + 0.03, 0, 0.65, dv - 0.03, dv + 0.03, {});
    B.box('white', frame(L.MEDIC.x + 1.2, Y, L.MEDIC.z - 1.6, 0.4), -0.2, 0.2, 0.75, 0.95, -0.15, 0.15, { col: [0.9, 0.9, 0.9] });
    B.box('red', frame(L.MEDIC.x + 1.2, Y, L.MEDIC.z - 1.6, 0.4), -0.03, 0.03, 0.85, 0.96, -0.151, 0.151, {});
    person(frame(C.x + C.w / 2 - 6, Y, G.z - 6.5, -Math.PI / 2), { coat: 'cloth5', pants: 'cloth5', rifle: true, bag: true, hat: 'olive' });
    person(frame(-288 - 1.5, Y, 6 - 0.8, Math.PI * 0.7), { sit: true, coat: 'cloth3' });
    // red-cross medical tent beside the medic, open towards the gate
    {
      const F = frame(L.MEDIC.x - 9, Y, L.MEDIC.z, -Math.PI / 2), w = 7, d = 5.4, h = 3.4, col = [0.9, 0.88, 0.8];
      B.box('canvas', F, -w / 2, w / 2, 0, h * 0.5, -d / 2, d / 2, { mw: 0.5, mh: 0.5, col, skip: 'bottom,top,front' });
      B.gable('canvas', F, -w / 2, w / 2, -d / 2, d / 2, h * 0.5, h * 0.5, { over: 0.25, mw: 0.5, mh: 0.5, col, gkey: 'canvas', gmw: 0.5, gcol: col });
      // flaps tied back, red crosses on the roof slopes and the back wall
      for (const sg of [-1, 1]) B.quad('canvas', P(F, sg * w / 2, 0, -d / 2), P(F, sg * (w / 2 + 0.6), 0, -d / 2 - 0.9), P(F, sg * (w / 2 + 0.5), h * 0.5, -d / 2 - 0.7), P(F, sg * w / 2, h * 0.5, -d / 2), null, [0.8, 0.78, 0.7]);
      const cross = (cu, cy, v, n) => {
        for (const [a, b, c2, e] of [[-0.18, 0.18, -0.55, 0.55], [-0.55, 0.55, -0.18, 0.18]]) {
          B.polyF('red', [P(F, cu + a, cy + c2, v), P(F, cu + b, cy + c2, v), P(F, cu + b, cy + e, v), P(F, cu + a, cy + e, v)], n, null, [1.3, 1.1, 1.1]);
        }
      };
      cross(0, 1.2, d / 2 + 0.02, [-F.s * 0, 0, 0].map((_, j) => [F.s, 0, F.c][j]));
      cross(1.9, 1.2, d / 2 + 0.02, [F.s, 0, F.c]); cross(-1.9, 1.2, d / 2 + 0.02, [F.s, 0, F.c]);
      // cots inside
      for (const u of [-2.2, 0, 2.2]) {
        const Fc = sub(F, u, 0, 0.6, Math.PI / 2);
        B.box('canvas', Fc, -1, 1, 0.42, 0.5, -0.35, 0.35, { col: [0.55, 0.6, 0.48] });
        for (const du of [-0.9, 0.9]) B.box('metal', Fc, du - 0.03, du + 0.03, 0, 0.42, -0.33, 0.33, {});
        if (u !== 0) B.box('cloth2', Fc, -0.8, 0.7, 0.5, 0.68, -0.27, 0.27, {});
      }
      const [tx, , tz] = P(F, 0, 0, 0);
      solid(tx, tz, w / 2, d / 2, F.rot, -10, 100, true);
    }
    // hanging lanterns on poles + wire across the camp; two dim warm lights
    {
      const lanterns = [[-309, -9.5], [-322, -17], [-300, -28], [-322, 4], [-292, 2], [-304, -42]];
      for (const [x, z] of lanterns) {
        const Fp = frame(x, Y, z, 0);
        B.prism('plank', Fp, 0, 0, 0.06, 0, 3.0, { sides: 5, mw: 1, mh: 2 });
        B.box('plank', Fp, -0.04, 0.04, 2.85, 2.92, 0, 0.55, { mw: 1, mh: 2 });
        B.box('wire', Fp, -0.008, 0.008, 2.45, 2.88, 0.5, 0.516, {});
        B.box('metal', Fp, -0.12, 0.12, 2.42, 2.47, 0.39, 0.63, {});
        B.box('lantern', Fp, -0.09, 0.09, 2.18, 2.42, 0.42, 0.6, { col: [1, 0.9, 0.7] });
        B.box('metal', Fp, -0.11, 0.11, 2.14, 2.18, 0.4, 0.62, {});
        W.lamps.push(new THREE.Vector3(x, Y + 2.3, z + 0.51));
      }
      for (const [x, z] of [[-309, -9.0], [-300, -27.5]]) {
        const l = new THREE.PointLight(0xffa452, 3.2, 13, 2);
        l.position.set(x, Y + 2.2, z + 0.5);
        l.name = 'world:campLantern';
        extra.push(l);
        let t = R() * 10;
        W.updaters.push((dt) => { t += dt; l.intensity = 3.0 + 0.25 * Math.sin(t * 7.3) + 0.15 * Math.sin(t * 17.1); });
      }
    }
    // more survivors: warming hands at fires, a sentry on the wall stairs
    person(frame(-300 + 1.1, Y, -32 + 0.6, -2.2), { coat: 'cloth0', pants: 'cloth5', hat: 'cloth3' });
    person(frame(-318 - 1.2, Y, 0 + 0.4, 1.9), { coat: 'cloth2', pants: 'cloth1', long: true });
    person(frame(-296 + 0.9, Y, -46 - 0.9, -0.8), { coat: 'cloth3', pants: 'cloth4', bag: true, hat: 'olive' });
    // stretchers by the medic
    for (let i = 0; i < 3; i++) {
      const F = frame(L.MEDIC.x - 4 - i * 1.2, Y, L.MEDIC.z - 5, Math.PI / 2);
      B.box('canvas', F, -1, 1, 0.25, 0.32, -0.32, 0.32, { col: [0.5, 0.55, 0.45] });
      if (i === 1) B.box('cloth2', F, -0.8, 0.8, 0.32, 0.5, -0.25, 0.25, {});
    }
  }

  // =====================================================================
  // Scatter: paper, luggage, blood on the ground
  // =====================================================================
  {
    const pts = [];
    for (const name of Object.keys(streets)) {
      const S = streets[name];
      const n = Math.floor(S.len * (S.s.width < 6 ? 0.5 : 0.8));
      for (let i = 0; i < n; i++) pts.push(at(name, R() * S.len, (R() - 0.5) * (S.s.width - 0.8)));
    }
    for (const pz of [L.OTS, L.MS_SQUARE]) for (let i = 0; i < 160; i++) {
      const x = pz.x + (R() - 0.5) * pz.w, z = pz.z + (R() - 0.5) * pz.d;
      pts.push({ x, z, y: H(x, z) });
    }
    for (const p of pts) {
      const s = 0.07 + R() * 0.07, a = R() * 6.28, F = frame(p.x, p.y + 0.012 + R() * 0.01, p.z, a);
      const k = 0.35 + R() * 0.3;
      B.quad('paper', P(F, -s, 0, s * 1.4), P(F, s, 0, s * 1.4), P(F, s, 0, -s * 1.4), P(F, -s, 0, -s * 1.4), null, [k, k * 0.98, k * 0.9]);
    }
    // luggage
    const bagCols = [[0.25, 0.2, 0.18], [0.15, 0.17, 0.22], [0.4, 0.15, 0.12], [0.3, 0.32, 0.28], [0.5, 0.45, 0.38]];
    for (let i = 0; i < 90; i++) {
      const p = pts[Math.floor(R() * pts.length)];
      if (p.x < -40 && p.x > -60 && Math.abs(p.z) < 6) continue;
      const F = frame(p.x, p.y, p.z, R() * 6.28);
      const col = pick(bagCols);
      if (R() < 0.7) {
        B.box('bag', F, -0.34, 0.34, 0, 0.2, -0.24, 0.24, { col });
        if (R() < 0.3) B.box('bag', sub(F, 0.8, 0, 0.1, 0.4), -0.34, 0.34, 0, 0.1, -0.24, 0.24, { col });
      } else {
        B.box('bag', F, -0.18, 0.18, 0, 0.42, -0.12, 0.12, { col });
      }
    }
    // pools and drag marks of blood
    for (let i = 0; i < 170; i++) {
      const p = pts[Math.floor(R() * pts.length)];
      const s = 0.5 + R() * 1.1, a = R() * 6.28, F = frame(p.x, p.y + 0.02, p.z, a);
      const drag = R() < 0.25 ? 2.5 + R() * 2 : 1;
      B.quad('blood', P(F, -s, 0, s * drag), P(F, s, 0, s * drag), P(F, s, 0, -s), P(F, -s, 0, -s), [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  }

  // =====================================================================
  // Fire flames (instanced, flicker in update)
  // =====================================================================
  if (W.fires.length) {
    const n = W.fires.length;
    // flames: additive, unfogged, no vertex colours (the cones carry none — that made them black)
    const fm = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const outer = new THREE.InstancedMesh(new THREE.ConeGeometry(0.3, 1.1, 8, 1, true).translate(0, 0.55, 0), fm(0xff7a24), n);
    const inner = new THREE.InstancedMesh(new THREE.ConeGeometry(0.17, 0.7, 6, 1, true).translate(0, 0.35, 0), fm(0xffd27a), n);
    outer.renderOrder = inner.renderOrder = 3;
    outer.name = 'world:flames'; inner.name = 'world:flamesInner';
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let t = 0;
    const set = () => {
      for (let i = 0; i < n; i++) {
        const f = W.fires[i];
        const k = 0.8 + 0.25 * Math.sin(t * 13 + i * 2.1) + 0.15 * Math.sin(t * 29 + i);
        p.set(f.x, f.y - 0.12, f.z); q.setFromAxisAngle(UP, t * 2 + i); s.set(1 + 0.1 * Math.sin(t * 17 + i), k, 1);
        outer.setMatrixAt(i, m.compose(p, q, s));
        s.set(1, 0.9 + 0.3 * Math.sin(t * 21 + i * 3), 1);
        inner.setMatrixAt(i, m.compose(p, q, s));
      }
      outer.instanceMatrix.needsUpdate = true; inner.instanceMatrix.needsUpdate = true;
    };
    set();
    W.updaters.push((dt) => { t += dt; set(); });
    extra.push(outer, inner);
  }

  // ---------- helpers that need their own transforms ----------
  function tilted(pos, rotY, roll, pitch, fn) {
    const BB = new Batches();
    fn(BB, frame(0, 0, 0, 0));
    const g = new THREE.Group();
    BB.build(THREE, mats, g);
    g.position.set(pos[0], pos[1] + H(pos[0], pos[2]), pos[2]);
    g.rotation.set(pitch, rotY, roll, 'YXZ');
    g.updateMatrixWorld(true);
    // bake into the main batches' meshes would need re-merge; keep as small group
    extra.push(g);
  }

  // Tatra T3: rounded red body with a cream belt + skirt, split windows, bogies, roof
  // equipment and a pantograph; scorched and smashed on one side.
  function tram(BB, F) {
    const cream = [0.86, 0.8, 0.64], red = [0.62, 0.12, 0.1], L2 = 7.0;
    const bx = (k, u0, u1, y0, y1, v0, v1, col) => BB.box(k, F, u0, u1, y0, y1, v0, v1, { mw: 1.5, mh: 1.5, col });
    // bogies with wheels + skirt
    for (const u of [-4.2, 4.2]) {
      bx('dark', u - 1.2, u + 1.2, 0.15, 0.55, -0.95, 0.95, [1, 1, 1]);
      for (const du of [-0.75, 0.75]) for (const v of [-0.78, 0.78]) bx('metal', u + du - 0.35, u + du + 0.35, 0, 0.7, v - 0.06, v + 0.06, [0.8, 0.8, 0.8]);
    }
    bx('paint', -L2 + 0.4, L2 - 0.4, 0.5, 0.85, -1.2, 1.2, cream);                 // cream skirt
    bx('paint', -L2, L2, 0.85, 1.35, -1.25, 1.25, red);                              // lower body
    bx('paint', -L2, L2, 1.35, 1.48, -1.27, 1.27, cream);                            // belt line
    bx('dark', -L2 + 0.25, L2 - 0.25, 1.48, 2.42, -1.21, 1.21, [1, 1, 1]);          // glazing band
    // window pillars: split upper/lower panes
    for (let u = -L2 + 0.3; u <= L2 - 0.3; u += 1.12) bx('paint', u - 0.07, u + 0.07, 1.48, 2.42, -1.25, 1.25, red);
    bx('paint', -L2 + 0.25, L2 - 0.25, 2.12, 2.17, -1.235, 1.235, red);             // transom bar
    bx('paint', -L2, L2, 2.42, 2.75, -1.25, 1.25, red);                              // cant rail
    // rounded roof: three stepped slabs + roof equipment
    bx('paint', -L2 + 0.1, L2 - 0.1, 2.75, 2.88, -1.12, 1.12, cream);
    bx('paint', -L2 + 0.3, L2 - 0.3, 2.88, 2.97, -0.85, 0.85, cream);
    bx('metal', -1.6, 1.6, 2.97, 3.25, -0.55, 0.55, [0.9, 0.9, 0.9]);
    // tapered ends (T3 nose): two angled facets per end
    for (const sg of [-1, 1]) {
      const u0 = sg * L2, u1 = sg * (L2 + 0.55);
      for (const [y0, y1, col, k] of [[0.5, 1.35, red, 'paint'], [1.35, 1.48, cream, 'paint'], [1.48, 2.42, [1, 1, 1], 'dark'], [2.42, 2.85, red, 'paint']]) {
        for (const sv of [-1, 1]) {
          const q = [P(F, u0, y0, sv * 1.25), P(F, u1, y0, sv * 0.7), P(F, u1, y1, sv * 0.7), P(F, u0, y1, sv * 1.25)];
          BB.polyF(k, q, [sg * F.c * 0.6 + sv * F.s, 0, -sg * F.s * 0.6 + sv * F.c], null, col);
        }
        BB.polyF(k, [P(F, u1, y0, -0.7), P(F, u1, y0, 0.7), P(F, u1, y1, 0.7), P(F, u1, y1, -0.7)], [sg * F.c, 0, -sg * F.s], null, col);
      }
      BB.polyF('paint', [P(F, u0, 2.85, -1.25), P(F, u1, 2.85, -0.7), P(F, u1, 2.85, 0.7), P(F, u0, 2.85, 1.25)], [0, 1, 0], null, cream);
      bx('glass', sg > 0 ? L2 + 0.56 : -L2 - 0.6, sg > 0 ? L2 + 0.6 : -L2 - 0.56, 2.48, 2.7, -0.4, 0.4, [1.6, 1.4, 0.9]);   // route box
      bx('metal', sg > 0 ? L2 + 0.5 : -L2 - 0.75, sg > 0 ? L2 + 0.75 : -L2 - 0.5, 0.45, 0.62, -0.9, 0.9, [1, 1, 1]);      // coupler bumper
    }
    // pantograph: base, lower arms, upper arms, collector shoe
    bx('metal', -0.5, 0.5, 3.25, 3.35, -0.45, 0.45, [1, 1, 1]);
    for (const v of [-0.3, 0.3]) {
      BB.polyF('metal', [P(F, -0.4, 3.35, v - 0.03), P(F, -0.4, 3.35, v + 0.03), P(F, 0.5, 4.0, v + 0.03), P(F, 0.5, 4.0, v - 0.03)], [0, 1, 0], null, [1, 1, 1]);
      BB.polyF('metal', [P(F, 0.5, 4.0, v - 0.03), P(F, 0.5, 4.0, v + 0.03), P(F, -0.2, 4.55, v + 0.03), P(F, -0.2, 4.55, v - 0.03)], [0, 1, 0], null, [1, 1, 1]);
    }
    bx('metal', -0.3, -0.1, 4.55, 4.62, -0.8, 0.8, [1, 1, 1]);
    // doors (three, dark) on the kerb side
    for (const u of [-5.2, -0.4, 4.6]) bx('dark', u - 0.6, u + 0.6, 0.6, 2.4, 1.24, 1.27, [1, 1, 1]);
    // scorch + smashed windows on the far side
    bx('char', -L2 - 0.05, -2.0, 1.3, 2.8, -1.29, -1.26, [1, 1, 1]);
  }
}

const UP = { x: 0, y: 1, z: 0, isVector3: true };
