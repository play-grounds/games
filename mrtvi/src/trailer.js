// MRTVÍ — real-time in-engine trailer (`?trailer`). Loaded by main.js after every module;
// update(dt) runs last each frame, before render. Shot list, cards and cues: ./trailer/timeline.js.
// Everything is a function of trailer time t: each shot part is staged from scratch (dead cleared
// and placed, player parked, flashlight set) and fast-forwarded to t, so seek(t) + game.step(n)
// gives the same frames every time. Live playback follows the wall clock so the score stays in sync.
import { SHOTS, CARDS, LENGTH } from './trailer/timeline.js';

const svgURL = (s) => `url("data:image/svg+xml;utf8,${encodeURIComponent(s)}")`;
const STENCIL = svgURL(`<svg xmlns='http://www.w3.org/2000/svg' width='340' height='340'><filter id='s'><feTurbulence type='fractalNoise' baseFrequency='.045 .09' numOctaves='4' seed='7'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 -9 6.3'/></filter><rect width='100%' height='100%' filter='url(#s)'/><g stroke='black' stroke-width='2' opacity='.9'><path d='M0 120 L340 108'/><path d='M40 250 L300 262'/><path d='M120 0 L128 340' stroke-width='1.2'/></g></svg>`);

const CSS = `
#trailer { position: fixed; inset: 0; z-index: 30; pointer-events: auto; cursor: none; user-select: none; color: #e8e2d6;
  font-family: "Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif; font-stretch: condensed;
  text-transform: uppercase; letter-spacing: .08em; text-shadow: 0 1px 2px #000, 0 0 10px rgba(0,0,0,.9);
  --stencil: ${STENCIL}; }
#trailer.idle, #trailer.end { cursor: default; }
#trailer .bar { position: absolute; left: 0; right: 0; background: #000; }
#trailer .bar.t { top: 0; } #trailer .bar.b { bottom: 0; }
#trailer .black { position: absolute; inset: 0; background: #000; opacity: 0; }
#trailer .card { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); text-align: center; opacity: 0; padding: 0 6vw; }
#trailer .card.low { top: 74%; }
#trailer .card.lowleft { top: 74%; text-align: left; padding-left: 7vw; }
#trailer .card.lowleft .cz { margin-right: 0; }
#trailer .card .cz { font-size: clamp(22px, 3.4vw, 54px); font-weight: 700; letter-spacing: .32em; margin-right: -.32em;
  -webkit-mask-image: var(--stencil); mask-image: var(--stencil); -webkit-mask-size: 340px 340px; mask-size: 340px 340px; }
#trailer .card .en { margin-top: .8em; font-size: clamp(14px, 1.45vw, 22px); font-weight: 700; letter-spacing: .26em; margin-right: -.26em; color: #f4efe6;
  text-shadow: 0 1px 2px #000, 0 0 8px #000, 0 0 16px rgba(0,0,0,.9); }
#trailer .ttl { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; opacity: 0; }
#trailer .logo { font-family: Impact, "Haettenschweiler", "Arial Black", "Franklin Gothic Heavy", sans-serif;
  font-size: clamp(64px, 15vw, 240px); line-height: .9; letter-spacing: .12em; margin-right: -.12em; color: #e8e2d6;
  text-shadow: 0 0 1px #000, 3px 4px 0 rgba(0,0,0,.65), 0 0 40px rgba(0,0,0,.9);
  -webkit-mask-image: var(--stencil); mask-image: var(--stencil); -webkit-mask-size: 340px 340px; mask-size: 340px 340px; }
#trailer .sub { margin-top: 1.6vh; font-size: clamp(18px, 2.3vw, 36px); font-weight: 700; letter-spacing: .35em; margin-right: -.35em; }
#trailer .sub small { display: block; margin-top: .45em; font-size: .6em; color: #f4efe6; letter-spacing: .3em; }
#trailer .btn { margin-top: 4.5vh; padding: .7em 2.4em; font: inherit; font-size: clamp(13px, 1.3vw, 19px); letter-spacing: .3em;
  text-transform: uppercase; cursor: pointer; color: #e8e2d6; background: rgba(0,0,0,.45); border: 1px solid rgba(232,226,214,.7);
  border-radius: 0; text-shadow: inherit; opacity: 0; transition: opacity 1.2s, background .2s; pointer-events: none; }
#trailer .btn.on { opacity: 1; pointer-events: auto; }
#trailer .btn.play { margin-top: 5vh; padding: .8em 2.8em; font-size: clamp(18px, 2vw, 30px); font-weight: 700; color: #0b0b0b;
  background: #ece6da; border: 0; text-shadow: none; box-shadow: 0 0 30px rgba(0,0,0,.8); }
#trailer .btn.play small { font-weight: 400; opacity: .75; }
#trailer .btn.play:hover { background: #fff; }
#trailer .btn:hover { background: rgba(232,226,214,.12); }
#trailer .btn small { font-size: .7em; opacity: .7; }
#trailer .skip { position: absolute; right: 2.2vw; bottom: 1.6vh; font-size: 11px; letter-spacing: .2em; color: #e8e2d6;
  opacity: .35; cursor: pointer; text-decoration: none; transition: opacity .3s; }
#trailer .skip:hover { opacity: .9; }
#trailer.end .skip, #trailer.idle .skip { display: none; }
#trailer .start { position: absolute; inset: 0; background: #000; display: none; flex-direction: column; align-items: center; justify-content: center; }
#trailer.idle .start { display: flex; }
#trailer .start .h { font-size: clamp(18px, 2.4vw, 34px); letter-spacing: .4em; margin-right: -.4em; }
#trailer .start .h b { font-family: Impact, "Arial Black", sans-serif; font-weight: 400; letter-spacing: .14em; }
#trailer .start .btn { opacity: 1; pointer-events: auto; }
`;

const HTML = `
<div class="black"></div>
<div class="card"><div class="cz"></div><div class="en"></div></div>
<div class="ttl"><div class="logo">MRTVÍ</div><div class="sub">Doruč. Přežij.<small>Deliver. Survive.</small></div>
  <button class="btn play">Hrát <small>/ Play</small></button></div>
<div class="bar t"></div><div class="bar b"></div>
<a class="skip">Přeskočit / Skip ›</a>
<div class="start"><div class="h"><b>MRTVÍ</b> — trailer</div><button class="btn go">▶ Přehrát <small>/ Play trailer</small></button></div>
`;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sm = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const ease = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const easeOut = (u) => { u = clamp(u, 0, 1); return 1 - (1 - u) * (1 - u); };
// smooth deterministic noise in −1..1
const wob = (t, s) => (Math.sin(t * 1.13 + s) * 0.5 + Math.sin(t * 2.37 + s * 1.7) * 0.3 + Math.sin(t * 4.71 + s * 2.3) * 0.2);
const LOGO_T = 74;
// per-card overrides of timeline.js placement/timing (keyed by card start time)
const CARD_FIX = { 19.5: { dur: 2.7, pos: 'lowleft' }, 28: { pos: 'low' }, 68: { pos: 'low' } };

export function create(game) {
  const { THREE, camera, layout: L, params } = game;
  const AUTO = params.has('auto');
  const H = L.heightAt;
  const D = game.dead?.debug;
  const vm = game.player?.viewmodel;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const curve = (pts) => (pts.length > 1 ? new THREE.CatmullRomCurve3(pts.map((p) => V(...p)), false, 'centripetal') : { getPoint: (_, o) => o.copy(V(...pts[0])) });

  // ---------- take over ----------
  game.state.phase = 'trailer';
  const hudEl = document.getElementById('hud');
  if (hudEl) hudEl.style.display = 'none';
  if (D) D.blind = true;
  if (game.player) game.player.damage = () => {};
  // Hour jumps between shots would make main ring the clock; only the clock shot may.
  let allowChime = 0;
  const emit0 = game.emit.bind(game);
  game.emit = (name, data) => {
    if (name === 'chime') { if (!allowChime) return; }
    if (name === 'noise' && data && data.radius === 250 && Math.abs(data.x - L.CLOCK.x) < 1 && Math.abs(data.z - L.CLOCK.z) < 1) {
      if (!allowChime) return;
      allowChime = 0;
    }
    emit0(name, data);
  };
  const chime0 = game.audio?.chime?.bind(game.audio);
  if (game.audio && chime0) game.audio.chime = (h) => { if (allowChime) chime0(h); };

  // ---------- DOM ----------
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'trailer';
  root.className = 'idle';
  root.innerHTML = HTML;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const el = { black: $('.black'), card: $('.card'), cz: $('.card .cz'), en: $('.card .en'), ttl: $('.ttl'), logo: $('.logo'), sub: $('.ttl .sub'), play: $('.play'), barT: $('.bar.t'), barB: $('.bar.b') };
  // keep clicks away from the player's pointer-lock handler on window
  for (const ev of ['click', 'mousedown']) root.addEventListener(ev, (e) => e.stopPropagation());
  $('.go').addEventListener('click', () => play());
  $('.skip').addEventListener('click', () => skip());
  el.play.addEventListener('click', () => {
    score?.stop();
    const q = new URLSearchParams(location.search);
    q.delete('trailer'); q.delete('autoplay');
    const s = q.toString();
    location.href = location.pathname + (s ? '?' + s : '');
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && playing && T < LOGO_T) skip();
    else if ((e.code === 'Space' || e.code === 'Enter') && !started) play();
  });
  function layoutBars() {
    const bh = Math.max(0, (innerHeight - innerWidth / 2.35) / 2);
    el.barT.style.height = el.barB.style.height = bh + 'px';
  }
  layoutBars();
  addEventListener('resize', layoutBars);

  // ---------- score ----------
  let score = null;
  import('./trailer/music.js').then((m) => { try { score = m.createScore(game); if (playing) { score.start(); score.update(T); } } catch (e) { console.warn('[trailer] score', e); } })
    .catch(() => console.warn('[trailer] no score — playing silent'));

  // ---------- staging helpers ----------
  const P = game.player;
  let ff = false;                      // fast-forwarding during seek: no sound, no flashes
  const spawn = (x, z, o = {}) => (D ? D.spawn(x, z, { state: 1, ...o }) : -1);
  const walkTo = (id, x, z, v = 0.7) => { if (id >= 0) D.set(id, { state: D.STATES.INVEST, tx: x, tz: z, v }); };
  // blind dead chase their tx/tz once close: point them at the parked player
  const chase = (id) => { if (id >= 0 && P) D.set(id, { state: D.STATES.CHASE, tx: P.pos.x, tz: P.pos.z, v: 1 }); };
  const face = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
  function park(x, z, yaw = 0) { P?.teleport?.(x, z, yaw); if (P) P.pitch = 0; }
  function torch(on) { P?.toggleFlashlight?.(on); }
  // a practical key light for staged shots (firelight on the medic); always in the scene so the
  // light count, and so the compiled shaders, never change mid-trailer
  const key = new THREE.PointLight(0xff8a3c, 0, 12, 1.6);
  const rim = new THREE.PointLight(0x9fb4d8, 0, 40, 1);       // cool back/rim light to lift the dead off the dark
  game.scene.add(key, rim);
  let lightR = {}, spot0 = null;
  let fogMul = 1, fogBase = null, fogSet = -1, fov = 55, showGun = false, gunFlashT = 0;

  // A part is a staged piece of a shot: [start, stage(), cam(lt) → {p, l, roll}, beats]
  // Times inside parts are local to the shot.
  const SHOT = Object.fromEntries(SHOTS.map((s) => [s.id, s]));
  const PARTS = [];
  const part = (id, at, o) => PARTS.push({ shot: SHOT[id], t: SHOT[id].t + at, at, ...o });

  const _p = V(0, 0, 0), _l = V(0, 0, 0);
  const along = (c, u, out) => c.getPoint(clamp(u, 0, 1), out);

  // 1. river — high, slow drift over the Vltava from the south: bridge and castle as silhouettes
  {
    // hook: a walker at the bridge parapet in the foreground, then crane up and back over the river
    const cp = curve([[32.3, 0.95, 2.0], [33.5, 4.5, 12], [38, 20, 62]]);
    const cl = curve([[-60, 5, -4], [-75, 7, -8], [-100, 10, -12]]);
    part('river', 0, {
      fog: 0.35, fov: 46, torch: false, rim: [26.8, 2.6, 4.4, 30],
      stage() {
        park(60, 0, Math.PI / 2);
        bridgeHorde();
        spawn(29.0, 3.3, { h: face(29.0, 3.3, -60, -30) });
      },
      cam(lt) { const u = lt / 8; along(cp, u * u * (1.6 - 0.6 * u), _p); along(cl, u, _l); return {}; },
    });
  }

  // 2. celetna — walking-height push west in drizzle; a lone walker crosses far ahead
  {
    let w = -1;
    part('celetna', 0, {
      fog: 0.8, fov: 50, torch: false, hand: 1,
      stage() {
        park(255, 12, Math.PI / 2);
        w = spawn(217, 3.9, { h: -0.25 });
        walkTo(w, 213, 12.5, 0.6);
        spawn(196, 8.5, { h: 2.4, state: 1 });
      },
      cam(lt) {
        const u = lt / 8, x = 259 - 22 * u;
        _p.set(x, 1.62 + Math.sin(lt * 5.2) * 0.025, 12.3 - 1.8 * u);
        _l.set(x - 40, 1.5, 9.5 - 2.5 * u);
        return {};
      },
    });
  }

  // 3. pharmacy — torch sweeps shelves, finds the red-cross case; reverse: a walker rises against the window
  {
    const O = L.INTERIOR;
    let riser = -1;
    const cp = curve([[1.0, 1.58, 3.0], [2.4, 1.55, 0.2], [3.6, 1.5, -2.6], [4.0, 1.48, -5.0], [2.9, 1.42, -7.6]]);
    const shelf = curve([[-6, 1.5, -1.5], [-4.5, 1.25, -3.6]]), through = curve([[4.1, 1.2, -9], [0.5, 0.85, -10.35]]);
    const _a = V(0, 0, 0), _b = V(0, 0, 0);
    part('pharmacy', 0, {
      fov: 52, torch: true, hand: 1.2, hour: 19.6,
      stage() { park(O.x + 2, O.z + 2.5, 0); },
      cam(lt) {
        along(cp, ease(lt / 6.2), _p);
        // pan the shelves, then a quick swing straight through the storeroom door to the case
        along(shelf, sm(0, 2.4, lt), _a); along(through, sm(3.2, 5.6, lt), _b);
        _l.copy(_a).lerp(_b, sm(2.3, 3.2, lt));
        _p.x += O.x; _p.z += O.z; _l.x += O.x; _l.z += O.z;
        return {};
      },
    });
    part('pharmacy', 6.2, {
      fov: 50, torch: false, hand: 1.5, hour: 19.6,
      stage() {
        park(O.x - 2.5, O.z + 0.4, Math.PI);
        riser = spawn(O.x - 5.0, O.z + 3.7, { h: face(-5, 3.7, -2.5, 0.4), sit: true });
      },
      beats: [[6.45, () => { if (riser >= 0) emit0('noise', { x: O.x - 5.0, z: O.z + 3.7, radius: 3 }); }],
        [7.6, () => { if (riser >= 0) walkTo(riser, O.x - 2.8, O.z + 0.9, 0.55); }]],
      cam(lt) {
        const k = lt - 6.2;
        _p.set(O.x - 2.4 + 0.12 * k, 1.2, O.z + 0.4 - 0.2 * k);
        _l.set(O.x - 5.1, 1.55 + sm(0.3, 2, k) * 0.3, O.z + 4.9);
        return {};
      },
    });
  }

  // 4. clock — slow tilt up the clock tower to the dial; the bell strikes (real chime)
  {
    const C = L.CLOCK;
    const ids = [];
    part('clock', 0, {
      fog: 0.8, fov: 48, torch: false,
      stage() {
        park(C.x, C.z + 16, 0);
        ids.length = 0;
        for (const [x, z, h] of [[106, 12, 2.2], [119, 8, -1.5], [111, 17, 3], [123, 13, 0.4]]) ids.push(spawn(x, z, { h }));
      },
      beats: [[0.7, () => { if (!ff) { allowChime = 1; game.chime?.(); } }],
        [1.1, () => ids.forEach((id, k) => walkTo(id, C.x - 2 + k * 1.4, C.z + 3, 0.55))]],
      cam(lt) {
        const u = ease(lt / 8);
        _p.set(C.x + 10 - 2.5 * u, 1.4 + 2.2 * u, C.z + 25 - 5 * u);
        _l.set(C.x, 2 + 10.5 * u, C.z);
        return {};
      },
    });
  }

  // 5. square — high over Old Town Square: the dead stop, turn and drift in toward the clock
  {
    const O = L.OTS, C = L.CLOCK;
    const ids = [];
    part('square', 0, {
      fog: 0.7, fov: 50, torch: false, rim: [O.x - 22, 3.5, O.z + 2, 55],
      stage() {
        park(O.x, O.z, Math.PI / 2);
        ids.length = 0;
        const R = L.rng(77);
        for (let k = 0; k < 48; k++) {
          const x = O.x - 30 + R() * 30, z = O.z - 8 + R() * 28;
          const id = spawn(x, z, { h: R() * 6.28, state: R() < 0.5 ? 1 : 2, crawler: R() < 0.06 ? true : undefined });
          ids.push([id, R()]);
        }
        // five close to the lens (3–5 m at the end of the move), lower third
        const f = [-0.894, -0.447], rt = [0.447, -0.894], E = [O.x + 2, O.z + 14];
        for (const [d, sd] of [[3.4, -1.3], [4.2, 0.9], [5, -2.6], [4.6, 2.3], [5.6, -0.2]]) {
          const x = E[0] + f[0] * d + rt[0] * sd, z = E[1] + f[1] * d + rt[1] * sd;
          ids.push([spawn(x, z, { h: face(x, z, E[0] + 30, E[1] + 15) }), 0.1 + R() * 0.8]);
        }
      },
      beats: [[1.2, () => ids.forEach(([id, r]) => { if (r < 0.5) D.set(id, { state: D.STATES.IDLE }); })],
        ...[0, 1, 2, 3].map((g) => [1.6 + g * 0.7, () => ids.forEach(([id, r]) => {
          if (Math.floor(r * 4) === g) walkTo(id, C.x + 6 + r * 6, C.z + 6 + (r - 0.5) * 16, 0.5 + r * 0.35);
        })])],
      cam(lt) {
        const u = ease(lt / 9);
        _p.set(O.x + 6 - 4 * u, 2.2, O.z + 16 - 2 * u);
        _l.set(O.x - 22, 1.5 + 0.8 * u, O.z + 2);
        return {};
      },
    });
  }

  // 6. bridge — low tracking shot along Charles Bridge through a lane in the horde; statues overhead
  {
    const turners = [];
    part('bridge', 0, {
      fog: 0.75, fov: 58, torch: false, hand: 0.8, hour: 19.3,
      stage() {
        park(30, 0, Math.PI / 2);
        turners.length = 0;
        bridgeHorde(turners);
        for (const [x, z0, z1] of [[42.5, -3.4, 3.8], [39.5, 3.6, -3.6], [36.5, -3.2, 3.8]]) walkTo(spawn(x, z0, { h: face(x, z0, x, z1) }), x, z1, 2.2);
      },
      every(lt) {
        // standing walkers turn and start after the camera as it passes
        const cx = 46 - 6 * lt;
        for (const tr of turners) if (!tr[2] && tr[1] > cx - 6) { tr[2] = 1; walkTo(tr[0], cx - 10, 0, 0.9); }
      },
      cam(lt) {
        const x = 46 - 6 * lt;
        _p.set(x, 0.95 + Math.sin(lt * 5.6) * 0.02, 0.25 * Math.sin(lt * 0.6));
        _l.set(x - 12, 1.4 + Math.sin(lt * 0.35) * 0.3, -0.4 + Math.sin(lt * 0.5) * 1.2);
        return { roll: Math.sin(lt * 0.7) * 0.03, rim: [x - 11, 2.2, 0, 150] };
      },
    });
  }

  // 7. cuts — fast: torch on a face at 2 m; muzzle flash in an alley; a runner lunging; a body falling; at the lens
  {
    // 7a — torch on a face, Husova alley
    let a = -1;
    part('cuts', 0, {
      fog: 1, fov: 44, torch: true, hand: 1.2,
      stage() { park(93.5, -27.8, 0); a = spawn(93.8, -30.2, { h: face(93.8, -30.2, 93.5, -27.8) }); walkTo(a, 93.6, -28.6, 0.3); },
      cam(lt) { _p.set(93.5, 1.62, -27.8 + lt * 0.15); _l.set(93.8, 1.5, -31); return {}; },
    });
    // 7b — muzzle flash in an alley (Liliová), the pistol bucks, the walker staggers
    let b = -1, b2 = -1;
    part('cuts', 1.5, {
      fog: 1, fov: 60, torch: true, gun: true, hand: 0.8,
      stage() {
        park(84.4, 22, 0); gunReady();
        b = spawn(83.9, 17.6, { h: face(83.9, 17.6, 84.4, 22) }); chase(b);
        b2 = spawn(84.8, 12.5, { h: Math.PI + 0.3 }); walkTo(b2, 84, 18, 0.7);
      },
      beats: [[1.75, () => fire(b, 50)], [2.3, () => fire(b, 120)]],
      cam(lt) { _p.set(84.4, 1.62, 22); _l.set(84.0, 1.35, 12); return {}; },
    });
    // 7c — a runner lunging, low angle on Řetězová
    let c = -1;
    part('cuts', 3, {
      fog: 1, fov: 50, torch: true, hand: 1.4,
      stage() { park(64.6, -10, Math.PI); c = spawn(63.6, -15.5, { h: 0.1 }); chase(c); },
      cam(lt) { const k = lt - 3; _p.set(64.6, 1.2 - k * 0.1, -10 + k * 0.4); _l.set(63.6, 1.3, -18); return {}; },
    });
    // 7d — a body falling, flash-lit (second shot)
    let d = -1;
    part('cuts', 4.5, {
      fog: 1, fov: 46, torch: true, gun: true,
      stage() { park(150.3, 32.6, 0); gunReady(); d = spawn(149.8, 28.6, { h: face(149.8, 28.6, 150.3, 32.6) }); chase(d); },
      beats: [[4.6, () => fire(d, 200)]],
      cam(lt) { const k = lt - 4.5; _p.set(150.3, 1.25 - k * 0.1, 32.6 + k * 0.15); _l.set(149.8, 0.9 - k * 0.2, 28.4); return {}; },
    });
    // 7e — a walker lunging at the lens
    let e = -1;
    part('cuts', 6, {
      fog: 1, fov: 52, torch: true, hand: 1.6,
      stage() { park(176, 52, Math.PI); e = spawn(175.5, 49, { h: 0 }); chase(e); },
      cam(lt) { const k = lt - 6; _p.set(176, 1.62 - k * 0.05, 52 + k * 0.25); _l.set(175.6, 1.45, 48); return { roll: -k * 0.04 }; },
    });
  }

  // 8. nerudova — climbing at night, torch on the cobbles, the castle and its fires above
  {
    part('nerudova', 0, {
      fog: 0.42, fov: 54, torch: true, hand: 1, hour: 19.4, spot: 0.26,
      stage() {
        park(-198, -14, Math.PI / 2);
        for (const [x, z, h] of [[-207, -18.5, 1.4], [-213, -13.5, 1.9], [-219, -18, 1.6]]) spawn(x, z, { h, state: 1 });
        walkTo(spawn(-203, -15, { h: 1.5 }), -190, -12, 0.6);
      },
      cam(lt) {
        // climb for 6 s, tilting up off the torch pool to the castle gate; hold on the castle
        const u = ease(lt / 6.2), x = -170 - 15 * u;
        _p.set(x, H(x, -9) + 1.62 + Math.sin(lt * 5.4) * 0.03 * (1 - sm(5.5, 6.5, lt)), -9.6 - 2.2 * u);
        const g = sm(0.8, 6.2, lt);
        _l.set(-200 - 66 * g, H(x, -9) + 1.0 + (28 + 4 - H(x, -9) - 1.0) * g, -16 - 4 * g);
        return { fov: 54 - 16 * sm(3, 7, lt) };
      },
    });
  }

  // 9. camp — fires; the medic in the firelight
  {
    const M = L.MEDIC, Y = L.HILL.height;
    part('camp', 0, {
      fog: 0.6, fov: 40, torch: false, hand: 0.4, hour: 19.8, key: [M.x + 1.1, Y + 1.3, M.z + 1.0, 14],
      stage() { park(-292, -14, Math.PI / 2); },
      cam(lt) {
        const u = ease(lt / 6);
        _p.set(M.x + 3.4 - 0.8 * u, Y + 1.62, M.z + 1.1 - 0.3 * u);
        _l.set(M.x, Y + 1.5, M.z - 0.9);
        return {};
      },
    });
  }

  // 10. black — 11. title: MRTVÍ over a dim slow drift past the bridge towers
  part('black', 0, { fov: 50, torch: false, stage() { park(60, 0, Math.PI / 2); }, cam() { _p.set(60, 2, 0); _l.set(0, 2, 0); return {}; } });
  {
    part('title', 0, {
      fog: 0.45, fov: 42, torch: false, hour: 19.4,
      stage() { park(60, 0, Math.PI / 2); bridgeHorde(); },
      cam(lt) {
        const k = lt;
        _p.set(28 - k * 0.5, 9 + k * 0.08, 70 - k * 0.6);
        _l.set(-40, 8, -6);
        return {};
      },
    });
  }

  // the bridge horde: feeding clusters along the deck, alternating sides, leaving a lane
  function bridgeHorde(turners) {
    const R = L.rng(4040);
    const CLX = [-36, -18, 0, 18, 36];
    for (let c = 0; c < 5; c++) {
      const side = c % 2 ? -1 : 1, cx = CLX[c], cz = side * 2.4;
      const body = spawn(cx, cz, { h: R() * 6.28 });
      if (body >= 0) D.kill(body);
      for (let m = 0; m < 7; m++) {
        const feed = m < 3;
        const a = (m / 7) * Math.PI * 2 + R() * 0.5, rr = feed ? 0.8 : 1.3 + R() * 1.6;
        const x = cx + Math.cos(a) * rr * 1.6;
        const z = clamp(cz + Math.sin(a) * rr * 0.55, side > 0 ? 1.1 : -4.1, side > 0 ? 4.1 : -1.1);
        const id = spawn(x, z, { horde: true, h: feed ? face(x, z, cx, cz) : R() * 6.28, sit: feed, crawler: m === 6 && c % 2 === 0 ? true : undefined });
        if (!feed && turners && id >= 0 && R() < 0.6) turners.push([id, x, 0]);
      }
    }
    settle = 1.3;
  }
  let settle = 0;

  function gunReady() {
    if (!P) return;
    P.select?.('pistol');
    P.ammo = 12;
    for (let k = 0; k < 5; k++) P.update(0.1);      // finish the draw
  }
  function fire(id, dmg) {
    gunFlashT = 0.06;
    if (!ff) {
      // the real thing: muzzle light, flash, report, recoil (aimed by our camera)
      if (P?.attack && P.weapon === 'pistol') P.attack();
      else { game.atmos?.flash?.(1.2); game.audio?.gunshot?.(); }
    }
    if (id >= 0 && game.dead) {
      const hit = !ff && P?.lastHit?.id === id;            // the real round already landed (60, or 120 in the head)
      const i = D.info(id);
      const dir = { x: i.x - camera.position.x, y: 0, z: i.z - camera.position.z };
      const extra = dmg - (hit ? 60 : 0);
      if (extra > 0 && i.hp > 0) game.dead.damage(id, extra, dir);
    }
  }

  // ---------- playback ----------
  let T = 0, playing = false, started = false, cur = null, lastLT = 0, wall0 = 0;
  const partAt = (t) => { let p = PARTS[0]; for (const q of PARTS) if (q.t <= t + 1e-6) p = q; return p; };

  function stage(p) {
    cur = p;
    if (D) D.clear();
    allowChime = 0;
    showGun = !!p.gun;
    if (P && !p.gun && P.weapon !== 'crowbar') P.select('crowbar');
    fogMul = p.fog ?? 1;
    fov = p.fov ?? 55;
    game.time.hour = p.hour ?? p.shot.hour;
    settle = 0;
    key.intensity = 0; rim.intensity = 0;
    if (P?.spot) { if (spot0 === null) spot0 = P.spot.angle; P.spot.angle = p.spot ?? spot0; }
    try { p.stage?.(); } catch (e) { console.error('[trailer] stage', p.shot.id, e); }
    torch(!!p.torch);
    P?.update?.(0);
    // corpses settle without the clock running
    if (settle > 0 && game.dead) { const f = ff; ff = true; for (let k = 0; k < settle * 30; k++) game.dead.update(1 / 30); ff = f; }
    lastLT = p.at - 1e-4;
  }

  function placeCamera(lt) {
    const r = cur.cam(lt) || {};
    lightR = r;
    const hand = cur.hand || 0;
    if (hand) {
      _p.x += wob(lt, 1) * 0.03 * hand; _p.y += wob(lt * 0.9, 2) * 0.025 * hand; _p.z += wob(lt, 3) * 0.03 * hand;
      _l.x += wob(lt * 0.7, 4) * 0.12 * hand; _l.y += wob(lt * 0.8, 5) * 0.08 * hand;
    }
    camera.position.copy(_p);
    camera.up.set(0, 1, 0);
    camera.lookAt(_l);
    camera.rotateZ((r.roll || 0) + (hand ? wob(lt * 0.6, 6) * 0.006 * hand : 0));
    const f = r.fov ?? fov;
    if (camera.fov !== f) { camera.fov = f; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
  }

  // advance the current part's beats/scripts from lastLT to lt
  function run(lt) {
    for (const [bt, fn] of cur.beats || []) if (bt > lastLT && bt <= lt) { try { fn(); } catch (e) { console.error('[trailer] beat', e); } }
    try { cur.every?.(lt); } catch (e) { console.error('[trailer] every', e); }
    lastLT = lt;
  }

  // go to trailer time t: stage the part, fast-forward the dead to t
  function seek(t) {
    T = clamp(t, 0, LENGTH + 30);
    const p = partAt(T);
    stage(p);
    const lt = T - p.shot.t;
    ff = true;
    let k = p.at;
    placeCamera(k);
    while (k < lt - 1e-6) {
      const h = Math.min(1 / 30, lt - k);
      k += h;
      placeCamera(k);
      run(k);
      game.dead?.update?.(h);
    }
    ff = false;
    run(lt);
    placeCamera(lt);
    wall0 = performance.now() - T * 1000;
    score?.update?.(T);
  }

  function play() {
    if (started) return;
    started = true; playing = true;
    root.className = '';
    try { game.audio?.resume?.(); } catch { /* ignore */ }
    seek(0);
    try { score?.start(); } catch (e) { console.warn('[trailer] score', e); }
  }
  function skip() {
    if (!started) play();
    seek(LOGO_T);
  }

  // ---------- overlay ----------
  function overlay() {
    const sh = cur?.shot;
    // cards
    let card = null, a = 0;
    for (const c0 of CARDS) {
      const c = { ...c0, ...(CARD_FIX[c0.t] || {}) };
      if (T >= c.t && T < c.t + c.dur) { card = c; a = sm(c.t, c.t + 0.7, T) * (1 - sm(c.t + c.dur - 0.8, c.t + c.dur, T)); }
    }
    if (card && el.cz.textContent !== card.cz) { el.cz.textContent = card.cz; el.en.textContent = card.en; el.card.className = 'card ' + (card.pos || ''); }
    el.card.style.opacity = card ? a.toFixed(3) : '0';
    // black: the black shot, a fade up from black at the very start, a dip into the title
    let blk = 0;
    if (!started) blk = 1;
    else if (sh?.id === 'black') blk = 1;
    else if (T < 1.2) blk = 1 - sm(0, 1.2, T);
    else if (sh?.id === 'title') blk = 0.7 - 0.5 * sm(LOGO_T, LOGO_T + 3, T);
    el.black.style.opacity = blk.toFixed(3);
    // the logo lands on the hit at ~80 %, then blooms to full; the tagline follows
    const on = T >= LOGO_T;
    const bloom = sm(LOGO_T, LOGO_T + 1.5, T);
    el.ttl.style.opacity = on ? '1' : '0';
    el.logo.style.opacity = on ? (0.8 + 0.2 * bloom).toFixed(3) : '0';
    el.logo.style.transform = `scale(${on ? (1.03 - 0.03 * bloom).toFixed(4) : 1})`;
    el.logo.style.filter = on ? `brightness(${(1.6 - 0.6 * bloom).toFixed(3)})` : '';
    el.sub.style.opacity = sm(LOGO_T + 1.2, LOGO_T + 2.4, T).toFixed(3);
    const end = T >= LOGO_T + 2.5;
    el.play.classList.toggle('on', end);
    root.classList.toggle('end', T >= LOGO_T);
  }

  // ---------- per frame ----------
  function update(dt) {
    try {
      game.state.phase = 'trailer';
      if (playing) {
        const prev = T;
        if (AUTO) T += dt;
        else T = Math.max(T, (performance.now() - wall0) / 1000);
        if (T - prev > 0.5) wall0 = performance.now() - (T = prev + dt) * 1000;   // tab was hidden
        const p = partAt(T);
        if (p !== cur) stage(p);
      } else if (!cur) seek(0);
      const lt = T - cur.shot.t;
      game.time.hour = cur.hour ?? cur.shot.hour;
      placeCamera(lt);
      run(lt);
      const kk = lightR.key || cur.key, rr = lightR.rim || cur.rim;
      if (kk) { key.position.set(kk[0], kk[1], kk[2]); key.intensity = kk[3] * (0.78 + 0.2 * wob(T * 3.1, 9) + 0.08 * Math.sin(T * 23) * Math.sin(T * 7.3)); } else key.intensity = 0;
      if (rr) { rim.position.set(rr[0], rr[1], rr[2]); rim.intensity = rr[3]; } else rim.intensity = 0;
      // hide the player's hands except for the gun beats
      if (vm) {
        vm.crowbar.visible = false;
        vm.pistol.visible = showGun;
        gunFlashT -= dt;
        if (vm.flash) { vm.flash.visible = showGun && gunFlashT > 0; if (vm.flash.visible) vm.flash.material.rotation = lt * 37; }
      }
      // fog: scale whatever atmos set for this hour
      const fog = game.scene.fog;
      if (fog) {
        if (fog.density !== fogSet) fogBase = fog.density;
        fogSet = fog.density = fogBase * fogMul;
      }
      if (playing) score?.update?.(T);
      overlay();
      game.time.t = T;              // grain, drizzle and flicker follow trailer time too
    } catch (e) {
      if (!update._w) { update._w = 1; console.error('[trailer]', e); }
    }
  }

  const api = {
    update, seek, play, skip,
    get t() { return T; },
    get playing() { return playing; },
    get shot() { return cur?.shot?.id; },
    length: LENGTH,
  };
  game.trailer = api;
  if (params.has('autoplay') || AUTO) play();
  return api;
}
