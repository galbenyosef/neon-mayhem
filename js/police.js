GAME.police = (function () {
  var heat = 0, lastSeen = 0, pinTimer = 0, grabTimer = 0, lastCrime = -99;
  var crimeCooldown = {};
  var roadblockT = 0, spikes = [];
  var THRESH = [0, 50, 120, 210, 320, 440];
  var CAR_CAP = [0, 1, 2, 3, 4, 6];

  function stars() {
    var s = 0;
    for (var i = 5; i >= 1; i--) { if (heat >= THRESH[i]) { s = i; break; } }
    return s;
  }

  var CRIME_HEAT = { hit_ped: 20, kill_ped: 70, jack: 58, shoot_car: 18, hit_car: 5, kill_cop: 170, steal_police: 75, hit_cop_car: 26 };
  // crimes that always draw heat even unwitnessed (attacking the law, loud gunfire)
  var ALWAYS = { kill_cop: 1, steal_police: 1 };
  // deaths count per victim — mowing down a crowd shouldn't dedupe to one crime
  var PER_VICTIM = { kill_ped: 1, kill_cop: 1 };

  // a crime only raises the alarm if a cop (any range, LOS) or a civilian
  // (close, LOS) actually sees it — bumping a fender in an empty street is free
  function witnessed(pos) {
    var peds = GAME.world.peds;
    for (var i = 0; i < peds.length; i++) {
      var p = peds[i];
      if (p.dead) continue;
      var range = p.isCop ? 95 : 32;
      if (U.dist2(p.pos.x, p.pos.z, pos.x, pos.z) < range * range &&
        GAME.city.hash.segmentClear(p.pos.x, p.pos.z, pos.x, pos.z)) return true;
    }
    return false;
  }

  var lastCopKillT = -99;
  function reportCrime(type, pos) {
    // dead men draw no stars: while the wasted/busted screen is up nothing
    // the world does — a rammed cruiser cooking off, a fire spreading — can
    // hang new heat on the player
    if (GAME.player.state !== 'alive') return;
    var now = GAME.time;
    if (!PER_VICTIM[type] && crimeCooldown[type] && now - crimeCooldown[type] < 1.2) return;
    if (!ALWAYS[type] && !witnessed(pos)) return; // nobody saw it
    crimeCooldown[type] = now;
    lastCrime = now;
    var before = stars();
    // offending while already wanted escalates faster — the response ramps up
    var gain = (CRIME_HEAT[type] || 20) * (1 + before * 0.22);
    if (type === 'kill_cop') {
      // a burst of cop kills is ONE firefight, not a ladder to five stars:
      // two officers stepping into your bumper used to jump 1 -> 5 in a
      // second. Kills inside the same eight seconds barely add heat; the
      // floor still guarantees three stars for killing the law.
      if (now - lastCopKillT < 8) gain = 26;
      lastCopKillT = now;
    }
    heat = Math.min(560, heat + gain);
    if (type === 'kill_cop') heat = Math.max(heat, THRESH[3] + 10);
    if (type === 'steal_police') heat = Math.max(heat, THRESH[1] + 5);
    // and no single offence moves the needle more than one star past where
    // you stood (except that cop-kill floor) — five stars are EARNED
    var capStar = Math.max(type === 'kill_cop' ? 3 : 0, Math.min(5, before + 1));
    if (capStar < 5) heat = Math.min(heat, THRESH[capStar + 1] - 8);
    lastSeen = 0;
    var after = stars();
    if (after > before) { GAME.hud.wantedChanged(after); if (after >= 3) GAME.track('wanted-' + after); }
  }

  function noteGunfire(pos) {
    if (GAME.player.state !== 'alive') return;   // see reportCrime
    var now = GAME.time;
    if (crimeCooldown.gunfire && now - crimeCooldown.gunfire < 2.5) return;
    // public gunfire: anyone nearby to hear it
    var heard = false;
    var peds = GAME.world.peds;
    for (var i = 0; i < peds.length; i++) {
      if (!peds[i].dead && U.dist2(peds[i].pos.x, peds[i].pos.z, pos.x, pos.z) < 1600) { heard = true; break; }
    }
    if (!heard) return;
    crimeCooldown.gunfire = now;
    lastCrime = now;
    var before = stars();
    heat = Math.max(heat + 14 * (1 + before * 0.22), THRESH[1] + 5);
    heat = Math.min(560, heat);
    lastSeen = 0;
    if (stars() > before) GAME.hud.wantedChanged(stars());
  }

  function setWanted(n) {
    n = U.clamp(Math.floor(n), 0, 5);
    heat = n === 0 ? 0 : THRESH[n] + 25;
    // treat it like a fresh offence so the level doesn't bleed away instantly
    if (n > 0) lastCrime = GAME.time;
    GAME.hud.wantedChanged(n);
    if (n === 0) clearCops();
  }

  function clearWanted() { setWanted(0); }

  function clearCops() {
    // Stand down, don't vanish: a cruiser deleted mid-frame in front of the
    // player reads as a magic trick. Pursuers turn back into ordinary
    // traffic and drive off; officers on foot holster up and walk away as
    // civilians — the regular distance cleanup collects them all off-screen.
    var cars = GAME.world.cars;
    for (var i = cars.length - 1; i >= 0; i--) {
      var c = cars[i];
      var pursuing = c.ai && (c.ai.mode === 'chase' || c.ai.mode === 'roadblock');
      if (c.isPolice && !c.dead && pursuing && c !== GAME.player.car) {
        c.ai = { mode: 'traffic', desired: 11, laneX: 0, laneZ: 0 };
      }
    }
    var peds = GAME.world.peds;
    for (var j = peds.length - 1; j >= 0; j--) {
      var p = peds[j];
      if (p.isCop && !p.dead) {
        p.isCop = false;               // released from police.js's control
        p.temper = 0;                  // and not looking for a rematch
        p.aimPose = false;
        p.state = 'flee';
        p.fleeT = 8;
        p.fleeX = GAME.player.pos.x; p.fleeZ = GAME.player.pos.z;
      }
    }
    clearSpikes();
    pinTimer = 0;
  }

  function clearSpikes() {
    for (var i = 0; i < spikes.length; i++) { GAME.scene.remove(spikes[i].mesh); disposeTree(spikes[i].mesh); }
    spikes = [];
  }

  function copCars() {
    return GAME.world.cars.filter(function (c) { return c.isPolice && !c.dead && c.ai && (c.ai.mode === 'chase' || c.ai.mode === 'roadblock'); });
  }

  // ---------- the air unit ----------
  // The chopper is the top of the response ladder: it lifts off at 4-5
  // stars. Restricted airspace runs a three-strike ladder (see aircraft.js):
  // two warnings first, and the THIRD violation is the 5-star response,
  // birds up and firing.
  var airUnits = [];
  function airspaceStrike() {
    if (stars() < 5) {
      setWanted(5);
      GAME.hud.message('RESTRICTED AIRSPACE VIOLATION — air units scrambled.', 3);
    } else setWanted(5);   // keep the heat pegged while the line is pressed
  }
  function spawnAirUnit() {
    var f = GAME.focus();
    var a = Math.random() * Math.PI * 2;
    var h = GAME.vehicles.spawnCar('helicopter', f.x + Math.cos(a) * 120, f.z + Math.sin(a) * 120, 0, { color: 0x24365e });
    if (!h) return;
    h.aiAir = true; h.isPolice = true;
    h.ai = { mode: 'air' };
    // "I was getting shot at but couldn't see police helicopters anywhere" —
    // a near-black airframe hanging behind and above the player at night was
    // invisible. The unit now announces itself the way a police bird does:
    // a searchlight cone reaching down toward the target, and red/blue
    // strobes. Both ride the mesh, so they move, blink and die with it.
    var beam = new THREE.Mesh(
      new THREE.ConeGeometry(7, 26, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.15, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    beam.position.set(0, -12.6, 1.6);   // apex under the chin, cone reaching down
    beam.rotation.x = -0.12;            // leant toward whatever the nose points at
    h.mesh.add(beam);
    var strobeR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.5), new THREE.MeshBasicMaterial({ color: 0xff2030 }));
    strobeR.position.set(-0.9, 2.3, -0.6);
    var strobeB = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.5), new THREE.MeshBasicMaterial({ color: 0x2050ff }));
    strobeB.position.set(0.9, 2.3, -0.6);
    var strobeT = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), new THREE.MeshBasicMaterial({ color: 0xff2030 }));
    strobeT.position.set(0, 1.9, -5.1);   // tail beacon
    h.mesh.add(strobeR); h.mesh.add(strobeB); h.mesh.add(strobeT);
    h.airLights = [strobeR, strobeB, strobeT];
    var P = GAME.player;
    var fy = P.inCar && P.car ? P.car.pos.y : P.pos.y;
    h.pos.y = Math.max(GAME.city.surfaceY(h.pos.x, h.pos.z), fy) + 34;
    airUnits.push(h);
  }
  function updateAirUnits(dt, s) {
    var P = GAME.player;
    var want = s >= 5 ? 2 : s >= 4 ? 1 : 0;
    airUnits = airUnits.filter(function (h) { return !h.dead && GAME.world.cars.indexOf(h) >= 0; });
    if (airUnits.length < want && GAME.frame % 90 === 0) spawnAirUnit();
    var f = GAME.focus();
    var fy = P.inCar && P.car ? P.car.pos.y : P.pos.y;
    for (var i = airUnits.length - 1; i >= 0; i--) {
      var h = airUnits[i];
      var leaving = i >= want;
      var dx = f.x - h.pos.x, dz = f.z - h.pos.z;
      var d = Math.sqrt(dx * dx + dz * dz) || 1;
      // hold station ~20m off the target; a spare or dismissed bird flies out
      var spd = leaving ? 26 : U.clamp((d - 20) * 0.8, 0, 38);
      var sgn = leaving ? -1 : 1;
      h.pos.x += sgn * (dx / d) * spd * dt;
      h.pos.z += sgn * (dz / d) * spd * dt;
      h.heading = Math.atan2(dx, dz);
      var targetY = Math.max(GAME.city.surfaceY(h.pos.x, h.pos.z) + 22, fy + (leaving ? 42 : 16));
      h.pos.y = U.damp(h.pos.y, targetY, 1.4, dt);
      h.mesh.rotation.set(spd > 4 && !leaving ? -0.12 : 0, h.heading, 0);
      // strobes: the same two-phase flash the cruisers run
      if (h.airLights) {
        var phase = (GAME.time * 8 | 0) % 2 === 0;
        h.airLights[0].visible = phase;
        h.airLights[1].visible = !phase;
        h.airLights[2].visible = phase;
      }
      if (leaving) {
        if (d > 240) { GAME.vehicles.removeCar(h); airUnits.splice(i, 1); }
        continue;
      }
      if (s >= 4) {
        h.fireT = (h.fireT || 0) - dt;
        if (d < 85 && h.fireT <= 0) {
          h.fireT = 1.35;
          GAME.audio.gunshot('smg', h.pos.x, h.pos.z);
          // a fast target is hard to hit from a hovering doorway — and a
          // runner on foot gets suppressing fire, not a firing squad (the
          // sprint to a parked getaway plane must stay survivable)
          var onFoot = !(P.inCar && P.car);
          var mspd = onFoot ? (P.moveSpeed || 0) : Math.abs(P.car.speed);
          var hit = Math.random() < U.clamp(0.5 - mspd * 0.018, 0.1, 0.5) * (onFoot ? 0.5 : 1);
          var ix = f.x + (Math.random() - 0.5) * (hit ? 1.2 : 8);
          var iz = f.z + (Math.random() - 0.5) * (hit ? 1.2 : 8);
          // the fire visibly comes FROM the bird: muzzle flash at the door
          // gun and a tracer down to the impact, so getting shot at is never
          // a mystery even when the airframe itself is behind the camera
          GAME.fx.flash(h.pos.x, h.pos.y - 0.6, h.pos.z, 1.2);
          GAME.fx.tracer(h.pos.x, h.pos.y - 0.8, h.pos.z, ix, fy + 0.5, iz);
          GAME.fx.spawn(ix, fy + 0.4, iz, { count: 6, color: 0xffe0a0, spread: 1.2, life: 0.3 });
          if (hit) {
            if (P.inCar && P.car) GAME.vehicles.damageCar(P.car, 4, 'shot');
            else GAME.playerDamage(3, 'shot');
          }
        }
      }
    }
  }

  function spawnCruiser() {
    var P = GAME.player;
    var px = P.inCar && P.car ? P.car.pos.x : P.pos.x;
    var pz = P.inCar && P.car ? P.car.pos.z : P.pos.z;
    for (var tries = 0; tries < 6; tries++) {
      var a = Math.random() * Math.PI * 2;
      var r = U.randRange(Math.random, 130, 190);
      var rp = GAME.city.nearestRoadPoint(px + Math.cos(a) * r, pz + Math.sin(a) * r);
      // island road points come back with axis 'net' and live far outside the
      // mainland box — the same convention traffic already honors. Without it
      // Isla Verde had no pursuit below air-unit stars: nothing ever spawned,
      // nothing ever saw you, and the heat quietly erased itself.
      var onIsla = rp.axis === 'net';
      if (!onIsla && (rp.x < -480 || rp.x > 352 || Math.abs(rp.z) > 480)) continue;
      // the candidate ring is 130-190 m out, but mid-channel the nearest
      // ROAD to a candidate can be a distant shore — a cruiser spawned there
      // was culled by the 260 m rule the next frame, a spawn into the void
      if (U.dist2(rp.x, rp.z, px, pz) > 230 * 230) continue;
      var clear = true;
      for (var c = 0; c < GAME.world.cars.length; c++) {
        if (U.dist2(GAME.world.cars[c].pos.x, GAME.world.cars[c].pos.z, rp.x, rp.z) < 80) { clear = false; break; }
      }
      if (!clear) continue;
      var heading = Math.atan2(px - rp.x, pz - rp.z);
      var car = GAME.vehicles.spawnCar('police', rp.x, rp.z, heading, { occupied: 'ai', ai: { mode: 'chase' } });
      car.copsOut = 0;
      car.shootT = U.randRange(Math.random, 0.6, 1.6);
      return car;
    }
    return null;
  }

  function spawnFootCop(x, z) {
    var cop = GAME.peds.spawnPed(x, z, { cop: true });
    cop.state = 'chase';
    return cop;
  }

  // at 2+ stars officers close in on foot too, appearing from nearby streets
  var footSpawnT = 0;
  function maintainFootCops(s, dt) {
    if (s < 2) return;
    footSpawnT -= dt;
    if (footSpawnT > 0) return;
    footSpawnT = U.randRange(Math.random, 1.6, 3.2);
    var footCount = 0;
    for (var i = 0; i < GAME.world.peds.length; i++) if (GAME.world.peds[i].isCop && !GAME.world.peds[i].dead) footCount++;
    if (footCount >= Math.min(1 + s, 6)) return;
    var f = GAME.focus();
    for (var t = 0; t < 8; t++) {
      var a = Math.random() * Math.PI * 2, r = U.randRange(Math.random, 26, 48);
      var rp = GAME.city.nearestRoadPoint(f.x + Math.cos(a) * r, f.z + Math.sin(a) * r);
      // same island-aware bounds as the cruisers above
      if (rp.axis !== 'net' && (rp.x < -470 || rp.x > 352 || Math.abs(rp.z) > 470)) continue;
      if (GAME.city.isInWater(rp.x, rp.z)) continue;
      // near-ring candidates (26-48 m) can also resolve to a distant shore
      // mid-channel — an officer materializing 300 m away serves nobody
      if (U.dist2(rp.x, rp.z, f.x, f.z) < 22 * 22 || U.dist2(rp.x, rp.z, f.x, f.z) > 80 * 80) continue;
      spawnFootCop(rp.x, rp.z);
      return;
    }
  }

  function chaseControls(car, dt, s) {
    var P = GAME.player;
    var pxr = P.inCar && P.car ? P.car.pos.x : P.pos.x;
    var pzr = P.inCar && P.car ? P.car.pos.z : P.pos.z;
    // a modest lead on a moving target — enough to cut a corner, not clairvoyant
    var aimX = pxr + (P.inCar && P.car ? (P.car.vx || 0) * 0.3 : 0);
    var aimZ = pzr + (P.inCar && P.car ? (P.car.vz || 0) * 0.3 : 0);
    // reaction lag: pursue a smoothed estimate of the target, so cruisers don't
    // mirror sharp turns the instant you make them
    if (car.aiTX === undefined) { car.aiTX = aimX; car.aiTZ = aimZ; }
    car.aiTX = U.damp(car.aiTX, aimX, 4.5, dt);
    car.aiTZ = U.damp(car.aiTZ, aimZ, 4.5, dt);
    var dx = car.aiTX - car.pos.x, dz = car.aiTZ - car.pos.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    var targetH = Math.atan2(dx, dz);
    var dh = U.wrapPI(targetH - car.heading);

    // unstick: reverse out when wedged
    if (Math.abs(car.speed) < 1.2 && dist > 6) car.unstickT += dt; else car.unstickT = 0;
    if (car.unstickT > 1.4) { car.reverseT = 1.0; car.unstickT = 0; }
    if (car.reverseT > 0) {
      car.reverseT -= dt;
      return { throttle: -1, steer: dh > 0 ? -1 : 1, handbrake: false };
    }

    // gentler steering, eased frame-to-frame (no instant snap to your heading)
    var rawSteer = U.clamp(dh * 1.5, -1, 1);
    car.aiSteer = U.lerp(car.aiSteer || 0, rawSteer, Math.min(1, dt * 5));
    var steer = car.aiSteer;

    // pull up and stop near an on-foot target so officers can get out
    if (!P.inCar && dist < 22) return { throttle: car.speed > 2 ? -0.7 : 0, steer: steer, handbrake: dist < 12 };

    // keep a pursuit gap rather than gluing to the bumper
    var gap = s === 1 ? 22 : 9;
    var throttle;
    if (dist > gap + 6) throttle = 1;
    else if (dist > gap) throttle = 0.55;
    else if (dist > gap - 4) throttle = 0.1;
    else throttle = -0.35; // too close — ease back
    // can't corner flat out: lift or brake for hard turns at speed
    if (Math.abs(dh) > 0.7 && car.speed > 16) throttle = Math.min(throttle, -0.2);
    else if (Math.abs(dh) > 0.4 && car.speed > 24) throttle = Math.min(throttle, 0.2);
    return { throttle: throttle, steer: steer, handbrake: false };
  }

  function updateCopCar(car, dt, s) {
    var P = GAME.player;
    if (car.ai.mode === 'roadblock') {
      var px = P.inCar && P.car ? P.car.pos.x : P.pos.x;
      var pz = P.inCar && P.car ? P.car.pos.z : P.pos.z;
      if (U.dist2(car.pos.x, car.pos.z, px, pz) < 33 * 33) {
        car.ai.mode = 'chase';
        car.occupied = 'ai';
      }
      return;
    }
    car.controls = chaseControls(car, dt, s);

    // occupant fires from the car at 2 stars and up
    if (s >= 2 && !GAME.godMode) {
      car.shootT -= dt;
      if (car.shootT <= 0) {
        var px2 = P.inCar && P.car ? P.car.pos.x : P.pos.x;
        var pz2 = P.inCar && P.car ? P.car.pos.z : P.pos.z;
        var py2 = P.inCar && P.car ? P.car.pos.y : P.pos.y;
        var d2 = U.dist2(car.pos.x, car.pos.z, px2, pz2);
        // no shooting at someone a storey above or below you
        if (d2 < 40 * 40 && Math.abs(py2 - car.pos.y) < 3
            && GAME.city.hash.segmentClear(car.pos.x, car.pos.z, px2, pz2)) {
          GAME.combat.npcShoot(car.pos.x, 1.3, car.pos.z, 0.25 + s * 0.07, 5 + s * 1.5);
        }
        car.shootT = U.randRange(Math.random, 1.1, 2.2) / Math.max(1, s * 0.5);
      }
    }

    // officers bail out to engage on foot: when the player is out of their
    // car, or when the player's car is cornered (stopped)
    var onFoot = !P.inCar;
    var cornered = P.inCar && P.car && Math.abs(P.car.speed) < 3.5;
    if ((onFoot || cornered) && car.copsOut < 2 && Math.abs(car.speed) < 8) {
      var f = GAME.focus();
      var d = U.dist(car.pos.x, car.pos.z, f.x, f.z);
      if (d < (onFoot ? 26 : 18)) {
        var footCount = GAME.world.peds.filter(function (p) { return p.isCop && !p.dead; }).length;
        if (footCount < Math.min(2 + s, 7) && (car.deployT = (car.deployT || 0) + dt) > 0.5) {
          car.deployT = 0;
          var side = car.heading + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
          spawnFootCop(car.pos.x + Math.sin(side) * 1.8, car.pos.z + Math.cos(side) * 1.8);
          car.copsOut++;
        }
      }
    }
  }

  function updateFootCop(cop, dt, s) {
    var P = GAME.player;
    // track wherever the player actually is (their car when driving)
    var f = GAME.focus();
    var dx = f.x - cop.pos.x, dz = f.z - cop.pos.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    // officers on foot give up on a target that's flown out of reach
    var alt = (P.inCar && P.car && (P.car.spec.heli || P.car.spec.plane))
      ? P.car.pos.y - GAME.city.groundY(P.car.pos.x, P.car.pos.z) : 0;
    if (s === 0 || dist > 120 || alt > 26) {
      GAME.peds.removePed(cop);
      return;
    }
    var th = Math.atan2(dx, dz);
    cop.heading = U.angleLerp(cop.heading, th, Math.min(1, dt * 6));
    // fire at the player on foot, or at a slow/stopped car
    var playerSlow = !P.inCar || (P.car && Math.abs(P.car.speed) < 9);
    var los = GAME.city.hash.segmentClear(cop.pos.x, cop.pos.z, f.x, f.z)
      && Math.abs(f.y - cop.pos.y) < 3;   // not through a floor
    var wantShoot = s >= 2 && dist < 28 && playerSlow && los;
    var chaseSpeed = 6.8;   // 0.85x the player's 8 sprint — outrunnable, barely
    cop.speed = U.damp(cop.speed, wantShoot && dist < 14 ? 0 : chaseSpeed, 5, dt);
    cop.pos.x += Math.sin(cop.heading) * cop.speed * dt;
    cop.pos.z += Math.cos(cop.heading) * cop.speed * dt;
    var rp = GAME.resolveCircle(cop.pos.x, cop.pos.z, 0.4);
    cop.pos.x = rp.x; cop.pos.z = rp.z;
    cop.pos.y = GAME.city.groundY(cop.pos.x, cop.pos.z);
    cop.mesh.rotation.y = cop.heading;
    // reuse walk animation
    cop.walkPhase += cop.speed * dt * 2.2;
    var j = cop.mesh.userData.joints;
    var sw = Math.sin(cop.walkPhase) * Math.min(1, cop.speed / 2.2) * 0.7;
    j.legL.rotation.x = sw; j.legR.rotation.x = -sw;
    if (wantShoot) {
      j.armR.rotation.x = -Math.PI / 2;
      cop.shootT -= dt;
      if (cop.shootT <= 0) {
        GAME.combat.npcShoot(cop.pos.x, 1.35, cop.pos.z, 0.3 + s * 0.06, 5 + s);
        cop.shootT = U.randRange(Math.random, 0.9, 1.8);
      }
    } else {
      j.armL.rotation.x = -sw * 0.8; j.armR.rotation.x = sw * 0.8;
    }
    // a cop can only cuff you if you're on foot and not sprinting away
    if (!P.inCar && dist < 1.7 && Math.abs(f.y - cop.pos.y) < 3 && s <= 3 && P.moveSpeed < 3.4) cop.grabbing = true;
  }

  function placeRoadblock(s) {
    var P = GAME.player;
    if (!P.inCar || !P.car) return;
    var vx = P.car.vx || 0, vz = P.car.vz || 0;
    var sp = U.len(vx, vz);
    if (sp < 6) return;
    var ahead = 110 + Math.random() * 50;
    var nx = P.car.pos.x + vx / sp * ahead, nz = P.car.pos.z + vz / sp * ahead;
    var node = GAME.city.nearestNode(nx, nz);
    if (!node || U.dist2(node.x, node.z, P.car.pos.x, P.car.pos.z) < 70 * 70) return;
    var perp = Math.atan2(vx, vz) + Math.PI / 2;
    for (var k = -1; k <= 1; k += 2) {
      var cx = node.x + Math.sin(perp) * 2.6 * k, cz = node.z + Math.cos(perp) * 2.6 * k;
      var car = GAME.vehicles.spawnCar('police', cx, cz, perp, { occupied: 'ai', ai: { mode: 'roadblock' } });
      car.copsOut = 2;
      car.shootT = 1;
    }
    spawnFootCop(node.x + Math.sin(perp) * 8, node.z + Math.cos(perp) * 8);
    if (s >= 4) {
      var toward = Math.atan2(P.car.pos.x - node.x, P.car.pos.z - node.z);
      var sx = node.x + Math.sin(toward) * 10, sz = node.z + Math.cos(toward) * 10;
      var mesh = new THREE.Mesh(new THREE.BoxGeometry(11, 0.12, 0.9), new THREE.MeshLambertMaterial({ color: 0x777788 }));
      mesh.position.set(sx, 0.1, sz);
      mesh.rotation.y = perp;
      GAME.scene.add(mesh);
      spikes.push({ mesh: mesh, x: sx, z: sz });
    }
  }

  function update(dt) {
    var P = GAME.player;
    var s = stars();

    // lightbar flash on all police cars
    var flashOn = (GAME.time * 8 | 0) % 2 === 0;
    var cars = GAME.world.cars;
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i];
      if (c.isPolice && c.mesh.userData.lightbar && !c.dead) {
        var active = s > 0 && c.ai && (c.ai.mode === 'chase' || c.ai.mode === 'roadblock');
        c.mesh.userData.lightbar[0].visible = active && flashOn;
        c.mesh.userData.lightbar[1].visible = active && !flashOn;
      }
    }

    if (P.state !== 'alive') { GAME.audio.siren(0); return; }

    // the air unit runs even at zero stars — the airspace escort is not a
    // wanted-level response
    updateAirUnits(dt, s);

    if (s === 0) {
      GAME.audio.siren(0);
      if (heat > 0) heat = Math.max(0, heat - dt * 4);
      // stray cops wander off
      if (GAME.frame % 60 === 0) {
        var strays = copCars();
        for (var st = 0; st < strays.length; st++) GAME.vehicles.removeCar(strays[st]);
        GAME.world.peds.slice().forEach(function (p) { if (p.isCop && !p.dead) GAME.peds.removePed(p); });
        clearSpikes();
      }
      return;
    }

    // high in an aircraft you're out of reach: ground units stop being sent and
    // stop counting as eyes on you, so the heat can cool
    var flownOff = false;
    if (P.inCar && P.car && (P.car.spec.heli || P.car.spec.plane)) {
      flownOff = P.car.pos.y > GAME.city.groundY(P.car.pos.x, P.car.pos.z) + 26;
    }

    // pursuit cars
    var active = copCars();
    var chasing = active.filter(function (c) { return c.ai.mode === 'chase'; });
    if (!flownOff && chasing.length < CAR_CAP[s] && GAME.frame % 45 === 0) spawnCruiser();
    var pf = GAME.focus();
    for (var a = 0; a < active.length; a++) {
      updateCopCar(active[a], dt, s);
      if (U.dist2(active[a].pos.x, active[a].pos.z, pf.x, pf.z) > 260 * 260) GAME.vehicles.removeCar(active[a]);
    }

    if (!flownOff) maintainFootCops(s, dt);

    // foot cops
    var peds = GAME.world.peds.slice();
    var anyGrab = false;
    for (var f = 0; f < peds.length; f++) {
      if (peds[f].isCop && !peds[f].dead) {
        peds[f].grabbing = false;
        updateFootCop(peds[f], dt, s);
        if (peds[f].grabbing) anyGrab = true;
      }
    }
    // arrest needs a cop holding you for a moment, not mere contact
    if (anyGrab) { grabTimer += dt; if (grabTimer > 0.6) GAME.playerBusted(); }
    else grabTimer = Math.max(0, grabTimer - dt * 2);

    // roadblocks
    if (s >= 3) {
      roadblockT -= dt;
      if (roadblockT <= 0) {
        placeRoadblock(s);
        roadblockT = U.randRange(Math.random, 9, 15);
      }
    }
    // spike strips
    if (P.inCar && P.car && !P.car.spiked) {
      for (var sp = 0; sp < spikes.length; sp++) {
        if (U.dist2(P.car.pos.x, P.car.pos.z, spikes[sp].x, spikes[sp].z) < 27) {
          P.car.spiked = true;
          GAME.fx.spawn(P.car.pos.x, 0.4, P.car.pos.z, { count: 10, color: 0xffe0a0, spread: 3, life: 0.4 });
          GAME.audio.crash(0.5, P.car.pos.x, P.car.pos.z);
          GAME.hud.message('Tires shredded!', 2);
        }
      }
    }

    // line-of-sight decay
    var seen = false;
    var px = P.inCar && P.car ? P.car.pos.x : P.pos.x;
    var pz = P.inCar && P.car ? P.car.pos.z : P.pos.z;
    if (flownOff) active = []; // nothing on the ground can hold eyes on you up there
    for (var v = 0; v < active.length; v++) {
      if (U.dist2(active[v].pos.x, active[v].pos.z, px, pz) < 70 * 70 &&
        GAME.city.hash.segmentClear(active[v].pos.x, active[v].pos.z, px, pz)) { seen = true; break; }
    }
    // the air unit's eyes work at altitude — a 4-5 star bird on your tail
    // means climbing away no longer cools the heat
    for (var av = 0; av < airUnits.length; av++) {
      if (U.dist2(airUnits[av].pos.x, airUnits[av].pos.z, px, pz) < 90 * 90) { seen = true; break; }
    }
    if (!seen && !flownOff) {
      for (var fc = 0; fc < peds.length; fc++) {
        var pd = peds[fc];
        if (pd.isCop && !pd.dead && U.dist2(pd.pos.x, pd.pos.z, px, pz) < 60 * 60) { seen = true; break; }
      }
    }
    if (seen) lastSeen = 0;
    else {
      lastSeen += dt;
      if (lastSeen > 16) {
        var cur = stars();
        heat = cur > 1 ? THRESH[cur - 1] + 20 : 0;
        lastSeen = 8; // next star drops sooner once hidden
        GAME.hud.wantedChanged(stars());
        if (stars() === 0) clearCops();
      }
    }

    // interest fades if you stop offending — otherwise a tail that keeps you in
    // sight means the heat never cools and a 1-star pursuit runs forever
    if (GAME.time - lastCrime > 8) {
      var before2 = stars();
      heat = Math.max(0, heat - dt * (seen ? 4.5 : 14));
      var after2 = stars();
      if (after2 < before2) {
        GAME.hud.wantedChanged(after2);
        if (after2 === 0) clearCops();
      }
    }

    // pinned arrest at 1-2 stars
    if (s <= 2 && P.inCar && P.car && Math.abs(P.car.speed) < 1.5) {
      var pinned = false;
      for (var pc = 0; pc < chasing.length; pc++) {
        if (U.dist2(chasing[pc].pos.x, chasing[pc].pos.z, P.car.pos.x, P.car.pos.z) < 30) { pinned = true; break; }
      }
      if (pinned) {
        pinTimer += dt;
        if (pinTimer > 2.6) GAME.playerBusted();
      } else pinTimer = Math.max(0, pinTimer - dt);
    } else pinTimer = 0;

    // siren from nearest active car
    var nd = 1e9, nx = 0, nz = 0;
    for (var n = 0; n < chasing.length; n++) {
      var d2s = U.dist2(chasing[n].pos.x, chasing[n].pos.z, px, pz);
      if (d2s < nd) { nd = d2s; nx = chasing[n].pos.x; nz = chasing[n].pos.z; }
    }
    if (nd < 1e9) {
      var dd = Math.sqrt(nd);
      GAME.audio.siren(U.clamp(1 - dd / 130, 0, 1), 1 + U.clamp((60 - dd) / 400, -0.1, 0.15), nx, nz);
    } else GAME.audio.siren(0);
  }

  return {
    get wanted() { return stars(); },
    get heat() { return heat; },
    reportCrime: reportCrime,
    noteGunfire: noteGunfire,
    airspaceStrike: airspaceStrike,
    get airUnitCount() { return airUnits.length; },
    setWanted: setWanted,
    clearWanted: clearWanted,
    update: update
  };
})();
