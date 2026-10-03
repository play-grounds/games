// Procedural first-person viewmodels: gloved hand + crowbar, gloved hand + CZ-75-like pistol.
// All meshes are camera children, drawn last (renderOrder) after a depth clear so they never
// clip into walls. Materials skip fog.

export function buildViewmodels(THREE, game) {
  const mat = (o) => {
    const m = new THREE.MeshStandardMaterial({ fog: false, ...o });
    m.metalness = Math.min(m.metalness, 0.35);                 // matte-ish: no env map to reflect
    m.emissive.copy(m.color).multiplyScalar(0.1);              // never fully black in the dark
    m.transparent = true;          // forces the late (transparent) list so the depth clear works
    m.opacity = 1;
    m.depthWrite = true;
    // The flashlight and fill light sit centimetres from the viewmodel; clamp direct light so
    // inverse-square doesn't blow it out to white.
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>',
        'reflectedLight.directDiffuse = min(reflectedLight.directDiffuse, material.diffuseColor * 0.7);\n' +
        'reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(0.02) + material.diffuseColor * 0.6);\n#include <aomap_fragment>');
    };
    m.customProgramCacheKey = () => 'vm-clamp';
    return m;
  };
  const rustTex = game.tex?.rust?.isTexture ? game.tex.rust : null;
  const M = {
    steel: mat({ color: 0x55595e, metalness: 0.75, roughness: 0.45 }),
    darkSteel: mat({ color: 0x2a2c30, metalness: 0.7, roughness: 0.5 }),
    rust: mat({ color: rustTex ? 0x6a4a38 : 0x3e2a20, map: rustTex, metalness: 0.4, roughness: 0.85 }),
    bar: mat({ color: 0x2b2c2f, metalness: 0.6, roughness: 0.55 }),          // forged dark steel
    tape: mat({ color: 0x18191b, metalness: 0.0, roughness: 1.0 }),          // black cloth tape
    grip: mat({ color: 0x241a14, metalness: 0.05, roughness: 0.9 }),
    glove: mat({ color: 0x1e1c19, metalness: 0.0, roughness: 0.95 }),
    sleeve: mat({ color: 0x2c3128, metalness: 0.0, roughness: 1.0 }),        // olive canvas jacket
    skin: mat({ color: 0x5a4034, metalness: 0.0, roughness: 0.8 }),
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

  // A gloved fist gripping something along local Z, with a forearm going back/down.
  function hand(parent, sleeveLen = 0.34) {
    const h = new THREE.Group();
    add(h, box(0.085, 0.09, 0.1), M.glove, 0, 0, 0);                          // palm/fist
    for (let i = 0; i < 4; i++) add(h, box(0.02, 0.03, 0.05), M.glove, 0.032 - i * 0.021, 0.035, -0.045, 0.3, 0, 0); // knuckles
    add(h, box(0.03, 0.03, 0.06), M.glove, -0.05, 0.03, -0.02, 0, 0.5, 0);     // thumb
    add(h, cyl(0.04, 0.045, 0.08, 8), M.skin, 0, -0.02, 0.08, Math.PI / 2, 0, 0); // wrist gap
    add(h, cyl(0.055, 0.06, sleeveLen, 8), M.sleeve, 0, -0.03, 0.1 + sleeveLen / 2, Math.PI / 2, 0, 0);
    parent.add(h);
    return h;
  }

  // ---- crowbar ----
  // Dark forged steel, hex bar, gooseneck with a split claw. Built along +Y in the bar frame
  // (grip at y=0, claw at the top, chisel end below), then the whole thing is laid ~45°
  // across the lower right so the claw sits up and toward the screen centre.
  const crowbar = new THREE.Group();
  {
    const bar = new THREE.Group();
    const R = 0.012, TOP = 0.36, HR = 0.036;                 // bar radius, straight length, hook radius
    add(bar, cyl(R, R, TOP + 0.34, 6), M.bar, 0, (TOP - 0.34) / 2, 0);   // straight hex bar, -0.34..TOP
    add(bar, cyl(R * 1.04, R * 1.04, 0.07, 6), M.rust, 0, 0.2, 0, 0, 0.3, 0);   // rust bloom
    add(bar, cyl(R * 1.04, R * 1.04, 0.04, 6), M.rust, 0, 0.31, 0, 0, 0.5, 0);
    // gooseneck: arc curving over toward −X, then the claw pointing back down
    add(bar, new THREE.TorusGeometry(HR, R, 6, 12, Math.PI * 0.95), M.bar, -HR, TOP, 0);
    const claw = new THREE.Group();
    claw.position.set(-2 * HR + 0.003, TOP - 0.006, 0);
    claw.rotation.z = 0.12;
    add(claw, box(0.026, 0.05, 0.016), M.bar, 0, -0.025, 0);               // flattened claw
    add(claw, box(0.012, 0.03, 0.0075), M.bar, -0.008, -0.062, 0.0045, 0, 0, 0.12);  // tine
    add(claw, box(0.012, 0.03, 0.0075), M.bar, -0.008, -0.062, -0.0045, 0, 0, 0.12); // tine
    bar.add(claw);
    // chisel end (mostly off screen)
    add(bar, box(0.026, 0.05, 0.01), M.bar, 0.004, -0.36, 0, 0, 0, 0.12);
    // cloth tape grip near the bottom, wound in slightly offset turns
    for (let i = 0; i < 5; i++) add(bar, cyl(R * 1.35, R * 1.35, 0.026, 8), M.tape, 0, -0.06 + i * 0.024, 0, 0.05 * (i % 2 ? 1 : -1), i, 0);
    crowbar.add(bar);
    const h = hand(crowbar, 0.3);
    h.position.set(0.0, -0.0, 0.0);
    h.rotation.set(0.35, 0.1, -0.75);   // fist round the tape, forearm back and down-right
    crowbar.userData.bar = bar;
  }
  crowbar.position.set(0.33, -0.3, -0.55);
  crowbar.rotation.set(-0.15, 0.1, 0.72);

  // ---- pistol (CZ-75-ish): barrel along −Z ----
  const pistol = new THREE.Group();
  const slide = new THREE.Group();
  {
    const frame = new THREE.Group();
    add(frame, box(0.03, 0.025, 0.17), M.darkSteel, 0, -0.005, -0.005);       // dust cover / frame
    add(frame, box(0.031, 0.12, 0.05), M.grip, 0, -0.075, 0.055, -0.28, 0, 0); // grip
    add(frame, box(0.033, 0.1, 0.035), M.darkSteel, 0, -0.07, 0.05, -0.28, 0, 0); // backstrap
    add(frame, new THREE.TorusGeometry(0.022, 0.0045, 5, 10, Math.PI), M.darkSteel, 0, -0.03, -0.0, 0, Math.PI / 2, Math.PI); // trigger guard
    add(frame, box(0.006, 0.022, 0.008), M.steel, 0, -0.03, 0.003, 0.3, 0, 0); // trigger
    add(frame, box(0.03, 0.022, 0.035), M.darkSteel, 0, -0.14, 0.075, -0.28, 0, 0); // magazine base
    pistol.add(frame);
    // slide (moves on recoil)
    add(slide, box(0.028, 0.03, 0.19), M.steel, 0, 0.022, -0.01);
    for (let i = 0; i < 6; i++) add(slide, box(0.03, 0.022, 0.004), M.darkSteel, 0, 0.022, 0.05 + i * 0.008); // serrations
    add(slide, cyl(0.009, 0.009, 0.012, 8), M.darkSteel, 0, 0.02, -0.108, Math.PI / 2, 0, 0); // muzzle
    add(slide, box(0.005, 0.008, 0.008), M.darkSteel, 0, 0.041, -0.095);     // front sight
    add(slide, box(0.02, 0.008, 0.008), M.darkSteel, 0, 0.041, 0.075);       // rear sight
    add(slide, box(0.01, 0.018, 0.012), M.darkSteel, 0, 0.03, 0.09, -0.4, 0, 0); // hammer
    pistol.add(slide);
    const h = hand(pistol, 0.3);
    h.position.set(0, -0.085, 0.07);
    h.rotation.set(-0.28, 0, 0);
    // support hand (left), cupping from below
    const h2 = hand(pistol, 0.3);
    h2.position.set(-0.035, -0.1, 0.06);
    h2.rotation.set(-0.2, -0.5, 0.3);
  }
  pistol.position.set(0.16, -0.222, -0.46);
  pistol.rotation.set(0, 0, 0);

  // Muzzle flash sprite + light.
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,250,220,1)');
  grad.addColorStop(0.25, 'rgba(255,200,90,0.9)');
  grad.addColorStop(0.6, 'rgba(255,120,30,0.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // a few spikes
  g.strokeStyle = 'rgba(255,220,150,0.7)';
  g.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.beginPath(); g.moveTo(32, 32); g.lineTo(32 + Math.cos(a) * 30, 32 + Math.sin(a) * 30); g.stroke();
  }
  const flashTex = new THREE.CanvasTexture(c);
  flashTex.colorSpace = THREE.SRGBColorSpace;
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, transparent: true,
  }));
  flash.scale.setScalar(0.13);
  flash.position.set(0, 0.02, -0.14);
  flash.renderOrder = ORDER + 10;
  flash.frustumCulled = false;
  flash.visible = false;
  slide.add(flash);

  // Depth clear: an invisible mesh drawn just before the viewmodels.
  const clearMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, transparent: true });
  const clearer = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001), clearMat);
  clearer.position.set(0, 0, -0.5);
  clearer.renderOrder = ORDER - 1;
  clearer.frustumCulled = false;
  clearer.onBeforeRender = (renderer) => renderer.clearDepth();

  return { crowbar, pistol, slide, flash, clearer };
}
