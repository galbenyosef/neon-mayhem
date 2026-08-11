GAME.touch = (function () {
  var layer, stickZone, stickBase, stickNub;
  var stickId = null, camId = null, camLX = 0, camLY = 0;
  var baseX = 0, baseY = 0;
  var footBtns = [], carBtns = [];
  var btns = {};
  var enabled = false;
  var lastCarRef = null;   // the vehicle (or null) the flags were last cleared for

  function detect() {
    if ('ontouchstart' in window) return true;
    if (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) return true;
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
    return false;
  }

  function mkBtn(label, right, bottom, size, opts) {
    var b = document.createElement('div');
    b.className = 'tbtn';
    b.textContent = label;
    b.style.right = right + 'px';
    b.style.bottom = bottom + 'px';
    b.style.width = size + 'px';
    b.style.height = size + 'px';
    b.style.minWidth = size + 'px';
    b.style.minHeight = size + 'px';
    layer.appendChild(b);
    opts = opts || {};
    var T = GAME.input.touch;
    b.addEventListener('touchstart', function (e) {
      e.preventDefault(); e.stopPropagation();
      b.classList.add('held');
      if (opts.toggle) {
        T[opts.flag] = !T[opts.flag];
        b.style.background = T[opts.flag] ? 'rgba(140,255,210,.4)' : '';
      } else if (opts.flag) T[opts.flag] = true;
      if (opts.press) opts.press();
    }, { passive: false });
    var release = function (e) {
      e.preventDefault(); e.stopPropagation();
      b.classList.remove('held');
      if (opts.flag && !opts.toggle) T[opts.flag] = false;
      if (opts.release) opts.release();
    };
    b.addEventListener('touchend', release, { passive: false });
    // touchcancel fires instead of touchend on an OS interruption (call, shade,
    // app switch) — without this the button would stay stuck held
    b.addEventListener('touchcancel', release, { passive: false });
    return b;
  }

  function init() {
    if (detect()) enable();
    // a real touch at any point enables the layer even if boot-time detection missed
    window.addEventListener('touchstart', function () { enable(); }, { passive: true, once: true });
  }

  function enable() {
    if (enabled) return;
    enabled = true;
    GAME.isTouch = true;
    var S = GAME.settings;
    S.pixelRatioCap = 1.4;
    S.bubbleRadius = 110;
    S.maxTraffic = 8;
    S.maxPeds = 12;
    S.maxParked = 9;
    // late enable (after boot): apply what the renderer already consumed
    if (GAME.renderer) GAME.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, S.pixelRatioCap));
    if (GAME.scene && GAME.scene.fog) GAME.scene.fog.far = 320;
    if (!GAME.started) {
      var pe = document.getElementById('press-enter');
      if (pe) pe.textContent = 'TAP TO START';
    }

    layer = document.getElementById('touch-layer');
    stickZone = document.getElementById('tstick-zone');
    stickBase = document.getElementById('tstick-base');
    stickNub = document.getElementById('tstick-nub');
    var T = GAME.input.touch;
    T.active = true;

    // ---- right-thumb action cluster, laid out like the classic console port:
    // the primary action sits in the very corner under the thumb, its partner
    // (brake / jump) directly beside it on the same bottom row, and the
    // secondary controls step up and inboard from there. Buttons show/hide by
    // context in update(). ----
    // on foot
    btns.fire = mkBtn('FIRE', 24, 24, 96, { flag: 'fire', press: function () { T.firePressed = true; } });
    btns.jump = mkBtn('JUMP', 134, 24, 82, { flag: 'jump' });
    btns.aim = mkBtn('AIM', 34, 132, 68, { flag: 'aim', toggle: true });
    btns.enter = mkBtn('ENTER', 122, 122, 62, { flag: 'enter' });
    btns.run = mkBtn('RUN', 228, 30, 62, { flag: 'run', toggle: true });
    btns.wpn = mkBtn('WPN', 116, 200, 54, { press: function () { T.weaponCycle = true; } });
    footBtns.push(btns.fire, btns.jump, btns.aim, btns.enter, btns.run, btns.wpn);
    // in car: GAS in the corner, BRAKE right next to it (never stacked above)
    btns.gas = mkBtn('GAS', 24, 24, 96, { flag: 'gas' });
    btns.brake = mkBtn('BRAKE', 134, 24, 86, { flag: 'brake' });
    btns.handbrake = mkBtn('⇋', 34, 132, 68, { flag: 'handbrake' });
    btns.exit = mkBtn('EXIT', 122, 124, 62, { flag: 'enter' });
    btns.driveby = mkBtn('FIRE', 232, 30, 68, { flag: 'driveByAuto' });
    btns.job = mkBtn('JOB', 116, 200, 54, { press: function () { T.job = true; } });
    btns.radio = mkBtn('♪', 200, 200, 50, { press: function () { GAME.hud.radioPopup(GAME.audio.radio.switchStation(1)); } });
    // the TALON's arsenal: chin gun and rockets, shown only in the gunship
    // (they drive the same fire/aim flags the gunship reads in aircraft.js)
    btns.gsGun = mkBtn('GUN', 232, 30, 68, { flag: 'fire' });
    btns.gsRkt = mkBtn('RKT', 232, 112, 62, { flag: 'aim' });
    carBtns.push(btns.gas, btns.brake, btns.handbrake, btns.driveby, btns.exit, btns.radio, btns.job, btns.gsGun, btns.gsRkt);

    // the radar moves to the top-left on touch: the bottom-left corner is the
    // virtual stick's zone, and the two were fighting for the same thumb
    var mm = document.getElementById('minimap-wrap');
    if (mm) {
      mm.style.bottom = 'auto';
      mm.style.left = '10px';
      mm.style.top = '10px';
      mm.style.width = '132px';
      mm.style.height = '132px';
      mm.style.pointerEvents = 'auto';
      // tap the radar to open the full map
      mm.addEventListener('touchend', function (e) { e.preventDefault(); e.stopPropagation(); GAME.hud.toggleMap(true); }, { passive: false });
    }
    // PAUSE sits just right of the radar; sound / CRT / time / fullscreen all
    // live in the pause menu
    var pauseB = mkBtn('❚❚', 0, 0, 46, { press: function () { GAME.togglePause(); } });
    pauseB.style.right = ''; pauseB.style.bottom = '';
    pauseB.style.left = '152px'; pauseB.style.top = '12px';
    pauseB.style.fontSize = '15px';
    // fullscreen keeps its own corner control, shown on the menus (see hud.refreshFsBtn)
    var fsb = document.getElementById('fs-btn');
    if (fsb) {
      fsb.style.bottom = 'auto';
      fsb.style.right = 'auto';
      fsb.style.left = '206px';
      fsb.style.top = '12px';
      fsb.style.width = '46px';
      fsb.style.height = '46px';
    }

    // virtual stick
    stickZone.addEventListener('touchstart', function (e) {
      e.preventDefault();
      var t = e.changedTouches[0];
      stickId = t.identifier;
      baseX = t.clientX; baseY = t.clientY;
      stickBase.style.display = 'block';
      stickBase.style.left = (baseX - 60) + 'px';
      stickBase.style.top = (baseY - 60) + 'px';
      stickNub.style.display = 'block';
      moveNub(t.clientX, t.clientY);
    }, { passive: false });
    window.addEventListener('touchmove', function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier === stickId) moveNub(t.clientX, t.clientY);
        else if (t.identifier === camId) {
          GAME.input.touch.camDX = (GAME.input.touch.camDX || 0) + (t.clientX - camLX) * 2.2;
          GAME.input.touch.camDY = (GAME.input.touch.camDY || 0) + (t.clientY - camLY) * 2.2;
          camLX = t.clientX; camLY = t.clientY;
        }
      }
    }, { passive: true });
    // release the stick / camera finger on lift OR on an OS-cancelled touch,
    // otherwise the stick can stay deflected (car drives itself) after an interruption
    function endTouch(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier === stickId) {
          stickId = null;
          T.stickX = 0; T.stickY = 0;
          stickBase.style.display = 'none';
          stickNub.style.display = 'none';
        }
        if (t.identifier === camId) camId = null;
      }
    }
    window.addEventListener('touchend', endTouch);
    window.addEventListener('touchcancel', endTouch);
    // camera drag on the game canvas outside the stick zone / buttons
    document.getElementById('game-canvas').addEventListener('touchstart', function (e) {
      var t = e.changedTouches[0];
      if (t.clientX > window.innerWidth * 0.45 && camId === null && stickId !== t.identifier) {
        camId = t.identifier;
        camLX = t.clientX; camLY = t.clientY;
      }
    }, { passive: true });

    checkOrientation();
    window.addEventListener('resize', checkOrientation);

    function moveNub(x, y) {
      var dx = x - baseX, dy = y - baseY;
      var len = Math.sqrt(dx * dx + dy * dy);
      var max = 52;
      if (len > max) { dx = dx / len * max; dy = dy / len * max; }
      stickNub.style.left = (baseX + dx - 26) + 'px';
      stickNub.style.top = (baseY + dy - 26) + 'px';
      T.stickX = dx / max;
      T.stickY = dy / max;
    }
  }

  function checkOrientation() {
    if (!GAME.isTouch) return;
    var portrait = window.innerHeight > window.innerWidth;
    GAME.isPortrait = portrait;
    document.getElementById('rotate-hint').style.display = portrait ? 'flex' : 'none';
    // the rotate overlay is a menu too — you should be able to go fullscreen from it
    if (GAME.hud && GAME.hud.refreshFsBtn) GAME.hud.refreshFsBtn();
  }

  function show(btn, on) { if (btn) btn.style.display = on ? 'flex' : 'none'; }

  function update() {
    if (!enabled || !GAME.started) return;
    var T = GAME.input.touch;
    var P = GAME.player;
    // hide all controls behind menus / death screens
    var playing = !GAME.paused && !GAME.mapOpen && P.state === 'alive' && !P.parachuting;
    layer.style.display = 'block';
    if (!playing) {
      for (var i = 0; i < footBtns.length; i++) footBtns[i].style.display = 'none';
      for (var j = 0; j < carBtns.length; j++) carBtns[j].style.display = 'none';
      return;
    }
    var inCar = P.inCar;

    // stepping into or out of any vehicle drops the aim/fire flags: the foot
    // AIM toggle must not fire the TALON's rockets on boarding, and a held
    // RKT must not leave you stuck aiming when you step out
    var carNow = inCar ? P.car : null;
    if (carNow !== lastCarRef) {
      lastCarRef = carNow;
      T.aim = false; T.fire = false;
      if (btns.aim) btns.aim.style.background = '';
    }

    if (!inCar) {
      show(btns.fire, true);
      show(btns.run, true);
      show(btns.jump, true);
      // AIM only with a gun drawn (fists auto-target on the fire button)
      show(btns.aim, P.currentWeapon !== 'fist');
      // weapon switch only when more than one weapon is owned
      var owned = 0;
      for (var w in P.weapons) if (P.weapons[w] && P.weapons[w].have) owned++;
      show(btns.wpn, owned > 1);
      // ENTER only when a car is within reach
      var near = GAME.vehicles.findNearestCar(P.pos.x, P.pos.z, 5.5, null);
      show(btns.enter, !!near);
      for (var c = 0; c < carBtns.length; c++) carBtns[c].style.display = 'none';
    } else {
      var heli = P.car && P.car.spec.heli;
      var plane = P.car && P.car.spec.plane;
      var gunship = !!(P.car && P.car.spec.gunship);
      var air = heli || plane;
      show(btns.gas, true); show(btns.brake, true); show(btns.exit, true);
      // aircraft repurpose GAS/BRAKE; hide ground-only buttons
      btns.gas.textContent = heli ? '▲ UP' : plane ? 'THR+' : 'GAS';
      btns.brake.textContent = heli ? '▼ DN' : plane ? 'THR−' : 'BRAKE';
      show(btns.handbrake, !air);
      show(btns.radio, !air);
      var hasSMG = !air && P.weapons.smg && P.weapons.smg.have && P.weapons.smg.ammo > 0;
      show(btns.driveby, hasSMG);
      show(btns.job, !air && !!GAME.jobAvailable);
      // the gunship gets its own trigger pair — before this, the TALON had
      // no way to fire on touch at all (FIRE/AIM live in the foot cluster)
      show(btns.gsGun, gunship);
      show(btns.gsRkt, gunship);
      for (var f = 0; f < footBtns.length; f++) footBtns[f].style.display = 'none';
    }

    // drive-by auto-aims at the nearest side
    if (inCar && T.driveByAuto && P.car) {
      var car = P.car, side = 1, bd = 1e9, peds = GAME.world.peds;
      for (var p = 0; p < peds.length; p++) {
        var pd = peds[p];
        if (pd.dead) continue;
        var d2 = U.dist2(pd.pos.x, pd.pos.z, car.pos.x, car.pos.z);
        if (d2 < bd && d2 < 1600) {
          bd = d2;
          var dx = pd.pos.x - car.pos.x, dz = pd.pos.z - car.pos.z;
          side = (dx * Math.cos(car.heading) - dz * Math.sin(car.heading)) > 0 ? 1 : -1;
        }
      }
      T.driveByL = side > 0; T.driveByR = side < 0;
    } else { T.driveByL = false; T.driveByR = false; }
  }

  return { init: init, update: update };
})();
