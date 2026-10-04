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

// Moon: a camera-facing quad (always round on screen). Soft disc with a darker limb and a soft
// halo, veiled by the same cloud deck the dome draws. Additive over the sky.
export const moonVert = /* glsl */`
varying vec2 vUv;
varying vec3 vDir;
void main() {
  vUv = uv * 2.0 - 1.0;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
export const moonFrag = /* glsl */`
uniform float uAmt, uBreak, uTime;
uniform vec3 uCol;
varying vec2 vUv;
varying vec3 vDir;
${NOISE}
void main() {
  float r = length(vUv) * 7.0;            // 1.0 = disc edge
  vec3 d = normalize(vDir);
  float h = d.y;
  vec2 cp = d.xz / max(h + 0.06, 0.02) * 0.9 + vec2(uTime * 0.012, uTime * 0.004);
  float c = fbm(cp * 1.3);
  float c2 = fbm(cp * 3.7 + 5.0);
  float dens = smoothstep(0.3, 0.75, c * 0.75 + c2 * 0.35);
  dens *= 1.0 - 0.92 * uBreak;
  float disc = 1.0 - smoothstep(0.82, 1.06, r);
  float limb = mix(0.78, 1.0, sqrt(max(0.0, 1.0 - min(r, 1.0) * min(r, 1.0))));
  // a little surface: two faint maria
  float mare = 1.0 - 0.16 * smoothstep(0.55, 0.1, length(vUv * 7.0 - vec2(-0.25, 0.2)))
                   - 0.10 * smoothstep(0.4, 0.05, length(vUv * 7.0 - vec2(0.3, -0.25)));
  float halo = exp(-max(r - 0.9, 0.0) * 1.6) * 0.45 + exp(-max(r - 0.9, 0.0) * 0.5) * 0.12;
  halo *= smoothstep(1.0, 0.75, length(vUv));   // fade out before the quad's edge
  float veil = 1.0 - dens * 0.92;
  vec3 col = uCol * (disc * limb * mare * 2.2 * veil + halo * (1.0 - dens * 0.6)) * uAmt;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// Overcast dome. Horizon colour == fog colour so the city melts into it.
export const skyFrag = /* glsl */`
uniform vec3 uZenith, uHorizon, uGlow, uSunDir, uMoonDir, uFireCol;
uniform float uTime, uNight, uGlowAmt, uMoonAmt, uMoonBreak, uFireAmt, uBlueAmt;
varying vec3 vDir;
${NOISE}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float up = clamp(h, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  float md = max(dot(d, uMoonDir), 0.0);

  // low cloud deck: projected onto a plane, drifting east→west-ish
  vec2 cp = d.xz / max(h + 0.06, 0.02) * 0.9 + vec2(uTime * 0.012, uTime * 0.004);
  float c = fbm(cp * 1.3);
  float c2 = fbm(cp * 3.7 + 5.0);
  float dens = smoothstep(0.3, 0.75, c * 0.75 + c2 * 0.35);
  // late night: the deck tears open around the moon (ragged edge from the noise)
  float brk = uMoonBreak * smoothstep(0.80, 0.97, md + (c2 - 0.5) * 0.12);
  dens *= 1.0 - 0.92 * brk;
  float horizonFade = smoothstep(-0.02, 0.25, h);
  vec3 cloudDark = mix(uHorizon, uZenith, 0.6) * 0.72;
  vec3 cloudLit = mix(uHorizon, uZenith, 0.25) * 1.12;
  vec3 cloudCol = mix(cloudLit, cloudDark, dens);
  // in the break: clear, cold, darker-than-cloud sky
  cloudCol = mix(cloudCol, uZenith * vec3(0.55, 0.7, 1.15), brk * (1.0 - dens));

  // sunset glow, low in the west, bleeding under the clouds
  float sd = max(dot(d, uSunDir), 0.0);
  float glow = pow(sd, 6.0) * (1.0 - smoothstep(0.0, 0.45, h)) + pow(sd, 40.0) * 0.6;
  vec3 glowCol = uGlow * glow * uGlowAmt;
  cloudCol += glowCol * (1.0 - dens * 0.7) * 1.4;

  // blue hour: once the sun is gone a cold band lingers low in the west under the deck
  vec3 sunH = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-5);
  float west = pow(max(dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), sunH), 0.0), 3.0);
  vec3 blue = vec3(0.05, 0.085, 0.16) * west * exp(-max(h, 0.0) * 5.0) * uBlueAmt;
  cloudCol += blue * (1.0 - dens * 0.6) * 1.6;

  // moon: the disc and inner halo are the camera-facing quad (moonFrag); the dome keeps only
  // the wide cold glow and the silver cloud edges
  vec3 moonC = vec3(0.55, 0.64, 0.82);
  float moonHalo = pow(md, 120.0) * 0.07;
  vec3 moon = moonC * moonHalo * uMoonAmt * (1.0 - dens * 0.9);
  float edge = clamp(dens * (1.0 - dens) * 4.0, 0.0, 1.0);
  cloudCol += moonC * uMoonAmt * (pow(md, 6.0) * 0.03 + edge * pow(md, 14.0) * (0.12 + 0.3 * uMoonBreak));

  // a few stars, only where the deck is torn open
  vec2 sg = vec2(atan(d.z, d.x) * 120.0, h * 120.0);
  vec2 sc = floor(sg);
  float sr = hash12(sc);
  float star = step(0.985, sr) * smoothstep(0.42, 0.1, length(fract(sg) - 0.5)) * (0.5 + 0.5 * sin(uTime * 3.0 + sr * 60.0));
  vec3 stars = vec3(0.6, 0.66, 0.8) * star * 0.09 * uMoonBreak * (1.0 - smoothstep(0.05, 0.35, dens)) * smoothstep(0.1, 0.3, h);

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

  col = mix(col, cloudCol, horizonFade * 0.92) + glowCol * (1.0 - horizonFade) + blue * (1.0 - horizonFade) + moon + stars + fire;
  // below the horizon: plain fog
  col = mix(uHorizon + fire * 0.6, col, smoothstep(-0.04, 0.02, h));
  // alpha 0 marks "sky" for the grade (muzzle flash must not light it)
  gl_FragColor = vec4(col, 0.0);
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

// Cheap bloom: threshold + downsample to 1/4, two more mips (1/8, 1/16), tent-upsampled back
// additively into the 1/4 target. The grade samples it.
const quadVert = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
export const bloomShaders = {
  vert: quadVert,
  // 4 bilinear taps 1 texel apart in the source cover a 4x4 block → full→1/4 in one pass
  prefilter: /* glsl */`
    uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold;
    varying vec2 vUv;
    vec3 tap(vec2 o) {
      vec4 s = texture2D(tSrc, vUv + o * uTexel);
      vec3 c = min(s.rgb, vec3(12.0)) * s.a;                  // sky (alpha 0) never blooms
      float b = max(c.r, max(c.g, c.b));
      return c * smoothstep(uThreshold, uThreshold * 1.6, b);
    }
    void main() {
      gl_FragColor = vec4((tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0))) * 0.25, 1.0);
    }
  `,
  down: /* glsl */`
    uniform sampler2D tSrc; uniform vec2 uTexel;
    varying vec2 vUv;
    void main() {
      vec2 t = uTexel;
      vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
      c += texture2D(tSrc, vUv + vec2(-t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb;
      c += texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb + texture2D(tSrc, vUv + vec2(t.x, t.y)).rgb;
      gl_FragColor = vec4(c / 8.0, 1.0);
    }
  `,
  up: /* glsl */`
    uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uGain;
    varying vec2 vUv;
    void main() {
      vec2 t = uTexel;
      vec3 c = texture2D(tSrc, vUv + vec2(-t.x * 2.0, 0.0)).rgb + texture2D(tSrc, vUv + vec2(t.x * 2.0, 0.0)).rgb;
      c += texture2D(tSrc, vUv + vec2(0.0, -t.y * 2.0)).rgb + texture2D(tSrc, vUv + vec2(0.0, t.y * 2.0)).rgb;
      c += (texture2D(tSrc, vUv + vec2(-t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb
          + texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb + texture2D(tSrc, vUv + vec2(t.x, t.y)).rgb) * 2.0;
      gl_FragColor = vec4(c / 12.0 * uGain, 1.0);
    }
  `,
};

// Final grade in linear HDR, then ACES tone-mapping + sRGB (folds three's OutputPass in).
export const gradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tBloom: { value: null },
    uBloom: { value: 0 },
    uTime: { value: 0 },
    uDesat: { value: 0.55 },
    uContrast: { value: 1.12 },
    uTint: { value: null },
    uLift: { value: null },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.05 },
    uFringe: { value: 0.0001 },
    uHurt: { value: 0 },
    uPulse: { value: 0 },
    uFlash: { value: 0 },
    uAspect: { value: 16 / 9 },
    uTexel: { value: null },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tBloom;
    uniform float uTime, uDesat, uContrast, uVignette, uGrain, uFringe, uHurt, uPulse, uFlash, uAspect, uBloom;
    uniform vec3 uTint, uLift;
    uniform vec2 uTexel;
    varying vec2 vUv;
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec2 dc = vUv - 0.5;
      float r2 = dot(dc * vec2(uAspect, 1.0), dc * vec2(uAspect, 1.0)) / uAspect;
      vec2 off = dc * r2 * uFringe * 6.0;
      vec4 s0 = texture2D(tDiffuse, vUv);
      vec3 c;
      c.g = s0.g;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.b = texture2D(tDiffuse, vUv - off).b;
      float solid = s0.a;                          // 0 = sky dome, 1 = geometry
      // 1-px sky pin-holes along wall/street seams: a "sky" pixel walled in on two opposite
      // sides by geometry is a crack, not sky — fill it from those neighbours.
      if (solid < 0.5) {
        vec4 a = texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)), b = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0));
        vec4 u = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)), v = texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y));
        if (a.a > 0.5 && b.a > 0.5) { c = (a.rgb + b.rgb) * 0.5; solid = 1.0; }
        else if (u.a > 0.5 && v.a > 0.5) { c = (u.rgb + v.rgb) * 0.5; solid = 1.0; }
      }
      if (uBloom > 0.0) c += texture2D(tBloom, vUv).rgb * uBloom;

      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float desat = clamp(uDesat + uHurt * 0.35, 0.0, 1.0);
      c = mix(c, vec3(l), desat);
      c = c * uTint + uLift;
      // contrast around mid-grey in log-ish space
      c = 0.18 * pow(max(c, 0.0) / 0.18, vec3(uContrast));

      // muzzle flash: a warm lift on what's around you, held under the sky's level so
      // nothing saturates; the dome only gets a trace.
      float f = uFlash * mix(0.08, 1.0, solid);
      float gain = f * 1.3 / (1.0 + l * 6.0);      // dark things lift most, bright ones barely
      c += c * gain * vec3(1.0, 0.82, 0.62) + f * vec3(0.006, 0.0045, 0.0025);

      float vig = smoothstep(0.85, 0.15, r2 * 1.25);
      c *= mix(1.0, vig, uVignette);

      // low health: red pulse creeping in from the edges
      float hw = uHurt * (0.4 + 0.6 * uPulse) * smoothstep(0.06, 0.5, r2);
      c = mix(c, c * vec3(1.1, 0.25, 0.22) + vec3(0.035, 0.0, 0.0), clamp(hw, 0.0, 0.7));

      // animated grain, stronger in the darks
      float g = hash(vUv * vec2(1931.0, 1173.0) + fract(uTime * 7.31) * 113.0) - 0.5;
      c += g * uGrain * (0.02 + sqrt(max(l, 0.0)) * 0.6);
      gl_FragColor = vec4(max(c, 0.0), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};
