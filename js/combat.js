var WEAPONS = {
  fist: { name: 'FISTS', slot: 1, damage: 14, range: 2.0, rate: 0.42, auto: false },
  pistol: { name: 'PISTOL', slot: 2, damage: 26, range: 60, rate: 0.34, auto: false, spread: 0.012 },
  smg: { name: 'SMG', slot: 3, damage: 11, range: 48, rate: 0.085, auto: true, spread: 0.045, driveby: true },
  shotgun: { name: 'SHOTGUN', slot: 4, damage: 11, range: 24, rate: 0.95, auto: false, spread: 0.085, pellets: 7 }
};
var WEAPON_ORDER = ['fist', 'pistol', 'smg', 'shotgun'];

GAME.combat = (function () {
  var aiming = false, lockTarget = null, lockIdx = 0;
  var cooldown = 0, aimToggle = false;
  var reticle = null;

  function initReticle() {
    reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.7, 20),
      new THREE.MeshBasicMaterial({ color: 0x8dffd8, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false })
    );
    reticle.visible = false;
    reticle.renderOrder = 5;
    GAME.scene.add(reticle);
  }

  function candidates() {
    var P = GAME.player, cam = GAME.cam;
    var list = [];
    var peds = GAME.world.peds;
    for (var i = 0; i < peds.length; i++) {
      var t = peds[i];
      if (t.dead) continue;
      var dx = t.pos.x - P.pos.x, dz = t.pos.z - P.pos.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d > 44 || d < 0.5) continue;
      var ang = Math.abs(U.wrapPI(Math.atan2(dx, dz) - cam.yaw));
      if (ang > 0.75) continue;
      if (!GAME.city.hash.segmentClear(P.pos.x, P.pos.z, t.pos.x, t.pos.z)) continue;
      list.push({ t: t, score: ang * 30 + d });
    }
    // vehicles are lockable too (pursuing cruisers etc.), weighted after people
    var cars = GAME.world.cars;
    for (var ci = 0; ci < cars.length; ci++) {
      var car = cars[ci];
      if (car.dead || car === P.car) continue;
      var cdx = car.pos.x - P.pos.x, cdz = car.pos.z - P.pos.z;
      var cd = Math.sqrt(cdx * cdx + cdz * cdz);
      if (cd > 44 || cd < 0.5) continue;
      var cang = Math.abs(U.wrapPI(Math.atan2(cdx, cdz) - cam.yaw));
      if (cang > 0.7) continue;
      if (!GAME.city.hash.segmentClear(P.pos.x, P.pos.z, car.pos.x, car.pos.z)) continue;
      list.push({ t: car, score: cang * 30 + cd + 14 });
    }
    list.sort(function (a, b) { return a.score - b.score; });
    return list.map(function (e) { return e.t; });
  }

  function setAiming(on) {
    if (on === aiming) return;
    aiming = on;
    if (on) {
      var c = candidates();
      lockTarget = c.length ? c[0] : null;
      lockIdx = 0;
    } else {
      lockTarget = null;
    }
    document.getElementById('crosshair').style.display = (on && !GAME.player.inCar) ? 'block' : 'none';
  }

  function cycleTarget(dir) {
    var c = candidates();
    if (!c.length) { lockTarget = null; return; }
    if (!lockTarget) { lockTarget = c[0]; lockIdx = 0; return; }
    var cur = c.indexOf(lockTarget);
    if (cur < 0) cur = 0;
    lockTarget = c[(cur + dir + c.length) % c.length];
  }

  function muzzlePos() {
    var P = GAME.player;
    if (P.inCar && P.car) return { x: P.car.pos.x, y: P.car.pos.y + 1.0, z: P.car.pos.z };
    return { x: P.pos.x + Math.sin(P.heading) * 0.4, y: P.pos.y + 1.35, z: P.pos.z + Math.cos(P.heading) * 0.4 };
  }

  // hitscan against peds, cars, buildings; returns nearest hit
  function raycast(ox, oy, oz, dirX, dirZ, maxRange, ignoreCar) {
    var bestT = maxRange, hit = null;
    var peds = GAME.world.peds;
    for (var i = 0; i < peds.length; i++) {
      var p = peds[i];
      if (p.dead) continue;
      var t = rayCircle(ox, oz, dirX, dirZ, p.pos.x, p.pos.z, 0.55);
      if (t >= 0 && t < bestT) { bestT = t; hit = { kind: 'ped', obj: p, t: t }; }
    }
    var cars = GAME.world.cars;
    for (var c = 0; c < cars.length; c++) {
      var car = cars[c];
      if (car === ignoreCar) continue;
      var tc = rayCircle(ox, oz, dirX, dirZ, car.pos.x, car.pos.z, car.radius * 0.9);
      if (tc >= 0 && tc < bestT) { bestT = tc; hit = { kind: 'car', obj: car, t: tc }; }
    }
    var boxes = GAME.city.hash.query(ox + dirX * bestT / 2, oz + dirZ * bestT / 2, bestT / 2 + 15);
    for (var b = 0; b < boxes.length; b++) {
      if (boxes[b].noLOS) continue;
      var tb = rayAABB(ox, oz, dirX, dirZ, boxes[b]);
      if (tb < bestT) { bestT = tb; hit = { kind: 'wall', t: tb }; }
    }
    return { t: bestT, hit: hit };
  }

  function rayCircle(ox, oz, dx, dz, cx, cz, r) {
    var mx = ox - cx, mz = oz - cz;
    var b = mx * dx + mz * dz;
    var c = mx * mx + mz * mz - r * r;
    if (c > 0 && b > 0) return -1;
    var disc = b * b - c;
    if (disc < 0) return -1;
    var t = -b - Math.sqrt(disc);
    return t < 0 ? 0 : t;
  }

  function fireGun(w, dirYaw, isDriveBy) {
    var P = GAME.player;
    var wd = WEAPONS[w];
    var m = muzzlePos();
    var inv = P.weapons[w];
    if (!inv || inv.ammo <= 0) { GAME.audio.ricochet(); return; }
    inv.ammo--;
    GAME.audio.gunshot(w);
    GAME.fx.flash(m.x + Math.sin(dirYaw) * 0.6, m.y, m.z + Math.cos(dirYaw) * 0.6, 0.8);
    var pellets = wd.pellets || 1;
    for (var p = 0; p < pellets; p++) {
      var yaw = dirYaw + (Math.random() - 0.5) * 2 * wd.spread * (pellets > 1 ? 2.2 : 1);
      var dx = Math.sin(yaw), dz = Math.cos(yaw);
      var res = raycast(m.x, m.y, m.z, dx, dz, wd.range, P.car);
      var t = res.t;
      var ey = m.y + (lockTarget && !isDriveBy ? (lockTarget.pos.y + 1.1 - m.y) * Math.min(1, t / Math.max(1, U.dist(m.x, m.z, lockTarget.pos.x, lockTarget.pos.z))) : 0);
      GAME.fx.tracer(m.x, m.y, m.z, m.x + dx * t, ey, m.z + dz * t);
      if (res.hit) {
        var hx = m.x + dx * t, hz = m.z + dz * t;
        if (res.hit.kind === 'ped') {
          GAME.peds.damage(res.hit.obj, wd.damage, true);
        } else if (res.hit.kind === 'car') {
          GAME.vehicles.damageCar(res.hit.obj, wd.damage * 0.8, 'gun');
          GAME.fx.spawn(hx, 0.8, hz, { count: 3, color: 0xffe0a0, spread: 2, life: 0.3 });
          if (res.hit.obj.ai && res.hit.obj.ai.mode === 'traffic') GAME.police.reportCrime('shoot_car', P.pos);
        } else {
          GAME.fx.spawn(hx, m.y, hz, { count: 3, color: 0xccccdd, spread: 1.5, life: 0.25 });
          if (Math.random() < 0.4) GAME.audio.ricochet();
        }
      }
    }
    GAME.police.noteGunfire(P.pos);
    GAME.peds.panic(P.pos.x, P.pos.z, 30);
    GAME.missions.notifyChaos(2);
    refreshWeaponHud();
  }

  function punch() {
    var P = GAME.player;
    GAME.audio.punch();
    var fx = Math.sin(P.heading), fz = Math.cos(P.heading);
    var px = P.pos.x + fx * 1.2, pz = P.pos.z + fz * 1.2;
    var peds = GAME.world.peds;
    for (var i = 0; i < peds.length; i++) {
      var p = peds[i];
      if (p.dead) continue;
      if (U.dist2(p.pos.x, p.pos.z, px, pz) < 1.7) {
        GAME.peds.damage(p, WEAPONS.fist.damage, true);
        GAME.police.reportCrime('hit_ped', P.pos);
        GAME.missions.notifyChaos(20);
        return;
      }
    }
    var car = GAME.vehicles.findNearestCar(px, pz, 2.2, P.car);
    if (car) {
      GAME.vehicles.damageCar(car, 6, 'fist');
      GAME.fx.spawn(px, 1, pz, { count: 3, color: 0xffe0a0, spread: 1, life: 0.3 });
    }
  }

  function update(dt) {
    var P = GAME.player, inp = GAME.input, T = inp.touch;
    cooldown -= dt;
    if (P.state !== 'alive' || P.entering) { setAiming(false); inp.lmbPressed = false; return; }

    // weapon select
    for (var i = 0; i < WEAPON_ORDER.length; i++) {
      if (GAME.keyPressed('Digit' + (i + 1))) selectWeapon(WEAPON_ORDER[i]);
    }
    if (T.weaponCycle) {
      T.weaponCycle = false;
      var have = WEAPON_ORDER.filter(function (w) { return P.weapons[w] && P.weapons[w].have; });
      var idx = have.indexOf(P.currentWeapon);
      selectWeapon(have[(idx + 1) % have.length]);
    }

    if (GAME.keyPressed('Tab')) aimToggle = !aimToggle;
    var aimHeld = inp.rmb || aimToggle || T.aim;
    setAiming(aimHeld && !P.inCar);

    if (aiming) {
      if (GAME.keyPressed('KeyQ')) cycleTarget(-1);
      if (GAME.keyPressed('KeyE')) cycleTarget(1);
      if (inp.wheel !== 0) { cycleTarget(inp.wheel > 0 ? 1 : -1); inp.wheel = 0; }
      if (lockTarget && (lockTarget.dead || U.dist2(lockTarget.pos.x, lockTarget.pos.z, P.pos.x, P.pos.z) > 2600)) {
        var c = candidates();
        lockTarget = c.length ? c[0] : null;
      }
      if (!lockTarget && GAME.frame % 20 === 0) {
        var c2 = candidates();
        if (c2.length) lockTarget = c2[0];
      }
    } else {
      inp.wheel = 0;
    }

    if (reticle) {
      if (aiming && lockTarget) {
        reticle.visible = true;
        reticle.position.set(lockTarget.pos.x, lockTarget.pos.y + 1.1, lockTarget.pos.z);
        reticle.lookAt(GAME.cameraObj.position);
        var sc = 1 + 0.12 * Math.sin(GAME.time * 8);
        reticle.scale.setScalar(sc);
      } else reticle.visible = false;
    }

    var w = P.currentWeapon, wd = WEAPONS[w];
    if (P.weaponMesh) P.weaponMesh.visible = (w !== 'fist' && !P.inCar);

    // drive-by: Q/E pick a side; LMB (or FIRE) alone fires toward the side you're
    // looking, matching the on-screen prompt "LMB — Fire (drive-by w/ SMG)"
    if (P.inCar) {
      var hasSMG = P.weapons.smg && P.weapons.smg.have && P.weapons.smg.ammo > 0;
      var left = GAME.key('KeyQ') || T.driveByL;
      var right = GAME.key('KeyE') || T.driveByR;
      var fireBtn = inp.lmb || T.fire;
      if (hasSMG && (left || right || fireBtn)) {
        if (cooldown <= 0) {
          cooldown = WEAPONS.smg.rate;
          // left of travel = heading + pi/2 in this parametrization
          var side;
          if (left) side = 1;
          else if (right) side = -1;
          else side = U.wrapPI(GAME.cam.yaw - P.car.heading) > 0 ? 1 : -1;
          var yaw = P.car.heading + side * Math.PI / 2 + (Math.random() - 0.5) * 0.15;
          fireGun('smg', yaw, true);
        }
      }
      inp.lmbPressed = false;
      return;
    }

    // on-foot firing
    var fireHeld = inp.lmb || T.fire;
    var firePressed = inp.lmbPressed || T.firePressed;
    inp.lmbPressed = false; T.firePressed = false;
    var wantFire = wd.auto ? fireHeld : firePressed;
    if (wantFire && cooldown <= 0) {
      cooldown = wd.rate;
      if (w === 'fist') punch();
      else {
        var yaw;
        if (aiming && lockTarget) {
          yaw = Math.atan2(lockTarget.pos.x - P.pos.x, lockTarget.pos.z - P.pos.z);
          P.heading = yaw;
        } else {
          yaw = GAME.cam.yaw;
          if (aiming) P.heading = yaw;
        }
        fireGun(w, yaw, false);
      }
    }
  }

  function selectWeapon(w) {
    var P = GAME.player;
    if (!w || !P.weapons[w] || !P.weapons[w].have) return;
    P.currentWeapon = w;
    refreshWeaponHud();
  }

  function giveWeapon(id, ammo) {
    var P = GAME.player;
    if (!WEAPONS[id]) return;
    if (!P.weapons[id]) P.weapons[id] = { have: true, ammo: 0 };
    P.weapons[id].have = true;
    if (id !== 'fist') P.weapons[id].ammo += (ammo || 30);
    P.currentWeapon = id;
    refreshWeaponHud();
  }

  function refreshWeaponHud() {
    var P = GAME.player;
    var wd = WEAPONS[P.currentWeapon];
    var inv = P.weapons[P.currentWeapon];
    GAME.hud.setWeapon(wd.name, P.currentWeapon === 'fist' ? '' : (inv ? inv.ammo : 0));
  }

  // ---------- pickups ----------
  var PICKUP_DEFS = {
    health: { color: 0xff4d6a, label: 'HEALTH' },
    armor: { color: 0x39c8ff, label: 'ARMOR' },
    pistol: { color: 0xd8d8e8, label: 'PISTOL AMMO' },
    smg: { color: 0xffe14f, label: 'SMG AMMO' },
    shotgun: { color: 0xff8a3d, label: 'SHOTGUN AMMO' },
    cash: { color: 0x8dffd8, label: 'CASH' }
  };

  // each pickup reads as the thing it gives: a pistol/SMG/shotgun silhouette,
  // a medical cross, a shield, or a cash bundle — instead of a generic cube
  function pickupShape(type, color) {
    var b = new GeoBatch();
    if (type === 'pistol') {
      b.addBox(0, 0.10, 0.06, 0.09, 0.13, 0.46, 0, color, 0);   // slide
      b.addBox(0, -0.06, -0.10, 0.08, 0.24, 0.13, 0.35, color, 0); // grip
      b.addBox(0, 0.02, 0.12, 0.05, 0.05, 0.10, 0, 0x2a2a34, 0);   // trigger guard
    } else if (type === 'smg') {
      b.addBox(0, 0.10, 0.00, 0.09, 0.14, 0.62, 0, color, 0);   // body
      b.addBox(0, -0.08, -0.06, 0.07, 0.22, 0.12, 0, color, 0);    // grip
      b.addBox(0, -0.02, 0.10, 0.06, 0.16, 0.10, 0, 0x2a2a34, 0);  // magazine
      b.addBox(0, 0.10, -0.40, 0.06, 0.09, 0.22, 0, 0x2a2a34, 0);  // stock
    } else if (type === 'shotgun') {
      b.addBox(0, 0.10, 0.10, 0.10, 0.11, 0.78, 0, color, 0);   // barrel
      b.addBox(0, 0.00, 0.10, 0.09, 0.09, 0.34, 0, 0x2a2a34, 0);   // pump
      b.addBox(0, 0.01, -0.40, 0.08, 0.20, 0.26, 0, color, 0);     // stock
    } else if (type === 'health') {
      b.addBox(0, 0.10, 0, 0.62, 0.20, 0.16, 0, color, 0);      // cross bar
      b.addBox(0, 0.10, 0, 0.20, 0.62, 0.16, 0, color, 0);      // cross post
    } else if (type === 'armor') {
      b.addBox(0, 0.16, 0, 0.46, 0.34, 0.14, 0, color, 0);      // shield body
      b.addBox(0, -0.10, 0, 0.26, 0.26, 0.14, 0, color, 0);     // tapered point
      b.addBox(0, 0.16, 0.08, 0.16, 0.16, 0.04, 0, 0xffffff, 0);   // emblem
    } else { // cash bundle
      b.addBox(0, 0.06, 0, 0.52, 0.10, 0.30, 0, color, 0);
      b.addBox(0, 0.17, 0, 0.50, 0.09, 0.28, 0.16, color, 0);
      b.addBox(0, 0.12, 0, 0.14, 0.24, 0.32, 0, 0x2a6a52, 0);      // paper band
    }
    return new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: color, emissiveIntensity: 0.55 }));
  }

  function pickupMesh(type) {
    var def = PICKUP_DEFS[type];
    var g = new THREE.Group();
    var core = pickupShape(type, def.color);
    core.position.y = 0.1;
    g.add(core);
    g.userData.core = core;
    var halo = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 16), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.5;
    g.add(halo);
    return g;
  }

  function initPickups() {
    initReticle();
    var spots = GAME.city.pickupSpots;
    for (var i = 0; i < spots.length; i++) {
      addPickup(spots[i].x, spots[i].z, spots[i].type, true);
    }
  }
  function addPickup(x, z, type, fixed) {
    var mesh = pickupMesh(type);
    mesh.position.set(x, GAME.city.groundY(x, z) + 1.0, z);
    GAME.scene.add(mesh);
    var p = { mesh: mesh, pos: mesh.position, type: type, fixed: !!fixed, respawnT: 0, ttl: fixed ? Infinity : 30, taken: false };
    GAME.world.pickups.push(p);
    return p;
  }
  function dropPickup(x, z, type) {
    if (GAME.world.pickups.length > 60) return;
    addPickup(x + (Math.random() - 0.5), z + (Math.random() - 0.5), type, false);
  }

  function updatePickups(dt) {
    var ps = GAME.world.pickups;
    for (var i = ps.length - 1; i >= 0; i--) {
      var p = ps[i];
      if (p.taken) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) { p.taken = false; p.mesh.visible = true; }
        continue;
      }
      if (!p.fixed) {
        p.ttl -= dt;
        if (p.ttl <= 0) { GAME.scene.remove(p.mesh); disposeTree(p.mesh); ps.splice(i, 1); continue; }
      }
      if (U.dist2(p.pos.x, p.pos.z, GAME.player.pos.x, GAME.player.pos.z) < 90 * 90) {
        p.mesh.rotation.y += dt * 2.4;
        p.mesh.children[0].position.y = 0.1 + 0.1 * Math.sin(GAME.time * 3 + i);
      }
    }
  }

  function checkPickups() {
    var P = GAME.player;
    var ps = GAME.world.pickups;
    for (var i = ps.length - 1; i >= 0; i--) {
      var p = ps[i];
      if (p.taken) continue;
      if (U.dist2(p.pos.x, p.pos.z, P.pos.x, P.pos.z) > 1.9) continue;
      var label = PICKUP_DEFS[p.type].label;
      if (p.type === 'health') { if (P.health >= 100) continue; P.health = Math.min(100, P.health + 50); }
      else if (p.type === 'armor') { if (P.armor >= 100) continue; P.armor = Math.min(100, P.armor + 50); }
      else if (p.type === 'cash') { var amt = 10 + Math.floor(Math.random() * 30); GAME.addCash(amt); label = '$' + amt; }
      else giveWeapon(p.type, p.type === 'pistol' ? 24 : p.type === 'smg' ? 50 : 10);
      GAME.audio.pickup();
      GAME.hud.message(label, 1.2);
      if (p.fixed) { p.taken = true; p.respawnT = 45; p.mesh.visible = false; }
      else { GAME.scene.remove(p.mesh); disposeTree(p.mesh); ps.splice(i, 1); }
    }
  }

  // shots fired by police at the player
  function npcShoot(fromX, fromY, fromZ, accuracy, damage) {
    var P = GAME.player;
    var tx = P.inCar && P.car ? P.car.pos.x : P.pos.x;
    var tz = P.inCar && P.car ? P.car.pos.z : P.pos.z;
    var yaw = Math.atan2(tx - fromX, tz - fromZ) + (Math.random() - 0.5) * (1 - accuracy) * 0.5;
    var dx = Math.sin(yaw), dz = Math.cos(yaw);
    var d = U.dist(fromX, fromZ, tx, tz);
    GAME.audio.gunshot('pistol');
    GAME.fx.tracer(fromX, fromY, fromZ, fromX + dx * d, 1.2, fromZ + dz * d);
    if (Math.random() < accuracy) {
      if (P.inCar && P.car) GAME.vehicles.damageCar(P.car, damage * 0.7, 'cop');
      else GAME.playerDamage(damage, 'shot');
    }
    return true;
  }

  return {
    WEAPONS: WEAPONS,
    get aiming() { return aiming; },
    get lockTarget() { return lockTarget; },
    update: update,
    updatePickups: updatePickups,
    checkPickups: checkPickups,
    initPickups: initPickups,
    giveWeapon: giveWeapon,
    selectWeapon: selectWeapon,
    dropPickup: dropPickup,
    refreshWeaponHud: refreshWeaponHud,
    npcShoot: npcShoot,
    setAimTouch: function (on) { GAME.input.touch.aim = on; }
  };
})();
