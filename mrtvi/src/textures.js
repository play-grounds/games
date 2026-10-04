// Procedural canvas textures for MRTVÍ — see CONTRACT.md (textures section).
// Every texture: THREE.CanvasTexture, sRGB, RepeatWrapping, mipmapped, userData.metres = [w, h].
import { paintFacade } from './tex/facade.js';
import * as S from './tex/surfaces.js';
import * as X from './tex/special.js';

export function makeTextures(game) {
  const THREE = game.THREE;
  const aniso = Math.min(8, game.renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  const t0 = performance.now();

  const wrap = (c, metres) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = aniso;
    t.userData.metres = metres;
    t.needsUpdate = true;
    return t;
  };
  const cached = (fn) => {
    const cache = new Map();
    return (i = 0) => {
      i = Math.max(0, Math.floor(+i || 0));
      if (!cache.has(i)) cache.set(i, fn(i));
      return cache.get(i);
    };
  };

  const T = {
    // Façades: [12 m wide × 12 m tall], 4 bays of 3 m; wide: [24 × 12], 8 bays. Bottom of texture = street level.
    plaster: cached((i) => wrap(paintFacade(i, 4), [12, 12])),
    facadeWide: cached((i) => wrap(paintFacade(100 + i, 8), [24, 12])),
    poster: cached((i) => wrap(X.poster(i), [0.6, 0.85])),
    skin: cached((i) => wrap(X.skin(i), [0.5, 0.5])),
    cloth: cached((i) => wrap(X.cloth(i), [0.5, 0.5])),
  };
  const statics = {
    cobble: [S.cobble, [6, 6]],
    paving: [S.paving, [8, 8]],
    asphalt: [S.asphalt, [4, 4]],
    stone: [S.stone, [3, 3]],
    stoneLight: [S.stoneLight, [3, 3]],   // pale weathered sandstone ashlar (Old Town Hall tower, gates)
    roof: [S.roof, [2, 2]],
    slate: [S.slate, [2, 2]],
    plank: [S.plank, [1, 2]],
    rust: [S.rust, [1.5, 1.5]],
    wall: [S.wall, [4, 4]],
    interiorWall: [S.interiorWall, [3, 3]],
    tiles: [S.tiles, [2, 2]],
    blood: [S.blood, [2, 2]],
    sign_lekarna: [X.signLekarna, [2.4, 0.6]],
    clockFace: [X.clockFace, [5, 5]],
  };
  for (const [k, [fn, m]] of Object.entries(statics)) {
    try { T[k] = wrap(fn(), m); } catch (e) { console.error(`[textures] ${k}`, e); }
  }
  T.blood.premultiplyAlpha = false;
  // Warm the variant caches the world/dead will ask for, so the cost lands at boot.
  for (let i = 0; i < 12; i++) T.plaster(i);
  for (let i = 0; i < 4; i++) { T.facadeWide(i); T.skin(i); }
  for (let i = 0; i < 6; i++) { T.poster(i); T.cloth(i); }
  T.genMs = Math.round(performance.now() - t0);
  console.log(`[textures] generated in ${T.genMs} ms`);
  return T;
}

// Review aid: every texture on a grid of quads, 1 unit per cell. Returns a THREE.Group.
export function previewWall(game) {
  const THREE = game.THREE, T = game.tex || makeTextures(game);
  const list = [];
  for (const k of ['cobble', 'paving', 'asphalt', 'stone', 'stoneLight', 'roof', 'slate', 'plank', 'rust', 'wall', 'interiorWall', 'tiles', 'blood', 'sign_lekarna', 'clockFace']) list.push([k, T[k]]);
  for (let i = 0; i < 12; i++) list.push([`plaster(${i})`, T.plaster(i)]);
  for (let i = 0; i < 4; i++) list.push([`facadeWide(${i})`, T.facadeWide(i)]);
  for (let i = 0; i < 6; i++) list.push([`poster(${i})`, T.poster(i)]);
  for (let i = 0; i < 4; i++) list.push([`skin(${i})`, T.skin(i)]);
  for (let i = 0; i < 6; i++) list.push([`cloth(${i})`, T.cloth(i)]);
  const group = new THREE.Group();
  const cols = 8, cell = 2.2;
  list.forEach(([name, tex], n) => {
    const [mw, mh] = tex.userData.metres, s = 2 / Math.max(mw, mh);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(mw * s, mh * s), new THREE.MeshBasicMaterial({ map: tex, transparent: name === 'blood' || name.startsWith('poster') }));
    m.position.set((n % cols) * cell, -Math.floor(n / cols) * cell, 0);
    m.name = name;
    group.add(m);
  });
  return group;
}
