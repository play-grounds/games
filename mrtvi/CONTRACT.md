# MRTVÍ — contract

A first-person zombie survival PoC in a post-collapse Prague. You are a courier: get the
medicine from the pharmacy (LÉKÁRNA) in Old Town and carry it across Charles Bridge, up
Nerudova, to the survivor camp in Prague Castle. Night is falling. The astronomical clock
still chimes every in-game hour, and every chime pulls the dead towards Old Town Square.

Tone: The Walking Dead — grey, quiet, dread, scarcity; humans are scared, the dead are slow
but many. No TWD names or characters. The dead are called *mrtví* ("the dead").

## Hard rules

- Everything is generated in code: no image, model, audio or font files. Canvas textures,
  procedural geometry, WebAudio synthesis.
- three.js r170 via the import map in `index.html` (`import * as THREE from 'three'`,
  addons under `three/addons/...`). No other libraries.
- ES modules under `src/`. Each module owns its own file(s); do not edit files you don't own.
  If you need something from another module, use only what this contract promises.
- Seeded randomness only: `rng(seed)` from `src/layout.js`. Never `Math.random()` for world
  content (it's fine for per-frame jitter like muzzle flash).
- Performance budget: 60 fps target on a laptop iGPU; < 400 draw calls in a typical street
  view; < 1.5M triangles. Merge static geometry (`mergeGeometries`) per material. Use
  `InstancedMesh` for anything repeated more than ~20 times.
- No `alert`/`confirm`/`prompt`. Never throw from `update()`.

## World

- 1 unit = 1 metre. Y up. **North is −Z**, east is +X.
- `src/layout.js` (owned by lead) is the single source of truth for coordinates: the
  terrain `heightAt(x, z)`, the river, street centrelines + widths, landmark positions,
  the pharmacy door, the castle gate, interior cell origin. Read it before building.
- The Vltava runs north–south between `RIVER.x0` and `RIVER.x1`. Old Town is east (+X),
  Malá Strana west (−X), the Castle on the hill far west. Charles Bridge crosses at z≈0.
- Streets in `STREETS` must stay clear (no colliders inside `width/2 - 0.5` of the
  centreline) so the route is always walkable. Wrecked cars and barricades may *narrow*
  streets but must leave ≥ 3 m clear.
- Interiors live in a separate cell far from the city (`INTERIOR` origin); doors teleport.

## The game object

`src/main.js` (lead) creates one `game` object and passes it to every module's `create(game)`:

```js
game = {
  THREE, scene, camera, renderer,
  layout,            // the src/layout.js module namespace
  collide,           // src/collide.js instance (see below)
  tex,               // result of textures.makeTextures(game)  (built first)
  audio,             // audio.create(game) — may be silent until first user gesture
  player, dead, hud, world, interior, atmos,  // filled in as modules are created
  time,              // { t: seconds since start, hour: 0..24 float, dt }
  interactables,     // array of { pos: Vector3, radius, label, enabled?:()=>bool, use: ()=>void }
  on(name, fn), emit(name, data),   // tiny event bus
  params,            // URLSearchParams of location.search
  R,                 // rng(1)
}
```

Create order: textures → audio → world → interior → atmos → player → dead → hud. Then the
loop calls `update(dt)` on world, interior, atmos, player, dead, hud (in that order),
then renders via `atmos.render()` (post-processing) — or `renderer.render` if atmos lacks it.

### Events (`game.emit(name, data)`)

| name | data | emitted by |
|---|---|---|
| `noise` | `{ x, z, radius }` — anything that makes sound the dead can hear | player, world, main |
| `chime` | `{ hour }` | main (on each in-game hour) |
| `playerHurt` | `{ dmg, from:{x,z} }` | dead |
| `playerDied` | `{}` | player |
| `deadKilled` | `{ x, z }` | dead |
| `teleport` | `{ to:'city'|'pharmacy', x, z, yaw }` | interior |
| `pickup` | `{ item }` | interior |
| `delivered` | `{}` | main |

## Module APIs

### `src/collide.js` (lead)
`game.collide`:
- `addBox(x, z, hx, hz, rot = 0, y0 = -10, y1 = 100)` — oriented box in XZ, rot = Y rotation (rad).
- `resolve(pos, r)` — push a circle at `pos.x,pos.z` radius `r` out of boxes (mutates pos). Only boxes whose y-range overlaps `pos.y .. pos.y+1.8` count.
- `raycast(origin, dir, maxDist)` → distance or `Infinity` (3D ray vs boxes).
- `walkable(x, z)` → bool (not inside a box, not in water unless on the bridge). Valid after `finalize()`.
- `finalize()` — called by main after world + interior are built; builds the nav grid.
- `grid` → `{ cell, x0, z0, nx, nz, data: Uint8Array }` (1 = walkable). Cell = 2 m.

### `src/textures.js` — `makeTextures(game)` → object of `THREE.Texture` (sRGB, repeat-wrapped, mipmapped)
Required keys: `plaster(i)` for i in 0..7 (function returning a façade texture variant: baroque
pastel plaster, 3 storeys of windows, some broken/boarded/scorched, grime streaks, occasional
graffiti/blood) — `facadeWide(i)` same but for wider buildings, `cobble`, `paving`, `asphalt`,
`stone` (bridge/tower sandstone, blackened), `roof` (red tiles, mossy), `slate`, `plank`,
`rust`, `wall` (castle render), `interiorWall`, `tiles` (pharmacy floor), `blood` (decal with
alpha), `poster(i)` (Czech evacuation notices: "EVAKUACE", "NEVYCHÁZEJTE", "KARANTÉNA"),
`sign_lekarna` (green cross + LÉKÁRNA), `clockFace` (Prague astronomical clock dial), `skin(i)`
for i 0..3 (rotten skin), `cloth(i)` for i 0..5 (dirty clothing). Each texture documents its
real-world size in metres as `tex.userData.metres = [w, h]` for UV scaling.

### `src/world.js` — `create(game)` → `{ update(dt), lamps: Vector3[], spawns: {x,z}[] }`
Builds terrain, river + water, embankments, Charles Bridge (statues, towers both ends),
Old Town Square with the Old Town Hall + astronomical clock tower and Týn church, street
blocks lining every street in `STREETS` (continuous façades, roofs, side alleys), the
pharmacy building whose door is at `layout.PHARMACY_DOOR`, Malá Strana square + St Nicholas
dome, Nerudova climbing to the Castle, the Castle walls + gate + courtyard camp (fires,
tents, barricades, 3 static survivor figures, one is the medic at `layout.MEDIC`), wrecked
cars, trams, barricades, debris, lamp posts (dead), abandoned stuff. Registers all colliders
via `game.collide.addBox`. `spawns` = suggested zombie spawn points (≥ 200, on walkable street
ground, none inside the castle walls). Exposes nothing else.

### `src/interior.js` — `create(game)` → `{ update(dt), inside: bool }`
The pharmacy interior at `layout.INTERIOR` (shelves, counter, broken glass, blood, dark,
torch-lit only by the player's flashlight). Pushes interactables: the street door (enter),
the interior door (exit), the medicine case (`emit('pickup',{item:'medicine'})`, sets
`game.state.hasMedicine = true`). Teleports by setting `game.player.teleport(x, z, yaw)` and
emits `teleport`. Provides `deadSpawns` (2–3 points inside) as `interior.spawns`.

### `src/atmos.js` — `create(game)` → `{ update(dt), render(), flash(intensity) }`
Sky (dusk→night by `game.time.hour`), sun/moon light, hemisphere light, fog (thick, grey-blue,
denser at night), post-processing via `EffectComposer`: bloom (fires, flashlight hotspots),
desaturated grade, vignette, film grain, low-health red pulse (reads `game.player.health`).
Light drizzle particles. Fires in the castle camp should flicker (world may expose fire
positions via `game.world.fires`). `flash()` for muzzle flashes. Handles resize.

### `src/player.js` — `create(game)` → see below
First-person controller: pointer lock on click; WASD, Shift sprint (stamina), C crouch (quiet),
Space jump-less vault (none — no jump), F flashlight (SpotLight attached to camera, default on
at night), 1 crowbar / 2 pistol, LMB attack, R reload, E interact (nearest enabled
interactable within its radius → `use()`). Height from `layout.heightAt` (+1.65 eye),
collision via `game.collide.resolve`. Footsteps emit `noise` (walk 8 m, sprint 20 m, crouch
3 m) and call `game.audio.footstep()`. Crowbar: 0.6 s swing, hits nearest dead in a 1.8 m cone
via `game.dead.meleeHit(origin, dir, range, dmg)`. Pistol: 12 rounds, 24 reserve, raycasts
`game.dead.raycast(origin, dir)` vs `game.collide.raycast`, emits `noise` radius 90, calls
`game.atmos.flash()`. Viewmodel: simple procedural crowbar / pistol meshes in front of the
camera (rendered as camera children). Health 100, regenerates nothing.
Exposes: `{ update(dt), pos: Vector3 (feet), yaw, pitch, health, stamina, noise (0..1 current
loudness), weapon, ammo, reserve, alive, flashlight, teleport(x,z,yaw), damage(n, from), locked }`.
Debug: `?at=x,z,yaw` start position; `?god`.

### `src/dead.js` — `create(game)` → see below
The dead: up to 300. Rendered as instanced body parts (torso, head, upper/lower arms, legs)
→ ≤ 12 draw calls total regardless of count. Each has a seeded look (height, skin, clothes,
missing jaw/arm, stoop). Shambling walk (arms half-raised, head lolling, dragging foot),
lunge attack, stagger on hit, death fall (stays down as a corpse, max 60 corpses).
AI: idle sway → wander → hear `noise` events within radius → investigate → see player
(30 m cone, 12 m at night without flashlight, 6 m if crouched behind) → chase at 2.2 m/s
(walk 0.7) → attack at 1.3 m (15 dmg, 1.2 s cooldown → `game.player.damage`). Pathing via a
flow field on `game.collide.grid` towards the player (recomputed ≤ 4 Hz), separation
between dead, `collide.resolve` per agent. Simulate full AI only within 120 m of the player;
farther ones freeze or move coarse. Spawns from `game.world.spawns` (+ `game.interior.spawns`);
a horde of 40 on Charles Bridge; on `chime`, everything within 250 m drifts to Old Town Square.
Groans via `game.audio.groan(x, z, intensity)` (throttled).
Exposes: `{ update(dt), count, alive, raycast(origin, dir, maxDist) → {dist, id}|null,
meleeHit(origin, dir, range, dmg) → bool, damage(id, dmg, dir), nearest(x,z) → dist }`.
Debug: `?nodead`, `?dead=N`.

### `src/audio.js` — `create(game)` → see below
WebAudio, all synthesised. `resume()` on first gesture (main calls it). Listener follows
camera (update reads `game.camera`). Methods: `footstep(surface='cobble', loud=0..1)`,
`groan(x, z, intensity)` (spatialised, varied, throaty, max 6 voices), `swing()`,
`hitFlesh()`, `gunshot()`, `dryFire()`, `reload()`, `chime(hour)` (bells of the astronomical
clock, heavy and distant, spatial from `layout.CLOCK`), `hurt()`, `heartbeat(rate)`,
`pickup()`, `door()`, `deliver()`, plus `update(dt)` running ambience: wind, distant
dogs, a far-off car alarm once, rain hiss, a low dread drone that rises with
`game.player.noise` and nearby dead count (`game.dead.nearest`).

### `src/hud.js` — `create(game)` → `{ update(dt), message(text, secs) }`
DOM overlay (one `<div id="hud">`): health + stamina bars, noise meter (eye icon / sound
waves), weapon + ammo, objective line, compass strip (N/E/S/W + objective marker), interaction
prompt ("E — Vstoupit / Enter"), crosshair, damage vignette direction, messages, title screen
("MRTVÍ — click to begin"), death screen ("Jsi mrtvý"), win screen. Czech first, English small
beneath. Style: worn, stencil-like, off-white on dark, no neon.

## Testing

- `npm run serve` serves on http://localhost:8741.
- `node test/smoke.mjs` boots the game headless with `?auto` (no pointer lock needed),
  steps frames via `window.game.step(n)`, teleports along the route, saves screenshots to
  `test/shots/`, and fails on any console error, a player under water, a blocked route,
  or zero dead.
- `window.game` is exposed for tests; `game.step(n, dt=1/60)` advances n frames manually.
- Module owners: test your module by loading the page and screenshotting with
  `node test/shot.mjs "<query>" out.png` (e.g. `"?at=150,10,0&nodead"`).
