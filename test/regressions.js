// Regression test — one check per bug that has been fixed, so it stays fixed.
//
//   node test/regressions.js
//
// Same setup as smoke.js: the `playwright` npm package and a Chromium
// (CHROMIUM_PATH env var, or Playwright's own browser install), the repo
// served on an ephemeral port — no other setup, no network.
//
// Where smoke.js asks "does the game still run", this asks "do these
// particular bugs stay dead". Every check here fails on the code as it was
// before its fix, which is the only thing that makes a regression check
// worth having: a test that cannot fail is decoration.
//
// What it holds the game to:
//   1. OVERLAY AUDIO  — the tick halts behind pause, the map and a result
//      card, and every looping voice is a held gain node the tick would
//      otherwise leave sustaining. Each overlay must stop engine, skid,
//      siren and radio, and hand the radio back only to a LIVING driver.
//   2. EDGE INPUT     — every caller of GAME.keyPressed sits behind a mode
//      gate, so a press must be claimable exactly once and an unclaimed one
//      must not survive the tick it arrived in, in either direction.
//   3. PARACHUTE      — a life that ends under the canopy must stow it, so
//      it is not left hanging over the body through the wasted screen and
//      the first living frame does not run a glide step at the hospital.
//   4. UNLIMITED AMMO — the all-jumps reward must read as ∞, not as the
//      frozen 999 the stopped decrement leaves behind.
//   5. STEREO IMAGE   — a sound's pan must agree with the direction the
//      player actually moves, so the field can never end up mirrored.
var http = require('http');
var fs = require('fs');
var path = require('path');
var { chromium } = require('playwright');

var ROOT = path.join(__dirname, '..');
var MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };

function serve() {
  return new Promise(function (resolve) {
    var srv = http.createServer(function (req, res) {
      var p = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0])));
      if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      if (p === ROOT || p === ROOT + path.sep) p = path.join(ROOT, 'index.html');
      fs.readFile(p, function (err, data) {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', function () { resolve(srv); });
  });
}

// the three overlays that halt the tick and start the title pads
var OVERLAYS = [
  { name: 'result card', key: 'share' },
  { name: 'pause', key: 'pause' },
  { name: 'map', key: 'map' }
];

(async function () {
  var failures = [];
  function check(name, ok, detail) {
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  —  ' + detail : ''));
    if (!ok) failures.push(name);
  }

  var srv = await serve();
  var origin = 'http://127.0.0.1:' + srv.address().port;
  var browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    // the autoplay flag is belt-and-braces: these checks spy on the audio
    // API rather than on real gain, so a suspended context would pass too
    args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']
  });
  var page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  var pageErrors = [], consoleErrors = [];
  page.on('pageerror', function (e) { pageErrors.push(String(e.message).slice(0, 200)); });
  page.on('console', function (m) { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });

  await page.goto(origin + '/index.html');
  await page.waitForFunction(function () {
    return window.GAME && GAME.test && GAME.city && GAME.city.nodes && GAME.city.nodes.length > 0;
  }, null, { timeout: 30000 });

  // The looping voices live on gain nodes private to the audio module, so
  // the only thing observable from out here is the API that drives them.
  // Record the calls and assert on those.
  await page.evaluate(function () {
    GAME.test.start();
    GAME.test.fastForward(1);
    var a = GAME.audio;
    var engine0 = a.engineState, skid0 = a.skid, siren0 = a.siren, vol0 = a.radio.setVolume;
    window.__spy = null;
    window.__record = function () { window.__spy = { engine: [], skid: [], siren: [], radio: [] }; };
    a.engineState = function (on) { if (window.__spy) window.__spy.engine.push(!!on); return engine0.apply(a, arguments); };
    a.skid = function (v) { if (window.__spy) window.__spy.skid.push(v); return skid0.apply(a, arguments); };
    a.siren = function (v) { if (window.__spy) window.__spy.siren.push(v); return siren0.apply(a, arguments); };
    a.radio.setVolume = function (v) { if (window.__spy) window.__spy.radio.push(v); return vol0.apply(a.radio, arguments); };
    window.__msgs = [];
    var msg0 = GAME.hud.message;
    GAME.hud.message = function (t) { window.__msgs.push(String(t)); return msg0.apply(GAME.hud, arguments); };
    window.__overlay = function (key, open) {
      if (key === 'share') {
        if (open) GAME.share.show({ slug: 'regress', eyebrow: 'test', title: 'T', subtitle: 's', accent: '#ffffff', stats: [] });
        else GAME.share.hide();
      } else if (key === 'pause') GAME.togglePause();
      else GAME.hud.toggleMap(open);
    };
  });

  // ---------- 1: overlay audio ----------
  var driving = await page.evaluate(function () {
    GAME.test.spawnCar('sedan', 4, 0);
    GAME.test.fastForward(0.2);
    GAME.test.enterNearestCar();
    GAME.test.fastForward(1.2);
    return GAME.player.inCar === true;
  });
  check('setup: player is driving', driving);

  for (var i = 0; i < OVERLAYS.length; i++) {
    var ov = OVERLAYS[i];
    var r = await page.evaluate(function (key) {
      window.__record();
      window.__overlay(key, true);
      var opened = window.__spy;
      window.__record();
      window.__overlay(key, false);
      return { opened: opened, closed: window.__spy };
    }, ov.key);
    check(ov.name + ': engine silenced', r.opened.engine.indexOf(false) >= 0, JSON.stringify(r.opened.engine));
    check(ov.name + ': skid silenced', r.opened.skid.indexOf(0) >= 0, JSON.stringify(r.opened.skid));
    check(ov.name + ': siren silenced', r.opened.siren.indexOf(0) >= 0, JSON.stringify(r.opened.siren));
    check(ov.name + ': radio silenced', r.opened.radio.indexOf(0) >= 0, JSON.stringify(r.opened.radio));
    check(ov.name + ': radio restored on close',
      r.closed.radio.some(function (v) { return v > 0; }), JSON.stringify(r.closed.radio));
  }

  // the radio belongs to the car, not the player: it must not come back for
  // someone on foot (nor, by the same rule, over their own corpse)
  var onFoot = await page.evaluate(function () {
    GAME.test.exitCar();
    GAME.test.fastForward(0.5);
    window.__record();
    GAME.togglePause();
    GAME.togglePause();
    return { foot: !GAME.player.inCar, radio: window.__spy.radio };
  });
  check('on foot: radio stays silent through pause',
    onFoot.foot && !onFoot.radio.some(function (v) { return v > 0; }), JSON.stringify(onFoot.radio));

  // ---------- 2: edge-triggered input ----------
  var edge = await page.evaluate(function () {
    // a press is claimable once, by whoever asks first
    GAME.test.pressKey('KeyZ', true);
    var first = GAME.keyPressed('KeyZ'), second = GAME.keyPressed('KeyZ');
    GAME.test.pressKey('KeyZ', false);
    // and a press nobody claims must die with the tick it arrived in — while
    // the key is still physically DOWN, which is the case the old cache got
    // wrong: never written while nobody was asking, it read a hold nobody
    // had claimed as a brand new press the next time somebody did
    GAME.test.pressKey('KeyX', true);
    GAME.test.fastForward(0.1);
    var lingered = GAME.keyPressed('KeyX');
    GAME.test.pressKey('KeyX', false);
    return { first: first, second: second, lingered: lingered };
  });
  check('edge input: a press fires exactly once', edge.first === true && edge.second === false,
    'first=' + edge.first + ' second=' + edge.second);
  check('edge input: a held but unclaimed press does not survive its tick', edge.lingered === false);

  // The same thing through the game rather than through the API. Comma and
  // Period are asked for only while driving, so a hold that starts on foot
  // is not a car input — but the old cache had no entry for the gate being
  // shut, so the hold was read as a fresh press the moment the door closed
  // and changed station on its own.
  var radio = await page.evaluate(function () {
    var n = 0, sw = GAME.audio.radio.switchStation;
    GAME.audio.radio.switchStation = function () { n++; return sw.apply(GAME.audio.radio, arguments); };
    GAME.test.exitCar();
    GAME.test.fastForward(0.6);
    GAME.test.pressKey('Comma', true);      // held where nothing polls it
    GAME.test.fastForward(0.6);
    var onFoot = n;
    GAME.test.enterNearestCar();            // ...and still held on the way in
    GAME.test.fastForward(2.0);
    var onEntry = n;
    GAME.test.pressKey('Comma', false);     // a real press still has to work
    GAME.test.fastForward(0.1);
    GAME.test.pressKey('Comma', true);
    GAME.test.fastForward(0.1);
    var afterPress = n;
    GAME.test.pressKey('Comma', false);
    GAME.audio.radio.switchStation = sw;
    return { onFoot: onFoot, onEntry: onEntry, afterPress: afterPress, inCar: GAME.player.inCar };
  });
  check('edge input: holding a car-only key on foot changes nothing', radio.onFoot === 0, 'switches=' + radio.onFoot);
  check('edge input: and it does not fire itself off when the door closes', radio.onEntry === 0, 'switches=' + radio.onEntry);
  check('edge input: a real press in the car still switches the station',
    radio.inCar && radio.afterPress === 1, 'in car=' + radio.inCar + ' switches=' + radio.afterPress);

  // an overlay halts the tick, so nothing there would drain the buffer
  await page.evaluate(function () { GAME.togglePause(); GAME.test.pressKey('KeyC', true); });
  var drained = true;
  try {
    await page.waitForFunction(function () { return !(GAME.input.pressed || {})['KeyC']; }, null, { timeout: 5000 });
  } catch (e) { drained = false; }
  await page.evaluate(function () { GAME.test.pressKey('KeyC', false); GAME.togglePause(); });
  check('edge input: a press behind an overlay is not gameplay input', drained);

  // ---------- 3: parachute stowed when the life ends ----------
  var chute = await page.evaluate(function () {
    GAME.aircraft.startParachute(GAME.player.pos.x, GAME.player.pos.y + 60, GAME.player.pos.z, 0);
    // the canopy is the only 2.3-radius half sphere in the scene
    var mesh = null;
    GAME.scene.traverse(function (m) {
      var g = m.geometry;
      if (g && g.type === 'SphereGeometry' && g.parameters && g.parameters.radius === 2.3) mesh = m;
    });
    var gliding = GAME.player.parachuting, up = !!(mesh && mesh.visible);
    window.__msgs = [];
    GAME.playerWasted('shot');
    return {
      gliding: gliding, found: !!mesh, up: up,
      stowed: GAME.player.parachuting === false,
      hidden: !!(mesh && !mesh.visible)
    };
  });
  check('parachute: canopy opened', chute.gliding === true);
  check('parachute: found the canopy mesh (detector sanity)', chute.found);
  check('parachute: canopy IS visible while gliding (detector sanity)', chute.up);
  check('parachute: stowed the moment the life ends', chute.stowed);
  check('parachute: canopy not left hanging over the body', chute.hidden);

  // Now a REAL respawn, which is the half that catches the glide step. The
  // sim clock arms the R-to-continue gate (stateT > 0.6) and calls
  // respawnAfterScreen(); its fade callback is a 550 ms setTimeout, so only
  // wall time gets us the other side of it — fastForward never would.
  await page.evaluate(function () {
    GAME.input.keys['KeyR'] = true;
    GAME.test.fastForward(1.2);
    GAME.input.keys['KeyR'] = false;
  });
  var revived = true;
  try {
    await page.waitForFunction(function () { return GAME.player.state === 'alive'; }, null, { timeout: 10000 });
  } catch (e) { revived = false; }
  var respawn = await page.evaluate(function () {
    // give a stuck glide step every chance to run and announce itself, so
    // this catches the bug instead of racing the toast off the screen
    GAME.test.fastForward(3);
    return { parachuting: GAME.player.parachuting, msgs: window.__msgs };
  });
  check('parachute: real respawn completed', revived);
  check('parachute: still stowed after a real respawn', respawn.parachuting === false);
  check('parachute: no glide step ran at the hospital ("Feet dry.")',
    !respawn.msgs.some(function (m) { return m.indexOf('Feet dry') >= 0; }),
    JSON.stringify(respawn.msgs.slice(-3)));

  // ---------- 4: unlimited ammo reads as unlimited ----------
  var ammo = await page.evaluate(function () {
    GAME.test.fastForward(1);
    GAME.unlimitedAmmo = false;
    GAME.combat.giveWeapon('pistol', 40);
    GAME.combat.refreshWeaponHud();
    var finite = document.getElementById('weapon-line').textContent;
    GAME.unlimitedAmmo = true;
    GAME.combat.giveAllWeapons();
    return { finite: finite, unlimited: document.getElementById('weapon-line').textContent };
  });
  check('ammo: a finite count still shows a number',
    /\d/.test(ammo.finite) && ammo.finite.indexOf('∞') < 0, JSON.stringify(ammo.finite));
  check('ammo: unlimited shows ∞, not 999',
    ammo.unlimited.indexOf('∞') >= 0 && ammo.unlimited.indexOf('999') < 0, JSON.stringify(ammo.unlimited));

  // ---------- 5: the stereo image points the right way ----------
  // The one thing worth pinning: a mirrored field is both easy to write and
  // hard to notice in a headless run. So rather than restate the basis (and
  // risk restating it wrong the same way twice), take the direction the game
  // ITSELF moves the player when they hold D, and require sound to agree.
  var pan = await page.evaluate(function () {
    var P = GAME.player;
    GAME.test.teleport(350, 300);            // open ground, nothing to bump
    GAME.test.fastForward(0.6);
    GAME.cam.yaw = 0.7;
    var x0 = P.pos.x, z0 = P.pos.z;
    GAME.input.keys['KeyD'] = true;          // "right" as the player feels it
    GAME.test.fastForward(0.6);
    GAME.input.keys['KeyD'] = false;
    var dx = P.pos.x - x0, dz = P.pos.z - z0;
    var moved = Math.sqrt(dx * dx + dz * dz);
    GAME.test.fastForward(0.3);
    GAME.audio.setListener(P.pos.x, P.pos.z, GAME.cam.yaw);
    var fx = Math.sin(GAME.cam.yaw), fz = Math.cos(GAME.cam.yaw);
    return {
      moved: moved,
      right: GAME.audio.testPan(P.pos.x + dx * 40, P.pos.z + dz * 40),
      left: GAME.audio.testPan(P.pos.x - dx * 40, P.pos.z - dz * 40),
      ahead: GAME.audio.testPan(P.pos.x + fx * 40, P.pos.z + fz * 40),
      behind: GAME.audio.testPan(P.pos.x - fx * 40, P.pos.z - fz * 40),
      onTop: GAME.audio.testPan(P.pos.x, P.pos.z)
    };
  });
  check('stereo: the player actually moved (anchor sanity)', pan.moved > 0.5, 'moved=' + pan.moved);
  check('stereo: a sound where D takes you pans right', pan.right > 0.5, 'pan=' + pan.right);
  check('stereo: and the opposite side pans left', pan.left < -0.5, 'pan=' + pan.left);
  check('stereo: dead ahead and dead behind sit centre',
    Math.abs(pan.ahead) < 0.05 && Math.abs(pan.behind) < 0.05, 'ahead=' + pan.ahead + ' behind=' + pan.behind);
  check('stereo: a source on the listener does not jitter', pan.onTop === 0, 'pan=' + pan.onTop);
  check('stereo: nothing pins fully to one ear',
    Math.abs(pan.right) <= 0.85 && Math.abs(pan.left) <= 0.85, 'r=' + pan.right + ' l=' + pan.left);

  // and the wiring: a chase has to tell the siren WHERE the cruiser is
  var siren = await page.evaluate(function () {
    var seen = null, s0 = GAME.audio.siren;
    GAME.audio.siren = function (v, p, x, z) { if (v > 0) seen = { x: x, z: z }; return s0.apply(GAME.audio, arguments); };
    GAME.test.setWanted(3);
    GAME.test.fastForward(6);
    GAME.audio.siren = s0;
    return { seen: seen, wanted: GAME.police.wanted };
  });
  check('stereo: a chasing cruiser gives the siren its position',
    !!siren.seen && isFinite(siren.seen.x) && isFinite(siren.seen.z),
    'wanted=' + siren.wanted + ' got=' + JSON.stringify(siren.seen));

  // ---------- nothing broke on the way through ----------
  await page.evaluate(function () { GAME.test.fastForward(5); });
  check('clean: zero page errors', pageErrors.length === 0, pageErrors[0]);
  check('clean: zero console.error', consoleErrors.length === 0, consoleErrors[0]);

  await browser.close();
  srv.close();
  if (failures.length) {
    console.log('\nREGRESSIONS: ' + failures.length + ' failure(s): ' + failures.join(', '));
    process.exit(1);
  }
  console.log('\nREGRESSIONS: all checks passed');
})().catch(function (e) { console.error('REGRESSIONS: runner crashed — ' + e.message); process.exit(1); });
