GAME.aircraft = (function () {
  var chute = null, rig = null;
  var CHUTE_LINES = 6;

  // While the bridges are shut the channel is restricted airspace: you can fly
  // out over the water and see the far shore, and that is as far as you get.
  var CLOSED_X = 560, warnT = 0;
  function airLimit() {
    if (GAME.isla && GAME.isla.isOpen()) return { maxX: 1560, minZ: -600, maxZ: 600 };
    return { maxX: CLOSED_X, minZ: -524, maxZ: 524 };
  }
  function warnAirspace(x, lim) {
    if (x < lim.maxX - 1 || lim.maxX > CLOSED_X) return;
    if (GAME.time - warnT < 4) return;
    warnT = GAME.time;
    GAME.hud.message('RESTRICTED AIRSPACE — turn back.', 2.5);
  }

  // arcade helicopter: collective (up/down), cyclic (nose tilt = forward),
  // pedal (yaw). Called from player.js while the player flies a heli.
  function updateHeli(dt) {
    var P = GAME.player, car = P.car, inp = GAME.input, T = inp.touch;
    var up = 0, fwd = 0, yaw = 0;
    if (GAME.key('Space')) up += 1;
    if (GAME.key('ShiftLeft') || GAME.key('ShiftRight') || GAME.key('ControlLeft')) up -= 1;
    if (GAME.key('KeyW')) fwd += 1;
    if (GAME.key('KeyS')) fwd -= 1;
    if (GAME.key('KeyA')) yaw += 1;
    if (GAME.key('KeyD')) yaw -= 1;
    if (T.active) {
      fwd += -T.stickY; yaw += -T.stickX;
      up += (T.gas ? 1 : 0) - (T.brake ? 1 : 0); // GAS climbs, BRAKE descends
    }

    car.heading += yaw * 1.7 * dt;

    // vertical: lift vs gravity, hover a touch above neutral so it drifts down slowly
    car.vy = (car.vy || 0) + (up * 16 - 9.2) * dt;
    car.vy = U.clamp(car.vy * Math.exp(-0.8 * dt), -14, 15);
    car.pos.y += car.vy * dt;

    // horizontal: tilt the nose to slide in the facing direction
    car.heliSpeed = U.damp(car.heliSpeed || 0, fwd * car.spec.maxSpeed, 1.6, dt);
    var nx = car.pos.x + Math.sin(car.heading) * car.heliSpeed * dt;
    var nz = car.pos.z + Math.cos(car.heading) * car.heliSpeed * dt;
    // blocked only when flying into a wall below its roof; above the roof you fly over / land on it
    if (car.pos.y < GAME.city.surfaceY(nx, nz) - 0.8) {
      nx = car.pos.x; nz = car.pos.z;
      if (Math.abs(car.heliSpeed) > 9) { GAME.vehicles.damageCar(car, 7, 'wall'); GAME.cameraShake = 0.5; }
      car.heliSpeed *= 0.25;
    }
    var lim = airLimit();
    car.pos.x = U.clamp(nx, -524, lim.maxX);
    car.pos.z = U.clamp(nz, lim.minZ, lim.maxZ);
    warnAirspace(car.pos.x, lim);

    // land on whatever surface is below (terrain or a rooftop)
    var minY = GAME.city.surfaceY(car.pos.x, car.pos.z) + 1.4;
    if (car.pos.y < minY) {
      car.pos.y = minY;
      if (car.vy < -9) { GAME.vehicles.damageCar(car, -car.vy * 3, 'wall'); GAME.cameraShake = Math.min(1, -car.vy / 12); }
      if (car.vy < 0) car.vy = 0;
    }

    GAME.audio.engineState(true, 0.42 + Math.min(0.5, Math.abs(car.heliSpeed) / car.spec.maxSpeed * 0.4 + (up > 0 ? 0.15 : 0)), 'heli');
    car.mesh.rotation.set(fwd * -0.16, car.heading, -yaw * 0.18);
  }

  // arcade fixed-wing: throttle for speed, pitch to climb once past stall,
  // yaw to turn. Needs runway room to take off and land.
  function updatePlane(dt) {
    var P = GAME.player, car = P.car, inp = GAME.input, T = inp.touch;
    var thr = 0, pitchIn = 0, yawIn = 0, rollIn = 0;
    if (GAME.key('KeyW')) thr += 1;
    if (GAME.key('KeyS')) thr -= 1;
    if (GAME.key('Space')) pitchIn += 1;
    if (GAME.key('ShiftLeft') || GAME.key('ShiftRight') || GAME.key('ControlLeft')) pitchIn -= 1;
    if (GAME.key('KeyA')) yawIn += 1;
    if (GAME.key('KeyD')) yawIn -= 1;
    // Q/E barrel-roll the airframe right the way round
    if (GAME.key('KeyQ')) rollIn += 1;
    if (GAME.key('KeyE')) rollIn -= 1;
    // touch: THR+/THR- buttons drive throttle; the stick is a yoke — pull it
    // back (down) to bring the nose up and climb, push forward (up) to dive.
    if (T.active) { thr += (T.gas ? 1 : 0) - (T.brake ? 1 : 0); pitchIn += T.stickY; yawIn += -T.stickX; }

    var gy = GAME.city.surfaceY(car.pos.x, car.pos.z);
    var onGround = car.pos.y <= gy + car.spec.wheelH + 0.35;

    car.speed = U.clamp((car.speed || 0) + thr * car.spec.accel * dt, 0, car.spec.maxSpeed);
    car.speed *= Math.exp(-0.09 * dt);

    car.pitch = car.pitch || 0;
    car.roll = car.roll || 0;
    // on the ground the nose only rotates up once you're at rotation (stall) speed
    if (onGround && car.speed < car.spec.stall) { car.pitch = U.damp(car.pitch, 0, 6, dt); car.roll = U.damp(car.roll, 0, 6, dt); }
    else if (onGround) car.pitch = U.clamp(car.pitch + pitchIn * 1.1 * dt, 0, 0.7);
    else {
      // airborne the elevator is unrestricted, so you can pull a full loop
      car.pitch = U.wrapPI(car.pitch + pitchIn * 1.35 * dt);
      car.roll = U.wrapPI(car.roll + rollIn * 3.2 * dt);
    }

    var yawEff = Math.min(1, car.speed / 22);
    car.heading += yawIn * 1.15 * yawEff * dt;

    var flying = car.speed >= car.spec.stall;
    var vy;
    if (onGround && (!flying || car.pitch <= 0.06)) {
      vy = 0; car.pos.y = gy + car.spec.wheelH;
    } else if (flying) {
      vy = car.speed * Math.sin(car.pitch);
    } else {
      vy = -9; car.pitch = U.damp(car.pitch, -0.3, 3, dt); // stall — sinking
    }
    car.pos.y += vy * dt;

    var horiz = car.speed * Math.cos(car.pitch);
    var nx = car.pos.x + Math.sin(car.heading) * horiz * dt;
    var nz = car.pos.z + Math.cos(car.heading) * horiz * dt;
    // flying into a building at speed is a crash, not a bump
    if (car.pos.y < GAME.city.surfaceY(nx, nz) - 0.8) {
      if (car.speed > 18) {
        GAME.cameraShake = 1;
        GAME.hud.message('You flew it into a building.', 3);
        GAME.vehicles.explodeCar(car, 'wall');
        return;
      }
      GAME.vehicles.damageCar(car, car.speed, 'wall');
      car.speed *= 0.3; nx = car.pos.x; nz = car.pos.z;
    }
    var lim = airLimit();
    car.pos.x = U.clamp(nx, -524, lim.maxX);
    car.pos.z = U.clamp(nz, lim.minZ, lim.maxZ);
    warnAirspace(car.pos.x, lim);

    var surf = GAME.city.surfaceY(car.pos.x, car.pos.z);
    if (car.pos.y < surf + car.spec.wheelH) {
      car.pos.y = surf + car.spec.wheelH;
      // a steep arrival, or touching down inverted, writes the aircraft off
      var inverted = Math.abs(U.wrapPI(car.roll || 0)) > 1.1 || Math.abs(U.wrapPI(car.pitch)) > 1.2;
      if (vy < -18 || (vy < -6 && inverted)) {
        GAME.cameraShake = 1;
        GAME.hud.message('Crash landing.', 3);
        GAME.vehicles.explodeCar(car, 'wall');
        return;
      }
      if (vy < -11) { GAME.vehicles.damageCar(car, -vy * 3, 'wall'); GAME.cameraShake = Math.min(1, -vy / 12); }
      // wings level out once you're rolling on the wheels again
      car.roll = U.damp(car.roll, 0, 5, dt);
    }

    GAME.audio.engineState(true, 0.35 + Math.min(0.6, car.speed / car.spec.maxSpeed * 0.6), 'plane');
    // bank into turns on top of any barrel roll the pilot is holding
    car.mesh.rotation.set(-car.pitch, car.heading, car.roll - yawIn * 0.4);
  }

  function startParachute(x, y, z, heading) {
    GAME.track('parachute-opened');
    var P = GAME.player;
    P.parachuting = true;
    P.inCar = false; P.car = null; P.onBike = false;
    P.mesh.visible = true;
    P.pos.set(x, y, z);
    P.heading = heading || 0;
    if (!chute) {
      chute = new THREE.Mesh(
        new THREE.SphereGeometry(2.3, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: 0xff2f7a, side: THREE.DoubleSide, emissive: 0x40101f })
      );
      GAME.scene.add(chute);
      // rigging lines from the canopy rim down to the harness, so you read as
      // hanging from the chute rather than floating under it
      var lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CHUTE_LINES * 6), 3));
      rig = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xf7d8e4 }));
      rig.frustumCulled = false;
      GAME.scene.add(rig);
    }
    chute.visible = true;
    if (rig) rig.visible = true;
    GAME.audio.engineState(false, 0);
    GAME.hud.message('Parachute out — WASD to steer, glide to the ground', 3.5);
  }

  function updateParachute(dt) {
    var P = GAME.player, inp = GAME.input, T = inp.touch;
    var mx = 0, mz = 0;
    if (GAME.key('KeyW')) mz += 1;
    if (GAME.key('KeyS')) mz -= 1;
    if (GAME.key('KeyA')) mx -= 1;
    if (GAME.key('KeyD')) mx += 1;
    if (T.active) { mx += T.stickX; mz += -T.stickY; }
    var camYaw = GAME.cam.yaw;
    var wx = Math.sin(camYaw) * mz - Math.cos(camYaw) * mx;
    var wz = Math.cos(camYaw) * mz + Math.sin(camYaw) * mx;
    P.pos.x += wx * 6.5 * dt;
    P.pos.z += wz * 6.5 * dt;
    P.pos.y -= 4.5 * dt;
    if (mx || mz) P.heading = U.angleLerp(P.heading, Math.atan2(wx, wz), Math.min(1, dt * 5));

    // land on whatever's below — street or a rooftop
    var gy = GAME.city.surfaceY(P.pos.x, P.pos.z);
    P.mesh.position.set(P.pos.x, P.pos.y, P.pos.z);
    P.mesh.rotation.set(0, P.heading, 0);
    var j = P.mesh.userData.joints;
    j.armL.rotation.set(-2.5, 0, -0.3); j.armR.rotation.set(-2.5, 0, 0.3);
    j.legL.rotation.x = 0.25; j.legR.rotation.x = -0.15;
    if (chute) chute.position.set(P.pos.x, P.pos.y + 3.2, P.pos.z);
    if (rig) {
      // canopy rim -> shoulders, swinging with the player's facing
      var a = rig.geometry.attributes.position.array;
      var sy = P.pos.y + 1.45, cy = P.pos.y + 3.3, rr = 2.1;
      for (var i = 0; i < CHUTE_LINES; i++) {
        var ang = P.heading + i / CHUTE_LINES * Math.PI * 2;
        var sx = Math.sin(ang) * 0.24, sz = Math.cos(ang) * 0.24;
        a[i * 6] = P.pos.x + sx; a[i * 6 + 1] = sy; a[i * 6 + 2] = P.pos.z + sz;
        a[i * 6 + 3] = P.pos.x + Math.sin(ang) * rr;
        a[i * 6 + 4] = cy;
        a[i * 6 + 5] = P.pos.z + Math.cos(ang) * rr;
      }
      rig.geometry.attributes.position.needsUpdate = true;
    }

    if (GAME.city.isInWater(P.pos.x, P.pos.z, P.pos.y)) { land(); GAME.playerDrown(); return; }
    if (P.pos.y <= gy + 0.05) {
      land();
      P.pos.y = gy; P.velY = 0;
      GAME.hud.message('Feet dry.', 1.5);
    }
  }

  function land() {
    var P = GAME.player;
    P.parachuting = false;
    if (chute) chute.visible = false;
    if (rig) rig.visible = false;
    var j = P.mesh.userData.joints;
    j.armL.rotation.set(0, 0, 0); j.armR.rotation.set(0, 0, 0);
    j.legL.rotation.x = j.legR.rotation.x = 0;
  }

  return {
    updateHeli: updateHeli,
    updatePlane: updatePlane,
    startParachute: startParachute,
    updateParachute: updateParachute,
    get parachuting() { return GAME.player.parachuting; }
  };
})();
