// Atmosphere: sky, sun/moon, ambient, fog, drizzle, smoke, camp-fire flicker, post chain.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { skyVert, skyFrag, rainVert, rainFrag, smokeVert, smokeFrag, gradeShader } from './atmos/shaders.js';

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

// Nightness 0..1 for any hour (dusk 18.6→20.5, dawn 4.5→6.5 for completeness).
export function nightness(h) {
  h = ((h % 24) + 24) % 24;
  if (h >= 12) return smooth(18.6, 20.5, h);
  return 1 - smooth(4.5, 6.5, h);
}

export function create(game) {
  const { scene, camera, renderer } = game;
  const params = game.params || new URLSearchParams();
  const tmp = new THREE.Vector3();

  // --- sky dome -------------------------------------------------------------
  const skyU = {
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() }, uMoonDir: { value: new THREE.Vector3() },
    uFireCol: { value: C(1.0, 0.33, 0.08) },
    uTime: { value: 0 }, uNight: { value: 0 }, uGlowAmt: { value: 1 }, uMoonAmt: { value: 0 }, uFireAmt: { value: 0 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(500, 32, 16),
    new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.name = 'atmos.sky';
  scene.add(sky);

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

  // --- camp fire flicker ----------------------------------------------------
  let fireLights = null, fireTimer = 0;
  const firePos = (f) => (f.isVector3 ? f : new THREE.Vector3(f.x ?? f[0], f.y ?? (game.layout?.heightAt?.(f.x ?? f[0], f.z ?? f[2]) ?? 0) + 0.6, f.z ?? f[2]));
  function ensureFires() {
    const fires = game.world?.fires;
    if (fireLights || !Array.isArray(fires) || !fires.length) return;
    fireLights = [];
    for (let i = 0; i < Math.min(4, fires.length); i++) {
      const l = new THREE.PointLight(0xff7a2e, 0, 22, 2);
      l.userData.seed = i * 3.7;
      scene.add(l);
      fireLights.push(l);
    }
  }
  function updateFires(dt, t) {
    ensureFires();
    if (!fireLights) return;
    const fires = game.world.fires;
    fireTimer -= dt;
    if (fireTimer <= 0) {   // reassign to the nearest fires a few times a second
      fireTimer = 0.25;
      const cp = camera.position;
      const sorted = fires.map(firePos).sort((a, b) => a.distanceToSquared(cp) - b.distanceToSquared(cp));
      fireLights.forEach((l, i) => { l.userData.on = !!sorted[i] && sorted[i].distanceTo(cp) < 120; if (sorted[i]) l.userData.home = sorted[i]; });
    }
    for (const l of fireLights) {
      if (!l.userData.on) { l.intensity = 0; continue; }
      const s = l.userData.seed;
      const f = 0.7 + 0.18 * Math.sin(t * 11 + s) + 0.12 * Math.sin(t * 23.7 + s * 2) + 0.1 * Math.sin(t * 5.3 + s * 5);
      l.intensity = 38 * f;
      const h = l.userData.home;
      l.position.set(h.x + Math.sin(t * 7 + s) * 0.08, h.y + 0.4 + Math.sin(t * 9 + s) * 0.06, h.z + Math.cos(t * 6 + s) * 0.08);
    }
  }

  // --- post chain -----------------------------------------------------------
  const size = new THREE.Vector2();
  renderer.getSize(size);
  const basePR = renderer.getPixelRatio();
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(basePR);
  composer.setSize(size.x, size.y);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.45, 0.92);   // internally half-res + mips
  composer.addPass(bloom);
  const grade = new ShaderPass(gradeShader);
  const G = grade.uniforms;
  G.uTint.value = new THREE.Color();
  G.uLift.value = new THREE.Color();
  G.uAspect.value = size.x / size.y;
  composer.addPass(grade);
  composer.addPass(new OutputPass());

  function onResize() {
    renderer.getSize(size);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
    G.uAspect.value = size.x / Math.max(1, size.y);
  }
  if (game.on) game.on('resize', onResize); else addEventListener('resize', onResize);

  // dynamic resolution: 45 fps floor
  const dyn = { scale: 1, slow: 0, fast: 0, last: 0, ms: 16, enabled: !params.has('auto') || params.has('dynres') };
  function dynres() {
    const now = performance.now();
    if (dyn.last) {
      const ms = Math.min(100, now - dyn.last);
      dyn.ms += (ms - dyn.ms) * 0.1;
      if (dyn.ms > 22) { dyn.slow += ms; dyn.fast = 0; } else if (dyn.ms < 14) { dyn.fast += ms; dyn.slow = 0; } else { dyn.slow = dyn.fast = 0; }
      let next = dyn.scale;
      if (dyn.slow > 1000) next = Math.max(0.6, dyn.scale - 0.1);
      else if (dyn.fast > 4000) next = Math.min(1, dyn.scale + 0.1);
      if (next !== dyn.scale) {
        dyn.scale = next; dyn.slow = dyn.fast = 0; dyn.ms = 18;
        renderer.setPixelRatio(basePR * next);
        onResize();
      }
    }
    dyn.last = now;
  }

  // --- time of day ----------------------------------------------------------
  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3();
  const fogCol = new THREE.Color(), cA = new THREE.Color();
  let night = 0, flash = 0, hurtPulseT = 0;

  function applyHour(hour) {
    const n = night = nightness(hour);
    const L = (k) => cA.copy(DUSK[k]).lerp(NIGHT[k], n).clone();
    const lf = (k) => DUSK[k] + (NIGHT[k] - DUSK[k]) * n;
    const h = ((hour % 24) + 24) % 24;

    // sun: sets in the WNW around 19.4; moon climbs in the ESE after 20
    const sunEl = THREE.MathUtils.degToRad((19.4 - (h < 12 ? h + 24 : h)) * 6.5);
    sunDir.set(-0.94, 0, -0.34).multiplyScalar(Math.cos(sunEl)).setY(Math.sin(sunEl)).normalize();
    const moonEl = THREE.MathUtils.degToRad(12 + Math.max(0, (h < 12 ? h + 24 : h) - 19.5) * 9);
    moonDir.set(0.55, 0, 0.83).multiplyScalar(Math.cos(moonEl)).setY(Math.sin(moonEl)).normalize();

    fogCol.copy(L('horizon'));
    // west horizon warms the fog a touch at dusk
    fogCol.lerp(DUSK.glow, 0.06 * (1 - n));
    skyU.uZenith.value.copy(L('zenith'));
    skyU.uHorizon.value.copy(fogCol);
    skyU.uGlow.value.copy(DUSK.glow);
    const glowAmt = smooth(-8, 3, THREE.MathUtils.radToDeg(sunEl)) * (1 - n);
    skyU.uGlowAmt.value = glowAmt * 0.9;
    skyU.uSunDir.value.copy(sunDir);
    skyU.uMoonDir.value.copy(moonDir);
    skyU.uMoonAmt.value = smooth(0.4, 1, n) * 0.25;
    skyU.uFireAmt.value = 0.03 + 0.06 * n;
    skyU.uNight.value = n;

    scene.fog.color.copy(fogCol);
    scene.fog.density = lf('fog');

    hemi.color.copy(L('hemiSky'));
    hemi.groundColor.copy(L('hemiGround'));
    hemi.intensity = lf('hemi');

    // key light: overcast sun fades out, cold moon fades in
    const sunI = 1.5 * smooth(-4, 6, THREE.MathUtils.radToDeg(sunEl)) * (1 - n);
    const moonI = 0.28 * smooth(0.5, 1, n);
    if (sunI >= moonI) { key.color.setRGB(1.0, 0.66, 0.45); key.intensity = sunI; tmp.copy(sunDir); }
    else { key.color.setRGB(0.55, 0.66, 0.95); key.intensity = moonI; tmp.copy(moonDir); }
    tmp.y = Math.max(tmp.y, 0.12);
    key.userData.dir = tmp.clone().normalize();

    rainU.uColor.value.setRGB(0.42, 0.46, 0.5).multiplyScalar(1 - 0.8 * n);
    smokeU.uColor.value.setRGB(0.07, 0.07, 0.075).multiplyScalar(1 - 0.75 * n);
    smokeU.uFireAmt.value = 0.04 + 0.1 * n;
    smokeU.uFogColor.value.copy(fogCol);
    smokeU.uFogDensity.value = scene.fog.density;

    G.uDesat.value = lf('desat');
    G.uContrast.value = lf('contrast');
    G.uTint.value.copy(L('tint'));
    G.uLift.value.copy(L('lift'));
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

      const cp = camera.position;
      sky.position.copy(cp);
      key.position.copy(cp).addScaledVector(key.userData.dir, 100);
      key.target.position.copy(cp);
      skyU.uTime.value = t;
      rainU.uTime.value = t;
      rainU.uCam.value.copy(cp);
      smokeU.uTime.value = t;
      rain.visible = !game.interior?.inside;

      updateFires(dt, t);

      // flash decays over ~80 ms
      flash *= Math.exp(-dt / 0.028);
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
    } catch (e) {
      if (!update._warned) { update._warned = 1; console.error('[atmos]', e); }
    }
  }

  function render() {
    if (dyn.enabled) dynres();
    composer.render(game.time?.dt || 1 / 60);
  }

  applyHour(game.time?.hour ?? 18.6);

  return {
    update, render, setHour,
    flash(intensity = 1) { flash = Math.min(2.5, flash + intensity); },
    composer, bloom, lights: { hemi, key }, dyn,
    get night() { return night; },
  };
}
