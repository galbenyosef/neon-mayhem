GAME.resolveCircle = function (x, z, r, feetY) {
  var boxes = GAME.city.hash.query(x, z, r + 1);
  for (var i = 0; i < boxes.length; i++) {
    var b = boxes[i];
    // if the entity is standing on top of this box (a rooftop), don't shove it off
    if (feetY !== undefined && b.h !== undefined && b.h <= feetY + 0.2) continue;
    // nor if the box belongs to a deck overhead — you walk under a bridge
    if (feetY !== undefined && b.minY !== undefined && feetY < b.minY - 1) continue;
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

// hair, built around the head's origin, and every style its own silhouette —
// when a flattop and a crew cut differ by six centimetres nobody can tell
// what the barber is selling. Everything stands proud of the head so no face
// is shared. 'buzz' returns null — bald is a choice now, not the rule.
function makeHair(style, colorHex) {
  if (style === 'buzz') return null;
  var g = new THREE.Group();
  // hair is never re-tinted in place — a new cut is a new mesh — so every
  // head of the same color shares one material and one box per shape
  var mat = sharedLambert(colorHex);
  function box(w, h, d, x, y, z) {
    var m = new THREE.Mesh(sharedBoxGeo(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  }
  switch (style) {
    case 'crew':       // short and tidy: low cap, trimmed back
      box(0.3, 0.1, 0.3, 0, 0.19, 0);
      box(0.3, 0.14, 0.06, 0, 0.08, -0.145);
      break;
    case 'flat':       // old saves called the flattop 'flat'
    case 'flattop':    // a proper landing pad, square and tall
      box(0.32, 0.3, 0.32, 0, 0.3, 0);
      break;
    case 'mohawk':     // a thin crest, nothing on the sides
      box(0.09, 0.3, 0.34, 0, 0.26, 0);
      break;
    case 'pompadour':  // swept up and forward, heavy over the brow
      box(0.3, 0.1, 0.3, 0, 0.19, 0);
      box(0.28, 0.22, 0.16, 0, 0.28, 0.08);
      break;
    case 'mullet':     // business up top, party down the neck
      box(0.3, 0.12, 0.3, 0, 0.2, 0);
      box(0.3, 0.34, 0.08, 0, -0.02, -0.16);
      break;
    case 'afro':       // full volume all round
      box(0.42, 0.3, 0.42, 0, 0.26, 0);
      box(0.36, 0.16, 0.36, 0, 0.06, -0.06);
      break;
    case 'ponytail':   // tight cap, tail out the back
      box(0.3, 0.1, 0.3, 0, 0.19, 0);
      box(0.09, 0.09, 0.2, 0, 0.16, -0.24);
      box(0.08, 0.3, 0.08, 0, -0.02, -0.3);
      break;
    default:           // unknown id: the crew cut is nobody's bad haircut
      box(0.3, 0.1, 0.3, 0, 0.19, 0);
      box(0.3, 0.14, 0.06, 0, 0.08, -0.145);
  }
  return g;
}

function buildPedMesh(opts) {
  opts = opts || {};
  var g = new THREE.Group();
  var shirtColors = [0xf7a8c4, 0x9fe8d8, 0xf9d99a, 0x8fd0f0, 0xe86a8a, 0x8a6ae8, 0xf0f0e8, 0x60c890];
  var pantColors = [0x3a4a68, 0x684a3a, 0x2a2a34, 0x8a4a5a, 0xd8d0c0];
  var skins = [0xeac8a8, 0xc89878, 0x8a6848, 0x6a4c34, 0xf0d8c0];
  var hairColors = [0x1c1a18, 0x5a3c22, 0x2e2018, 0xd8b86a, 0xa8482a, 0x8a8a90];
  // opts.look pins the whole appearance — the same person can step out of
  // the same car twice instead of a stranger wearing his job
  var look = opts.look || null;
  var shirt = opts.cop ? 0x2a4a8a : look ? look.shirt : U.pick(Math.random, shirtColors);
  var pants = opts.cop ? 0x1a2a4a : look ? look.pants : U.pick(Math.random, pantColors);
  var skin = look ? look.skin : U.pick(Math.random, skins);
  g.userData.look = { shirt: shirt, pants: pants, skin: skin };
  // The town shares its wardrobe: constant colors, constant box sizes, one
  // registry entry each — a ped spawn allocates wrappers, not buffers. The
  // PLAYER (and the wardrobe mirror) re-tints these materials in place, so
  // those two figures must own private copies or THREADS would dye every
  // pedestrian wearing the same shirt.
  var mats = opts.privateMats ? {
    shirt: new THREE.MeshLambertMaterial({ color: shirt }),
    pants: new THREE.MeshLambertMaterial({ color: pants }),
    skin: new THREE.MeshLambertMaterial({ color: skin })
  } : {
    shirt: sharedLambert(shirt),
    pants: sharedLambert(pants),
    skin: sharedLambert(skin)
  };
  var torso = new THREE.Mesh(sharedBoxGeo(0.46, 0.62, 0.26), mats.shirt);
  torso.position.y = 1.12;
  g.add(torso);
  var head = new THREE.Mesh(sharedBoxGeo(0.26, 0.28, 0.26), mats.skin);
  head.position.y = 1.6;
  g.add(head);
  if (opts.cop) {
    var cap = new THREE.Mesh(sharedBoxGeo(0.3, 0.1, 0.3), mats.pants);
    cap.position.y = 1.78;
    g.add(cap);
  } else if (!opts.noHair) {
    // nobody in this town is bald unless they paid the barber for it
    // (the player's own hair is the wardrobe's business — see shops.js)
    var styles = ['crew', 'crew', 'crew', 'flattop', 'flattop', 'pompadour', 'mullet', 'afro', 'ponytail', 'mohawk'];
    var hairStyle = look ? look.hair : U.pick(Math.random, styles);
    var hairCol = look ? look.hairCol : U.pick(Math.random, hairColors);
    var hair = makeHair(hairStyle, hairCol);
    if (hair) { hair.position.y = 1.6; g.add(hair); }
    g.userData.look.hair = hairStyle;
    g.userData.look.hairCol = hairCol;
  }
  function limb(w, len, mat, x, y) {
    var pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    var m = new THREE.Mesh(sharedBoxGeo(w, len, w), mat);
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
      // how quick this one is to swing back rather than run
      temper: Math.random(),
      fleeT: 0, diveT: 0, deadT: 0, attackT: 0, punchT: 0,
      // how alert this one is, and how long they take to react to a car
      dodgeSkill: Math.random(),
      reactDelay: U.randRange(Math.random, 0.15, 0.45), reactT: 0,
      wpX: x, wpZ: z, wpT: 0,
      shootT: U.randRange(Math.random, 0.5, 1.5)
    };
    ped.look = mesh.userData.look;   // so a car can remember who drives it
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
    // a dead owner can't come back for his car — forget him, so the next
    // jack doesn't raise him from the pavement
    if (ped.stolenCar && ped.stolenCar.lastDriver) ped.stolenCar.lastDriver = null;
    GAME.fx.spawn(ped.pos.x, 1.1, ped.pos.z, { count: 7, color: 0xc42848, spread: 1.6, vy: 1.5, life: 0.4, grav: -3 });
    GAME.audio.yelp(ped.pos.x, ped.pos.z);
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
      if (p.state === 'attack') continue;   // mid-brawl, past being scared off
      if (U.dist2(p.pos.x, p.pos.z, x, z) < r2) {
        p.state = 'flee';
        p.fleeT = U.randRange(Math.random, 4, 8);
        p.fleeX = x; p.fleeZ = z;
        if (Math.random() < 0.4) GAME.audio.yelp(p.pos.x, p.pos.z);
      }
    }
  }

  function newWaypoint(ped) {
    var a = Math.random() * Math.PI * 2;
    var x = ped.pos.x + Math.cos(a) * U.randRange(Math.random, 25, 60);
    var z = ped.pos.z + Math.sin(a) * U.randRange(Math.random, 25, 60);
    var rp = GAME.city.nearestRoadPoint(x, z);
    // the probe can land in the channel, and then the other landmass answers
    // for it — the waypoint stays on the one the stroller is standing on
    if (GAME.city.islandIdAt(rp.x, rp.z) !== GAME.city.islandIdAt(ped.pos.x, ped.pos.z)) {
      rp = GAME.city.nearestRoadPoint(ped.pos.x, ped.pos.z);
    }
    var off = 8.4 * (Math.random() < 0.5 ? 1 : -1);
    if (rp.axis === 'net') {
      // a curved road: the pavement is along its normal, not along an axis
      ped.wpX = rp.x + Math.cos(rp.heading) * off;
      ped.wpZ = rp.z - Math.sin(rp.heading) * off;
    } else if (rp.axis === 'z') { ped.wpX = rp.x + off; ped.wpZ = rp.z; }
    else { ped.wpX = rp.x; ped.wpZ = rp.z + off; }
    // The clamp box is the MAINLAND. Clamping an island stroller's waypoint to
    // it aimed every one of them at x=368 — the far side of the channel — and
    // they all set off west through the grass and downhill into the sea.
    if (rp.axis !== 'net') {
      ped.wpX = U.clamp(ped.wpX, -490, 368);
      ped.wpZ = U.clamp(ped.wpZ, -490, 490);
    }
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
        // carry through a knock-back from a vehicle: tumble, then settle
        if (ped.knockY !== undefined) {
          var gy0 = GAME.city.groundY(ped.pos.x, ped.pos.z);
          ped.knockY -= 18 * dt;
          ped.pos.x += ped.knockX * dt;
          ped.pos.z += ped.knockZ * dt;
          ped.pos.y += ped.knockY * dt;
          ped.mesh.rotation.z += ped.knockSpin * dt;
          ped.knockX *= Math.exp(-2.2 * dt);
          ped.knockZ *= Math.exp(-2.2 * dt);
          if (ped.pos.y <= gy0 + 0.35) {
            ped.pos.y = gy0 + 0.35;
            ped.knockY = undefined; // come to rest
          }
        }
        if (ped.deadT > 12 || d2p > 190 * 190) removePed(ped);
        continue;
      }
      if (!ped.isCop && !ped.jobPed && d2p > 180 * 180) { removePed(ped); continue; }
      if (ped.isCop) {
        // movement is driven by police.js, but officers are still flesh and blood:
        // a car at speed runs them down like anyone else
        for (var cc = 0; cc < world.cars.length; cc++) {
          var ccar = world.cars[cc];
          if (Math.abs(ccar.speed) < 4) continue;
          if (U.dist2(ped.pos.x, ped.pos.z, ccar.pos.x, ccar.pos.z) < 5.2) {
            kill(ped, 'car', ccar === P.car && P.inCar);
            GAME.audio.crash(0.4, ped.pos.x, ped.pos.z);
            break;
          }
        }
        continue;
      }

      // dive away from fast cars — but not every time. People need a moment to
      // react, some are slower to notice than others, and once a bonnet is on
      // top of them it's simply too late.
      if (ped.state !== 'dive') {
        var threat = false;
        for (var c = 0; c < world.cars.length; c++) {
          var car = world.cars[c];
          var sp = Math.abs(car.speed);
          if (sp < 8) continue;
          var dx = ped.pos.x - car.pos.x, dz = ped.pos.z - car.pos.z;
          var d2 = dx * dx + dz * dz;
          if (d2 > 130) continue;
          var fx = Math.sin(car.heading), fz = Math.cos(car.heading);
          var ahead = dx * fx + dz * fz;
          if (ahead <= 0 || ahead > 10 || Math.abs(dx * fz - dz * fx) > 3) continue;
          threat = true;
          // reaction time: they have to have seen it coming for a beat
          ped.reactT = (ped.reactT || 0) + dt;
          if (ped.reactT < ped.reactDelay) break;
          if (ahead < 5.5) break;             // too close — no time left
          if (ped.dodgeSkill < 0.35) break;   // this one just freezes
          ped.state = 'dive';
          ped.diveT = ped.diveDur = 0.85;
          var side = (dx * fz - dz * fx) > 0 ? 1 : -1;
          ped.diveX = (fz * side) * 6.2; ped.diveZ = (-fx * side) * 6.2;
          ped.speed = 0;
          GAME.audio.yelp(ped.pos.x, ped.pos.z);
          break;
        }
        if (!threat) ped.reactT = 0;
      }

      if (ped.state === 'walk') {
        ped.wpT -= dt;
        var wd2 = U.dist2(ped.pos.x, ped.pos.z, ped.wpX, ped.wpZ);
        if (wd2 < 4 || ped.wpT <= 0) newWaypoint(ped);
        var th = Math.atan2(ped.wpX - ped.pos.x, ped.wpZ - ped.pos.z);
        ped.heading = U.angleLerp(ped.heading, th, Math.min(1, dt * 4));
        ped.speed = U.damp(ped.speed, 3.57, 3, dt);   // 0.85x the player's 4.2 walk
      } else if (ped.state === 'flee') {
        ped.fleeT -= dt;
        var fh = Math.atan2(ped.pos.x - ped.fleeX, ped.pos.z - ped.fleeZ);
        ped.heading = U.angleLerp(ped.heading, fh + Math.sin(GAME.time * 3 + i) * 0.5, Math.min(1, dt * 5));
        ped.speed = U.damp(ped.speed, 6.8, 4, dt);    // 0.85x the player's 8 sprint
        if (ped.fleeT <= 0) { ped.state = 'walk'; newWaypoint(ped); }
      } else if (ped.state === 'attack') {
        // this one is coming for you — properly. They run you down faster
        // than you can walk away, throw quick jabs off both hands, and the
        // one whose car you stole chases the CAR: bangs on it, hauls you out
        // of the seat if you sit there, and drives off in it. They give up
        // once you speed away, get too far, or the fight has gone on long
        // enough — then they run.
        ped.attackT -= dt;
        var tcar = P.inCar && P.car ? P.car : null;
        var myCar = ped.stolenCar && !ped.stolenCar.dead && ped.stolenCar.occupied !== 'ai' ? ped.stolenCar : null;
        var chaseCar = myCar && U.dist2(ped.pos.x, ped.pos.z, myCar.pos.x, myCar.pos.z) < 55 * 55;
        var tx = chaseCar ? myCar.pos.x : P.pos.x;
        var tz = chaseCar ? myCar.pos.z : P.pos.z;
        var ty = chaseCar ? myCar.pos.y : (tcar ? tcar.pos.y : P.pos.y);
        var tSpeed = chaseCar ? Math.abs(myCar.speed) : (tcar ? Math.abs(tcar.speed) : 0);
        var ad2 = U.dist2(ped.pos.x, ped.pos.z, tx, tz);
        if (ped.attackT <= 0 || ad2 > 55 * 55 || P.state !== 'alive' ||
          Math.abs(ty - ped.pos.y) > 3 || tSpeed > 10) {
          ped.state = 'flee';
          ped.fleeT = 4;
          ped.fleeX = P.pos.x; ped.fleeZ = P.pos.z;
          ped.aimPose = false;
        } else {
          var ah = Math.atan2(tx - ped.pos.x, tz - ped.pos.z);
          ped.heading = U.angleLerp(ped.heading, ah, Math.min(1, dt * 10));
          ped.aimPose = true;
          var targetCarBody = chaseCar ? myCar : tcar;
          var reach = targetCarBody ? (targetCarBody.spec.l / 2 + 1.5) : 1.7;
          if (ad2 > reach * reach) {
            // a full 0.85x-sprint charge: faster than you can walk away
            ped.speed = U.damp(ped.speed, 6.8, 6, dt);
            ped.yankT = 0;
          } else {
            ped.speed = U.damp(ped.speed, 0, 9, dt);
            ped.punchT -= dt;
            if (chaseCar && tSpeed < 2.5) {
              // hands on his own car: hammering first, a shouted warning at
              // the door, and only then the yank. The clock restarts whenever
              // possession changes, so time he spent banging while you were
              // still climbing in can never mature into an instant ejection.
              var mine = P.inCar && P.car === myCar;
              var boarding = P.entering && P.entering.car === myCar;
              if (mine !== ped.hadDriver) { ped.hadDriver = mine; ped.yankT = 0; ped.yankWarned = false; }
              ped.yankT = (ped.yankT || 0) + dt;
              if (mine && !ped.yankWarned && ped.yankT > 0.7) {
                ped.yankWarned = true;
                GAME.hud.message('He’s got the door handle — floor it or lose the seat.', 2);
                GAME.audio.yelp(ped.pos.x, ped.pos.z);
              }
              if (ped.yankT > 1.7) {
                if (mine) {
                  GAME.exitCar();
                  GAME.hud.message('He wants his ride back.', 2.5);
                  GAME.audio.yelp(ped.pos.x, ped.pos.z);
                  ped.yankT = 0;
                  ped.yankWarned = false;
                } else if (!boarding) {
                  // owner slides back in and drives off, done with you
                  myCar.occupied = 'ai';
                  myCar.ai = { mode: 'traffic', desired: 12, laneX: 0, laneZ: 0 };
                  if (myCar.parkedSpot) { myCar.parkedSpot.live = null; myCar.parkedSpot = null; }
                  removePed(ped);
                  continue;
                }
              } else if (ped.punchT <= 0) {
                ped.punchT = 0.5;
                GAME.vehicles.damageCar(myCar, 2, 'fists', false);
                GAME.audio.crash(0.15, ped.pos.x, ped.pos.z);
              }
            } else if (ped.punchT <= 0) {
              ped.punchT = 0.55;
              ped.punchArm = !ped.punchArm;
              if (tcar) { GAME.vehicles.damageCar(tcar, 2, 'fists', false); GAME.cameraShake = Math.max(GAME.cameraShake || 0, 0.12); }
              else GAME.playerDamage(6, 'fists');
              GAME.audio.crash(0.18, ped.pos.x, ped.pos.z);
            }
          }
          // quick jabs off alternating hands, not a slow-motion haymaker
          var aj = ped.mesh.userData.joints;
          var jab = U.clamp(ped.punchT / 0.55, 0, 1);
          aj[ped.punchArm ? 'armR' : 'armL'].rotation.x = -2.3 + jab * 1.1;
          aj[ped.punchArm ? 'armL' : 'armR'].rotation.x = -1.2;
        }
      } else if (ped.state === 'dive') {
        // a real dive: they leave their feet, arc through the air and land —
        // rather than sliding sideways with the walk cycle still playing
        ped.diveT -= dt;
        var dk = U.clamp(1 - ped.diveT / (ped.diveDur || 0.85), 0, 1);
        var slow = 1 - dk * 0.7;                       // bleed off speed on the way down
        ped.pos.x += ped.diveX * slow * dt;
        ped.pos.z += ped.diveZ * slow * dt;
        ped.diveY = Math.sin(dk * Math.PI) * 0.7;      // hop off the ground
        // throw themselves in the direction they're going
        ped.heading = U.angleLerp(ped.heading, Math.atan2(ped.diveX, ped.diveZ), Math.min(1, dt * 12));
        ped.mesh.rotation.y = ped.heading;
        ped.mesh.rotation.x = U.lerp(ped.mesh.rotation.x, -1.35, Math.min(1, dt * 12));
        var dj = ped.mesh.userData.joints;
        dj.armL.rotation.x = -2.45; dj.armR.rotation.x = -2.45;
        dj.legL.rotation.x = 0.4; dj.legR.rotation.x = 0.18;
        if (ped.diveT <= 0) {
          ped.mesh.rotation.x = 0;
          ped.diveY = 0;
          dj.armL.rotation.x = dj.armR.rotation.x = 0;
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
      // walking into a palm tree forever is not a plan: when the legs move
      // but the body doesn't, sidestep and pick a new line. (Job peds are
      // steered by their mission every frame; leave them to it.)
      if (!ped.jobPed && ped.speed > 0.3 && ped.state !== 'dive') {
        var bdx = rp2.x - ped.prevX2, bdz = rp2.z - ped.prevZ2;
        if (ped.prevX2 !== undefined && bdx * bdx + bdz * bdz < Math.pow(ped.speed * dt * 0.25, 2)) {
          ped.stuckT = (ped.stuckT || 0) + dt;
          if (ped.stuckT > 1.1) {
            ped.stuckT = 0;
            var sside = Math.random() < 0.5 ? 1 : -1;
            if (ped.state === 'walk') {
              ped.wpX = ped.pos.x + Math.sin(ped.heading + sside * Math.PI / 2) * 7;
              ped.wpZ = ped.pos.z + Math.cos(ped.heading + sside * Math.PI / 2) * 7;
              ped.wpT = 3;
            } else ped.heading += sside * (1.1 + Math.random() * 0.8);
          }
        } else ped.stuckT = 0;
      }
      ped.prevX2 = rp2.x; ped.prevZ2 = rp2.z;
      ped.pos.x = rp2.x; ped.pos.z = rp2.z;
      // A stopped vehicle is solid: nobody walks through a parked truck. Fast
      // cars are left alone — the run-over check below is what handles those,
      // and pushing people clear of them would make everyone unhittable. Job
      // peds are exempt too: a fare climbing into the cab and a customer at
      // the ice cream hatch have to reach INSIDE the body's rectangle, and
      // the push held them at arm's length forever.
      if (!ped.jobPed) for (var cv = 0; cv < world.cars.length; cv++) {
        var pcv = world.cars[cv];
        if (pcv.dead || Math.abs(pcv.speed) >= 4) continue;
        if (Math.abs(pcv.pos.y - ped.pos.y) > 3) continue;
        var vdx = ped.pos.x - pcv.pos.x, vdz = ped.pos.z - pcv.pos.z;
        var vhl = pcv.spec.l / 2 + 0.4, vhw = pcv.spec.w / 2 + 0.4;
        if (vdx * vdx + vdz * vdz > (vhl + 1) * (vhl + 1)) continue;
        var vfx = Math.sin(pcv.heading), vfz = Math.cos(pcv.heading);
        var lng = vdx * vfx + vdz * vfz;          // along the body
        var lat2 = vdx * vfz - vdz * vfx;         // across it
        if (Math.abs(lng) >= vhl || Math.abs(lat2) >= vhw) continue;
        var penL = vhl - Math.abs(lng), penW = vhw - Math.abs(lat2);
        if (penW <= penL) {
          var ws = lat2 >= 0 ? 1 : -1;
          ped.pos.x += vfz * ws * penW; ped.pos.z += -vfx * ws * penW;
        } else {
          var ls = lng >= 0 ? 1 : -1;
          ped.pos.x += vfx * ls * penL; ped.pos.z += vfz * ls * penL;
        }
      }
      if (GAME.city.isInWater(ped.pos.x, ped.pos.z, ped.pos.y)) { removePed(ped); continue; }
      if (!ped.jobPed && GAME.city.inAirport(ped.pos.x, ped.pos.z)) { removePed(ped); continue; }
      ped.pos.y = GAME.city.groundY(ped.pos.x, ped.pos.z) + (ped.diveY || 0);
      // the dive drives its own pose; the walk cycle would just make it slide
      if (ped.state !== 'dive') animateWalk(ped, dt);

      // run over check
      for (var c2 = 0; c2 < world.cars.length; c2++) {
        var car2 = world.cars[c2];
        var sp2 = Math.abs(car2.speed);
        if (sp2 < 4) continue;
        if (Math.abs(car2.pos.y - ped.pos.y) > 3) continue;   // it's up on a roof
        if (U.dist2(ped.pos.x, ped.pos.z, car2.pos.x, car2.pos.z) < 5.2) {
          var byPlayer = (car2 === P.car && P.inCar);
          kill(ped, 'car', byPlayer);
          // thrown along the bonnet rather than dropping on the spot
          var kf = Math.min(1, sp2 / 26);
          ped.knockX = Math.sin(car2.heading) * (4 + sp2 * 0.35);
          ped.knockZ = Math.cos(car2.heading) * (4 + sp2 * 0.35);
          ped.knockY = 2.2 + kf * 3.2;
          ped.knockSpin = (Math.random() < 0.5 ? -1 : 1) * (4 + kf * 7);
          if (byPlayer) GAME.police.reportCrime('hit_ped', ped.pos);
          GAME.audio.crash(0.4, ped.pos.x, ped.pos.z);
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
      var isla = GAME.isla && GAME.isla.contains(x, z);
      // the mainland's east edge is the boardwalk; over on the island the
      // pavement follows whatever curve the road takes
      if (!isla && x > 340 && x < 700) x = U.randRange(Math.random, 356, 372);
      var rp = GAME.city.nearestRoadPoint(x, z);
      var off = 8.4 * (Math.random() < 0.5 ? 1 : -1);
      var px, pz;
      if (rp.axis === 'net') {
        px = rp.x + Math.cos(rp.heading) * off;
        pz = rp.z - Math.sin(rp.heading) * off;
      } else if (rp.axis === 'z') { px = rp.x + off; pz = rp.z; }
      else { px = rp.x; pz = rp.z + off; }
      if (!isla && x > 340 && x < 700) { px = x; pz = z; }
      if (rp.axis !== 'net' && (px < -490 || px > 372 || Math.abs(pz) > 490)) continue;
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
      // Not everyone runs — and whoever DOES turn to fight, fights. The old
      // hp floor made every brawler quit after two punches, which read as
      // no fight at all. Once committed, they go the distance; only someone
      // nearly dead before it starts thinks better of it.
      var fights = byPlayer &&
        (ped.state === 'attack' || ((ped.temper || 0) > 0.45 && ped.hp > 4));
      if (fights) {
        ped.state = 'attack';
        ped.attackT = 9;
        GAME.audio.yelp(ped.pos.x, ped.pos.z);
      } else {
        ped.state = 'flee';
        ped.fleeT = 6;
        ped.fleeX = GAME.player.pos.x; ped.fleeZ = GAME.player.pos.z;
      }
    }
  }

  return { spawnPed: spawnPed, removePed: removePed, kill: kill, panic: panic, damage: damage, update: update, buildPedMesh: buildPedMesh, makeHair: makeHair };
})();
