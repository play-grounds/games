// Low-poly survivors: lathe torso, a sculpted head (cranium + jaw + chin, brow ridge and brows,
// eye sockets with eyes, wedge nose, ears, stubble), hair / beanie / hood, neck, tapered limbs,
// hands with a finger block and a thumb, and layered muted clothes (coat over a sweater or
// shirt, cuffs, scarf, satchel strap) — merged into one vertex-coloured mesh per person with a
// shared fabric/skin detail texture. Feet at y = 0, facing local −z. A cheap per-frame
// sway/breath is applied by the caller via `animate(t)`.

const SKIN = [0.35, 0.3, 0.27];             // muted, a little grey: cold, unwashed
const mix = (a, b, k) => a.map((c, i) => c * (1 - k) + b[i] * k);

export function makePerson(THREE, o = {}) {
  const parts = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), V = new THREE.Vector3();
  const add = (geo, col, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1], shade) => {
    Q.setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ'));
    M.compose(V.set(...pos), Q, S.set(...scl));
    const g = (geo.index ? geo.toNonIndexed() : geo).applyMatrix4(M);
    parts.push({ g, col, shade });
  };
  // add a geometry in a frame whose local −y runs along d (for hands / feet on limbs)
  const addAlong = (geo, col, origin, d, local = [0, 0, 0], twist = 0) => {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), d.clone().normalize());
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), twist));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...origin), q, new THREE.Vector3(1, 1, 1));
    const g = (geo.index ? geo.toNonIndexed() : geo).translate(...local).applyMatrix4(m);
    parts.push({ g, col });
  };
  // a limb segment from a to b (tapered cylinder)
  const limb = (a, b, r0, r1, col, sides = 8, shade) => {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1).translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    M.compose(V.set(...a), q, S.set(1, 1, 1));
    parts.push({ g: g.toNonIndexed().applyMatrix4(M), col, shade });
  };
  const ball = (r, col, pos, scl = [1, 1, 1], ws = 8, hs = 6, shade) => add(new THREE.SphereGeometry(r, ws, hs), col, pos, [0, 0, 0], scl, shade);
  // A 3D band (strap, scarf) along centre points c[i] with outward normals n[i] and across
  // vectors a[i]: outer + inner faces and both edges, so it has real thickness on the coat.
  const band = (c, n, a, w, t, col, shade, closed = false) => {
    const pos = [];
    const q = (i, sa, sn) => [0, 1, 2].map((k) => c[i][k] + a[i][k] * sa * w / 2 + n[i][k] * sn * t / 2);
    const quad = (p0, p1, p2, p3) => pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    const N = closed ? c.length : c.length - 1;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % c.length;
      quad(q(i, -1, 1), q(i, 1, 1), q(j, 1, 1), q(j, -1, 1));       // outer
      quad(q(j, -1, -1), q(j, 1, -1), q(i, 1, -1), q(i, -1, -1));   // inner
      quad(q(i, 1, 1), q(i, 1, -1), q(j, 1, -1), q(j, 1, 1));       // edges
      quad(q(j, -1, 1), q(j, -1, -1), q(i, -1, -1), q(i, -1, 1));
    }
    if (!closed) for (const [i, d] of [[0, 1], [c.length - 1, -1]]) {   // end caps
      const e = [q(i, -1, 1), q(i, 1, 1), q(i, 1, -1), q(i, -1, -1)];
      if (d > 0) quad(e[3], e[2], e[1], e[0]); else quad(...e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    parts.push({ g, col, shade });
  };
  const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];

  const skin = o.skin || SKIN, skinD = skin.map((c) => c * 0.72);
  const coat = o.coat || [0.27, 0.25, 0.22], coat2 = coat.map((c) => c * 0.78);
  const under = o.under || [0.2, 0.22, 0.24];                 // sweater / shirt under the coat
  const pants = o.pants || [0.18, 0.18, 0.19], boot = [0.08, 0.07, 0.06];
  const scarf = o.scarf || [0.33, 0.24, 0.2];
  const hair = o.grey ? mix(o.hair || [0.1, 0.085, 0.07], [0.3, 0.3, 0.29], 0.3) : (o.hair || [0.1, 0.085, 0.07]);
  const sit = !!o.sit;
  const hip = sit ? 0.5 : 0.9;

  // legs + boots (laced boot with a sole and a turned-up trouser cuff)
  for (const s of [-1, 1]) {
    const x = s * 0.1;
    if (sit) {
      limb([x, hip, 0.02], [x, 0.5, -0.42], 0.088, 0.076, pants);
      limb([x, 0.5, -0.42], [x, 0.1, -0.46], 0.072, 0.06, pants);
      add(new THREE.BoxGeometry(0.115, 0.1, 0.27), boot, [x, 0.06, -0.5]);
      add(new THREE.BoxGeometry(0.125, 0.025, 0.29), [0.05, 0.045, 0.04], [x, 0.012, -0.5]);
    } else {
      limb([x, hip, 0], [x * 1.05, 0.47, -0.01], 0.088, 0.074, pants);
      limb([x * 1.05, 0.47, -0.01], [x * 1.1, 0.13, 0.01], 0.072, 0.062, pants, (px, py) => (py < 0.3 ? 0.75 : 1));   // mud
      add(new THREE.CylinderGeometry(0.066, 0.064, 0.05, 8), pants.map((c) => c * 0.85), [x * 1.1, 0.15, 0.01]);       // cuff
      add(new THREE.BoxGeometry(0.115, 0.12, 0.27), boot, [x * 1.1, 0.07, -0.04]);
      add(new THREE.BoxGeometry(0.105, 0.05, 0.08), boot.map((c) => c * 1.4), [x * 1.1, 0.1, -0.15]);                 // toe cap
      add(new THREE.BoxGeometry(0.125, 0.025, 0.29), [0.05, 0.045, 0.04], [x * 1.1, 0.012, -0.045]);                   // sole
    }
  }
  // torso: a lathe of the coat (hem flare → waist → chest → shoulders → collar), oval in plan
  const y0 = sit ? hip - 0.02 : (o.long ? 0.48 : 0.78);
  const prof = [[0.0, y0 - 0.01], [o.long ? 0.25 : 0.212, y0], [0.205, hip + 0.06], [0.19, hip + 0.22], [0.215, hip + 0.42], [0.22, hip + 0.52], [0.165, hip + 0.58], [0.075, hip + 0.62]];
  const lathe = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 14);
  const rAt = (y) => {                                   // coat radius at height y (lathe profile)
    if (y <= prof[1][1]) return prof[1][0];
    for (let i = 1; i < prof.length - 1; i++) {
      const [r0, y0_] = prof[i], [r1, y1_] = prof[i + 1];
      if (y <= y1_) return r0 + (r1 - r0) * (y - y0_) / (y1_ - y0_);
    }
    return prof[prof.length - 1][0];
  };
  // coat: darker towards the hem and on the back, grime streaks and fold shading
  add(lathe, coat, [0, 0, 0], [0, 0, 0], [1, 1, 0.72], (x, y, z) => (0.74 + 0.26 * Math.min(1, (y - y0) / 0.5)) * (z > 0.05 ? 0.88 : 1) * (0.9 + 0.1 * Math.sin(x * 37 + y * 11)) * (0.94 + 0.06 * Math.sin(y * 60)));
  const sh = hip + 0.5;
  // the layer underneath: a sweater/shirt V in the coat opening, a collar and a hem below the coat
  add(new THREE.TorusGeometry(0.075, 0.025, 5, 12), under.map((c) => c * 0.9), [0, sh + 0.06, 0], [Math.PI / 2, 0, 0], [1.05, 0.9, 1]);         // roll neck
  if (!sit) {
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.12, 0.11, 0.025), coat2, [s * 0.105, hip - 0.04, -0.148]);                                    // pockets
      add(new THREE.BoxGeometry(0.125, 0.025, 0.03), coat2.map((c) => c * 0.9), [s * 0.105, hip + 0.02, -0.152]);               // pocket flaps
    }
    for (const yy of [hip + 0.2, hip + 0.32, hip - 0.1]) ball(0.012, [0.08, 0.07, 0.06], [-0.05, yy, -0.152], [1, 1, 0.5], 5, 3);   // buttons
  }
  // raised coat collar behind the neck
  add(new THREE.CylinderGeometry(0.12, 0.14, 0.11, 12, 1, true, Math.PI * 0.55, Math.PI * 0.9), coat2, [0, sh + 0.09, 0.01]);
  // belt + coat opening (darker front strip)
  add(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 12, 1, true), [0.08, 0.07, 0.06], [0, hip + 0.08, 0], [0, 0, 0], [1.03, 1, 0.75]);
  add(new THREE.BoxGeometry(0.045, 0.04, 0.02), [0.32, 0.28, 0.2], [0.04, hip + 0.08, -0.152]);                                 // buckle
  add(new THREE.BoxGeometry(0.03, Math.max(0.05, sh - 0.22 - y0), 0.02), coat2.map((c) => c * 0.8), [0.0, (y0 + sh - 0.22) / 2, -0.153]);
  // satchel strap across the chest + bag on the hip
  if (o.satchel || o.bag) {
    // a leather strap wrapped round the torso from the right shoulder to the left hip: a closed
    // loop on the plane y = yc − k·x, sitting on the coat and lifted over the shoulder
    const yc = hip + 0.25, k = 1.15, NS = 28, c = [], n = [];
    const shC = [0.2, sh - 0.02, 0], shR = 0.085 + 0.014;
    for (let i = 0; i < NS; i++) {
      const th = (i / NS) * Math.PI * 2;
      let y = yc, x = 0, z = 0;
      for (let it = 0; it < 3; it++) { const r = rAt(y) + 0.012; x = r * Math.cos(th); z = r * 0.72 * Math.sin(th); y = yc - k * x; }
      let p = [x, y, z];
      const dv = [p[0] - shC[0], p[1] - shC[1], p[2] - shC[2]], dl = Math.hypot(...dv);
      if (dl < shR) p = shC.map((v, j) => v + dv[j] / dl * shR);
      c.push(p);
      n.push(norm([Math.cos(th) / 1, 0, Math.sin(th) / 0.72]));
    }
    const a = c.map((p, i) => { const tng = c[(i + 1) % NS].map((v, j) => v - c[(i + NS - 1) % NS][j]); return norm(cross(n[i], tng)); });
    band(c, n, a, 0.05, 0.014, [0.16, 0.13, 0.1], (x, y, z) => 0.85 + 0.15 * Math.sin(Math.atan2(z, x) * 23), true);
  }
  if (o.bag) add(new THREE.BoxGeometry(0.3, 0.38, 0.14), [0.24, 0.25, 0.17], [0, hip + 0.3, 0.2]);
  if (o.satchel) {
    add(new THREE.BoxGeometry(0.07, 0.22, 0.26), o.satchel, [-0.24, hip + 0.02, 0.0]);
    add(new THREE.BoxGeometry(0.075, 0.08, 0.265), o.satchel.map((c) => c * 0.8), [-0.24, hip + 0.1, 0.0]);
  }
  if (o.rifle) limb([0.12, hip - 0.05, 0.19], [-0.16, hip + 0.7, 0.2], 0.025, 0.02, [0.1, 0.1, 0.1], 5);
  // arms: upper arm, forearm, sweater cuff, hand (palm, finger block, thumb)
  for (const s of [-1, 1]) {
    const warm = o.warm;                                   // hands held out towards a fire
    const lo = o.long ? 0.035 : 0;                         // clear the flared hem of a long coat
    const elbow = sit ? [s * 0.26, sh - 0.28, -0.12] : warm ? [s * 0.25, sh - 0.27, -0.12] : [s * (0.27 + lo * 0.5), sh - 0.3, 0.03];
    const wrist = sit ? [s * 0.16, hip + 0.06, -0.34] : warm ? [s * 0.12, sh - 0.3, -0.4] : [s * (0.25 + lo), sh - 0.58, -0.07];
    ball(0.085, coat, [s * 0.2, sh - 0.02, 0], [1, 0.9, 0.95], 8, 6);                                   // shoulder
    limb([s * 0.2, sh, 0], elbow, 0.074, 0.064, coat);
    limb(elbow, wrist, 0.066, 0.056, coat, 8, (x, y, z) => 0.9 + 0.1 * Math.sin(y * 70 + z * 20));
    const d = new THREE.Vector3(wrist[0] - elbow[0], wrist[1] - elbow[1], wrist[2] - elbow[2]).normalize();
    const cuffAt = [wrist[0] - d.x * 0.015, wrist[1] - d.y * 0.015, wrist[2] - d.z * 0.015];
    addAlong(new THREE.CylinderGeometry(0.052, 0.05, 0.04, 8), under.map((c) => c * 0.9), cuffAt, d, [0, -0.01, 0]);
    // palm faces the body (twist so the thumb is forward/inward)
    const tw = warm ? 0 : s * Math.PI / 2;
    addAlong(new THREE.BoxGeometry(0.075, 0.085, 0.032), skin, wrist, d, [0, -0.06, 0], tw);                      // palm
    // four fingers, a little curled in towards the palm, the middle one longest
    [[-0.027, 0.052], [-0.009, 0.066], [0.009, 0.062], [0.027, 0.05]].forEach(([fx, fl], fi) => {
      const fg = new THREE.BoxGeometry(0.0165, fl, 0.02).translate(0, -fl / 2, 0).rotateX(-0.28 - fi * 0.03);
      addAlong(fg, skin.map((c) => c * (fi % 2 ? 0.92 : 0.97)), wrist, d, [fx, -0.1, 0.004], tw);
    });
    addAlong(new THREE.CylinderGeometry(0.013, 0.015, 0.06, 5).rotateZ(0.5 * s).rotateX(-0.4), skin, wrist, d, [0.035 * (warm ? s : 1), -0.065, -0.018], tw);   // thumb
    if (o.armband && s > 0) {
      const m = [(s * 0.2 + elbow[0]) / 2, (sh + elbow[1]) / 2, (elbow[2]) / 2];
      add(new THREE.CylinderGeometry(0.08, 0.08, 0.09, 10, 1, true), [0.7, 0.68, 0.62], m);
      for (const [dx, dz, ax] of [[0.08, 0, 'x'], [0, -0.08, 'z'], [0, 0.08, 'z']]) {   // red crosses: outside, front, back
        const thin = ax === 'x' ? [0.012, 0.06, 0.02] : [0.02, 0.06, 0.012], wide = ax === 'x' ? [0.012, 0.02, 0.06] : [0.06, 0.02, 0.012];
        add(new THREE.BoxGeometry(...thin), [0.5, 0.06, 0.05], [m[0] + dx, m[1], m[2] + dz]);
        add(new THREE.BoxGeometry(...wide), [0.5, 0.06, 0.05], [m[0] + dx, m[1], m[2] + dz]);
      }
    }
  }
  // neck, scarf
  limb([0, sh + 0.04, 0.008], [0, sh + 0.2, 0.014], 0.06, 0.054, skin, 8);
  add(new THREE.TorusGeometry(0.088, 0.048, 6, 12), scarf, [0, sh + 0.09, 0], [Math.PI / 2, 0, 0], [1.12, 1.0, 1], (x, y, z) => 0.85 + 0.15 * Math.sin(Math.atan2(z, x) * 9));
  // two knitted tails hanging from the knot down the chest, following the coat front, with a
  // darker fringe at the ends
  for (const [x0, x1, len, lift, w] of [[0.045, 0.07, 0.34, 0, 0.064], [-0.012, -0.03, 0.26, -0.01, 0.058]]) {
    const c = [], n = [], a = [], NS = 6;
    for (let i = 0; i <= NS; i++) {
      const t = i / NS, y = sh + 0.06 - t * len;
      const zf = -(rAt(Math.min(y, sh)) * 0.72) - 0.028 + lift - (t < 0.2 ? (0.2 - t) * 0.08 : 0);
      c.push([x0 + (x1 - x0) * t, y, zf]);
      n.push(norm([0.12 * (x1 - x0), 0.15, -1]));
      a.push([1, 0, 0]);
    }
    band(c, n, a, w, 0.026, scarf.map((v) => v * 0.92), (x, y) => (y < sh + 0.06 - len + 0.05 ? 0.62 : 0.9 + 0.1 * Math.sin(y * 140)));
  }
  // ---- head ----
  const hy = sh + 0.265;
  const stubble = mix(skin, [0.12, 0.11, 0.1], o.beard ? 0.6 : 0.32);
  // cranium: forehead, temples, sockets (dark), cheekbones (light), stubble below the cheeks
  add(new THREE.SphereGeometry(0.105, 22, 16), skin, [0, hy + 0.012, 0.004], [0, 0, 0], [0.86, 1.04, 1.0], (x, y, z) => {
    const ly = (y - hy) / 0.11, front = -z / 0.105, ax = Math.abs(x);
    if (front < 0.25) return 0.86;
    let k = 1;
    if (ly > -0.12 && ly < 0.2 && ax > 0.012 && ax < 0.065) k *= 0.42 + 0.4 * Math.min(1, Math.abs(ly - 0.04) / 0.16);   // sockets
    if (ly >= 0.2 && ly < 0.38) k *= 1.1;                                                                                 // brow
    if (ly > 0.45) k *= 0.96;
    if (ax > 0.055 && ly < -0.05) k *= 0.82;   // hollow cheeks
    else if (ax > 0.03 && ly < -0.05 && ly > -0.3) k *= 1.08;   // cheekbones
    return k;
  });
  // jaw + chin as separate volumes: square the face off below the cheekbones; stubble-shaded
  add(new THREE.SphereGeometry(0.083, 16, 10), stubble, [0, hy - 0.055, -0.014], [0, 0, 0], [0.92, 0.74, 0.98], (x, y, z) => (-z > 0.05 && y > hy - 0.04 ? 1.35 : 1) * (0.9 + 0.1 * Math.sin(x * 300) * Math.sin(y * 260)));
  add(new THREE.BoxGeometry(0.05, 0.035, 0.035), stubble, [0, hy - 0.098, -0.06], [0.25, 0, 0]);
  // brow ridge + brows
  add(new THREE.BoxGeometry(0.098, 0.02, 0.026), skin.map((c) => c * 1.05), [0, hy + 0.034, -0.09], [0.15, 0, 0]);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.034, 0.007, 0.01), mix(hair, [0, 0, 0], 0.2), [s * 0.031, hy + 0.044, -0.1], [0.2, 0, s * -0.14]);
  // eyes (dark iris, a dull white either side) sunk in the sockets
  for (const s of [-1, 1]) {
    ball(0.011, [0.24, 0.22, 0.2], [s * 0.031, hy + 0.017, -0.083], [1.2, 0.7, 0.5], 6, 4);
    ball(0.0055, [0.04, 0.035, 0.03], [s * 0.031, hy + 0.017, -0.0875], [1, 1, 0.5], 5, 3);
    add(new THREE.BoxGeometry(0.03, 0.006, 0.012), skinD, [s * 0.031, hy + 0.003, -0.088]);                       // lower lid / bag
  }
  // nose: bridge wedge + tip + nostrils
  add(new THREE.BoxGeometry(0.022, 0.05, 0.026), skin.map((c) => c * 1.04), [0, hy + 0.0, -0.1], [-0.32, 0, 0]);
  ball(0.013, skin.map((c) => c * 0.95), [0, hy - 0.022, -0.108], [1.2, 0.9, 1], 6, 4);
  for (const s of [-1, 1]) ball(0.009, skinD, [s * 0.012, hy - 0.03, -0.105], [1, 0.7, 1], 5, 3);
  // mouth: dark line + a fuller lower lip
  add(new THREE.BoxGeometry(0.044, 0.007, 0.01), [0.12, 0.08, 0.07], [0, hy - 0.058, -0.096]);
  add(new THREE.BoxGeometry(0.038, 0.009, 0.012), mix(skin, [0.35, 0.15, 0.13], 0.25), [0, hy - 0.066, -0.093]);
  if (o.beard) add(new THREE.SphereGeometry(0.075, 12, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), hair, [0, hy - 0.045, -0.02], [0, 0, 0], [0.95, 1.0, 1.05]);
  for (const s of [-1, 1]) ball(0.024, skin.map((c) => c * 0.88), [s * 0.093, hy + 0.0, 0.012], [0.45, 1.25, 0.85], 6, 5);   // ears
  // hair / beanie / hood
  if (o.hood) {
    add(new THREE.SphereGeometry(0.145, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.64), coat2, [0, hy + 0.012, 0.03], [-0.28, 0, 0], [0.98, 1.1, 1.08], (x, y, z) => (z < -0.06 ? 0.7 : 1));
    add(new THREE.TorusGeometry(0.105, 0.018, 5, 14, Math.PI * 1.2), coat2.map((c) => c * 0.8), [0, hy + 0.0, -0.06], [0.05, 0, -Math.PI * 0.1 + Math.PI * 0.0], [0.95, 1.12, 1]);
  } else if (o.cap) {
    // knitted beanie with a folded brim (ribbed)
    add(new THREE.SphereGeometry(0.115, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.5), o.cap, [0, hy + 0.035, 0.008], [0, 0, 0], [0.92, 1.08, 1.02], (x, y, z) => 0.86 + 0.14 * Math.sin(Math.atan2(z, x) * 14));
    add(new THREE.CylinderGeometry(0.108, 0.11, 0.045, 14, 1, true), o.cap.map((c) => c * 0.82), [0, hy + 0.045, 0.006], [0, 0, 0], [0.94, 1, 1.04], (x, y, z) => 0.8 + 0.2 * Math.sin(Math.atan2(z, x) * 20));
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.02, 0.03, 0.03), hair, [s * 0.088, hy + 0.012, 0.03]);       // hair at the temples
  } else {
    // short hair: a scalp cap with a hairline at the forehead, sideburns, nape
    add(new THREE.SphereGeometry(0.112, 16, 9, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, [0, hy + 0.018, 0.014], [-0.22, 0, 0], [0.91, 1.1, 1.05], (x, y, z) => 0.85 + 0.15 * Math.sin(x * 140 + z * 90));
    add(new THREE.SphereGeometry(0.108, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), hair, [0, hy + 0.0, 0.024], [0.55, 0, 0], [0.9, 1.02, 1.0]);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.014, 0.04, 0.028), hair, [s * 0.088, hy + 0.012, -0.012]);
  }
  if (o.headlamp) {
    add(new THREE.TorusGeometry(0.106, 0.011, 4, 16), [0.08, 0.08, 0.08], [0, hy + 0.058, 0.004], [Math.PI / 2 - 0.12, 0, 0], [0.93, 1.06, 1]);
    add(new THREE.BoxGeometry(0.06, 0.042, 0.032), [0.12, 0.12, 0.12], [0, hy + 0.068, -0.112]);
  }

  // merge
  let n = 0;
  for (const p of parts) n += p.g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let k = 0;
  for (const p of parts) {
    const a = p.g.attributes.position, b = p.g.attributes.normal, t = p.g.attributes.uv;
    for (let i = 0; i < a.count; i++, k++) {
      const x = a.getX(i), y = a.getY(i), z = a.getZ(i);
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      nor[k * 3] = b.getX(i); nor[k * 3 + 1] = b.getY(i); nor[k * 3 + 2] = b.getZ(i);
      uv[k * 2] = t ? t.getX(i) * 2 : 0; uv[k * 2 + 1] = t ? t.getY(i) * 2 : 0;
      // soft ambient occlusion towards the feet + optional per-part shading; ×1.12 offsets the
      // mean of the detail texture
      const ao = 0.74 + 0.26 * Math.min(1, y / 1.2);
      const s = (p.shade ? p.shade(x, y, z) : 1) * ao * 1.12;
      col[k * 3] = p.col[0] * s; col[k * 3 + 1] = p.col[1] * s; col[k * 3 + 2] = p.col[2] * s;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, personMaterial(THREE));
  mesh.name = 'world:person';
  const root = new THREE.Group();
  root.add(mesh);
  if (o.headlamp) {
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.014, 10), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }));
    lamp.position.set(0, hy + 0.068, -0.1285);
    lamp.rotation.y = Math.PI;
    lamp.name = 'world:headlamp';
    root.add(lamp);
  }
  const phase = (o.phase ?? 0) * 6.28;
  root.userData.animate = (t) => {
    const b = Math.sin(t * 1.7 + phase);
    mesh.scale.set(1 + 0.006 * b, 1 + 0.004 * b, 1 + 0.012 * b);     // breathing
    mesh.rotation.z = 0.012 * Math.sin(t * 0.43 + phase);           // weight shifting
    mesh.rotation.x = 0.008 * Math.sin(t * 0.31 + phase * 1.3);
  };
  return root;
}

// Detail texture shared by every survivor: fine fabric weave + blotchy grime + pores. Mean ≈ 0.89.
function detailTex(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const img = g.createImageData(128, 128);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const weave = ((x + y) % 3 === 0 ? -10 : 0) + ((x - y + 300) % 4 === 0 ? -6 : 0);
      const blot = 10 * Math.sin(x * 0.11 + Math.sin(y * 0.07) * 3) * Math.cos(y * 0.09 + Math.sin(x * 0.05) * 2);
      const v = Math.max(0, Math.min(255, 232 + weave + blot + (rnd() - 0.5) * 34));
      const i = (y * 128 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let MAT = null;
function personMaterial(THREE) {
  if (MAT) return MAT;
  let map = null;
  try { map = detailTex(THREE); } catch { map = null; }
  return (MAT = new THREE.MeshLambertMaterial({ vertexColors: true, map, emissive: 0x3a2414, emissiveMap: map, name: 'world:person' }));
}
