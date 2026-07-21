GAME.aircraft = (function () {
  var chute = null;

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
    car.pos.x = U.clamp(nx, -524, 524);
    car.pos.z = U.clamp(nz, -524, 524);

    // land on whatever surface is below (terrain or a rooftop)
    var minY = GAME.city.surfaceY(car.pos.x, car.pos.z) + 1.4;
    if (car.pos.y < minY) {
      car.pos.y = minY;
      if (car.vy < -9) { GAME.vehicles.damageCar(car, -car.vy * 3, 'wall'); GAME.cameraShake = Math.min(1, -car.vy / 12); }
      if (car.vy < 0) car.vy = 0;
    }

    GAME.audio.engineState(true, 0.42 + Math.min(0.5, Math.abs(car.heliSpeed) / car.spec.maxSpeed * 0.4 + (up > 0 ? 0.15 : 0)));
    car.mesh.rotation.set(fwd * -0.16, car.heading, -yaw * 0.18);
  }

  // arcade fixed-wing: throttle for speed, pitch to climb once past stall,
  // yaw to turn. Needs runway room to take off and land.
  function updatePlane(dt) {
    var P = GAME.player, car = P.car, inp = GAME.input, T = inp.touch;
    var thr = 0, pitchIn = 0, yawIn = 0;
    if (GAME.key('KeyW')) thr += 1;
    if (GAME.key('KeyS')) thr -= 1;
    if (GAME.key('Space')) pitchIn += 1;
    if (GAME.key('ShiftLeft') || GAME.key('ShiftRight') || GAME.key('ControlLeft')) pitchIn -= 1;
    if (GAME.key('KeyA')) yawIn += 1;
    if (GAME.key('KeyD')) yawIn -= 1;
    // touch: THR+/THR- buttons drive throttle; the stick is a yoke — pull it
    // back (down) to bring the nose up and climb, push forward (up) to dive.
    if (T.active) { thr += (T.gas ? 1 : 0) - (T.brake ? 1 : 0); pitchIn += T.stickY; yawIn += -T.stickX; }

    var gy = GAME.city.surfaceY(car.pos.x, car.pos.z);
    var onGround = car.pos.y <= gy + car.spec.wheelH + 0.35;

    car.speed = U.clamp((car.speed || 0) + thr * car.spec.accel * dt, 0, car.spec.maxSpeed);
    car.speed *= Math.exp(-0.09 * dt);

    car.pitch = car.pitch || 0;
    // on the ground the nose only rotates up once you're at rotation (stall) speed
    if (onGround && car.speed < car.spec.stall) car.pitch = U.damp(car.pitch, 0, 6, dt);
    else car.pitch = U.clamp(car.pitch + pitchIn * 1.1 * dt, onGround ? 0 : -0.7, 0.7);

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
    if (car.pos.y < GAME.city.surfaceY(nx, nz) - 0.8) {
      if (car.speed > 20) { GAME.vehicles.damageCar(car, car.speed, 'wall'); GAME.cameraShake = 0.8; }
      car.speed *= 0.3; nx = car.pos.x; nz = car.pos.z;
    }
    car.pos.x = U.clamp(nx, -524, 524);
    car.pos.z = U.clamp(nz, -524, 524);

    var surf = GAME.city.surfaceY(car.pos.x, car.pos.z);
    if (car.pos.y < surf + car.spec.wheelH) {
      var hard = vy < -11;
      car.pos.y = surf + car.spec.wheelH;
      if (hard) { GAME.vehicles.damageCar(car, -vy * 3, 'wall'); GAME.cameraShake = Math.min(1, -vy / 12); }
    }

    GAME.audio.engineState(true, 0.35 + Math.min(0.6, car.speed / car.spec.maxSpeed * 0.6));
    car.mesh.rotation.set(-car.pitch, car.heading, -yawIn * 0.4);
  }

  function startParachute(x, y, z, heading) {
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
    }
    chute.visible = true;
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

    var gy = GAME.city.groundY(P.pos.x, P.pos.z);
    P.mesh.position.set(P.pos.x, P.pos.y, P.pos.z);
    P.mesh.rotation.set(0, P.heading, 0);
    var j = P.mesh.userData.joints;
    j.armL.rotation.set(-2.5, 0, -0.3); j.armR.rotation.set(-2.5, 0, 0.3);
    j.legL.rotation.x = 0.25; j.legR.rotation.x = -0.15;
    if (chute) chute.position.set(P.pos.x, P.pos.y + 3.2, P.pos.z);

    if (GAME.city.isInWater(P.pos.x, P.pos.z)) { land(); GAME.playerDrown(); return; }
    if (P.pos.y <= gy + 0.05) {
      land();
      P.pos.y = gy;
      GAME.hud.message('Feet dry.', 1.5);
    }
  }

  function land() {
    var P = GAME.player;
    P.parachuting = false;
    if (chute) chute.visible = false;
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
