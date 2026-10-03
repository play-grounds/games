// First-person controller: look, move, stamina, flashlight, crowbar + pistol, interact, damage.
// See CONTRACT.md (player.js). Never throws from update().
import { buildViewmodels } from './player/viewmodel.js';

const WALK = 3.2, SPRINT = 6, CROUCH = 1.6;
const EYE = 1.65, EYE_CROUCH = 1.1, RADIUS = 0.35;
const MAG = 12;
// flashlight: candela, range m, half-angle rad, penumbra, aim point (m ahead, m below)
const FL = { intensity: 150, dist: 40, angle: 0.45, penumbra: 0.4, aim: 10, drop: 2 };

export function create(game) {
  const { THREE, camera, layout, params } = game;
  const AUTO = params.has('auto');
  const GOD = params.has('god');

  const p = {
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
    health: 100, stamina: 1, exhausted: false, noise: 0,
    weapon: 'crowbar', ammo: MAG, reserve: 24, alive: true, flashlight: false, locked: false,
    crouching: false, sprinting: false, reloading: false, prompt: null,
    input: { forward: 0, right: 0, sprint: false, crouch: false, fire: false, use: false },
  };

  // ---- start position ----
  {
    const at = params.get('at')?.split(',').map(Number);
    if (at && at.length >= 2 && at.every(Number.isFinite)) { p.pos.set(at[0], 0, at[1]); p.yaw = at[2] ?? 0; }
    else { p.pos.set(layout.START.x, 0, layout.START.z); p.yaw = layout.START.yaw; }
    p.pos.y = layout.heightAt(p.pos.x, p.pos.z);
  }

  // ---- lights ----
  // Survival torch: a hand-held beam just right of and below the eye, pitched down so the
  // brightest part of the pool lands ~5 m ahead on the cobbles; the upper half of the cone
  // still reaches walls and the dead out to ~20 m.
  const spot = new THREE.SpotLight(0xffe2b8, 0, FL.dist, FL.angle, FL.penumbra, 2);
  spot.position.set(0.14, -0.12, 0.05);
  spot.target.position.set(0.14, -0.12 - FL.drop, -FL.aim);
  camera.add(spot, spot.target);
  const fill = new THREE.PointLight(0xffdcb0, 0, 6, 2);
  fill.position.set(0, 0.1, 0.5);
  camera.add(fill);
  const muzzle = new THREE.PointLight(0xffb060, 0, 14, 2);
  muzzle.position.set(0.17, -0.12, -0.6);
  camera.add(muzzle);
  const SPOT_I = FL.intensity, FILL_I = 0.35;
  let flI = 0, prevInside = false;
  const _fo = new THREE.Vector3(), _fd = new THREE.Vector3();
  let flashlightTouched = false;
  const nightNow = () => { const h = game.time?.hour ?? 18; return h >= 19 || h < 6; };
  p.flashlight = nightNow();

  // ---- viewmodels ----
  const vm = buildViewmodels(THREE, game);
  const vmRoot = new THREE.Group();
  camera.add(vmRoot);
  vmRoot.add(vm.clearer, vm.crowbar, vm.pistol);
  const crowRest = { p: vm.crowbar.position.clone(), r: vm.crowbar.rotation.clone() };
  const pistRest = { p: vm.pistol.position.clone(), r: vm.pistol.rotation.clone() };

  // ---- input ----
  const keys = new Set();
  let lmb = false, clickQueued = false, useQueued = false;
  if (!AUTO) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      keys.add(e.code);
      switch (e.code) {
        case 'KeyF': toggleFlashlight(); break;
        case 'Digit1': select('crowbar'); break;
        case 'Digit2': select('pistol'); break;
        case 'KeyR': reload(); break;
        case 'KeyE': useQueued = true; break;
        case 'KeyC': p.crouchToggle = !p.crouchToggle; break;
      }
    });
    addEventListener('keyup', (e) => keys.delete(e.code));
    addEventListener('blur', () => keys.clear());
    const canvas = game.renderer.domElement;
    addEventListener('click', () => {
      if (!p.locked && p.alive && game.state?.phase !== 'dead' && game.state?.phase !== 'won') {
        try { const r = canvas.requestPointerLock?.(); r?.catch?.(() => {}); } catch { /* ignore */ }
      }
    });
    document.addEventListener('pointerlockchange', () => { p.locked = document.pointerLockElement === canvas; if (!p.locked) lmb = false; });
    addEventListener('mousemove', (e) => {
      if (!p.locked || !p.alive) return;
      p.yaw -= e.movementX * 0.0022;
      p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch - e.movementY * 0.0022));
    });
    addEventListener('mousedown', (e) => { if (e.button === 0 && p.locked) { lmb = true; clickQueued = true; } });
    addEventListener('mouseup', (e) => { if (e.button === 0) lmb = false; });
  }

  // ---- actions ----
  let swingT = -1, swingHit = false, cooldown = 0, recoil = 0, slideBack = 0, reloadT = -1, switchT = 0, flashT = 0;
  function toggleFlashlight(on) { flashlightTouched = true; p.flashlight = on ?? !p.flashlight; }
  function select(w) {
    if (!p.alive || w === p.weapon || (w !== 'crowbar' && w !== 'pistol')) return;
    p.weapon = w; switchT = 0.35; reloadT = -1; p.reloading = false; swingT = -1;
  }
  function reload() {
    if (!p.alive || p.weapon !== 'pistol' || p.reloading || p.ammo >= MAG || p.reserve <= 0) return;
    p.reloading = true; reloadT = 0; game.audio?.reload?.();
  }

  const _o = new THREE.Vector3(), _d = new THREE.Vector3();
  function aim(spread = 0) {
    camera.getWorldPosition(_o);
    camera.getWorldDirection(_d);
    if (spread) { _d.x += (Math.random() - 0.5) * spread; _d.y += (Math.random() - 0.5) * spread; _d.z += (Math.random() - 0.5) * spread; _d.normalize(); }
  }
  function attack() {
    if (!p.alive || switchT > 0 || cooldown > 0) return;
    if (p.weapon === 'crowbar') {
      swingT = 0; swingHit = false; cooldown = 0.6; game.audio?.swing?.();
    } else {
      if (p.reloading) return;
      if (p.ammo <= 0) { game.audio?.dryFire?.(); cooldown = 0.25; if (p.reserve > 0) reload(); return; }
      p.ammo--; cooldown = 0.16; recoil = 1; slideBack = 1; flashT = 0.05;
      game.audio?.gunshot?.();
      game.atmos?.flash?.(1);
      game.emit('noise', { x: p.pos.x, z: p.pos.z, radius: 90 });
      noiseKick = 1;
      aim(0.012);
      const wall = game.collide.raycast(_o, _d, 120);
      const hit = game.dead?.raycast?.(_o, _d, 120);
      if (hit && hit.dist < wall) { game.dead.damage?.(hit.id, 60, _d.clone()); game.audio?.hitFlesh?.(); p.lastHit = { id: hit.id, dist: hit.dist }; }
      else p.lastHit = { wall: wall };
      kickPitch += 0.035; kickYaw += (Math.random() - 0.5) * 0.01;
    }
  }
  function meleeResolve() {
    aim();
    const hit = game.dead?.meleeHit?.(_o, _d, 1.8, 50);
    if (hit) { game.audio?.hitFlesh?.(); kickPitch -= 0.015; }
    game.emit('noise', { x: p.pos.x, z: p.pos.z, radius: hit ? 10 : 4 });
    p.lastHit = { melee: !!hit };
  }

  function interact() {
    const c = candidate();
    if (c) { try { c.use(); } catch (e) { console.error(e); } }
  }
  function candidate() {
    let best = null, bd = Infinity;
    for (const it of game.interactables || []) {
      if (!it?.pos) continue;
      let en = true;
      try { en = it.enabled?.() !== false; } catch { en = false; }
      if (!en) continue;
      const d = Math.hypot(it.pos.x - p.pos.x, it.pos.z - p.pos.z);
      if (d <= (it.radius ?? 2) && Math.abs(it.pos.y - (p.pos.y + 1)) < 3 && d < bd) { bd = d; best = it; }
    }
    return best;
  }

  // ---- damage / death ----
  let kickPitch = 0, kickRoll = 0, kickYaw = 0, deathT = -1, hurtShake = 0, noiseKick = 0;
  function damage(n, from) {
    if (!p.alive || GOD) return;
    p.health = Math.max(0, p.health - n);
    game.audio?.hurt?.();
    hurtShake = 1;
    if (from && Number.isFinite(from.x)) {
      // which side relative to view: right = (cos yaw, −sin yaw)
      const dx = from.x - p.pos.x, dz = from.z - p.pos.z;
      const side = dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw);
      const front = -dx * Math.sin(p.yaw) - dz * Math.cos(p.yaw);
      kickRoll += -Math.sign(side) * 0.12;
      kickYaw += Math.sign(side) * 0.06;
      kickPitch += front > 0 ? 0.08 : -0.05;
    } else kickPitch += 0.06;
    if (p.health <= 0) {
      p.alive = false; deathT = 0;
      if (document.pointerLockElement) try { document.exitPointerLock(); } catch { /* ignore */ }
      game.emit('playerDied', {});
    }
  }

  function teleport(x, z, yaw) {
    p.pos.set(x, layout.heightAt(x, z), z);
    if (yaw !== undefined) p.yaw = yaw;
    p.vel.set(0, 0, 0);
    eyeY = lastGround = p.pos.y;
  }

  // ---- movement state ----
  let lastGround = p.pos.y, eyeY = p.pos.y, eyeH = EYE, bobPhase = 0, bobAmp = 0, stepDist = 0, lastStepSide = 0;
  const prev = new THREE.Vector3();
  let prevUse = false, prevFire = false;

  function surface() {
    if (p.pos.x > 1000) return 'tiles';
    if (p.pos.x > layout.RIVER.x0 - 8 && p.pos.x < layout.RIVER.x1 + 8 && Math.abs(p.pos.z - layout.BRIDGE.z) < layout.BRIDGE.width) return 'stone';
    return 'cobble';
  }

  function update(dt) {
    try { tick(Math.min(dt, 0.1)); } catch (e) { if (!p._warned) { p._warned = true; console.error('[player]', e); } }
  }

  function tick(dt) {
    const inp = p.input;
    // gather input
    let fwd, right, sprintKey, crouchKey, fireNow, useNow;
    if (AUTO) {
      fwd = +inp.forward || 0; right = +inp.right || 0; sprintKey = !!inp.sprint; crouchKey = !!inp.crouch;
      fireNow = !!inp.fire && !prevFire; prevFire = !!inp.fire;
      useNow = !!inp.use && !prevUse; prevUse = !!inp.use;
    } else {
      const playing = !game.state || game.state.phase === 'play';
      fwd = playing ? (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) : 0;
      right = playing ? (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) : 0;
      sprintKey = keys.has('ShiftLeft') || keys.has('ShiftRight');
      crouchKey = !!p.crouchToggle || keys.has('ControlLeft');
      fireNow = clickQueued; clickQueued = false;
      useNow = useQueued; useQueued = false;
      // mirror into input for anyone reading it
      Object.assign(inp, { forward: fwd, right, sprint: sprintKey, crouch: crouchKey, fire: lmb });
    }
    if (!p.alive) { fwd = right = 0; sprintKey = crouchKey = fireNow = useNow = false; }

    // flashlight follows the clock until the player touches F
    // interiors are dark: entering one in the evening switches the torch on
    const inside = p.pos.x > 1000, dusk = (game.time?.hour ?? 18) >= 17;
    if (!flashlightTouched) p.flashlight = nightNow() || (inside && dusk);
    else if (inside && !prevInside && dusk) p.flashlight = true;
    prevInside = inside;
    // near-wall clamp: a wall at arm's length would blow out white
    let near = 1;
    if (p.flashlight) {
      camera.getWorldPosition(_fo); camera.getWorldDirection(_fd);
      const wd = game.collide.raycast(_fo, _fd, 3);
      if (wd < 2.5) near = Math.max(0.12, (wd / 2.5) ** 2);
    }
    flI += ((p.flashlight ? SPOT_I * near : 0) - flI) * (1 - Math.exp(-12 * dt));
    if (!dt) flI = p.flashlight ? SPOT_I * near : 0;
    spot.intensity = flI * (0.97 + Math.random() * 0.03);
    fill.intensity = p.flashlight ? FILL_I : 0;

    // ---- movement ----
    let len = Math.hypot(fwd, right);
    if (len > 1) { fwd /= len; right /= len; len = 1; }
    p.crouching = crouchKey;
    const wantSprint = sprintKey && fwd > 0.2 && !p.crouching && !p.exhausted;
    p.sprinting = wantSprint && len > 0;
    if (p.sprinting) p.stamina = Math.max(0, p.stamina - dt / 5.5);
    else p.stamina = Math.min(1, p.stamina + dt * (len > 0 ? 0.09 : 0.14));
    if (p.stamina < 0.1) p.exhausted = true;
    else if (p.exhausted && p.stamina > 0.35) p.exhausted = false;
    let speed = p.crouching ? CROUCH : p.sprinting ? SPRINT : WALK;
    if (p.exhausted) speed = Math.min(speed, WALK * 0.8);
    if (p.weapon === 'pistol' && p.reloading) speed *= 0.85;

    const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
    const tx = (-s * fwd + c * right) * speed, tz = (-c * fwd - s * right) * speed;
    const accel = len > 0 ? 9 : 11;
    const k = 1 - Math.exp(-accel * dt);
    p.vel.x += (tx - p.vel.x) * k;
    p.vel.z += (tz - p.vel.z) * k;

    prev.copy(p.pos);
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;
    game.collide.resolve(p.pos, RADIUS);
    if (layout.inRiver(p.pos.x, p.pos.z)) {
      // slide along the bank: try each axis separately, else stay put
      const ax = prev.x + p.vel.x * dt, az = prev.z + p.vel.z * dt;
      if (!layout.inRiver(ax, prev.z)) { p.pos.x = ax; p.pos.z = prev.z; p.vel.z = 0; }
      else if (!layout.inRiver(prev.x, az)) { p.pos.x = prev.x; p.pos.z = az; p.vel.x = 0; }
      else { p.pos.x = prev.x; p.pos.z = prev.z; p.vel.set(0, 0, 0); }
      game.collide.resolve(p.pos, RADIUS);
      if (layout.inRiver(p.pos.x, p.pos.z)) { p.pos.x = prev.x; p.pos.z = prev.z; }
    }
    const moved = Math.hypot(p.pos.x - prev.x, p.pos.z - prev.z);
    p.vel.x = dt > 0 ? (p.pos.x - prev.x) / dt : 0; // walls kill velocity
    p.vel.z = dt > 0 ? (p.pos.z - prev.z) / dt : 0;

    // height: feet snap to ground, eye smooths
    const ground = layout.heightAt(p.pos.x, p.pos.z);
    const drop = eyeY - ground;
    p.pos.y = ground;
    eyeY += (ground - eyeY) * (1 - Math.exp(-(drop > 0 ? 10 : 14) * dt));
    if (Math.abs(eyeY - ground) > 2) eyeY = ground + Math.sign(eyeY - ground) * 2;
    const targetEye = !p.alive ? 0.25 : p.crouching ? EYE_CROUCH : EYE;
    eyeH += (targetEye - eyeH) * (1 - Math.exp(-(p.alive ? 9 : 3) * dt));

    // ---- footsteps / bob ----
    const hspeed = moved / Math.max(dt, 1e-6);
    const stride = p.crouching ? 0.6 : p.sprinting ? 1.05 : 0.8;
    bobAmp += ((hspeed > 0.3 ? Math.min(1, hspeed / WALK) : 0) - bobAmp) * (1 - Math.exp(-8 * dt));
    if (hspeed > 0.3) {
      stepDist += moved;
      bobPhase += (moved / stride) * Math.PI;
      if (stepDist >= stride) {
        stepDist -= stride;
        lastStepSide ^= 1;
        const loud = p.crouching ? 0.2 : p.sprinting ? 1 : 0.5;
        const radius = p.crouching ? 3 : p.sprinting ? 20 : 8;
        game.audio?.footstep?.(surface(), loud);
        game.emit('noise', { x: p.pos.x, z: p.pos.z, radius });
      }
    } else stepDist = Math.min(stepDist, stride * 0.5);
    if (lastGround - ground > 0.6 && p.alive) { game.audio?.footstep?.(surface(), 0.8); kickPitch -= 0.03; } // landing thump

    lastGround = ground;
    const targetNoise = !p.alive ? 0 : hspeed < 0.3 ? 0 : p.crouching ? 0.12 : p.sprinting ? 0.85 : 0.35;
    noiseKick = Math.max(0, noiseKick - dt * 1.5);
    p.noise += (Math.max(targetNoise, noiseKick) - p.noise) * (1 - Math.exp(-4 * dt));

    // ---- weapons ----
    cooldown = Math.max(0, cooldown - dt);
    switchT = Math.max(0, switchT - dt);
    if (fireNow) attack();
    if (useNow) interact();
    if (swingT >= 0) {
      swingT += dt;
      if (!swingHit && swingT >= 0.2) { swingHit = true; meleeResolve(); }
      if (swingT >= 0.6) swingT = -1;
    }
    if (p.reloading) {
      reloadT += dt;
      if (reloadT >= 1.6) {
        const n = Math.min(MAG - p.ammo, p.reserve);
        p.ammo += n; p.reserve -= n; p.reloading = false; reloadT = -1;
      }
    }
    recoil = Math.max(0, recoil - dt * 7);
    slideBack = Math.max(0, slideBack - dt * 14);
    flashT -= dt;
    vm.flash.visible = flashT > 0;
    if (flashT > 0) vm.flash.material.rotation = Math.random() * 6.28;
    muzzle.intensity = flashT > 0 ? 12 : 0;

    p.prompt = p.alive ? candidate()?.label ?? null : null;

    // ---- camera ----
    kickPitch *= Math.exp(-7 * dt); kickRoll *= Math.exp(-5 * dt); kickYaw *= Math.exp(-6 * dt);
    hurtShake = Math.max(0, hurtShake - dt * 3);
    const bobY = Math.sin(bobPhase * 2) * 0.035 * bobAmp * (p.sprinting ? 1.6 : 1);
    const bobX = Math.sin(bobPhase) * 0.025 * bobAmp;
    const t = game.time?.t ?? 0;
    const breathe = Math.sin(t * 1.3) * 0.004 * (p.exhausted ? 3 : 1);
    let roll = kickRoll + Math.sin(bobPhase) * 0.006 * bobAmp;
    let camY = eyeY + eyeH + bobY + breathe;
    if (!p.alive) {
      deathT += dt;
      const f = Math.min(1, deathT / 1.1);
      roll += f * f * 1.25;
      camY = eyeY + eyeH;
    }
    const sx = Math.cos(p.yaw), sz = -Math.sin(p.yaw);
    camera.position.set(p.pos.x + sx * bobX, camY, p.pos.z + sz * bobX);
    const shake = hurtShake * 0.02;
    camera.rotation.set(
      p.pitch + kickPitch + (Math.random() - 0.5) * shake + (p.alive ? 0 : -Math.min(1, deathT) * 0.4),
      p.yaw + kickYaw + (Math.random() - 0.5) * shake,
      roll,
    );

    // ---- viewmodel animation ----
    vmRoot.visible = p.alive;
    const swayX = Math.sin(bobPhase) * 0.012 * bobAmp, swayY = Math.abs(Math.cos(bobPhase)) * 0.012 * bobAmp;
    const lower = switchT > 0 ? switchT / 0.35 : 0;
    vmRoot.position.set(swayX, -swayY - lower * 0.35 + breathe, 0);
    vmRoot.rotation.set(0, 0, 0);
    vm.crowbar.visible = p.weapon === 'crowbar';
    vm.pistol.visible = p.weapon === 'pistol';
    if (p.weapon === 'crowbar') {
      vm.crowbar.position.copy(crowRest.p);
      vm.crowbar.rotation.copy(crowRest.r);
      if (swingT >= 0) {
        const u = swingT / 0.6;
        // windup (0–0.15), slash diagonally to the lower left (0.15–0.4), recover
        const wind = u < 0.15 ? u / 0.15 : 1;
        const slash = u < 0.15 ? 0 : u < 0.4 ? (u - 0.15) / 0.25 : 1;
        const rec = u < 0.4 ? 0 : (u - 0.4) / 0.6;
        const e = (x) => x * x * (3 - 2 * x);
        const a = e(wind) * (1 - e(rec)), b = e(slash) * (1 - e(rec));
        // diagonal chop: cock up and right, then drive down-left across the screen
        vm.crowbar.position.x += a * 0.1 - b * 0.46;
        vm.crowbar.position.y += a * 0.12 - b * 0.2;
        vm.crowbar.position.z += a * 0.04 - b * 0.12;
        vm.crowbar.rotation.z += -a * 0.35 + b * 0.55;
        vm.crowbar.rotation.x += a * 0.35 - b * 1.1;
        vm.crowbar.rotation.y += b * 0.35;
      }
    } else {
      vm.pistol.position.copy(pistRest.p);
      vm.pistol.rotation.copy(pistRest.r);
      vm.pistol.position.z += recoil * 0.06;
      vm.pistol.rotation.x += recoil * 0.14;
      vm.slide.position.z = slideBack * 0.035;
      if (p.reloading) {
        const u = reloadT / 1.6;
        const dip = Math.sin(Math.min(1, u) * Math.PI);
        vm.pistol.position.y -= dip * 0.12;
        vm.pistol.rotation.z += dip * 0.7;
        vm.pistol.rotation.x += dip * 0.3;
        if (u > 0.75) vm.slide.position.z = Math.sin((u - 0.75) / 0.25 * Math.PI) * 0.035; // rack
      }
    }
  }

  Object.assign(p, {
    update, teleport, damage, select, reload, toggleFlashlight, attack, interact,
    spot, fill, viewmodel: vm,
  });
  // place the camera right away so the first render is correct
  tick(0);
  return p;
}
