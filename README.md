# NEON MAYHEM

A free, fan-made, browser-playable open-world tribute inspired by Grand Theft Auto: Vice City (2002) — that sentence is the only place the original game is named; everything in this project is original work.

Cruise the neon-soaked streets of **Costa Rosa, 1986**: steal cars, outrun the police, race, deliver, rampage — or just drive the beachfront boulevard at night with the radio on.

<p align="center">
  <b><a href="https://pranshuparmar.github.io/neon-mayhem/">▶ PLAY NOW — free, in your browser</a></b>
</p>

📱 On phones and tablets, touch controls appear automatically: virtual stick on the left, context buttons on the right, and a top row for pause, mute, map, CRT filter (📺) and fullscreen (⛶). Starting the game enters fullscreen and asks to rotate to landscape.

**Play it locally:** serve this folder from any static host (GitHub Pages works as-is) or a local static server:

```
python3 -m http.server 8000
# open http://localhost:8000
```

No build step, no server code, no external requests, no accounts, no ads. Progress (cash + best runs) is saved in `localStorage` only.

## Features

- ~1 km² seeded procedural city — Ocean Strip, Centro Alto, Puerto Viejo, Las Colinas — identical on every visit
- Curving beach coastline, boardwalk, piers, a spinning ferris wheel, and an animated ocean under an automatic day/night cycle (starts at dusk, night ~30s in, then the sun rises again and it loops)
- Jackable traffic, pedestrians, parked cars — all simulated in a spawn bubble around the player
- Arcade driving with handbrake drifts; 5 vehicle archetypes with 3-stage damage (smoke → fire → boom)
- Lock-on shooting (aim assist, target cycling) with fists, pistol, SMG (drive-bys!), shotgun
- 0–5 star wanted system: tailing cruisers, rams, foot pursuits, roadblocks, spike strips — and a respray garage to clear the heat
- 9 arcade missions: street races, timed couriers, rampages
- 3 procedurally generated radio stations, all audio synthesized at runtime with the Web Audio API
- Touch controls for phones/tablets (landscape), minimap, CRT filter toggle

## Controls

| Input | On foot | In car |
|---|---|---|
| W A S D | Move | Throttle / steer / brake |
| Mouse | Camera | Camera |
| RMB / Tab | Aim (lock-on) | — |
| LMB | Fire | Fire (drive-by w/ SMG) |
| Q / E | Cycle lock target | Drive-by left/right |
| Space | — | Handbrake |
| F | Enter / jack car | Exit car |
| 1–4 | Weapon select | — |
| , / . | — | Radio station |
| Shift | Sprint | — |

`P` map & destination routing · `M` mute · `T` CRT filter · `H` hide control hints · `R` respawn/skip · `Esc` pause · `⛶` (bottom-right) fullscreen

The minimap is a heading-up radar that rotates with you — tap it to open the full map. The full map (`P`) shows a labelled legend, POI badges (H hospital, P police, S respray), weapon/health/armour pickups, and mission routes drawn along the streets — click anywhere to set a destination.

**Touch controls** follow the classic console-port layout: a floating stick under the left thumb (move / steer, full deflection sprints on foot), and a context-sensitive action cluster under the right thumb. Buttons appear only when they apply — ENTER near a car, AIM with a gun drawn, weapon-switch with more than one weapon, drive-by only when you're carrying the SMG. Driving is an explicit GAS / BRAKE / handbrake with an EXIT and radio switch. The radar sits bottom-left; a single PAUSE button is the only persistent chrome, and sound, CRT filter and fullscreen live in the pause menu.

**Take to the sky:** a helicopter waits on the beach helipad (yellow **H**, south end of the sand). Climb with `Space`, descend with `Shift`, tilt with `W/S`, yaw with `A/D`. There's also an **airport** with a runway along the southern edge of the island (the ✈ on the map) — a light plane is parked on the apron: `W` to throttle up the runway, `Space` to rotate and climb once you're fast, `A/D` to turn, `Shift` to dive. Bail out of either aircraft with `F` while airborne and a **parachute** opens — steer your descent with `WASD` and glide down.

The title screen is a live broadcast: the city simulates behind the menu with spectator camera cuts until you press start.

## Tech

Plain non-module scripts sharing globals, loaded in dependency order — runs from `file://` or any static host. Three.js r128 (MIT, see [THREE.LICENSE](THREE.LICENSE)) is vendored at `js/lib/three.min.js`. Instanced/merged geometry, distance fog, and a spawn/despawn bubble keep it at 60 fps on mid-range hardware. A scriptable test API is exposed at `GAME.test` for headless verification.

## Disclaimer

Fan-made tribute. Not affiliated with Rockstar Games or Take-Two Interactive. No original game assets used. All city names, brands, characters, and music in this project are invented; audio is synthesized at runtime.
