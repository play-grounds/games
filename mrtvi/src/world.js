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
  const NPL = 12;                                 // plaster façade variants (textures.plaster(i))
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
  // Canvas / tarp: a woven cloth with seams, rain stains and patches over ~2 m (the grime texture's
  // dirt band repeated every 0.5 m and turned every tent into a log cabin).
  function canvasTex() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d'), CR = L.rng(919);
    g.fillStyle = '#bdbab0'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 2) { g.fillStyle = `rgba(0,0,0,${0.04 + CR() * 0.04})`; g.fillRect(0, y, 256, 1); }
    for (let x = 0; x < 256; x += 2) { g.fillStyle = `rgba(255,255,255,${0.03 + CR() * 0.03})`; g.fillRect(x, 0, 1, 256); }
    for (let i = 0; i < 40; i++) {                           // stains
      const x = CR() * 256, y = CR() * 256, r = 8 + CR() * 40;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, CR() < 0.6 ? 'rgba(70,64,50,0.28)' : 'rgba(200,196,180,0.2)'); gr.addColorStop(1, 'rgba(70,64,50,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 30; i++) {                           // vertical drip streaks
      const x = CR() * 256, y = CR() * 160, h = 30 + CR() * 90;
      const gr = g.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0, 'rgba(60,56,46,0.25)'); gr.addColorStop(1, 'rgba(60,56,46,0)');
      g.fillStyle = gr; g.fillRect(x, y, 1 + CR() * 3, h);
    }
    g.fillStyle = 'rgba(40,38,30,0.35)';                     // seams
    g.fillRect(0, 127, 256, 2); g.fillRect(127, 0, 2, 256);
    g.fillStyle = 'rgba(90,92,70,0.45)'; g.fillRect(150, 40, 52, 38);   // a patch
    g.strokeStyle = 'rgba(30,28,22,0.5)'; g.setLineDash([3, 3]); g.strokeRect(150, 40, 52, 38);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
  let canvasT = null;
  const canvasMap = () => (canvasT ||= (() => { try { return canvasTex(); } catch { return null; } })());
  // Warm light pool under a fire: radial gradient, drawn additively on the ground.
  function poolTex() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,170,90,1)'); gr.addColorStop(0.25, 'rgba(200,110,50,0.55)'); gr.addColorStop(0.6, 'rgba(120,60,25,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
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
  // Plaster façade atlas: the 12 plaster variants packed 4×3 into one texture so each 64 m tile
  // draws all its townhouses in one call instead of twelve. The variant is carried in the UV
  // (u + 64·slot); the shader wraps inside the slot and samples with the unwrapped gradients.
  function plasterAtlas() {
    const imgs = [];
    for (let i = 0; i < NPL; i++) { const t = T('plaster', i); if (!t?.image) return null; imgs.push(t); }
    const S = 512, c = document.createElement('canvas');
    c.width = S * 4; c.height = S * 3;
    const g = c.getContext('2d');
    imgs.forEach((t, i) => g.drawImage(t.image, (i % 4) * S, Math.floor(i / 4) * S, S, S));
    // The same red spray-painted words ("POMOC") recur on every copy of a variant; keep the red
    // on a third of the variants, turn it to black/brown spray on a third and half-scrub it off
    // the rest, so a street of neighbouring façades no longer repeats one red tag.
    try {
      for (let i = 0; i < NPL; i++) {
        const mode = i % 3;
        if (mode === 0) continue;
        const x0 = (i % 4) * S, y0 = Math.floor(i / 4) * S, id = g.getImageData(x0, y0, S, S), d = id.data;
        for (let k = 0; k < d.length; k += 4) {
          const r = d[k], gg = d[k + 1], b = d[k + 2];
          if (r < 60 || r < gg * 1.6 || r < b * 1.6) continue;
          const lum = 0.3 * r + 0.59 * gg + 0.11 * b;
          if (mode === 1) { const v = lum * 0.35; d[k] = v * 1.15; d[k + 1] = v; d[k + 2] = v * 0.9; }
          else { const v = 95 + lum * 0.35; d[k] = (r * 0.25 + v * 0.75); d[k + 1] = (gg * 0.25 + v * 0.72); d[k + 2] = (b * 0.25 + v * 0.66); }
        }
        g.putImageData(id, x0, y0);
      }
    } catch (e) { void e; }
    const at = new THREE.CanvasTexture(c);
    at.colorSpace = THREE.SRGBColorSpace;
    at.anisotropy = imgs[0].anisotropy || 4;
    at.wrapS = at.wrapT = THREE.ClampToEdgeWrapping;
    return at;
  }
  let atlasTex;
  try { atlasTex = plasterAtlas(); } catch { atlasTex = null; }
  if (atlasTex) {
    B.remap = (key, uvs) => {
      const mm = /^pl(\d+)$/.exec(key);
      if (!mm) return [key, uvs];
      const o = 64 * (+mm[1]);
      return ['plA', uvs.map(([u, v]) => [Math.min(63.9, Math.max(0, u)) + o, v])];
    };
  }
  // Cheap value noise shared by the ground sheen and the bronze patina shaders.
  const GLSL_NOISE = `
    float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float wNoise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y);
    }`;
  const withWorldPos = (sh, extraVert = '') => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * objectNormal);${extraVert}`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;' + GLSL_NOISE);
  };
  // Wet cobbles: brighter stone, darker puddle patches that pick up a fresnel sky reflection
  // (the fog colour stands in for the sky), so the ground at dusk is not a black void.
  function wetGround(m, k) {
    m.onBeforeCompile = (sh) => {
      withWorldPos(sh);
      sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', `{
          vec3 Vd = normalize(cameraPosition - vWP);
          float fres = pow(1.0 - clamp(Vd.y, 0.0, 1.0), 5.0);
          float pud = smoothstep(0.52, 0.78, wNoise(vWP.xz * 0.19) * 0.7 + wNoise(vWP.xz * 1.1) * 0.3);
          vec3 sky = vec3(0.3, 0.32, 0.35);
          #ifdef USE_FOG
            sky = fogColor;
          #endif
          gl_FragColor.rgb = gl_FragColor.rgb * (1.0 - 0.22 * pud) + sky * fres * (${k.toFixed(2)} + 0.5 * pud);
        }
        #include <fog_fragment>`);
    };
    m.customProgramCacheKey = () => 'wetGround' + k;
    return m;
  }
  // Weathered bronze: dark brown-black in the folds and undersides, verdigris on the upward
  // faces with rain-washed light streaks; Phong so fire and torch light catch the edges.
  function verdigris() {
    const m = new THREE.MeshPhongMaterial({ color: 0xffffff, vertexColors: true, specular: 0x2a3a30, shininess: 24, name: 'world:verdigris' });
    m.onBeforeCompile = (sh) => {
      withWorldPos(sh);
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        {
          float up = clamp(vWN.y * 0.5 + 0.5, 0.0, 1.0);
          float n = wNoise(vWP.xz * 6.0 + vWP.y * 2.0) * 0.6 + wNoise(vec2(vWP.x + vWP.z, vWP.y) * 14.0) * 0.4;
          float streak = smoothstep(0.62, 0.9, wNoise(vec2((vWP.x - vWP.z) * 9.0, vWP.y * 0.8)));
          vec3 dark = vec3(0.04, 0.035, 0.028), verd = vec3(0.07, 0.12, 0.095), lite = vec3(0.2, 0.28, 0.23);
          vec3 c = mix(dark, verd, smoothstep(0.35, 0.85, up * 0.8 + n * 0.35));
          c = mix(c, lite, streak * 0.55 + smoothstep(0.85, 1.0, up) * 0.35);
          diffuseColor.rgb *= c * 1.6;
        }`);
    };
    m.customProgramCacheKey = () => 'verdigris';
    return m;
  }
  // Printed litter: 2×2 atlas of grey newsprint / leaflets (columns of type, a headline, a
  // photo block, folds), mid albedo so it never reads as glowing white quads.
  function paperTex() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d'), PR = L.rng(3131);
    for (let k = 0; k < 4; k++) {
      const ox = (k % 2) * 128, oy = Math.floor(k / 2) * 128;
      const base = 168 + Math.floor(PR() * 30);
      g.fillStyle = `rgb(${base},${base - 4},${base - 14})`; g.fillRect(ox, oy, 128, 128);
      g.fillStyle = 'rgba(40,38,34,0.85)';
      if (k !== 2) g.fillRect(ox + 10, oy + 8, 108 * (0.6 + PR() * 0.4), 12);              // headline
      if (k === 1 || k === 3) { g.fillStyle = 'rgba(70,68,62,0.8)'; g.fillRect(ox + 12, oy + 28, 48, 38); }
      if (k === 2) {                                                                       // leaflet: big red cross
        g.fillStyle = 'rgba(120,30,24,0.8)'; g.fillRect(ox + 52, oy + 18, 24, 60); g.fillRect(ox + 34, oy + 36, 60, 24);
      }
      g.fillStyle = 'rgba(55,52,48,0.55)';
      for (let col = 0; col < 3; col++) for (let y = oy + 28; y < oy + 120; y += 5) {
        const x = ox + 10 + col * 37;
        if ((k === 1 || k === 3) && col < 2 && y < oy + 70) continue;
        if (k === 2 && y < oy + 84) continue;
        g.fillRect(x, y, 30 * (0.6 + PR() * 0.4), 2);
      }
      for (let i = 0; i < 6; i++) {                                                        // mud + creases
        const x = ox + PR() * 128, y = oy + PR() * 128, r = 6 + PR() * 22;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(60,52,40,0.45)'); gr.addColorStop(1, 'rgba(60,52,40,0)');
        g.fillStyle = gr; g.fillRect(ox, oy, 128, 128);
      }
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(ox + 63, oy, 2, 128);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
  const matCache = new Map();
  function mats(key) {
    if (matCache.has(key)) return matCache.get(key);
    let m;
    if (key === 'plA') {
      m = new THREE.MeshLambertMaterial({ map: atlasTex, vertexColors: true });
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
          #ifdef USE_MAP
            float slot = floor(vMapUv.x / 64.0);
            vec2 uv0 = vec2(vMapUv.x - slot * 64.0, vMapUv.y);
            vec2 fw = vec2(fract(uv0.x), uv0.y - floor(uv0.y - 1e-4));
            vec2 cell = vec2(mod(slot, 4.0), 2.0 - floor(slot / 4.0));
            vec2 auv = (cell + clamp(fw, vec2(0.0015), vec2(0.9985))) / vec2(4.0, 3.0);
            diffuseColor *= textureGrad(map, auv, dFdx(uv0) / vec2(4.0, 3.0), dFdy(uv0) / vec2(4.0, 3.0));
          #endif`);
      };
      m.customProgramCacheKey = () => 'plasterAtlas';
      m.name = 'world:plA';
      matCache.set(key, m);
      return m;
    }
    const lam = (map, color, extra = {}) => new THREE.MeshLambertMaterial({ map, color: map && map !== grimeT ? 0xffffff : color, vertexColors: true, ...extra });
    let mm;
    if ((mm = /^pl(\d+)$/.exec(key))) m = lam(T('plaster', +mm[1]), [0xb8a27e, 0xc8bea0, 0xb58e7a, 0x9ea686, 0x8e98a2, 0xb69a90, 0xbfae76, 0xaaa496, 0xb0a48a, 0xa8988c, 0xc0b494, 0x9a9e94][+mm[1]] ?? 0xa8a092);
    else if ((mm = /^fw(\d)$/.exec(key))) m = lam(T('facadeWide', +mm[1]), [0xb0a07c, 0xa49c88, 0xb08c78, 0x98a088][+mm[1]]);
    else if ((mm = /^poster(\d)$/.exec(key))) m = lam(T('poster', +mm[1]), 0xd8d2c0, { side: THREE.DoubleSide });
    else if ((mm = /^cloth(\d)$/.exec(key))) m = lam(T('cloth', +mm[1]), [0x6a5a48, 0x4a5262, 0x7a7466, 0x5a3a36, 0x8a8678, 0x3c4434][+mm[1]], { side: THREE.DoubleSide });
    else if (key === 'fire') m = new THREE.MeshBasicMaterial({ color: 0xffa040, vertexColors: true });
    else if (key === 'ember') m = new THREE.MeshBasicMaterial({ color: 0xff5a18, vertexColors: true });
    else if (key === 'water') m = new THREE.MeshStandardMaterial({ color: 0x26323a, roughness: 0.22, metalness: 0.0, envMapIntensity: 0.6 });   // sheen from atmos' small sky cube (set in update)
    else if (key === 'blood') {
      const t = T('blood');
      m = new THREE.MeshLambertMaterial({ map: t, color: t ? 0xffffff : 0x3a0806, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -4, vertexColors: true, opacity: t ? 1 : 0.8 });
    } else if (key === 'paper') {
      let pt = null;
      try { pt = paperTex(); } catch { pt = null; }
      m = new THREE.MeshLambertMaterial({ map: pt, color: pt ? 0x9c988e : 0x6e6a62, vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2 });
    } else if (key === 'verdigris') m = verdigris();
    else if (key === 'sign') m = lam(T('sign_lekarna'), 0x2f6b3a, { emissive: 0x0c140c });
    else if (key === 'clock') {
      const ct = T('clockFace');
      m = new THREE.MeshLambertMaterial({ map: ct, color: ct ? 0xffffff : 0x8a7440, emissive: 0xffffff, emissiveIntensity: 0.2, emissiveMap: ct, transparent: !!ct, alphaTest: 0.3, side: THREE.DoubleSide });
    } else if (key === 'plazaPave') { m = wetGround(lam(T('paving'), COL.paving), 0.05); if (T('paving')) m.color.setScalar(1.3); }
    else if (key === 'cobble') { m = wetGround(lam(T('cobble'), COL.cobble), 0.06); if (T('cobble')) m.color.setScalar(1.65); }
    else if (key === 'stoneLight') m = lam(T('stoneLight') || T('stone'), T('stoneLight') ? 0xffffff : 0xb2a890);
    else if ((mm = /^(stone|slate|copper|stoneLight|wall)Far$/.exec(key))) {
      const base = mm[1], tx = base === 'stoneLight' ? T('stoneLight') || T('stone') : base === 'copper' ? null : T(base);
      m = thinFog(lam(tx, tx ? 0xffffff : (base === 'copper' ? COL.copper : COL[base] ?? 0x808080)), base === 'copper' || base === 'slate' ? 0.3 : 0.38);
    } else if (key === 'lantern') m = new THREE.MeshLambertMaterial({ color: 0x3a2610, emissive: 0xffb050, emissiveIntensity: 2.2, vertexColors: true });
    else if (['paint', 'white', 'olive', 'red', 'bag', 'metal'].includes(key)) m = lam(grime(), { paint: 0xffffff, white: 0xb0aca2, olive: 0x4c5034, red: 0x7a1a14, bag: 0x2c2a28, metal: 0x3a3c3e }[key]);
    else if (key === 'luggage') m = new THREE.MeshLambertMaterial({ map: canvasMap(), color: 0xc8bca4, vertexColors: true });   // scattered cases: canvas/leather, mid albedo so they never read as black voids
    else if (key === 'tarp') m = new THREE.MeshLambertMaterial({ map: canvasMap(), color: 0x6e7454, vertexColors: true, side: THREE.DoubleSide });
    else if (key === 'dimWin') m = new THREE.MeshLambertMaterial({ color: 0x1a1612, emissive: 0x9a5a28, emissiveIntensity: 0.3, vertexColors: true });
    else if (key === 'firePool') {
      let pt = null;
      try { pt = poolTex(); } catch { pt = null; }
      m = new THREE.MeshBasicMaterial({ map: pt, color: 0x8a5a30, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -6 });
      m.onBeforeCompile = (sh) => {      // additive: fade to black in fog instead of towards the fog colour
        sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', `#ifdef USE_FOG
            #ifdef FOG_EXP2
              gl_FragColor.rgb *= exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
            #else
              gl_FragColor.rgb *= 1.0 - smoothstep( fogNear, fogFar, vFogDepth );
            #endif
          #endif`);
      };
      m.customProgramCacheKey = () => 'firePool';
    }
    else if (key === 'wire') m = new THREE.MeshBasicMaterial({ color: 0x111111, vertexColors: true });
    else if (['cobble', 'paving', 'asphalt', 'stone', 'roof', 'slate', 'plank', 'rust', 'wall'].includes(key)) m = lam(T(key), COL[key]);
    else if (key === 'car') m = lam(T('rust'), 0x6a4a36);
    else if (key === 'canvas') { const cm = canvasMap(); m = new THREE.MeshLambertMaterial({ map: cm, color: 0xb2b296, emissive: 0x1c140c, emissiveMap: cm, vertexColors: true, side: THREE.DoubleSide }); }   // firelit camp canvas: a faint warm floor so tents read at night
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
    // regular knots sit off round numbers: a terrain edge exactly under the camera (e.g. z = 50)
    // put vertices on the camera plane (w = 0) and SwiftShader smeared the cobbles to one texel
    const xs = [xa];
    for (let x = xa + 2.71; x < xb - 1e-6; x += dx) xs.push(x);
    xs.push(xb);
    // add knots where the hill bends
    for (let x = L.HILL.top; x <= L.HILL.start; x += 3) if (x > xa && x < xb) xs.push(x);
    const zs = [za];
    for (let z = za + 3.37; z < zb - 1e-6; z += dz) zs.push(z);
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
  terrainStrip(G.x0, L.RIVER.x0, G.z0, G.z1, 8, 16, cm[0]);
  terrainStrip(L.RIVER.x1, G.x1, G.z0, G.z1, 8, 16, cm[0]);

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
    // The visible façade starts 5 cm below street level (its texture's v = 0 sits under the
    // cobbles) so the seam to the squashed foundation band never lands on the ground plane,
    // where it z-fought with the cobbles as a dotted line along every wall base.
    const bands = [], S0 = -0.05;
    if (below > 0.01) bands.push([-below, S0, 0, 0.6]);
    if (Hb <= 12.1) {
      bands.push([S0, Hb, 0, Hb]);
      return bands;
    }
    bands.push([S0, 8.2, 0, 8.2]);
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
  // Façade variants carry baked shop signs, so pick the variant whose nearest same-variant lot is
  // farthest away: neighbours along a row never match and a sign rarely recurs within ~60 m.
  const facadeUsed = [];
  function pickFacade(x, z, wide, r) {
    const n = wide ? 4 : NPL, start = Math.floor(r() * n);
    let best = null, bd = -1;
    for (let i = 0; i < n; i++) {
      const k = (wide ? 'fw' : 'pl') + ((start + i) % n);
      let d = 1e9;
      for (const u of facadeUsed) {
        if (u.k !== k) continue;
        const dd = (u.x - x) ** 2 + (u.z - z) ** 2;
        if (dd < d) d = dd;
      }
      if (d > bd) { bd = d; best = k; }
    }
    facadeUsed.push({ x, z, k: best });
    return best;
  }
  // A street-facing house: F at front-centre on the ground, u along the street, v into the block.
  // A castle palace wing: smooth render (game.tex.wall), rusticated plinth, string courses,
  // a regular grid of tall stone-framed windows (pediments on the piano nobile), slate roof.
  const wallM = metres('wall')[0];
  function palace(F, w, d, below) {
    const Hb = 14.2, WC = [0.84, 0.81, 0.75], SL = [0.78, 0.75, 0.7];
    B.box('wall', F, -w / 2, w / 2, -below, Hb, 0, d, { mw: wallM, mh: wallM, col: WC, sideCol: WC });
    B.box('stoneLight', F, -w / 2 - 0.06, w / 2 + 0.06, -below, 1.1, -0.1, d, { mw: stoneM, mh: stoneM, col: [0.62, 0.6, 0.56], skip: 'bottom,back,top' });
    for (const [y0, y1] of [[4.75, 5.05], [9.15, 9.35]]) B.box('stoneLight', F, -w / 2 - 0.08, w / 2 + 0.08, y0, y1, -0.1, d, { mw: stoneM, mh: stoneM, col: SL, skip: 'bottom,back' });
    B.box('stoneLight', F, -w / 2 - 0.3, w / 2 + 0.3, Hb - 0.35, Hb + 0.2, -0.32, d + 0.3, { mw: stoneM, mh: stoneM, col: SL, skip: 'bottom' });
    const bays = Math.max(2, Math.floor(w / 3.3)), bw = w / bays;
    const win = (u, y0, y1, hw, ped) => {
      const fv = -0.07;
      B.quad('dark', P(F, u + hw, y0, -0.01), P(F, u - hw, y0, -0.01), P(F, u - hw, y1, -0.01), P(F, u + hw, y1, -0.01), null, [1.1, 1.1, 1.15]);
      B.quad('dark', P(F, u + 0.03, y0, -0.015), P(F, u - 0.03, y0, -0.015), P(F, u - 0.03, y1, -0.015), P(F, u + 0.03, y1, -0.015), null, [2.2, 2.1, 2]);   // mullion
      const fr = (a, b, c, e) => B.quad('stoneLight', P(F, b, c, fv), P(F, a, c, fv), P(F, a, e, fv), P(F, b, e, fv), [[0, 0], [(b - a) / 3, 0], [(b - a) / 3, (e - c) / 3], [0, (e - c) / 3]], SL);
      fr(u - hw - 0.16, u - hw, y0, y1); fr(u + hw, u + hw + 0.16, y0, y1);
      fr(u - hw - 0.16, u + hw + 0.16, y1, y1 + 0.16);
      B.box('stoneLight', F, u - hw - 0.24, u + hw + 0.24, y0 - 0.16, y0, -0.16, 0, { mw: stoneM, mh: stoneM, col: SL, skip: 'bottom,back' });
      if (ped) {
        B.box('stoneLight', F, u - hw - 0.3, u + hw + 0.3, y1 + 0.16, y1 + 0.3, -0.2, 0, { mw: stoneM, mh: stoneM, col: SL, skip: 'bottom,back' });
        B.polyF('stoneLight', [P(F, u + hw + 0.3, y1 + 0.3, -0.12), P(F, u - hw - 0.3, y1 + 0.3, -0.12), P(F, u, y1 + 0.75, -0.12)], [-F.s, 0, -F.c], [[0, 0], [1, 0], [0.5, 0.3]], SL);
      }
    };
    for (let i = 0; i < bays; i++) {
      const u = -w / 2 + (i + 0.5) * bw;
      win(u, 1.6, 3.9, 0.5, false);
      win(u, 6.0, 8.5, 0.55, true);
      win(u, 10.2, 12.3, 0.5, false);
    }
    B.gable('slate', F, -w / 2, w / 2, 0, d, Hb + 0.2, Math.min(6, d * 0.42), { mw: roofM, mh: roofM, col: [0.85, 0.87, 0.9], gkey: 'wall', gmw: wallM, gmh: wallM, gybase: 0, gcol: WC });
    return Hb;
  }

  function house(F, w, d, o = {}) {
    const r = o.R || R;
    const corners = [[-w / 2, 0], [w / 2, 0], [-w / 2, d], [w / 2, d]].map(([u, v]) => { const [x, , z] = P(F, u, 0, v); return H(x, z); });
    const gFront = F.oy, gMin = Math.min(...corners), gMax = Math.max(...corners);
    const storeys = o.storeys ?? (3 + Math.floor(r() * 2.6));
    let Hb = storeys <= 3 ? 12 : 12 + (storeys - 3) * 3.6;
    Hb += Math.max(0, gMax - gFront) * 0.5;
    const below = gFront - gMin + 0.6;
    if (o.palace) {
      const top = palace(F, w, d, below);
      const [cx, , cz] = P(F, 0, 0, d / 2);
      solid(cx, cz, w / 2, d / 2, F.rot);
      lots.push({ F, w, d, top, key: 'wall', col: WHITE, ruined: false, front: gFront, palace: true });
      return { top, key: 'wall', col: WHITE, below };
    }
    const wide = o.wide ?? (w > 15 && r() < 0.7);
    const key = o.key || pickFacade(F.ox, F.oz, wide, r);
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
    const hopt = castle ? { palace: true } : {};
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
        const key = inCastle ? 'wall' : 'pl' + Math.floor(R() * NPL);
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

  // ---------- map edge: hard stop at BOUNDS ----------
  // Inner faces 0.1 m inside the bounds so a player circle (r ≥ 0.25) stays inside them.
  {
    const b = L.BOUNDS, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, k = 0.1;
    solid(cx, b.z0 - 1.5 + k, (b.x1 - b.x0) / 2 + 3, 1.5, 0, -10, 100, true);
    solid(cx, b.z1 + 1.5 - k, (b.x1 - b.x0) / 2 + 3, 1.5, 0, -10, 100, true);
    solid(b.x0 - 1.5 + k, cz, 1.5, (b.z1 - b.z0) / 2 + 3, 0, -10, 100, true);
    solid(b.x1 + 1.5 - k, cz, 1.5, (b.z1 - b.z0) / 2 + 3, 0, -10, 100, true);
  }

  // ---------- close alley mouths that lead nowhere ----------
  // Walk both edges of every street; where the strip just behind the house fronts is open (no
  // collider, not another street or plaza, not a reserved forecourt) wall it off with a
  // courtyard wall and a boarded gate, so nobody wanders into the unlit void inside a block.
  const gaps = [];
  function closeGaps() {
    for (const s of L.STREETS) {
      if (s.name === 'bridge') continue;
      for (let i = 0; i < s.pts.length - 1; i++) {
        const [ax, az] = s.pts[i], [bx, bz] = s.pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
        for (const side of [-1, 1]) {
          const nx = -dz * side, nz = dx * side, off = s.width / 2 + 0.95;
          const open = (t) => {
            for (const o of [off + 0.7, off + 1.6]) {
              const x = ax + dx * t + nx * o, z = az + dz * t + nz * o;
              const k = gi(x, z);
              if (k < 0 || occ[k] === 2 || occ[k] === 3) return false;
              if (L.mustStayClear(x, z, 0.3) || L.inPlaza(x, z, 1)) return false;
              if (x < L.BOUNDS.x0 || x > L.BOUNDS.x1 || z < L.BOUNDS.z0 || z > L.BOUNDS.z1) return false;
              if (game.collide.inside(x, z, 0.2, H(x, z))) return false;
            }
            const wx = ax + dx * t + nx * off, wz = az + dz * t + nz * off;
            const n = L.nearestStreet(wx, wz);
            return !(L.inPlaza(wx, wz, 0.6) || (n.street !== s && n.d < n.street.width / 2 + 0.6));
          };
          let t0 = null;
          for (let t = 0; t <= len + 0.01; t += 0.4) {
            const o = t <= len && open(t);
            if (o && t0 === null) t0 = t;
            if (!o && t0 !== null) {
              if (t - t0 >= 0.4) gaps.push({ s, ax, az, dx, dz, nx, nz, off, t0: Math.max(0, t0 - 0.45), t1: Math.min(len, t + 0.05) });
              t0 = null;
            }
          }
        }
      }
    }
    for (const g of gaps) {
      const tm = (g.t0 + g.t1) / 2, w = g.t1 - g.t0;
      const cx = g.ax + g.dx * tm + g.nx * g.off, cz = g.az + g.dz * tm + g.nz * g.off;
      const rot = Math.atan2(g.nx, g.nz);                   // local v = outward, u along the street
      const F = frame(cx, H(cx, cz), cz, rot);
      // narrow slots become a tall infill section (no dark slit above a low wall); wider ones a
      // courtyard wall with a boarded gate
      // a tall infill only between two buildings: at a block corner it stood alone as a thin
      // slab beside the street (Celetná's west end), so there it becomes a low courtyard wall
      const abut = (t) => {
        const x = g.ax + g.dx * t + g.nx * (g.off + 1.2), z = g.az + g.dz * t + g.nz * (g.off + 1.2);
        return game.collide.inside(x, z, 0.05, H(x, z));
      };
      const both = abut(g.t0 - 0.5) && abut(g.t1 + 0.5);
      if (!both && L.inPlaza(cx, cz, 4)) { g.skip = true; continue; }   // a street mouth onto a square: leave it open
      const tall = w < 3.2 && both;
      const h = tall ? 8 + R() * 3 : 3.4 + R() * 0.8, k = 'pl' + Math.floor(R() * NPL), tk = 0.6 + R() * 0.15;
      // tall infills are a narrow house 3 m deep (a 0.4 m slab showed its edges at street bends)
      const dp = tall ? 3 : 0.25;
      facadeWalls(k, F, -w / 2 - 0.1, w / 2 + 0.1, -0.15, dp, facadeBands(h, 0.6), { col: [tk, tk * 0.97, tk * 0.92], sideCol: [tk * 0.8, tk * 0.78, tk * 0.75] });
      B.box('stone', F, -w / 2 - 0.2, w / 2 + 0.2, h, h + 0.22, -0.25, dp + 0.1, { mw: stoneM, mh: stoneM, col: [0.6, 0.58, 0.55] });
      if (!tall && w >= 1.6) {                                  // boarded double gate
        const gw = Math.min(w - 0.6, 2.6);
        B.box('plank', F, -gw / 2, gw / 2, 0, 2.6, -0.2, -0.15, { mw: 1, mh: 2, col: [0.55, 0.5, 0.45] });
        B.box('dark', F, -0.02, 0.02, 0, 2.6, -0.21, -0.2, {});
        for (const y of [0.5, 1.9]) B.box('plank', sub(F, 0, y, -0.24, (R() - 0.5) * 0.15), -gw / 2 - 0.1, gw / 2 + 0.1, 0, 0.18, -0.03, 0.03, { mw: 1, mh: 2, col: [0.45, 0.4, 0.36] });
      }
      solid(cx, cz, w / 2 + 0.1, 0.2, rot, -10, 100, true);
    }
    if (debug) for (const g of gaps) if (!g.skip) console.warn(`[world] gap closed on ${g.s.name} at ${(g.ax + g.dx * g.t0 + g.nx * g.off).toFixed(1)},${(g.az + g.dz * g.t0 + g.nz * g.off).toFixed(1)} w=${(g.t1 - g.t0).toFixed(1)}`);
  }

  // ---------- props / dressing ----------
  W.lots = lots;
  closeGaps();
  B.detail = true;
  buildProps(W, landmarks);
  B.detail = false;

  // ---------- build meshes ----------
  const tiles = [];
  const stats = B.build(THREE, mats, group, tiles);
  for (const m of W.extraMeshes || []) group.add(m);

  // ---------- pickups (CONTRACT round 3) ----------
  {
    const glowM = (c, e) => new THREE.MeshLambertMaterial({ color: c, emissive: e, emissiveIntensity: 0.35 });
    const pouchM = glowM(0x8a8468, 0x3a3022), crossM = glowM(0x9a1810, 0x5a0a06), strapM = glowM(0x3a3428, 0x100c08);
    const boxM = glowM(0x4a4e34, 0x22200e), brassM = glowM(0xa08040, 0x4a3410);
    const make = (kind) => {
      const g = new THREE.Group();
      if (kind === 'bandage') {
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.11, 0.21).translate(0, 0.055, 0), pouchM));
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.03, 0.05).translate(0, 0.1, 0.06), strapM));
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.012, 0.035).translate(0, 0.116, -0.02), crossM));
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.012, 0.11).translate(0, 0.116, -0.02), crossM));
      } else {
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.17).translate(0, 0.075, 0), boxM));
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.03, 0.175).translate(0, 0.14, 0), strapM));
        for (let i = 0; i < 5; i++) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 6).translate(-0.07 + i * 0.035, 0.18, 0.03), brassM));
      }
      g.traverse((o) => { if (o.isMesh) o.name = 'world:pickup'; });
      return g;
    };
    const list = [
      ['bandage', 150, 20, 'Obvaz — Bandage (+35)', () => game.player?.heal?.(35)],
      ['bandage', -125, 10, 'Obvaz — Bandage (+35)', () => game.player?.heal?.(35)],
      ['bandage', 83.7, 8.5, 'Obvaz — Bandage (+35)', () => game.player?.heal?.(35)],     // Karlova bend, south kerb
      ['bandage', -20, -3.5, 'Obvaz — Bandage (+35)', () => game.player?.heal?.(35)],     // bridge, south lane
      ['ammo', 52, 3, 'Náboje — 6 pistol rounds', () => game.player?.addAmmo?.(6)],
      ['ammo', -52, -3, 'Náboje — 6 pistol rounds', () => game.player?.addAmmo?.(6)],
    ];
    W.pickups = [];
    for (const [kind, x, z, label, fx] of list) {
      const m = make(kind), y = H(x, z);
      m.position.set(x, y + 0.01, z);
      m.rotation.y = R() * 6.28;
      group.add(m);
      let taken = false;
      const it = {
        pos: new THREE.Vector3(x, y + 0.4, z), radius: 1.7, label, kind,
        // a bandage is not wasted at full health
        enabled: () => !taken && (kind !== 'bandage' || (game.player?.health ?? 0) < 100),
        use() { if (taken) return; taken = true; m.visible = false; try { fx(); } catch (e) { void e; } },
      };
      (game.interactables ||= []).push(it);
      W.pickups.push(it);
      if (debug && game.collide.inside(x, z, 0.3, y)) console.warn('[world] pickup inside a collider', x, z);
    }
  }

  // ---------- castle gate leaves: stand open until the courier is inside with the medicine ----
  const gate = { shut: false, t: 0, leaves: [], box: false };
  {
    const C = L.CASTLE, G = L.CASTLE_GATE, xb = C.x1 - 4, hw = G.width / 2, top = H(xb - 0.5, G.z);
    for (const sg of [-1, 1]) {                         // −1: north leaf (hinge at gz0), +1: south
      const BB = new Batches(false), F0 = frame(0, 0, 0, 0), len = hw - 0.02, z0 = sg < 0 ? 0 : -len, z1 = sg < 0 ? len : 0;
      for (let z = z0; z < z1 - 0.05; z += 0.26) {
        const k = 0.6 + R() * 0.3;
        BB.box('plank', F0, -0.16, -0.04, 0, 4.2 + R() * 0.15, z + 0.01, Math.min(z1, z + 0.25), { mw: 1, mh: 2, col: [k, k * 0.95, k * 0.88] });
      }
      for (const y of [0.6, 2.2, 3.8]) BB.box('plank', F0, -0.24, -0.16, y, y + 0.22, z0 + 0.1, z1 - 0.1, { mw: 1, mh: 2, col: [0.5, 0.46, 0.4] });
      for (const y of [0.75, 3.95]) BB.box('rust', F0, -0.03, 0.0, y - 0.06, y + 0.06, z0, z1, { mw: 1.5, mh: 1.5 });   // iron straps
      BB.beam('plank', [-0.2, 0.8, sg < 0 ? z0 + 0.3 : z1 - 0.3], [-0.2, 2.1, sg < 0 ? z1 - 0.3 : z0 + 0.3], 0.07, 0.07, { sides: 4, col: [0.5, 0.46, 0.4] });
      BB.beam('plank', [-0.2, 2.4, sg < 0 ? z0 + 0.3 : z1 - 0.3], [-0.2, 3.7, sg < 0 ? z1 - 0.3 : z0 + 0.3], 0.07, 0.07, { sides: 4, col: [0.5, 0.46, 0.4] });
      const g = new THREE.Group();
      BB.build(THREE, mats, g);
      g.position.set(xb - 0.02, top, G.z + sg * hw);
      const open = sg < 0 ? -Math.PI / 2 : Math.PI / 2;
      g.rotation.y = open;
      g.name = 'world:gateLeaf';
      group.add(g);
      gate.leaves.push({ g, open });
    }
    gate.top = top; gate.xb = xb;
  }
  function gateUpdate(dt) {
    const st = game.state, p = game.player?.pos;
    // Trigger well inside the walls. The gate is scenery: dead.js already keeps the dead out of
    // the castle, and a collider here could shut a player outside with no way to win.
    if (!gate.shut && st?.hasMedicine && p && p.x < -282 && p.x > L.CASTLE.x0 && p.z > L.CASTLE.z0 && p.z < L.CASTLE.z1) {
      gate.shut = true;
      try { game.audio?.door?.(); } catch (e) { void e; }
      try { game.emit?.('gate', {}); } catch (e) { void e; }
    }
    if (gate.shut && gate.t < 1) {
      gate.t = Math.min(1, gate.t + dt / 2.6);
      const k = gate.t * gate.t * (3 - 2 * gate.t);
      for (const l of gate.leaves) l.g.rotation.y = l.open * (1 - k);
    }
  }

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

  function setWaterEnv(env, force = false) {
    const wm = matCache.get('water');
    if (wm && env && (force || wm.envMap !== env)) { wm.envMap = env; wm.needsUpdate = true; }
  }
  game.on?.('contextrestored', () => setWaterEnv(game.atmos?.envMap, true));
  let firstUpdate = true;
  const camP = new THREE.Vector3();
  // Fog-distance culling: past ~2.4/density the exp² fog is > 99.6 % opaque, so tiles beyond it
  // are skipped; small-prop tiles go sooner. Thin-fog landmark materials are never culled.
  function cull() {
    const fog = game.scene.fog, cam = game.camera;
    if (!cam) return;
    cam.getWorldPosition(camP);
    const D = fog?.isFogExp2 ? 2.4 / Math.max(1e-4, fog.density) : fog?.isFog ? fog.far : Infinity;
    // small props appear at 0.8·D, where only ~2.5 % of them still shows through the fog
    const Dd = D * 0.8;
    for (const t of tiles) {
      if (t.far) continue;
      const d = Math.hypot(t.c.x - camP.x, t.c.y - camP.y, t.c.z - camP.z) - t.r;
      t.mesh.visible = d < (t.detail ? Dd : D);
    }
  }
  const ms = Math.round(performance.now() - t0);
  console.log(`[world] built in ${ms} ms: ${stats.calls} meshes, ${stats.tris} tris, ${solids.length} colliders, ${spawns.length} spawns, ${lots.length} lots`);

  return {
    lamps: W.lamps,
    spawns,
    fires: W.fires,
    group,
    warnings,
    // CONTRACT round 3: the river's sky reflection is set before main's warmup compiles it
    onAtmos(atmos) { setWaterEnv(atmos?.envMap); },
    // true once the courier has carried the medicine inside the walls and the gate swung shut
    gateClosed() { return gate.shut; },
    update(dt) {
      if (firstUpdate) {
        firstUpdate = false;
        if (!game.atmos) {                           // atmos missing: keep the city visible
          game.scene.add(new THREE.HemisphereLight(0xc8d0dc, 0x3a3630, 1.6));
          const sun = new THREE.DirectionalLight(0xffeedd, 1.2);
          sun.position.set(-100, 120, 80);
          game.scene.add(sun);
        }
      }
      cull();
      setWaterEnv(game.atmos?.envMap);
      try { gateUpdate(dt); } catch (e) { void e; }
      for (const u of W.updaters) { try { u(dt); } catch (e) { void e; } }
    },
  };
}
