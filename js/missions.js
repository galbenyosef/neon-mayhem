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
    // respray marker
    var g = GAME.city.pois.respray;
    var rm = makeMarkerMesh(0xff4fa3, 3.0);
    rm.position.set(g.door.x - 4, 1.7, g.door.z);
    GAME.scene.add(rm);
  }

  function bestKey(d) { return d.id; }

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
      GAME.hud.message('Cause $' + def.target + ' of mayhem!', 3);
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
    return '$' + Math.floor(active.score) + ' / $' + d.target;
  }

  function currentCp() {
    var d = active.def;
    var arr = d.type === 'race' ? d.cps : d.stops;
    return arr[active.cpIndex] || null;
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
    if (win) {
      var value = d.type === 'rampage' ? Math.floor(active.score) : Math.round(active.t * 10) / 10;
      var bests = GAME.bests || (GAME.bests = {});
      var prev = bests[bestKey(d)];
      var isBest = d.type === 'rampage' ? (!prev || value > prev) : (!prev || value < prev);
      if (isBest) bests[bestKey(d)] = value;
      GAME.addCash(d.reward);
      GAME.audio.sting('win');
      GAME.hud.message('MISSION PASSED! +$' + d.reward + (isBest ? '  ·  NEW BEST!' : ''), 4);
    } else {
      GAME.audio.sting('wasted');
      GAME.hud.message('MISSION FAILED — ' + reason, 3.5);
    }
    cleanup();
  }

  function cleanup() {
    if (active) {
      for (var i = 0; i < active.racers.length; i++) GAME.vehicles.removeCar(active.racers[i]);
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
      for (var m = 0; m < markers.length; m++) {
        var d = markers[m].def;
        var need = d.type === 'race';
        if (need && !P.inCar) continue;
        var px = P.inCar ? P.car.pos.x : P.pos.x, pz = P.inCar ? P.car.pos.z : P.pos.z;
        if (U.dist2(px, pz, d.start.x, d.start.z) < (need ? 20 : 7)) {
          start(d);
          break;
        }
      }
      return;
    }

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
        updateCp();
      }
      GAME.hud.missionTimer(active.timeLeft, true);
    } else if (d2.type === 'rampage') {
      active.timeLeft -= dt;
      GAME.hud.missionTimer(active.timeLeft, true);
      if (active.score >= d2.target) { finish(true); return; }
      if (active.timeLeft <= 0) { finish(false, 'Time up — $' + Math.floor(active.score) + ' of $' + d2.target); return; }
    }
  }

  function checkRespray() {
    var P = GAME.player;
    if (!P.inCar || !P.car || resprayCooldown > 0 || P.state !== 'alive') return;
    var door = GAME.city.pois.respray.door;
    if (U.dist2(P.car.pos.x, P.car.pos.z, door.x, door.z) > 36) return;
    if (P.cash < 100) {
      GAME.hud.message('Respray costs $100 — you\'re short.', 2.5);
      resprayCooldown = 4;
      return;
    }
    GAME.addCash(-100);
    GAME.police.clearWanted();
    var car = P.car;
    car.hp = car.spec.hp; car.stage = 0; car.spiked = false; car.fireFuse = 0;
    var colors = car.spec.colors;
    car.mesh.userData.bodyMesh.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    GAME.fx.flash(car.pos.x, 1.5, car.pos.z, 4);
    GAME.audio.pickup();
    GAME.hud.message('Resprayed. The heat is off.', 3);
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
    getBlips: function () {
      var out = [];
      var g = GAME.city.pois.respray.door;
      out.push({ x: g.x, z: g.z, color: '#ff4fa3', size: 4 });
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
