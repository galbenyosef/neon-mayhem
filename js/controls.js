// Controls: key rebinding, mouse sensitivity, invert-Y, field of view, and a
// gamepad. There were none of these — the keys were what they were, the mouse
// turned at one fixed rate, and a controller did nothing at all.
//
// Rebinding is one translation step where keys come in (utils.js): the game
// still asks for 'KeyF' or 'Space' everywhere, and this decides which
// physical key that means. A key whose action has moved elsewhere stops
// meaning anything until something is bound to it.
GAME.controls = (function () {
  // the actions you can rebind, by the key the game asks for, in screen order
  var ACTIONS = [
    ['KeyW', 'Forward / throttle'], ['KeyS', 'Back / brake'], ['KeyA', 'Left'], ['KeyD', 'Right'],
    ['Space', 'Jump · climb · handbrake'], ['ShiftLeft', 'Sprint · descend'], ['KeyF', 'Enter / exit vehicle'],
    ['KeyQ', 'Target left · drive-by left'], ['KeyE', 'Target right · drive-by right'], ['Tab', 'Aim lock (toggle)'],
    ['KeyJ', 'Start a job'], ['KeyX', 'Abandon the mission (twice)'], ['KeyC', 'Take a photo'], ['KeyG', 'Horn · siren'], ['Comma', 'Radio back'], ['Period', 'Radio next'],
    ['KeyY', 'Retry a failed run'], ['KeyP', 'Map'], ['KeyM', 'Mute'], ['KeyH', 'Hide the hints'], ['KeyT', 'CRT filter'],
    ['KeyR', 'Continue after WASTED / BUSTED']
  ];
  var IS_ACTION = {};
  ACTIONS.forEach(function (a) { IS_ACTION[a[0]] = true; });
  var bound = {};     // action code -> physical code, only where it differs
  var rev = {};       // physical code -> action code
  function rebuild() {
    rev = {};
    for (var k in bound) rev[bound[k]] = k;
  }
  function physicalFor(action) { return bound[action] || action; }
  // a physical key, as the game should hear it: what it is bound to; itself,
  // unless it is an action that now lives on another key; or nothing
  function map(code) {
    if (code === 'Escape') return code;   // never rebindable: it is the way out
    if (rev[code]) return rev[code];
    if (IS_ACTION[code] && bound[code] && bound[code] !== code) return null;
    return code;
  }
  function bind(action, code) {
    if (!IS_ACTION[action] || !code || code === 'Escape') return false;
    // whatever had this key gets this action's old one: a swap, never a hole
    var old = physicalFor(action);
    for (var i = 0; i < ACTIONS.length; i++) {
      var a = ACTIONS[i][0];
      if (a !== action && physicalFor(a) === code) setBound(a, old);
    }
    setBound(action, code);
    rebuild();
    save();
    return true;
  }
  function setBound(action, code) {
    if (code === action) delete bound[action]; else bound[action] = code;
  }
  function reset() { bound = {}; rebuild(); save(); }
  function label(code) {
    var c = physicalFor(code);
    var NAMES = { Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'R-Shift', ControlLeft: 'Ctrl', ControlRight: 'R-Ctrl',
      AltLeft: 'Alt', Tab: 'Tab', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[',
      BracketRight: ']', Backquote: '`', Minus: '-', Equal: '=', Enter: 'Enter', Backspace: 'Bksp',
      ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', CapsLock: 'Caps' };
    if (NAMES[c]) return NAMES[c];
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    if (/^Digit\d$/.test(c)) return c.slice(5);
    if (/^Numpad/.test(c)) return 'Num' + c.slice(6);
    return c;
  }

  // ---------- look ----------
  var sens = 1, invertY = false, fov = 62;
  var SENS_STEPS = [0.5, 0.7, 0.85, 1, 1.25, 1.5, 2], FOV_STEPS = [55, 62, 70, 80, 90];
  function applyFov() {
    var cam = GAME.cameraObj;
    if (cam && cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  function save() {
    if (!GAME.prefs) return;
    GAME.prefs.controls = { bound: bound, sens: sens, invertY: invertY, fov: fov };
    if (GAME.save) GAME.save();
    if (GAME.hud && GAME.hud.keysChanged) GAME.hud.keysChanged();
  }
  function load() {
    var c = GAME.prefs && GAME.prefs.controls;
    if (!c) return;
    bound = c.bound || {};
    for (var k in bound) if (!IS_ACTION[k]) delete bound[k];
    rebuild();
    if (GAME.hud && GAME.hud.keysChanged) GAME.hud.keysChanged();
    if (c.sens) sens = c.sens;
    invertY = !!c.invertY;
    if (c.fov) fov = c.fov;
    applyFov();
  }

  // ---------- the gamepad ----------
  // Standard mapping. Sticks and triggers are analog and read where the touch
  // stick is (GAME.pad); the buttons become the keys they stand for, pressed
  // and released like a keyboard would, so everything that answers a key
  // answers the pad without knowing it exists.
  var pad = { on: false, lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 };
  var DEAD = 0.18;
  var BUTTONS = {
    0: 'Space', 1: 'ShiftLeft', 2: 'KeyJ', 3: 'KeyF', 4: 'KeyQ', 5: 'KeyE',
    8: 'KeyP', 9: 'Escape', 10: 'KeyC', 11: 'KeyG', 12: 'KeyY', 14: 'Comma', 15: 'Period'
  };
  // what the buttons mean on a menu (pause screen arrows and Enter)
  var MENU = { 0: 'Enter', 1: 'Escape', 9: 'Escape', 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight' };
  var held = {}, fireHeld = false, aimHeld = false, toldPad = false;
  function axis(v) { return Math.abs(v) < DEAD ? 0 : (v - (v > 0 ? DEAD : -DEAD)) / (1 - DEAD); }
  function keyDown(code) {
    var inp = GAME.input;
    if (!inp.keys[code]) { inp.keys[code] = true; inp.pressed[code] = true; }
    if (GAME.onKeyDown) GAME.onKeyDown(code);
  }
  function keyUp(code) { GAME.input.keys[code] = false; }
  function poll(dt) {
    var list = navigator.getGamepads ? navigator.getGamepads() : null, g = null;
    if (list) for (var i = 0; i < list.length; i++) if (list[i] && list[i].connected) { g = list[i]; break; }
    if (!g) {
      if (pad.on) release();
      return;
    }
    if (!pad.on) {
      pad.on = true;
      if (!toldPad && GAME.started) { toldPad = true; GAME.hud.message('Controller connected — sticks to move and look, RT/LT throttle and brake (fire and aim on foot), A jump, Y vehicle, Start pause.', 6); }
    }
    var ax = g.axes || [], bt = g.buttons || [];
    pad.lx = axis(ax[0] || 0); pad.ly = axis(ax[1] || 0);
    pad.rx = axis(ax[2] || 0); pad.ry = axis(ax[3] || 0);
    pad.lt = bt[6] ? bt[6].value : 0; pad.rt = bt[7] ? bt[7].value : 0;
    var inp = GAME.input, P = GAME.player;
    var menu = GAME.paused || GAME.mapOpen || GAME.shopOpen || GAME.shareOpen || !GAME.started;
    // the right stick turns the camera at a rate, as the mouse does in pixels
    if (!menu) {
      inp.mouseDX += pad.rx * 900 * dt;
      inp.mouseDY += pad.ry * 600 * dt;
    }
    // triggers on foot: fire and aim
    var onFoot = !(P && P.inCar);
    var fire = onFoot && !menu && pad.rt > 0.5, aim = onFoot && !menu && pad.lt > 0.5;
    if (fire && !fireHeld) { inp.lmb = true; inp.lmbPressed = true; }
    if (!fire && fireHeld) inp.lmb = false;
    if (aim !== aimHeld) inp.rmb = aim;
    fireHeld = fire; aimHeld = aim;
    for (var b = 0; b < bt.length; b++) {
      var down = !!(bt[b] && bt[b].pressed), was = !!held[b];
      if (down === was) continue;
      held[b] = down;
      var code = menu ? (MENU[b] || null) : (BUTTONS[b] || null);
      if (!menu && b === 13 && down) inp.touch.weaponCycle = true;   // d-pad down: next weapon
      if (!code) continue;
      if (down) keyDown(code); else keyUp(code);
    }
  }
  function release() {
    pad.on = false;
    pad.lx = pad.ly = pad.rx = pad.ry = pad.lt = pad.rt = 0;
    for (var b in held) if (held[b] && BUTTONS[b]) keyUp(BUTTONS[b]);
    held = {};
    if (fireHeld) GAME.input.lmb = false;
    if (aimHeld) GAME.input.rmb = false;
    fireHeld = aimHeld = false;
  }

  // ---------- the CONTROLS screen ----------
  var waiting = null;   // the action waiting for its new key
  function $(id) { return document.getElementById(id); }
  function render() {
    var box = $('controls-list');
    if (!box) return;
    box.innerHTML = ACTIONS.map(function (a) {
      var w = waiting === a[0];
      return '<div class="crow"><span>' + a[1] + '</span><span class="mbtn ckey' + (w ? ' wait' : '') + '" data-a="' + a[0] + '">' +
        (w ? 'press a key…' : label(a[0])) + '</span></div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.ckey'), function (el) {
      el.addEventListener('click', function (e) { e.stopPropagation(); waiting = el.getAttribute('data-a'); render(); });
    });
    $('ctl-sens').textContent = 'MOUSE: ' + sens.toFixed(2) + '×';
    $('ctl-invert').textContent = 'INVERT Y: ' + (invertY ? 'ON' : 'OFF');
    $('ctl-fov').textContent = 'FIELD OF VIEW: ' + fov + '°';
    $('ctl-pad').textContent = pad.on ? '🎮 Controller connected' : '🎮 Plug in a controller and press a button — it works straight away';
  }
  function step(list, v, dir) {
    var i = list.indexOf(v);
    if (i < 0) i = 0;
    return list[(i + dir + list.length) % list.length];
  }
  var open = false;
  function show(on) {
    open = on;
    waiting = null;
    var el = $('controls-screen');
    if (el) el.style.display = on ? 'flex' : 'none';
    if (on) render();
  }
  // a key pressed while the screen is open: the one being rebound takes it
  function key(code) {
    if (!open) return false;
    if (waiting) {
      if (code !== 'Escape') bind(waiting, code);
      waiting = null;
      render();
      return true;
    }
    if (code === 'Escape') { show(false); return true; }
    return true;   // the screen owns the keyboard while it is up
  }
  function init() {
    load();
    var wire = function (id, fn) {
      var el = $(id);
      if (!el) return;
      ['click', 'touchend'].forEach(function (ev) {
        el.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); fn(); render(); });
      });
    };
    wire('ctl-sens', function () { sens = step(SENS_STEPS, sens, 1); save(); });
    wire('ctl-invert', function () { invertY = !invertY; save(); });
    wire('ctl-fov', function () { fov = step(FOV_STEPS, fov, 1); applyFov(); save(); });
    wire('ctl-reset', function () { reset(); sens = 1; invertY = false; fov = 62; applyFov(); save(); });
    wire('ctl-close', function () { show(false); });
    window.addEventListener('gamepadconnected', function () { toldPad = false; });
  }

  return {
    ACTIONS: ACTIONS,
    map: map, bind: bind, reset: reset, label: label, init: init,
    show: show, key: key, poll: poll,
    get open() { return open; },
    get sens() { return sens; },
    get invertY() { return invertY; },
    get fov() { return fov; },
    setSens: function (v) { sens = v; save(); },
    setInvertY: function (v) { invertY = !!v; save(); },
    setFov: function (v) { fov = v; applyFov(); save(); },
    pad: pad
  };
})();
GAME.pad = GAME.controls.pad;
