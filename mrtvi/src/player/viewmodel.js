// Procedural first-person viewmodels: gloved hand + crowbar, gloved hands + CZ-75-like pistol,
// a muzzle flame and a smoke puff. All viewmodel meshes are camera children, drawn last
// (renderOrder) after a depth clear so they never clip into walls. Materials skip fog.

export function buildViewmodels(THREE, game) {
  // Warm fill from the torch side, set every frame by player.js. At night the ambient is cold
  // moonlight; this keeps leather brown and steel neutral instead of flat blue-grey.
  const warm = { value: new THREE.Color(0, 0, 0) };
  // 0 by day → 1 at night: the night grade desaturates hard and tints blue, so leather and cloth
  // are pre-warmed by this much to still read brown / olive on screen (steel is left alone)
  const warmth = { value: 0 };
  const mat = (o, { glow = 0.1, env = 0.35, leather = 0 } = {}) => {
    const m = new THREE.MeshStandardMaterial({ fog: false, ...o });
    m.metalness = Math.min(m.metalness, 0.35);                 // matte-ish: no env map to reflect
    m.emissive.copy(m.color).multiplyScalar(glow);             // never fully black in the dark
    m.transparent = true;          // forces the late (transparent) list so the depth clear works
    m.opacity = 1;
    m.depthWrite = true;
    // The flashlight and fill light sit centimetres from the viewmodel; clamp direct light so
    // inverse-square doesn't blow it out to white.
    m.onBeforeCompile = (sh) => {
      sh.uniforms.vmWarm = warm;
      sh.uniforms.vmWarmth = warmth;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 vmWarm;\nuniform float vmWarmth;');
      if (leather) {
        sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
          `outgoingLight *= mix(vec3(1.0), vec3(1.55, 1.0, 0.62), vmWarmth * ${leather.toFixed(2)});\n#include <opaque_fragment>`);
      }
      sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>',
        // strip most of the blue cast from the ambient, then add the warm fill on top
        'reflectedLight.indirectDiffuse = mix(reflectedLight.indirectDiffuse, vec3(dot(reflectedLight.indirectDiffuse, vec3(0.3, 0.5, 0.2))) * vec3(1.05, 0.97, 0.88), 0.65);\n' +
        'reflectedLight.indirectDiffuse += material.diffuseColor * vmWarm;\n' +
        '#include <aomap_fragment>');
      sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>',
        'reflectedLight.directDiffuse = min(reflectedLight.directDiffuse, material.diffuseColor * 0.45);\n' +
        'reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(0.006) + material.diffuseColor * 0.35);\n' +
        // scene.environment lights the near-camera meshes like a lit studio: tone it down so the
        // hands sit in the night instead of reading as pale plastic
        `reflectedLight.indirectDiffuse *= ${env.toFixed(2)};\nreflectedLight.indirectSpecular *= ${(env * 0.85).toFixed(2)};\n#include <aomap_fragment>`);
    };
    m.customProgramCacheKey = () => 'vm-clamp-warm-' + env.toFixed(2) + '-' + leather;
    return m;
  };
  const canvasTex = (w, h, draw, repeat) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  };
  // deterministic jitter so the art doesn't change between loads
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // Worn steel: grey with scuffs and a few brighter scrapes, so the bar reads as metal, not a
  // black silhouette.
  const steelTex = canvasTex(64, 256, (g, w, h) => {
    g.fillStyle = '#8a8d92'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const v = 100 + rnd() * 70 | 0;
      g.fillStyle = `rgba(${v},${v + 2},${v + 6},${0.25 + rnd() * 0.3})`;
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 4 + rnd() * 24);
    }
    for (let i = 0; i < 40; i++) {                      // dark pits and oil
      g.fillStyle = `rgba(30,26,22,${0.25 + rnd() * 0.35})`;
      g.beginPath(); g.arc(rnd() * w, rnd() * h, 1 + rnd() * 3, 0, 7); g.fill();
    }
    for (let i = 0; i < 6; i++) {                       // rust freckles
      g.fillStyle = `rgba(120,64,34,${0.3 + rnd() * 0.3})`;
      g.beginPath(); g.arc(rnd() * w, rnd() * h, 2 + rnd() * 5, 0, 7); g.fill();
    }
  });
  // Checkered pistol grip panel.
  const gripTex = canvasTex(32, 32, (g, w, h) => {
    g.fillStyle = '#4a3527'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(20,12,8,0.85)'; g.lineWidth = 1.5;
    for (let i = -w; i < w * 2; i += 6) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
      g.beginPath(); g.moveTo(i, h); g.lineTo(i + h, 0); g.stroke();
    }
  }, [2, 3]);
  // Leather glove with creases.
  const gloveTex = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#7a685a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const v = rnd();
      g.fillStyle = v < 0.5 ? `rgba(40,30,24,${0.2 + rnd() * 0.3})` : `rgba(150,132,116,${0.15 + rnd() * 0.2})`;
      g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 10, 1);
    }
  });

  const rustTex = game.tex?.rust?.isTexture ? game.tex.rust : null;
  const M = {
    steel: mat({ color: 0x55585e, metalness: 0.6, roughness: 0.4 }),
    blued: mat({ color: 0x383b42, metalness: 0.6, roughness: 0.42 }, { env: 0.5 }),
    slide: mat({ color: 0x4a4e55, metalness: 0.6, roughness: 0.36 }, { env: 0.5 }),
    edge: mat({ color: 0x9a9ea5, metalness: 0.5, roughness: 0.3 }, { glow: 0.12, env: 0.55 }),   // worn bevels
    rust: mat({ color: rustTex ? 0x7a5440 : 0x5a3a28, map: rustTex, metalness: 0.3, roughness: 0.85 }),
    bar: mat({ color: 0x5e626a, map: steelTex, metalness: 0.6, roughness: 0.38 }, { glow: 0.1, env: 0.5 }),   // the pistol's steel, worn
    tape: mat({ color: 0x2a2826, metalness: 0.0, roughness: 1.0 }),
    grip: mat({ color: 0xffffff, map: gripTex, metalness: 0.0, roughness: 0.85 }, { env: 0.5, leather: 1 }),
    glove: mat({ color: 0x6a5646, map: gloveTex, metalness: 0.0, roughness: 0.8 }, { glow: 0.08, env: 0.5, leather: 1 }),
    cuff: mat({ color: 0x3a2e26, metalness: 0.0, roughness: 0.9 }, { env: 0.5, leather: 1 }),
    sleeve: mat({ color: 0x4a5240, metalness: 0.0, roughness: 1.0 }, { env: 0.5, leather: 0.6 }),   // olive canvas jacket
  };

  const ORDER = 1000;
  const add = (parent, geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.renderOrder = ORDER;
    mesh.frustumCulled = false;
    parent.add(mesh);
    return mesh;
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (r0, r1, h, n = 8) => new THREE.CylinderGeometry(r0, r1, h, n);
  const cap = (r, len, n = 8) => new THREE.CapsuleGeometry(r, len, 3, n);
  // A box with rounded edges: push every vertex out from the inner box by r.
  const _v = new THREE.Vector3(), _c = new THREE.Vector3();
  function rbox(w, h, d, r, seg = 3) {
    const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
    const pa = g.attributes.position, na = g.attributes.normal;
    const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
    for (let i = 0; i < pa.count; i++) {
      _v.fromBufferAttribute(pa, i);
      _c.set(Math.max(-hx, Math.min(hx, _v.x)), Math.max(-hy, Math.min(hy, _v.y)), Math.max(-hz, Math.min(hz, _v.z)));
      _v.sub(_c).normalize();
      na.setXYZ(i, _v.x, _v.y, _v.z);
      _v.multiplyScalar(r).add(_c);
      pa.setXYZ(i, _v.x, _v.y, _v.z);
    }
    return g;
  }

  // A gloved fist. The held object runs along local Y through the fist; fingers curl round its
  // front (−Z), the thumb wraps over from the left, and the wrist/forearm go back along +Z.
  function hand(parent, sleeveLen = 0.34, { thumbUp = false, armPitch = 0, armYaw = 0 } = {}) {
    const h = new THREE.Group();
    add(h, rbox(0.074, 0.088, 0.07, 0.022), M.glove, 0.002, 0, 0.016);              // palm / back of hand
    // four curled fingers: rounded rolls stacked down the grip, slightly staggered
    for (let i = 0; i < 4; i++) {
      add(h, cap(0.0118, 0.05, 8), M.glove, 0.002, 0.028 - i * 0.022, -0.034 - (i === 0 || i === 3 ? 0 : 0.004), 0, 0, Math.PI / 2 + (i - 1.5) * 0.06);
    }
    add(h, rbox(0.07, 0.02, 0.028, 0.009), M.glove, 0.004, 0.044, -0.008);           // knuckle ridge
    // thumb: base pad on the left, tip wrapping across the front (or laid along the side)
    const th = new THREE.Group();
    th.position.set(-0.038, 0.03, -0.004);
    th.rotation.set(thumbUp ? -1.2 : 0, thumbUp ? 0 : 0.5, thumbUp ? 0.1 : 1.25);
    add(th, cap(0.0135, 0.034, 8), M.glove, 0, 0.022, 0);
    add(th, cap(0.0115, 0.022, 8), M.glove, 0.004, 0.052, -0.004, 0.25, 0, -0.35);
    h.add(th);
    add(h, rbox(0.03, 0.05, 0.05, 0.014), M.glove, -0.03, 0.006, 0.02);              // thenar pad
    // gauntlet cuff, a seam ring, then the jacket sleeve; the forearm bends at the wrist
    const arm = new THREE.Group();
    arm.position.set(0.002, -0.006, 0.045);
    arm.rotation.set(armPitch, armYaw, 0);
    add(arm, cyl(0.04, 0.047, 0.06, 14), M.cuff, 0, 0, 0.03, Math.PI / 2, 0, 0);
    add(arm, new THREE.TorusGeometry(0.047, 0.0045, 5, 16), M.cuff, 0, 0, 0.06);
    add(arm, cyl(0.054, 0.062, sleeveLen, 14), M.sleeve, 0, -0.004, 0.062 + sleeveLen / 2, Math.PI / 2, 0, 0);
    add(arm, new THREE.TorusGeometry(0.054, 0.006, 5, 16), M.sleeve, 0, -0.004, 0.064);   // hem
    h.add(arm);
    parent.add(h);
    return h;
  }

  // ---- crowbar ----
  // A narrow (2 cm) hex bar, blued steel like the pistol. At the top it bends 35° over into a
  // short flattened neck that ends in a split claw (two tines and a nail slot) — a thin bent
  // line in the lower right, not a paddle. Built along +Y in the bar frame (fist at y=0).
  const crowbar = new THREE.Group();
  {
    const bar = new THREE.Group();
    const R = 0.01, TOP = 0.2, BEND = 0.61;                 // bar radius, straight length above fist, bend (rad ≈ 35°)
    add(bar, cyl(R, R, TOP + 0.3, 6), M.bar, 0, (TOP - 0.3) / 2, 0);                  // straight hex bar
    add(bar, box(0.001, 0.11, 0.003), M.edge, R * 0.9, 0.06, 0);                      // worn arris near the bend
    add(bar, cyl(R * 1.06, R * 1.06, 0.03, 6), M.rust, 0, 0.12, 0, 0, 0.3, 0);       // rust bloom
    // the bend: a short knuckle, then the neck leaning over toward −X
    const neck = new THREE.Group();
    neck.position.set(0, TOP, 0);
    neck.rotation.z = BEND;
    add(neck, new THREE.SphereGeometry(R, 8, 6), M.bar, 0, 0, 0);
    const n1 = add(neck, cyl(R * 0.8, R, 0.055, 6), M.bar, 0, 0.0275, 0);          // tapering, flattening neck
    n1.scale.set(1.15, 1, 0.7);
    add(neck, box(0.0014, 0.05, 0.003), M.edge, R * 0.9, 0.026, 0);
    // split tip: two flat tines either side of a nail slot, each with a bright bevel
    for (const sd of [-1, 1]) {
      add(neck, box(0.0075, 0.028, 0.006), M.bar, sd * 0.0058, 0.067, 0, 0, 0, -sd * 0.1);
      add(neck, box(0.001, 0.02, 0.0065), M.edge, sd * 0.0092, 0.066, 0, 0, 0, -sd * 0.1);
    }
    bar.add(neck);
    const bend = new THREE.Object3D();
    bend.position.set(0, TOP, 0);
    bar.add(bend);
    crowbar.userData.bend = bend;
    const tip = new THREE.Object3D();
    tip.position.set(0, 0.08, 0);
    neck.add(tip);
    // cloth tape grip, wound in slightly offset turns
    for (let i = 0; i < 5; i++) add(bar, cyl(R * 1.5, R * 1.5, 0.024, 8), M.tape, 0, -0.05 + i * 0.022, 0, 0.05 * (i % 2 ? 1 : -1), i, 0);
    bar.rotation.y = -0.7;              // the bend shows in profile: the claw leans in to the left
    crowbar.add(bar);
    const h = hand(crowbar, 0.3, { armPitch: 0.35 });
    h.rotation.set(0.25, 0.2, -0.55);   // fist round the tape, forearm back and down-right
    crowbar.userData.bar = bar;
    crowbar.userData.tip = tip;
  }
  crowbar.position.set(0.255, -0.252, -0.42);
  crowbar.rotation.set(0.1, 0.15, 0.78);

  // ---- pistol (CZ-75-ish): barrel along −Z ----
  const pistol = new THREE.Group();
  const slide = new THREE.Group();
  {
    const frame = new THREE.Group();
    add(frame, rbox(0.028, 0.024, 0.165, 0.004), M.blued, 0, -0.005, -0.005);           // dust cover / frame
    add(frame, rbox(0.03, 0.118, 0.048, 0.008), M.blued, 0, -0.075, 0.056, -0.28, 0, 0); // grip frame
    for (const s of [-1, 1]) add(frame, rbox(0.004, 0.095, 0.038, 0.0015), M.grip, s * 0.0155, -0.072, 0.054, -0.28, 0, 0); // checkered panels
    add(frame, rbox(0.032, 0.022, 0.03, 0.005), M.blued, 0, 0.0, 0.085, -0.3, 0, 0);      // beavertail
    add(frame, new THREE.TorusGeometry(0.022, 0.0045, 6, 12, Math.PI), M.blued, 0, -0.03, -0.0, 0, Math.PI / 2, Math.PI); // trigger guard
    add(frame, box(0.006, 0.022, 0.008), M.steel, 0, -0.03, 0.003, 0.3, 0, 0);           // trigger
    add(frame, rbox(0.03, 0.02, 0.036, 0.005), M.blued, 0, -0.14, 0.075, -0.28, 0, 0);    // magazine base
    pistol.add(frame);
    // slide: chamfered top edges, extruded along Z
    const sh = new THREE.Shape();
    sh.moveTo(-0.014, 0); sh.lineTo(0.014, 0); sh.lineTo(0.014, 0.021); sh.lineTo(0.0085, 0.03);
    sh.lineTo(-0.0085, 0.03); sh.lineTo(-0.014, 0.021); sh.closePath();
    const sg = new THREE.ExtrudeGeometry(sh, { depth: 0.186, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0012, bevelSegments: 1, steps: 1 });
    sg.translate(0, 0.007, -0.103);
    add(slide, sg, M.slide, 0, 0, 0);
    // bevel highlights along both chamfers
    for (const s of [-1, 1]) add(slide, box(0.0009, 0.0009, 0.17), M.edge, s * 0.0116, 0.0328, -0.012, 0, 0, s * 0.98);
    for (let i = 0; i < 7; i++) add(slide, box(0.031, 0.02, 0.0025), M.blued, 0, 0.02, 0.052 + i * 0.0045); // serrations
    add(slide, cyl(0.0085, 0.0085, 0.012, 10), M.blued, 0, 0.02, -0.105, Math.PI / 2, 0, 0); // muzzle
    add(slide, cyl(0.0045, 0.0045, 0.013, 8), M.tape, 0, 0.02, -0.1055, Math.PI / 2, 0, 0);  // bore
    add(slide, box(0.004, 0.008, 0.008), M.blued, 0, 0.04, -0.095);                    // front sight
    add(slide, box(0.0018, 0.0018, 0.002), M.edge, 0, 0.0445, -0.0985);                // sight dot
    add(slide, box(0.02, 0.008, 0.008), M.blued, 0, 0.04, 0.075);                      // rear sight
    add(slide, box(0.01, 0.018, 0.012), M.blued, 0, 0.03, 0.09, -0.4, 0, 0);           // hammer
    pistol.add(slide);
    const h = hand(pistol, 0.32, { thumbUp: true, armPitch: 0.75, armYaw: -0.15 });
    h.position.set(0.002, -0.07, 0.065);
    h.rotation.set(-0.28, 0, 0);
    // support hand (left), wrapped round the front of the grip
    const h2 = hand(pistol, 0.32, { armPitch: 0.8, armYaw: 0.35 });
    h2.position.set(-0.035, -0.088, 0.038);
    h2.rotation.set(-0.2, -0.7, 0.25);
  }
  pistol.position.set(0.11, -0.15, -0.4);
  pistol.rotation.set(0.03, 0.26, -0.1);   // a quarter-turn of the left flank shows: reads as steel, not a box

  // ---- muzzle flash: a short ragged flame cone (three crossed planes along the bore) plus a
  // small irregular burst facing the camera. One shared material: player.js drives its opacity.
  const flameTex = canvasTex(64, 128, (g, w, h) => {
    // tongue: wide hot base at the bottom (muzzle), ragged taper to the top
    const pts = [];
    const N = 14;
    for (let i = 0; i <= N; i++) {
      const v = i / N, half = (1 - v) ** 0.7 * (0.42 + rnd() * 0.12) * w;
      pts.push([w / 2 + half * (0.85 + rnd() * 0.3), h * (1 - v * (0.86 + rnd() * 0.1))]);
    }
    for (let i = N; i >= 0; i--) {
      const v = i / N, half = (1 - v) ** 0.7 * (0.42 + rnd() * 0.12) * w;
      pts.push([w / 2 - half * (0.85 + rnd() * 0.3), h * (1 - v * (0.86 + rnd() * 0.1))]);
    }
    const grad = g.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, 'rgba(255,248,215,1)');
    grad.addColorStop(0.3, 'rgba(255,196,96,0.95)');
    grad.addColorStop(0.75, 'rgba(240,110,30,0.55)');
    grad.addColorStop(1, 'rgba(160,50,10,0)');
    g.fillStyle = grad;
    g.filter = 'blur(2px)';
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
  });
  const burstTex = canvasTex(64, 64, (g, w) => {
    g.filter = 'blur(1.5px)';
    const N = 9, pts = [];
    for (let i = 0; i < N * 2; i++) {
      const a = (i / (N * 2)) * Math.PI * 2 + rnd() * 0.2, r = (i % 2 ? 0.16 + rnd() * 0.08 : 0.3 + rnd() * 0.16) * w;
      pts.push([w / 2 + Math.cos(a) * r, w / 2 + Math.sin(a) * r]);
    }
    const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w * 0.45);
    grad.addColorStop(0, 'rgba(255,250,225,1)');
    grad.addColorStop(0.4, 'rgba(255,190,90,0.8)');
    grad.addColorStop(1, 'rgba(230,90,20,0)');
    g.fillStyle = grad;
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
  });
  const fmat = (map) => new THREE.MeshBasicMaterial({
    map, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
    transparent: true, side: THREE.DoubleSide, opacity: 0,
  });
  const flashMat = fmat(burstTex), flameMat = fmat(flameTex);
  flameMat.color.setScalar(0.55);       // three planes overlap additively: keep the cone orange, not white
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.042, 0.042), flashMat);
  flash.position.set(0, 0.02, -0.112);
  flash.renderOrder = ORDER + 10;
  flash.frustumCulled = false;
  flash.visible = true;                 // always drawn (compiled at boot); player.js drives opacity
  const cone = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const pg = new THREE.PlaneGeometry(0.042, 0.15);
    pg.translate(0, 0.075, 0);           // base at the muzzle
    pg.rotateX(-Math.PI / 2);           // length along −Z
    const m = add(cone, pg, flameMat, 0, 0, 0, 0, 0, (i * Math.PI) / 3 + 0.3);
    m.renderOrder = ORDER + 9;
  }
  flash.add(cone);
  slide.add(flash);

  // ---- smoke puff: a world-space sprite (player.js parents it to the scene and drifts it) ----
  const smokeTex = canvasTex(64, 64, (g, w) => {
    for (let i = 0; i < 7; i++) {
      const x = w / 2 + (rnd() - 0.5) * w * 0.35, y = w / 2 + (rnd() - 0.5) * w * 0.35, r = w * (0.16 + rnd() * 0.14);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(190,186,180,0.55)');
      gr.addColorStop(1, 'rgba(190,186,180,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    }
  });
  const smoke = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0, fog: true }));
  smoke.scale.setScalar(0.15);
  smoke.frustumCulled = false;
  smoke.renderOrder = 5;

  // Depth clear: an invisible mesh drawn just before the viewmodels.
  const clearMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, transparent: true });
  const clearer = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001), clearMat);
  clearer.position.set(0, 0, -0.5);
  clearer.renderOrder = ORDER - 1;
  clearer.frustumCulled = false;
  clearer.onBeforeRender = (renderer) => renderer.clearDepth();

  return { crowbar, pistol, slide, flash, flame: cone, flameMat, smoke, clearer, warm, warmth };
}
