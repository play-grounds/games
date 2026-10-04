// Atmosphere: sky, sun/moon, ambient, fog, drizzle, smoke, camp-fire flicker, post chain.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { skyVert, skyFrag, rainVert, rainFrag, smokeVert, smokeFrag, moonVert, moonFrag, gradeShader, bloomShaders } from './atmos/shaders.js';

const C = (r, g, b) => new THREE.Color(r, g, b);   // linear
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Look keyframes: 0 = dusk (18.6), 1 = full night (20.5+).
const DUSK = {
  zenith: C(0.085, 0.095, 0.115), horizon: C(0.20, 0.205, 0.215), glow: C(1.0, 0.42, 0.16),
  hemiSky: C(0.62, 0.66, 0.74), hemiGround: C(0.26, 0.24, 0.22), hemi: 1.15,
  fog: 0.0095, desat: 0.5, contrast: 1.1, tint: C(0.93, 1.0, 1.04), lift: C(0.003, 0.005, 0.006),
};
const NIGHT = {
  zenith: C(0.006, 0.008, 0.015), horizon: C(0.024, 0.030, 0.042), glow: C(0.0, 0.0, 0.0),
  hemiSky: C(0.30, 0.38, 0.58), hemiGround: C(0.06, 0.06, 0.07), hemi: 0.24,
  fog: 0.0145, desat: 0.62, contrast: 1.16, tint: C(0.86, 0.98, 1.08), lift: C(0.0012, 0.0022, 0.0032),
};

// Deep night (23:00+): the grade the late keyframe pulls toward.
const LATE = {
  hemiSky: C(0.22, 0.32, 0.62), tint: C(0.70, 0.86, 1.10), lift: C(0.0006, 0.0016, 0.0034),
  desat: 0.68, contrast: 1.22,
};

// Nightness 0..1 for any hour (dusk 18.6→20.5, dawn 4.5→6.5 for completeness).
export function nightness(h) {
  h = ((h % 24) + 24) % 24;
  if (h >= 12) return smooth(18.6, 20.5, h);
  return 1 - smooth(4.5, 6.5, h);
}

// Quarter-res bloom with 3 mips (1/4, 1/8, 1/16). Writes into its own targets; the grade pass
// samples `texture` — no composite or copy pass.
class CheapBloom extends Pass {
  constructor(threshold = 0.9, strength = 0.32) {
    super();
    this.needsSwap = false;
    this.strength = strength;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rts = [0, 1, 2].map(() => new THREE.WebGLRenderTarget(1, 1, opts));
    this.texture = this.rts[0].texture;
    const mk = (frag, extra = {}) => new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, ...extra },
      vertexShader: bloomShaders.vert, fragmentShader: frag, depthTest: false, depthWrite: false,
    });
    this.pre = mk(bloomShaders.prefilter, { uThreshold: { value: threshold } });
    this.down = mk(bloomShaders.down);
    this.up = mk(bloomShaders.up, { uGain: { value: 1 } });
    this.up.blending = THREE.AdditiveBlending;
    this.quad = new FullScreenQuad(null);
    this.srcW = 1; this.srcH = 1;
  }
  setSize(w, h) {
    this.srcW = w; this.srcH = h;
    this.rts.forEach((rt, i) => rt.setSize(Math.max(1, Math.ceil(w / (4 << i))), Math.max(1, Math.ceil(h / (4 << i)))));
  }
  pass(renderer, mat, src, srcW, srcH, dst, clear) {
    mat.uniforms.tSrc.value = src;
    mat.uniforms.uTexel.value.set(1 / srcW, 1 / srcH);
    this.quad.material = mat;
    renderer.setRenderTarget(dst);
    if (clear) renderer.clear(true, false, false);
    this.quad.render(renderer);
  }
  render(renderer, writeBuffer, readBuffer) {
    const [a, b, c] = this.rts;
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    this.pass(renderer, this.pre, readBuffer.texture, this.srcW, this.srcH, a, true);
    this.pass(renderer, this.down, a.texture, a.width, a.height, b, true);
    this.pass(renderer, this.down, b.texture, b.width, b.height, c, true);
    this.pass(renderer, this.up, c.texture, c.width, c.height, b, false);
    this.pass(renderer, this.up, b.texture, b.width, b.height, a, false);
    renderer.autoClear = ac;
  }
  dispose() { this.rts.forEach((r) => r.dispose()); this.pre.dispose(); this.down.dispose(); this.up.dispose(); this.quad.dispose(); }
}

export function create(game) {
  const { scene, camera, renderer } = game;
  const params = game.params || new URLSearchParams();
  const tmp = new THREE.Vector3();
  const lowTier = params.get('tier') === 'low' || params.has('low');

  // --- sky dome -------------------------------------------------------------
  const skyU = {
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() }, uMoonDir: { value: new THREE.Vector3() },
    uFireCol: { value: C(1.0, 0.33, 0.08) },
    uTime: { value: 0 }, uNight: { value: 0 }, uGlowAmt: { value: 1 }, uMoonAmt: { value: 0 }, uMoonBreak: { value: 0 }, uFireAmt: { value: 0 }, uBlueAmt: { value: 0 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(500, 32, 16),
    new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.name = 'atmos.sky';
  scene.add(sky);

  // --- moon -----------------------------------------------------------------
  // A camera-facing quad, not a disc in the dome shader: a dot-product disc on the dome is
  // stretched by the rectilinear projection off-centre and read as a flat white ellipse.
  // The quad is parallel to the image plane, so it stays round at any aspect and position.
  // It reads the same cloud deck as the dome, so the deck still veils it.
  const MOON_D = 420, MOON_R = 0.0125;              // disc angular radius ~0.72°
  const moonU = { uAmt: { value: 0 }, uBreak: { value: 0 }, uTime: { value: 0 }, uCol: { value: C(0.55, 0.64, 0.82) } };
  const moon = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      uniforms: moonU, vertexShader: moonVert, fragmentShader: moonFrag,
      transparent: true, depthWrite: false, depthTest: true, fog: false,
      // additive colour, destination alpha untouched (alpha 0 marks sky for the grade)
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    }),
  );
  moon.scale.setScalar(MOON_D * MOON_R * 2 * 7);   // quad = 7 disc diameters: room for the halo
  moon.frustumCulled = false;
  moon.renderOrder = -999;
  moon.name = 'atmos.moon';
  scene.add(moon);

  // --- lights ---------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1);
  const key = new THREE.DirectionalLight(0xffffff, 1);
  key.castShadow = false;
  scene.add(hemi, key, key.target);

  scene.fog = new THREE.FogExp2(0x333333, 0.01);
  scene.background = null;

  // --- drizzle --------------------------------------------------------------
  const RAIN_N = 1400, BOX = new THREE.Vector3(28, 16, 28);
  const rr = game.layout?.rng ? game.layout.rng(4242) : Math.random;
  const rp = new Float32Array(RAIN_N * 3), rs = new Float32Array(RAIN_N);
  for (let i = 0; i < RAIN_N; i++) {
    rp[i * 3] = rr() * BOX.x; rp[i * 3 + 1] = rr() * BOX.y; rp[i * 3 + 2] = rr() * BOX.z;
    rs[i] = 5.5 + rr() * 2.5;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  rainGeo.setAttribute('aSpeed', new THREE.BufferAttribute(rs, 1));
  const rainU = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uBox: { value: BOX }, uSize: { value: 60 }, uColor: { value: C(0.5, 0.55, 0.6) } };
  const rain = new THREE.Points(rainGeo, new THREE.ShaderMaterial({
    uniforms: rainU, vertexShader: rainVert, fragmentShader: rainFrag, transparent: true, depthWrite: false, fog: false,
  }));
  rain.frustumCulled = false;
  rain.renderOrder = 10;
  rain.name = 'atmos.rain';
  scene.add(rain);

  // --- smoke columns --------------------------------------------------------
  const COLUMNS = [[40, -150], [235, -120], [-190, 120], [120, 140], [-70, -170], [330, 30], [-230, -130]];
  const PER = 24;
  const quad = new THREE.PlaneGeometry(1, 1);
  const sg = new THREE.InstancedBufferGeometry();
  sg.index = quad.index;
  sg.setAttribute('position', quad.getAttribute('position'));
  sg.setAttribute('uv', quad.getAttribute('uv'));
  const sBase = new Float32Array(COLUMNS.length * PER * 3), sSeed = new Float32Array(COLUMNS.length * PER * 2);
  const sr = game.layout?.rng ? game.layout.rng(777) : Math.random;
  COLUMNS.forEach(([x, z], ci) => {
    const scale = 0.7 + sr() * 0.6;
    const y = game.layout?.heightAt ? game.layout.heightAt(x, z) : 0;
    for (let k = 0; k < PER; k++) {
      const i = ci * PER + k;
      sBase.set([x + (sr() - 0.5) * 4, y + 8, z + (sr() - 0.5) * 4], i * 3);
      sSeed.set([k / PER + sr() * 0.05, scale], i * 2);
    }
  });
  sg.setAttribute('aBase', new THREE.InstancedBufferAttribute(sBase, 3));
  sg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sSeed, 2));
  sg.instanceCount = COLUMNS.length * PER;
  const smokeU = {
    uTime: { value: 0 }, uHeight: { value: 130 }, uWind: { value: new THREE.Vector2(-0.35, 0.12) },
    uColor: { value: C(0.06, 0.06, 0.065) }, uFireCol: { value: C(1.0, 0.35, 0.1) }, uFireAmt: { value: 0 },
    uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0.01 },
  };
  const smoke = new THREE.Mesh(sg, new THREE.ShaderMaterial({
    uniforms: smokeU, vertexShader: smokeVert, fragmentShader: smokeFrag, transparent: true, depthWrite: false, fog: false,
  }));
  smoke.frustumCulled = false;
  smoke.renderOrder = 5;
  smoke.name = 'atmos.smoke';
  scene.add(smoke);

  // --- camp fire / lantern lights ----------------------------------------------
  // Fixed budget: 3 PointLights made now and never added/removed/hidden afterwards; every
  // 0.25 s they move to the 3 nearest entries of game.world.fires (intensity 0 if none near).
  const FIRE_N = 3, FIRE_R2 = 90 * 90;
  const fireLights = [];
  for (let i = 0; i < FIRE_N; i++) {
    const l = new THREE.PointLight(0xff7a2e, 0, 16, 2);
    l.name = 'atmos.fire' + i;
    l.userData = { seed: i * 3.7, on: false, home: new THREE.Vector3() };
    scene.add(l);
    fireLights.push(l);
  }
  const nearI = new Int32Array(FIRE_N), nearD = new Float64Array(FIRE_N);
  let fireTimer = 0;
  const fx = (f) => (f.isVector3 ? f.x : f.x ?? f[0]);
  const fz = (f) => (f.isVector3 ? f.z : f.z ?? f[2]);
  const fy = (f) => (f.isVector3 ? f.y : f.y ?? (game.layout?.heightAt?.(fx(f), fz(f)) ?? 0) + 0.6);
  function pickFires() {
    const fires = game.world?.fires;
    const cp = camera.position;
    nearI.fill(-1); nearD.fill(Infinity);
    if (Array.isArray(fires)) {
      for (let i = 0; i < fires.length; i++) {
        const f = fires[i];
        const dx = fx(f) - cp.x, dz = fz(f) - cp.z, d = dx * dx + dz * dz;
        if (d > FIRE_R2 || d >= nearD[FIRE_N - 1]) continue;
        let k = FIRE_N - 1;                       // insertion into the fixed top-3
        while (k > 0 && nearD[k - 1] > d) { nearD[k] = nearD[k - 1]; nearI[k] = nearI[k - 1]; k--; }
        nearD[k] = d; nearI[k] = i;
      }
    }
    for (let k = 0; k < FIRE_N; k++) {
      const l = fireLights[k], i = nearI[k];
      l.userData.on = i >= 0;
      if (i >= 0) { const f = fires[i]; l.userData.home.set(fx(f), fy(f), fz(f)); }
    }
  }
  function updateFires(dt, t) {
    fireTimer -= dt;
    if (fireTimer <= 0) { fireTimer = 0.25; pickFires(); }
    for (const l of fireLights) {
      if (!l.userData.on) { l.intensity = 0; continue; }
      const s = l.userData.seed;
      const f = 0.7 + 0.18 * Math.sin(t * 11 + s) + 0.12 * Math.sin(t * 23.7 + s * 2) + 0.1 * Math.sin(t * 5.3 + s * 5);
      // capped so a face 1–1.5 m from the flames stays under clip (radiance ~ I/d² · albedo/π)
      l.intensity = Math.min(11, 10 * f);
      const h = l.userData.home;
      l.position.set(h.x + Math.sin(t * 7 + s) * 0.08, h.y + 0.4 + Math.sin(t * 9 + s) * 0.06, h.z + Math.cos(t * 6 + s) * 0.08);
    }
  }

  // --- sky environment (IBL) -------------------------------------------------
  // A 32 px cube of the sky dome, PMREM-filtered into one fixed target, so the river and wet
  // stone have a sky to reflect. Re-rendered every ~0.2 in-game hours, never per frame.
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(sky.geometry, sky.material);
  envSky.frustumCulled = false;
  envScene.add(envSky);
  const cubeRT = new THREE.WebGLCubeRenderTarget(32, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(1, 1000, cubeRT);
  envScene.add(cubeCam);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null, envHour = NaN;
  const ENV_I = 0.55;
  function updateEnv(hour) {
    try {
      cubeCam.update(renderer, envScene);
      envRT = pmrem.fromCubemap(cubeRT.texture, envRT);
      // Only the river reads atmos.envMap; image-based light on every lit material cost 11–16%.
      if (game.params.has('ibl') && !lowTier && scene.environment !== envRT.texture) scene.environment = envRT.texture;
      envHour = hour;
    } catch (e) { if (!updateEnv._w) { updateEnv._w = 1; console.warn('[atmos] env', e); } }
  }

  // --- post chain -----------------------------------------------------------
  // RenderPass → CheapBloom (1/4 res, 3 mips; off on the low tier) → grade (incl. ACES + sRGB).
  const size = new THREE.Vector2();
  renderer.getSize(size);
  const maxPR = () => game.maxPixelRatio || renderer.getPixelRatio();
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(size.x, size.y);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new CheapBloom(0.9, 0.32);
  composer.addPass(bloom);
  const grade = new ShaderPass(gradeShader);
  const G = grade.uniforms;
  G.uTint.value = new THREE.Color();
  G.uLift.value = new THREE.Color();
  G.uAspect.value = size.x / size.y;
  G.uTexel.value = new THREE.Vector2(1 / (size.x * renderer.getPixelRatio()), 1 / (size.y * renderer.getPixelRatio()));
  G.tBloom.value = bloom.texture;
  composer.addPass(grade);

  let bloomWanted = !lowTier, bloomAuto = true;
  function syncBloom() {
    bloom.enabled = bloomWanted && bloomAuto;
    G.uBloom.value = bloom.enabled ? bloom.strength : 0;
  }
  syncBloom();

  function onResize() {
    renderer.setPixelRatio(Math.min(maxPR(), maxPR() * dyn.scale));
    renderer.getSize(size);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
    G.uAspect.value = size.x / Math.max(1, size.y);
    G.uTexel.value.set(1 / Math.max(1, size.x * renderer.getPixelRatio()), 1 / Math.max(1, size.y * renderer.getPixelRatio()));
  }
  if (game.on) game.on('resize', onResize); else addEventListener('resize', onResize);

  // dynamic resolution, 45 fps target: scale 1 → 0.5 in steps of 0.1, then bloom off.
  // Recovering: bloom back on first, then resolution. Never above game.maxPixelRatio.
  const dyn = { scale: 1, slow: 0, fast: 0, last: 0, ms: 16, bloomOffs: 0, enabled: !params.has('auto') || params.has('dynres') };
  function dynres() {
    const now = performance.now();
    if (dyn.last) {
      const ms = Math.min(100, now - dyn.last);
      dyn.ms += (ms - dyn.ms) * 0.1;
      if (dyn.ms > 22) { dyn.slow += ms; dyn.fast = 0; } else if (dyn.ms < 14) { dyn.fast += ms; dyn.slow = 0; } else { dyn.slow = dyn.fast = 0; }
      let next = dyn.scale, changed = false;
      if (dyn.slow > 1000) {
        if (dyn.scale > 0.5) next = Math.max(0.5, Math.round((dyn.scale - 0.1) * 10) / 10);
        else if (bloomAuto && bloomWanted && dyn.slow > 1500) { bloomAuto = false; dyn.bloomOffs++; changed = true; }
      } else if (dyn.fast > 4000) {
        // a bloom that was dropped twice stays off
        if (!bloomAuto && dyn.bloomOffs < 2 && dyn.fast > 6000) { bloomAuto = true; changed = true; }
        else if (dyn.scale < 1) next = Math.min(1, Math.round((dyn.scale + 0.1) * 10) / 10);
      }
      if (next !== dyn.scale) { dyn.scale = next; onResize(); changed = true; }
      if (changed) { syncBloom(); dyn.slow = dyn.fast = 0; dyn.ms = 18; }
    }
    dyn.last = now;
  }

  // --- time of day ----------------------------------------------------------
  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3();
  const fogCol = new THREE.Color(), cA = new THREE.Color(), cB = new THREE.Color();
  const keyDir = new THREE.Vector3(0, 1, 0);
  let night = 0, flash = 0, hurtPulseT = 0;

  function applyHour(hour) {
    const n = night = nightness(hour);
    const L = (k) => cA.copy(DUSK[k]).lerp(NIGHT[k], n);   // shared scratch: copy() it out at once
    const lf = (k) => DUSK[k] + (NIGHT[k] - DUSK[k]) * n;
    const h = ((hour % 24) + 24) % 24;
    const hh = h < 12 ? h + 24 : h;
    // the night keeps going: zenith deepens toward 23:00+, the moon climbs and tears the deck
    const deep = smooth(20.6, 23.3, hh) * n;

    // sun: sets in the WNW around 19.4; moon climbs in the ESE after 20
    const sunEl = THREE.MathUtils.degToRad((19.4 - (h < 12 ? h + 24 : h)) * 6.5);
    sunDir.set(-0.94, 0, -0.34).multiplyScalar(Math.cos(sunEl)).setY(Math.sin(sunEl)).normalize();
    // moon rises in the ESE after 19.5 and swings through the south; by 23:00 it hangs ~40°
    // south of west, so it sits in frame looking down the bridge toward the castle
    const mt = clamp01((hh - 19.5) / 4);
    const moonAz = THREE.MathUtils.degToRad(56.5 + 93.5 * mt);
    const moonEl = THREE.MathUtils.degToRad(Math.min(28, 10 + 4.6 * Math.max(0, hh - 19.5)));
    moonDir.set(Math.cos(moonAz), 0, Math.sin(moonAz)).multiplyScalar(Math.cos(moonEl)).setY(Math.sin(moonEl)).normalize();

    fogCol.copy(L('horizon')).multiplyScalar(1 - 0.18 * deep);
    // west horizon warms the fog a touch at dusk
    fogCol.lerp(DUSK.glow, 0.06 * (1 - n));
    skyU.uZenith.value.copy(L('zenith')).multiplyScalar(1 - 0.55 * deep);
    skyU.uHorizon.value.copy(fogCol);
    skyU.uGlow.value.copy(DUSK.glow);
    const glowAmt = smooth(-8, 3, THREE.MathUtils.radToDeg(sunEl)) * (1 - n);
    skyU.uGlowAmt.value = glowAmt * 0.9;
    skyU.uSunDir.value.copy(sunDir);
    skyU.uMoonDir.value.copy(moonDir);
    skyU.uMoonAmt.value = smooth(0.4, 1, n) * (0.2 + 0.8 * deep);
    skyU.uMoonBreak.value = deep;
    moonU.uAmt.value = skyU.uMoonAmt.value;
    moonU.uBreak.value = deep;
    // blue hour: after the warm glow dies, a last cold blue band lingers low in the west
    skyU.uBlueAmt.value = smooth(19.4, 20.1, hh) * (1 - smooth(21.2, 22.2, hh));
    skyU.uFireAmt.value = 0.03 + 0.06 * n;
    skyU.uNight.value = n;

    scene.fog.color.copy(fogCol);
    scene.fog.density = lf('fog');

    // ambient follows its own, slower curve: at 20:00–20:30 the streets must still read as
    // shapes without the torch; only after ~21 does it sink to the night floor. Late night it
    // goes colder and a little darker again (the moon key carries the shapes then).
    const an = smooth(18.8, 21.3, hh);
    hemi.color.copy(DUSK.hemiSky).lerp(NIGHT.hemiSky, an).lerp(LATE.hemiSky, deep);
    hemi.groundColor.copy(DUSK.hemiGround).lerp(NIGHT.hemiGround, an);
    hemi.intensity = (DUSK.hemi + (NIGHT.hemi - DUSK.hemi) * an) * (1 - 0.12 * (1 - n)) * (1 - 0.2 * deep);

    // key light: overcast sun fades out, cold moon fades in
    const sunI = 1.5 * smooth(-4, 6, THREE.MathUtils.radToDeg(sunEl)) * (1 - n);
    const moonI = (0.28 + 0.14 * deep) * smooth(0.5, 1, n);
    if (sunI >= moonI) { key.color.setRGB(1.0, 0.66, 0.45); key.intensity = sunI; tmp.copy(sunDir); }
    else { key.color.setRGB(0.55, 0.66, 0.95).lerp(cB.setRGB(0.48, 0.62, 1.0), deep); key.intensity = moonI; tmp.copy(moonDir); }
    tmp.y = Math.max(tmp.y, 0.12);
    keyDir.copy(tmp).normalize();

    rainU.uColor.value.setRGB(0.42, 0.46, 0.5).multiplyScalar(1 - 0.8 * n);
    smokeU.uColor.value.setRGB(0.07, 0.07, 0.075).multiplyScalar(1 - 0.75 * n);
    smokeU.uFireAmt.value = 0.04 + 0.1 * n;
    smokeU.uFogColor.value.copy(fogCol);
    smokeU.uFogDensity.value = scene.fog.density;

    // late grade: colder, darker, a touch more contrast — 23:00 must not look like 21:00
    G.uDesat.value = lf('desat') + (LATE.desat - NIGHT.desat) * deep;
    G.uContrast.value = lf('contrast') + (LATE.contrast - NIGHT.contrast) * deep;
    G.uTint.value.copy(L('tint')).lerp(LATE.tint, deep);
    G.uLift.value.copy(L('lift')).lerp(LATE.lift, deep);
  }

  function setHour(h) {
    if (game.time) game.time.hour = h;
    applyHour(h);
  }

  let lastHour = NaN;
  function update(dt) {
    try {
      const t = game.time?.t ?? 0;
      const hour = game.time?.hour ?? 18.6;
      if (Math.abs(hour - lastHour) > 0.002 || Number.isNaN(lastHour)) { lastHour = hour; applyHour(hour); }
      if (!(Math.abs(hour - envHour) < 0.2)) updateEnv(hour);
      scene.environmentIntensity = game.interior?.inside ? ENV_I * 0.25 : ENV_I;

      const cp = camera.position;
      sky.position.copy(cp);
      moon.position.copy(cp).addScaledVector(moonDir, MOON_D);
      moon.quaternion.copy(camera.quaternion);
      moon.visible = moonU.uAmt.value > 0.002;
      moonU.uTime.value = t;
      key.position.copy(cp).addScaledVector(keyDir, 100);
      key.target.position.copy(cp);
      skyU.uTime.value = t;
      rainU.uTime.value = t;
      rainU.uCam.value.copy(cp);
      smokeU.uTime.value = t;
      // the pharmacy is a closed box: no dome, smoke, moon or rain behind its walls (3 draws)
      const outside = !game.interior?.inside;
      rain.visible = outside;
      sky.visible = outside;
      smoke.visible = outside;
      moon.visible = moon.visible && outside;

      updateFires(dt, t);

      // flash: gone in ~60 ms
      flash *= Math.exp(-dt / 0.02);
      if (flash < 0.003) flash = 0;
      G.uFlash.value = flash;

      // low health: red pulse at heart rate, extra desat
      const hp = game.player?.health ?? 100;
      const hurt = smooth(55, 12, hp) * (game.player?.alive === false ? 0.6 : 1);
      hurtPulseT += dt * (1.1 + hurt * 1.3);
      const ph = hurtPulseT % 1;
      G.uHurt.value = hurt;
      G.uPulse.value = Math.exp(-ph * 7) + 0.6 * Math.exp(-Math.max(0, ph - 0.22) * 9) * (ph > 0.22 ? 1 : 0);
      G.uTime.value = t;
      G.uGrain.value = 0.05 + 0.04 * night;
      // lens fringe only as a symptom: near zero at full health
      G.uFringe.value = 0.0001 + 0.0017 * hurt;
    } catch (e) {
      if (!update._warned) { update._warned = 1; console.error('[atmos]', e); }
    }
  }

  function render() {
    if (dyn.enabled) dynres();
    composer.render(game.time?.dt || 1 / 60);
  }

  // Boot: one env update here, before main's warmup, so CubemapToCubeUV and the
  // SphericalGaussianBlur shaders are compiled with everything else.
  applyHour(game.time?.hour ?? 18.6);
  updateEnv(game.time?.hour ?? 18.6);
  // Lost context: the PMREM target came back empty (the river reflected black until the next
  // 0.2 h step). Rebuild it at once.
  game.on?.('contextrestored', () => {
    const h = game.time?.hour ?? 18.6;
    envHour = NaN;
    applyHour(h);
    updateEnv(h);
  });

  return {
    update, render, setHour,
    flash(intensity = 1) { flash = Math.min(1.2, flash + intensity * 0.9); },
    get envMap() { return envRT?.texture ?? null; },
    lowTier,
    setBloom(on) { bloomWanted = !!on; syncBloom(); },
    composer, bloom, lights: { hemi, key, fires: fireLights }, dyn,
    get night() { return night; },
  };
}
