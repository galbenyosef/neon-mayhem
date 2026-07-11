GAME.police = (function () {
  var heat = 0, lastSeen = 0, pinTimer = 0;
  var crimeCooldown = {};
  var roadblockT = 0, spikes = [];
  var THRESH = [0, 60, 140, 240, 340, 440];
  var CAR_CAP = [0, 1, 2, 3, 4, 6];

  function stars() {
    var s = 0;
    for (var i = 5; i >= 1; i--) { if (heat >= THRESH[i]) { s = i; break; } }
    return s;
  }

  var CRIME_HEAT = { hit_ped: 25, kill_ped: 60, jack: 60, shoot_car: 18, hit_car: 8, kill_cop: 130 };

  function reportCrime(type, pos) {
    var now = GAME.time;
    if (crimeCooldown[type] && now - crimeCooldown[type] < 1.2) return;
    crimeCooldown[type] = now;
    var before = stars();
    heat = Math.min(560, heat + (CRIME_HEAT[type] || 20));
    if (type === 'kill_cop') heat = Math.max(heat, THRESH[Math.min(5, before + 2)]);
    lastSeen = 0;
    var after = stars();
    if (after > before) GAME.hud.wantedChanged(after);
  }

  function noteGunfire(pos) {
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
    var before = stars();
    heat = Math.max(heat + 10, THRESH[1] + 5);
    heat = Math.min(560, heat);
    lastSeen = 0;
    if (stars() > before) GAME.hud.wantedChanged(stars());
  }

  function setWanted(n) {
    n = U.clamp(Math.floor(n), 0, 5);
    heat = n === 0 ? 0 : THRESH[n] + 25;
    GAME.hud.wantedChanged(n);
    if (n === 0) clearCops();
  }

  function clearWanted() { setWanted(0); }

  function clearCops() {
    var cars = GAME.world.cars;
    for (var i = cars.length - 1; i >= 0; i--) {
      var c = cars[i];
      if (c.isPolice && !c.dead && c !== GAME.player.car) GAME.vehicles.removeCar(c);
    }
    var peds = GAME.world.peds;
    for (var j = peds.length - 1; j >= 0; j--) {
      if (peds[j].isCop && !peds[j].dead) GAME.peds.removePed(peds[j]);
    }
    clearSpikes();
    pinTimer = 0;
  }

  function clearSpikes() {
    for (var i = 0; i < spikes.length; i++) GAME.scene.remove(spikes[i].mesh);
    spikes = [];
  }

  function copCars() {
    return GAME.world.cars.filter(function (c) { return c.isPolice && !c.dead && c.ai && (c.ai.mode === 'chase' || c.ai.mode === 'roadblock'); });
  }

  function spawnCruiser() {
    var P = GAME.player;
    var px = P.inCar && P.car ? P.car.pos.x : P.pos.x;
    var pz = P.inCar && P.car ? P.car.pos.z : P.pos.z;
    for (var tries = 0; tries < 6; tries++) {
      var a = Math.random() * Math.PI * 2;
      var r = U.randRange(Math.random, 90, 150);
      var rp = GAME.city.nearestRoadPoint(px + Math.cos(a) * r, pz + Math.sin(a) * r);
      if (rp.x < -480 || rp.x > 345 || Math.abs(rp.z) > 480) continue;
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

  function chaseControls(car, dt, s) {
    var P = GAME.player;
    var tx = P.inCar && P.car ? P.car.pos.x : P.pos.x;
    var tz = P.inCar && P.car ? P.car.pos.z : P.pos.z;
    if (P.inCar && P.car) {
      tx += (P.car.vx || 0) * 0.45;
      tz += (P.car.vz || 0) * 0.45;
    }
    var dx = tx - car.pos.x, dz = tz - car.pos.z;
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

    var steer = U.clamp(dh * 2.4, -1, 1);
    var throttle = 1;
    if (s === 1) {
      // tail from a distance
      throttle = dist > 18 ? 0.8 : (dist > 10 ? 0.25 : -0.4);
    } else {
      if (dist < 7 && Math.abs(dh) > 1.6) throttle = -0.5;
      else if (dist < 5) throttle = 0.4;
    }
    if (Math.abs(dh) > 2.2 && car.speed > 4) { throttle = -0.3; }
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
    if (s >= 2 && !P.godMode) {
      car.shootT -= dt;
      if (car.shootT <= 0) {
        var px2 = P.inCar && P.car ? P.car.pos.x : P.pos.x;
        var pz2 = P.inCar && P.car ? P.car.pos.z : P.pos.z;
        var d2 = U.dist2(car.pos.x, car.pos.z, px2, pz2);
        if (d2 < 40 * 40 && GAME.city.hash.segmentClear(car.pos.x, car.pos.z, px2, pz2)) {
          GAME.combat.npcShoot(car.pos.x, 1.3, car.pos.z, 0.25 + s * 0.07, 5 + s * 1.5);
        }
        car.shootT = U.randRange(Math.random, 1.1, 2.2) / Math.max(1, s * 0.5);
      }
    }

    // deploy foot cops when close and player is on foot
    if (!P.inCar && car.copsOut < 2 && Math.abs(car.speed) < 3) {
      var d = U.dist(car.pos.x, car.pos.z, P.pos.x, P.pos.z);
      if (d < 22) {
        var footCount = GAME.world.peds.filter(function (p) { return p.isCop && !p.dead; }).length;
        if (footCount < Math.min(2 * s, 6)) {
          var side = car.heading + Math.PI / 2;
          spawnFootCop(car.pos.x + Math.sin(side) * 1.8, car.pos.z + Math.cos(side) * 1.8);
          car.copsOut++;
        }
      }
    }
  }

  function updateFootCop(cop, dt, s) {
    var P = GAME.player;
    var dx = P.pos.x - cop.pos.x, dz = P.pos.z - cop.pos.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    if (s === 0 || dist > 110) {
      GAME.peds.removePed(cop);
      return;
    }
    var th = Math.atan2(dx, dz);
    cop.heading = U.angleLerp(cop.heading, th, Math.min(1, dt * 6));
    var wantShoot = s >= 2 && dist < 26 && !P.inCar;
    var chaseSpeed = P.inCar ? 4.6 : 4.3;
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
      if (cop.shootT <= 0 && GAME.city.hash.segmentClear(cop.pos.x, cop.pos.z, P.pos.x, P.pos.z)) {
        GAME.combat.npcShoot(cop.pos.x, 1.35, cop.pos.z, 0.3 + s * 0.06, 5 + s);
        cop.shootT = U.randRange(Math.random, 0.9, 1.8);
      }
    } else {
      j.armL.rotation.x = -sw * 0.8; j.armR.rotation.x = sw * 0.8;
    }
    // arrest on touch at low heat
    if (!P.inCar && dist < 1.4 && s <= 2) GAME.playerBusted();
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

    // pursuit cars
    var active = copCars();
    var chasing = active.filter(function (c) { return c.ai.mode === 'chase'; });
    if (chasing.length < CAR_CAP[s] && GAME.frame % 45 === 0) spawnCruiser();
    for (var a = 0; a < active.length; a++) {
      updateCopCar(active[a], dt, s);
      if (U.dist2(active[a].pos.x, active[a].pos.z, P.pos.x, P.pos.z) > 260 * 260) GAME.vehicles.removeCar(active[a]);
    }

    // foot cops
    var peds = GAME.world.peds.slice();
    for (var f = 0; f < peds.length; f++) {
      if (peds[f].isCop && !peds[f].dead) updateFootCop(peds[f], dt, s);
    }

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
          GAME.audio.crash(0.5);
          GAME.hud.message('Tires shredded!', 2);
        }
      }
    }

    // line-of-sight decay
    var seen = false;
    var px = P.inCar && P.car ? P.car.pos.x : P.pos.x;
    var pz = P.inCar && P.car ? P.car.pos.z : P.pos.z;
    for (var v = 0; v < active.length; v++) {
      if (U.dist2(active[v].pos.x, active[v].pos.z, px, pz) < 70 * 70 &&
        GAME.city.hash.segmentClear(active[v].pos.x, active[v].pos.z, px, pz)) { seen = true; break; }
    }
    if (!seen) {
      for (var fc = 0; fc < peds.length; fc++) {
        var pd = peds[fc];
        if (pd.isCop && !pd.dead && U.dist2(pd.pos.x, pd.pos.z, px, pz) < 60 * 60) { seen = true; break; }
      }
    }
    if (seen) lastSeen = 0;
    else {
      lastSeen += dt;
      if (lastSeen > 30) {
        var cur = stars();
        heat = cur > 1 ? THRESH[cur - 1] + 20 : 0;
        lastSeen = 18; // next star drops sooner once hidden
        GAME.hud.wantedChanged(stars());
        if (stars() === 0) clearCops();
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
    var nd = 1e9;
    for (var n = 0; n < chasing.length; n++) {
      var d2s = U.dist2(chasing[n].pos.x, chasing[n].pos.z, px, pz);
      if (d2s < nd) nd = d2s;
    }
    if (nd < 1e9) {
      var dd = Math.sqrt(nd);
      GAME.audio.siren(U.clamp(1 - dd / 130, 0, 1), 1 + U.clamp((60 - dd) / 400, -0.1, 0.15));
    } else GAME.audio.siren(0);
  }

  return {
    get wanted() { return stars(); },
    get heat() { return heat; },
    reportCrime: reportCrime,
    noteGunfire: noteGunfire,
    setWanted: setWanted,
    clearWanted: clearWanted,
    update: update
  };
})();
