# Siegeworks: the original prompt

Siegeworks was built from a single prompt (working title "Fable Kingdom"), followed by a few short passes: a sound pass, a mobile pass, and publishing under this repo. The prompt is recorded here verbatim.

---

Build "Fable Kingdom" a voxel diorama of a medieval capital city under siege as a single self-contained HTML file using Three.js from a pinned CDN, opening directly in Chrome with no build step and no external assets.

Scale: place at least 500,000 voxels. The city sits at the center of a gigantic landscape: a snow capped mountain range on one side, a wide river with a stone bridge and mill wheels cutting through the flatlands, farmland with hedgerows, a forest, a lake, and a road network leading to the main gate. Generate the terrain procedurally from a seed I can set. Use greedy meshing or chunked instanced geometry so the whole thing holds 60fps on a laptop GPU, with frustum culling and LOD for distant chunks.

Palette: earthy medieval tones grey and sand stone, dark oak timber, red clay and slate roofs, thatch gold, moss green, iron black, with heraldic banner colors (deep crimson and royal blue) as accents. No neon.

The city: concentric stone walls with towers, a gatehouse with a working portcullis and drawbridge, a keep on high ground, a cathedral, a market square, taverns, a blacksmith with a glowing forge, docks on the river, and hundreds of houses with varied rooflines. Interiors are lit at night through windows.

Life inside: hundreds of NPCs with daily routines merchants open stalls, farmers bring carts through the gate, guards patrol the walls, children run through alleys, priests ring bells on the hour. A day/night cycle with torches lighting up at dusk. Smoke rises from chimneys. Horse carts and ox wagons move on the roads, rowboats and a merchant cog move on the river.

The siege: an enemy army advances across the flatlands in formations infantry with shields, cavalry, siege towers, battering rams, trebuchets, and catapults. Flying units: griffin riders and a small wyvern dive at the walls. Wall archers and ballistae shoot back with real projectile arcs; hits knock soldiers down, and flaming arrows ignite siege towers. Trebuchet and catapult impacts do real damage to the environment: wall sections fracture and collapse voxel by voxel with rigid-body physics, towers crumble, roofs cave in, debris rolls downhill, and craters form in the terrain. When a wall breach opens, enemy infantry pours through and city guards rush to plug it. NPCs react they flee to the keep, doors slam, market stalls empty.

Interaction: orbit/zoom/pan camera; click any soldier, NPC, or vehicle to follow it; hover a building to see it slice open and reveal the interior; a control panel with time-of-day, army size, siege intensity, and weather (rain, fog, snow) sliders; a "God" mode where I can drop a boulder anywhere and watch the physics; press B to trigger a full wall breach at the gatehouse; press D to summon a dragon that strafes the battlefield with fire, setting thatch roofs and siege engines ablaze. Spacebar cycles four cinematic camera paths that auto-dolly across the battle.

Make it read as a showcase: a small on-screen HUD showing live voxel count, FPS, active NPCs, and projectiles in flight. Structure the code with a clear config block at the top for seed, voxel budget, palette, unit counts, and physics settings, and comment the systems so I can tune them.

---

## Follow-up passes

- **Sound pass:** "the chimes are a bit loud and overbearing perhaps?" Led to a master volume slider, a softer bell with fewer tolls, and distance attenuation.
- **Naming and publishing:** brainstormed 100 names, chose Siegeworks, moved into `play-grounds/games` with an index page and Open Graph metadata.
- **Mobile pass:** "it works great on desktop but harder on mobile." Added touch controls, a compact layout with an on-screen action bar, lighter render defaults, and an audio unlock fix for phones.
