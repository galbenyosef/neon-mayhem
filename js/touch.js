GAME.touch = (function () {
  var layer, stickZone, stickBase, stickNub;
  var stickId = null, camId = null, camLX = 0, camLY = 0;
  var baseX = 0, baseY = 0;
  var footBtns = [], carBtns = [];

  function detect() {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
  }

  function mkBtn(label, right, bottom, size, opts) {
    var b = document.createElement('div');
    b.className = 'tbtn';
    b.textContent = label;
    b.style.right = right + 'px';
    b.style.bottom = bottom + 'px';
    b.style.width = size + 'px';
    b.style.height = size + 'px';
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
    b.addEventListener('touchend', function (e) {
      e.preventDefault(); e.stopPropagation();
      b.classList.remove('held');
      if (opts.flag && !opts.toggle) T[opts.flag] = false;
      if (opts.release) opts.release();
    }, { passive: false });
    return b;
  }

  function init() {
    GAME.isTouch = detect();
    if (!GAME.isTouch) return;
    var S = GAME.settings;
    S.pixelRatioCap = 1.4;
    S.bubbleRadius = 110;
    S.maxTraffic = 8;
    S.maxPeds = 12;
    S.maxParked = 9;

    layer = document.getElementById('touch-layer');
    stickZone = document.getElementById('tstick-zone');
    stickBase = document.getElementById('tstick-base');
    stickNub = document.getElementById('tstick-nub');
    var T = GAME.input.touch;
    T.active = true;
    T.autoThrottle = true;

    // on-foot buttons
    footBtns.push(mkBtn('FIRE', 26, 60, 84, { flag: 'fire', press: function () { T.firePressed = true; } }));
    footBtns.push(mkBtn('AIM', 124, 46, 64, { flag: 'aim', toggle: true }));
    footBtns.push(mkBtn('CAR', 30, 160, 60, { flag: 'enter' }));
    footBtns.push(mkBtn('WPN', 116, 128, 56, { press: function () { T.weaponCycle = true; } }));
    // in-car buttons
    carBtns.push(mkBtn('BRAKE', 26, 60, 84, { flag: 'brake' }));
    carBtns.push(mkBtn('DRIFT', 124, 46, 66, { flag: 'handbrake' }));
    carBtns.push(mkBtn('FIRE', 30, 162, 62, { flag: 'driveByAuto' }));
    carBtns.push(mkBtn('EXIT', 118, 132, 56, { flag: 'enter' }));
    carBtns.push(mkBtn('♪', 190, 40, 48, { press: function () { GAME.hud.radioPopup(GAME.audio.radio.switchStation(1)); } }));
    // persistent corner buttons
    var pauseB = mkBtn('❚❚', 0, 0, 44, { press: function () { GAME.togglePause(); } });
    pauseB.style.right = ''; pauseB.style.bottom = ''; pauseB.style.left = '210px'; pauseB.style.top = '8px';
    var muteB = mkBtn('♬', 0, 0, 44, { press: function () { GAME.audio.toggleMute(); } });
    muteB.style.right = ''; muteB.style.bottom = ''; muteB.style.left = '262px'; muteB.style.top = '8px';

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
    window.addEventListener('touchend', function (e) {
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
    });
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
    document.getElementById('rotate-hint').style.display = portrait ? 'flex' : 'none';
  }

  function update() {
    if (!GAME.isTouch || !GAME.started) return;
    layer.style.display = 'block';
    var inCar = GAME.player.inCar;
    for (var i = 0; i < footBtns.length; i++) footBtns[i].style.display = inCar ? 'none' : 'flex';
    for (var j = 0; j < carBtns.length; j++) carBtns[j].style.display = inCar ? 'flex' : 'none';
    // single drive-by button picks the side with the nearest threat
    var T = GAME.input.touch;
    if (inCar && T.driveByAuto && GAME.player.car) {
      var car = GAME.player.car;
      var side = 1;
      var bd = 1e9, peds = GAME.world.peds;
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
      T.driveByL = side < 0;
      T.driveByR = side > 0;
    } else {
      T.driveByL = false; T.driveByR = false;
    }
  }

  return { init: init, update: update };
})();
