// Smoke test — the README's "every change ships only after headless
// verification" claim, enforceable by a machine instead of by discipline.
//
//   node test/smoke.js
//
// Needs the `playwright` npm package and a Chromium (CHROMIUM_PATH env var,
// or Playwright's own browser install). Serves the repo itself on an
// ephemeral port — no other setup, no network.
//
// What it holds the game to:
//   1. BOOT      — the world builds and the test API appears within 30 s
//   2. CLEAN     — zero page errors and zero console.error through boot,
//                  start, and a minute of simulated play
//   3. OFFLINE   — served from localhost, the page makes NO external
//                  request (the analytics no-op promise, enforced)
//   4. STEADY    — heavy spawn-bubble churn leaves the live geometry count
//                  flat: catches disposal leaks and shared-registry breaks
//   5. ALIVE     — the clock advances and the player survives settling
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
    args: ['--enable-unsafe-swiftshader']
  });
  var page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  var pageErrors = [], consoleErrors = [], externalRequests = [];
  page.on('pageerror', function (e) { pageErrors.push(String(e.message).slice(0, 200)); });
  page.on('console', function (m) { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('request', function (r) {
    var u = r.url();
    if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) return;
    externalRequests.push(u.slice(0, 120));
  });

  // 1: boot
  var booted = true;
  try {
    await page.goto(origin + '/index.html');
    await page.waitForFunction(function () {
      return window.GAME && GAME.test && GAME.city && GAME.city.nodes && GAME.city.nodes.length > 0;
    }, null, { timeout: 30000 });
  } catch (e) { booted = false; }
  check('boot: world built, test API up', booted);

  var churn = { geometriesStart: -1, geometriesEnd: -2, time0: 0, time1: 0, alive: false };
  if (booted) {
    churn = await page.evaluate(function () {
      GAME.test.start();
      for (var i = 0; i < 240; i++) GAME.tick(1 / 60);
      var geo0 = GAME.renderer.info.memory.geometries;
      var t0 = GAME.time;
      // spawn-bubble churn: hop between far districts so cars and peds turn
      // over completely, several times
      var stops = [[300, -80], [-300, 200], [0, -300], [350, 300], [-380, -100], [120, 100]];
      for (var round = 0; round < 2; round++) {
        for (var s = 0; s < stops.length; s++) {
          GAME.test.teleport(stops[s][0], stops[s][1]);
          for (var k = 0; k < 120; k++) GAME.tick(1 / 60);
        }
      }
      return {
        geometriesStart: geo0,
        geometriesEnd: GAME.renderer.info.memory.geometries,
        time0: t0, time1: GAME.time,
        alive: GAME.player.state === 'alive'
      };
    });
  }

  // 2: clean console
  check('clean: zero page errors', pageErrors.length === 0, pageErrors[0]);
  check('clean: zero console.error', consoleErrors.length === 0, consoleErrors[0]);

  // 3: offline promise — localhost play makes no external request at all
  check('offline: zero external requests', externalRequests.length === 0, externalRequests[0]);

  // 4: steady geometry under churn (slack covers late shared-cache fills,
  //    which are bounded by the vehicle palette — a leak grows per spawn)
  var grown = churn.geometriesEnd - churn.geometriesStart;
  check('steady: geometry count flat under churn', booted && grown <= 60,
    churn.geometriesStart + ' -> ' + churn.geometriesEnd);

  // 5: the simulation simulates
  check('alive: sim clock advanced', booted && churn.time1 > churn.time0 + 15);
  check('alive: player survived settling', booted && churn.alive);

  await browser.close();
  srv.close();
  if (failures.length) {
    console.log('\nSMOKE: ' + failures.length + ' failure(s): ' + failures.join(', '));
    process.exit(1);
  }
  console.log('\nSMOKE: all checks passed');
})().catch(function (e) { console.error('SMOKE: runner crashed — ' + e.message); process.exit(1); });
