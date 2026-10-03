// GLSL for the atmosphere: sky dome, drizzle, smoke billboards, final grade.

export const NOISE = /* glsl */`
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}
`;

export const skyVert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;   // pin to the far plane
}
`;

// Overcast dome. Horizon colour == fog colour so the city melts into it.
export const skyFrag = /* glsl */`
uniform vec3 uZenith, uHorizon, uGlow, uSunDir, uMoonDir, uFireCol;
uniform float uTime, uNight, uGlowAmt, uMoonAmt, uFireAmt;
varying vec3 vDir;
${NOISE}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float up = clamp(h, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));

  // low cloud deck: projected onto a plane, drifting east→west-ish
  vec2 cp = d.xz / max(h + 0.06, 0.02) * 0.9 + vec2(uTime * 0.012, uTime * 0.004);
  float c = fbm(cp * 1.3);
  float c2 = fbm(cp * 3.7 + 5.0);
  float dens = smoothstep(0.3, 0.75, c * 0.75 + c2 * 0.35);
  float horizonFade = smoothstep(-0.02, 0.25, h);
  vec3 cloudDark = mix(uHorizon, uZenith, 0.6) * 0.72;
  vec3 cloudLit = mix(uHorizon, uZenith, 0.25) * 1.12;
  vec3 cloudCol = mix(cloudLit, cloudDark, dens);

  // sunset glow, low in the west, bleeding under the clouds
  float sd = max(dot(d, uSunDir), 0.0);
  float glow = pow(sd, 6.0) * (1.0 - smoothstep(0.0, 0.45, h)) + pow(sd, 40.0) * 0.6;
  vec3 glowCol = uGlow * glow * uGlowAmt;
  cloudCol += glowCol * (1.0 - dens * 0.7) * 1.4;

  // moon: a smudge through thin cloud
  float md = max(dot(d, uMoonDir), 0.0);
  float moonHalo = pow(md, 60.0) * 0.5 + pow(md, 2000.0) * 3.0;
  vec3 moon = vec3(0.55, 0.62, 0.75) * moonHalo * uMoonAmt * (1.0 - dens * 0.85);

  // distant fires: orange underglow on the horizon at a few azimuths
  float az = atan(d.z, d.x);
  float fireBand = 0.0;
  fireBand += pow(max(cos(az - 0.9), 0.0), 40.0);
  fireBand += pow(max(cos(az + 2.2), 0.0), 60.0) * 0.8;
  fireBand += pow(max(cos(az - 2.6), 0.0), 30.0) * 0.6;
  fireBand += pow(max(cos(az + 0.4), 0.0), 90.0) * 0.5;
  float flick = 0.85 + 0.15 * vnoise(vec2(az * 8.0, uTime * 1.3));
  float fireH = exp(-max(h + 0.01, 0.0) * 14.0);
  vec3 fire = uFireCol * fireBand * fireH * flick * uFireAmt;

  col = mix(col, cloudCol, horizonFade * 0.92) + glowCol * (1.0 - horizonFade) + moon + fire;
  // below the horizon: plain fog
  col = mix(uHorizon + fire * 0.6, col, smoothstep(-0.04, 0.02, h));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const rainVert = /* glsl */`
uniform vec3 uCam;
uniform float uTime, uSize;
uniform vec3 uBox;
attribute float aSpeed;
varying float vFog;
void main() {
  vec3 p = position;
  p.y -= uTime * aSpeed;
  p.x -= uTime * aSpeed * 0.12;
  p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  gl_PointSize = uSize / max(dist, 0.5);
  vFog = smoothstep(14.0, 4.0, dist) * smoothstep(0.3, 1.2, dist);
}
`;

export const rainFrag = /* glsl */`
uniform vec3 uColor;
varying float vFog;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a = smoothstep(0.06, 0.0, abs(q.x + q.y * 0.12)) * smoothstep(0.5, 0.1, abs(q.y));
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a * vFog * 0.55);
}
`;

// Smoke columns: instanced billboard quads, each particle loops up its column.
export const smokeVert = /* glsl */`
attribute vec3 aBase;
attribute vec2 aSeed;      // phase, column size scale
uniform float uTime, uHeight;
uniform vec2 uWind;
varying vec2 vUv;
varying float vAlpha, vAge, vDist;
void main() {
  float age = fract(uTime * 0.008 + aSeed.x);
  float h = age * uHeight * aSeed.y;
  vec3 c = aBase + vec3(uWind.x * h * 0.9 + sin(age * 6.0 + aSeed.x * 20.0) * 3.0, h, uWind.y * h * 0.9);
  float size = (12.0 + age * 50.0) * aSeed.y;
  vec4 mv = viewMatrix * vec4(c, 1.0);
  float a = aSeed.x * 6.283 + uTime * 0.05;
  vec2 r = mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xy;
  mv.xy += r * size;
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vAge = age;
  vAlpha = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.55, 1.0, age));
  vDist = -mv.z;
}
`;

export const smokeFrag = /* glsl */`
uniform vec3 uColor, uFireCol, uFogColor;
uniform float uFogDensity, uFireAmt;
varying vec2 vUv;
varying float vAlpha, vAge, vDist;
${NOISE}
void main() {
  vec2 q = vUv - 0.5;
  float r = length(q) * 2.0;
  float n = vnoise(vUv * 4.0 + vAge * 3.0);
  float a = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.6) * vAlpha * 0.8;
  if (a < 0.01) discard;
  vec3 col = uColor * (0.8 + 0.3 * n) + uFireCol * uFireAmt * exp(-vAge * 9.0) * 2.5;
  float f = 1.0 - exp(-pow(uFogDensity * 0.33 * vDist, 2.0));   // tall, so it reads through the haze
  col = mix(col, uFogColor, f);
  gl_FragColor = vec4(col, a * (1.0 - f * 0.6));
}
`;

// Final grade, in linear HDR before OutputPass tone-maps.
export const gradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uDesat: { value: 0.55 },
    uContrast: { value: 1.12 },
    uTint: { value: null },
    uLift: { value: null },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.05 },
    uFringe: { value: 0.0018 },
    uHurt: { value: 0 },
    uPulse: { value: 0 },
    uFlash: { value: 0 },
    uAspect: { value: 16 / 9 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uDesat, uContrast, uVignette, uGrain, uFringe, uHurt, uPulse, uFlash, uAspect;
    uniform vec3 uTint, uLift;
    varying vec2 vUv;
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec2 dc = vUv - 0.5;
      float r2 = dot(dc * vec2(uAspect, 1.0), dc * vec2(uAspect, 1.0)) / uAspect;
      vec2 off = dc * r2 * uFringe * 6.0;
      vec3 c;
      c.g = texture2D(tDiffuse, vUv).g;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.b = texture2D(tDiffuse, vUv - off).b;

      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float desat = clamp(uDesat + uHurt * 0.35, 0.0, 1.0);
      c = mix(c, vec3(l), desat);
      c = c * uTint + uLift;
      // contrast around mid-grey in log-ish space
      c = 0.18 * pow(max(c, 0.0) / 0.18, vec3(uContrast));

      // muzzle flash: warm lift
      c += uFlash * (c * 2.2 + vec3(0.025, 0.018, 0.009));

      float vig = smoothstep(0.85, 0.15, r2 * 1.25);
      c *= mix(1.0, vig, uVignette);

      // low health: red pulse creeping in from the edges
      float edge = smoothstep(0.08, 0.6, r2);
      float hw = uHurt * (0.4 + 0.6 * uPulse) * smoothstep(0.06, 0.5, r2);
      c = mix(c, c * vec3(1.1, 0.25, 0.22) + vec3(0.035, 0.0, 0.0), clamp(hw, 0.0, 0.7));

      // animated grain, stronger in the darks
      float g = hash(vUv * vec2(1931.0, 1173.0) + fract(uTime * 7.31) * 113.0) - 0.5;
      c += g * uGrain * (0.02 + sqrt(max(l, 0.0)) * 0.6);
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }
  `,
};
