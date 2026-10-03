// The city: terrain, river, Charles Bridge, Old Town, Malá Strana, Nerudova, the Castle,
// continuous façade rows along every street, block filler, and apocalypse dressing.
// See CONTRACT.md § src/world.js. All coordinates come from layout.js.
import { Batches, frame, sub, P, WHITE } from './world/geom.js';
import { buildLandmarks } from './world/landmarks.js';
import { buildProps } from './world/props.js';

export function create(game) {
  const t0 = performance.now();
  const { THREE, layout: L } = game;
  const H = L.heightAt;
  const R = L.rng(4242);
  const debug = game.params?.has?.('worlddebug');
  const B = new Batches(true);
  const group = new THREE.Group();
  group.name = 'world';
  game.scene.add(group);

  // ---------- textures + materials ----------
  const texCache = new Map();
  function T(name, i) {
    const k = name + ':' + (i ?? '');
    if (texCache.has(k)) return texCache.get(k);
    let v = null;
    try {
      v = game.tex?.[name];
      if (typeof v === 'function') v = v(i ?? 0);
      if (!v || !v.isTexture) v = null;
    } catch { v = null; }
    texCache.set(k, v);
    return v;
  }
  const FALLBACK_M = { cobble: [4, 4], paving: [2, 2], asphalt: [4, 4], stone: [3, 3], roof: [2, 2], slate: [2, 2], plank: [1, 2], rust: [1.5, 1.5], wall: [4, 4], blood: [2, 2], plaster: [12, 12], facadeWide: [24, 12], cloth: [0.5, 0.5], poster: [0.6, 0.85] };
  const metres = (name, i) => T(name, i)?.userData?.metres || FALLBACK_M[name] || [2, 2];

  const COL = {
    roof: 0x8a4632, slate: 0x3c4046, stone: 0x6a645a, wall: 0xa8a092, cobble: 0x55524c, paving: 0x6e6a62,
    asphalt: 0x38383a, plank: 0x5e4a36, rust: 0x5c3e2c, dark: 0x0b0b0d, metal: 0x2e3032, olive: 0x46492f,
    copper: 0x5d8f7a, bronze: 0x2e3a34, skin: 0x9c7c68, glass: 0x141a1e, white: 0xb0aca2, sand: 0x7c6f54,
    car: 0xffffff, paint: 0xffffff, bag: 0x2c2a28, red: 0x7a1a14, canvas: 0x6e6a58, char: 0x161412, gold: 0x8a7440, earth: 0x3a3428,
  };
  // A small procedural grime/scuff texture for painted metal, canvas and plastic props
  // (world-owned so painted props stop reading as flat untextured boxes).
  function grimeTex() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d'), GR = L.rng(515);
    g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1400; i++) {
      const v = 150 + Math.floor(GR() * 90);
      g.fillStyle = `rgba(${v},${v},${v},0.25)`;
      g.fillRect(GR() * 256, GR() * 256, 1 + GR() * 6, 1 + GR() * 6);
    }
    for (let i = 0; i < 60; i++) {                           // rain streaks
      const x = GR() * 256, y = GR() * 200, h = 20 + GR() * 90;
      const gr = g.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0, 'rgba(70,64,56,0.35)'); gr.addColorStop(1, 'rgba(70,64,56,0)');
      g.fillStyle = gr; g.fillRect(x, y, 1 + GR() * 3, h);
    }
    for (let i = 0; i < 26; i++) {                           // rust / mud blotches
      const x = GR() * 256, y = GR() * 256, r = 3 + GR() * 16;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, GR() < 0.5 ? 'rgba(110,62,30,0.55)' : 'rgba(60,54,44,0.5)'); gr.addColorStop(1, 'rgba(90,60,40,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const gr = g.createLinearGradient(0, 256, 0, 170);       // dirt along the bottom
    gr.addColorStop(0, 'rgba(50,44,36,0.55)'); gr.addColorStop(1, 'rgba(50,44,36,0)');
    g.fillStyle = gr; g.fillRect(0, 170, 256, 86);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.userData.metres = [1.5, 1.5];
    return t;
  }
  let grimeT = null;
  const grime = () => (grimeT ||= (() => { try { return grimeTex(); } catch { return null; } })());
  // Landmark silhouettes: the same fog colour but a thinner fog, so towers and the castle
  // still read as dark shapes at 150–400 m instead of dissolving into grey boards.
  function thinFog(m, k) {
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>',
        `#ifdef USE_FOG
          #ifdef FOG_EXP2
            float fogD = fogDensity * ${k.toFixed(2)};
            float fogFactor = 1.0 - exp( - fogD * fogD * vFogDepth * vFogDepth );
          #else
            float fogFactor = smoothstep( fogNear, fogFar / ${k.toFixed(2)}, vFogDepth );
          #endif
          gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
        #endif`);
    };
    m.customProgramCacheKey = () => 'thinfog' + k;
    return m;
  }
  const matCache = new Map();
  function mats(key) {
    if (matCache.has(key)) return matCache.get(key);
    let m;
    const lam = (map, color, extra = {}) => new THREE.MeshLambertMaterial({ map, color: map && map !== grimeT ? 0xffffff : color, vertexColors: true, ...extra });
    let mm;
    if ((mm = /^pl(\d)$/.exec(key))) m = lam(T('plaster', +mm[1]), [0xb8a27e, 0xc8bea0, 0xb58e7a, 0x9ea686, 0x8e98a2, 0xb69a90, 0xbfae76, 0xaaa496][+mm[1]]);
    else if ((mm = /^fw(\d)$/.exec(key))) m = lam(T('facadeWide', +mm[1]), [0xb0a07c, 0xa49c88, 0xb08c78, 0x98a088][+mm[1]]);
    else if ((mm = /^poster(\d)$/.exec(key))) m = lam(T('poster', +mm[1]), 0xd8d2c0, { side: THREE.DoubleSide });
    else if ((mm = /^cloth(\d)$/.exec(key))) m = lam(T('cloth', +mm[1]), [0x6a5a48, 0x4a5262, 0x7a7466, 0x5a3a36, 0x8a8678, 0x3c4434][+mm[1]], { side: THREE.DoubleSide });
    else if (key === 'fire') m = new THREE.MeshBasicMaterial({ color: 0xffa040, vertexColors: true });
    else if (key === 'ember') m = new THREE.MeshBasicMaterial({ color: 0xff5a18, vertexColors: true });
    else if (key === 'water') m = new THREE.MeshStandardMaterial({ color: 0x26323a, roughness: 0.62, metalness: 0.0 });   // glossier water blew a sun highlight into bloom
    else if (key === 'blood') {
      const t = T('blood');
      m = new THREE.MeshLambertMaterial({ map: t, color: t ? 0xffffff : 0x3a0806, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -4, vertexColors: true, opacity: t ? 1 : 0.8 });
    } else if (key === 'paper') m = lam(null, 0xb8b2a2, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2 });
    else if (key === 'sign') m = lam(T('sign_lekarna'), 0x2f6b3a, { emissive: 0x0c140c });
    else if (key === 'clock') {
      const ct = T('clockFace');
      m = new THREE.MeshLambertMaterial({ map: ct, color: ct ? 0xffffff : 0x8a7440, emissive: 0xffffff, emissiveIntensity: 0.2, emissiveMap: ct, transparent: !!ct, alphaTest: 0.3, side: THREE.DoubleSide });
    } else if (key === 'plazaPave') m = lam(T('paving'), COL.paving);
    else if (key === 'stoneLight') m = lam(T('stoneLight') || T('stone'), T('stoneLight') ? 0xffffff : 0xb2a890);
    else if ((mm = /^(stone|slate|copper|stoneLight|wall)Far$/.exec(key))) {
      const base = mm[1], tx = base === 'stoneLight' ? T('stoneLight') || T('stone') : base === 'copper' ? null : T(base);
      m = thinFog(lam(tx, tx ? 0xffffff : (base === 'copper' ? COL.copper : COL[base] ?? 0x808080)), base === 'copper' || base === 'slate' ? 0.3 : 0.38);
    } else if (key === 'lantern') m = new THREE.MeshLambertMaterial({ color: 0x2a1a08, emissive: 0xffa040, emissiveIntensity: 1.4, vertexColors: true });
    else if (['paint', 'white', 'olive', 'red', 'bag', 'metal'].includes(key)) m = lam(grime(), { paint: 0xffffff, white: 0xb0aca2, olive: 0x4c5034, red: 0x7a1a14, bag: 0x2c2a28, metal: 0x3a3c3e }[key]);
    else if (key === 'tarp') m = lam(grime(), 0x5c6248, { side: THREE.DoubleSide });
    else if (key === 'wire') m = new THREE.MeshBasicMaterial({ color: 0x111111, vertexColors: true });
    else if (['cobble', 'paving', 'asphalt', 'stone', 'roof', 'slate', 'plank', 'rust', 'wall'].includes(key)) m = lam(T(key), COL[key]);
    else if (key === 'car') m = lam(T('rust'), 0x6a4a36);
    else if (key === 'canvas') m = lam(grime(), 0x8a8a70, { side: THREE.DoubleSide });
    else if (key === 'sand') m = lam(null, 0x8a7c5c);
    else m = lam(null, COL[key] ?? 0x808080);
    m.name = 'world:' + key;
    matCache.set(key, m);
    return m;
  }

  // ---------- occupancy grid (1 m) for lots / filler ----------
  const G = { x0: -440, z0: -190, x1: 380, z1: 180 };
  G.nx = G.x1 - G.x0; G.nz = G.z1 - G.z0;
  const occ = new Uint8Array(G.nx * G.nz);       // 0 free, 1 street, 2 reserved, 3 river, 4 lot, 5 street buffer
  const gi = (x, z) => {
    const i = Math.floor(x - G.x0), j = Math.floor(z - G.z0);
    return i < 0 || j < 0 || i >= G.nx || j >= G.nz ? -1 : j * G.nx + i;
  };
  for (let j = 0; j < G.nz; j++) {
    const z = G.z0 + j + 0.5;
    for (let i = 0; i < G.nx; i++) {
      const x = G.x0 + i + 0.5;
      let v = 0;
      if (x > L.RIVER.x0 - 1.6 && x < L.RIVER.x1 + 1.6) v = 3;
      else if (x > -365 && x < 310 && z > -120 && z < 112) {
        const n = L.nearestStreet(x, z), cd = n.d - n.street.width / 2;
        if (cd < 0.6 || L.inPlaza(x, z, 0.6)) v = 1;
        else if (cd < 1.4 || L.inPlaza(x, z, 1.4)) v = 5;     // buffer: lots may use it, filler may not
      }
      occ[j * G.nx + i] = v;
    }
  }
  // Rasterise an oriented rect (frame F, u0..u1, v0..v1) into occ with value val.
  function stamp(F, u0, u1, v0, v1, val, onlyFree = false) {
    for (let u = u0; u <= u1; u += 0.5) {
      for (let v = v0; v <= v1; v += 0.5) {
        const [x, , z] = P(F, u, 0, v);
        const k = gi(x, z);
        if (k >= 0 && (!onlyFree || occ[k] === 0 || occ[k] === 5)) occ[k] = val;
      }
    }
  }
  function rectFree(F, u0, u1, v0, v1) {
    const nu = Math.max(2, Math.ceil((u1 - u0) / 0.9)), nv = Math.max(2, Math.ceil((v1 - v0) / 0.9));
    for (let a = 0; a <= nu; a++) {
      for (let b = 0; b <= nv; b++) {
        const [x, , z] = P(F, u0 + (u1 - u0) * a / nu, 0, v0 + (v1 - v0) * b / nv);
        const k = gi(x, z);
        if (k < 0) return false;
        const o = occ[k];
        if (o !== 0 && o !== 5 && o !== 1) return false;
        if (o !== 0 && L.mustStayClear(x, z, 0.52)) return false;
      }
    }
    return true;
  }
  const reserveAxis = (x0, x1, z0, z1) => stamp(frame(0, 0, 0, 0), x0, x1, z0, z1, 2);

  // ---------- colliders ----------
  const solids = [];
  const warnings = [];
  function solid(x, z, hx, hz, rot = 0, y0 = -10, y1 = 100, narrow = false) {
    if (!narrow && y0 < H(x, z) + 2.2) {
      const F = frame(x, 0, z, rot);
      check: for (let u = -hx + 0.05; u <= hx - 0.05 + 1e-6; u += Math.max(0.25, Math.min(0.5, hx))) {
        for (let v = -hz + 0.05; v <= hz - 0.05 + 1e-6; v += Math.max(0.25, Math.min(0.5, hz))) {
          const [px, , pz] = P(F, u, 0, v);
          if (L.mustStayClear(px, pz, 0.5) && !(px > L.RIVER.x0 && px < L.RIVER.x1)) {
            warnings.push(`collider ${x.toFixed(1)},${z.toFixed(1)} ${hx.toFixed(1)}x${hz.toFixed(1)} hits clear at ${px.toFixed(1)},${pz.toFixed(1)}`);
            break check;
          }
        }
      }
    }
    solids.push([x, z, hx, hz]);
    return game.collide.addBox(x, z, hx, hz, rot, y0, y1);
  }

  const W = {
    game, THREE, L, H, R, B, T, metres, mats, frame, sub, P, WHITE, solid, stamp, rectFree, reserveAxis, occ, gi,
    lamps: [], fires: [], spawns: [], updaters: [], debug,
    tint(r, g, b) { return [r, g, b]; },
  };

  // ---------- terrain, plazas ----------
  const cm = metres('cobble'), pm = metres('paving')[0];
  // Plazas are part of the terrain mesh (cells split on their edges) rather than an
  // offset overlay: the old polygon-offset overlay pushed its depth towards the camera
  // at grazing angles, flattening the paving and swallowing the viewmodel.
  const paved = L.PLAZAS.filter((p) => p.name !== 'courtyard');
  const inPaved = (x, z) => paved.some((p) => Math.abs(x - p.x) < p.w / 2 && Math.abs(z - p.z) < p.d / 2);
  function terrainStrip(xa, xb, za, zb, dx, dz, m) {
    const xs = [];
    for (let x = xa; x < xb - 1e-6; x += dx) xs.push(x);
    xs.push(xb);
    // add knots where the hill bends
    for (let x = L.HILL.top; x <= L.HILL.start; x += 3) if (x > xa && x < xb) xs.push(x);
    const zs = [];
    for (let z = za; z < zb - 1e-6; z += dz) zs.push(z);
    zs.push(zb);
    for (const p of paved) {
      for (const x of [p.x - p.w / 2, p.x + p.w / 2]) if (x > xa && x < xb) xs.push(x);
      for (const z of [p.z - p.d / 2, p.z + p.d / 2]) if (z > za && z < zb) zs.push(z);
      for (let x = p.x - p.w / 2 + 4; x < p.x + p.w / 2; x += 8) if (x > xa && x < xb) xs.push(x);
      for (let z = p.z - p.d / 2 + 8; z < p.z + p.d / 2; z += 8) if (z > za && z < zb) zs.push(z);
    }
    xs.sort((a, b) => a - b);
    zs.sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i++) {
      const x0 = xs[i], x1 = xs[i + 1];
      if (x1 - x0 < 0.01) continue;
      for (let j = 0; j < zs.length - 1; j++) {
        const z = zs[j], z1 = zs[j + 1];
        if (z1 - z < 0.01) continue;
        const pv = inPaved((x0 + x1) / 2, (z + z1) / 2), mm = pv ? pm : m;
        B.quad(pv ? 'plazaPave' : 'cobble', [x0, H(x0, z1), z1], [x1, H(x1, z1), z1], [x1, H(x1, z), z], [x0, H(x0, z), z],
          [[x0 / mm, -z1 / mm], [x1 / mm, -z1 / mm], [x1 / mm, -z / mm], [x0 / mm, -z / mm]]);
      }
    }
  }
  terrainStrip(G.x0, L.RIVER.x0, G.z0, G.z1, 10, 40, cm[0]);
  terrainStrip(L.RIVER.x1, G.x1, G.z0, G.z1, 10, 40, cm[0]);

  // ---------- river, embankments ----------
  {
    const RV = L.RIVER, zA = G.z0 - 200, zB = G.z1 + 200;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(RV.x1 - RV.x0, zB - zA).rotateX(-Math.PI / 2), mats('water'));
    water.position.set((RV.x0 + RV.x1) / 2, RV.water, (zA + zB) / 2);
    water.name = 'world:water';
    group.add(water);
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(RV.x1 - RV.x0, zB - zA).rotateX(-Math.PI / 2), mats('earth'));
    bed.position.set((RV.x0 + RV.x1) / 2, RV.bed, (zA + zB) / 2);
    group.add(bed);
    const sm = metres('stone')[0];
    const hw = L.BRIDGE.width / 2;
    for (const side of [-1, 1]) {
      const x = side < 0 ? RV.x0 : RV.x1;
      for (const [za, zb] of [[zA, -hw - 0.6], [hw + 0.6, zB]]) {
        // vertical wall facing the water
        const F = frame(x, 0, 0, side < 0 ? -Math.PI / 2 : Math.PI / 2);
        // in F: u along -z (or +z), v away from water... simpler: emit quads directly
        const p = (zz, y) => [x, y, zz];
        if (side > 0) B.quad('stone', p(za, RV.bed), p(zb, RV.bed), p(zb, 0), p(za, 0), [[za / sm, RV.bed / sm], [zb / sm, RV.bed / sm], [zb / sm, 0], [za / sm, 0]], [0.5, 0.48, 0.45]);
        else B.quad('stone', p(zb, RV.bed), p(za, RV.bed), p(za, 0), p(zb, 0), [[zb / sm, RV.bed / sm], [za / sm, RV.bed / sm], [za / sm, 0], [zb / sm, 0]], [0.5, 0.48, 0.45]);
        void F;
        // low parapet along the quay edge
        const pw = 0.5;
        const xa = side < 0 ? x - pw : x, xb = side < 0 ? x : x + pw;
        B.box('stone', frame(0, 0, 0, 0), xa, xb, -0.2, 0.95, za, zb, { mw: sm, mh: sm, skip: 'bottom', col: [0.45, 0.43, 0.4] });
        // collider along the embankment edge (over the water, so no street is touched)
        const zc = (Math.max(za, G.z0) + Math.min(zb, G.z1)) / 2, hz = (Math.min(zb, G.z1) - Math.max(za, G.z0)) / 2;
        solid(side < 0 ? x + 0.4 : x - 0.4, zc, 0.6, hz, 0, -10, 100, true);
      }
    }
  }

  // ---------- façade buildings ----------
  // Bands map building height onto the 12 m façade texture: ground floor + piano nobile
  // (0–8.2 m), extra storeys repeat the 4.6–8.2 band, then the top storey + cornice.
  const FAC = 12;
  function facadeBands(Hb, below) {
    const bands = [];
    if (below > 0.01) bands.push([-below, 0, 0, 0.6]);
    if (Hb <= 12.1) {
      bands.push([0, Hb, 0, Hb]);
      return bands;
    }
    bands.push([0, 8.2, 0, 8.2]);
    let y = 8.2;
    const extra = Hb - 12;
    const k = Math.round(extra / 3.6);
    for (let i = 0; i < k; i++) { bands.push([y, y + 3.6, 4.6, 8.2]); y += 3.6; }
    bands.push([y, y + 3.8, 8.2, 12]);
    return bands;
  }
  // Four walls in frame F (u0..u1, v0..v1) with banded façade UVs. Heights relative to F.oy.
  function facadeWalls(key, F, u0, u1, v0, v1, bands, opt = {}) {
    const bayM = opt.wide ? 24 : 12, col = opt.col || WHITE, skip = opt.skip || '';
    const faces = [
      ['front', [u1, v0], [u0, v0]], ['back', [u0, v1], [u1, v1]],
      ['right', [u1, v1], [u1, v0]], ['left', [u0, v0], [u0, v1]],
    ];
    for (const [name, a, b] of faces) {
      if (skip.includes(name)) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const bays = Math.max(1, Math.round(len / 3));
      const ue = (bays * 3) / bayM;
      const fc = name === 'front' ? col : opt.sideCol || col;
      for (const [ya, yb, ta, tb] of bands) {
        B.quad(key, P(F, a[0], ya, a[1]), P(F, b[0], ya, b[1]), P(F, b[0], yb, b[1]), P(F, a[0], yb, a[1]),
          [[0, ta / FAC], [ue, ta / FAC], [ue, tb / FAC], [0, tb / FAC]], fc);
      }
    }
  }
  W.facadeWalls = facadeWalls;
  W.facadeBands = facadeBands;

  const roofM = metres('roof')[0], stoneM = metres('stone')[0];
  const lots = [];
  // A street-facing house: F at front-centre on the ground, u along the street, v into the block.
  function house(F, w, d, o = {}) {
    const r = o.R || R;
    const corners = [[-w / 2, 0], [w / 2, 0], [-w / 2, d], [w / 2, d]].map(([u, v]) => { const [x, , z] = P(F, u, 0, v); return H(x, z); });
    const gFront = F.oy, gMin = Math.min(...corners), gMax = Math.max(...corners);
    const storeys = o.storeys ?? (3 + Math.floor(r() * 2.6));
    let Hb = storeys <= 3 ? 12 : 12 + (storeys - 3) * 3.6;
    Hb += Math.max(0, gMax - gFront) * 0.5;
    const below = gFront - gMin + 0.6;
    const wide = o.wide ?? (w > 15 && r() < 0.7);
    const key = o.key || (wide ? 'fw' + Math.floor(r() * 4) : 'pl' + Math.floor(r() * 8));
    const ruined = o.ruined ?? r() < 0.07;
    const tk = 0.78 + r() * 0.22;
    const col = ruined ? [0.42, 0.4, 0.38] : [tk, tk * (0.96 + r() * 0.04), tk * (0.92 + r() * 0.08)];
    let top = ruined ? Hb - 3.6 * Math.floor(1 + r() * 1.5) : Hb;
    facadeWalls(key, F, -w / 2, w / 2, 0, d, facadeBands(top, below), { wide, col, sideCol: col.map((c) => c * 0.85) });
    // plinth + cornice in stone
    B.box('stone', F, -w / 2 - 0.05, w / 2 + 0.05, -below, 0.6, -0.12, 0.2, { mw: stoneM, mh: stoneM, skip: 'bottom,back,top', col: [0.8, 0.8, 0.8] });
    if (!ruined) B.box('stone', F, -w / 2 - 0.2, w / 2 + 0.2, top - 0.3, top + 0.15, -0.35, d + 0.2, { mw: stoneM, mh: stoneM, skip: 'bottom', col: [0.9, 0.88, 0.84] });
    const roofKey = o.roofKey || (r() < 0.12 ? 'slate' : 'roof');
    const rcol = [0.75 + r() * 0.25, 0.75 + r() * 0.2, 0.75 + r() * 0.2];
    if (ruined) {
      // gutted: charred floor, a few charred rafters
      B.box('char', F, -w / 2 + 0.3, w / 2 - 0.3, top - 2.5, top - 2.3, 0.3, d - 0.3, { skip: 'bottom' });
      const n = 2 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const u = -w / 2 + 1 + r() * (w - 2);
        const Fr = sub(F, u, top, d / 2, 0);
        B.box('char', sub(Fr, 0, 0, 0, (r() - 0.5) * 0.3), -0.12, 0.12, -0.12 + r() * 1.5, 0.12 + r() * 1.5, -d / 2, d / 2, { skip: '' });
      }
    } else if (o.frontGable ?? r() < 0.28) {
      const rh = Math.min(9, w * 0.75);
      const Fr = sub(F, 0, 0, d / 2, Math.PI / 2);
      // in Fr: u' = -v (front at u' = +d/2), v' = u
      B.gable(roofKey, Fr, -d / 2, d / 2, -w / 2, w / 2, top + 0.15, rh, { mw: roofM, mh: roofM, col: rcol, gkey: key, gmw: 12, gmh: 12, gybase: 0, gcol: col });
      if (r() < 0.6) B.prism('stone', sub(F, 0, 0, 0), 0, -0.1, 0.12, top + rh, top + rh + 1.2, { sides: 4 });
    } else {
      const rh = Math.min(7, d * 0.42);
      B.gable(roofKey, F, -w / 2, w / 2, 0, d, top + 0.15, rh, { mw: roofM, mh: roofM, col: rcol, gkey: key, gmw: 12, gmh: 12, gybase: 0, gcol: col.map((c) => c * 0.85) });
      // dormers on the street slope
      const nd = r() < 0.65 ? Math.floor(w / 3.6) : 0;
      for (let i = 0; i < nd; i++) {
        const u = -w / 2 + (i + 0.5) * (w / nd);
        const vf = d * 0.16, yb = top + 0.15 + rh * (vf / (d / 2)) - 0.2;
        B.box(key, F, u - 0.75, u + 0.75, yb, yb + 1.6, vf, d * 0.36, { skip: 'bottom,top,back', mw: 12, mh: 12, col });
        B.quad('dark', P(F, u + 0.45, yb + 0.25, vf - 0.02), P(F, u - 0.45, yb + 0.25, vf - 0.02), P(F, u - 0.45, yb + 1.3, vf - 0.02), P(F, u + 0.45, yb + 1.3, vf - 0.02));
        const Fd = sub(F, u, 0, (vf + d * 0.36) / 2, Math.PI / 2);
        B.gable(roofKey, Fd, -(d * 0.36 - vf) / 2, (d * 0.36 - vf) / 2, -0.75, 0.75, yb + 1.6, 0.8, { over: 0.15, mw: roofM, mh: roofM, col: rcol });
      }
      // chimneys
      const nc = 1 + Math.floor(r() * 2.5);
      for (let i = 0; i < nc; i++) {
        const u = -w / 2 + 1 + r() * (w - 2), v = d * (0.3 + r() * 0.4);
        B.box(r() < 0.5 ? 'stone' : key, F, u - 0.35, u + 0.35, top, top + rh + 1.2 + r(), v - 0.35, v + 0.35, { skip: 'bottom', mw: 3, mh: 3, col: [0.6, 0.55, 0.5] });
      }
    }
    // collider
    const [cx, , cz] = P(F, 0, 0, d / 2);
    solid(cx, cz, w / 2, d / 2, F.rot);
    lots.push({ F, w, d, top, key, col, ruined, front: gFront });
    return { top, key, col, below };
  }
  W.house = house;

  // ---------- landmarks reserve space first ----------
  const landmarks = buildLandmarks(W);

  // ---------- street lots ----------
  function placeLot(F, w, d, opts = {}) {
    if (!rectFree(F, -w / 2, w / 2, 0, d)) return false;
    stamp(F, -w / 2, w / 2, 0, d, 4);
    house(F, w, d, opts);
    return true;
  }
  function lotsAlong(ax, az, bx, bz, off, opts = {}) {
    const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
    for (const side of [-1, 1]) {
      if (opts.side && opts.side !== side) continue;
      // n = outward from street towards the lots
      const nx = -dz * side, nz = dx * side;
      const rot = Math.atan2(nx, nz);            // local v = (sin rot, cos rot) = n
      let t = -3;
      while (t < len + 3) {
        let w = opts.wmin + R() * (opts.wmax - opts.wmin);
        let placed = false;
        for (const ww of [w, w * 0.7, 5]) {
          const cx = ax + dx * (t + ww / 2) + nx * off, cz = az + dz * (t + ww / 2) + nz * off;
          const F = frame(cx, H(cx, cz), cz, rot);
          for (const d of [opts.dmin + R() * (opts.dmax - opts.dmin), 8, 5.5]) {
            if (placeLot(F, ww, d, opts.house)) { placed = true; break; }
          }
          if (placed) { w = ww; break; }
        }
        t += placed ? w : 1.5;
      }
    }
  }
  // Plaza edges (inward-facing lots).
  for (const p of L.PLAZAS) {
    const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2, z0 = p.z - p.d / 2, z1 = p.z + p.d / 2;
    const castle = p.name === 'courtyard';
    const hopt = castle ? { key: 'pl6', storeys: 3, wide: false, ruined: false, roofKey: 'slate', frontGable: false } : {};
    const o = { wmin: castle ? 16 : 8, wmax: castle ? 24 : 14, dmin: 11, dmax: 15, house: hopt };
    lotsAlong(x0, z0, x1, z0, 0.6, { ...o, side: -1 });   // north edge, lots to the north
    lotsAlong(x1, z1, x0, z1, 0.6, { ...o, side: -1 });   // south edge
    lotsAlong(x0, z1, x0, z0, 0.6, { ...o, side: -1 });   // west edge
    lotsAlong(x1, z0, x1, z1, 0.6, { ...o, side: -1 });   // east edge
  }
  const MAIN = ['celetna', 'karlova', 'mostecka', 'nerudova'];
  const ordered = [...L.STREETS].sort((a, b) => (MAIN.includes(b.name) ? 1 : 0) - (MAIN.includes(a.name) ? 1 : 0));
  for (const s of ordered) {
    if (s.name === 'bridge') continue;
    const narrow = s.width < 6;
    for (let i = 0; i < s.pts.length - 1; i++) {
      const [ax, az] = s.pts[i], [bx, bz] = s.pts[i + 1];
      lotsAlong(ax, az, bx, bz, s.width / 2 + 0.6, { wmin: narrow ? 6 : 7, wmax: narrow ? 10 : 13, dmin: 10, dmax: 15, house: {} });
    }
  }

  // ---------- block filler (2 m cells, greedy rectangles) ----------
  {
    const C = 2, fx0 = G.x0 + 2, fz0 = G.z0 + 2;
    const cnx = Math.floor((G.nx - 4) / C), cnz = Math.floor((G.nz - 4) / C);
    const free = new Uint8Array(cnx * cnz);
    for (let j = 0; j < cnz; j++) {
      for (let i = 0; i < cnx; i++) {
        let ok = 1;
        for (let a = 0; a < C && ok; a++) for (let b = 0; b < C && ok; b++) {
          if (occ[(fz0 - G.z0 + j * C + b) * G.nx + (fx0 - G.x0 + i * C + a)] !== 0) ok = 0;
        }
        free[j * cnx + i] = ok;
      }
    }
    const inB = (x, z, m) => x > L.BOUNDS.x0 - m && x < L.BOUNDS.x1 + m && z > L.BOUNDS.z0 - m && z < L.BOUNDS.z1 + m;
    for (let j = 0; j < cnz; j++) {
      for (let i = 0; i < cnx; i++) {
        if (!free[j * cnx + i]) continue;
        const maxW = 3 + Math.floor(R() * 6), maxD = 3 + Math.floor(R() * 5);
        let w = 1;
        while (w < maxW && i + w < cnx && free[j * cnx + i + w]) w++;
        let d = 1;
        grow: while (d < maxD && j + d < cnz) {
          for (let a = 0; a < w; a++) if (!free[(j + d) * cnx + i + a]) break grow;
          d++;
        }
        for (let b = 0; b < d; b++) for (let a = 0; a < w; a++) free[(j + b) * cnx + i + a] = 0;
        const x0 = fx0 + i * C, x1 = x0 + w * C, z0 = fz0 + j * C, z1 = z0 + d * C;
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const inCastle = cx > L.CASTLE.x0 && cx < L.CASTLE.x1 && cz > L.CASTLE.z0 && cz < L.CASTLE.z1;
        const gmin = Math.min(H(x0, cz), H(x1, cz)), gmax = Math.max(H(x0, cz), H(x1, cz));
        const far = !inB(cx, cz, 0);
        const Hb = (far ? 12 + R() * 8 : 9 + R() * 5) + (gmax - gmin);
        const F = frame(cx, gmin, cz, 0);
        const key = inCastle ? 'wall' : 'pl' + Math.floor(R() * 8);
        const tk = 0.62 + R() * 0.25;
        facadeWalls(key, F, -(x1 - x0) / 2, (x1 - x0) / 2, -(z1 - z0) / 2, (z1 - z0) / 2, inCastle ? [[-0.6, Hb, 0, Hb]] : facadeBands(Hb, 0.6), { col: [tk, tk, tk * 0.95] });
        const alongX = x1 - x0 >= z1 - z0;
        const rk = inCastle || R() < 0.1 ? 'slate' : 'roof';
        const rc = 0.6 + R() * 0.3;
        if (alongX) B.gable(rk, F, -(x1 - x0) / 2, (x1 - x0) / 2, -(z1 - z0) / 2, (z1 - z0) / 2, Hb, Math.min(6, (z1 - z0) * 0.4), { mw: roofM, mh: roofM, col: [rc, rc, rc], gkey: key, gmw: 12, gmh: 12, gybase: 0, gcol: [tk, tk, tk] });
        else B.gable(rk, sub(F, 0, 0, 0, Math.PI / 2), -(z1 - z0) / 2, (z1 - z0) / 2, -(x1 - x0) / 2, (x1 - x0) / 2, Hb, Math.min(6, (x1 - x0) * 0.4), { mw: roofM, mh: roofM, col: [rc, rc, rc], gkey: key, gmw: 12, gmh: 12, gybase: 0, gcol: [tk, tk, tk] });
        if (inB(cx, cz, 6)) solid(cx, cz, (x1 - x0) / 2, (z1 - z0) / 2, 0);
      }
    }
  }

  // ---------- map edge: hard stop just outside BOUNDS ----------
  {
    const b = L.BOUNDS, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    solid(cx, b.z0 - 1.5, (b.x1 - b.x0) / 2 + 3, 1, 0, -10, 100, true);
    solid(cx, b.z1 + 1.5, (b.x1 - b.x0) / 2 + 3, 1, 0, -10, 100, true);
    solid(b.x0 - 1.5, cz, 1, (b.z1 - b.z0) / 2 + 3, 0, -10, 100, true);
    solid(b.x1 + 1.5, cz, 1, (b.z1 - b.z0) / 2 + 3, 0, -10, 100, true);
  }

  // ---------- props / dressing ----------
  W.lots = lots;
  buildProps(W, landmarks);

  // ---------- build meshes ----------
  const stats = B.build(THREE, mats, group);
  for (const m of W.extraMeshes || []) group.add(m);

  // ---------- spawns ----------
  const spawns = [];
  {
    const SR = L.rng(777);
    const inCastle = (x, z) => x > L.CASTLE.x0 - 2 && x < L.CASTLE.x1 + 2 && z > L.CASTLE.z0 - 2 && z < L.CASTLE.z1 + 2;
    const ok = (x, z) => x > L.BOUNDS.x0 + 2 && x < L.BOUNDS.x1 - 2 && z > L.BOUNDS.z0 + 2 && z < L.BOUNDS.z1 - 2 &&
      !inCastle(x, z) && !L.inRiver(x, z) && L.mustStayClear(x, z, 0) && !game.collide.inside(x, z, 0.6, H(x, z));
    const push = (x, z) => { if (ok(x, z)) spawns.push({ x, z }); };
    for (const s of L.STREETS) {
      if (s.name === 'bridge') continue;
      const step = s.width < 6 ? 5 : 7;
      for (let i = 0; i < s.pts.length - 1; i++) {
        const [ax, az] = s.pts[i], [bx, bz] = s.pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
        for (let t = 2; t < len; t += step * (0.7 + SR() * 0.6)) {
          const lat = (SR() - 0.5) * (s.width - 2);
          push(ax + dx * t - dz * lat, az + dz * t + dx * lat);
        }
      }
    }
    // Old Town Square: dense; Malá Strana square: medium
    for (let i = 0; i < 25; i++) push(L.OTS.x + (SR() - 0.5) * (L.OTS.w - 4), L.OTS.z + (SR() - 0.5) * (L.OTS.d - 4));
    // the rest of the Old Town crowd spread through the alleys off the square
    for (const s of L.STREETS) {
      if (!['melantrichova', 'zelezna', 'liliova', 'husova', 'tynska', 'retezova'].includes(s.name)) continue;
      for (let i = 0; i < s.pts.length - 1; i++) {
        const [ax, az] = s.pts[i], [bx, bz] = s.pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
        for (let t = 3; t < len; t += 4.5 + SR() * 2) { const lat = (SR() - 0.5) * (s.width - 2); push(ax + dx * t - dz * lat, az + dz * t + dx * lat); }
      }
    }
    for (let i = 0; i < 25; i++) push(L.MS_SQUARE.x + (SR() - 0.5) * (L.MS_SQUARE.w - 4), L.MS_SQUARE.z + (SR() - 0.5) * (L.MS_SQUARE.d - 4));
    // a few on the bridge approaches
    for (let i = 0; i < 6; i++) push(-40 + SR() * 80, (SR() - 0.5) * 6);
  }

  // ---------- route check ----------
  if (debug) {
    for (const w of warnings.slice(0, 40)) console.warn('[world]', w);
    console.warn(`[world] ${warnings.length} collider warnings`);
  }
  W.warnings = warnings;

  let firstUpdate = true;
  const ms = Math.round(performance.now() - t0);
  console.log(`[world] built in ${ms} ms: ${stats.calls} meshes, ${stats.tris} tris, ${solids.length} colliders, ${spawns.length} spawns, ${lots.length} lots`);

  return {
    lamps: W.lamps,
    spawns,
    fires: W.fires,
    group,
    warnings,
    update(dt) {
      if (firstUpdate) {
        firstUpdate = false;
        let lit = false;
        game.scene.traverse((o) => { if (o.isLight) lit = true; });
        if (!lit) {                                  // atmos missing: keep the city visible
          game.scene.add(new THREE.HemisphereLight(0xc8d0dc, 0x3a3630, 1.6));
          const sun = new THREE.DirectionalLight(0xffeedd, 1.2);
          sun.position.set(-100, 120, 80);
          game.scene.add(sun);
        }
      }
      for (const u of W.updaters) { try { u(dt); } catch (e) { void e; } }
    },
  };
}
