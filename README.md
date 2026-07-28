# NEON MAYHEM

> ⚠️ **Active development.** This is an evolving, work-in-progress project — features, balance, controls and the map change frequently, and you may hit rough edges or bugs. Feedback and issues are welcome.

A free, fan-made, browser-playable open-world tribute inspired by Grand Theft Auto: Vice City (2002). Everything in the project is original work — the sentence you just read is the only place the original game is named.

Cruise the neon-soaked streets of **Costa Rosa, 1986**: steal cars, outrun the police, race, deliver, rampage — or just drive the beachfront boulevard at night with the radio on.

<p align="center">
  <img src="media/social-card.png" alt="Neon Mayhem — a night drive down a neon-lit boulevard in Costa Rosa, 1986" width="600">
</p>

<p align="center">
  <b><a href="https://pranshuparmar.github.io/neon-mayhem/">▶ PLAY NOW — free, in your browser</a></b>
</p>

📱 On phones and tablets, touch controls appear automatically: a floating virtual stick on the left, a context-sensitive action cluster on the right, and a radar + PAUSE button along the top-left. Tap the radar to open the full map. Sound, CRT filter, time of day and fullscreen live in the pause menu. Starting the game enters fullscreen and asks you to rotate to landscape.

**Play it locally:** serve this folder from any static host (GitHub Pages works as-is) or a local static server:

```
python3 -m http.server 8000
# open http://localhost:8000
```

No build step, no server code, no accounts, no ads. Progress (cash + best runs) is saved in `localStorage` only. The only network request the game ever makes is an anonymous visit count (see [Analytics](#analytics)), and it is skipped entirely when you run it locally or offline.

## Features

- ~1 km² seeded procedural city — Ocean Strip, Centro Alto, Puerto Viejo, Las Colinas — identical on every visit
- Curving beach coastline, boardwalk, piers, a spinning ferris wheel, and an animated ocean under an automatic day/night cycle (starts on a bright late afternoon, slides into sunset and then night within the first minute, then the sun rises again and it loops)
- Jackable traffic, pedestrians, parked cars — all simulated in a spawn bubble around the player
- Arcade driving with handbrake drifts; cars, a motorcycle, van, taxi, ambulance and police cruiser, all with 3-stage damage (smoke → fire → boom)
- **25 unique stunt jumps** hidden around the city on roadside construction ramps in four sizes, a third of them fitted with a booster strip that slams the throttle open on the way up — clear one to log it (air time, distance and spins all pay out, and you can land on a low roof or sail clean over it). Find every one for a $50,000 payout, the full arsenal with unlimited ammo (kept through the hospital and the cells), and a monster truck that jumps on command
- Flyable helicopter and airplane — loops and barrel rolls included — with a beach helipad and an airport, plus a parachute when you bail out mid-air
- Lock-on shooting (aim assist, target cycling — people and vehicles) with fists, pistol, SMG (drive-bys!), shotgun
- 0–5 star wanted system: pursuing cruisers that open fire, foot pursuits (officers get out and shoot), roadblocks, spike strips — and a respray garage that repairs the car and clears the heat
- Arcade missions — street races against rival drivers (live position), timed couriers with freshly generated drops each run, rampages — plus continuous taxi and paramedic shifts that level up: more people (each marked by a floating arrow), further out, and an ambulance that fills up before it runs to the hospital
- Finish something worth finishing — a race, a shift, all 25 jumps — and a shareable result card is drawn for it: save it, copy it, or send it straight to your phone's share sheet
- 3 procedurally generated radio stations, all audio synthesized at runtime with the Web Audio API
- Touch controls for phones/tablets (landscape), minimap, CRT filter toggle

## Controls

| Input | On foot | In car |
|---|---|---|
| W A S D | Move | Throttle / steer / brake |
| Mouse | Camera | Camera |
| RMB / Tab | Aim (lock-on) | — |
| LMB | Fire | Fire (drive-by w/ SMG) |
| Q / E | Cycle lock target | Drive-by left/right (barrel roll in a plane) |
| Space | Jump | Handbrake |
| F | Enter / jack car | Exit car |
| 1–4 | Weapon select | — |
| , / . | — | Radio station |
| Shift | Sprint | — |

`P` map & destination routing · `M` mute · `T` CRT filter · `H` hide control hints · `R` respawn/skip · `Esc` pause · `⛶` fullscreen

The pause menu also holds a **TIME** toggle — `AUTO` (default) runs the day/night cycle, or pin it to `DAY` / `NIGHT`.

The minimap is a heading-up radar that rotates with you — tap it to open the full map. The full map (`P`) shows a labelled legend, POI badges (H hospital, P police, S respray), weapon/health/armour pickups, and mission routes drawn along the streets — click anywhere to set a destination.

**Touch controls** follow the classic console-port layout: a floating stick under the left thumb (move / steer, full deflection sprints on foot), and a context-sensitive action cluster under the right thumb. Buttons appear only when they apply — ENTER near a car, AIM with a gun drawn, weapon-switch with more than one weapon, drive-by only when you're carrying the SMG. Driving is an explicit GAS / BRAKE / handbrake with an EXIT and radio switch. The radar sits top-left (clear of the stick's thumb zone) with PAUSE beside it, and sound, CRT filter, time of day and fullscreen live in the pause menu.

**Take to the sky:** a helicopter waits on the beach helipad (yellow **H**, south end of the sand). Climb with `Space`, descend with `Shift`, tilt with `W/S`, yaw with `A/D`. There's also an **airport** with a runway along the southern edge of the island (the ✈ on the map) — a light plane is parked on the apron: `W` to throttle up the runway, `Space` to rotate and climb once you're fast, `A/D` to turn, `Shift` to dive, `Q/E` to barrel-roll — pull hard enough on the elevator and you can fly a full loop. Bail out of either aircraft with `F` while airborne and a **parachute** opens — steer your descent with `WASD` and glide down.

The title screen is a live broadcast: the city simulates behind the menu with spectator camera cuts until you press start.

## Tech

Plain non-module scripts sharing globals, loaded in dependency order — runs from `file://` or any static host. Three.js r128 (MIT, see [THREE.LICENSE](THREE.LICENSE)) is vendored at `js/lib/three.min.js`. Instanced/merged geometry, distance fog, and a spawn/despawn bubble keep it at 60 fps on mid-range hardware. A scriptable test API is exposed at `GAME.test` for headless verification.

## Analytics

The published site counts visits and a handful of anonymous events — session
started, a mission or shift finished, a stunt jump found, all 25 found, wanted
level reached, aircraft flown, result card saved or shared — via
[GoatCounter](https://www.goatcounter.com/): cookieless, no identifier stored in
the browser, and nothing about you kept. `js/analytics.js` is a thin wrapper
that silently no-ops when the counter is blocked or unavailable, so the game
never depends on it, and each event counts at most once per page load — the
interesting figures are per-visit ratios (started vs finished), not repeat
presses.

It is skipped entirely on `file://`, `localhost` and LAN addresses, so a local
or offline copy makes no network request at all and local play stays out of the
numbers. Nothing about this appears in the game itself.

## Disclaimer

Fan-made tribute. Not affiliated with Rockstar Games or Take-Two Interactive. No original game assets used. All city names, brands, characters, and music in this project are invented; audio is synthesized at runtime.
