GAME.player = {
  pos: null, mesh: null, heading: 0,
  inCar: false, car: null,
  health: 100, armor: 0, cash: 250,
  state: 'alive', stateT: 0,
  weapons: { fist: { have: true, ammo: Infinity } },
  currentWeapon: 'fist',
  moveSpeed: 0
};

GAME.cam = { yaw: Math.PI, pitch: 0.32, dist: 6, freeT: 0, x: 0, y: 5, z: 0 };
GAME.cameraShake = 0;

// where the player effectively is (their vehicle when driving, else on foot)
GAME.focus = function () {
  var P = GAME.player;
  return P.inCar && P.car ? P.car.pos : P.pos;
};

GAME.initPlayer = function () {
  var P = GAME.player;
  var mesh = GAME.peds.buildPedMesh({});
  // fixed outfit so the player reads distinctly
  mesh.userData.joints.torso.material = new THREE.MeshLambertMaterial({ color: 0xf0f0f8 });
  mesh.userData.joints.armL.children[0].material = mesh.userData.joints.torso.material;
  mesh.userData.joints.armR.children[0].material = mesh.userData.joints.torso.material;
  mesh.userData.joints.legL.children[0].material = new THREE.MeshLambertMaterial({ color: 0x38b8c8 });
  mesh.userData.joints.legR.children[0].material = mesh.userData.joints.legL.children[0].material;
  GAME.scene.add(mesh);
  P.mesh = mesh;
  P.pos = mesh.position;
  P.pos.set(356, 0.18, 40);
  P.heading = Math.PI;
  mesh.visible = false; // hidden during title attract mode; shown on start
  // weapon prop in right hand
  var wm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.42), new THREE.MeshLambertMaterial({ color: 0x222228 }));
  wm.position.set(0, -0.55, 0.2);
  wm.visible = false;
  mesh.userData.joints.armR.add(wm);
  P.weaponMesh = wm;
  loadSave();
};

function loadSave() {
  try {
    var s = JSON.parse(localStorage.getItem('neonMayhemSave') || '{}');
    if (typeof s.cash === 'number') GAME.player.cash = s.cash;
    GAME.bests = s.bests || {};
    GAME.prefs = s.prefs || {};
  } catch (e) { GAME.bests = {}; GAME.prefs = {}; }
}
GAME.save = function () {
  try {
    localStorage.setItem('neonMayhemSave', JSON.stringify({ cash: GAME.player.cash, bests: GAME.bests || {}, prefs: GAME.prefs || {} }));
  } catch (e) { }
};
GAME.addCash = function (n) {
  GAME.player.cash = Math.max(0, GAME.player.cash + n);
  GAME.hud.cashChanged();
  GAME.save();
};

GAME.playerDamage = function (amt, cause) {
  var P = GAME.player;
  if (!GAME.started || P.state !== 'alive' || GAME.godMode) return;
  if (P.armor > 0) {
    var absorbed = Math.min(P.armor, amt * 0.7);
    P.armor -= absorbed;
    amt -= absorbed;
  }
  P.health -= amt;
  GAME.hud.damageFlash();
  if (P.health <= 0) {
    P.health = 0;
    GAME.playerWasted(cause);
  }
};

// silence every looping voice — the player update stops running once you're
// down, so anything still held open would drone until respawn
function killLoopingAudio() {
  GAME.audio.engineState(false, 0);
  GAME.audio.skid(0);
  GAME.audio.siren(0);
  GAME.audio.radio.setVolume(0);
}

GAME.playerWasted = function (cause) {
  var P = GAME.player;
  if (P.state !== 'alive') return;
  P.state = 'wasted'; P.stateT = 0;
  GAME.timeScale = 0.35;
  killLoopingAudio();
  GAME.audio.sting('wasted');
  GAME.hud.showBig('wasted', 'You wake up at the hospital. Weapons gone, cash intact.');
  GAME.missions.failActive('You got wasted.');
};

GAME.playerBusted = function () {
  var P = GAME.player;
  if (P.state !== 'alive') return;
  P.state = 'busted'; P.stateT = 0;
  GAME.timeScale = 0.4;
  killLoopingAudio();
  GAME.audio.sting('busted');
  var fine = Math.min(P.cash, 200);
  P.pendingFine = fine;
  GAME.hud.showBig('busted', 'Released with a $' + fine + ' fine. Weapons confiscated.');
  GAME.missions.failActive('You got busted.');
};

GAME.playerDrown = function () {
  var P = GAME.player;
  if (P.drowning || P.state !== 'alive') return;
  P.drowning = true;
  GAME.audio.splash();
  GAME.hud.fade(function () {
    if (P.inCar) forceExitCar(true);
    // wash up on whichever shore was crossed
    var c = GAME.city;
    var x = U.clamp(P.pos.x, -560, 560), z = U.clamp(P.pos.z, -560, 560);
    if (x > c.shoreline(z)) x = c.shoreline(z) - 22;
    if (x < c.westShore(z)) x = c.westShore(z) + 24;
    if (z < c.northShore(x)) z = c.northShore(x) + 24;
    if (z > c.southShore(x)) z = c.southShore(x) - 24;
    P.pos.set(x, c.groundY(x, z), z);
    P.heading = Math.atan2(-x, -z);
    P.drowning = false;
    GAME.hud.message('You wash up on the beach, soaked.');
  });
};

function respawnAfterScreen() {
  var P = GAME.player;
  var kind = P.state;
  GAME.hud.fade(function () {
    GAME.hud.hideBig();
    GAME.timeScale = 1;
    if (P.inCar) forceExitCar(true);
    P.health = 100;
    if (kind === 'busted') {
      GAME.addCash(-(P.pendingFine || 0));
      P.pendingFine = 0;
      var sp = GAME.city.pois.police.spawn;
      P.pos.set(sp.x, 0, sp.z);
    } else {
      P.armor = 0;
      // wake up at the nearest hospital
      var hs = GAME.city.pois.hospitals;
      var sh = hs[0].spawn;
      var bd = 1e18;
      for (var hi = 0; hi < hs.length; hi++) {
        var d = U.dist2(P.pos.x, P.pos.z, hs[hi].x, hs[hi].z);
        if (d < bd) { bd = d; sh = hs[hi].spawn; }
      }
      P.pos.set(sh.x, 0, sh.z);
    }
    P.weapons = { fist: { have: true, ammo: Infinity } };
    P.currentWeapon = 'fist';
    GAME.combat.refreshWeaponHud();
    GAME.police.clearWanted();
    P.state = 'alive';
  });
}

function nearestEnterableCar() {
  var P = GAME.player;
  return GAME.vehicles.findNearestCar(P.pos.x + Math.sin(P.heading) * 1.2, P.pos.z + Math.cos(P.heading) * 1.2, 4.6, null);
}

GAME.enterCar = function (car) {
  var P = GAME.player;
  if (!car || car.dead || P.inCar || P.entering) return false;
  if (car.occupied === 'ai') {
    // jack: driver bails and flees
    var side = car.heading + Math.PI / 2;
    var dx = Math.sin(side) * 1.6, dz = Math.cos(side) * 1.6;
    var driver = GAME.peds.spawnPed(car.pos.x + dx, car.pos.z + dz, car.isPolice ? { cop: true } : undefined);
    driver.state = 'flee';
    driver.fleeT = 8;
    driver.fleeX = car.pos.x; driver.fleeZ = car.pos.z;
    if (car.isPolice) driver.isCop = false; // he's fleeing his stolen cruiser, not chasing
    GAME.audio.yelp();
    GAME.police.reportCrime(car.isPolice ? 'steal_police' : 'jack', car.pos);
    GAME.missions.notifyChaos(100);
  } else if (car.isPolice) {
    // stealing an empty/parked cruiser is still a crime
    GAME.police.reportCrime('steal_police', car.pos);
  }
  if (car.isPolice && car.ai) car.ai = null;
  // an AI bike's seated rider gives way to the player (driver flees separately)
  if (car.riderMesh) { car.mesh.remove(car.riderMesh); disposeTree(car.riderMesh); car.riderMesh = null; }
  // once you take it, it's no longer a parked-spot car (else its spot despawns it)
  if (car.parkedSpot) { car.parkedSpot.live = null; car.parkedSpot = null; }
  car.occupied = 'player';
  if (car.ai) car.ai = null;
  car.controls = { throttle: 0, steer: 0, handbrake: true };
  // short walk-to-the-door transition before sitting in
  P.entering = { car: car, t: 0, dur: 0.55 };
  return true;
};

function stepEnter(dt) {
  var P = GAME.player;
  var e = P.entering;
  var car = e.car;
  if (!car || car.dead) { P.entering = null; return; }
  e.t += dt;
  var side = car.heading - Math.PI / 2;
  var doorX = car.pos.x + Math.sin(side) * 1.5;
  var doorZ = car.pos.z + Math.cos(side) * 1.5;
  P.heading = U.angleLerp(P.heading, Math.atan2(doorX - P.pos.x, doorZ - P.pos.z), Math.min(1, dt * 10));
  P.pos.x = U.damp(P.pos.x, doorX, 9, dt);
  P.pos.z = U.damp(P.pos.z, doorZ, 9, dt);
  P.pos.y = GAME.city.groundY(P.pos.x, P.pos.z);
  P.mesh.rotation.y = P.heading;
  P.walkPhase = (P.walkPhase || 0) + dt * 11;
  var j = P.mesh.userData.joints;
  var s = Math.sin(P.walkPhase) * 0.6;
  j.legL.rotation.x = s; j.legR.rotation.x = -s;
  j.armL.rotation.x = -s * 0.7; j.armR.rotation.x = s * 0.7;
  if (e.t >= e.dur) {
    P.entering = null;
    j.legL.rotation.x = j.legR.rotation.x = j.armL.rotation.x = j.armR.rotation.x = 0;
    car.controls = { throttle: 0, steer: 0, handbrake: false };
    P.inCar = true;
    P.car = car;
    P.onBike = !!car.spec.bike;
    P.mesh.visible = P.onBike; // riders stay visible on a bike
    GAME.cam.freeT = 0;
    GAME.audio.radio.setVolume(GAME.audio.muted ? 0 : 0.7);
    GAME.hud.message(car.spec.label, 1.6);
    if (car.spec.plane) GAME.hud.message('Plane — W throttle up the runway, Space to climb once fast · A/D turn · F to bail out', 4.5);
    else if (car.spec.heli) GAME.hud.message('Heli — Space up · Shift down · WASD fly · F to exit (bail with a chute if high up)', 4);
    else if (car.type === 'taxi') GAME.hud.message('Cab — press J (or JOB) to start a fare', 3);
    else if (car.type === 'ambulance') GAME.hud.message('Ambulance — press J (or JOB) for a paramedic run', 3);
  }
}

function forceExitCar(silent) {
  var P = GAME.player;
  if (!P.inCar) return;
  var car = P.car;
  car.controls = { throttle: 0, steer: 0, handbrake: false };
  car.occupied = null;
  var side = car.heading - Math.PI / 2;
  var ex = car.pos.x + Math.sin(side) * 2.2, ez = car.pos.z + Math.cos(side) * 2.2;
  var roofY = GAME.city.surfaceY(car.pos.x, car.pos.z);
  var onRoof = (car.spec.heli || car.spec.plane) && roofY > GAME.city.groundY(car.pos.x, car.pos.z) + 1;
  if (onRoof) {
    // step out onto the rooftop beside the aircraft (don't shove out of the footprint);
    // if you then walk off the edge, on-foot gravity takes over
    P.pos.set(ex, roofY, ez);
  } else {
    var rp = GAME.resolveCircle(ex, ez, 0.45);
    P.pos.set(rp.x, GAME.city.groundY(rp.x, rp.z), rp.z);
  }
  P.velY = 0;
  P.heading = car.heading;
  P.inCar = false;
  P.car = null;
  P.onBike = false;
  resetRiderPose();
  P.mesh.visible = true;
  GAME.audio.engineState(false, 0);
  GAME.audio.radio.setVolume(0);
  GAME.audio.skid(0);
}
GAME.exitCar = forceExitCar;

function resetRiderPose() {
  var j = GAME.player.mesh.userData.joints;
  j.legL.rotation.set(0, 0, 0); j.legR.rotation.set(0, 0, 0);
  j.armL.rotation.set(0, 0, 0); j.armR.rotation.set(0, 0, 0);
  j.torso.rotation.x = 0;
  GAME.player.mesh.rotation.z = 0;
}

// thrown off the bike on a hard crash
GAME.ejectBike = function (impact) {
  var P = GAME.player;
  if (!P.onBike || !P.car) return;
  var car = P.car;
  var side = car.heading + (Math.random() < 0.5 ? 1.4 : -1.4);
  forceExitCar();
  var tx = car.pos.x + Math.sin(side) * 4, tz = car.pos.z + Math.cos(side) * 4;
  var rp = GAME.resolveCircle(tx, tz, 0.45);
  P.pos.set(rp.x, GAME.city.groundY(rp.x, rp.z), rp.z);
  GAME.fx.spawn(P.pos.x, 0.6, P.pos.z, { count: 6, color: 0xffd890, spread: 3, life: 0.5 });
  GAME.cameraShake = 0.8;
  GAME.playerDamage(Math.min(35, 10 + impact * 1.2), 'crash');
  GAME.hud.message('Thrown off the bike!', 2);
};

GAME.updatePlayer = function (dt) {
  var P = GAME.player, inp = GAME.input, T = inp.touch;
  if (P.state !== 'alive') {
    P.stateT += dt;
    if (P.stateT > 1.2 && !P.respawnQueued && (P.stateT > 3.2 || GAME.key('KeyR') || GAME.key('Enter') || GAME.skipScreen)) {
      GAME.skipScreen = false;
      P.respawnQueued = true;
      respawnAfterScreen();
      setTimeout(function () { P.respawnQueued = false; }, 1500);
    }
    updateCamera(dt);
    return;
  }

  if (P.entering) { stepEnter(dt); updateCamera(dt); return; }
  if (P.parachuting) { GAME.aircraft.updateParachute(dt); updateCamera(dt); return; }
  if (P.inCar) updateDriving(dt);
  else updateOnFoot(dt);

  // pickups
  GAME.combat.checkPickups();
  updateCamera(dt);
};

var enterLatch = false;
function wantsEnter() {
  var v = GAME.key('KeyF') || GAME.input.touch.enter;
  var fired = v && !enterLatch;
  enterLatch = v;
  return fired;
}

function updateOnFoot(dt) {
  var P = GAME.player, inp = GAME.input, T = inp.touch;
  var aiming = GAME.combat.aiming;
  var mx = 0, mz = 0;
  if (GAME.key('KeyW')) mz += 1;
  if (GAME.key('KeyS')) mz -= 1;
  if (GAME.key('KeyA')) mx -= 1;
  if (GAME.key('KeyD')) mx += 1;
  if (T.active) { mx += T.stickX; mz += -T.stickY; }
  var mag = Math.min(1, U.len(mx, mz));
  if (P.carHurtCd > 0) P.carHurtCd -= dt;
  // run: Shift on desktop, RUN toggle or full stick deflection on touch
  var run = ((GAME.key('ShiftLeft') || GAME.key('ShiftRight')) || T.run || (T.active && mag > 0.85)) && !aiming;
  var target = mag * (aiming ? 2.0 : run ? 6.0 : 2.8);
  P.moveSpeed = U.damp(P.moveSpeed, target, 8, dt);

  if (mag > 0.05) {
    // camera-relative: forward = dir(yaw), screen-right = dir(yaw - pi/2) = (-cos, sin)
    var camYaw = GAME.cam.yaw;
    var wx = Math.sin(camYaw) * mz - Math.cos(camYaw) * mx;
    var wz = Math.cos(camYaw) * mz + Math.sin(camYaw) * mx;
    var moveH = Math.atan2(wx, wz);
    if (!aiming) P.heading = U.angleLerp(P.heading, moveH, Math.min(1, dt * 10));
    P.moveH = moveH;
  }
  if (aiming) P.heading = GAME.cam.yaw;

  var h = (mag > 0.05) ? P.moveH : P.heading;
  var nx = P.pos.x + Math.sin(h) * P.moveSpeed * dt * (mag > 0.05 ? 1 : 0);
  var nz = P.pos.z + Math.cos(h) * P.moveSpeed * dt * (mag > 0.05 ? 1 : 0);
  var rp = GAME.resolveCircle(nx, nz, 0.45, P.pos.y);
  nx = rp.x; nz = rp.z;
  // solid cars
  var cars = GAME.world.cars;
  for (var i = 0; i < cars.length; i++) {
    var c = cars[i];
    var dx = nx - c.pos.x, dz = nz - c.pos.z;
    var d2 = dx * dx + dz * dz;
    var rr = c.radius + 0.4;
    if (d2 < rr * rr && d2 > 0.001) {
      var d = Math.sqrt(d2);
      nx = c.pos.x + dx / d * rr;
      nz = c.pos.z + dz / d * rr;
      // one hit per contact: gate by a short cooldown so a single bump can't
      // drain health across many frames of overlap
      if (Math.abs(c.speed) > 8 && P.carHurtCd <= 0) {
        GAME.playerDamage(Math.min(30, Math.abs(c.speed) * 0.9), 'car');
        P.carHurtCd = 0.8;
        var kb = 3.2;
        nx += dx / d * kb; nz += dz / d * kb;
      }
    }
  }
  P.pos.x = nx; P.pos.z = nz;
  if (GAME.city.isInWater(P.pos.x, P.pos.z)) { GAME.playerDrown(); return; }
  // vertical: stand on the surface below (street or rooftop); walk off an edge and fall
  var surf = GAME.city.surfaceY(P.pos.x, P.pos.z);
  if (P.pos.y > surf + 0.06) {
    P.velY = (P.velY || 0) - 22 * dt;
    P.pos.y += P.velY * dt;
    if (P.pos.y <= surf) {
      var impact = -(P.velY || 0);
      P.pos.y = surf; P.velY = 0;
      if (impact > 12) {
        GAME.playerDamage(Math.min(95, (impact - 12) * 6), 'fall');
        GAME.cameraShake = Math.min(1, impact / 18);
      }
    }
  } else {
    P.pos.y = surf; P.velY = 0;
  }
  P.mesh.rotation.y = P.heading;

  // walk anim
  P.walkPhase = (P.walkPhase || 0) + P.moveSpeed * dt * 2.2;
  var j = P.mesh.userData.joints;
  var s = Math.sin(P.walkPhase) * Math.min(1, P.moveSpeed / 2.5) * 0.7;
  j.legL.rotation.x = s; j.legR.rotation.x = -s;
  if (aiming && P.currentWeapon !== 'fist') {
    j.armR.rotation.x = -Math.PI / 2 + GAME.cam.pitch * 0.5;
    j.armL.rotation.x = -s * 0.4;
  } else {
    j.armL.rotation.x = -s * 0.8;
    j.armR.rotation.x = s * 0.8;
  }

  if (wantsEnter()) {
    var car = nearestEnterableCar();
    if (car) GAME.enterCar(car);
  }
  GAME.audio.engineState(false, 0);
}

function updateDriving(dt) {
  var P = GAME.player, inp = GAME.input, T = inp.touch;
  var car = P.car;
  if (!car || car.dead) {
    if (car && car.dead) forceExitCar();
    return;
  }
  if (car.spec.heli || car.spec.plane) {
    if (wantsEnter()) {
      var gy = GAME.city.groundY(car.pos.x, car.pos.z);
      if (car.pos.y > gy + 3.5) {
        car.occupied = null; // the abandoned airframe is now ownerless (it will fall)
        GAME.aircraft.startParachute(car.pos.x, car.pos.y, car.pos.z, car.heading);
      } else forceExitCar();
      return;
    }
    if (car.spec.plane) GAME.aircraft.updatePlane(dt);
    else GAME.aircraft.updateHeli(dt);
    if (GAME.keyPressed('Comma')) GAME.hud.radioPopup(GAME.audio.radio.switchStation(-1));
    if (GAME.keyPressed('Period')) GAME.hud.radioPopup(GAME.audio.radio.switchStation(1));
    return;
  }
  var c = car.controls;
  if (GAME.autopilot) {
    if (!car.ai || car.ai.mode !== 'traffic') car.ai = { mode: 'traffic', desired: 13, laneX: 0, laneZ: 0 };
    var tc = GAME.vehicles.trafficControls(car, dt);
    c.throttle = tc.throttle; c.steer = tc.steer; c.handbrake = false;
  } else {
    // steering: positive heading delta turns left in this parametrization, so D maps to -1
    var th = 0, st = 0;
    if (GAME.key('KeyW')) th += 1;
    if (GAME.key('KeyS')) th -= 1;
    if (GAME.key('KeyA')) st += 1;
    if (GAME.key('KeyD')) st -= 1;
    if (T.active) {
      th += (T.gas ? 1 : 0) + (T.brake ? -1 : 0);
      st -= T.stickX;
    }
    c.throttle = U.clamp(th, -1, 1);
    c.steer = U.clamp(st, -1, 1);
    c.handbrake = GAME.key('Space') || T.handbrake;
  }

  var sp = Math.abs(car.speed);
  GAME.audio.engineState(true, sp / car.spec.maxSpeed);
  var slide = Math.abs(car.lat);
  GAME.audio.skid(slide > 2.5 || (c.handbrake && sp > 8) ? Math.min(1, slide / 8 + 0.3) : 0);

  if (wantsEnter()) { forceExitCar(); return; }

  if (P.onBike) updateBikeRider(dt);

  // radio switching
  if (GAME.keyPressed('Comma')) GAME.hud.radioPopup(GAME.audio.radio.switchStation(-1));
  if (GAME.keyPressed('Period')) GAME.hud.radioPopup(GAME.audio.radio.switchStation(1));
}

function updateBikeRider(dt) {
  var P = GAME.player, car = P.car;
  // lean the bike into turns / slides
  var lean = U.clamp(-car.controls.steer * Math.min(1, Math.abs(car.speed) / 12) * 0.5 - car.lat * 0.03, -0.6, 0.6);
  car.mesh.rotation.z = U.lerp(car.mesh.rotation.z, lean, Math.min(1, dt * 8));
  // seat the rider low on the saddle, sharing the bike's lean, straddling it
  var m = P.mesh;
  m.visible = true;
  m.position.set(car.pos.x, car.pos.y - 0.02, car.pos.z);
  m.rotation.set(0, car.heading, car.mesh.rotation.z);
  m.translateZ(-0.35); // sit back on the seat
  var j = m.userData.joints;
  j.torso.rotation.x = 0.34;                          // lean toward the bars
  j.legL.rotation.x = -0.55; j.legR.rotation.x = -0.55;
  j.legL.rotation.z = 0.2; j.legR.rotation.z = -0.2;  // knees out around the tank
  j.armL.rotation.x = -1.05; j.armR.rotation.x = -1.05; // hands on the handlebars
}

var pressedCache = {};
GAME.keyPressed = function (code) {
  var down = GAME.key(code);
  var fired = down && !pressedCache[code];
  pressedCache[code] = down;
  return fired;
};

function updateCamera(dt) {
  var P = GAME.player, inp = GAME.input, cam = GAME.cam;
  var mdx = inp.mouseDX, mdy = inp.mouseDY;
  inp.mouseDX = 0; inp.mouseDY = 0;
  if (inp.touch.camDX) { mdx += inp.touch.camDX; mdy += inp.touch.camDY; inp.touch.camDX = 0; inp.touch.camDY = 0; }

  var aiming = GAME.combat.aiming && !P.inCar;

  if (P.inCar && P.car) {
    if (Math.abs(mdx) > 1 || Math.abs(mdy) > 1) cam.freeT = 2.2;
    cam.freeT = Math.max(0, cam.freeT - dt);
    if (cam.freeT > 0) {
      cam.yaw -= mdx * 0.0032;
      cam.pitch = U.clamp(cam.pitch + mdy * 0.002, 0.08, 1.1);
    } else {
      var behind = P.car.heading + (P.car.speed < -2 ? Math.PI : 0);
      cam.yaw = U.angleLerp(cam.yaw, behind, Math.min(1, dt * 2.4));
      cam.pitch = U.damp(cam.pitch, 0.26, 2, dt);
    }
    var heli = P.car.spec.heli, plane = P.car.spec.plane;
    var sp = heli ? Math.abs(P.car.heliSpeed || 0) : Math.abs(P.car.speed);
    var base = plane ? 16 : heli ? 13 : 7.2;
    cam.dist = U.damp(cam.dist, base + sp * (plane ? 0.06 : 0.13), 3, dt);
  } else {
    cam.yaw -= mdx * 0.0032;
    cam.pitch = U.clamp(cam.pitch + mdy * 0.002, -0.15, 1.2);
    cam.dist = U.damp(cam.dist, aiming ? 3.1 : 5.6, 6, dt);
  }

  var focus = P.inCar && P.car ? P.car.pos : P.pos;
  var fy = focus.y + (P.inCar ? 1.7 : 1.55);
  var fx = focus.x, fz = focus.z;
  if (aiming) {
    // over-the-shoulder offset
    fx += Math.sin(cam.yaw + Math.PI / 2) * 0.75;
    fz += Math.cos(cam.yaw + Math.PI / 2) * 0.75;
  }
  var cy = fy + Math.sin(cam.pitch) * cam.dist + (P.inCar ? 0.6 : 0);
  var horiz = Math.cos(cam.pitch) * cam.dist;
  var cx = fx - Math.sin(cam.yaw) * horiz;
  var cz = fz - Math.cos(cam.yaw) * horiz;

  // pull camera in when a building blocks the view
  var boxes = GAME.city.hash.query((fx + cx) / 2, (fz + cz) / 2, cam.dist + 2);
  var dirX = cx - fx, dirZ = cz - fz;
  var bestT = 1;
  for (var i = 0; i < boxes.length; i++) {
    var b = boxes[i];
    if (b.noLOS || (b.h && b.h < cy - 1)) continue;
    var t = rayAABB(fx, fz, dirX, dirZ, b);
    if (t < bestT) bestT = Math.max(0.12, t - 0.05);
  }
  cx = fx + dirX * bestT; cz = fz + dirZ * bestT;
  cy = fy + (cy - fy) * (0.4 + 0.6 * bestT);

  if (GAME.cameraShake > 0.01) {
    GAME.cameraShake *= Math.exp(-5 * dt);
    cx += (Math.random() - 0.5) * GAME.cameraShake * 0.6;
    cy += (Math.random() - 0.5) * GAME.cameraShake * 0.5;
    cz += (Math.random() - 0.5) * GAME.cameraShake * 0.6;
  }

  cam.x = U.damp(cam.x || cx, cx, 20, dt);
  cam.y = U.damp(cam.y || cy, cy, 20, dt);
  cam.z = U.damp(cam.z || cz, cz, 20, dt);
  GAME.cameraObj.position.set(cam.x, Math.max(cam.y, GAME.city.groundY(cam.x, cam.z) + 0.5), cam.z);
  var lookY = fy + (aiming ? Math.tan(-cam.pitch + 0.2) * 10 * 0 : 0);
  GAME.cameraObj.lookAt(fx + Math.sin(cam.yaw) * 4 * (aiming ? 1 : 0), lookY, fz + Math.cos(cam.yaw) * 4 * (aiming ? 1 : 0));
}
