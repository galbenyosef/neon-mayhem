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

    // building collision below the rooftops
    var boxes = GAME.city.hash.query(nx, nz, 3);
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (b.noLOS) continue;
      if (car.pos.y < b.h + 1 && nx > b.minX - 2 && nx < b.maxX + 2 && nz > b.minZ - 2 && nz < b.maxZ + 2) {
        nx = car.pos.x; nz = car.pos.z;
        if (Math.abs(car.heliSpeed) > 9) { GAME.vehicles.damageCar(car, 7, 'wall'); GAME.cameraShake = 0.5; }
        car.heliSpeed *= 0.25;
        break;
      }
    }
    car.pos.x = U.clamp(nx, -524, 524);
    car.pos.z = U.clamp(nz, -524, 524);

    // ground / water contact
    var gy = GAME.city.groundY(car.pos.x, car.pos.z);
    var minY = gy + 1.4;
    if (car.pos.y < minY) {
      car.pos.y = minY;
      if (car.vy < -9) { GAME.vehicles.damageCar(car, -car.vy * 3, 'wall'); GAME.cameraShake = Math.min(1, -car.vy / 12); }
      if (car.vy < 0) car.vy = 0;
    }

    GAME.audio.engineState(true, 0.42 + Math.min(0.5, Math.abs(car.heliSpeed) / car.spec.maxSpeed * 0.4 + (up > 0 ? 0.15 : 0)));
    car.mesh.rotation.set(fwd * -0.16, car.heading, -yaw * 0.18);
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
    startParachute: startParachute,
    updateParachute: updateParachute,
    get parachuting() { return GAME.player.parachuting; }
  };
})();
