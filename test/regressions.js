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
//   2. PARACHUTE      — a life that ends under the canopy must stow it, so
//      it is not left hanging over the body through the wasted screen and
//      the first living frame does not run a glide step at the hospital.
//   3. UNLIMITED AMMO — the all-jumps reward must read as ∞, not as the
//      frozen 999 the stopped decrement leaves behind.
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

  // ---------- 2: parachute stowed when the life ends ----------
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

  // ---------- 3: unlimited ammo reads as unlimited ----------
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
