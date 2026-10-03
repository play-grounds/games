import * as THREE from 'three';
import * as layout from './layout.js';
import { create as createCollide } from './collide.js';

// Boot: build every module in contract order, run the loop, keep score of the delivery.
// Missing or broken modules fall back to stubs so each one can be developed on its own.

const params = new URLSearchParams(location.search);
const AUTO = params.has('auto');

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: AUTO });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 900);
camera.rotation.order = 'YXZ';
scene.add(camera);

const listeners = new Map();
const game = {
  THREE, scene, camera, renderer, layout, params,
  R: layout.rng(1),
  collide: createCollide(),
  interactables: [],
  state: { hasMedicine: false, delivered: false, phase: 'title' },
  time: { t: 0, hour: params.has('t') ? +params.get('t') : 18.05, dt: 0 },
  on(name, fn) { (listeners.get(name) || listeners.set(name, []).get(name)).push(fn); },
  emit(name, data) { for (const fn of listeners.get(name) || []) { try { fn(data); } catch (e) { console.error(e); } } },
};
game.collide.setHeight(layout.heightAt);
window.game = game;

const silent = new Proxy({}, { get: (_, k) => (k === 'update' ? () => {} : () => {}) });

async function load(name, fallback) {
  try {
    return await import(`./${name}.js`);
  } catch (e) {
    if (!/Failed to fetch|Cannot find|404|Importing a module script failed/.test(String(e))) console.error(e);
    console.warn(`[main] ${name}.js missing — using stub`);
    return fallback;
  }
}

function stubWorld(g) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 300).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x555555 }));
  ground.position.set(-30, 0, 0);
  g.scene.add(ground);
  g.scene.add(new THREE.HemisphereLight(0xbbccdd, 0x333322, 1.2));
  return { update() {}, lamps: [], spawns: layout.ROUTE.map(([x, z]) => ({ x: x + 6, z })), fires: [] };
}

function stubPlayer(g) {
  const p = {
    pos: new THREE.Vector3(layout.START.x, 0, layout.START.z), yaw: layout.START.yaw, pitch: 0,
    health: 100, stamina: 1, noise: 0, weapon: 'crowbar', ammo: 12, reserve: 24, alive: true, flashlight: false, locked: false,
    teleport(x, z, yaw) { p.pos.set(x, layout.heightAt(x, z), z); if (yaw !== undefined) p.yaw = yaw; },
    damage(n) { if (!params.has('god')) p.health = Math.max(0, p.health - n); },
    update() {
      p.pos.y = layout.heightAt(p.pos.x, p.pos.z);
      g.camera.position.set(p.pos.x, p.pos.y + 1.65, p.pos.z);
      g.camera.rotation.set(p.pitch, p.yaw, 0);
    },
  };
  return p;
}

const mods = {};
async function boot() {
  const T = await load('textures', { makeTextures: () => new Proxy({}, { get: () => () => null }) });
  game.tex = T.makeTextures(game);
  game.audio = (await load('audio', { create: () => silent })).create(game);
  game.world = (await load('world', { create: stubWorld })).create(game);
  game.interior = (await load('interior', { create: () => ({ update() {}, inside: false, spawns: [] }) })).create(game);
  game.atmos = (await load('atmos', { create: () => ({ update() {}, flash() {} }) })).create(game);
  game.player = (await load('player', { create: stubPlayer })).create(game);
  game.collide.finalize();
  game.dead = (await load('dead', { create: () => ({ update() {}, count: 0, alive: 0, raycast: () => null, meleeHit: () => false, damage() {}, nearest: () => Infinity }) })).create(game);
  game.hud = (await load('hud', { create: () => ({ update() {}, message: (m) => console.log('[hud]', m) }) })).create(game);
  if (params.has('trailer')) game.trailer = (await load('trailer', { create: () => ({ update() {} }) })).create(game);
  Object.assign(mods, { trailer: game.trailer, audio: game.audio, world: game.world, interior: game.interior, atmos: game.atmos, player: game.player, dead: game.dead, hud: game.hud });

  // The delivery.
  game.interactables.push({
    pos: new THREE.Vector3(layout.MEDIC.x, layout.heightAt(layout.MEDIC.x, layout.MEDIC.z) + 1, layout.MEDIC.z),
    radius: 3,
    label: 'Předat léky — Hand over the medicine',
    enabled: () => game.state.hasMedicine && !game.state.delivered,
    use: () => { game.state.delivered = true; game.state.phase = 'won'; game.audio.deliver?.(); game.emit('delivered', {}); },
  });
  game.on('playerDied', () => { game.state.phase = 'dead'; });

  const start = () => { game.audio.resume?.(); if (game.state.phase === 'title') game.state.phase = 'play'; };
  addEventListener('pointerdown', start);
  addEventListener('keydown', start);
  if (AUTO) game.state.phase = 'play';
  game.ready = true;
  console.log('[main] ready');
  if (!AUTO) requestAnimationFrame(frame);
}

let lastHour = Math.floor(game.time.hour);
function step(dt) {
  game.time.dt = dt;
  game.time.t += dt;
  if (game.state.phase === 'play') game.time.hour = (game.time.hour + dt / 120) % 24;   // 1 game hour = 2 min
  const h = Math.floor(game.time.hour);
  if (h !== lastHour) { lastHour = h; game.audio.chime?.(h); game.emit('chime', { hour: h }); game.emit('noise', { x: layout.CLOCK.x, z: layout.CLOCK.z, radius: 250 }); }
  for (const k of ['world', 'interior', 'atmos', 'player', 'dead', 'hud', 'audio', 'trailer']) {
    if (!mods[k]) continue;
    try { mods[k].update(dt); } catch (e) { if (!mods[k]._warned) { mods[k]._warned = 1; console.error(`[${k}]`, e); } }
  }
  if (game.atmos.render) game.atmos.render(); else renderer.render(scene, camera);
}

let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  step(dt);
  requestAnimationFrame(frame);
}

game.step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) step(dt); };
game.chime = () => { lastHour = -1; };

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  game.emit('resize', {});
});

boot().catch((e) => console.error('[main] boot failed', e));
