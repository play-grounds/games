# MRTVÍ: the prompts

MRTVÍ started from Chris First's write-up of building *Fallout: New York* with an AI game studio (a lead agent, a written contract, builder, critic, reviser and verifier agents, and a smoke test as the gate). The question was whether a cut-down version of the same approach could make a different game. The prompts are recorded here verbatim.

---

> how hard to make a game like this? cut down version. different theme. PoC. dont go. https://www.patreon.com/ChrisFirst/posts/how-i-made-new-170834668

> yes post collapse prague, delivery day, zombie appocalypse, inspired by walking dead. thoughts? dont go.

The pitch that came back and was agreed: you are a courier in a dead Prague, as in *Delivery Day*, running supplies between walled survivor camps. One delivery for the PoC: medicine from a pharmacy in Old Town, over Charles Bridge, up Nerudova to the camp in Prague Castle. The astronomical clock still chimes every hour and the noise draws the dead. Noise matters, guns are loud, melee comes first, other survivors are scared. No Walking Dead names: the dead are *mrtví*.

> go, first person, 2-4 hour tier ... keep going, plough through, spawn copious sub agents as necessary ...

---

## How it was built

- **Contract first.** `CONTRACT.md` fixes the world (1 unit = 1 m, north is −Z), the `game` object, the events, and each module's API and budget. `src/layout.js` holds every coordinate: the river, the bridge, street centrelines that must stay clear, landmarks, the pharmacy door, the castle gate. Nothing is downloaded: textures, geometry, the dead and all sound are generated in code.
- **Eight builders in parallel,** one file each: textures, world, the dead, player, atmosphere and post-processing, audio, HUD, and the pharmacy interior. `main.js` stubs any missing module, so each builder could test alone.
- **A smoke test as the gate.** It boots headless, checks the player starts dry, that every route point is walkable and connected from the start to the medic, that nothing hangs over the route, then plays the delivery end to end: enter the pharmacy, take the case, leave, hand it over, win.
- **Two critics, five revisers.** A visual critic scored the first build 6/10 for Prague, 3/10 for readability at night; a gameplay critic scored fairness 3/10 because the bridge horde was impassable. Revisers fixed the flashlight, the crowbar (it looked like a candy cane), the cobbles, the clock tower, the gates, St Vitus, the camp, and the dead: horde clusters with lanes, at most two attackers at once, some runners, fair respawns. A bot then reached the castle on 5 of 5 seeds without god mode, losing 75–90 health.

## Follow-up passes

> how hard would it be to make a trailer for the game you could play from the browser?

> go, no need to export it yet

An 80-second trailer rendered live in the engine at `?trailer`: a shot list with title cards and music cues (`src/trailer/timeline.js`), a director module that stages the dead, the chime and the camera for each shot, and a synthesised score that follows the cues. It ends on HRÁT / PLAY.

> can you add the ogp stuff and then do the criteic, but looks great ... also think of a repo name uncer playground for this

Open Graph and Twitter tags, a share image rendered from the trailer's river shot, and a trailer critic. Its first scores were hook 4/10 and readability 4/10, because the dead were barely visible for the first 50 seconds. The director and composer reworked the opening, the square, the bridge, the clock and the title in one round.

> ship it

Published here as `games/mrtvi/`.

## Adversarial rounds

> keep the trailer. do one round of adversarial critics in sub agents. and do improvements, but dont ship.

> after this is all done, do another 2 passes, and then report the score increases.

Five adversarial critics (a bug hunter, a harsh first-time player, an art director, a performance reviewer, an audio and game-feel critic) tried to break the game, then per-file revisers fixed what they found, three times over, with the trailer guarded by its own test. Scores on the same scales, first round → final:

| Critic | Baseline | Final |
|---|---|---|
| Art (characters, environment, lighting, first person, cohesion) | 4 · 6.5 · 6 · 4 · 6 | 6 · 7.5 · 6.5 · 5.5 · 6.5 |
| Player (clarity, tension, combat, stealth, pacing, replay) | 7 · 6 · 4 · 3 · 4 · 2 | 7 · 7 · 5 · 5 · 5 · 3 |
| Audio and feel (design, mix, spatial, combat, movement) | 7 · 3 · 6 · 4 · 3 | 7 · 6 · 6 · 6 · 6 |
| Stability, performance, robustness | 10 bugs · ~4 · ~5 | 8 · 8 · 6 (a gate lock-out, fixed before release) |
| Bot deliveries, walked runs | 0/10 | 17/35 |

Along the way: 633k → 34k triangles in the start view, 16 → 8 constant lights, a 3.2 s shader stall gone, pause on lost pointer lock, pickups and healing, stealth kills, a late chase up Nerudova, a rebalanced synthesised mix.

> go, ship
