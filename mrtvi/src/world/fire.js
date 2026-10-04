// Barrel fires: per fire, 4 crossed vertical quads with an animated value-noise flame (dim
// orange body, small bright core, ragged tongues), plus GPU-animated embers rising and fading.
// Additive, no depth write, no lights (atmos lights the nearest world.fires entries); both fade
// out with the scene fog. ('world:ember' is the glowing coal disc on each barrel, 'world:embers'
// the sparks — different things, not a duplicate.)

// Additive glow has to fade to black in fog (mixing towards the fog colour would brighten it):
// three's fog chunks give vFogDepth + the fog uniforms, FADE turns them into a 0..1 visibility.
const FADE = /* glsl */`
  float fogVis() {
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        return exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
      #else
        return 1.0 - smoothstep( fogNear, fogFar, vFogDepth );
      #endif
    #else
      return 1.0;
    #endif
  }`;
const FLAME_VS = /* glsl */`
  #include <fog_pars_vertex>
  attribute float aSeed;
  varying vec2 vUv;
  varying float vSeed;
  void main() {
    vUv = uv; vSeed = aSeed;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const FLAME_FS = /* glsl */`
  #include <fog_pars_fragment>
  ${FADE}
  uniform float uTime;
  varying vec2 vUv;
  varying float vSeed;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { return 0.55 * n(p) + 0.3 * n(p * 2.1) + 0.15 * n(p * 4.3); }
  void main() {
    vec2 p = vUv;
    float t = uTime * 1.6 + vSeed * 17.0;
    float x = (p.x - 0.5) * 2.0;
    float y = p.y;
    float sway = (n(vec2(y * 2.0 - t * 0.7, vSeed * 9.0)) - 0.5) * 0.35 * y;
    x -= sway;
    float noise = fbm(vec2(x * 2.2, y * 3.2 - t * 2.4));
    // teardrop envelope narrowing upwards, eaten away by rising noise
    float width = (1.0 - y) * (0.75 + 0.25 * sin(y * 3.1));
    float body = width - abs(x) * 0.85 - y * 0.3 + (noise - 0.5) * 0.9;
    float a = smoothstep(0.0, 0.25, body) * smoothstep(0.0, 0.08, y);
    if (a < 0.01) discard;
    float core = smoothstep(0.35, 0.8, body) * (1.0 - smoothstep(0.1, 0.4, y));
    vec3 outer = vec3(0.55, 0.16, 0.03);
    vec3 mid = vec3(0.95, 0.34, 0.05);
    vec3 hot = vec3(1.0, 0.82, 0.5);
    vec3 col = mix(outer, mid, smoothstep(0.1, 0.45, body));
    col = mix(col, hot, core);
    gl_FragColor = vec4(col * a * (0.85 + 0.3 * noise) * 0.32 * fogVis(), 1.0);   // 4 quads overlap additively
  }`;
const EMBER_VS = /* glsl */`
  #include <fog_pars_vertex>
  uniform float uTime;
  uniform float uScale;
  attribute vec3 aBase;
  attribute vec3 aRnd;
  varying float vA;
  void main() {
    float life = 2.2 + aRnd.z * 1.6;
    float k = fract((uTime + aRnd.x * 7.0) / life);
    vec3 p = aBase;
    p.y += k * (2.2 + aRnd.y * 1.8);
    p.x += sin(k * 6.0 + aRnd.x * 20.0) * 0.25 * k + (aRnd.y - 0.5) * 0.3 * k;
    p.z += cos(k * 5.0 + aRnd.z * 20.0) * 0.25 * k + (aRnd.x - 0.5) * 0.3 * k;
    vA = (1.0 - k) * smoothstep(0.0, 0.08, k) * (0.6 + 0.4 * sin(uTime * 13.0 + aRnd.y * 40.0));
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uScale * (0.035 + 0.02 * aRnd.z) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const EMBER_FS = /* glsl */`
  #include <fog_pars_fragment>
  ${FADE}
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = 1.0 - smoothstep(0.2, 0.5, length(c));
    gl_FragColor = vec4(vec3(0.9, 0.42, 0.12) * d * vA * 0.8 * fogVis(), 1.0);
  }`;

export function buildFlames(THREE, spots, updaters, R) {
  const pos = [], uv = [], seed = [], idx = [];
  const W = 0.62, Hh = 1.05, QUADS = 4;
  spots.forEach((s, i) => {
    for (let q = 0; q < QUADS; q++) {
      const a = (q / QUADS) * Math.PI + i * 0.37, c = Math.cos(a) * W / 2, d = Math.sin(a) * W / 2;
      const h = Hh * (q % 2 ? 0.85 : 1);
      const b = pos.length / 3;
      pos.push(s.x - c, s.y, s.z - d, s.x + c, s.y, s.z + d, s.x + c, s.y + h, s.z + d, s.x - c, s.y + h, s.z - d);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      const sd = i * 1.618 + q * 0.31;
      seed.push(sd, sd, sd, sd);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const uTime = { value: 0 };
  const flames = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime }, vertexShader: FLAME_VS, fragmentShader: FLAME_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true,
  }));
  flames.name = 'world:flames';
  flames.renderOrder = 3;

  const N = 14, eb = [], er = [];
  for (const s of spots) for (let k = 0; k < N; k++) { eb.push(s.x + (R() - 0.5) * 0.3, s.y + 0.15, s.z + (R() - 0.5) * 0.3); er.push(R(), R(), R()); }
  const ge = new THREE.BufferGeometry();
  ge.setAttribute('position', new THREE.Float32BufferAttribute(eb, 3));
  ge.setAttribute('aBase', new THREE.Float32BufferAttribute(eb, 3));
  ge.setAttribute('aRnd', new THREE.Float32BufferAttribute(er, 3));
  ge.computeBoundingSphere();
  ge.boundingSphere.radius += 5;
  const uScale = { value: 600 };
  const embers = new THREE.Points(ge, new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime, uScale }, vertexShader: EMBER_VS, fragmentShader: EMBER_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
  }));
  embers.name = 'world:embers';
  embers.renderOrder = 3;
  embers.onBeforeRender = (renderer) => {
    const sz = renderer.getDrawingBufferSize?.(_v2);
    if (sz) uScale.value = sz.y;
  };
  const _v2 = new THREE.Vector2();
  updaters.push((dt) => { uTime.value += dt; });
  return [flames, embers];
}
