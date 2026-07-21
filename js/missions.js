GAME.missions = (function () {
  var DEFS = [
    {
      id: 'race0', type: 'race', name: 'STRIP SPRINT', reward: 500, start: { x: 350, z: -350 },
      cps: [[350, -150], [350, 50], [350, 250], [250, 350], [150, 250], [150, 50]]
    },
    {
      id: 'race1', type: 'race', name: 'HARBOR LOOP', reward: 550, start: { x: -450, z: -100 },
      cps: [[-450, 150], [-350, 250], [-250, 350], [-150, 250], [-150, 50], [-250, -50], [-350, -50]]
    },
    {
      id: 'race2', type: 'race', name: 'DOWNTOWN DASH', reward: 600, start: { x: 50, z: 250 },
      cps: [[50, 50], [150, -50], [50, -250], [-50, -350], [-150, -250], [-150, -50], [-50, 50]]
    },
    {
      id: 'courier0', type: 'courier', name: 'HOT PLATES', reward: 300, time: 95, start: { x: 158.4, z: 41.6 },
      stops: [[258, 158], [158, -158], [-42, -258], [-158, -42]]
    },
    {
      id: 'courier1', type: 'courier', name: 'NIGHT MAIL', reward: 320, time: 110, start: { x: -241.6, z: -41.6 },
      stops: [[-358, 158], [-258, 258], [-42, 158], [42, -42]]
    },
    {
      id: 'courier2', type: 'courier', name: 'BEACH RUN', reward: 340, time: 100, start: { x: 364, z: 104 },
      stops: [[380, 150], [358, -100], [258, -258], [358, 258]]
    },
    { id: 'rampage0', type: 'rampage', name: 'STRIP HAVOC', reward: 400, time: 60, target: 3000, weapon: 'smg', ammo: 160, start: { x: 241.6, z: -258.4 } },
    { id: 'rampage1', type: 'rampage', name: 'HARBOR HAVOC', reward: 450, time: 60, target: 3500, weapon: 'shotgun', ammo: 30, start: { x: -341.6, z: 258.4 } },
    { id: 'rampage2', type: 'rampage', name: 'UPTOWN HAVOC', reward: 400, time: 60, target: 2500, weapon: 'smg', ammo: 160, start: { x: 41.6, z: -341.6 } }
  ];

  var active = null;
  var markers = [];
  var cpMarker = null;
  var resprayCooldown = 0;

  var MARKER_COLORS = { race: 0xff8a3d, courier: 0x38e8ff, rampage: 0xff4fa3 };

  function makeMarkerMesh(color, r) {
    var m = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 3.4, 18, 1, true),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    return m;
  }

  function init() {
    for (var i = 0; i < DEFS.length; i++) {
      var d = DEFS[i];
      var mesh = makeMarkerMesh(MARKER_COLORS[d.type], 2.2);
      mesh.position.set(d.start.x, GAME.city.groundY(d.start.x, d.start.z) + 1.7, d.start.z);
      GAME.scene.add(mesh);
      markers.push({ def: d, mesh: mesh });
    }
    cpMarker = makeMarkerMesh(0xffe14f, 3.2);
    cpMarker.visible = false;
    GAME.scene.add(cpMarker);
    // respray markers
    GAME.city.pois.resprays.forEach(function (g) {
      var rm = makeMarkerMesh(0xc86bff, 3.0);
      rm.position.set(g.door.x - 4, 1.7, g.door.z);
      GAME.scene.add(rm);
    });
  }

  function bestKey(d) { return d.id; }

  function randomRoadPoint(fromX, fromZ, minR, maxR) {
    for (var t = 0; t < 24; t++) {
      var a = Math.random() * Math.PI * 2, r = U.randRange(Math.random, minR, maxR);
      var rp = GAME.city.nearestRoadPoint(fromX + Math.cos(a) * r, fromZ + Math.sin(a) * r);
      if (rp.x < -470 || rp.x > 352 || Math.abs(rp.z) > 470) continue;
      if (GAME.city.isInWater(rp.x, rp.z)) continue;
      // nudge onto the sidewalk edge
      var off = rp.axis === 'z' ? [8 * (Math.random() < 0.5 ? 1 : -1), 0] : [0, 8 * (Math.random() < 0.5 ? 1 : -1)];
      return [Math.round(rp.x + off[0]), Math.round(rp.z + off[1])];
    }
    return [Math.round(fromX), Math.round(fromZ)];
  }

  // a route that stays on the streets: road-graph nodes, then in along the
  // nearest road line, then a short hop to the exact marker (never across a block)
  function roadRoute(fromX, fromZ, toX, toZ) {
    var rp = GAME.city.nearestRoadPoint(toX, toZ);
    var nodes = GAME.nav.roadPath(fromX, fromZ, rp.x, rp.z);
    var pts = [];
    for (var i = 0; i < nodes.length; i++) pts.push([nodes[i].x, nodes[i].z]);
    pts.push([rp.x, rp.z]);
    pts.push([toX, toZ]);
    return pts;
  }

  function startJob(kind) {
    var P = GAME.player;
    if (active || !P.inCar || !P.car) return;
    active = {
      def: { type: kind, name: kind === 'ambulance' ? 'PARAMEDIC' : 'TAXI DRIVER', id: kind, job: true },
      state: 'run', t: 0, cpIndex: 0, score: 0, racers: [],
      phase: 'pickup', pickup: null, dropoff: null,
      timeLeft: kind === 'ambulance' ? 95 : 90,
      jobCount: 0, earned: 0, passenger: null, routeCp: null
    };
    nextPickup();
    setMarkersVisible(false);
    updateCp();
    GAME.hud.missionStart(active.def.name, objectiveText());
    GAME.hud.message(kind === 'ambulance'
      ? 'Reach the patient, then rush them to a hospital. It keeps going — leave the ambulance to clock off.'
      : 'Pick up your fare, then drive them to the drop-off. It keeps going — leave the cab to clock off.', 4.5);
    GAME.audio.pickup();
  }

  // spawn the next fare/patient waiting on a sidewalk and switch to pickup phase
  function nextPickup() {
    var P = GAME.player;
    var ox = P.car ? P.car.pos.x : P.pos.x, oz = P.car ? P.car.pos.z : P.pos.z;
    active.pickup = randomRoadPoint(ox, oz, 55, 175);
    active.phase = 'pickup';
    var ped = GAME.peds.spawnPed(active.pickup[0], active.pickup[1]);
    ped.state = 'walk'; ped.jobPed = true;
    active.passenger = ped;
    active.routeCp = null;
  }

  // fare/patient delivered: pay out, drop them off, and queue the next one
  function completeFare(kind, f, tgt) {
    active.jobCount++;
    var fare = (kind === 'ambulance' ? 180 : 130) + active.jobCount * 10;
    GAME.addCash(fare); active.earned += fare;
    GAME.audio.sting('win');
    // the passenger/patient climbs out and hurries off
    var out = GAME.peds.spawnPed(tgt[0], tgt[1]);
    out.state = 'flee'; out.fleeT = 3.5; out.fleeX = f.x; out.fleeZ = f.z;
    var word = kind === 'ambulance' ? 'Patient delivered' : 'Fare dropped';
    var msg = word + '! +$' + fare + '  ·  ' + active.jobCount + ' done';
    // streak bonus every 5 completed
    if (active.jobCount % 5 === 0) {
      var bonus = 250 * (active.jobCount / 5);
      GAME.addCash(bonus); active.earned += bonus;
      msg += '   —   STREAK x' + active.jobCount + ' BONUS +$' + bonus + '!';
    }
    GAME.hud.message(msg, 3.2);
    active.timeLeft = Math.min(active.timeLeft + (kind === 'ambulance' ? 55 : 50), 130);
    nextPickup();
    updateCp();
    GAME.hud.missionObjective(objectiveText());
  }

  // end an ongoing taxi/ambulance shift (clock off, totalled, or timed out)
  function endJob(reason) {
    var count = active.jobCount, earned = active.earned;
    var unit = active.def.id === 'ambulance' ? 'run' : 'fare';
    if (count > 0) {
      GAME.audio.sting('win');
      GAME.hud.message('SHIFT OVER — ' + count + ' ' + unit + (count === 1 ? '' : 's') +
        ', $' + earned + ' earned' + (reason ? '  (' + reason + ')' : ''), 4.5);
    } else {
      GAME.hud.message('Shift over.' + (reason ? ' ' + reason + '.' : ''), 2.5);
    }
    cleanup();
  }

  // seed a crowd + traffic around the player so a rampage always has targets
  function spawnRampageTargets(nPeds, nCars) {
    var f = GAME.focus();
    var px = f.x, pz = f.z;
    for (var i = 0; i < nPeds; i++) {
      var a = Math.random() * Math.PI * 2, r = U.randRange(Math.random, 7, 34);
      var x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
      if (GAME.city.isInWater(x, z)) continue;
      var rp = GAME.resolveCircle(x, z, 0.5);
      GAME.peds.spawnPed(rp.x, rp.z);
    }
    var types = ['sedan', 'taxi', 'sports', 'van'];
    for (var c = 0; c < nCars; c++) {
      var a2 = Math.random() * Math.PI * 2, r2 = U.randRange(Math.random, 12, 40);
      var rp2 = GAME.city.nearestRoadPoint(px + Math.cos(a2) * r2, pz + Math.sin(a2) * r2);
      if (GAME.city.isInWater(rp2.x, rp2.z)) continue;
      GAME.vehicles.spawnCar(types[Math.floor(Math.random() * types.length)], rp2.x, rp2.z,
        Math.random() * Math.PI * 2,
        { occupied: 'ai', ai: { mode: 'traffic', desired: U.randRange(Math.random, 7, 11), laneX: 0, laneZ: 0 } });
    }
  }

  function start(def) {
    var P = GAME.player;
    active = {
      def: def, t: 0, cpIndex: 0, score: 0,
      timeLeft: def.time || 0, racers: [], state: 'countdown', countdown: def.type === 'race' ? 3.2 : 0
    };
    if (def.type === 'race') {
      for (var i = 0; i < 3; i++) {
        var off = (i + 1) * 5;
        var rx = def.start.x - Math.sin(P.car.heading) * off + Math.cos(P.car.heading) * (i % 2 ? 3.5 : -3.5);
        var rz = def.start.z - Math.cos(P.car.heading) * off - Math.sin(P.car.heading) * (i % 2 ? 3.5 : -3.5);
        var car = GAME.vehicles.spawnCar('sports', rx, rz, P.car.heading, { occupied: 'ai', ai: { mode: 'race' }, mission: true, color: [0xffe14f, 0xb040ff, 0x38e8ff][i] });
        car.cpIndex = 0;
        active.racers.push(car);
      }
      GAME.hud.message('3...', 1);
      setTimeout(function () { if (active) GAME.hud.message('2...', 1); }, 1000);
      setTimeout(function () { if (active) GAME.hud.message('1...', 1); }, 2000);
      setTimeout(function () { if (active) { GAME.hud.message('GO!', 1); } }, 3000);
    } else if (def.type === 'rampage') {
      GAME.combat.giveWeapon(def.weapon, def.ammo);
      active.state = 'run';
      active.topupT = 0;
      spawnRampageTargets(14, 6);
      GAME.hud.message('Cause $' + def.target + ' of mayhem! Wreck cars and crowds.', 3.5);
    } else {
      active.state = 'run';
      GAME.hud.message('First delivery is marked. Go!', 3);
    }
    setMarkersVisible(false);
    GAME.hud.missionStart(def.name, objectiveText());
    GAME.audio.pickup();
    updateCp();
  }

  function objectiveText() {
    if (!active) return '';
    var d = active.def;
    if (d.type === 'race') return 'Checkpoint ' + (active.cpIndex + 1) + ' / ' + d.cps.length;
    if (d.type === 'courier') return 'Delivery ' + (active.cpIndex + 1) + ' / ' + d.stops.length;
    if (d.type === 'taxifare') return (active.phase === 'pickup' ? 'Pick up the fare' : 'To the drop-off') + '  ·  ' + active.jobCount + ' done';
    if (d.type === 'ambulance') return (active.phase === 'pickup' ? 'Reach the patient' : 'To the hospital') + '  ·  ' + active.jobCount + ' done';
    return '$' + Math.floor(active.score) + ' / $' + d.target;
  }

  function currentCp() {
    var d = active.def;
    if (d.type === 'race') return d.cps[active.cpIndex] || null;
    if (d.type === 'courier') return d.stops[active.cpIndex] || null;
    if (d.type === 'taxifare' || d.type === 'ambulance') return active.phase === 'pickup' ? active.pickup : active.dropoff;
    return null;
  }

  function updateCp() {
    if (!active || active.def.type === 'rampage') { if (cpMarker) cpMarker.visible = false; return; }
    var cp = currentCp();
    if (cp) {
      cpMarker.visible = true;
      cpMarker.position.set(cp[0], GAME.city.groundY(cp[0], cp[1]) + 1.7, cp[1]);
    } else cpMarker.visible = false;
  }

  function setMarkersVisible(v) {
    for (var i = 0; i < markers.length; i++) markers[i].mesh.visible = v;
  }

  function finish(win, reason) {
    var d = active.def;
    var reward = active.reward || d.reward || 0;
    if (win) {
      var value = d.type === 'rampage' ? Math.floor(active.score) : Math.round(active.t * 10) / 10;
      var bests = GAME.bests || (GAME.bests = {});
      var prev = bests[bestKey(d)];
      var isBest = d.type === 'rampage' ? (!prev || value > prev) : (!prev || value < prev);
      if (isBest) bests[bestKey(d)] = value;
      GAME.addCash(reward);
      GAME.audio.sting('win');
      GAME.hud.message((d.job ? 'JOB DONE! +$' : 'MISSION PASSED! +$') + reward + (isBest ? '  ·  NEW BEST!' : ''), 4);
    } else {
      GAME.audio.sting('wasted');
      GAME.hud.message('MISSION FAILED — ' + reason, 3.5);
    }
    cleanup();
  }

  function cleanup() {
    if (active) {
      for (var i = 0; i < active.racers.length; i++) GAME.vehicles.removeCar(active.racers[i]);
      if (active.passenger && !active.passenger.dead) GAME.peds.removePed(active.passenger);
    }
    active = null;
    cpMarker.visible = false;
    setMarkersVisible(true);
    GAME.hud.missionEnd();
    GAME.save();
  }

  function failActive(reason) {
    if (active) finish(false, reason);
  }

  function notifyChaos(pts) {
    if (active && active.def.type === 'rampage' && active.state === 'run') {
      active.score += pts;
      GAME.hud.missionObjective(objectiveText());
    }
  }

  function racerControls(car, dt) {
    var d = active.def;
    var cp = d.cps[Math.min(car.cpIndex, d.cps.length - 1)];
    var dx = cp[0] - car.pos.x, dz = cp[1] - car.pos.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 12) {
      car.cpIndex++;
      if (car.cpIndex >= d.cps.length) return null; // finished
      cp = d.cps[car.cpIndex];
      dx = cp[0] - car.pos.x; dz = cp[1] - car.pos.z;
    }
    var dh = U.wrapPI(Math.atan2(dx, dz) - car.heading);
    var throttle = 0.92;
    if (Math.abs(dh) > 1.1 && Math.abs(car.speed) > 12) throttle = -0.4;
    else if (Math.abs(dh) > 0.5) throttle = 0.5;
    if (car.cpIndex > active.cpIndex) throttle *= 0.8; // rubber band
    if (Math.abs(car.speed) < 1) { car.unstickT = (car.unstickT || 0) + dt; } else car.unstickT = 0;
    if (car.unstickT > 1.5) car.reverseT = 0.9;
    if (car.reverseT > 0) { car.reverseT -= dt; return { throttle: -1, steer: dh > 0 ? -1 : 1, handbrake: false }; }
    return { throttle: throttle, steer: U.clamp(dh * 2.4, -1, 1), handbrake: false };
  }

  function update(dt) {
    resprayCooldown -= dt;
    var P = GAME.player;
    var t = GAME.time;
    // pulse markers
    for (var i = 0; i < markers.length; i++) {
      if (markers[i].mesh.visible) {
        markers[i].mesh.material.opacity = 0.3 + 0.15 * Math.sin(t * 3 + i);
        markers[i].mesh.rotation.y += dt * 0.6;
      }
    }
    if (cpMarker.visible) cpMarker.material.opacity = 0.35 + 0.2 * Math.sin(t * 4);

    checkRespray();

    if (!active) {
      if (P.state !== 'alive') return;
      // taxi / ambulance jobs start from within the vehicle
      var jobKind = null;
      if (P.inCar && P.car) {
        if (P.car.type === 'taxi') jobKind = 'taxifare';
        else if (P.car.type === 'ambulance') jobKind = 'ambulance';
      }
      GAME.jobAvailable = jobKind;
      if (jobKind && (GAME.keyPressed('KeyJ') || GAME.input.touch.job)) {
        GAME.input.touch.job = false;
        startJob(jobKind);
        return;
      }
      for (var m = 0; m < markers.length; m++) {
        var d = markers[m].def;
        // races and courier deliveries need a vehicle; rampages can start on foot
        var need = d.type === 'race' || d.type === 'courier';
        if (need && !P.inCar) continue;
        var px = P.inCar ? P.car.pos.x : P.pos.x, pz = P.inCar ? P.car.pos.z : P.pos.z;
        if (U.dist2(px, pz, d.start.x, d.start.z) < (need ? 20 : 7)) {
          start(d);
          break;
        }
      }
      return;
    }
    GAME.jobAvailable = null;

    // active mission
    var d2 = active.def;
    active.t += dt;
    if (active.state === 'countdown') {
      active.countdown -= dt;
      if (P.car) { P.car.controls.throttle = 0; P.car.speed *= 0.9; }
      for (var r0 = 0; r0 < active.racers.length; r0++) active.racers[r0].controls = { throttle: 0, steer: 0, handbrake: true };
      if (active.countdown <= 0) { active.state = 'run'; active.t = 0; }
      return;
    }

    if (d2.type === 'race') {
      if (!P.inCar || !P.car || P.car.dead) { finish(false, 'You lost your ride.'); return; }
      for (var r = 0; r < active.racers.length; r++) {
        var rc = active.racers[r];
        if (rc.dead) continue;
        var ctl = racerControls(rc, dt);
        if (ctl === null) { finish(false, 'A rival finished first.'); return; }
        rc.controls = ctl;
      }
      var cp = currentCp();
      if (cp && U.dist2(P.car.pos.x, P.car.pos.z, cp[0], cp[1]) < 100) {
        active.cpIndex++;
        GAME.audio.pickup();
        if (active.cpIndex >= d2.cps.length) { finish(true); return; }
        GAME.hud.missionObjective(objectiveText());
        updateCp();
      }
      GAME.hud.missionTimer(active.t, false);
    } else if (d2.type === 'courier') {
      active.timeLeft -= dt;
      if (active.timeLeft <= 0) { finish(false, 'Out of time.'); return; }
      var px2 = P.inCar ? P.car.pos.x : P.pos.x, pz2 = P.inCar ? P.car.pos.z : P.pos.z;
      var stop = currentCp();
      if (stop && U.dist2(px2, pz2, stop[0], stop[1]) < 25) {
        active.cpIndex++;
        GAME.audio.pickup();
        if (active.cpIndex >= d2.stops.length) { finish(true); return; }
        GAME.hud.message('Delivered! Next stop is marked.', 2);
        GAME.hud.missionObjective(objectiveText());
        active.routeCp = -1; // force route recompute for the new stop
        updateCp();
      }
      // road-route the line to the current stop so it follows streets
      active.routeT = (active.routeT || 0) - dt;
      if (active.routeT <= 0 || active.routeCp !== active.cpIndex) {
        active.routeT = 1.0; active.routeCp = active.cpIndex;
        var st2 = currentCp();
        active.courierRoute = st2 ? roadRoute(px2, pz2, st2[0], st2[1]) : null;
      }
      GAME.hud.missionTimer(active.timeLeft, true);
    } else if (d2.type === 'rampage') {
      active.timeLeft -= dt;
      GAME.hud.missionTimer(active.timeLeft, true);
      // keep a crowd around the player so there's always something to wreck
      active.topupT -= dt;
      if (active.topupT <= 0) {
        active.topupT = 3;
        var f = GAME.focus(), near = 0;
        for (var pi = 0; pi < GAME.world.peds.length; pi++) {
          var pd = GAME.world.peds[pi];
          if (!pd.dead && !pd.isCop && U.dist2(pd.pos.x, pd.pos.z, f.x, f.z) < 55 * 55) near++;
        }
        if (near < 8) spawnRampageTargets(9, 3);
      }
      if (active.score >= d2.target) { finish(true); return; }
      if (active.timeLeft <= 0) { finish(false, 'Time up — $' + Math.floor(active.score) + ' of $' + d2.target); return; }
    } else if (d2.type === 'taxifare' || d2.type === 'ambulance') {
      // clock off simply by leaving the vehicle; the shift also ends if it's totalled
      if (!P.inCar || !P.car) { endJob('clocked off'); return; }
      if (P.car.dead) { endJob('vehicle totalled'); return; }
      active.timeLeft -= dt;
      if (active.timeLeft <= 0) { endJob('out of time'); return; }
      var f = GAME.focus(), tgt = currentCp();
      if (active.phase === 'pickup') {
        if (tgt && U.dist2(f.x, f.z, tgt[0], tgt[1]) < 34 && Math.abs(P.car.speed) < 6) {
          active.phase = 'dropoff';
          if (active.passenger) { GAME.peds.removePed(active.passenger); active.passenger = null; }
          if (d2.type === 'ambulance') {
            var hs = GAME.city.pois.hospitals, best = hs[0], bd = 1e18;
            for (var hi = 0; hi < hs.length; hi++) { var dd = U.dist2(f.x, f.z, hs[hi].x, hs[hi].z); if (dd < bd) { bd = dd; best = hs[hi]; } }
            active.dropoff = [best.x + 20, best.spawn.z];
          } else {
            active.dropoff = randomRoadPoint(f.x, f.z, 90, 210);
          }
          active.routeCp = null;
          updateCp();
          GAME.hud.message(d2.type === 'ambulance' ? 'Patient aboard — get to the hospital!' : 'Fare aboard — to the drop-off!', 2.5);
          GAME.hud.missionObjective(objectiveText());
          GAME.audio.pickup();
        }
      } else {
        if (tgt && U.dist2(f.x, f.z, tgt[0], tgt[1]) < 38 && Math.abs(P.car.speed) < 4) { completeFare(d2.type, f, tgt); }
      }
      active.routeT = (active.routeT || 0) - dt;
      if (active.routeT <= 0 || active.routeCp !== active.phase) {
        active.routeT = 1.0; active.routeCp = active.phase;
        var jt = currentCp();
        active.courierRoute = jt ? roadRoute(f.x, f.z, jt[0], jt[1]) : null;
      }
      GAME.hud.missionTimer(active.timeLeft, true);
    }
  }

  function checkRespray() {
    var P = GAME.player;
    if (!P.inCar || !P.car || resprayCooldown > 0 || P.state !== 'alive') return;
    var doors = GAME.city.pois.resprays;
    var near = false;
    for (var i = 0; i < doors.length; i++) {
      if (U.dist2(P.car.pos.x, P.car.pos.z, doors[i].door.x, doors[i].door.z) <= 36) { near = true; break; }
    }
    if (!near) return;
    if (P.cash < 100) {
      GAME.hud.message('Respray costs $100 — you\'re short.', 2.5);
      resprayCooldown = 4;
      return;
    }
    GAME.addCash(-100);
    GAME.police.clearWanted();
    // works for any driven vehicle, motorcycles included: full repair + fresh paint
    var car = P.car;
    car.hp = car.spec.hp; car.stage = 0; car.spiked = false; car.fireFuse = 0;
    if (car.mesh.userData.bodyMesh) {
      car.mesh.userData.bodyMesh.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    }
    GAME.fx.flash(car.pos.x, 1.5, car.pos.z, 4);
    GAME.audio.pickup();
    GAME.hud.message('Resprayed & fully repaired — the heat is off.', 3);
    resprayCooldown = 8;
  }

  return {
    DEFS: DEFS,
    get active() { return active; },
    init: init,
    update: update,
    failActive: failActive,
    notifyChaos: notifyChaos,
    objectiveText: objectiveText,
    getRoutePoints: function () {
      if (!active || active.state === 'countdown') return null;
      if (active.def.type === 'race') return active.def.cps.slice(active.cpIndex);
      if (active.courierRoute) return active.courierRoute; // courier / taxi / ambulance
      return null;
    },
    // the immediate target marker (checkpoint / stop / pickup / drop-off)
    getObjectivePoint: function () {
      if (!active || active.state === 'countdown') return null;
      return currentCp();
    },
    getBlips: function () {
      var out = [];
      GAME.city.pois.resprays.forEach(function (g) {
        out.push({ x: g.door.x, z: g.door.z, color: '#c86bff', size: 4 });
      });
      if (!active) {
        for (var i = 0; i < markers.length; i++) {
          var d = markers[i].def;
          out.push({ x: d.start.x, z: d.start.z, color: '#' + MARKER_COLORS[d.type].toString(16).padStart(6, '0'), size: 4 });
        }
      } else if (cpMarker.visible) {
        out.push({ x: cpMarker.position.x, z: cpMarker.position.z, color: '#ffe14f', size: 5 });
      }
      return out;
    }
  };
})();
