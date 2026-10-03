# MRTVÍ

A first-person zombie survival PoC in post-collapse Prague. You're a courier: get the
medicine from the pharmacy on Celetná, carry it over Charles Bridge and up Nerudova to the
survivor camp in Prague Castle. Night is falling, and every hour the astronomical clock
chimes and draws the dead.

Everything is generated in code: textures, geometry, the dead, and all sound. There are no
asset files. three.js r170 is loaded from jsDelivr.

    npm run serve        # http://localhost:8741
    node test/smoke.mjs  # headless playthrough + world sanity checks

Controls: click to start · WASD · Shift sprint · C crouch · F flashlight · 1 crowbar / 2 pistol ·
LMB attack · R reload · E interact.

Debug: `?at=x,z,yaw` `?t=hour` `?god` `?nodead` `?dead=N` `?seed=N` `?auto`.
How it's put together: CONTRACT.md.
