(function () {
  var renderer, accumulator = 0, lastT = 0;
  GAME.frame = 0;

  function boot() {
    var canvas = document.getElementById('game-canvas');
    GAME.touch.init();

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !GAME.isTouch, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, GAME.settings.pixelRatioCap));
    renderer.setSize(window.innerWidth, window.innerHeight);
    GAME.renderer = renderer;

    var scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x2a1440, 110, GAME.isTouch ? 320 : 430);
    GAME.scene = scene;

    var camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 3000);
    camera.position.set(340, 6, 30);
    GAME.cameraObj = camera;

    scene.add(new THREE.HemisphereLight(0x4a3a7a, 0x1a1024, 0.85));
    var moon = new THREE.DirectionalLight(0x8a94ff, 0.55);
    moon.position.set(500, 400, -150);
    scene.add(moon);
    var warm = new THREE.AmbientLight(0x40203a, 0.7);
    scene.add(warm);

    GAME.city.build(scene);
    GAME.fx.init(scene);
    GAME.initPlayer();
    GAME.combat.initPickups();
    GAME.missions.init();
    GAME.hud.init();
    GAME.initInput(canvas);
    GAME.combat.refreshWeaponHud();
    GAME.hud.wantedChanged(0);

    window.addEventListener('resize', function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    GAME.onKeyDown = function (code) {
      if (code === 'Enter' && !GAME.started) { GAME.startGame(); return; }
      if (!GAME.started) return;
      if (code === 'Escape') {
        if (GAME.mapOpen) GAME.hud.toggleMap(false);
        else GAME.togglePause();
      }
      if (code === 'KeyP') GAME.hud.toggleMap();
      if (code === 'KeyC' && GAME.mapOpen) GAME.hud.mapClear();
      if (code === 'KeyH') GAME.hud.toggleControlsBar();
      if (code === 'KeyM') {
        var m = GAME.audio.toggleMute();
        GAME.hud.message(m ? 'Muted' : 'Sound on', 1.2);
      }
      if (code === 'KeyT') GAME.hud.toggleCRT();
    };

    lastT = performance.now();
    requestAnimationFrame(loop);
  }

  GAME.startGame = function () {
    if (GAME.started) return;
    GAME.started = true;
    GAME.audio.init();
    GAME.hud.hideTitle();
    GAME.hud.message('Welcome to Costa Rosa. Steal a ride and see the strip.', 4);
  };

  GAME.togglePause = function () {
    if (!GAME.started) return;
    GAME.paused = !GAME.paused;
    GAME.hud.setPaused(GAME.paused);
    if (GAME.paused) {
      GAME.audio.engineState(false, 0);
      GAME.audio.skid(0);
      GAME.audio.siren(0);
      if (document.exitPointerLock) document.exitPointerLock();
    }
  };

  GAME.tick = function (dt) {
    GAME.time += dt;
    GAME.frame++;
    GAME.city.update(dt, GAME.time);
    GAME.vehicles.update(dt);
    GAME.peds.update(dt);
    GAME.updatePlayer(dt);
    GAME.combat.update(dt);
    GAME.combat.updatePickups(dt);
    GAME.police.update(dt);
    GAME.missions.update(dt);
    GAME.fx.update(dt);
    GAME.touch.update();
    GAME.hud.update(dt);
  };

  var STEP = 1 / 60;
  function loop(now) {
    requestAnimationFrame(loop);
    var real = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    if (GAME.started && !GAME.paused && !GAME.mapOpen) {
      accumulator += real * GAME.timeScale;
      var guard = 0;
      while (accumulator >= STEP && guard < 5) {
        GAME.tick(STEP);
        accumulator -= STEP;
        guard++;
      }
      if (guard === 5) accumulator = 0;
    }
    renderer.render(GAME.scene, GAME.cameraObj);
  }

  // headless-drivable test hooks
  GAME.test = {
    start: function () { GAME.startGame(); },
    teleport: function (x, z) {
      var P = GAME.player;
      if (P.inCar && P.car) { P.car.pos.x = x; P.car.pos.z = z; P.car.speed = 0; P.car.lat = 0; }
      else { P.pos.set(x, GAME.city.groundY(x, z), z); }
      return GAME.test.getState();
    },
    giveWeapon: function (id, ammo) { GAME.combat.giveWeapon(id, ammo || 60); },
    setWanted: function (n) { GAME.police.setWanted(n); },
    setHealth: function (h) { GAME.player.health = h; },
    addCash: function (n) { GAME.addCash(n); },
    spawnCar: function (type, dx, dz) {
      var P = GAME.player;
      return GAME.vehicles.spawnCar(type || 'sedan', P.pos.x + (dx || 5), P.pos.z + (dz || 0), 0, {});
    },
    spawnPed: function (dx, dz) {
      var P = GAME.player;
      return GAME.peds.spawnPed(P.pos.x + (dx || 5), P.pos.z + (dz || 0));
    },
    enterNearestCar: function () {
      var P = GAME.player;
      if (P.inCar) return true;
      var car = GAME.vehicles.findNearestCar(P.pos.x, P.pos.z, 10, null);
      return car ? GAME.enterCar(car) : false;
    },
    exitCar: function () { GAME.exitCar(); },
    autopilotDrive: function (on) { GAME.autopilot = !!on; },
    fastForward: function (seconds) {
      if (!GAME.started) GAME.startGame();
      var steps = Math.floor(seconds / STEP);
      for (var i = 0; i < steps; i++) GAME.tick(STEP);
      return GAME.test.getState();
    },
    pressKey: function (code, down) { GAME.input.keys[code] = down !== false; },
    getState: function () {
      var P = GAME.player;
      var info = GAME.renderer ? GAME.renderer.info.render : { calls: 0, triangles: 0 };
      var traffic = 0, copsCars = 0, footCops = 0, civs = 0;
      GAME.world.cars.forEach(function (c) { if (c.isPolice) copsCars++; else if (c.ai && c.ai.mode === 'traffic') traffic++; });
      GAME.world.peds.forEach(function (p) { if (p.dead) return; if (p.isCop) footCops++; else civs++; });
      return {
        x: Math.round((P.inCar && P.car ? P.car.pos.x : P.pos.x) * 10) / 10,
        z: Math.round((P.inCar && P.car ? P.car.pos.z : P.pos.z) * 10) / 10,
        mode: P.inCar ? 'car' : 'foot',
        carType: P.inCar && P.car ? P.car.type : null,
        speed: P.inCar && P.car ? Math.round(P.car.speed * 10) / 10 : Math.round(P.moveSpeed * 10) / 10,
        health: Math.round(P.health), armor: Math.round(P.armor),
        cash: P.cash,
        wanted: GAME.police.wanted,
        heat: Math.round(GAME.police.heat),
        weapon: P.currentWeapon,
        ammo: P.weapons[P.currentWeapon] ? P.weapons[P.currentWeapon].ammo : 0,
        state: P.state,
        mission: GAME.missions.active ? GAME.missions.active.def.id : null,
        missionObjective: GAME.missions.objectiveText(),
        cars: GAME.world.cars.length, traffic: traffic, policeCars: copsCars,
        peds: civs, footCops: footCops,
        pickups: GAME.world.pickups.length,
        drawCalls: info.calls, triangles: info.triangles,
        time: Math.round(GAME.time * 10) / 10,
        started: GAME.started, paused: GAME.paused
      };
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
