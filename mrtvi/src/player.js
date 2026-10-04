// First-person controller: look, move, stamina, flashlight, crowbar + pistol, interact, damage.
// See CONTRACT.md (player.js). Never throws from update().
import { buildViewmodels } from './player/viewmodel.js';

const WALK = 3.2, SPRINT = 6, CROUCH = 1.6;
const EYE = 1.65, EYE_CROUCH = 1.1, RADIUS = 0.35;
const MAG = 12;
// flashlight: candela, range m, half-angle rad, penumbra, aim point (m ahead, m below)
// The aim sits ~5° under the crosshair so a clear pool lands on the ground 4–9 m ahead.
const FL = { intensity: 300, dist: 40, angle: 0.46, penumbra: 0.45, aim: 16, drop: 1.4, back: 1.2 };
const SENS = 0.0008;           // rad per mouse count at mrtvi.sens = 1
const SENS_MIN = 0.3, SENS_MAX = 2.5;   // same range as the pause-screen slider
// One rule: at most one applied hit per HURT_GAP s, whoever's biting. Everything inside the gap
// is ignored (damage() returns false) so dead.js never reports a hit that did nothing.
const HURT_GAP = 0.9, HURT_SCALE = 0.8;
const SWING_COST = 0.12, SWING_MIN = 0.1;   // stamina per crowbar swing; below SWING_MIN no swing
const SHOVE_KB = 1.5;                        // m of knockback from a sprinting shove
const HEAL_CAP = 100, REGEN_CAP = 60, REGEN_RATE = 2, REGEN_DELAY = 8, REGEN_CLEAR = 15;

export function create(game) {
  const { THREE, camera, layout, params } = game;
  const AUTO = params.has('auto');
  const GOD = params.has('god');

  const p = {
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
    health: 100, stamina: 1, exhausted: false, noise: 0,
    weapon: 'crowbar', ammo: MAG, reserve: 24, alive: true, flashlight: false, locked: false,
    crouching: false, sprinting: false, reloading: false, prompt: null,
    input: { forward: 0, right: 0, sprint: false, crouch: false, fire: false, use: false, reload: false },
  };

  // ---- start position ----
  {
    const at = params.get('at')?.split(',').map(Number);
    if (at && at.length >= 2 && at.every(Number.isFinite)) { p.pos.set(at[0], 0, at[1]); p.yaw = at[2] ?? 0; }
    else { p.pos.set(layout.START.x, 0, layout.START.z); p.yaw = layout.START.yaw; }
    p.pos.y = layout.heightAt(p.pos.x, p.pos.z);
  }

  // ---- lights ----
  // Survival torch. The source sits on the view axis a little BEHIND the eye (FL.back) and aims
  // straight down the crosshair, so the hot spot is centred on what you aim at, and with the
  // source 1.2 m further away inverse-square can't blow a pole or a pale coat at arm's length
  // out to white (0.5 m → 1.7 m from the source; 16 m → 17.2 m, barely changed).
  const spot = new THREE.SpotLight(0xffe2b8, 0, FL.dist + FL.back, FL.angle, FL.penumbra, 2);
  spot.position.set(0, -0.03, FL.back);
  spot.target.position.set(0, -0.03 - FL.drop, -FL.aim);
  camera.add(spot, spot.target);
  const fill = new THREE.PointLight(0xffdcb0, 0, 6, 2);
  fill.position.set(0, 0.1, 0.5);
  camera.add(fill);
  const muzzle = new THREE.PointLight(0xffb060, 0, 14, 2);
  muzzle.position.set(0.17, -0.12, -0.6);
  camera.add(muzzle);
  // All three lights exist from boot and stay attached and visible forever: three.js recompiles
  // every lit material when the light count changes, so "off" means intensity 0.
  const SPOT_I = FL.intensity, FILL_I = 0.35;
  let flI = 0, prevInside = false;
  const _fo = new THREE.Vector3(), _fd = new THREE.Vector3(), _fr = new THREE.Vector3();
  const _fx = new THREE.Vector3(), _fy = new THREE.Vector3(), _fz = new THREE.Vector3();
  const FAN = [[0.22, 0], [-0.22, 0], [0, 0.18], [0, -0.22]];
  // < 1 m → at most 15 %; 1–3 m → ease back up to full
  const nearClamp = (d) => (d < 1 ? 0.06 + 0.09 * Math.max(0, d) : d < 3 ? 0.15 + 0.85 * ((d - 1) / 2) ** 2 : 1);
  let flashlightTouched = false;
  const nightNow = () => { const h = game.time?.hour ?? 18; return h >= 20 || h < 6; };
  p.flashlight = nightNow();

  // ---- viewmodels ----
  const vm = buildViewmodels(THREE, game);
  const vmRoot = new THREE.Group();
  camera.add(vmRoot);
  vmRoot.add(vm.clearer, vm.crowbar, vm.pistol);
  game.scene?.add(vm.smoke);   // world space: the puff hangs where you fired and drifts
  const crowRest = { p: vm.crowbar.position.clone(), r: vm.crowbar.rotation.clone() };
  const pistRest = { p: vm.pistol.position.clone(), r: vm.pistol.rotation.clone() };

  // ---- input ----
  const playing = () => !game.state || game.state.phase === 'play';
  // mouse sensitivity: read once at boot, then live from the pause screen's 'settings' event
  let sens = 1;
  const setSens = (v) => { v = parseFloat(v); if (Number.isFinite(v) && v > 0) sens = Math.max(SENS_MIN, Math.min(SENS_MAX, v)); };
  try { setSens(localStorage.getItem('mrtvi.sens')); } catch { /* storage blocked: default 1 */ }
  try { game.on?.('settings', (e) => { if (e && 'sens' in e) setSens(e.sens); }); } catch { /* ignore */ }
  const sensitivity = () => SENS * sens;
  const keys = new Set();
  let lmb = false, clickQueued = false, useQueued = false;
  if (!AUTO) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      keys.add(e.code);
      if (!playing()) return;
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
      if (!p.locked || !p.alive || !playing()) return;
      const k = sensitivity();
      p.yaw -= e.movementX * k;
      p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch - e.movementY * k));
    });
    addEventListener('mousedown', (e) => { if (e.button === 0 && p.locked && playing()) { lmb = true; clickQueued = true; } });
    addEventListener('mouseup', (e) => { if (e.button === 0) lmb = false; });
  }

  // ---- actions ----
  let hitStop = 0;
  let muzzleFrame = false, smokeT = -1;
  const SMOKE_LIFE = 1.6, smokeVel = new THREE.Vector3(), _sv = new THREE.Vector3();
  let swingT = -1, swingHit = false, swingRate = 1, swingDmg = 50, swingShove = false, cooldown = 0, recoil = 0, slideBack = 0, reloadT = -1, switchT = 0, flashT = 0;
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
      // every swing costs stamina; winded (< SWING_MIN) you still swing, but slow and weak.
      // A swing at a sprint is a shove: no damage, knocks them back so a runner can break through.
      const weak = p.stamina < SWING_MIN;
      swingShove = p.sprinting && !weak;
      swingRate = weak ? 0.6 : 1;
      swingDmg = weak ? 25 : 50;
      p.stamina = Math.max(0, p.stamina - SWING_COST);
      swingT = 0; swingHit = false; cooldown = 0.6 / swingRate; game.audio?.swing?.();
    } else {
      if (p.reloading) return;
      if (p.ammo <= 0) { game.audio?.dryFire?.(); cooldown = 0.25; if (p.reserve > 0) reload(); return; }
      p.ammo--; cooldown = 0.16; recoil = 1; slideBack = 1; flashT = 0.05; muzzleFrame = true;
      // ragged flame: a new twist and length every shot, then a puff of smoke left in the air
      vm.flash.rotation.z = Math.random() * 6.28;
      vm.flame.scale.set(0.8 + Math.random() * 0.45, 0.8 + Math.random() * 0.45, 0.65 + Math.random() * 0.6);
      try {
        vm.flash.updateWorldMatrix(true, false);
        vm.flash.getWorldPosition(vm.smoke.position);
        camera.getWorldDirection(smokeVel);
        smokeVel.multiplyScalar(0.6).add(_sv.set(p.vel.x * 0.6 + (Math.random() - 0.5) * 0.2, 0.05, p.vel.z * 0.6 + (Math.random() - 0.5) * 0.2));
        vm.smoke.material.rotation = Math.random() * 6.28;
        smokeT = 0;
      } catch { /* ignore */ }
      game.audio?.gunshot?.();
      game.atmos?.flash?.(1);
      game.emit('noise', { x: p.pos.x, z: p.pos.z, radius: 30 });   // the bridge tool, not a district alarm
      noiseKick = 1;
      aim(0.012);
      const wall = game.collide.raycast(_o, _d, 120);
      const hit = game.dead?.raycast?.(_o, _d, 120);
      if (hit && hit.dist < wall) {
        game.dead.damage?.(hit.id, 60, _d.clone(), hit.part);
        game.audio?.hitFlesh?.();
        p.lastHitWasHead = hit.part === 'head';
        p.lastHit = { id: hit.id, dist: hit.dist, part: hit.part, head: p.lastHitWasHead, t: game.time?.t ?? 0 };
      } else { p.lastHitWasHead = false; p.lastHit = { wall: wall }; }
      kickPitch += 0.035; kickYaw += (Math.random() - 0.5) * 0.01;
    }
  }
  function meleeResolve() {
    aim();
    // swing direction: forward, swept a little right-to-left like the chop (dead.js knocks back along it)
    const sx = _d.x, sz = _d.z;
    _d.x = sx + sz * 0.2; _d.z = sz - sx * 0.2; _d.normalize();
    if (swingShove) { shoveResolve(); return; }
    const k0 = game.dead?.killed ?? 0;
    const hit = game.dead?.meleeHit?.(_o, _d, 1.8, swingDmg);
    p.lastHitWasHead = !!(hit && typeof hit === 'object' && hit.part === 'head');
    if (hit) {
      const kill = (game.dead?.killed ?? 0) > k0;
      game.audio?.hitFlesh?.();
      if (kill) setTimeout(() => { try { game.audio?.hitFlesh?.(); } catch { /* ignore */ } }, 45);
      hitStop = kill ? 0.09 : 0.06;
      kickPitch -= kill ? 0.06 : 0.045;
      kickRoll += kill ? 0.035 : 0.022;
      kickYaw -= 0.01;
      game.atmos?.flash?.(0.15);
    }
    game.emit('noise', { x: p.pos.x, z: p.pos.z, radius: hit ? 10 : 4 });
    p.lastHit = { melee: !!hit, head: p.lastHitWasHead, id: hit && typeof hit === 'object' ? hit.id : undefined, t: game.time?.t ?? 0 };
  }

  // Shove: every standing dead within 1.9 m in a 90° cone ahead is pushed back along the view,
  // zero damage. Uses dead.shove if it exists, else damage(id, 0, dir).
  function shoveResolve() {
    const dead = game.dead;
    const fl = Math.hypot(_d.x, _d.z) || 1, fx = _d.x / fl, fz = _d.z / fl;
    const dir = { x: fx, y: 0, z: fz };
    let n = 0;
    try {
      if (dead?.shove) n = +dead.shove(p.pos.x, p.pos.z, dir, 1.9, SHOVE_KB) || 0;
      else {
        const list = dead?.debug?.near?.(p.pos.x, p.pos.z, 1.9) || [];
        for (const e of list) {
          const dx = e.x - p.pos.x, dz = e.z - p.pos.z, d = Math.hypot(dx, dz) || 1;
          if ((dx * fx + dz * fz) / d < 0.7 || n >= 3) continue;
          if (dead.damage(e.id, 0, { x: dx / d, y: 0, z: dz / d })) n++;
        }
      }
    } catch { /* dead owns its errors */ }
    if (n) {
      game.audio?.hitFlesh?.();
      hitStop = 0.05;
      kickPitch -= 0.03; kickRoll += 0.02;
    }
    game.emit('noise', { x: p.pos.x, z: p.pos.z, radius: n ? 8 : 4 });
    p.lastHit = { melee: !!n, shove: n, head: false, t: game.time?.t ?? 0 };
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
  let kickPitch = 0, kickRoll = 0, kickYaw = 0, deathT = -1, hurtShake = 0, noiseKick = 0, hurtSeed = 0;
  let sinceHurt = 99;
  p.invuln = 0; p.hitStop = 0; p.lastHitWasHead = false;
  function damage(n, from) {
    if (!p.alive || GOD || !playing() || !(n > 0)) return false;
    if (sinceHurt < HURT_GAP) return false;     // still inside the last hit's window
    sinceHurt = 0;
    p.invuln = HURT_GAP;
    hurtSeed = Math.random() * 100;
    p.health = Math.max(0, p.health - n * HURT_SCALE);
    game.audio?.hurt?.();
    hurtShake = 1;
    if (from && Number.isFinite(from.x)) {
      // which side relative to view: right = (cos yaw, −sin yaw)
      const dx = from.x - p.pos.x, dz = from.z - p.pos.z;
      const side = dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw);
      const front = -dx * Math.sin(p.yaw) - dz * Math.cos(p.yaw);
      kickRoll += -Math.sign(side) * 0.06;
      kickYaw += Math.sign(side) * 0.06;
      kickPitch += front > 0 ? 0.08 : -0.05;
    } else kickPitch += 0.06;
    if (p.health <= 0) {
      p.alive = false; deathT = 0;
      if (document.pointerLockElement) try { document.exitPointerLock(); } catch { /* ignore */ }
      game.emit('playerDied', {});
    }
    return true;
  }

  function heal(n) {
    if (!p.alive || !(n > 0)) return;
    p.health = Math.min(HEAL_CAP, p.health + n);
    game.audio?.pickup?.();
  }
  function addAmmo(n) {
    if (!p.alive || !(n > 0)) return;
    p.reserve += Math.floor(n);
    game.audio?.pickup?.();
  }

  function teleport(x, z, yaw) {
    p.pos.set(x, layout.heightAt(x, z), z);
    if (yaw !== undefined) p.yaw = yaw;
    p.vel.set(0, 0, 0);
    eyeY = lastGround = p.pos.y;
  }

  // ---- movement state ----
  let lastGround = p.pos.y, eyeY = p.pos.y, eyeH = EYE, bobPhase = 0, bobAmp = 0, stepDist = 0, stepCount = 0, lastStepSide = 0;
  const prev = new THREE.Vector3();
  let prevUse = false, prevFire = false, prevReload = false;

  function surface() {
    if (p.pos.x > 1000) return 'tiles';
    if (Math.abs(p.pos.x) < 52 && Math.abs(p.pos.z) < 5) return 'stone';   // bridge deck
    return 'cobble';
  }

  // smooth 1-D value noise in −0.5..0.5 sampled at SHAKE_HZ
  const SHAKE_HZ = 20;
  let shakeT = 0;
  const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) - 0.5; };
  function shakeNoise(t, seed) {
    const u = t * SHAKE_HZ + seed * 13.1, i = Math.floor(u), f = u - i, w = f * f * (3 - 2 * f);
    return hash(i) + (hash(i + 1) - hash(i)) * w;
  }

  function update(dt) {
    try { tick(Math.min(dt, 0.1)); } catch (e) { if (!p._warned) { p._warned = true; console.error('[player]', e); } }
  }

  function tick(dt) {
    const inp = p.input;
    // gather input
    let fwd, right, sprintKey, crouchKey, fireNow, useNow, reloadNow = false;
    const live = playing();
    if (AUTO) {
      fwd = +inp.forward || 0; right = +inp.right || 0; sprintKey = !!inp.sprint; crouchKey = !!inp.crouch;
      fireNow = !!inp.fire && !prevFire; prevFire = !!inp.fire;
      useNow = !!inp.use && !prevUse; prevUse = !!inp.use;
      reloadNow = !!inp.reload && !prevReload; prevReload = !!inp.reload;
      if (!live) { fwd = right = 0; sprintKey = crouchKey = fireNow = useNow = reloadNow = false; }
    } else {
      const playing = live;
      fwd = playing ? (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) : 0;
      right = playing ? (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) : 0;
      sprintKey = keys.has('ShiftLeft') || keys.has('ShiftRight');
      crouchKey = !!p.crouchToggle || keys.has('ControlLeft');
      fireNow = clickQueued && playing; clickQueued = false;
      useNow = useQueued && playing; useQueued = false;
      if (!playing) sprintKey = crouchKey = false;
      // mirror into input for anyone reading it
      Object.assign(inp, { forward: fwd, right, sprint: sprintKey, crouch: crouchKey, fire: lmb });
    }
    if (!p.alive) { fwd = right = 0; sprintKey = crouchKey = fireNow = useNow = reloadNow = false; }

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
      // centre ray plus four around the cone: a pole or door jamb off-centre still counts
      let wd = game.collide.raycast(_fo, _fd, 3);
      camera.matrixWorld.extractBasis(_fx, _fy, _fz);
      for (const [a, b] of FAN) {
        _fr.copy(_fd).addScaledVector(_fx, a).addScaledVector(_fy, b).normalize();
        wd = Math.min(wd, game.collide.raycast(_fo, _fr, 3));
      }
      near = nearClamp(wd);
      // a dead face or a survivor's pale coat at arm's length blows out to white too
      let dd = Infinity;
      try { dd = game.dead?.nearest?.(p.pos.x, p.pos.z) ?? Infinity; } catch { /* ignore */ }
      for (const it of game.interactables || []) {
        if (it?.pos) dd = Math.min(dd, Math.hypot(it.pos.x - p.pos.x, it.pos.z - p.pos.z));
      }
      near = Math.min(near, dd < 3 ? 0.3 + 0.7 * (dd / 3) ** 2 : 1);
    }
    p.torchNear = near;
    flI += ((p.flashlight ? SPOT_I * near : 0) - flI) * (1 - Math.exp(-12 * dt));
    if (!dt) flI = p.flashlight ? SPOT_I * near : 0;
    spot.intensity = flI * (0.97 + Math.random() * 0.03);
    fill.intensity = p.flashlight ? FILL_I : 0;
    // warm fill on the hands: torch spill when it's on, a little skin-warmth floor after dark
    const h = game.time?.hour ?? 18, dark = h >= 19 || h < 6 ? 1 : h >= 17.5 ? (h - 17.5) / 1.5 : 0;
    vm.warm.value.setRGB(1, 0.78, 0.55).multiplyScalar(0.1 * dark + (flI / SPOT_I) * 0.35);
    vm.warmth.value = dark;

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
    const stride = p.crouching ? 0.75 : p.sprinting ? 1.75 : 1.15;
    bobAmp += ((hspeed > 0.3 ? Math.min(1, hspeed / WALK) : 0) - bobAmp) * (1 - Math.exp(-8 * dt));
    if (hspeed > 0.3) {
      stepDist += moved;
      if (stepDist >= stride) {
        stepDist -= stride;
        stepCount++;
        lastStepSide ^= 1;
        const loud = p.crouching ? 0.2 : p.sprinting ? 1 : 0.5;
        const radius = p.crouching ? 3 : p.sprinting ? 20 : 8;
        game.audio?.footstep?.(surface(), loud);
        game.emit('noise', { x: p.pos.x, z: p.pos.z, radius });
      }
    } else if (stepDist > 0) {
      // stopping: don't snap the phase; ease it to the nearest trough (a footfall) in ~0.15 s.
      // Rolling forward onto the next foot ends with a soft settle step.
      const toNext = stepDist > stride * 0.5;
      const target = toNext ? stride : 0;
      stepDist += (target - stepDist) * (1 - Math.exp(-dt / 0.05));
      if (Math.abs(target - stepDist) < stride * 0.01) {
        stepDist = 0;
        if (toNext) {
          stepCount++; lastStepSide ^= 1;
          if (p.alive && live) game.audio?.footstep?.(surface(), p.crouching ? 0.1 : 0.22);
        }
      }
    }
    // bob phase straight from the step counter: φ = π·(steps + fraction), so every footfall
    // (fraction 0) lands in the trough of bobY = −cos 2φ
    bobPhase = Math.PI * (stepCount + Math.min(1, stepDist / stride));
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
    if (reloadNow) reload();
    // slow regeneration up to 60 once nothing has hurt you for a while and nothing is close
    sinceHurt += dt;
    if (p.alive && live && sinceHurt > REGEN_DELAY && p.health < REGEN_CAP) {
      let dd = Infinity;
      try { dd = game.dead?.nearest?.(p.pos.x, p.pos.z) ?? Infinity; } catch { /* ignore */ }
      if (dd > REGEN_CLEAR) p.health = Math.min(REGEN_CAP, p.health + REGEN_RATE * dt);
    }
    p.invuln = Math.max(0, HURT_GAP - sinceHurt);   // read-only mirror of the gap
    if (swingT < 0) hitStop = 0;
    if (swingT >= 0) {
      if (hitStop > 0) hitStop -= dt;      // hit-stop: the bar sticks in the body for a beat
      else swingT += dt * swingRate;
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
    p.hitStop = Math.max(0, hitStop);
    recoil = Math.max(0, recoil - dt * 7);
    slideBack = Math.max(0, slideBack - dt * 14);
    flashT -= dt;
    // the flame stays visible (compiled at boot); opacity is the switch
    vm.flash.material.opacity = flashT > 0 ? Math.min(1, flashT / 0.03) : game.state?.phase === 'trailer' ? 1 : 0;   // the trailer drives .visible itself
    if (vm.flameMat) vm.flameMat.opacity = vm.flash.material.opacity;
    // the flash lights the hands and the street for exactly one frame
    muzzle.intensity = muzzleFrame ? 12 : 0;
    muzzleFrame = false;
    if (smokeT >= 0) {
      smokeT += dt;
      const u = smokeT / SMOKE_LIFE;
      if (u >= 1) { smokeT = -1; vm.smoke.material.opacity = 0; }
      else {
        smokeVel.multiplyScalar(Math.exp(-2 * dt));
        vm.smoke.position.addScaledVector(smokeVel, dt);
        vm.smoke.position.y += 0.22 * dt;            // warm smoke rises
        vm.smoke.scale.setScalar(0.08 + 0.5 * Math.sqrt(u));
        vm.smoke.material.opacity = 0.32 * Math.min(1, smokeT / 0.06) * (1 - u) ** 1.6;
        vm.smoke.material.rotation += dt * 0.4;
      }
    }

    p.prompt = p.alive ? candidate()?.label ?? null : null;

    // ---- camera ----
    kickPitch *= Math.exp(-7 * dt); kickRoll *= Math.exp(-5 * dt); kickYaw *= Math.exp(-6 * dt);
    hurtShake = Math.max(0, hurtShake - dt * 3);
    shakeT += dt;
    // 18 mm at a 3.4 Hz sprint cadence peaks at ≈ 0.85 g; walking is far gentler
    const bobY = -Math.cos(bobPhase * 2) * 0.018 * bobAmp;
    const bobX = Math.sin(bobPhase) * 0.012 * bobAmp;
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
    // hurt shake: 20 Hz value noise, smoothly interpolated, decaying — the same at any frame rate
    const shake = hurtShake * hurtShake * 0.03;
    const shP = shake ? shakeNoise(shakeT, hurtSeed) * shake : 0, shY = shake ? shakeNoise(shakeT, hurtSeed + 37) * shake : 0;
    camera.rotation.set(
      p.pitch + kickPitch + shP + (p.alive ? 0 : -Math.min(1, deathT) * 0.4),
      p.yaw + kickYaw + shY,
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
        // swing phases over swingT 0–0.6 (scaled by swingRate, so a winded swing is the same arc, slower):
        // wind-up up-right (0–0.12 s), fast diagonal chop down-left through the centre (0.12–0.27 s),
        // short follow-through (0.27–0.35 s), recover to rest (0.35–0.6 s). Hit lands at 0.2 s, mid-chop.
        const k = swingPose(swingT);
        vm.crowbar.position.x += k[0];
        vm.crowbar.position.y += k[1];
        vm.crowbar.position.z += k[2];
        vm.crowbar.rotation.x += k[3];
        vm.crowbar.rotation.y += k[4];
        vm.crowbar.rotation.z += k[5];
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

  // keyframes: [t, dx, dy, dz, rx, ry, rz] relative to the crowbar's rest pose
  const SWING_KEYS = [
    [0.00, 0, 0, 0, 0, 0, 0],
    [0.12, 0.05, 0.22, 0.03, 0.5, -0.1, -0.35],     // cocked high and right, head back
    [0.20, -0.18, 0.16, -0.04, 0.0, 0.15, 0.12],    // mid-chop: bar slanting across the centre
    [0.27, -0.4, 0.04, -0.08, -0.4, 0.35, 0.5],   // chopped through to low-left
    [0.35, -0.44, 0.02, -0.06, -0.48, 0.4, 0.56],   // follow-through
    [0.60, 0, 0, 0, 0, 0, 0],
  ];
  const _sk = [0, 0, 0, 0, 0, 0];
  function swingPose(t) {
    let i = 0;
    while (i < SWING_KEYS.length - 2 && t > SWING_KEYS[i + 1][0]) i++;
    const A = SWING_KEYS[i], B = SWING_KEYS[i + 1];
    let x = Math.min(1, Math.max(0, (t - A[0]) / (B[0] - A[0])));
    // wind-up eases out, the chop accelerates into the hit and carries through, follow-through brakes, recover smooth
    x = i === 0 || i === 3 ? 1 - (1 - x) * (1 - x) : i === 1 ? x * x : i === 2 ? x * (2 - x) * 0.5 + x * 0.5 : x * x * (3 - 2 * x);
    for (let j = 0; j < 6; j++) _sk[j] = A[j + 1] + (B[j + 1] - A[j + 1]) * x;
    return _sk;
  }

  // Place the camera at the eye with the current yaw/pitch; no input, no movement, no timers.
  function syncCamera() {
    try {
      const camY = eyeY + eyeH;
      camera.position.set(p.pos.x, camY, p.pos.z);
      camera.rotation.set(p.pitch + (p.alive ? 0 : -0.4), p.yaw, p.alive ? 0 : 1.25);
    } catch { /* ignore */ }
  }

  Object.assign(p, {
    update, syncCamera, teleport, damage, heal, addAmmo, select, reload, toggleFlashlight, attack, interact,
    spot, fill, muzzle, viewmodel: vm,
  });
  // place the camera right away so the first render is correct
  tick(0);
  return p;
}
