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

    var hemi = new THREE.HemisphereLight(0x4a3a7a, 0x1a1024, 0.85);
    scene.add(hemi);
    var moon = new THREE.DirectionalLight(0x8a94ff, 0.55);
    moon.position.set(500, 400, -150);
    scene.add(moon);
    var warm = new THREE.AmbientLight(0x40203a, 0.7);
    scene.add(warm);
    // headlights: one spot that follows whatever the player is driving, lit
    // only after dark. A single light keeps this cheap on mobile.
    var head = new THREE.SpotLight(0xfff0c8, 0, 95, 0.70, 0.42, 1.0);
    head.position.set(0, 1.2, 0);
    head.target.position.set(0, 0, 1);
    scene.add(head);
    scene.add(head.target);
    GAME.lights = { hemi: hemi, dir: moon, ambient: warm, head: head };

    GAME.city.build(scene);
    GAME.fx.init(scene);
    GAME.initPlayer();
    GAME.combat.initPickups();
    GAME.missions.init();
    GAME.stunts.load();
    GAME.hud.init();
    GAME.share.init();
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
        if (GAME.shareOpen) GAME.share.hide();
        else if (GAME.mapOpen) GAME.hud.toggleMap(false);
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
      if (code === 'KeyN') GAME.setDaytime();
    };

    // start on a bright late afternoon (the cycle then rolls toward sunset/night)
    GAME.applyTimeOfDay(0.5 - 0.5 * Math.cos(GAME.dayPhase * Math.PI * 2));

    // The title's soothing pads can only begin on a user gesture — the
    // browser's rule, not ours. The first press or tap on the title starts
    // them; if that same gesture starts the game, they bow out to the radio.
    function titleGesture() {
      if (GAME.started) return;
      GAME.audio.init();
      GAME.audio.titleMusic(true);
    }
    window.addEventListener('pointerdown', titleGesture);
    window.addEventListener('keydown', titleGesture);

    lastT = performance.now();
    requestAnimationFrame(loop);
  }

  GAME.enterFullscreen = function () {
    try {
      if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
      document.documentElement.requestFullscreen()
        .then(function () {
          try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(function () { }); } catch (e) { }
        })
        .catch(function () { });
    } catch (e) { }
  };
  GAME.toggleFullscreen = function () {
    if (document.fullscreenElement) { document.exitFullscreen().catch(function () { }); }
    else GAME.enterFullscreen();
  };

  // night (df 0) and day (df 1) endpoint palettes; intermediate df gives dusk
  var TOD_NIGHT = { fog: 0x2a1440, near: 110, hemi: 0x4a3a7a, ground: 0x1a1024, hemiI: 0.85, dir: 0x8a94ff, dirI: 0.55, amb: 0x40203a, ambI: 0.7, clear: 0x0a0714 };
  var TOD_DAY = { fog: 0xbcd0e8, near: 150, hemi: 0xcfe0ff, ground: 0x9a8a70, hemiI: 1.05, dir: 0xfff2d0, dirI: 1.0, amb: 0x6a6674, ambI: 0.5, clear: 0x9fbce0 };
  var _cN = new THREE.Color(), _cD = new THREE.Color(), _cT = new THREE.Color();
  function lerpHex(a, b, t, target) { _cN.setHex(a); _cD.setHex(b); target.copy(_cN).lerp(_cD, t); return target; }

  GAME.timeOfDay = 0.4;
  GAME.applyTimeOfDay = function (df) {
    GAME.timeOfDay = df;
    GAME.city.applyTimeOfDay(df);
    var scene = GAME.scene, L = GAME.lights, farBase = GAME.isTouch ? 320 : 430;
    lerpHex(TOD_NIGHT.fog, TOD_DAY.fog, df, scene.fog.color);
    scene.fog.near = U.lerp(TOD_NIGHT.near, TOD_DAY.near, df);
    scene.fog.far = farBase + df * 90;
    lerpHex(TOD_NIGHT.hemi, TOD_DAY.hemi, df, L.hemi.color);
    lerpHex(TOD_NIGHT.ground, TOD_DAY.ground, df, L.hemi.groundColor);
    L.hemi.intensity = U.lerp(TOD_NIGHT.hemiI, TOD_DAY.hemiI, df);
    lerpHex(TOD_NIGHT.dir, TOD_DAY.dir, df, L.dir.color);
    L.dir.intensity = U.lerp(TOD_NIGHT.dirI, TOD_DAY.dirI, df);
    lerpHex(TOD_NIGHT.amb, TOD_DAY.amb, df, L.ambient.color);
    L.ambient.intensity = U.lerp(TOD_NIGHT.ambI, TOD_DAY.ambI, df);
    renderer.setClearColor(lerpHex(TOD_NIGHT.clear, TOD_DAY.clear, df, _cT), 1);
  };

  // auto day/night cycle. Start on a bright, low-sun late afternoon that visibly
  // slides into sunset, then night, then the sun rises again and it loops.
  // df = 0.5 - 0.5*cos(2*pi*phase).
  // phase 0.63 -> df~0.85 sunny afternoon; 0.75 -> sunset; 1.0 -> night.
  var CYCLE = 150, START_PHASE = 0.63;
  GAME.dayPhase = START_PHASE;
  // 'auto' runs the cycle; 'day' / 'night' pin the clock where you want it
  GAME.timeMode = 'auto';
  var TIME_MODES = ['auto', 'day', 'night'];
  GAME.setTimeMode = function (mode) {
    if (TIME_MODES.indexOf(mode) < 0) mode = 'auto';
    GAME.timeMode = mode;
    if (mode === 'day') { GAME.dayPhase = 0.5; GAME.applyTimeOfDay(1); }
    else if (mode === 'night') { GAME.dayPhase = 0.0; GAME.applyTimeOfDay(0); }
    if (GAME.prefs) { GAME.prefs.timeMode = mode; GAME.save(); }
    return mode;
  };
  GAME.cycleTimeMode = function () {
    var i = TIME_MODES.indexOf(GAME.timeMode);
    return GAME.setTimeMode(TIME_MODES[(i + 1) % TIME_MODES.length]);
  };
  // kept for the scripted test API
  GAME.setDaytime = function (force) {
    var day = force !== undefined ? !!force : GAME.timeOfDay < 0.5;
    GAME.setTimeMode(day ? 'day' : 'night');
    return day;
  };
  GAME.advanceDayCycle = function (dt) {
    if (GAME.timeMode !== 'auto') return; // clock is pinned
    GAME.dayPhase = (GAME.dayPhase + dt / CYCLE) % 1;
    GAME.applyTimeOfDay(0.5 - 0.5 * Math.cos(GAME.dayPhase * Math.PI * 2));
  };

  GAME.startGame = function () {
    if (GAME.started) return;
    GAME.started = true;
    GAME.analytics.start();
    GAME.track(GAME.isTouch ? 'started-touch' : 'started-desktop');
    GAME.audio.init();
    GAME.audio.titleMusic(false);
    // leave attract mode: place the player on the strip, camera snaps behind
    var P = GAME.player;
    P.pos.set(356, 0.18, 40);
    P.heading = Math.PI;
    P.mesh.visible = true;
    GAME.cam.yaw = Math.PI; GAME.cam.pitch = 0.32;
    GAME.cam.x = GAME.cam.y = GAME.cam.z = null;
    GAME.enterFullscreen(); // same user gesture — desktop and touch alike
    GAME.dayPhase = 0.63; // start sunny (~late afternoon); sunset ~18s in, night ~55s
    GAME.hud.hideTitle();
    GAME.hud.message('Welcome to Costa Rosa. Steal a ride and see the strip.', 4);
  };

  // attract mode: the live city plays behind the title with spectator cuts
  var ATTRACT_CUTS = [
    { pos: [330, 10, -80], look: [351, 1, -10], drift: [0.3, 0.05, 2.0] },
    { pos: [400, 8, 205], look: [490, 14, 150], drift: [-0.8, 0.1, -1.2] },
    { pos: [-30, 46, -30], look: [-100, 52, -100], drift: [1.6, 0.3, 1.6] },
    { pos: [55, 12, -165], look: [50, 2, -95], drift: [-1.5, 0.1, 0.5] },
    { pos: [393, 7, 35], look: [364, 2, 110], drift: [0.2, 0.05, 2.2] }
  ];
  var attractIdx = -1, attractT = 1e9;
  function tickAttractCam(dt) {
    attractT += dt;
    if (attractT > 13) {
      attractT = 0;
      attractIdx = (attractIdx + 1) % ATTRACT_CUTS.length;
      var nc = ATTRACT_CUTS[attractIdx];
      // the hidden player anchors the traffic/ped spawn bubble at the shot
      GAME.player.pos.set(nc.look[0], 0, nc.look[2]);
    }
    var c = ATTRACT_CUTS[attractIdx];
    GAME.cameraObj.position.set(c.pos[0] + c.drift[0] * attractT, c.pos[1] + c.drift[1] * attractT, c.pos[2] + c.drift[2] * attractT);
    GAME.cameraObj.lookAt(c.look[0], c.look[1], c.look[2]);
  }
  GAME.tickAttract = function (dt) {
    GAME.time += dt;
    GAME.frame++;
    GAME.city.update(dt, GAME.time);
    GAME.vehicles.update(dt);
    GAME.peds.update(dt);
    GAME.fx.update(dt);
    tickAttractCam(dt);
  };

  // On desktop the mouse is pointer-locked while playing, and the browser
  // swallows the Esc keydown that releases the lock — so the first Esc did
  // nothing you could see and only the second reached the game. The lock
  // going away IS the Esc press: treat it as one.
  document.addEventListener('pointerlockchange', function () {
    if (document.pointerLockElement) return;
    if (GAME.started && !GAME.paused && !GAME.mapOpen && !GAME.shareOpen &&
      GAME.player.state === 'alive') GAME.togglePause();
  });

  GAME.togglePause = function () {
    if (!GAME.started) return;
    GAME.paused = !GAME.paused;
    GAME.hud.setPaused(GAME.paused);
    if (GAME.paused) {
      GAME.audio.engineState(false, 0);
      GAME.audio.skid(0);
      GAME.audio.siren(0);
      GAME.audio.suspend();
      if (document.exitPointerLock) document.exitPointerLock();
    } else {
      GAME.audio.resume();
    }
  };

  // auto-pause when the tab/app is backgrounded or loses focus, and freeze audio
  function onHide() {
    if (GAME.started && !GAME.paused && !GAME.mapOpen && !GAME.shareOpen && GAME.player.state === 'alive') GAME.togglePause();
    else GAME.audio.suspend();
  }
  function onShow() {
    // resume whenever we're not paused — the map being open must not strand the
    // audio context suspended (closing the map doesn't itself resume it)
    if (!GAME.paused) GAME.audio.resume();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) onHide(); else onShow();
  });
  window.addEventListener('blur', onHide);
  window.addEventListener('focus', onShow);

  // park the headlight on the player's vehicle, aimed down the road ahead.
  // Intensity follows the clock, so it only lights up as dusk falls.
  function updateHeadlight() {
    var L = GAME.lights, P = GAME.player;
    if (!L || !L.head) return;
    var h = L.head;
    var car = P.inCar && P.car ? P.car : null;
    var night = U.clamp(1 - GAME.timeOfDay * 1.6, 0, 1);
    if (!car || !night) { h.intensity = 0; return; }
    h.intensity = night * (car.spec.heli || car.spec.plane ? 2.4 : 3.6);
    var fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    var nose = car.spec.l * 0.45;
    h.position.set(car.pos.x + fx * nose, car.pos.y + 0.85, car.pos.z + fz * nose);
    // aim slightly down so the cone lands on the road rather than the skyline
    h.target.position.set(car.pos.x + fx * 30, car.pos.y - 1.6, car.pos.z + fz * 30);
    h.target.updateMatrixWorld();
  }

  GAME.tick = function (dt) {
    GAME.time += dt;
    GAME.frame++;
    GAME.advanceDayCycle(dt);
    GAME.city.update(dt, GAME.time);
    GAME.vehicles.update(dt);
    GAME.peds.update(dt);
    GAME.updatePlayer(dt);
    GAME.combat.update(dt);
    GAME.combat.updatePickups(dt);
    GAME.police.update(dt);
    GAME.missions.update(dt);
    if (GAME.isla) GAME.isla.tick(dt);
    GAME.fx.update(dt);
    updateHeadlight();
    GAME.touch.update();
    GAME.hud.update(dt);
  };

  var STEP = 1 / 60;
  function loop(now) {
    requestAnimationFrame(loop);
    var real = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    if (!GAME.started) {
      accumulator += real;
      var g0 = 0;
      while (accumulator >= STEP && g0 < 5) {
        GAME.tickAttract(STEP);
        accumulator -= STEP;
        g0++;
      }
      if (g0 === 5) accumulator = 0;
    } else if (!GAME.paused && !GAME.mapOpen && !GAME.shareOpen) {
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
      if (P.inCar && P.car) {
        // set down on whatever is at the destination, so a teleport off a
        // height isn't mistaken for a fall (and scored as a jump)
        P.car.pos.set(x, GAME.city.groundY(x, z), z);
        P.car.speed = 0; P.car.lat = 0; P.car.vy = 0; P.car.air = 0; P.car.jumpRamp = null;
      } else {
        P.pos.set(x, GAME.city.groundY(x, z), z);
        P.velY = 0; P.airborne = false;
      }
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
