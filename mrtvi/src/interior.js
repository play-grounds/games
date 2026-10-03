import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, INTERIOR, PHARMACY_DOOR, heightAt } from './layout.js';

// The pharmacy (lékárna) interior, built in its own cell at layout.INTERIOR.
// Local frame: origin = INTERIOR, x east, z south, floor y = 0.
//   Shop       x −8..8,  z −5..5   (front door in the south wall at x 0, boarded windows either side)
//   Storeroom  x −4..8,  z −11..−5 (doorway in the shared wall at x 3.4..4.6)
// Interior materials ignore the city's hemisphere/directional/ambient light (shader patch), so the
// room has its own faint cool ambient (uIntAmb), cold window light through the boarded front (bright at
// dusk, faint moonlight later), a dying green emergency EXIT sign, and the player's flashlight.

const SHOP = { x0: -8, x1: 8, z0: -5, z1: 5, h: 3.6 };
const STORE = { x0: -4, x1: 8, z0: -11, z1: -5, h: 3.0 };
const DOORWAY = { x0: 3.4, x1: 4.6, h: 2.2 };
const ENTRY = { x: 0, z: 3.3, yaw: 0 };                 // just inside the front door, facing north into the shop
const CASE = { x: 0.5, y: 0.8, z: -10.35 };
const SPAWNS = [[-1.5, -7.5], [4.2, -8.6], [-5.6, 2.4]];   // the third stands between the shelves and the lit windows

export function create(game) {
  const R = rng(4417);
  const O = { x: INTERIOR.x, z: INTERIOR.z };
  const group = new THREE.Group();
  group.name = 'interior';
  group.position.set(O.x, 0, O.z);
  group.visible = false;
  game.scene.add(group);

  // ---------- textures + materials ----------
  const texOf = (k) => {
    let t = game.tex?.[k];
    if (typeof t === 'function') { try { t = t(0); } catch { t = null; } }
    return t && t.isTexture ? t : null;
  };
  const metres = (t, d) => t?.userData?.metres || d;

  // Shader patch: drop directional + hemisphere + ambient + probe light from the city.
  const patchChunk = THREE.ShaderChunk.lights_fragment_begin
    .replace('getAmbientLightIrradiance( ambientLightColor )', 'uIntAmb')
    .replace('getLightProbeIrradiance( lightProbe, geometryNormal )', 'vec3( 0.0 )')
    .replace(/NUM_DIR_LIGHTS > 0/g, 'NUM_DIR_LIGHTS < 0')
    .replace(/NUM_HEMI_LIGHTS > 0/g, 'NUM_HEMI_LIGHTS < 0');
  const AMB = { value: new THREE.Color(0.3, 0.36, 0.48) };   // interior ambient irradiance, shared by all interior materials
  const dark = (m) => {
    m.fog = false;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uIntAmb = AMB;
      sh.fragmentShader = 'uniform vec3 uIntAmb;\n' + sh.fragmentShader.replace('#include <lights_fragment_begin>', patchChunk);
    };
    m.customProgramCacheKey = () => 'mrtvi-interior';
    return m;
  };

  const canvasTex = (w, h, draw, repeat = true) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  const tilesTex = texOf('tiles') || Object.assign(canvasTex(256, 256, (g, w) => {
    const n = 8, s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const k = 0.85 + R() * 0.25;
      g.fillStyle = (i + j) % 2 ? `rgb(${170 * k | 0},${160 * k | 0},${135 * k | 0})` : `rgb(${45 * k | 0},${62 * k | 0},${52 * k | 0})`;
      g.fillRect(i * s, j * s, s, s);
    }
    g.strokeStyle = 'rgba(20,20,15,0.6)'; g.lineWidth = 2;
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, w); g.moveTo(0, i * s); g.lineTo(w, i * s); g.stroke(); }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(30,25,15,${0.1 + R() * 0.2})`; g.beginPath(); g.arc(R() * w, R() * w, 4 + R() * 30, 0, 7); g.fill(); }
  }), { userData: { metres: [2, 2] } });
  const bloodTex = texOf('blood') || canvasTex(128, 128, (g, w) => {
    for (let i = 0; i < 14; i++) {
      const r = 6 + R() * 26, x = w / 2 + (R() - 0.5) * w * 0.45, y = w / 2 + (R() - 0.5) * w * 0.45;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(70,6,6,0.95)'); gr.addColorStop(0.7, 'rgba(55,4,4,0.8)'); gr.addColorStop(1, 'rgba(40,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  }, false);
  const shaftTex = canvasTex(32, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const e = g.createLinearGradient(0, 0, w, 0);
    e.addColorStop(0, 'rgba(0,0,0,1)'); e.addColorStop(0.35, 'rgba(0,0,0,0)'); e.addColorStop(0.65, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = e; g.fillRect(0, 0, w, h);
  }, false);
  const poolTex = canvasTex(64, 64, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  }, false);

  const wallTex = texOf('interiorWall'), plankTex = texOf('plank'), rustTex = texOf('rust');
  const MAT = {
    wall: dark(new THREE.MeshLambertMaterial({ color: wallTex ? 0x9a9284 : 0x5d574b, map: wallTex })),
    floor: dark(new THREE.MeshLambertMaterial({ color: 0xb0aaa0, map: tilesTex })),
    store: dark(new THREE.MeshLambertMaterial({ color: plankTex ? 0x6a5a48 : 0x3a3026, map: plankTex })),
    ceil: dark(new THREE.MeshLambertMaterial({ color: 0x4a4740 })),
    wood: dark(new THREE.MeshPhongMaterial({ color: plankTex ? 0x5a3a24 : 0x3a2416, map: plankTex, shininess: 18, specular: 0x1a1410 })),
    board: dark(new THREE.MeshLambertMaterial({ color: plankTex ? 0x8a7a66 : 0x4e4234, map: plankTex })),
    brass: dark(new THREE.MeshPhongMaterial({ color: 0x8a6a2a, shininess: 60, specular: 0x665533 })),
    metal: dark(new THREE.MeshPhongMaterial({ color: 0x55585a, map: rustTex, shininess: 30, specular: 0x333333 })),
    cloth: dark(new THREE.MeshLambertMaterial({ color: 0xbdb8aa })),
    blanket: dark(new THREE.MeshLambertMaterial({ color: 0x3f4632 })),
    paper: dark(new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: false })),
    blood: dark(new THREE.MeshLambertMaterial({ map: bloodTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, color: 0x7a2020 })),
    glass: dark(new THREE.MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0.62, shininess: 120, specular: 0xaaaaaa, depthWrite: false })),
    shard: dark(new THREE.MeshPhongMaterial({ color: 0x9fb3b0, transparent: true, opacity: 0.55, shininess: 160, specular: 0xffffff, side: THREE.DoubleSide, depthWrite: false })),
    lid: dark(new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 40 })),
    pill: dark(new THREE.MeshLambertMaterial({ color: 0xffffff })),
    box: dark(new THREE.MeshLambertMaterial({ color: 0xffffff })),
    can: dark(new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 70, specular: 0x777777 })),
    caseBody: dark(new THREE.MeshPhongMaterial({ color: 0xc8c4b8, shininess: 70, specular: 0x666666 })),
    caseRed: dark(new THREE.MeshLambertMaterial({ color: 0x9a1010, emissive: 0xff2018, emissiveIntensity: 0.8 })),
    exit: new THREE.MeshBasicMaterial({ map: canvasTex(256, 96, (g, w, h) => {
      g.fillStyle = '#0b5a2a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c8ffd8'; g.font = 'bold 38px sans-serif'; g.textBaseline = 'middle';
      g.fillText('VÝCHOD', 66, 36, 180); g.font = 'bold 22px sans-serif'; g.fillText('EXIT  →', 68, 74);
      g.fillRect(22, 18, 12, 12); g.fillRect(24, 32, 10, 28);                      // running man
      g.save(); g.translate(30, 58); g.rotate(0.5); g.fillRect(0, 0, 8, 26); g.restore();
      g.save(); g.translate(28, 58); g.rotate(-0.5); g.fillRect(-8, 0, 8, 26); g.restore();
      g.fillStyle = 'rgba(0,0,0,0.35)'; for (let i = 0; i < 30; i++) g.fillRect(Math.floor(R() * w), Math.floor(R() * h), 2 + R() * 14, 2 + R() * 6);   // grime
    }, false), fog: false }),
    glow: new THREE.MeshBasicMaterial({ color: 0x1a2738, fog: false }),
    shaft: new THREE.MeshBasicMaterial({ color: 0x24344c, opacity: 1, map: shaftTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
    pool: new THREE.MeshBasicMaterial({ color: 0x1c2a3c, map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -3 }),
  };

  // ---------- geometry helpers (merged per material) ----------
  const parts = {};
  const put = (mat, geo) => (parts[mat] || (parts[mat] = [])).push(geo);
  const E = new THREE.Euler(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
  const mtx = (x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = ONE) => {
    E.set(rx, ry, rz, 'YXZ'); Q.setFromEuler(E); V.set(x, y, z);
    return new THREE.Matrix4().compose(V, Q, s);
  };
  const I = new THREE.Matrix4();
  // Box of size w×h×d centred at (x,y,z) in frame `P`.
  const box = (mat, P, w, h, d, x, y, z, ry = 0, rx = 0, rz = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;               // rough metre-scale UVs
    const s = Math.max(w, h, d) / 1.5;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * s);
    g.applyMatrix4(P.clone().multiply(mtx(x, y, z, ry, rx, rz)));
    put(mat, g);
  };
  const quad = (mat, a, b, c, d, mw = 2, mh = 2) => {
    const g = new THREE.BufferGeometry();
    const pts = [a, b, c, d];
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const lu = a.distanceTo(b), lv = a.distanceTo(d);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, p.z]), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([...n.toArray(), ...n.toArray(), ...n.toArray(), ...n.toArray()], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, lu / mw, 0, lu / mw, lv / mh, 0, lv / mh], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    put(mat, g);
  };
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  // Wall seen from inside: p0 on the viewer's left, p1 on the right.
  const wallM = metres(wallTex, [3, 3]);
  const wall = (x0, z0, x1, z1, y0, y1, mat = 'wall') => {
    const g = quad(mat, v3(x0, y0, z0), v3(x1, y0, z1), v3(x1, y1, z1), v3(x0, y1, z0), wallM[0], wallM[1]);
    // shift v so the texture starts at y0
    const uv = parts[mat].at(-1).attributes.uv;
    for (let i = 0; i < 4; i++) uv.setY(i, uv.getY(i) + y0 / wallM[1]);
    return g;
  };
  const floorQ = (mat, x0, z0, x1, z1, y = 0, m = [2, 2]) => quad(mat, v3(x0, y, z1), v3(x1, y, z1), v3(x1, y, z0), v3(x0, y, z0), m[0], m[1]);
  const ceilQ = (mat, x0, z0, x1, z1, y) => quad(mat, v3(x0, y, z0), v3(x1, y, z0), v3(x1, y, z1), v3(x0, y, z1), 3, 3);
  const flat = (mat, x, z, w, d, ry, y = 0.004) => {
    const c = Math.cos(ry), s = Math.sin(ry);
    const p = (u, v) => v3(x + u * c + v * s, y, z - u * s + v * c);
    quad(mat, p(-w / 2, d / 2), p(w / 2, d / 2), p(w / 2, -d / 2), p(-w / 2, -d / 2), w, d);
  };

  // instanced batches
  const inst = { jar: [], bottle: [], lid: [], pill: [], box: [], shard: [], can: [] };
  const C = new THREE.Color();
  const addI = (kind, m, color) => inst[kind].push([m, color]);
  const S3 = (x, y, z) => new THREE.Vector3(x, y, z);

  // colliders (local → world)
  const solid = (x, z, hx, hz, rot = 0, y1 = 100) => game.collide?.addBox?.(O.x + x, O.z + z, hx, hz, rot, -10, y1);

  // ---------- shell ----------
  floorQ('floor', SHOP.x0, SHOP.z0, SHOP.x1, SHOP.z1, 0, tilesTex.userData?.metres || [2, 2]);
  floorQ('store', STORE.x0, STORE.z0, STORE.x1, STORE.z1, 0, metres(plankTex, [2, 2]));
  ceilQ('ceil', SHOP.x0, SHOP.z0, SHOP.x1, SHOP.z1, SHOP.h);
  ceilQ('ceil', STORE.x0, STORE.z0, STORE.x1, STORE.z1, STORE.h);
  // shop
  wall(-8, -5, DOORWAY.x0, -5, 0, SHOP.h); wall(DOORWAY.x1, -5, 8, -5, 0, SHOP.h); wall(DOORWAY.x0, -5, DOORWAY.x1, -5, DOORWAY.h, SHOP.h);
  wall(8, 5, -8, 5, 0, SHOP.h); wall(-8, 5, -8, -5, 0, SHOP.h); wall(8, -5, 8, 5, 0, SHOP.h);
  // storeroom
  wall(8, -5, DOORWAY.x1, -5, 0, STORE.h); wall(DOORWAY.x0, -5, -4, -5, 0, STORE.h); wall(DOORWAY.x1, -5, DOORWAY.x0, -5, DOORWAY.h, STORE.h);
  wall(-4, -11, 8, -11, 0, STORE.h); wall(-4, -5, -4, -11, 0, STORE.h); wall(8, -11, 8, -5, 0, STORE.h);
  // doorway reveals
  wall(DOORWAY.x0, -5.15, DOORWAY.x0, -4.85, 0, DOORWAY.h); wall(DOORWAY.x1, -4.85, DOORWAY.x1, -5.15, 0, DOORWAY.h);
  quad('wall', v3(DOORWAY.x0, DOORWAY.h, -4.85), v3(DOORWAY.x1, DOORWAY.h, -4.85), v3(DOORWAY.x1, DOORWAY.h, -5.15), v3(DOORWAY.x0, DOORWAY.h, -5.15));
  // skirting + cornice
  for (const [x0, z0, x1, z1] of [[-8, 4.97, 8, 4.97], [-7.97, -5, -7.97, 5], [7.97, -5, 7.97, 5]]) {
    const L = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(-(z1 - z0), x1 - x0);
    box('wood', I, L, 0.14, 0.03, (x0 + x1) / 2, 0.07, (z0 + z1) / 2, ry);
    box('wood', I, L, 0.12, 0.08, (x0 + x1) / 2, SHOP.h - 0.06, (z0 + z1) / 2, ry);
  }
  // doorway frame + door leaf swung into the storeroom
  box('wood', I, 0.08, DOORWAY.h, 0.36, DOORWAY.x0 - 0.04, DOORWAY.h / 2, -5);
  box('wood', I, 0.08, DOORWAY.h, 0.36, DOORWAY.x1 + 0.04, DOORWAY.h / 2, -5);
  box('wood', I, 1.36, 0.1, 0.36, 4, DOORWAY.h + 0.05, -5);
  box('wood', I, 1.15, 2.12, 0.045, DOORWAY.x0 - 0.56, 1.07, -5.2, 0.18);
  // colliders: walls
  solid(-2.3, -5, 5.7, 0.15); solid(6.3, -5, 1.7, 0.15);
  solid(0, 5, 8.3, 0.15); solid(-8, 0, 0.15, 5.3); solid(8, -3, 0.15, 8.3);
  solid(2, -11, 6.3, 0.15); solid(-4, -8, 0.15, 3.2);
  solid(DOORWAY.x0 - 0.15, -5.4, 0.12, 0.6, 0, 3);       // the leaf

  // front door (exit) + boarded windows with weak bluish street light leaking in
  const fz = 4.95;
  box('wood', I, 1.3, 2.35, 0.08, 0, 1.175, 4.92);
  quad('glow', v3(0.4, 1.35, 4.87), v3(-0.4, 1.35, 4.87), v3(-0.4, 2.15, 4.87), v3(0.4, 2.15, 4.87));
  box('board', I, 1.1, 0.12, 0.03, 0, 1.55, 4.84, 0, 0, 0.15);
  box('board', I, 1.1, 0.12, 0.03, 0, 1.92, 4.84, 0, 0, -0.1);
  box('wood', I, 0.1, 2.5, 0.12, -0.7, 1.25, 4.92); box('wood', I, 0.1, 2.5, 0.12, 0.7, 1.25, 4.92); box('wood', I, 1.5, 0.12, 0.12, 0, 2.48, 4.92);
  box('brass', I, 0.04, 0.16, 0.06, -0.48, 1.05, 4.85);
  const windows = [-5, 5];
  const shafts = [], shaftLines = [];
  for (const wx of windows) {
    quad('glow', v3(wx + 1.2, 0.9, fz - 0.02), v3(wx - 1.2, 0.9, fz - 0.02), v3(wx - 1.2, 2.9, fz - 0.02), v3(wx + 1.2, 2.9, fz - 0.02));
    box('wood', I, 2.6, 0.12, 0.25, wx, 0.85, fz - 0.1);   // sill
    box('wood', I, 2.6, 0.1, 0.12, wx, 2.95, fz - 0.05);
    box('wood', I, 0.08, 2.1, 0.12, wx, 1.9, fz - 0.05);   // mullion
    // boards with a few gaps
    let y = 1.0, ns = 0;
    while (y < 2.85) {
      const t = 0.14 + R() * 0.1, gap = R() < 0.35 ? 0.03 + R() * 0.05 : 0.004;
      box('board', I, 2.5 + R() * 0.3, t, 0.035, wx + (R() - 0.5) * 0.2, y + t / 2, fz - 0.14 - R() * 0.02, 0, 0, (R() - 0.5) * 0.14);
      if (gap > 0.02 && ns++ < 4) shafts.push([wx + (R() - 0.5) * 1.6, y + t + gap / 2]);
      y += t + gap;
    }
    box('board', I, 2.9, 0.16, 0.03, wx, 1.8, fz - 0.19, 0, 0, 0.6 * (wx < 0 ? 1 : -1));
  }
  // light shafts: crossed additive quads slanting down into the shop + pools on the floor
  for (const [sx, sy] of shafts) {
    const len = sy / 0.62, ex = sx + (R() - 0.5) * 0.4, ez = fz - 0.2 - len * 0.78;
    const w0 = 0.05, w1 = 0.35 + R() * 0.2;
    quad('shaft', v3(ex - w1, 0.02, ez), v3(ex + w1, 0.02, ez), v3(sx + w0 * 4, sy, fz - 0.2), v3(sx - w0 * 4, sy, fz - 0.2), 1, 1);
    quad('shaft', v3(ex, 0.02, ez - w1 * 0.6), v3(ex, 0.02, ez + w1 * 0.6), v3(sx, sy + w0 * 2, fz - 0.2), v3(sx, sy - w0 * 2, fz - 0.2), 1, 1);
    flat('pool', ex, ez, w1 * 3.2, 0.9, 0, 0.012);
    shaftLines.push([sx, sy, fz - 0.2, ex, 0.05, ez, w1]);
  }
  // fix shaft UVs: v=1 at the window, 0 on the floor → gradient tex is bright at top
  // (quad sets v=lv/1, so normalise)
  if (parts.shaft) for (const g of parts.shaft) { const uv = g.attributes.uv; for (let i = 0; i < 4; i++) uv.setXY(i, i === 0 || i === 3 ? 0 : 1, i < 2 ? 0 : 1); }

  // dead pendant lamps
  for (const [lx, lz] of [[-3, 0], [3, 0], [2, -8]]) {
    const top = lz < -5 ? STORE.h : SHOP.h;
    box('metal', I, 0.015, 0.8, 0.015, lx, top - 0.4, lz);
    const g = new THREE.CylinderGeometry(0.08, 0.28, 0.2, 10, 1, true); g.translate(lx, top - 0.9, lz); put('metal', g);
  }

  // ---------- jars & bottles ----------
  const glassCols = [0x7a4a1c, 0x6a3c14, 0x1d3a6e, 0x2f5a32, 0xb8c4bc, 0xd0d6cc, 0x8a5a24, 0x203c70];
  const lidCols = [0x1c1612, 0xc8c2b0, 0x2a2420, 0x6b5a3a];
  const shelfItems = (P, x, y, z, room) => {
    const lying = R() < 0.06;
    const isJar = R() < 0.55;
    const r = isJar ? 0.05 + R() * 0.025 : 0.03 + R() * 0.015;
    const h = isJar ? Math.min(room, 0.16 + R() * 0.1) : Math.min(room, 0.13 + R() * 0.12);
    const col = C.setHex(glassCols[(R() * glassCols.length) | 0]).clone();
    if (lying) { addI(isJar ? 'jar' : 'bottle', P.clone().multiply(mtx(x, y + r, z, R() * 3, 0, Math.PI / 2, S3(r, h, r)).multiply(mtx(0, -0.5, 0))), col); return; }
    addI(isJar ? 'jar' : 'bottle', P.clone().multiply(mtx(x, y, z, R() * 6, 0, 0, S3(r, h, r))), col);
    if (isJar) addI('lid', P.clone().multiply(mtx(x, y + h, z, 0, 0, 0, S3(r * 0.95, 0.025, r * 0.95))), C.setHex(lidCols[(R() * 4) | 0]).clone());
  };
  // Apothecary unit: local frame faces +z, back at z = −D/2, spans x ±L/2, y 0..H.
  const apothecary = (P, L, H, D, { drawers = true, fill = 0.8, empty = false } = {}) => {
    box('wood', P, L, H, 0.03, 0, H / 2, -D / 2 + 0.015);
    box('wood', P, 0.05, H, D, -L / 2 + 0.025, H / 2, 0); box('wood', P, 0.05, H, D, L / 2 - 0.025, H / 2, 0);
    let base = 0.1;
    if (drawers) {
      const dd = D + 0.14;
      box('wood', P, L, 0.9, dd, 0, 0.45, 0.07);
      box('wood', P, L + 0.06, 0.04, dd + 0.05, 0, 0.92, 0.08);
      const cols = Math.max(2, Math.round(L / 0.42)), cw = L / cols;
      for (let i = 0; i < cols; i++) for (let j = 0; j < 3; j++) {
        const x = -L / 2 + cw * (i + 0.5), y = 0.15 + j * 0.27 + 0.12;
        const open = !empty && R() < 0.12 ? 0.12 + R() * 0.15 : 0;
        box('wood', P, cw - 0.03, 0.24, 0.02, x, y, 0.07 + dd / 2 + 0.01 + open);
        box('brass', P, 0.05, 0.025, 0.025, x, y + 0.02, 0.07 + dd / 2 + 0.03 + open);
      }
      base = 0.94;
    } else {
      box('wood', P, L, 0.1, D, 0, 0.05, 0);
    }
    const levels = 5, sp = (H - 0.25 - base) / levels;
    for (let k = 0; k <= levels; k++) box('wood', P, L - 0.1, 0.025, D - 0.03, 0, base + k * sp, 0);
    const divs = Math.round(L / 1.2);
    for (let i = 1; i < divs; i++) box('wood', P, 0.03, H - base - 0.25, D - 0.03, -L / 2 + (L / divs) * i, base + (H - base - 0.25) / 2, 0);
    box('wood', P, L + 0.12, 0.18, D + 0.08, 0, H - 0.09, 0.04);
    box('wood', P, L + 0.16, 0.05, D + 0.12, 0, H - 0.02, 0.06);
    if (empty) return;
    for (let k = 0; k < levels; k++) {
      const y = base + k * sp + 0.013;
      for (let x = -L / 2 + 0.1; x < L / 2 - 0.08; x += 0.13 + R() * 0.05) if (R() < fill) shelfItems(P, x, y, (R() - 0.5) * 0.1, sp - 0.05);
    }
  };

  // back wall behind the counter: x −7.8..2.8 in four bays
  const bays = [[-7.8, -5.15], [-5.15, -2.5], [-2.5, 0.15], [0.15, 2.8]];
  for (const [a, b] of bays) apothecary(mtx((a + b) / 2, 0, -5 + 0.2), b - a, 3.1, 0.4, { fill: 0.55 + R() * 0.35 });
  solid(-2.5, -4.66, 5.3, 0.36);
  // west wall: three bays, facing east
  for (const [a, b] of [[-4.6, -2.0], [-2.0, 0.6], [0.6, 3.2]]) apothecary(mtx(-8 + 0.2, 0, (a + b) / 2, Math.PI / 2), b - a, 3.1, 0.4, { fill: 0.45 + R() * 0.3 });
  solid(-7.63, -0.7, 0.36, 3.95);
  // free-standing unit in the shop, standing
  apothecary(mtx(4.6, 0, 1.5, Math.PI), 2.4, 1.9, 0.45, { drawers: false, fill: 0.35 });
  solid(4.6, 1.5, 1.22, 0.26);
  // toppled unit, face down, contents spilled around it
  {
    const L = 2.2, H = 1.9, D = 0.42, yaw = 0.25;
    apothecary(mtx(-3.2, D / 2, 1.05, yaw, Math.PI / 2, 0), L, H, D, { drawers: false, empty: true });
    solid(-3.2 + Math.sin(yaw) * H / 2, 1.05 + Math.cos(yaw) * H / 2, L / 2, H / 2, yaw, 0.5);
  }
  // barricade against the back door (east wall, z ≈ −1): stacked units, a cabinet on its side, crates
  box('wood', I, 0.08, 2.2, 1.1, 7.93, 1.1, -1);                         // the back door itself
  box('brass', I, 0.06, 0.04, 0.12, 7.86, 1.05, -0.6);
  apothecary(mtx(7.55, 0, -1.2, -Math.PI / 2 + 0.06), 2.0, 2.2, 0.45, { drawers: false, empty: true });
  apothecary(mtx(6.95, 0, -0.5, -Math.PI / 2 - 0.12, 0, -0.18), 1.6, 1.8, 0.4, { drawers: false, empty: true });
  apothecary(mtx(6.35, 0.22, -1.8, Math.PI * 0.42, 0, Math.PI / 2), 1.2, 1.5, 0.42, { drawers: false, empty: true });
  box('wood', I, 0.6, 0.5, 0.5, 6.6, 0.25, 0.4, 0.3); box('wood', I, 0.5, 0.45, 0.5, 6.7, 0.73, 0.35, 0.1);
  box('board', I, 2.4, 0.15, 0.04, 7.0, 1.1, -1.0, -Math.PI / 2 + 0.2, 0, 0.7);
  box('board', I, 2.2, 0.15, 0.04, 6.6, 0.8, -0.7, -Math.PI / 2 - 0.4, 0, -0.5);
  solid(7.0, -0.9, 1.0, 1.75);

  // ---------- counter + register ----------
  {
    const cx = -2.75, cz = -1.6, L = 8.5;
    box('wood', I, L, 0.95, 0.7, cx, 0.475, cz);
    box('wood', I, L + 0.1, 0.06, 0.8, cx, 0.98, cz);
    for (let i = 0; i < 9; i++) box('wood', I, L / 9 - 0.12, 0.6, 0.03, cx - L / 2 + (L / 9) * (i + 0.5), 0.5, cz + 0.36);   // panels
    box('wood', I, L, 0.1, 0.04, cx, 0.05, cz + 0.38);
    solid(cx, cz, L / 2 + 0.05, 0.42, 0, 1.05);
    // cash register
    const rx = -0.8, ry = 1.01, rz = -1.65;
    box('metal', I, 0.46, 0.22, 0.42, rx, ry + 0.11, rz);
    box('metal', I, 0.46, 0.2, 0.25, rx, ry + 0.28, rz - 0.08, 0, -0.5);
    box('brass', I, 0.3, 0.1, 0.04, rx, ry + 0.45, rz - 0.17);
    box('metal', I, 0.4, 0.09, 0.38, rx, ry + 0.05, rz - 0.3);             // drawer hanging open (behind)
    for (let i = 0; i < 12; i++) box('lid', I, 0.03, 0.02, 0.03, rx - 0.15 + (i % 4) * 0.1, ry + 0.34 + ((i / 4) | 0) * 0.04, rz - 0.04 - ((i / 4) | 0) * 0.06, 0, -0.5);
    // a brass scale and a few boxes on the counter
    box('brass', I, 0.3, 0.03, 0.18, -4.5, 1.03, -1.6); box('brass', I, 0.02, 0.3, 0.02, -4.5, 1.18, -1.6);
    box('brass', I, 0.36, 0.015, 0.015, -4.5, 1.32, -1.6, 0, 0, 0.15);
  }

  // ---------- scattered stuff ----------
  const boxCols = [0xd8d2c0, 0x9cb0c4, 0xc0a070, 0xe0e0d8, 0x7a9a7a, 0xc07060];
  const scatterBox = (x, z, y = 0) => {
    const w = 0.06 + R() * 0.09, h = 0.03 + R() * 0.05, d = 0.03 + R() * 0.06;
    addI('box', mtx(x, y + h / 2, z, R() * 6, 0, 0, S3(w, h, d)), C.setHex(boxCols[(R() * boxCols.length) | 0]).clone());
  };
  const pillCols = [0xf0eee6, 0xe8d070, 0xd06050, 0x7090c0, 0xffffff];
  const scatter = (cx, cz, rad, nPills, nBoxes, nShards, nGlass = 0) => {
    for (let i = 0; i < nPills; i++) {
      const a = R() * 6.28, r = Math.sqrt(R()) * rad;
      addI('pill', mtx(cx + Math.cos(a) * r, 0.006, cz + Math.sin(a) * r, R() * 6, 0, 0, S3(0.006, 0.006, 0.006)), C.setHex(pillCols[(R() * 5) | 0]).clone());
    }
    for (let i = 0; i < nBoxes; i++) { const a = R() * 6.28, r = Math.sqrt(R()) * rad; scatterBox(cx + Math.cos(a) * r, cz + Math.sin(a) * r); }
    for (let i = 0; i < nShards; i++) {
      const a = R() * 6.28, r = Math.sqrt(R()) * rad, s = 0.02 + R() * 0.06;
      addI('shard', mtx(cx + Math.cos(a) * r, 0.004, cz + Math.sin(a) * r, R() * 6, -Math.PI / 2 + (R() - 0.5) * 0.3, 0, S3(s, s * (0.6 + R()), 1)), C.setHex(glassCols[(R() * glassCols.length) | 0]).clone());
    }
    for (let i = 0; i < nGlass; i++) {
      const a = R() * 6.28, r = Math.sqrt(R()) * rad, isJar = R() < 0.5;
      const rr = isJar ? 0.06 : 0.035, h = isJar ? 0.22 : 0.2;
      addI(isJar ? 'jar' : 'bottle', mtx(cx + Math.cos(a) * r, rr, cz + Math.sin(a) * r, R() * 6, 0, Math.PI / 2, S3(rr, h, rr)).multiply(mtx(0, -0.5, 0)), C.setHex(glassCols[(R() * glassCols.length) | 0]).clone());
    }
  };
  scatter(-3.0, 2.4, 1.8, 60, 14, 50, 8);       // around the toppled unit
  scatter(-1.5, -3.2, 1.6, 40, 10, 15, 3);      // behind the counter
  scatter(-6.3, 0, 1.2, 25, 6, 20, 4);          // below the west shelves
  scatter(1.5, 1.5, 1.2, 20, 8, 6, 1);
  scatter(-5, 3.9, 0.9, 0, 0, 30);              // glass under the windows
  scatter(5, 3.9, 0.9, 0, 0, 30);
  scatter(5.8, 1.0, 0.8, 15, 6, 10, 2);

  // pharmacist's white coat crumpled on the floor
  {
    const P = mtx(2.1, 0, -0.6, 0.7);
    box('cloth', P, 0.55, 0.04, 0.95, 0, 0.02, 0, 0, 0, 0.04);
    box('cloth', P, 0.5, 0.05, 0.4, 0.05, 0.05, -0.15, 0.2, 0.08, 0);
    box('cloth', P, 0.13, 0.05, 0.55, -0.42, 0.025, -0.05, 0.6);
    box('cloth', P, 0.13, 0.05, 0.5, 0.38, 0.03, 0.2, -1.1);
    box('cloth', P, 0.3, 0.03, 0.12, 0, 0.045, -0.48, 0, 0.1);
    flat('blood', 2.15, -0.5, 0.6, 0.55, 1.0, 0.07);
  }

  // blood: pool by the counter, a drag trail to the storeroom doorway, through it to the cot
  flat('blood', 0.9, 0.2, 1.1, 0.9, 0.4, 0.004);
  const trail = [[0.9, 0.2], [1.8, -1.2], [2.8, -2.6], [3.6, -3.8], [4.0, -5.0], [4.3, -6.2], [5.2, -7.0], [6.3, -7.6]];
  for (let i = 0; i < trail.length - 1; i++) {
    const [ax, az] = trail[i], [bx, bz] = trail[i + 1];
    const L = Math.hypot(bx - ax, bz - az), ry = Math.atan2(-(bz - az), bx - ax);
    for (let k = 0; k < 3; k++) {
      const t = (k + 0.5) / 3;
      flat('blood', ax + (bx - ax) * t + (R() - 0.5) * 0.1, az + (bz - az) * t + (R() - 0.5) * 0.1, L / 2.2, 0.28 + R() * 0.15, ry + (R() - 0.5) * 0.3, 0.005 + (i * 3 + k) * 0.0003);
    }
  }
  flat('blood', 0.0, -2.0, 0.6, 0.4, 0.3, 0.006);            // smear on counter front side
  quad('blood', v3(1.2, 0.2, -1.24), v3(0.2, 0.2, -1.24), v3(0.2, 0.9, -1.24), v3(1.2, 0.9, -1.24), 1, 0.7);   // hand smear on the counter front
  quad('blood', v3(DOORWAY.x1 + 0.12, 0.6, -4.84), v3(DOORWAY.x1 + 0.6, 0.6, -4.84), v3(DOORWAY.x1 + 0.6, 1.4, -4.84), v3(DOORWAY.x1 + 0.12, 1.4, -4.84), 0.5, 0.8);

  // ---------- storeroom ----------
  // metal racks on the west wall with cardboard boxes
  for (const zc of [-9.4, -6.7]) {
    const P = mtx(-3.65, 0, zc, Math.PI / 2);
    for (const sx of [-1.2, 1.2]) for (const sz of [-0.27, 0.27]) box('metal', P, 0.04, 2.2, 0.04, sx, 1.1, sz);
    for (const y of [0.15, 0.75, 1.35, 1.95]) {
      box('metal', P, 2.44, 0.025, 0.58, 0, y, 0);
      for (let x = -1.05; x < 1.1; x += 0.38 + R() * 0.2) if (R() < 0.6) {
        const w = 0.3 + R() * 0.15, h = 0.2 + R() * 0.25, d = 0.35 + R() * 0.15;
        addI('box', P.clone().multiply(mtx(x, y + 0.013 + h / 2, (R() - 0.5) * 0.1, (R() - 0.5) * 0.3, 0, 0, S3(w, h, d))), C.setHex(R() < 0.7 ? 0x8a6a42 : 0xa08a62).clone());
      }
    }
  }
  solid(-3.65, -8.05, 0.32, 2.6);
  // crates by the north wall
  box('wood', I, 0.8, 0.6, 0.6, 4.4, 0.3, -10.55, 0.05); box('wood', I, 0.6, 0.45, 0.5, 4.4, 0.83, -10.5, -0.2);
  box('wood', I, 0.7, 0.6, 0.6, 5.4, 0.3, -10.5, -0.1);
  solid(4.9, -10.5, 0.95, 0.4);
  // table with the medicine case
  {
    const tx = CASE.x, tz = CASE.z, w = 1.6, d = 0.8, h = 0.76;
    box('wood', I, w, 0.05, d, tx, h + 0.025, tz);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('wood', I, 0.06, h, 0.06, tx + sx * (w / 2 - 0.06), h / 2, tz + sz * (d / 2 - 0.06));
    solid(tx, tz, w / 2, d / 2, 0, 0.8);
    // candle stubs, a torn map
    box('cloth', I, 0.05, 0.06, 0.05, tx - 0.55, h + 0.08, tz + 0.15);
    box('paper', I, 0.4, 0.004, 0.3, tx + 0.45, h + 0.052, tz + 0.1, 0.3);
  }
  // cot + blanket + empty cans (someone hid here)
  {
    const cx = 7.15, cz = -8.1, P = mtx(cx, 0, cz);
    for (const sx of [-0.36, 0.36]) {
      box('metal', P, 0.035, 0.035, 1.9, sx, 0.42, 0);
      for (const sz of [-0.85, 0.85]) box('metal', P, 0.035, 0.42, 0.035, sx, 0.21, sz, 0, (sz > 0 ? 1 : -1) * 0.15, 0);
    }
    box('blanket', P, 0.7, 0.03, 1.85, 0, 0.44, 0);
    box('blanket', P, 0.76, 0.1, 1.0, 0.03, 0.5, 0.35, 0.05, 0, 0.06);
    box('cloth', P, 0.5, 0.1, 0.32, 0, 0.5, -0.72, 0.1);
    flat('blood', cx - 0.9, cz + 0.4, 0.9, 0.7, 0.8, 0.006);
    solid(cx, cz, 0.42, 0.98, 0, 0.5);
    for (let i = 0; i < 14; i++) {
      const lie = R() < 0.6, x = cx - 0.9 + (R() - 0.5) * 1.2, z = cz + (R() - 0.5) * 2.6, r = 0.04, h = 0.11;
      addI('can', lie ? mtx(x, r, z, R() * 6, 0, Math.PI / 2, S3(r, h, r)).multiply(mtx(0, -0.5, 0)) : mtx(x, 0, z, 0, 0, 0, S3(r, h, r)), C.setHex(R() < 0.5 ? 0x8a8a84 : 0x9a6a40).clone());
    }
    box('metal', I, 0.3, 0.32, 0.3, cx - 0.2, 0.16, cz - 1.5);    // bucket-ish
  }
  // high barred window in the storeroom's north wall
  quad('glow', v3(1.2, 2.2, -10.98), v3(2.6, 2.2, -10.98), v3(2.6, 2.75, -10.98), v3(1.2, 2.75, -10.98));
  for (let i = 0; i < 5; i++) box('metal', I, 0.025, 0.6, 0.025, 1.3 + i * 0.3, 2.48, -10.93);
  quad('shaft', v3(1.0, 0.02, -8.6), v3(2.9, 0.02, -8.6), v3(2.6, 2.6, -10.9), v3(1.2, 2.6, -10.9), 1, 1);
  { const uv = parts.shaft.at(-1).attributes.uv; uv.setXY(0, 0, 0); uv.setXY(1, 1, 0); uv.setXY(2, 1, 1); uv.setXY(3, 0, 1); }
  flat('pool', 1.9, -8.8, 1.8, 1.2, 0, 0.012);
  shaftLines.push([1.9, 2.5, -10.9, 1.9, 0.05, -8.6, 0.8]);

  // emergency EXIT / VÝCHOD box above the barricaded back door (east wall)
  box('metal', I, 0.1, 0.26, 0.66, 7.93, 2.45, -1);
  quad('exit', v3(7.875, 2.35, -1.28), v3(7.875, 2.35, -0.72), v3(7.875, 2.55, -0.72), v3(7.875, 2.55, -1.28), 0.56, 0.2);
  scatter(0.5, -9.0, 1.4, 12, 5, 0, 0);

  // ---------- build meshes ----------
  for (const [k, list] of Object.entries(parts)) {
    const mesh = new THREE.Mesh(mergeGeometries(list), MAT[k]);
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    if (k === 'shaft' || k === 'pool') mesh.renderOrder = 3;
    group.add(mesh);
    for (const g of list) g.dispose();
  }
  const lathe = (pts) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 8);
  const IG = {
    jar: [lathe([[0, 0], [0.95, 0], [1, 0.05], [1, 0.85], [0.8, 0.92], [0.75, 1]]), MAT.glass],
    bottle: [lathe([[0, 0], [0.95, 0], [1, 0.05], [1, 0.6], [0.45, 0.75], [0.35, 0.8], [0.35, 1]]), MAT.glass],
    lid: [new THREE.CylinderGeometry(1, 1, 1, 8).translate(0, 0.5, 0), MAT.lid],
    pill: [new THREE.CylinderGeometry(1, 1, 0.8, 6), MAT.pill],
    box: [new THREE.BoxGeometry(1, 1, 1), MAT.box],
    shard: [new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.4, 0, 0.5, -0.5, 0, 0.1, 0.6, 0], 3)).setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3)), MAT.shard],
    can: [new THREE.CylinderGeometry(1, 1, 1, 8).translate(0, 0.5, 0), MAT.can],
  };
  for (const [k, list] of Object.entries(inst)) {
    if (!list.length) continue;
    const [geo, mat] = IG[k];
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([m, c], i) => { im.setMatrixAt(i, m); im.setColorAt(i, c); });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
  }

  // ---------- the medicine case ----------
  const caseMesh = new THREE.Group();
  caseMesh.position.set(CASE.x, CASE.y, CASE.z);
  caseMesh.rotation.y = 0.12;
  const cb = (mat, w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); caseMesh.add(m); };
  cb(MAT.caseBody, 0.52, 0.18, 0.36, 0, 0.09, 0);
  cb(MAT.metal, 0.53, 0.012, 0.37, 0, 0.12, 0);
  cb(MAT.caseRed, 0.2, 0.004, 0.06, 0, 0.182, 0); cb(MAT.caseRed, 0.06, 0.004, 0.2, 0, 0.182, 0);
  cb(MAT.caseRed, 0.14, 0.04, 0.004, 0, 0.08, 0.181); cb(MAT.caseRed, 0.04, 0.14, 0.004, 0, 0.08, 0.181);
  cb(MAT.metal, 0.16, 0.025, 0.025, 0, 0.2, 0.0);
  cb(MAT.metal, 0.03, 0.04, 0.03, -0.17, 0.12, 0.185); cb(MAT.metal, 0.03, 0.04, 0.03, 0.17, 0.12, 0.185);
  group.add(caseMesh);

  // ---------- lights (always in the scene; intensity 0 when outside so no shader recompiles) ----------
  const lights = [];
  const addLight = (l, x, y, z, I0) => { l.position.set(O.x + x, y, O.z + z); l.userData.I0 = I0; l.intensity = 0; game.scene.add(l); lights.push(l); return l; };
  addLight(new THREE.PointLight(0x7088b8, 0, 6, 2), 1.9, 2.4, -10.2, 2.2);   // storeroom high window
  const spot = addLight(new THREE.SpotLight(0x7f9cc8, 0, 10, 0.55, 0.9, 1.6), -5, 2.6, 4.6, 14);
  spot.target.position.set(O.x - 4.6, 0, O.z + 1.4); game.scene.add(spot.target);

  // window bounce: cool points just inside each shuttered window + a spot raking each one onto the floor
  [
    addLight(new THREE.PointLight(0x8aa4cc, 0, 9, 2), -4.6, 2.0, 3.7, 5.0),
    addLight(new THREE.PointLight(0x8aa4cc, 0, 9, 2), 4.6, 2.0, 3.7, 5.0),
  ];
  const spot2 = addLight(new THREE.SpotLight(0x7f9cc8, 0, 10, 0.55, 0.9, 1.6), 5, 2.6, 4.6, 14);
  spot2.target.position.set(O.x + 3.6, 0, O.z - 0.2); game.scene.add(spot2.target);
  const exitLight = addLight(new THREE.PointLight(0x30ff70, 0, 6, 2), 7.55, 2.4, -1, 1.6);
  const caseLight = addLight(new THREE.PointLight(0xff3020, 0, 1.6, 2), CASE.x, CASE.y + 0.45, CASE.z + 0.15, 0.25);

  // dust motes drifting in the shafts
  const NM = 260, mp = new Float32Array(NM * 3), mseed = [];
  for (let i = 0; i < NM; i++) mseed.push([(R() * shaftLines.length) | 0, R(), R() - 0.5, R() - 0.5, R() * 6.28, 0.3 + R() * 0.7]);
  const motesGeo = new THREE.BufferGeometry(); motesGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const moteTex = canvasTex(16, 16, (g, w) => { const gr = g.createRadialGradient(8, 8, 0, 8, 8, 8); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); }, false);
  const motes = new THREE.Points(motesGeo, new THREE.PointsMaterial({ size: 0.022, map: moteTex, color: 0x9fb4d4, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  motes.frustumCulled = false; motes.renderOrder = 4;
  group.add(motes);
  const moveMotes = (t) => {
    for (let i = 0; i < NM; i++) {
      const [k, u0, a, b, ph, sp] = mseed[i], [x0, y0, z0, x1, y1, z1, w] = shaftLines[k];
      const u = (u0 + t * 0.006 * sp) % 1, s = 0.08 + u * w * 0.9;
      mp[i * 3] = x0 + (x1 - x0) * u + a * s + Math.sin(t * 0.3 * sp + ph) * 0.05;
      mp[i * 3 + 1] = y0 + (y1 - y0) * u + Math.sin(t * 0.21 + ph * 2) * 0.06;
      mp[i * 3 + 2] = z0 + (z1 - z0) * u + b * s + Math.cos(t * 0.27 * sp + ph) * 0.05;
    }
    motesGeo.attributes.position.needsUpdate = true;
  };
  moveMotes(0);

  // dying emergency light: mostly on, buzzes, drops out in bursts
  let exitState = 1, exitTimer = 0;
  const exitFlicker = (dt) => {
    exitTimer -= dt;
    if (exitTimer <= 0) {
      const r = Math.random();
      if (exitState === 1) { exitState = r < 0.5 ? 0 : 2; exitTimer = exitState === 0 ? 0.05 + Math.random() * 0.5 : 0.2 + Math.random() * 0.9; }
      else { exitState = 1; exitTimer = 0.6 + Math.random() * 3.5; }
    }
    if (exitState === 0) return 0.04;
    if (exitState === 2) return Math.random() < 0.45 ? 0.05 : 0.75 + Math.random() * 0.25;   // stutter
    return 0.92 + Math.random() * 0.08;
  };

  // ---------- doors + pickup ----------
  const street = {
    x: PHARMACY_DOOR.x + PHARMACY_DOOR.nx * 1.5, z: PHARMACY_DOOR.z + PHARMACY_DOOR.nz * 1.5,
    yaw: Math.atan2(-PHARMACY_DOOR.nx, -PHARMACY_DOOR.nz),
  };
  const api = { update, inside: false, spawns: SPAWNS.map(([x, z]) => ({ x: O.x + x, z: O.z + z })), group, caseMesh, entry: { x: O.x + ENTRY.x, z: O.z + ENTRY.z, yaw: ENTRY.yaw }, street };

  const teleport = (to, x, z, yaw) => {
    const p = game.player;
    if (!p?.teleport) return;
    p.teleport(x, z, yaw);
    if ('pitch' in p) p.pitch = 0;
    game.audio?.door?.();
    setInside(to === 'pharmacy');
    game.emit?.('teleport', { to, x, z, yaw });
  };
  game.interactables.push({
    pos: new THREE.Vector3(PHARMACY_DOOR.x, heightAt(PHARMACY_DOOR.x, PHARMACY_DOOR.z) + 1.2, PHARMACY_DOOR.z),
    radius: 2.5,
    label: 'Vstoupit do lékárny — Enter the pharmacy',
    enabled: () => !api.inside,
    use: () => teleport('pharmacy', api.entry.x, api.entry.z, api.entry.yaw),
  });
  game.interactables.push({
    pos: new THREE.Vector3(O.x, 1.2, O.z + 4.7),
    radius: 1.8,
    label: 'Odejít na ulici — Leave to the street',
    enabled: () => api.inside,
    use: () => {
      teleport('city', street.x, street.z, street.yaw);
      game.emit?.('noise', { x: PHARMACY_DOOR.x, z: PHARMACY_DOOR.z, radius: 6 });
    },
  });
  game.interactables.push({
    pos: new THREE.Vector3(O.x + CASE.x, 1.0, O.z + CASE.z),
    radius: 2.0,
    label: 'Vzít léky — Take the medicine',
    enabled: () => api.inside && !game.state?.hasMedicine,
    use: () => {
      if (game.state) game.state.hasMedicine = true;
      caseMesh.visible = false;
      game.audio?.pickup?.();
      game.emit?.('pickup', { item: 'medicine' });
    },
  });

  function setInside(v) {
    api.inside = v;
    group.visible = v;
    for (const l of lights) l.intensity = v ? l.userData.I0 : 0;
  }
  function update() {
    try {
      const p = game.player?.pos;
      if (p) {
        const v = p.x > 1000;
        if (v !== api.inside) setInside(v);
      }
      if (game.state?.hasMedicine && caseMesh.visible) caseMesh.visible = false;
      if (api.inside) {
        const t = game.time?.t || 0, dt = Math.min(game.time?.dt || 1 / 60, 0.1);
        const h = ((game.time?.hour ?? 18.6) % 24 + 24) % 24;
        const dusk = h >= 12 ? Math.min(1, Math.max(0, (20.3 - h) / 1.4)) : h < 7 ? 0 : 1;
        const k = 0.28 + 0.72 * dusk;                                       // moonlight floor
        const f = 0.88 + 0.12 * Math.sin(t * 0.7) * Math.sin(t * 1.9 + 1);  // clouds
        const win = k * f;
        for (const l of lights) l.intensity = l.userData.I0 * win;
        const ex = exitFlicker(dt);
        exitLight.intensity = exitLight.userData.I0 * ex;
        MAT.exit.color.setScalar(0.15 + 0.85 * ex);
        caseLight.intensity = caseMesh.visible ? caseLight.userData.I0 * (0.7 + 0.3 * Math.sin(t * 2.3)) : 0;
        MAT.caseRed.emissiveIntensity = 0.55 + 0.35 * Math.sin(t * 2.3);
        MAT.glow.color.setRGB(0.16, 0.22, 0.33).multiplyScalar(0.35 + 0.9 * win);
        MAT.shaft.color.setRGB(0.2, 0.27, 0.4).multiplyScalar(0.12 + 0.88 * win);
        MAT.pool.color.setRGB(0.12, 0.16, 0.24).multiplyScalar(0.25 + 0.75 * win);
        AMB.value.setRGB(0.3, 0.36, 0.48).multiplyScalar(0.75 + 0.25 * win);
        moveMotes(t);
      }
    } catch (e) { /* never throw from update */ }
  }
  return api;
}
