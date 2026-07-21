GAME.resolveCircle = function (x, z, r, feetY) {
  var boxes = GAME.city.hash.query(x, z, r + 1);
  for (var i = 0; i < boxes.length; i++) {
    var b = boxes[i];
    // if the entity is standing on top of this box (a rooftop), don't shove it off
    if (feetY !== undefined && b.h !== undefined && b.h <= feetY + 0.2) continue;
    var cx = U.clamp(x, b.minX, b.maxX), cz = U.clamp(z, b.minZ, b.maxZ);
    var dx = x - cx, dz = z - cz;
    var d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 < 0.0001) {
        // center inside the box: push out along smallest penetration
        var pl = x - b.minX, pr = b.maxX - x, pt = z - b.minZ, pb = b.maxZ - z;
        var m = Math.min(pl, pr, pt, pb);
        if (m === pl) x = b.minX - r; else if (m === pr) x = b.maxX + r;
        else if (m === pt) z = b.minZ - r; else z = b.maxZ + r;
      } else {
        var d = Math.sqrt(d2);
        x = cx + dx / d * r; z = cz + dz / d * r;
      }
    }
  }
  return { x: x, z: z };
};

function buildPedMesh(opts) {
  opts = opts || {};
  var g = new THREE.Group();
  var shirtColors = [0xf7a8c4, 0x9fe8d8, 0xf9d99a, 0x8fd0f0, 0xe86a8a, 0x8a6ae8, 0xf0f0e8, 0x60c890];
  var pantColors = [0x3a4a68, 0x684a3a, 0x2a2a34, 0x8a4a5a, 0xd8d0c0];
  var skins = [0xeac8a8, 0xc89878, 0x8a6848, 0x6a4c34, 0xf0d8c0];
  var shirt = opts.cop ? 0x2a4a8a : U.pick(Math.random, shirtColors);
  var pants = opts.cop ? 0x1a2a4a : U.pick(Math.random, pantColors);
  var skin = U.pick(Math.random, skins);
  var mats = {
    shirt: new THREE.MeshLambertMaterial({ color: shirt }),
    pants: new THREE.MeshLambertMaterial({ color: pants }),
    skin: new THREE.MeshLambertMaterial({ color: skin })
  };
  var torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.26), mats.shirt);
  torso.position.y = 1.12;
  g.add(torso);
  var head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), mats.skin);
  head.position.y = 1.6;
  g.add(head);
  if (opts.cop) {
    var cap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.3), mats.pants);
    cap.position.y = 1.78;
    g.add(cap);
  }
  function limb(w, len, mat, x, y) {
    var pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), mat);
    m.position.y = -len / 2;
    pivot.add(m);
    g.add(pivot);
    return pivot;
  }
  var armL = limb(0.13, 0.58, mats.shirt, -0.3, 1.38);
  var armR = limb(0.13, 0.58, mats.shirt, 0.3, 1.38);
  var legL = limb(0.16, 0.8, mats.pants, -0.13, 0.82);
  var legR = limb(0.16, 0.8, mats.pants, 0.13, 0.82);
  g.userData.joints = { armL: armL, armR: armR, legL: legL, legR: legR, head: head, torso: torso };
  return g;
}

GAME.peds = (function () {
  var world = GAME.world;

  function spawnPed(x, z, opts) {
    opts = opts || {};
    var mesh = buildPedMesh(opts);
    mesh.position.set(x, GAME.city.groundY(x, z), z);
    GAME.scene.add(mesh);
    var ped = {
      kind: 'ped',
      mesh: mesh, pos: mesh.position,
      heading: Math.random() * Math.PI * 2,
      state: 'walk', speed: 0,
      walkPhase: Math.random() * 6,
      hp: opts.cop ? 60 : 30,
      isCop: !!opts.cop,
      armed: !!opts.cop,
      fleeT: 0, diveT: 0, deadT: 0,
      wpX: x, wpZ: z, wpT: 0,
      shootT: U.randRange(Math.random, 0.5, 1.5)
    };
    world.peds.push(ped);
    return ped;
  }

  function removePed(ped) {
    var i = world.peds.indexOf(ped);
    if (i >= 0) world.peds.splice(i, 1);
    GAME.scene.remove(ped.mesh);
    disposeTree(ped.mesh);
  }

  function kill(ped, cause, byPlayer) {
    if (ped.dead) return;
    ped.dead = true;
    ped.state = 'dead';
    ped.deadT = 0;
    GAME.fx.spawn(ped.pos.x, 1.1, ped.pos.z, { count: 7, color: 0xc42848, spread: 1.6, vy: 1.5, life: 0.4, grav: -3 });
    GAME.audio.yelp();
    ped.mesh.rotation.x = Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
    ped.mesh.position.y = GAME.city.groundY(ped.pos.x, ped.pos.z) + 0.35;
    if (byPlayer) {
      if (ped.isCop) GAME.police.reportCrime('kill_cop', ped.pos);
      else GAME.police.reportCrime('kill_ped', ped.pos);
      GAME.missions.notifyChaos(ped.isCop ? 400 : 150);
    }
    // drops
    if (ped.isCop) GAME.combat.dropPickup(ped.pos.x, ped.pos.z, 'pistol');
    else if (Math.random() < 0.35) GAME.combat.dropPickup(ped.pos.x, ped.pos.z, 'cash');
    panic(ped.pos.x, ped.pos.z, 26);
  }

  function panic(x, z, r) {
    var r2 = r * r;
    for (var i = 0; i < world.peds.length; i++) {
      var p = world.peds[i];
      if (p.dead || p.isCop) continue;
      if (U.dist2(p.pos.x, p.pos.z, x, z) < r2) {
        p.state = 'flee';
        p.fleeT = U.randRange(Math.random, 4, 8);
        p.fleeX = x; p.fleeZ = z;
        if (Math.random() < 0.4) GAME.audio.yelp();
      }
    }
  }

  function newWaypoint(ped) {
    var a = Math.random() * Math.PI * 2;
    var x = ped.pos.x + Math.cos(a) * U.randRange(Math.random, 25, 60);
    var z = ped.pos.z + Math.sin(a) * U.randRange(Math.random, 25, 60);
    var rp = GAME.city.nearestRoadPoint(x, z);
    var off = 8.4 * (Math.random() < 0.5 ? 1 : -1);
    if (rp.axis === 'z') { ped.wpX = rp.x + off; ped.wpZ = rp.z; }
    else { ped.wpX = rp.x; ped.wpZ = rp.z + off; }
    ped.wpX = U.clamp(ped.wpX, -490, 368);
    ped.wpZ = U.clamp(ped.wpZ, -490, 490);
    ped.wpT = U.randRange(Math.random, 10, 20);
  }

  function animateWalk(ped, dt) {
    ped.walkPhase += ped.speed * dt * 2.2;
    var j = ped.mesh.userData.joints;
    var s = Math.sin(ped.walkPhase) * Math.min(1, ped.speed / 2.2) * 0.7;
    j.legL.rotation.x = s; j.legR.rotation.x = -s;
    if (!ped.aimPose) { j.armL.rotation.x = -s * 0.8; j.armR.rotation.x = s * 0.8; }
  }

  function update(dt) {
    var P = GAME.player;
    var fc = GAME.focus();
    for (var i = world.peds.length - 1; i >= 0; i--) {
      var ped = world.peds[i];
      var d2p = U.dist2(ped.pos.x, ped.pos.z, fc.x, fc.z);
      if (ped.dead) {
        ped.deadT += dt;
        if (ped.deadT > 12 || d2p > 190 * 190) removePed(ped);
        continue;
      }
      if (!ped.isCop && !ped.jobPed && d2p > 180 * 180) { removePed(ped); continue; }
      if (ped.isCop) continue; // driven by police.js

      // dive away from fast cars
      if (ped.state !== 'dive') {
        for (var c = 0; c < world.cars.length; c++) {
          var car = world.cars[c];
          var sp = Math.abs(car.speed);
          if (sp < 8) continue;
          var dx = ped.pos.x - car.pos.x, dz = ped.pos.z - car.pos.z;
          var d2 = dx * dx + dz * dz;
          if (d2 > 140) continue;
          var fx = Math.sin(car.heading), fz = Math.cos(car.heading);
          var ahead = dx * fx + dz * fz;
          if (ahead > 0 && ahead < 12 && Math.abs(dx * fz - dz * fx) < 3) {
            ped.state = 'dive';
            ped.diveT = 0.9;
            var side = (dx * fz - dz * fx) > 0 ? 1 : -1;
            ped.diveX = (fz * side) * 5; ped.diveZ = (-fx * side) * 5;
            GAME.audio.yelp();
            break;
          }
        }
      }

      if (ped.state === 'walk') {
        ped.wpT -= dt;
        var wd2 = U.dist2(ped.pos.x, ped.pos.z, ped.wpX, ped.wpZ);
        if (wd2 < 4 || ped.wpT <= 0) newWaypoint(ped);
        var th = Math.atan2(ped.wpX - ped.pos.x, ped.wpZ - ped.pos.z);
        ped.heading = U.angleLerp(ped.heading, th, Math.min(1, dt * 4));
        ped.speed = U.damp(ped.speed, 1.5, 3, dt);
      } else if (ped.state === 'flee') {
        ped.fleeT -= dt;
        var fh = Math.atan2(ped.pos.x - ped.fleeX, ped.pos.z - ped.fleeZ);
        ped.heading = U.angleLerp(ped.heading, fh + Math.sin(GAME.time * 3 + i) * 0.5, Math.min(1, dt * 5));
        ped.speed = U.damp(ped.speed, 4.6, 4, dt);
        if (ped.fleeT <= 0) { ped.state = 'walk'; newWaypoint(ped); }
      } else if (ped.state === 'dive') {
        ped.diveT -= dt;
        ped.pos.x += ped.diveX * dt; ped.pos.z += ped.diveZ * dt;
        ped.mesh.rotation.x = U.lerp(ped.mesh.rotation.x, -1.2, dt * 8);
        if (ped.diveT <= 0) {
          ped.mesh.rotation.x = 0;
          ped.state = 'flee';
          ped.fleeT = 5;
          ped.fleeX = ped.pos.x - Math.sin(ped.heading); ped.fleeZ = ped.pos.z - Math.cos(ped.heading);
        }
      }

      if (ped.state !== 'dive') {
        ped.pos.x += Math.sin(ped.heading) * ped.speed * dt;
        ped.pos.z += Math.cos(ped.heading) * ped.speed * dt;
        ped.mesh.rotation.y = ped.heading;
      }
      var rp2 = GAME.resolveCircle(ped.pos.x, ped.pos.z, 0.4);
      ped.pos.x = rp2.x; ped.pos.z = rp2.z;
      if (GAME.city.isInWater(ped.pos.x, ped.pos.z)) { removePed(ped); continue; }
      if (!ped.jobPed && GAME.city.inAirport(ped.pos.x, ped.pos.z)) { removePed(ped); continue; }
      ped.pos.y = GAME.city.groundY(ped.pos.x, ped.pos.z);
      animateWalk(ped, dt);

      // run over check
      for (var c2 = 0; c2 < world.cars.length; c2++) {
        var car2 = world.cars[c2];
        var sp2 = Math.abs(car2.speed);
        if (sp2 < 4) continue;
        if (U.dist2(ped.pos.x, ped.pos.z, car2.pos.x, car2.pos.z) < 2.6) {
          var byPlayer = (car2 === P.car && P.inCar);
          kill(ped, 'car', byPlayer);
          if (byPlayer) GAME.police.reportCrime('hit_ped', ped.pos);
          GAME.audio.crash(0.4);
          break;
        }
      }
    }
    if (GAME.frame % 20 === 5) spawnBubble();
  }

  function spawnBubble() {
    var fc = GAME.focus();
    var live = 0;
    for (var i = 0; i < world.peds.length; i++) if (!world.peds[i].isCop && !world.peds[i].dead) live++;
    var maxP = GAME.settings.maxPeds;
    for (var tries = 0; tries < 5 && live < maxP; tries++) {
      var a = Math.random() * Math.PI * 2;
      var r = U.randRange(Math.random, 60, GAME.settings.bubbleRadius);
      var x = fc.x + Math.cos(a) * r, z = fc.z + Math.sin(a) * r;
      if (x > 340) x = U.randRange(Math.random, 356, 372); // boardwalk strollers
      var rp = GAME.city.nearestRoadPoint(x, z);
      var off = 8.4 * (Math.random() < 0.5 ? 1 : -1);
      var px = rp.axis === 'z' ? rp.x + off : rp.x;
      var pz = rp.axis === 'z' ? rp.z : rp.z + off;
      if (x > 340) { px = x; pz = z; }
      if (px < -490 || px > 372 || Math.abs(pz) > 490) continue;
      if (GAME.city.isInWater(px, pz)) continue;
      if (GAME.city.inAirport(px, pz)) continue; // no strollers on the runway
      var ped = spawnPed(px, pz);
      newWaypoint(ped);
      live++;
    }
  }

  function damage(ped, amt, byPlayer) {
    if (ped.dead) return;
    ped.hp -= amt;
    GAME.fx.spawn(ped.pos.x, 1.2, ped.pos.z, { count: 3, color: 0xc42848, spread: 1, vy: 1, life: 0.3, grav: -3 });
    if (ped.hp <= 0) kill(ped, 'shot', byPlayer);
    else if (!ped.isCop) {
      ped.state = 'flee';
      ped.fleeT = 6;
      ped.fleeX = GAME.player.pos.x; ped.fleeZ = GAME.player.pos.z;
    }
  }

  return { spawnPed: spawnPed, removePed: removePed, kill: kill, panic: panic, damage: damage, update: update, buildPedMesh: buildPedMesh };
})();
