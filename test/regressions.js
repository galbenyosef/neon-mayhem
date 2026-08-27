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
//   3f. PARKED AIRFRAME — solid to drive into, and still shoves nobody.
//   3e. ISLAND RACES — the gates follow the road they are named for, and sit
//       close enough together that the line between two of them stays on it.
//   3d. POLICE AIM — the round lands where the tracer put it, and range,
//       speed and the officer holding the gun all decide where that is.
//   3c. WANTED LADDER — each star has to cost more offences than the last.
//   3b. CANOPY OVER WATER — open sea BELOW a glide is not the sea you are in.
//   4. UNLIMITED AMMO — the all-jumps reward must read as ∞, not as the
//      frozen 999 the stopped decrement leaves behind.
//   5. STEREO IMAGE   — a sound's pan must agree with the direction the
//      player actually moves, so the field can never end up mirrored.
//   6. RIDING A ROOF  — a chassis that pitches has to carry its passenger
//      with it, rather than leaving them on the roof it would have had
//      sitting still.
//   7. HAPTICS        — a buzz per knock, rationed, silenceable, and safe on
//      a browser with no motor at all. Then the vocabulary on top of that: no
//      two kinds may feel the same, the tiers must preempt in one direction
//      only, and the events with a body behind them — a run-over, a star, a
//      fire, a blast, a canopy touching down — are driven through the game
//      rather than through the module door. Then the one SUSTAINED channel,
//      which runs on its own timer: it has to keep pulsing, stop itself when
//      the caller goes quiet, and never take the channel from a one-shot.
//   8. FRAME BUDGET   — the crowd thins when frames run late and, more to
//      the point, comes BACK when they do not.
//   9. SHOWROOM       — a bought vehicle is delivered once, not twice.
//  10. RACE GRID      — the field lines up where you can see it, and the
//      rubber band moves something that can actually close a gap.
//  11. AIR CONTROL    — the pedals stop at the lip and the wheel does not.
//  12. SUSPENSION     — weight moves when speed does: the nose lifts under
//      power and dives under the brakes, on TOP of whatever grade the wheels
//      are on, and settles back to it.
//  13. TOUCH STICK    — a viewport change mid-drag must let the stick go
//      rather than keep steering from an origin on the old screen.
//  14. BROADPHASE     — a non-finite lookup has to return, not spin. This
//      group runs LAST and under a timeout of its own: without the guard the
//      page does not fail, it stops answering.
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

// A page that hangs never rejects, so the one group that can hang gets a
// deadline in the runner rather than in the browser.
function withTimeout(p, ms) {
  var timer;
  return Promise.race([
    p.then(function (v) { clearTimeout(timer); return v; },
           function (e) { clearTimeout(timer); throw e; }),
    new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error('hung')); }, ms); })
  ]);
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
    var _ride = GAME.test.spawnCar('sedan', 4, 0);
    GAME.test.fastForward(0.2);
    GAME.test.enterNearestCar(_ride);
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

  // ---------- 3b: a canopy over the sea has not landed in it ----------
  // isInWater answers for the whole column at (x, z): its y argument only
  // rules out a deck or a crossing carried over the top, and never asks how
  // high up the point is. Asked once a frame through a glide, that soaked you
  // on the FIRST frame after stepping out over the bay — sixty metres up, with
  // the beach still well inside the canopy's reach.
  var sea = await page.evaluate(function () {
    var P = GAME.player, r = {};
    GAME.police.clearWanted();
    P.health = 100;
    if (P.inCar) GAME.exitCar();
    // open sea, no pier, nothing built over it
    var wx = null, wz = null;
    for (var x = 380; x <= 900 && wx === null; x += 8) {
      for (var z = -240; z <= 240; z += 24) {
        if (GAME.city.isInWater(x, z) && !GAME.city.isOnPier(x, z)) { wx = x; wz = z; break; }
      }
    }
    r.found = wx !== null;
    if (!r.found) return r;
    r.at = [wx, wz];
    r.seaLevel = GAME.city.surfaceY(wx, wz);

    window.__msgs = [];
    GAME.aircraft.startParachute(wx, 60, wz, 0);
    r.opened = !!P.parachuting;
    // two seconds of glide, high over open water
    GAME.test.fastForward(2);
    r.aloft = { para: !!P.parachuting, y: Math.round(P.pos.y), wet: !!P.drowning };
    // then all the way down onto it
    for (var i = 0; i < 60 * 25 && P.parachuting; i++) GAME.test.fastForward(1 / 60);
    r.down = { para: !!P.parachuting, y: Math.round(P.pos.y), wet: !!P.drowning };
    r.msgs = window.__msgs.slice();
    return r;
  });
  check('parachute: there is open sea to glide over, at sea level (anchor sanity)',
    sea.found === true && sea.seaLevel <= 0.05 && sea.opened === true,
    'at=' + JSON.stringify(sea.at) + ' level=' + sea.seaLevel + ' opened=' + sea.opened);
  check('parachute: gliding OVER the sea is not being in it',
    sea.aloft && sea.aloft.para === true && sea.aloft.wet === false && sea.aloft.y > 40,
    'after 2s: ' + JSON.stringify(sea.aloft));
  check('parachute: but coming all the way down onto it still is',
    sea.down && sea.down.para === false && sea.down.wet === true,
    'at the end: ' + JSON.stringify(sea.down));
  check('parachute: and it never claimed feet dry over open water',
    !(sea.msgs || []).some(function (m) { return m.indexOf('Feet dry') >= 0; }),
    JSON.stringify((sea.msgs || []).slice(-3)));

  // Drowning is not a death here — hud.fade washes you ashore, and it fades on
  // a real setTimeout, so only wall time gets to the other side of it.
  var washed = true;
  try {
    await page.waitForFunction(function () { return !GAME.player.drowning; }, null, { timeout: 10000 });
  } catch (e) { washed = false; }
  var ashore = await page.evaluate(function () {
    var P = GAME.player;
    GAME.test.fastForward(0.5);
    return { dry: !GAME.city.isInWater(P.pos.x, P.pos.z, P.pos.y), msgs: window.__msgs.slice(),
             state: P.state };
  });
  check('parachute: and the sea does put you on the beach, soaked (anchor sanity)',
    washed && ashore.dry === true && ashore.state === 'alive' &&
    ashore.msgs.some(function (m) { return m.indexOf('soaked') >= 0; }),
    'dry=' + ashore.dry + ' state=' + ashore.state + ' msgs=' + JSON.stringify(ashore.msgs.slice(-2)));

  // ---------- 3c: each star costs more than the last ----------
  // The ladder used to be one body per star: kill_ped is 70 heat against a
  // first threshold of 50, and the gaps grew by twenty a level while every
  // offence was worth 22% MORE per star already held. Five pedestrians was a
  // five-star manhunt and one you never meant to hit was already a star.
  //
  // Counted, not sampled: reportCrime is driven directly with a witness stood
  // next to it, so this is the ladder itself rather than whatever the traffic
  // happened to be doing.
  var ladder = await page.evaluate(function () {
    var P = GAME.player, r = {};
    GAME.police.clearWanted();
    if (P.inCar) GAME.exitCar();
    P.health = 100;
    GAME.test.teleport(-60, 40);
    GAME.test.fastForward(0.5);
    GAME.godMode = true;                       // 20 crimes' worth of response
    var witness = GAME.test.spawnPed(3, 0);    // somebody has to see it
    r.witness = !!witness && !witness.dead;
    r.start = GAME.police.wanted;

    // one body, from clean
    GAME.police.reportCrime('kill_ped', P.pos);
    r.afterOne = GAME.police.wanted;
    r.heatAfterOne = Math.round(GAME.police.heat);

    // then count what each rung actually costs
    GAME.police.clearWanted();
    var costs = [], n = 0, at = 0;
    for (var i = 0; i < 200 && costs.length < 5; i++) {
      GAME.police.reportCrime('kill_ped', P.pos);
      n++;
      var s = GAME.police.wanted;
      if (s > at) { costs.push(n); n = 0; at = s; }
    }
    r.costs = costs;
    r.total = costs.reduce(function (a, b) { return a + b; }, 0);
    r.reached = at;

    // and the law: one officer down should be serious at once without being
    // most of the way to a manhunt
    GAME.police.clearWanted();
    GAME.police.reportCrime('kill_cop', P.pos);
    r.oneCop = GAME.police.wanted;

    GAME.police.clearWanted();
    GAME.godMode = false;
    P.health = 100;
    GAME.test.fastForward(0.5);
    r.clean = GAME.police.wanted;
    return r;
  });
  check('wanted: somebody is there to see it, from a standing start (anchor sanity)',
    ladder.witness === true && ladder.start === 0,
    'witness=' + ladder.witness + ' start=' + ladder.start);
  check('wanted: one body you did not mean to hit is heat, not a star',
    ladder.afterOne === 0 && ladder.heatAfterOne > 0,
    'stars=' + ladder.afterOne + ' heat=' + ladder.heatAfterOne);
  check('wanted: and every rung costs more than the one below it',
    ladder.costs.length === 5 &&
    ladder.costs.every(function (c, i) { return i === 0 || c > ladder.costs[i - 1]; }),
    'offences per star=' + JSON.stringify(ladder.costs));
  check('wanted: five stars is a manhunt you have to earn',
    ladder.reached === 5 && ladder.total >= 18,
    'reached=' + ladder.reached + ' after ' + ladder.total + ' offences');
  check('wanted: killing an officer is serious at once, but not a manhunt',
    ladder.oneCop === 2, 'stars=' + ladder.oneCop);
  check('wanted: and the group hands the world back clean (anchor sanity)',
    ladder.clean === 0, 'stars=' + ladder.clean);

  // ---------- 3d: a police round goes where it was drawn ----------
  // npcShoot drew a tracer along a scattered yaw and then decided the hit with
  // a Math.random() < accuracy roll taken beside it. So the round you watched
  // fly wide still hurt you, the one drawn straight through you might not, and
  // because the roll was a flat constant the hit rate was the same at five
  // metres as at forty, standing still or at a sprint. Nothing the player did
  // changed it.
  var aim = await page.evaluate(function () {
    var P = GAME.player, r = {};
    GAME.police.clearWanted();
    if (P.inCar) GAME.exitCar();
    P.health = 100;
    GAME.test.teleport(-60, 120);
    GAME.test.fastForward(0.5);
    GAME.godMode = true;          // two thousand rounds, and a live player

    // Record where each round was DRAWN and whether it hurt. Audio and the
    // tracer geometry are stubbed for the duration: this measures ballistics,
    // and two thousand real gunshots would be measuring the allocator.
    var ends = [], gun0 = GAME.audio.gunshot, tr0 = GAME.fx.tracer;
    GAME.audio.gunshot = function () { };
    GAME.fx.tracer = function (x1, y1, z1, x2, y2, z2) { ends.push([x2, z2]); };
    // A hit is a round that HURT, watched at the door where the hurting
    // happens — not npcShoot's return value. The version this replaces
    // returned true whatever it did, so measuring the return would have made
    // every check below pass on the very code they exist to catch. godMode
    // stops the damage landing; it does not stop the call.
    var hurt = false, dmg0 = GAME.playerDamage;
    GAME.playerDamage = function () { hurt = true; return dmg0.apply(null, arguments); };

    // one officer, with their personal steadiness pinned, so the comparisons
    // below are about range and speed rather than about who is holding the gun
    function volley(dist, speed, n) {
      var shooter = { aimSkill: 1 };
      var hits = 0, worstHit = 0, bestMiss = 1e9;
      P.moveSpeed = speed;
      GAME.combat.npcShoot(P.pos.x + dist, 1.35, P.pos.z, 0.42, 5, shooter);  // settle them
      ends.length = 0;
      for (var i = 0; i < n; i++) {
        hurt = false;
        GAME.combat.npcShoot(P.pos.x + dist, 1.35, P.pos.z, 0.42, 5, shooter);
        var hit = hurt;
        if (hit) hits++;
        var e = ends[ends.length - 1];
        // The tracer ends at the player's own range, so how far its end lands
        // from the player IS how far the round passed them by.
        //
        // Assert the ORDER rather than a threshold: the worst round that hurt
        // must have passed closer than the best round that did not. That is
        // the whole property — the outcome follows the geometry — and it needs
        // no tolerance, where comparing against a fixed half-width did. (It
        // also does not hard-code the target's width, so a retune of that is
        // not a broken check.)
        var by = Math.sqrt(U.dist2(e[0], e[1], P.pos.x, P.pos.z));
        if (hit) worstHit = Math.max(worstHit, by);
        else bestMiss = Math.min(bestMiss, by);
      }
      return { rate: hits / n, worstHit: worstHit, bestMiss: bestMiss, n: n };
    }
    var N = 600;
    r.near = volley(6, 0, N);
    r.far = volley(34, 0, N);
    r.still = volley(12, 0, N);
    r.running = volley(12, 8, N);
    var volleys = [r.near, r.far, r.still, r.running];
    r.ordered = volleys.every(function (v) { return v.worstHit <= v.bestMiss; });
    r.worst = volleys.map(function (v) {
      return v.worstHit.toFixed(2) + '/' + (v.bestMiss === 1e9 ? '-' : v.bestMiss.toFixed(2));
    });
    r.shots = N * 4;

    // and officers are individuals rather than four copies of one machine
    var skills = {};
    for (var k = 0; k < 60; k++) {
      var fresh = {};
      GAME.combat.npcShoot(P.pos.x + 10, 1.35, P.pos.z, 0.42, 5, fresh);
      skills[Math.round(fresh.aimSkill * 100)] = 1;
    }
    r.distinctSkills = Object.keys(skills).length;

    GAME.audio.gunshot = gun0; GAME.fx.tracer = tr0; GAME.playerDamage = dmg0;
    GAME.godMode = false;
    P.moveSpeed = 0; P.health = 100;
    GAME.police.clearWanted();
    GAME.test.fastForward(0.5);
    r.alive = P.state === 'alive';
    return r;
  });
  check('police: they can still hit you at close range (anchor sanity)',
    aim.near.rate > 0.5, 'close range hit rate=' + aim.near.rate.toFixed(2));
  check('police: both outcomes actually occur in every volley (anchor sanity)',
    aim.near.rate > 0 && aim.near.rate < 1 && aim.far.rate > 0 && aim.far.rate < 1,
    'rates=' + [aim.near, aim.far, aim.still, aim.running].map(function (v) {
      return v.rate.toFixed(2); }).join('/'));
  check('police: every round that hurt you passed closer than every one that did not',
    aim.ordered === true,
    'worst hit / best miss, per volley: ' + JSON.stringify(aim.worst) + ' over ' + aim.shots + ' rounds');
  check('police: range is worth something — a pistol at 34 m is not one at 6 m',
    aim.near.rate > aim.far.rate + 0.25,
    '6m=' + aim.near.rate.toFixed(2) + ' 34m=' + aim.far.rate.toFixed(2));
  check('police: and so is not standing still while they shoot at you',
    aim.still.rate > aim.running.rate + 0.05,
    'still=' + aim.still.rate.toFixed(2) + ' running=' + aim.running.rate.toFixed(2));
  check('police: officers are individuals, not four copies of one machine',
    aim.distinctSkills > 20, 'distinct steadiness over 60 officers=' + aim.distinctSkills);
  check('police: and the group leaves the player alive and clean (anchor sanity)',
    aim.alive === true);

  // ---------- 3e: the hill climb follows the hill road ----------
  // The climb's route was five hand-written points snapped with
  // nearestRoadPoint, and snapping cannot tell you it picked the wrong road.
  // The start landed on a PORT road at sea level three hundred metres from the
  // hill; the second checkpoint missed its mark by forty metres and landed on
  // the COAST RING. The route it described was port, up to a hill connector,
  // back down to the shore, then up — and the gates were far enough apart that
  // the hillside between them was a shorter drive than the switchback.
  //
  // Pure geometry: this reads the route, touches nothing, and leaves nothing
  // behind, so it can sit anywhere in the file.
  var climb = await page.evaluate(function () {
    var I = GAME.city.isla;
    var defs = GAME.missions.DEFS;
    function defOf(id) {
      for (var i = 0; i < defs.length; i++) if (defs[i].id === id) return defs[i];
      return null;
    }
    var d = defOf('race3');
    if (!I || !d || !d.cps || !d.start) return { ready: false, isla: !!I, def: !!d };
    var seq = [[d.start.x, d.start.z]].concat(d.cps);

    function offRoad(x, z) {
      var rp = GAME.city.nearestRoadPoint(x, z);
      return { d: Math.sqrt(U.dist2(x, z, rp.x, rp.z)), kind: rp.kind };
    }
    // how far the straight line between two gates strays from ANY road: the
    // shortcut the report was about, measured rather than eyeballed
    function stray(a, b) {
      var n = Math.max(8, Math.round(Math.sqrt(U.dist2(a[0], a[1], b[0], b[1])) / 6)), worst = 0;
      for (var k = 1; k < n; k++) {
        var t = k / n;
        worst = Math.max(worst, offRoad(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t).d);
      }
      return worst;
    }
    var kinds = {}, worstOff = 0, ys = [], strays = [];
    for (var j = 0; j < seq.length; j++) {
      var o = offRoad(seq[j][0], seq[j][1]);
      kinds[o.kind || '(mainland)'] = 1;
      worstOff = Math.max(worstOff, o.d);
      ys.push(GAME.city.groundY(seq[j][0], seq[j][1]));
      if (j) strays.push(stray(seq[j - 1], seq[j]));
    }
    // and the island's other race: a lap of the coastal ring, which had the
    // same shortcut for the same reason — gates laid out around the compass
    // rather than along the road
    var m = defOf('race4'), lap = null;
    if (m && m.cps && m.start) {
      var mseq = [[m.start.x, m.start.z]].concat(m.cps);
      var mkinds = {}, mstray = [], mworstOff = 0, len = 0;
      for (var q = 0; q < mseq.length; q++) {
        var mo = offRoad(mseq[q][0], mseq[q][1]);
        mkinds[mo.kind || '(mainland)'] = 1;
        mworstOff = Math.max(mworstOff, mo.d);
        if (q) {
          mstray.push(stray(mseq[q - 1], mseq[q]));
          len += Math.sqrt(U.dist2(mseq[q - 1][0], mseq[q - 1][1], mseq[q][0], mseq[q][1]));
        }
      }
      lap = { gates: m.cps.length, kinds: Object.keys(mkinds), worstOff: +mworstOff.toFixed(1),
              worstStray: +Math.max.apply(null, mstray).toFixed(1), len: Math.round(len),
              closes: Math.round(Math.sqrt(U.dist2(m.start.x, m.start.z,
                m.cps[m.cps.length - 1][0], m.cps[m.cps.length - 1][1]))) };
    }
    return { ready: true, gates: d.cps.length, kinds: Object.keys(kinds),
             worstOff: +worstOff.toFixed(1), worstStray: +Math.max.apply(null, strays).toFixed(1),
             rise: +(ys[ys.length - 1] - ys[0]).toFixed(1),
             drops: ys.filter(function (y, k) { return k > 0 && y < ys[k - 1] - 0.5; }).length,
             legs: (I.climb || []).length, lap: lap };
  });
  check('climb: the island registered and the race has a route (anchor sanity)',
    climb.ready === true && climb.gates >= 5 && climb.legs === 5,
    'gates=' + climb.gates + ' switchback legs=' + climb.legs);
  if (climb.ready) {
    check('climb: every gate is on the hill road, not the port or the coast ring',
      climb.kinds.length === 1 && climb.kinds[0] === 'hill',
      'roads used=' + JSON.stringify(climb.kinds));
    check('climb: and on it, rather than near it',
      climb.worstOff < 3, 'furthest gate from a road centreline=' + climb.worstOff + 'm');
    check('climb: it climbs, without doubling back down the hill on the way',
      climb.rise > 15 && climb.drops === 0,
      'rise=' + climb.rise + 'm  descents between gates=' + climb.drops);
    // The road is 11 m wide. Under about that, the straight line between two
    // gates IS the road and there is no shortcut to take; the route this
    // replaces strayed 65 m off it.
    check('climb: the line between gates stays on the tarmac, so there is nothing to cut',
      climb.worstStray < 12, 'furthest a straight line between gates strays=' + climb.worstStray + 'm');

    // The ring race, which had the same hole. Its road is 14 m wide against
    // the hill's 11, so it gets the wider allowance — the test is the same
    // one either way: does the straight line between two gates leave the road.
    var lap = climb.lap;
    check('mirador: the ring lap is a lap, on the ring road (anchor sanity)',
      !!lap && lap.kinds.length === 1 && lap.kinds[0] === 'ring' &&
      lap.len > 1800 && lap.closes < 5,
      lap ? lap.gates + ' gates over ' + lap.len + 'm, roads=' + JSON.stringify(lap.kinds) +
            ', finishes ' + lap.closes + 'm from the start' : 'no route');
    check('mirador: and its gates are close enough that cutting the corner saves nothing',
      !!lap && lap.worstStray < 14,
      lap ? 'furthest a straight line between gates strays=' + lap.worstStray + 'm' : 'no route');
  }

  // Geometry says the route is sane; only driving it says it is drivable. The
  // rivals path along the road between gates, so where they have got to after
  // a dozen seconds is the road's own report on itself.
  var drive = await page.evaluate(function () {
    var P = GAME.player, r = {};
    r.wasOpen = GAME.isla.isOpen();
    GAME.police.clearWanted();
    if (P.inCar) GAME.exitCar();
    P.health = 100;
    GAME.isla.setOpen(true);
    var d = null, defs = GAME.missions.DEFS;
    for (var i = 0; i < defs.length; i++) if (defs[i].id === 'race3') d = defs[i];
    if (!d || !d.start) return r;
    r.footY = GAME.city.groundY(d.start.x, d.start.z);
    GAME.test.teleport(d.start.x, d.start.z);
    GAME.test.fastForward(0.5);
    var mine = GAME.test.spawnCar('sports', 4, 0);
    GAME.test.fastForward(0.3);
    GAME.test.enterNearestCar(mine);
    GAME.test.fastForward(2);
    var a = GAME.missions.active;
    r.started = !!(a && a.def && a.def.id === 'race3');
    // Wait on PROGRESS rather than on a stopwatch. How far a field gets in a
    // fixed twelve seconds depends on the countdown, on how they get off the
    // line and on what traffic is in the way — measured against a clock this
    // passed most runs and failed some, which says nothing about the road.
    // Give them until they are three gates up, or thirty seconds to prove they
    // cannot be.
    function field() { return GAME.world.cars.filter(function (c) { return c.mission && !c.dead; }); }
    function best(list, f) { return list.reduce(function (m, c) { return Math.max(m, f(c)); }, 0); }
    var secs = 0;
    while (secs < 30 && best(field(), function (c) { return c.cpIndex || 0; }) < 3) {
      GAME.test.fastForward(1);
      secs++;
    }
    var rivals = field();
    r.rivals = rivals.length;
    r.secs = secs;
    r.bestCp = best(rivals, function (c) { return c.cpIndex || 0; });
    r.highest = best(rivals, function (c) { return c.pos.y; });

    // Teardown, and thoroughly: this group runs before the race checks below,
    // and calling the race off is not enough on its own — the trigger is
    // proximity, so sitting on the start line restarts it on the next tick.
    GAME.missions.failActive('test teardown');
    GAME.exitCar();
    if (mine) GAME.vehicles.removeCar(mine);
    GAME.test.teleport(-60, 40);
    GAME.isla.setOpen(r.wasOpen);
    GAME.police.clearWanted();
    P.health = 100;
    GAME.test.fastForward(1);
    r.clean = !GAME.missions.active && !GAME.player.inCar;
    return r;
  });
  check('climb: the race starts at the foot of the switchback (anchor sanity)',
    drive.started === true && drive.rivals === 3 && drive.footY < 8,
    'started=' + drive.started + ' rivals=' + drive.rivals + ' foot at ' + drive.footY + 'm');
  check('climb: and a field can actually drive it up the hill',
    drive.bestCp >= 3 && drive.highest > drive.footY + 3,
    'three gates up in ' + drive.secs + 's, highest rival=' +
    (drive.highest || 0).toFixed(1) + 'm against a foot at ' + (drive.footY || 0).toFixed(1) + 'm');
  check('climb: and the group hands the world back clean (anchor sanity)',
    drive.clean === true);

  // ---------- 3f: a parked airframe is something you stop against ----------
  // Aircraft were skipped outright in the car-to-car pass, so a helicopter
  // setting down would not bulldoze the street it landed on. The cost was that
  // ground traffic drove straight THROUGH one — and the Alta Verde summit road
  // ends at a helipad with a helicopter standing on it, so cars went in one
  // side and out the other all afternoon.
  var pad = await page.evaluate(function () {
    var P = GAME.player, K = GAME.input.keys, H = GAME.city.helipad, r = {};
    r.wasOpen = GAME.isla.isOpen();
    GAME.police.clearWanted();
    if (P.inCar) GAME.exitCar();
    P.health = 100;
    GAME.isla.setOpen(true);
    GAME.godMode = true;
    GAME.test.teleport(H.x - 45, H.z - 45);
    GAME.test.fastForward(5);                 // let the pad's parked spot fill
    var heli = GAME.world.cars.filter(function (c) {
      return c.spec.heli && c.ai && c.ai.mode === 'parked';
    })[0];
    r.parked = !!heli;
    if (!heli) return r;
    var heliHome = [heli.pos.x, heli.pos.z];

    var van = GAME.test.spawnCar('van', 4, 0);
    GAME.test.fastForward(0.3);
    GAME.test.enterNearestCar(van);
    GAME.test.fastForward(1.2);
    r.driving = !!P.inCar;
    if (!P.inCar) return r;
    var car = P.car;

    // line it up thirty metres out, pointing straight at the airframe
    function run(heliY) {
      heli.pos.y = heliY;
      car.pos.set(heli.pos.x - 30, GAME.city.groundY(heli.pos.x - 30, heli.pos.z), heli.pos.z);
      car.heading = Math.atan2(heli.pos.x - car.pos.x, heli.pos.z - car.pos.z);
      car.speed = 0; car.lat = 0; car.hp = car.spec.hp; car.stage = 0; car.stageWarn = 0;
      var closest = 1e9, inside = 0, passed = false;
      K['KeyW'] = true;
      for (var i = 0; i < 60 * 7; i++) {
        // pinned every frame: an unpowered airframe FALLS — the aircraft
        // branch drops any that nobody is flying — so a helicopter set ten
        // metres up was back on the pad long before the van reached it, and
        // the overhead case was really the on-the-ground case again
        heli.pos.y = heliY; heli.vy = 0;
        GAME.test.fastForward(1 / 60);
        var d = Math.sqrt(U.dist2(car.pos.x, car.pos.z, heli.pos.x, heli.pos.z));
        closest = Math.min(closest, d);
        if (d < heli.radius + car.radius - 0.3) inside++;
        if (car.pos.x > heli.pos.x + 2) passed = true;    // out the far side
      }
      K['KeyW'] = false;
      return { closest: +closest.toFixed(1), inside: inside, passed: passed };
    }

    var groundY = GAME.city.groundY(heliHome[0], heliHome[1]);
    r.radii = +(heli.radius + car.radius).toFixed(1);
    r.intoIt = run(groundY + 0.05);
    r.heliShifted = +Math.sqrt(U.dist2(heli.pos.x, heli.pos.z, heliHome[0], heliHome[1])).toFixed(1);
    // and one hovering overhead is not a roadblock — the height rule that let
    // the blanket skip be removed at all
    r.underIt = run(groundY + 10);
    heli.pos.y = groundY + 0.05;

    GAME.exitCar();
    if (van) GAME.vehicles.removeCar(van);
    GAME.godMode = false;
    GAME.isla.setOpen(r.wasOpen);
    GAME.test.teleport(-60, 40);
    GAME.police.clearWanted();
    P.health = 100;
    GAME.test.fastForward(1);
    r.clean = !GAME.player.inCar;
    return r;
  });
  check('helipad: a helicopter is parked on the pad and a van is driving at it (anchor sanity)',
    pad.parked === true && pad.driving === true && pad.radii > 3,
    'parked=' + pad.parked + ' driving=' + pad.driving + ' radii sum=' + pad.radii + 'm');
  if (pad.parked && pad.driving) {
    check('helipad: driving into it stops you, rather than taking you through it',
      pad.intoIt.inside === 0 && pad.intoIt.passed === false &&
      pad.intoIt.closest >= pad.radii - 0.4,
      'closest=' + pad.intoIt.closest + 'm against ' + pad.radii +
      'm of radii, frames inside=' + pad.intoIt.inside + ', came out the far side=' + pad.intoIt.passed);
    check('helipad: and the airframe is not shoved by it — it never was, and still is not',
      pad.heliShifted < 0.5, 'the helicopter moved ' + pad.heliShifted + 'm');
    check('helipad: while one hovering overhead is not a roadblock',
      pad.underIt.passed === true,
      'drove under it=' + pad.underIt.passed + ' closest=' + pad.underIt.closest + 'm');
    check('helipad: and the group hands the world back clean (anchor sanity)', pad.clean === true);
  }

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
    var wanted = GAME.police.wanted;
    GAME.audio.siren = s0;
    // Call off the manhunt. Left running it followed the player into the
    // groups below, and cops shooting the subject of a measurement is how the
    // roof height drifted and the damage check found a corpse.
    GAME.police.clearWanted();
    GAME.player.health = 100;
    GAME.test.fastForward(1);
    return { seen: seen, wanted: wanted };
  });
  check('stereo: a chasing cruiser gives the siren its position',
    !!siren.seen && isFinite(siren.seen.x) && isFinite(siren.seen.z),
    'wanted=' + siren.wanted + ' got=' + JSON.stringify(siren.seen));

  // ---------- 6: a rider follows the deck when it tilts ----------
  // vehicles.js pitches a chassis over a ramp (negative rotation.x lifts the
  // nose), but the roof a rider stood on was a flat plane at car.pos.y — so
  // standing over the nose of a climbing truck left them hanging in the air.
  // Ride it with the pitch ramped on gradually, the way a ramp delivers it.
  var deck = await page.evaluate(function () {
    var P = GAME.player;
    GAME.test.teleport(350, 300);
    GAME.test.fastForward(0.5);
    var car = GAME.test.spawnCar('van', 7, 0);
    if (!car) return { spawned: false };
    GAME.test.fastForward(0.3);
    var NOSE = 2.0;                       // out along the body's +z, past the cab
    // Pin the van square and the rider over the nose every frame. Left free
    // they both drift a little, and the height being measured depends on
    // exactly where along the deck the rider ends up — which made this read
    // anywhere from 1.29 to 1.50 run to run.
    function hold() {
      car.ai = null;
      car.controls = { throttle: 0, steer: 0, handbrake: true };
      car.heading = 0;                    // so +NOSE along z IS +NOSE along the body
      P.pos.x = car.pos.x; P.pos.z = car.pos.z + NOSE;
    }
    hold();
    P.pos.set(car.pos.x, car.pos.y + 4, car.pos.z + NOSE);
    P.velY = 0;
    for (var i = 0; i < 60; i++) { hold(); car.mesh.rotation.x = 0; GAME.test.fastForward(1 / 60); }
    var level = P.pos.y - car.pos.y, riding = P.roofCar === car;
    // now lift the nose, a frame at a time
    var PITCH = 0.35;
    for (var j = 0; j < 40; j++) { hold(); car.mesh.rotation.x = -PITCH * (j + 1) / 40; GAME.test.fastForward(1 / 60); }
    var noseUp = P.pos.y - car.pos.y, stillRiding = P.roofCar === car;
    // what the geometry says it must be, derived here with plain trig rather
    // than by asking the code under test what it thinks
    var expect = level * Math.cos(PITCH) + NOSE * Math.sin(PITCH);
    return { spawned: true, riding: riding, stillRiding: stillRiding, level: level, noseUp: noseUp,
             lift: noseUp - level, expect: expect };
  });
  check('roof: a van spawned and the player is riding it (anchor sanity)',
    deck.spawned && deck.riding, 'spawned=' + deck.spawned + ' riding=' + deck.riding);
  check('roof: still aboard after the nose comes up', deck.stillRiding === true);
  check('roof: standing over a lifted nose rides up by exactly the geometry',
    deck.lift > 0.35 && Math.abs(deck.noseUp - deck.expect) < 0.05,
    'level=' + (deck.level || 0).toFixed(3) + ' noseUp=' + (deck.noseUp || 0).toFixed(3) +
    ' expected=' + (deck.expect || 0).toFixed(3) + ' lift=' + (deck.lift || 0).toFixed(3));

  // ---------- nothing broke on the way through ----------
  await page.evaluate(function () { GAME.test.fastForward(5); });
  check('clean: zero page errors', pageErrors.length === 0, pageErrors[0]);
  check('clean: zero console.error', consoleErrors.length === 0, consoleErrors[0]);

  // ---------- 7: haptics ----------
  var hap = await page.evaluate(function () {
    window.__buzz = [];
    window.__realVibrate = navigator.vibrate;
    navigator.vibrate = function (ms) { window.__buzz.push(ms); return true; };
    var r = {};
    r.available = GAME.haptics.available;
    // rationed: a second buzz of the same size inside the window is dropped,
    // a harder one gets through — the rule audio.js uses for a pile-up
    window.__buzz.length = 0;
    r.first = GAME.haptics.testBuzz(20);
    r.repeat = GAME.haptics.testBuzz(20);
    r.harder = GAME.haptics.testBuzz(50);
    r.sent = window.__buzz.slice();
    // never longer than the cap, however hard the knock
    window.__buzz.length = 0;
    GAME.haptics.testBuzz(9999);
    r.capped = window.__buzz.slice();
    GAME.haptics.testReset();
    window.__buzz.length = 0;
    GAME.haptics.knock(99);
    r.knockCapped = window.__buzz.slice();
    // off means off
    GAME.haptics.setOn(false);
    window.__buzz.length = 0;
    GAME.haptics.testBuzz(60);
    r.whileOff = window.__buzz.slice();
    GAME.haptics.setOn(true);
    // and a browser with no motor at all must not throw
    navigator.vibrate = undefined;
    r.unavailable = GAME.haptics.available;
    var threw = false;
    try { GAME.haptics.knock(1); GAME.haptics.hurt(); GAME.haptics.shot(); } catch (e) { threw = true; }
    r.threwWithoutApi = threw;
    navigator.vibrate = function (ms) { window.__buzz.push(ms); return true; };
    return r;
  });
  check('haptics: the recorder is installed and the API reads available (anchor sanity)', hap.available === true);
  check('haptics: a knock buzzes once and a repeat inside the window is dropped',
    hap.first === true && hap.repeat === false, 'first=' + hap.first + ' repeat=' + hap.repeat);
  check('haptics: a harder knock preempts inside the window',
    hap.harder === true && hap.sent.length === 2, 'sent=' + JSON.stringify(hap.sent));
  check('haptics: nothing outruns the pulse cap', hap.capped.length === 1 && hap.capped[0] <= 120,
    'sent=' + JSON.stringify(hap.capped));
  check('haptics: and the shake channel keeps its own, tighter ceiling',
    hap.knockCapped.length === 1 && hap.knockCapped[0] <= 60,
    'sent=' + JSON.stringify(hap.knockCapped));
  check('haptics: switched off sends nothing', hap.whileOff.length === 0, 'sent=' + JSON.stringify(hap.whileOff));
  check('haptics: a browser with no vibrate reports unavailable and does not throw',
    hap.unavailable === false && hap.threwWithoutApi === false);

  // End to end through the game's own channels rather than the module's door.
  // The window is shared across kinds on purpose — a crash that also hurts you
  // is one event, not two — so clear it first. Settling the player can knock
  // them about, and a buzz during that would arm the throttle invisibly and
  // make this a test of the throttle instead of the hook.
  var dmg = await page.evaluate(function () {
    GAME.player.health = 100;
    GAME.test.teleport(350, 300);
    GAME.test.fastForward(0.5);
    GAME.player.health = 100;   // whatever settling cost, this check is not about that
    window.__buzz.length = 0;
    GAME.haptics.testReset();
    var before = { state: GAME.player.state, health: Math.round(GAME.player.health), armor: Math.round(GAME.player.armor) };
    GAME.playerDamage(8, 'test');        // -> hud.damageFlash() -> haptics.hurt()
    return { sent: window.__buzz.slice(), before: before };
  });
  check('haptics: the player is alive to be hurt (anchor sanity)',
    dmg.before.state === 'alive', JSON.stringify(dmg.before));
  check('haptics: taking damage buzzes through the flash it already shows',
    dmg.sent.length === 1, 'sent=' + JSON.stringify(dmg.sent) + ' before=' + JSON.stringify(dmg.before));

  // The shake hook must fire on the RISE, not for every frame the shake is
  // still ringing. Throttling alone would hide the difference, so this runs
  // over real wall time: buzzing per frame would slip one through every window
  // and land several, while reading the rise lands exactly one.
  //
  // It waits on FRAMES rather than on a stopwatch. Headless Chromium schedules
  // rAF off a compositor that is not drawing anything, so the callbacks are
  // sparse and uneven — a fixed 700 ms landed four of them on one run and none
  // on the next, and a window with no frames in it reports zero buzzes and
  // reads exactly like the hook being broken.
  await page.evaluate(function () {
    GAME.player.health = 100;
    // This window runs on the wall clock with the world live around a player
    // standing in the street. Traffic clipping them lands a hurt() buzz on top
    // of the knock being measured, which is a second buzz from a second cause
    // and read here as the shake hook firing twice. Seen once in a dozen runs;
    // godMode closes the door rather than leaving it to the traffic.
    GAME.godMode = true;
    GAME.test.fastForward(1);
    window.__buzz.length = 0;
    GAME.haptics.testReset();
    window.__frames = 0;
    (function count() { window.__frames++; requestAnimationFrame(count); })();
    GAME.cameraShake = 0.9;
  });
  // enough frames for a per-frame hook to slip several past the 90 ms window
  await page.waitForFunction(function () { return window.__frames >= 8; }, null, { timeout: 20000 });
  var shake = await page.evaluate(function () {
    GAME.godMode = false;
    return { sent: window.__buzz.slice(), left: GAME.cameraShake, frames: window.__frames };
  });
  check('haptics: a knock buzzes once, not once per frame it rings for',
    shake.sent.length === 1,
    'sent=' + JSON.stringify(shake.sent) + ' shakeLeft=' + shake.left + ' frames=' + shake.frames);
  // Both halves matter. Below 0.9 proves the camera update actually ran, so a
  // window that drew nothing cannot pass this by holding the value it was
  // handed; above 0.01 proves the shake was still ringing the whole time, so
  // "buzzed once" is not just "the shake ended before it could buzz twice".
  check('haptics: the shake ran down but was still ringing throughout (anchor sanity)',
    shake.left < 0.9 && shake.left > 0.01, 'left=' + shake.left + ' frames=' + shake.frames);
  // ---- the vocabulary itself ----
  // Length alone cannot say anything specific, so the value of the whole
  // channel rests on the patterns being distinguishable from one another.
  // Assert that directly rather than trusting the table to stay tidy.
  //
  // Every one of these reaches for a method by name, so a build without them
  // would throw inside the page and take the runner down with it rather than
  // report anything. A missing method is a finding, not a crash: name it and
  // let the check below fail on it.
  await page.evaluate(function () {
    window.__missing = [];
    window.__hap = function (name, arg) {
      var f = GAME.haptics[name];
      if (typeof f !== 'function') { window.__missing.push(name); return false; }
      return f.call(GAME.haptics, arg);
    };
  });
  var vocab = await page.evaluate(function () {
    var H = GAME.haptics, out = {}, seen = {};
    var kinds = ['uiTap', 'pickup', 'hit', 'shot', 'checkpoint', 'deny', 'hurt', 'chuteLand',
                 'chuteOpen', 'demo', 'win', 'stunt', 'wantedClear', 'smoking', 'onFire',
                 'wasted', 'busted'];
    var dupes = [];
    for (var i = 0; i < kinds.length; i++) {
      H.testReset();
      window.__buzz.length = 0;
      window.__hap(kinds[i]);
      out[kinds[i]] = { sent: window.__buzz.slice() };
      var key = JSON.stringify(window.__buzz);
      if (seen[key]) dupes.push(seen[key] + '=' + kinds[i] + ' ' + key);
      seen[key] = kinds[i];
    }
    // the star count is spoken in taps, so the shapes have to differ by level
    var stars = [];
    for (var n = 1; n <= 5; n++) {
      H.testReset(); window.__buzz.length = 0;
      window.__hap('wantedUp', n);
      stars.push(JSON.stringify(window.__buzz[0]));
    }
    return { out: out, dupes: dupes, stars: stars, missing: window.__missing.slice(),
             distinctStars: stars.filter(function (v, i) { return stars.indexOf(v) === i; }).length };
  });
  check('haptics: every kind exists and actually sends something (anchor sanity)',
    vocab.missing.length === 0 &&
    Object.keys(vocab.out).every(function (k) { return vocab.out[k].sent.length === 1; }),
    'missing=' + JSON.stringify(vocab.missing) + ' silent=' +
    JSON.stringify(Object.keys(vocab.out).filter(function (k) { return vocab.out[k].sent.length !== 1; })));
  check('haptics: no two kinds feel the same', vocab.dupes.length === 0, vocab.dupes.join(' | '));
  check('haptics: a pattern is a pattern, not a duration',
    Array.isArray(vocab.out.onFire.sent[0]) &&
    vocab.out.onFire.sent[0].length >= 3 && typeof vocab.out.pickup.sent[0] === 'number',
    'onFire=' + JSON.stringify(vocab.out.onFire.sent[0]) + ' pickup=' + JSON.stringify(vocab.out.pickup.sent[0]));
  check('haptics: the star count is spoken in taps, and five differs from one',
    vocab.distinctStars === 5, JSON.stringify(vocab.stars));

  // ---- who may interrupt whom ----
  var pri = await page.evaluate(function () {
    var H = GAME.haptics, r = {}, hap = window.__hap;
    window.__missing.length = 0;
    // a thumb on a button must never be able to talk over a crash
    H.testReset(); window.__buzz.length = 0;
    H.knock(0.9); r.tapAfterKnock = hap('uiTap'); r.afterTap = window.__buzz.slice();
    // and the alarm gets through whatever is already playing
    H.testReset(); window.__buzz.length = 0;
    H.knock(0.9); r.alarmAfterKnock = hap('onFire'); r.afterAlarm = window.__buzz.slice();
    // a long pattern is not cut short by a lighter one landing mid-play
    H.testReset(); window.__buzz.length = 0;
    hap('wasted'); r.tapAfterWasted = hap('uiTap'); r.winAfterWasted = hap('win');
    r.afterWasted = window.__buzz.slice();
    // and a connect outranks the trigger it arrived with
    H.testReset(); window.__buzz.length = 0;
    H.shot(); r.hitAfterShot = hap('hit'); r.afterHit = window.__buzz.slice();
    // switched off, none of it goes anywhere
    H.setOn(false);
    H.testReset(); window.__buzz.length = 0;
    hap('splat', 1); hap('wantedUp', 5); hap('onFire'); hap('wasted'); hap('busted'); hap('win');
    hap('uiTap'); hap('blast', 1); hap('chuteLand'); hap('demo');
    r.whileOff = window.__buzz.slice();
    H.setOn(true);
    return r;
  });
  check('haptics: a button tap cannot talk over a crash',
    pri.tapAfterKnock === false && pri.afterTap.length === 1,
    'sent=' + JSON.stringify(pri.afterTap));
  check('haptics: but the alarm gets through one',
    pri.alarmAfterKnock === true && pri.afterAlarm.length === 2,
    'sent=' + JSON.stringify(pri.afterAlarm));
  check('haptics: and nothing below it cuts a death short',
    pri.tapAfterWasted === false && pri.winAfterWasted === false && pri.afterWasted.length === 1,
    'sent=' + JSON.stringify(pri.afterWasted));
  check('haptics: a round connecting preempts the trigger it left with',
    pri.hitAfterShot === true && pri.afterHit.length === 2,
    'sent=' + JSON.stringify(pri.afterHit));
  check('haptics: RUMBLE off silences every one of them',
    pri.whileOff.length === 0, 'sent=' + JSON.stringify(pri.whileOff));

  // ---- and through the game, for the ones with a body behind them ----
  var world = await page.evaluate(function () {
    var P = GAME.player, r = {};
    GAME.police.clearWanted();
    P.health = 100;
    if (P.inCar) GAME.exitCar();
    GAME.test.teleport(356, 40);
    GAME.test.fastForward(0.5);
    var _ride = GAME.test.spawnCar('sedan', 4, 0);
    GAME.test.fastForward(0.3);
    GAME.test.enterNearestCar(_ride);
    GAME.test.fastForward(1);
    var car = P.car;
    r.driving = !!car;
    if (!car) return r;

    // Somebody under the wheels. Put them where the car is about to be and
    // give it real pace: under 4 m/s the run-over check does not even look.
    //
    // Already at five stars for this one, and it is not a dodge. Killing a
    // pedestrian is also a CRIME, and the star it earns outranks the body on
    // the bonnet — deliberately, since the more consequential news wins a
    // channel this narrow. Pinned at the ceiling the level cannot move, so
    // what is measured here is the run-over on its own. The masking is worth
    // knowing about too, so it gets a check of its own below.
    function runOver() {
      car.heading = 0; car.speed = 20; car.lat = 0;
      var ped = GAME.test.spawnPed(0, 0);
      ped.pos.set(car.pos.x, car.pos.y, car.pos.z + 2);
      // Somebody to see it, planted fresh each time and well clear of the
      // bonnet. The car travels four metres a run, so one witness left at the
      // start of a sequence walks out of civilian earshot partway through.
      GAME.test.spawnPed(8, -6);
      GAME.haptics.testReset(); window.__buzz.length = 0;
      GAME.test.fastForward(0.2);
      return { sent: window.__buzz.slice(), dead: !!ped.dead };
    }
    // godMode for the window: at five stars the cops shoot, and a hurt() buzz
    // landing on top would be a second buzz from a second cause
    GAME.godMode = true;
    GAME.police.setWanted(5);
    GAME.test.fastForward(0.3);
    var over = runOver();
    r.splat = over.sent; r.pedDead = over.dead;

    // And the same act from clean, where the star it earns takes the channel.
    // Two conditions before that star exists at all, and missing either would
    // have left this comparing one splat against another: reportCrime holds a
    // 1.2 s cooldown per crime type, and an unwitnessed one draws nothing —
    // so wait the cooldown out and leave somebody standing there to see it.
    GAME.police.clearWanted();
    GAME.test.fastForward(1.5);
    // Run them down until a star LIGHTS, and read the buzz off the one that
    // did it. Two is the ladder's price from nothing (see the wanted group),
    // but this cannot assume it starts from nothing: clearWanted only zeroes
    // the level, and the seconds either side of it are a live world — one
    // stray offence in there and the star arrives on the first body instead
    // of the second, which is how this passed three times locally and failed
    // in CI. Whichever body lights it is the one being measured.
    var was = GAME.test.getState().wanted, first = null, tries = 0;
    while (tries < 6 && !first) {
      var attempt = runOver();
      tries++;
      if (GAME.test.getState().wanted > was) first = attempt;
    }
    r.firstKill = first ? first.sent : [];
    r.firstDead = !!(first && first.dead);
    r.firstTries = tries;
    r.firstStars = GAME.test.getState().wanted;
    GAME.godMode = false;

    // The law changing gear, both ways.
    GAME.police.clearWanted();
    GAME.haptics.testReset(); window.__buzz.length = 0;
    GAME.police.setWanted(3);
    r.wantedUp = window.__buzz.slice();
    GAME.haptics.testReset(); window.__buzz.length = 0;
    GAME.police.clearWanted();
    r.wantedClear = window.__buzz.slice();

    // The ride catching fire — the one warning with a deadline on it.
    car.stage = 0; car.stageWarn = 0; car.hp = car.spec.hp;
    GAME.haptics.testReset(); window.__buzz.length = 0;
    GAME.vehicles.damageCar(car, car.spec.hp * 0.9, 'test');
    r.onFire = window.__buzz.slice();
    r.stage = car.stage;

    car.hp = car.spec.hp; car.stage = 0; car.stageWarn = 0;

    // The witnesses above only count if they land near the CAR, and that is
    // the hook's job: offsets are from where the player IS, and behind a wheel
    // that is the car. It read P.pos instead, which does not follow you into
    // one — so things landed near wherever the player last got OUT, and
    // whether a crime had a witness at all came down to how far they had
    // driven since. Taken here rather than on boarding, because that is the
    // only state where the two answers differ: fresh out of the door they are
    // the same point, and the check would pass on either.
    r.stale = Math.round(Math.sqrt(U.dist2(P.pos.x, P.pos.z, car.pos.x, car.pos.z)));
    var probePed = GAME.test.spawnPed(6, 0);
    var probeCar = GAME.test.spawnCar('sedan', -9, 0);
    r.pedFromCar = Math.round(Math.sqrt(U.dist2(probePed.pos.x, probePed.pos.z, car.pos.x, car.pos.z)));
    r.carFromCar = Math.round(Math.sqrt(U.dist2(probeCar.pos.x, probeCar.pos.z, car.pos.x, car.pos.z)));
    GAME.peds.removePed(probePed);
    GAME.vehicles.removeCar(probeCar);

    // tidy up behind: the groups below drive a car and read the star count
    GAME.exitCar();
    GAME.police.clearWanted();
    P.health = 100;
    GAME.test.fastForward(0.4);
    r.onFoot = !GAME.player.inCar;
    return r;
  });
  check('haptics: the player had driven away from where they got out (anchor sanity)',
    world.stale > 20, 'the car was ' + world.stale + 'm from P.pos');
  check('haptics: the spawn hooks place things by the car you are in, not the kerb you left',
    world.pedFromCar <= 8 && world.carFromCar <= 11,
    'ped ' + world.pedFromCar + 'm and car ' + world.carFromCar + 'm from the car');

  check('haptics: the player is driving and both bodies went under (anchor sanity)',
    world.driving === true && world.pedDead === true && world.firstDead === true,
    'driving=' + world.driving + ' dead=' + world.pedDead + '/' + world.firstDead);
  check('haptics: running someone over is felt, not silent',
    world.splat.length === 1 && Array.isArray(world.splat[0]) && world.splat[0].length === 3,
    'sent=' + JSON.stringify(world.splat));
  check('haptics: running them down does eventually draw a star (anchor sanity)',
    world.firstStars >= 1 && world.firstTries <= 6,
    'stars=' + world.firstStars + ' after ' + world.firstTries + ' bodies');
  check('haptics: and that star takes the channel from the body under the wheels',
    world.firstKill.length === 1 && JSON.stringify(world.firstKill) !== JSON.stringify(world.splat),
    'firstKill=' + JSON.stringify(world.firstKill) + ' splat=' + JSON.stringify(world.splat));
  check('haptics: a star going up buzzes, and going clear buzzes differently',
    world.wantedUp.length === 1 && world.wantedClear.length === 1 &&
    JSON.stringify(world.wantedUp) !== JSON.stringify(world.wantedClear),
    'up=' + JSON.stringify(world.wantedUp) + ' clear=' + JSON.stringify(world.wantedClear));
  check('haptics: the ride catching fire sounds the alarm (anchor sanity: it caught)',
    world.stage >= 2 && world.onFire.length === 1 && world.onFire[0].length === 5,
    'stage=' + world.stage + ' sent=' + JSON.stringify(world.onFire));
  check('haptics: and the group leaves the player on foot and clean (anchor sanity)',
    world.onFoot === true);

  // ---- the blast ----
  // explodeCar never touched cameraShake, so the knock channel could not see
  // it: everything a car going up beside you used to send was the generic
  // damage tick, and that only if the blast reached far enough to hurt.
  var blast = await page.evaluate(function () {
    var P = GAME.player, r = {};
    GAME.police.clearWanted();
    if (P.inCar) GAME.exitCar();
    P.health = 100; P.state = 'alive';
    GAME.test.teleport(356, 120);
    GAME.test.fastForward(0.5);
    GAME.godMode = true;             // the blast damages, and hurt() is a second cause
    var mine = [];

    // Blow up the car we SPAWNED. Searching for the nearest instead made this
    // a hostage of the traffic: an ordinary car happening to stop closer than
    // the one placed here silently swapped which range was being measured.
    function blow(dx) {
      var car = GAME.test.spawnCar('sedan', dx, 0);
      GAME.test.fastForward(0.2);
      if (!car) return { none: true };
      var best = U.dist2(car.pos.x, car.pos.z, P.pos.x, P.pos.z);
      mine.push(car);
      GAME.haptics.testReset(); window.__buzz.length = 0;
      GAME.vehicles.explodeCar(car, 'test');
      return { sent: window.__buzz.slice(), dist: Math.round(Math.sqrt(best)), dead: !!car.dead };
    }
    r.near = blow(5);
    GAME.test.fastForward(1);
    r.far = blow(22);
    // and one over the horizon must not reach the hand at all
    var far = GAME.vehicles.spawnCar('sedan', 356, -400, 0);
    mine.push(far);
    GAME.test.fastForward(0.2);
    GAME.haptics.testReset(); window.__buzz.length = 0;
    GAME.vehicles.explodeCar(far, 'test');
    r.offscreen = window.__buzz.slice();
    GAME.godMode = false;
    P.health = 100;
    // Clear the wrecks away. explodeCar blackens a car and leaves it standing
    // — the bubble collects it eventually, but "eventually" is three groups
    // later, and the showroom below counts cars and the race needs a field.
    for (var m = 0; m < mine.length; m++) GAME.vehicles.removeCar(mine[m]);
    GAME.test.fastForward(0.3);
    // Assert what this group CONTROLS. Counting the world's cars instead
    // failed one run in two: the spawn bubble is filling the street back in
    // over the same window, so the total can rise however tidy we were.
    r.left = mine.filter(function (c) { return GAME.world.cars.indexOf(c) !== -1; }).length;
    r.spawned = mine.length;
    return r;
  });
  check('haptics: two cars blew up at different ranges (anchor sanity)',
    blast.near.dead === true && blast.far.dead === true && blast.near.dist < blast.far.dist,
    'near=' + blast.near.dist + 'm far=' + blast.far.dist + 'm');
  check('haptics: a blast is felt, and it is not the generic damage tick',
    blast.near.sent.length === 1 && Array.isArray(blast.near.sent[0]) &&
    blast.near.sent[0][0] > 22,
    'sent=' + JSON.stringify(blast.near.sent));
  check('haptics: and it fades with range rather than being on or off',
    blast.far.sent.length === 1 && Array.isArray(blast.far.sent[0]) &&
    blast.far.sent[0][0] < blast.near.sent[0][0],
    'near=' + JSON.stringify(blast.near.sent[0]) + ' far=' + JSON.stringify(blast.far.sent[0]));
  check('haptics: a wreck across the map does not reach the hand',
    blast.offscreen.length === 0, 'sent=' + JSON.stringify(blast.offscreen));
  check('haptics: and every wreck it made is cleared behind it (anchor sanity)',
    blast.spawned === 3 && blast.left === 0,
    'spawned=' + blast.spawned + ' still in the world=' + blast.left);

  // ---- the canopy ----
  var chute = await page.evaluate(function () {
    var P = GAME.player, r = {};
    GAME.test.teleport(356, 160);
    GAME.test.fastForward(0.5);
    P.health = 100; P.state = 'alive';
    // Put them under a canopy three metres up and let it fly into the ground.
    // startParachute takes the position to open AT — called bare it runs
    // Vector3.set(undefined...), which Three assigns raw, and the whole glide
    // then happens at an undefined coordinate.
    var cy = GAME.city.surfaceY(P.pos.x, P.pos.z);
    GAME.haptics.testReset(); window.__buzz.length = 0;
    GAME.aircraft.startParachute(P.pos.x, cy + 3, P.pos.z, 0);
    r.openSent = window.__buzz.slice();
    r.opened = !!P.parachuting;
    r.openedAt = Math.round((P.pos.y - cy) * 10) / 10;
    GAME.haptics.testReset(); window.__buzz.length = 0;
    for (var i = 0; i < 90 && P.parachuting; i++) GAME.test.fastForward(1 / 60);
    r.landed = !P.parachuting;
    r.sent = window.__buzz.slice();
    GAME.test.fastForward(0.3);
    return r;
  });
  check('haptics: the canopy opened above the ground and came down (anchor sanity)',
    chute.opened === true && chute.landed === true && chute.openedAt > 1,
    'opened=' + chute.opened + ' at=' + chute.openedAt + 'm landed=' + chute.landed);
  check('haptics: the canopy filling is felt, and felt hard',
    chute.openSent.length === 1 && typeof chute.openSent[0] === 'number' && chute.openSent[0] >= 60,
    'sent=' + JSON.stringify(chute.openSent));
  check('haptics: touching down under a canopy is felt, and felt gently',
    chute.sent.length === 1 && typeof chute.sent[0] === 'number' && chute.sent[0] < 30,
    'sent=' + JSON.stringify(chute.sent));
  check('haptics: open hard, land soft — the pair reads as a pair',
    chute.openSent[0] > chute.sent[0] * 2,
    'open=' + chute.openSent[0] + ' land=' + chute.sent[0]);

  // ---- the runway ----
  // The one sustained channel, and the only thing here that runs on its own
  // timer rather than on a call from the game. Three things have to hold or it
  // is worse than nothing: it has to keep pulsing, it has to stop on its own
  // when the caller goes quiet, and it must never take the channel from a
  // one-shot.
  //
  // Counted in PULSES rather than over a stopwatch. The pump asks for its next
  // slot 200 ms out, and on a real device that is 200 ms — but here the page
  // renders a whole city through swiftshader and one frame can hold the main
  // thread for half a second, so the timer lands whenever the thread next
  // frees up. Measured against a clock this reads as a broken pump; measured
  // in pulses it is exactly the pump working.
  async function waitFor(fn, ms) {
    return page.waitForFunction(fn, null, { timeout: ms || 25000 })
      .then(function () { return true; }, function () { return false; });
  }
  await page.evaluate(function () {
    GAME.haptics.testReset();
    window.__buzz.length = 0;
    // Same guard as the one-shots above, for the same reason: these reach for
    // the channel by name, and a build without it would throw in the page and
    // take the runner down rather than report anything. It cost a control run
    // to learn that once already.
    window.__rumbleState = function () {
      return typeof GAME.haptics.testRumble === 'function'
        ? GAME.haptics.testRumble() : { missing: true, on: null, armed: null };
    };
    // Drive the keepalive from a timer rather than from the plane, so this is
    // a test of the channel and not of whether a Skywhistle can be found and
    // got up to speed inside a headless frame budget. The wiring in
    // updatePlane is covered on its own, below.
    window.__roll = setInterval(function () { window.__hap('rumble', 0.8); }, 30);
  });
  // Count the rumble's own trains, not everything in the recorder. The world
  // is live around a player standing in the street, and a one-shot landing
  // mid-roll — traffic clipping them, anything — is a bare number rather than
  // a pattern. Requiring every entry to be a train made an EXPECTED event fail
  // the check, which is the opposite of what it is for: there is a check just
  // below asserting a one-shot does cut through.
  await page.evaluate(function () {
    window.__trains = function () {
      return window.__buzz.filter(function (v) { return Array.isArray(v); });
    };
  });
  var pulsed = await waitFor(function () { return window.__trains().length >= 3; });
  var roll = await page.evaluate(function () {
    var mid = { sent: window.__trains() };
    // a crash mid-roll has to cut straight through it
    window.__buzz.length = 0;
    GAME.haptics.knock(1);
    mid.knockGotThrough = window.__buzz.slice();
    return mid;
  });
  var resumed = await waitFor(function () { return window.__trains().length >= 2; });
  await page.evaluate(function () {
    // the caller going quiet is the whole of switching it off — there is no
    // off switch to forget, which is the point of the keepalive
    clearInterval(window.__roll);
    window.__buzz.length = 0;
  });
  var woundDown = await waitFor(function () { return !window.__rumbleState().armed; }, 8000);
  var rollOff = await page.evaluate(function () {
    return { sent: window.__buzz.slice(), state: window.__rumbleState() };
  });
  check('haptics: the runway rumble keeps pulsing, and in a pattern',
    pulsed && roll.sent.length >= 3 &&
    roll.sent.every(function (v) { return v.length >= 5; }),
    'pulses=' + roll.sent.length + ' first=' + JSON.stringify(roll.sent[0]));
  check('haptics: a crash mid-roll cuts straight through it',
    roll.knockGotThrough.length === 1 && roll.knockGotThrough[0] === 55,
    'sent=' + JSON.stringify(roll.knockGotThrough));
  check('haptics: and the rumble picks back up behind it', resumed === true);
  check('haptics: the caller going quiet winds it down, with nothing to remember',
    woundDown && !rollOff.state.missing && rollOff.state.on === false &&
    rollOff.sent.filter(function (v) { return Array.isArray(v); }).length === 0,
    'state=' + JSON.stringify(rollOff.state) + ' sentAfter=' + JSON.stringify(rollOff.sent));

  // and the wiring: a plane on its wheels with the throttle open arms it
  var plane = await page.evaluate(function () {
    var P = GAME.player, K = GAME.input.keys, r = {};
    window.__hap('rumble', 0);
    if (P.inCar) GAME.exitCar();
    P.health = 100;
    GAME.test.teleport(356, 200);
    GAME.test.fastForward(0.5);
    // Board the plane we just made, rather than hunting for the nearest car.
    // enterNearestCar searches 10 m around the player, and an unpowered
    // airframe does not sit still — the aircraft branch has it falling to
    // whatever is under it from the moment it exists — so on some ground it
    // had drifted out of reach by the time this asked. Four checks failed
    // together when it did, because the block gives up here and returns.
    //
    // The wait is a full second either way: enterCar plays the door out before
    // P.inCar turns over and that runs to about 35 frames, so the 0.6 s this
    // replaces was two frames of margin.
    var plane = GAME.test.spawnCar('airplane', 5, 0);
    GAME.test.fastForward(0.3);
    if (plane) GAME.enterCar(plane);
    GAME.test.fastForward(1.2);
    var car = P.car;
    r.inPlane = !!(car && car.spec.plane);
    r.spawned = !!plane;
    if (!r.inPlane) return r;
    car.pos.y = GAME.city.surfaceY(car.pos.x, car.pos.z) + car.spec.wheelH;
    car.speed = 0; car.pitch = 0;
    GAME.haptics.testReset();
    K['KeyW'] = true;                       // throttle open on the wheels
    GAME.test.fastForward(0.5);
    r.rolling = window.__rumbleState();
    r.speed = Math.round(car.speed * 10) / 10;
    r.onGround = car.pos.y <= GAME.city.surfaceY(car.pos.x, car.pos.z) + car.spec.wheelH + 0.35;
    K['KeyW'] = false;
    // lift it off and the same call stops arming
    car.pos.y = GAME.city.surfaceY(car.pos.x, car.pos.z) + 40;
    car.speed = 40; car.pitch = 0.2;
    GAME.test.fastForward(0.3);
    r.flying = window.__rumbleState();
    GAME.exitCar();
    window.__hap('rumble', 0);
    // and take the plane with us: it was left forty metres up, and the groups
    // below want a tidy world rather than an airliner hanging over the city
    GAME.vehicles.removeCar(car);
    GAME.test.fastForward(0.4);
    r.onFoot = !GAME.player.inCar;
    r.planeGone = GAME.world.cars.indexOf(car) === -1;
    return r;
  });
  check('haptics: a plane is on the runway with the throttle open (anchor sanity)',
    plane.inPlane === true && plane.onGround === true && plane.speed > 0,
    'spawned=' + plane.spawned + ' inPlane=' + plane.inPlane +
    ' onGround=' + plane.onGround + ' speed=' + plane.speed);
  check('haptics: the takeoff run arms the rumble',
    plane.rolling && plane.rolling.armed === true && plane.rolling.v > 0.2,
    'state=' + JSON.stringify(plane.rolling));
  check('haptics: and leaving the ground disarms it',
    plane.flying && !plane.flying.missing && plane.flying.armed === false,
    'state=' + JSON.stringify(plane.flying));
  check('haptics: and the group leaves the player on foot and the sky empty (anchor sanity)',
    plane.onFoot === true && plane.planeGone === true,
    'onFoot=' + plane.onFoot + ' planeGone=' + plane.planeGone);

  check('haptics: the handedness switch is hidden off a touch device',
    (await page.evaluate(function () {
      return document.getElementById('pause-lefty').style.display;
    })) === 'none');
  check('haptics: the rumble switch is hidden where nothing could buzz',
    (await page.evaluate(function () {
      return document.getElementById('pause-haptic').style.display;
    })) === 'none');
  await page.evaluate(function () { navigator.vibrate = window.__realVibrate; });

  // ---------- 8: the frame budget ----------
  // Unlike the groups above these are specification rather than regression:
  // the controller is new, so there is no earlier behaviour to fail against.
  // What they pin is the half that is easy to get wrong — a governor that
  // only ever ratchets down is worse than none at all.
  var perf = await page.evaluate(function () {
    var P = GAME.perf, r = {};
    P.testReset();
    r.restScale = P.scale;
    r.restBudget = P.budget(12);

    // slow frames, but still inside the warmup: boot costs are not evidence
    for (var i = 0; i < 60; i++) P.sample(40);
    r.ema = Math.round(P.frameMs);
    for (var j = 0; j < 60; j++) P.update(0.04);     // 2.4 s, warmup is 3
    r.duringWarmup = P.scale;
    for (var k = 0; k < 40; k++) P.update(0.04);     // past it
    r.afterWarmup = P.scale;

    // all the way down, and no further
    for (var m = 0; m < 60; m++) P.update(0.5);
    r.floor = P.scale;
    r.floorBudget = P.budget(12);
    r.neverZero = P.budget(1);

    // and back up once the frames come good again
    P.testFrames(1000 / 120);
    for (var n = 0; n < 60; n++) P.update(0.5);
    r.recovered = P.scale;
    r.recoveredBudget = P.budget(12);

    // between the two thresholds it should hold, not hunt
    P.testFrames(20);
    var held = P.scale;
    for (var q = 0; q < 40; q++) P.update(0.5);
    r.deadBandDrift = Math.abs(P.scale - held);

    P.testReset();
    return r;
  });
  check('budget: a healthy frame spends the full authored cap (anchor sanity)',
    perf.restScale === 1 && perf.restBudget === 12, 'scale=' + perf.restScale + ' budget=' + perf.restBudget);
  check('budget: slow frames actually moved the average (anchor sanity)',
    perf.ema > 22, 'ema=' + perf.ema);
  check('budget: nothing is cut while the first seconds are still settling',
    perf.duringWarmup === 1, 'scale=' + perf.duringWarmup);
  check('budget: past the warmup, late frames thin the crowd',
    perf.afterWarmup < 1, 'scale=' + perf.afterWarmup);
  check('budget: it stops at the floor rather than emptying the city',
    perf.floor > 0.3 && perf.floor < 0.4 && perf.floorBudget === 4,
    'scale=' + perf.floor + ' budget=' + perf.floorBudget);
  check('budget: it never asks for none of something', perf.neverZero >= 1, 'budget=' + perf.neverZero);
  check('budget: the crowd comes back when the frames do',
    perf.recovered === 1 && perf.recoveredBudget === 12,
    'scale=' + perf.recovered + ' budget=' + perf.recoveredBudget);
  check('budget: between the thresholds it holds instead of hunting',
    perf.deadBandDrift === 0, 'drift=' + perf.deadBandDrift);

  // and the spawners actually ask it
  var wired = await page.evaluate(function () {
    var asked = [], real = GAME.perf.budget;
    GAME.perf.budget = function (n) { asked.push(n); return real(n); };
    GAME.test.fastForward(3);
    GAME.perf.budget = real;
    var S = GAME.settings;
    return { traffic: asked.indexOf(S.maxTraffic) >= 0, peds: asked.indexOf(S.maxPeds) >= 0,
             parked: asked.indexOf(S.maxParked) >= 0, n: asked.length };
  });
  check('budget: traffic, pedestrians and parked cars all ask it what they may spend',
    wired.traffic && wired.peds && wired.parked,
    'traffic=' + wired.traffic + ' peds=' + wired.peds + ' parked=' + wired.parked + ' calls=' + wired.n);

  // ---------- 9: a purchase is delivered once ----------
  // The forecourt bay a bought vehicle belongs in is created by the same
  // purchase, so the delivered car has to be its occupant. Unlinked, the bay
  // reads empty and the parked spawner fills it with a twin a few frames
  // later — right next to you, since a garage bay is 'special' and has no
  // distance floor.
  var buy = await page.evaluate(function () {
    var P = GAME.player, K = GAME.input.keys;
    GAME.police.clearWanted();
    P.health = 100;
    if (P.inCar) GAME.exitCar();
    GAME.test.teleport(64, 384);            // the showroom forecourt
    GAME.test.fastForward(1);
    var before = GAME.world.cars.filter(function (c) { return c.type === 'buggy'; }).length;
    GAME.test.addCash(200000);
    var opened = GAME.shops.open('showroom0');
    var bought = GAME.shops.buy('buggy');
    GAME.shops.close();
    if (GAME.share.isOpen) GAME.share.hide();
    GAME.test.fastForward(4);
    function nearBay(excl) {
      return GAME.world.cars.filter(function (c) {
        return c.type === 'buggy' && c !== excl && U.dist2(c.pos.x, c.pos.z, 64, 384) < 70 * 70;
      });
    }
    var onDelivery = nearBay(null);
    var bay = GAME.shops.garageSpot('buggy');
    var linked = !!(bay && bay.live && onDelivery.indexOf(bay.live) >= 0);

    // Now TAKE IT OUT, which is when the twin turns up: the bay sits ~7 m from
    // the forecourt, inside the spawner's clearance check, so nothing can
    // restock it while the delivered car is still standing on it. Drive clear
    // and the check passes — and with nothing linking car to bay, the bay
    // reads empty and is refilled on the spot, in view.
    // the delivered one specifically: "nearest" is a lottery on a live street,
    // and this check is about the car that came out of the showroom
    GAME.test.enterNearestCar(onDelivery[0] || null);
    GAME.test.fastForward(2);
    var driving = !!(P.car && P.car.type === 'buggy');
    // Driven out under throttle it only manages a few metres: the dealer lot
    // is a narrow strip between the road and the glass hall, and the delivery
    // heading points at the building. Move it instead — what the bug needs is
    // the car out of the bay's clearance radius while still aboard, not a
    // demonstration that the lot is tight.
    GAME.test.teleport(64, 444);
    GAME.test.fastForward(3);
    var away = P.car ? Math.sqrt(U.dist2(P.car.pos.x, P.car.pos.z, 64, 384)) : 0;
    var twins = nearBay(P.car).length;
    return { opened: !!opened, bought: !!bought, before: before, delivered: onDelivery.length,
             linked: linked, driving: driving, away: away, twins: twins,
             inGarage: GAME.shops.garage().indexOf('buggy') >= 0 };
  });
  check('showroom: the shop opened and the purchase went through (anchor sanity)',
    buy.opened && buy.bought && buy.inGarage && buy.before === 0,
    'opened=' + buy.opened + ' bought=' + buy.bought + ' inGarage=' + buy.inGarage + ' before=' + buy.before);
  check('showroom: exactly one of the bought vehicle is delivered',
    buy.delivered === 1, 'found=' + buy.delivered);
  check('showroom: and it is parked as the occupant of its own forecourt bay',
    buy.linked === true, 'linked=' + buy.linked);
  check('showroom: it is out of the bay with the player aboard (anchor sanity)',
    buy.driving && buy.away > 25, 'driving=' + buy.driving + ' away=' + (buy.away || 0).toFixed(1));
  check('showroom: taking it out does not leave a twin behind',
    buy.twins === 0, 'twins=' + buy.twins);

  // ---------- 10: the race grid and the rubber band ----------
  var race = await page.evaluate(function () {
    var P = GAME.player;
    GAME.police.clearWanted();
    P.health = 100;
    if (P.inCar) GAME.exitCar();
    var def = GAME.missions.DEFS.filter(function (d) { return d.id === 'race0'; })[0];
    GAME.test.teleport(def.start.x, def.start.z - 40);
    GAME.test.fastForward(0.5);
    var _ride = GAME.test.spawnCar('taxi', 4, 0);
    GAME.test.fastForward(0.3);
    GAME.test.enterNearestCar(_ride);
    GAME.test.fastForward(1.5);
    if (!P.inCar || !P.car) return { racing: false };
    GAME.test.teleport(def.start.x, def.start.z);   // onto the start line
    // Step to the GO and measure the GRID, not the race. Run on for a few
    // seconds first and the rivals have simply driven off up the road, which
    // reads as "ahead" whether they lined up in front of the player or behind
    // — the check would pass on either.
    var a = null;
    for (var f = 0; f < 900; f++) {
      GAME.test.fastForward(1 / 60);
      a = GAME.missions.active;
      if (a && a.racers && a.racers.length) break;
    }
    if (!a || a.def.id !== 'race0' || !a.racers.length) return { racing: false, state: a && a.state };

    // every rival must be in front of the player, along the way they face
    var fx = Math.sin(P.car.heading), fz = Math.cos(P.car.heading);
    var aheadOf = a.racers.map(function (r) {
      return Math.round(((r.pos.x - P.car.pos.x) * fx + (r.pos.z - P.car.pos.z) * fz) * 10) / 10;
    });

    // The grid is measured during the countdown, where the cars are still
    // sitting on it. The BAND only runs once the flag drops, so carry on to
    // 'run' before touching it.
    for (var g2 = 0; g2 < 900 && a.state !== 'run'; g2++) GAME.test.fastForward(1 / 60);
    if (a.state !== 'run') return { racing: true, aheadOf: aheadOf, state: a.state };

    // the band: drop one far back and pull one far forward, then read the edge
    var rear = a.racers[0], front = a.racers[1];
    var cp = a.def.cps[a.cpIndex];
    var toCp = Math.sqrt(U.dist2(P.car.pos.x, P.car.pos.z, cp[0], cp[1]));
    var ux = (cp[0] - P.car.pos.x) / toCp, uz = (cp[1] - P.car.pos.z) / toCp;
    rear.pos.x = P.car.pos.x - ux * 60; rear.pos.z = P.car.pos.z - uz * 60;
    front.pos.x = P.car.pos.x + ux * 60; front.pos.z = P.car.pos.z + uz * 60;
    rear.cpIndex = front.cpIndex = a.cpIndex;
    GAME.test.fastForward(1);            // let the race controller drive them once
    var out = { racing: true, aheadOf: aheadOf, state: a.state,
                rearEdge: rear.raceEdge, frontEdge: front.raceEdge,
                myType: P.car.type, rivalType: a.racers[0].type,
                mySpeed: P.car.spec.maxSpeed, rivalSpeed: a.racers[0].spec.maxSpeed };
    // Call the race off. Left running it followed the groups below out of
    // here — the suspension checks drive a car of their own, and a live race
    // scratches the moment they step out of it.
    // Call the race off AND get off the start line. cleanup() clears `active`
    // on the spot, but the trigger is proximity: sat on the marker in a car
    // with no heat, the next tick simply starts the race again — which is
    // what carried a live race into the groups below.
    GAME.missions.failActive('checked');
    GAME.test.teleport(356, 60);
    GAME.test.fastForward(1);
    if (GAME.share.isOpen) GAME.share.hide();
    out.cleared = !GAME.missions.active;
    return out;
  });
  check('race: a race is running with a full field (anchor sanity)', race.racing === true,
    'state=' + race.state);
  if (race.racing) {
    check('race: the whole grid forms in front of the player, within sight',
      race.aheadOf.length === 3 && race.aheadOf.every(function (d) { return d > 2 && d < 30; }),
      'along-heading=' + JSON.stringify(race.aheadOf));
    check('race: a rival left behind is given more car, not more pedal',
      race.rearEdge > 1.05, 'edge=' + race.rearEdge);
    check('race: and one out in front is reined in',
      race.frontEdge < 1, 'edge=' + race.frontEdge);
    check('race: the field turns up in something quicker than the player brought',
      race.rivalType !== race.myType && race.rivalSpeed > race.mySpeed,
      'player=' + race.myType + '(' + race.mySpeed + ') rivals=' + race.rivalType + '(' + race.rivalSpeed + ')');
    check('race: the race is called off before the next group drives (anchor sanity)',
      race.cleared === true);
  }

  // the whole upgrade table at once, without running a race for each
  var up = await page.evaluate(function () {
    var f = GAME.missions.testRivalUpgrade, T = GAME.vehicles.TYPES;
    return ['icecream', 'van', 'ambulance', 'sedan', 'taxi', 'pickup', 'limo', 'buggy',
      'monster', 'sports', 'motorcycle', 'superbike'].map(function (t) {
      var r = f(t), to = T[r.type];
      return { from: t, to: r.type, edge: r.edge,
               faster: to.maxSpeed * r.edge > T[t].maxSpeed,
               sameClass: !!to.bike === !!T[t].bike,
               ground: !to.heli && !to.plane,
               law: r.type === 'police',
               ratio: Math.round(to.maxSpeed / T[t].maxSpeed * 100) / 100 };
    });
  });
  function every(fn) { return up.length === 12 && up.every(fn); }
  check('rivals: whatever you bring, the field is quicker',
    every(function (r) { return r.faster; }),
    JSON.stringify(up.filter(function (r) { return !r.faster; })));
  check('rivals: and always from your own class — a bike race stays a bike race',
    every(function (r) { return r.sameClass && r.ground; }),
    JSON.stringify(up.filter(function (r) { return !r.sameClass || !r.ground; })));
  check('rivals: never the law', every(function (r) { return !r.law; }));
  check('rivals: the upgrade is capped, so the race stays winnable',
    every(function (r) { return r.ratio <= 1.25; }),
    JSON.stringify(up.map(function (r) { return r.from + '->' + r.to + ' x' + r.ratio; })));
  check('rivals: bringing the best of a class buys an engine edge instead',
    up.filter(function (r) { return r.to === r.from; }).length === 2 &&
    up.filter(function (r) { return r.to === r.from; }).every(function (r) { return r.edge > 1; }),
    JSON.stringify(up.filter(function (r) { return r.to === r.from; })));

  // ---------- 11: nothing you do with the pedals steers a jump ----------
  var air = await page.evaluate(function () {
    var P = GAME.player, K = GAME.input.keys;
    GAME.police.clearWanted();
    P.health = 100;
    if (P.inCar) GAME.exitCar();
    GAME.test.teleport(356, 60);            // the strip: long, flat, straight
    GAME.test.fastForward(0.5);
    var _ride = GAME.test.spawnCar('sedan', 4, 0);
    GAME.test.fastForward(0.3);
    GAME.test.enterNearestCar(_ride);
    GAME.test.fastForward(1.5);
    var car = P.car;
    if (!car) return { flew: false };
    // Straight down the strip, PARALLEL to the kerb that runs along x=370.
    // Angle the launch into it instead and the last few frames of the descent
    // clip it — and since a car turned broadside covers more ground in x than
    // one pointing along the strip, the collider pushes the steered flight out
    // and the coast one not at all. That is the wall doing its job, not the
    // wheel steering the jump, but it lands in the same measurement. Fly clear
    // of it; the corridor anchor below is what keeps this honest.
    var H = 0;

    // Launch identically every time and fly it to the ground. The trajectory
    // is set at the lip, so every one of these should land in the same place
    // however the pedals are worked on the way.
    function flight(keys) {
      K['KeyW'] = K['KeyS'] = K['KeyA'] = K['KeyD'] = false;
      car.pos.set(356, GAME.city.groundY(356, 60), 60);
      car.air = 0; car.airVX = car.airVZ = undefined;
      GAME.test.fastForward(1 / 60);        // let the world settle around it
      // Pin the launch state hard, immediately before the lip. Set any earlier
      // and a tick of drag, a nudge from collideStatic, or the damage the last
      // landing did all get a say, and the flights stop being comparable —
      // which is what the launch anchor below caught.
      car.pos.set(356, GAME.city.groundY(356, 60) + 6, 60);
      car.heading = H; car.speed = 26; car.lat = 0; car.vy = 9; car.air = 0;
      car.airVX = car.airVZ = undefined;
      car.jumpRamp = null; car.jumpSpin = 0;
      car.hp = car.spec.hp; car.stage = 0; car.boostT = 0; car.spiked = false;
      // One tick to leave the ground, THEN the inputs. The frame the wheels
      // come off is still a frame on the ramp and the pedals are meant to
      // count for it; what is being measured here is the flight after that.
      GAME.test.fastForward(1 / 60);
      var frozen = Math.round(Math.sqrt((car.airVX || 0) * (car.airVX || 0) +
        (car.airVZ || 0) * (car.airVZ || 0)) * 1000) / 1000;
      for (var k in keys) K[k] = keys[k];
      var x0 = car.pos.x, z0 = car.pos.z, ticks = 0, spin = 0;
      var lx = x0, lz = z0;                 // last sample with the wheels still up
      var path = [[x0, z0, car.pos.y]];
      while (ticks < 400) {
        GAME.test.fastForward(1 / 60);
        ticks++;
        // landStunt zeroes the spin as it scores it, so catch it in flight
        spin = Math.max(spin, Math.abs(car.jumpSpin || 0));
        path.push([car.pos.x, car.pos.z, car.pos.y]);
        if (!car.air) break;                // wheels back down
        lx = car.pos.x; lz = car.pos.z;     // still flying, so this tick counts
      }
      K['KeyW'] = K['KeyS'] = K['KeyA'] = K['KeyD'] = false;
      // Measure to the last AIRBORNE sample, not to where it ends up. The tick
      // that breaks the loop is already a ground tick: the wheels are back on
      // and it drives on the speed/lat that landStunt just decomposed out of
      // the frozen trajectory — which legitimately differ when the body landed
      // rotated. Including it would be measuring how a sideways car scrubs
      // speed, not whether the pedals moved the jump.
      return { dist: Math.round(Math.sqrt(U.dist2(x0, z0, lx, lz)) * 1000) / 1000,
               frozen: frozen, ticks: ticks, spin: spin, path: path,
               turned: Math.abs(U.wrapPI(car.heading - H)) };
    }
    var coast = flight({});
    var braked = flight({ KeyS: true });
    var floored = flight({ KeyW: true });
    var steered = flight({ KeyA: true });
    // Is there anything along the flight the body could have hit? Same cull
    // collideStatic uses — a box only counts as a wall while its top is above
    // the car. If the city ever grows something into this corridor these
    // checks would start measuring the collider instead, so say so out loud
    // rather than let the invariant fail for a reason that is not the code's.
    var blockers = 0;
    for (var pi = 0; pi < coast.path.length; pi++) {
      var pt = coast.path[pi];
      var bx = GAME.city.hash.query(pt[0], pt[1], car.spec.l);
      for (var bj = 0; bj < bx.length; bj++) {
        var bb = bx[bj];
        if (bb.h !== undefined && bb.h <= pt[2] + 0.3) continue;
        if (bb.minY !== undefined && pt[2] < bb.minY - 1) continue;
        blockers++;
      }
    }
    delete coast.path; delete braked.path; delete floored.path; delete steered.path;
    // leave the world tidy: the group below drives a car of its own, and
    // enterNearestCar() hands back the one you are already sitting in
    GAME.exitCar();
    GAME.test.fastForward(0.5);
    return { flew: true, coast: coast, braked: braked, floored: floored, steered: steered,
             blockers: blockers, onFoot: !GAME.player.inCar };
  });
  check('air: the car left the ground and came back (anchor sanity)',
    air.flew && air.coast.ticks > 20 && air.coast.dist > 15,
    'ticks=' + (air.coast || {}).ticks + ' dist=' + (air.coast || {}).dist);
  if (air.flew) {
    check('air: standing on the brakes mid-jump changes nothing',
      Math.abs(air.braked.dist - air.coast.dist) < 0.01,
      'coast=' + air.coast.dist + ' braked=' + air.braked.dist);
    check('air: and neither does holding the throttle — no free metres',
      Math.abs(air.floored.dist - air.coast.dist) < 0.01,
      'coast=' + air.coast.dist + ' floored=' + air.floored.dist);
    check('air: every launch is identical (anchor sanity)',
      // frozen > 0 matters: read this off a build with no held trajectory at
      // all and every flight reports 0, and the anchor would agree they match
      air.coast.frozen > 0 &&
      air.braked.frozen === air.coast.frozen && air.floored.frozen === air.coast.frozen &&
      air.steered.frozen === air.coast.frozen && air.braked.ticks === air.coast.ticks &&
      air.floored.ticks === air.coast.ticks && air.steered.ticks === air.coast.ticks,
      'speed ' + [air.coast, air.braked, air.floored, air.steered].map(function (f) { return f.frozen; }).join('/') +
      '  hang ' + [air.coast, air.braked, air.floored, air.steered].map(function (f) { return f.ticks; }).join('/'));
    check('air: the wheel still turns the body, so spins still score',
      air.steered.turned > 0.3 && air.steered.spin > 0.3,
      'turned=' + air.steered.turned.toFixed(2) + ' spin=' + air.steered.spin.toFixed(2));
    check('air: the corridor is clear, so nothing but the pedals is in play (anchor sanity)',
      air.blockers === 0, 'walls along the flight=' + air.blockers);
    check('air: and the group leaves the player on foot (anchor sanity)', air.onFoot === true);
    check('air: but turning in the air does not steer the jump either',
      Math.abs(air.steered.dist - air.coast.dist) < 0.01,
      'coast=' + air.coast.dist + ' steered=' + air.steered.dist);
  }

  // ---------- 12: suspension carries the load ----------
  var susp = await page.evaluate(function () {
    var P = GAME.player, K = GAME.input.keys;
    function clear() { K['KeyW'] = K['KeyS'] = K['KeyA'] = K['KeyD'] = false; }
    GAME.police.clearWanted();
    P.health = 100;
    GAME.test.teleport(356, 60);              // the strip: long, flat, straight
    GAME.test.fastForward(0.5);
    var _ride = GAME.test.spawnCar('sedan', 3, 0);
    GAME.test.fastForward(0.3);
    GAME.test.enterNearestCar(_ride);
    GAME.test.fastForward(1.5);
    var car = P.car;
    if (!car || !car.susp) return { drove: false };
    clear();
    GAME.test.fastForward(1.5);
    var rest = { p: car.susp.p, grade: car.bodyPitch, mesh: car.mesh.rotation.x };

    K['KeyW'] = true;                         // open the throttle
    GAME.test.fastForward(0.5);
    var squat = { p: car.susp.p, speed: car.speed };

    clear(); K['KeyS'] = true;                // and stand on the brakes
    GAME.test.fastForward(0.5);
    var dive = { p: car.susp.p, speed: car.speed };

    clear();
    GAME.test.fastForward(3);                 // let it settle
    var settled = car.susp.p;

    // in the air nothing loads the springs
    K['KeyW'] = true;
    GAME.test.fastForward(1.5);
    car.pos.y += 8; car.air = 1; car.vy = 4;
    GAME.test.fastForward(0.4);
    var air = car.susp.p;
    clear();
    GAME.test.fastForward(2);
    return { drove: true, rest: rest, squat: squat, dive: dive, settled: settled, air: air,
             sum: Math.abs(car.mesh.rotation.x - (car.bodyPitch + car.susp.p)) };
  });
  check('suspension: the player is driving a car with springs (anchor sanity)', susp.drove === true);
  if (susp.drove) {
    check('suspension: at rest the body sits on the grade and nothing else',
      Math.abs(susp.rest.p) < 0.005, 'susp=' + susp.rest.p);
    check('suspension: opening the throttle lifts the nose',
      susp.squat.p < -0.01 && susp.squat.speed > 3,
      'susp=' + susp.squat.p.toFixed(4) + ' speed=' + susp.squat.speed.toFixed(1));
    check('suspension: braking dives it the other way',
      susp.dive.p > 0.01, 'susp=' + susp.dive.p.toFixed(4) + ' speed=' + susp.dive.speed.toFixed(1));
    check('suspension: and it settles back to the grade',
      Math.abs(susp.settled) < 0.005, 'susp=' + susp.settled.toFixed(4));
    check('suspension: nothing loads the springs in mid-air',
      Math.abs(susp.air) < 0.01, 'susp=' + susp.air.toFixed(4));
    check('suspension: the mesh angle is exactly grade plus spring (additive, not replaced)',
      susp.sum < 1e-9, 'difference=' + susp.sum);
  }

  // a bike leans; it has no body to pitch on springs, and the rider owns it
  var bike = await page.evaluate(function () {
    var P = GAME.player, K = GAME.input.keys;
    GAME.exitCar();
    GAME.test.fastForward(0.6);
    // clear of the car just parked: a bike spawned against it is wedged, and
    // then this measures nothing at all
    GAME.test.teleport(356, 160);
    GAME.test.fastForward(0.5);
    var _ride = GAME.test.spawnCar('motorcycle', 5, 0);
    GAME.test.fastForward(0.3);
    GAME.test.enterNearestCar(_ride);
    GAME.test.fastForward(1.5);
    var car = P.car;
    if (!car || car.type !== 'motorcycle') return { onBike: false };
    K['KeyW'] = true;
    GAME.test.fastForward(2);
    var p = car.susp ? car.susp.p : 0, speed = car.speed;
    K['KeyW'] = false;
    GAME.test.fastForward(1);
    return { onBike: true, p: p, speed: speed };
  });
  check('suspension: the bike is under way (anchor sanity)',
    bike.onBike === true && bike.speed > 3, 'speed=' + (bike.speed || 0).toFixed(1));
  check('suspension: a bike gets none of it', Math.abs(bike.p) < 0.005, 'susp=' + (bike.p || 0).toFixed(4));

  // ---------- 13: the touch stick lets go when the viewport changes ----------
  // The stick is placed where the thumb lands and steers by the offset from
  // that point, in client coordinates. Turn the device mid-drag and that
  // origin belongs to a screen that no longer exists — it can sit off the new
  // viewport entirely, which reads as a stick pinned hard over. The layer
  // only exists on a touch device, so this needs a context of its own.
  var tctx = await browser.newContext({ hasTouch: true, viewport: { width: 900, height: 500 } });
  var tpage = await tctx.newPage();
  var touchErrors = [];
  tpage.on('pageerror', function (e) { touchErrors.push(String(e.message).slice(0, 200)); });
  await tpage.goto(origin + '/index.html');
  await tpage.waitForFunction(function () {
    return window.GAME && GAME.test && GAME.city && GAME.city.nodes && GAME.city.nodes.length > 0;
  }, null, { timeout: 30000 });
  var stick = await tpage.evaluate(function () {
    GAME.test.start();
    GAME.test.fastForward(1);
    var zone = document.getElementById('tstick-zone');
    var base = document.getElementById('tstick-base');
    function touch(el, type, x, y) {
      var t = new Touch({ identifier: 7, target: zone, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent(type, {
        touches: [t], changedTouches: [t], targetTouches: [t], bubbles: true, cancelable: true
      }));
    }
    touch(zone, 'touchstart', 120, 380);
    touch(window, 'touchmove', 172, 380);        // 52 px over = full deflection
    var held = { onTouch: GAME.isTouch, zone: !!zone, x: GAME.input.touch.stickX, base: base.style.display };

    // The viewport changing under an active drag. Dispatched rather than
    // physically resized: a CI runner launches Chromium maximized, where
    // setViewportSize is a protocol error, and the listener is the thing under
    // test — who fires it does not matter. It also removes a race the physical
    // resize had, since setViewportSize resolves when the viewport is set and
    // not when the page has run its listeners, while dispatchEvent returns
    // only once they all have.
    window.dispatchEvent(new Event('resize'));
    var after = { x: GAME.input.touch.stickX, y: GAME.input.touch.stickY, base: base.style.display };

    // a release that never re-arms would be no better than the bug
    touch(zone, 'touchstart', 100, 300);
    touch(window, 'touchmove', 152, 300);
    var regrab = GAME.input.touch.stickX;
    return { held: held, after: after, regrab: regrab };
  });
  check('touch: the layer is live and the stick is deflected (anchor sanity)',
    stick.held.onTouch && stick.held.zone && Math.abs(stick.held.x) > 0.5 && stick.held.base === 'block',
    'x=' + stick.held.x + ' base=' + stick.held.base);
  check('touch: a viewport change lets the stick go',
    stick.after.x === 0 && stick.after.y === 0, 'x=' + stick.after.x + ' y=' + stick.after.y);
  check('touch: and puts the stick away with it', stick.after.base === 'none', 'base=' + stick.after.base);
  check('touch: a fresh grab still steers afterwards', Math.abs(stick.regrab) > 0.5, 'x=' + stick.regrab);
  // The thumb buttons themselves. A virtual button has no travel and no click
  // of its own, so this is the one piece of feedback that has to come from the
  // motor or it does not exist — and it is the cheapest to leave unwired,
  // since nothing on screen looks any different without it.
  var tap = await tpage.evaluate(function () {
    var sent = [];
    navigator.vibrate = function (ms) { sent.push(ms); return true; };
    var btn = null, all = document.querySelectorAll('.tbtn');
    for (var i = 0; i < all.length; i++) {
      if (all[i].style.display !== 'none' && all[i].offsetParent !== null) { btn = all[i]; break; }
    }
    if (!btn) return { found: false };
    function press(el) {
      var t = new Touch({ identifier: 11, target: el, clientX: 10, clientY: 10 });
      el.dispatchEvent(new TouchEvent('touchstart', {
        touches: [t], changedTouches: [t], targetTouches: [t], bubbles: true, cancelable: true
      }));
    }
    GAME.haptics.testReset(); sent.length = 0;
    press(btn);
    var onPress = sent.slice();
    // and the switch beside it means what it says, for these too
    GAME.haptics.setOn(false);
    GAME.haptics.testReset(); sent.length = 0;
    press(btn);
    var whileOff = sent.slice();
    GAME.haptics.setOn(true);
    return { found: true, label: btn.textContent, onPress: onPress, whileOff: whileOff };
  });
  check('touch: there is a thumb button on screen to press (anchor sanity)',
    tap.found === true, 'label=' + tap.label);
  check('touch: pressing one ticks, so it feels pressed at all',
    tap.onPress.length === 1 && tap.onPress[0] > 0,
    'label=' + tap.label + ' sent=' + JSON.stringify(tap.onPress));
  check('touch: and with RUMBLE off it does not',
    tap.whileOff.length === 0, 'sent=' + JSON.stringify(tap.whileOff));

  // RUN and AIM are TOGGLES: one press latches the flag until another press
  // clears it. Nothing released them when the on-foot controls stopped
  // applying, so boarding a car or dying kept them set behind the overlay and
  // handed them back — you came round at the hospital already sprinting, with
  // the button still lit, having pressed nothing.
  var latch = await tpage.evaluate(function () {
    var T = GAME.input.touch, P = GAME.player, r = {};
    function press(el) {
      var t = new Touch({ identifier: 21, target: el, clientX: 10, clientY: 10 });
      el.dispatchEvent(new TouchEvent('touchstart', {
        touches: [t], changedTouches: [t], targetTouches: [t], bubbles: true, cancelable: true
      }));
      el.dispatchEvent(new TouchEvent('touchend', {
        touches: [], changedTouches: [t], targetTouches: [], bubbles: true, cancelable: true
      }));
    }
    var run = null, all = document.querySelectorAll('.tbtn');
    for (var i = 0; i < all.length; i++) if (all[i].textContent === 'RUN') run = all[i];
    if (!run) return { found: false };

    P.health = 100;
    if (P.inCar) GAME.exitCar();
    GAME.test.teleport(-60, 60);
    GAME.test.fastForward(0.5);

    // it latches, which is the whole point of a toggle
    press(run);
    r.held = { flag: !!T.run, lit: run.style.background !== '' };

    // ...and getting into a car lets it go
    var _ride = GAME.test.spawnCar('sedan', 4, 0);
    GAME.test.fastForward(0.3);
    GAME.test.enterNearestCar(_ride);
    // a full second: enterCar plays the door out before P.inCar turns over, and
    // it runs to about 35 frames — half a second lands just short of it and
    // reads exactly like a boarding that never happened
    GAME.test.fastForward(1);
    r.boarded = { inCar: !!P.inCar, flag: !!T.run, lit: run.style.background !== '' };

    // Back out, latch it again, and die on it. Pressed until it is actually
    // ON rather than pressed once and assumed: a toggle left set by the last
    // interruption is INVERTED from then on, so one press turns it off — which
    // is what the control does here, and without this the death case would
    // then pass on a flag that was already clear before anybody died.
    GAME.exitCar();
    GAME.test.fastForward(1);
    press(run);
    r.reheld = !!T.run;
    if (!T.run) press(run);
    r.armed = !!T.run;
    GAME.playerWasted('test');
    GAME.test.fastForward(0.5);
    r.dead = { state: P.state, flag: !!T.run, lit: run.style.background !== '' };
    return r;
  });
  var revivedRun = true;
  try {
    await tpage.evaluate(function () {
      GAME.input.keys['KeyR'] = true;
      GAME.test.fastForward(1.2);
      GAME.input.keys['KeyR'] = false;
    });
    await tpage.waitForFunction(function () { return GAME.player.state === 'alive'; }, null, { timeout: 10000 });
  } catch (e) { revivedRun = false; }
  await tpage.evaluate(function () { GAME.player.health = 100; GAME.test.fastForward(0.5); });
  check('touch: RUN latches when you press it, and stays a toggle (anchor sanity)',
    latch.found !== false && latch.held.flag === true && latch.held.lit === true && latch.reheld === true,
    'first press: ' + JSON.stringify(latch.held) + '  press after a boarding: ' + latch.reheld);
  check('touch: and getting into a car lets it go, button and all',
    latch.boarded && latch.boarded.inCar === true &&
    latch.boarded.flag === false && latch.boarded.lit === false,
    'after boarding: ' + JSON.stringify(latch.boarded));
  check('touch: so does dying on it — you do not come round already sprinting',
    latch.armed === true && latch.dead && latch.dead.state !== 'alive' &&
    latch.dead.flag === false && latch.dead.lit === false,
    'RUN on going in=' + latch.armed + ', after dying: ' + JSON.stringify(latch.dead));
  check('touch: and the player is back on their feet afterwards (anchor sanity)', revivedRun);

  // Press it, rather than just look at it: the markup ships with the label
  // already reading RUMBLE: ON, so a check that only reads the text passes
  // with the wiring torn out.
  var hapBtn = await tpage.evaluate(function () {
    var sent = [];
    navigator.vibrate = function (ms) { sent.push(ms); return true; };
    var b = document.getElementById('pause-haptic');
    var shown = b.style.display !== 'none', before = GAME.haptics.on, text0 = b.textContent;
    b.click();
    var mid = { on: GAME.haptics.on, text: b.textContent, pref: !!(GAME.prefs && GAME.prefs.rumbleOff) };
    var offSent = sent.slice();
    // and back on, which is the press that has to demonstrate itself
    GAME.haptics.testReset();
    sent.length = 0;
    b.click();
    return { shown: shown, before: before, text0: text0, mid: mid, offSent: offSent,
             onSent: sent.slice(), back: GAME.haptics.on, text2: b.textContent };
  });
  check('touch: the rumble switch is offered on a touch device',
    hapBtn.shown && /RUMBLE/.test(hapBtn.text0), 'shown=' + hapBtn.shown + ' text=' + hapBtn.text0);
  check('touch: pressing it turns rumble off, relabels, and remembers',
    hapBtn.before === true && hapBtn.mid.on === false && /OFF/.test(hapBtn.mid.text) && hapBtn.mid.pref === true,
    'on=' + hapBtn.mid.on + ' text=' + hapBtn.mid.text + ' pref=' + hapBtn.mid.pref);
  // Switching it on and feeling nothing tells you nothing — the setting reads
  // as a promise rather than as something that happened.
  check('touch: switching RUMBLE on demonstrates what was just switched on',
    hapBtn.onSent.length === 1 && Array.isArray(hapBtn.onSent[0]) && hapBtn.onSent[0].length >= 3,
    'sent=' + JSON.stringify(hapBtn.onSent));
  // vibrate(0) is not a buzz, it is the cancel setOn(false) sends to stop a
  // motor that might be mid-pattern — so filter it out rather than count it
  check('touch: and switching it OFF stays silent, which is the whole point',
    hapBtn.offSent.filter(function (v) { return Array.isArray(v) ? v.length : v > 0; }).length === 0,
    'sent=' + JSON.stringify(hapBtn.offSent));
  check('touch: and pressing it again turns it back on',
    hapBtn.back === true && /ON/.test(hapBtn.text2), 'on=' + hapBtn.back + ' text=' + hapBtn.text2);
  // Handedness: the buttons, the stick's half and the camera's half all have
  // to move together. Leaving any one behind puts both thumbs on the same side.
  var hand = await tpage.evaluate(function () {
    var zone = document.getElementById('tstick-zone');
    var canvas = document.getElementById('game-canvas');
    var btn = document.getElementById('pause-lefty');
    function drag(x1, x2) {                  // a camera drag on the canvas
      GAME.input.touch.camDX = 0;
      function fire(type, x) {
        var t = new Touch({ identifier: 9, target: canvas, clientX: x, clientY: 300 });
        (type === 'touchstart' ? canvas : window).dispatchEvent(new TouchEvent(type, {
          touches: [t], changedTouches: [t], targetTouches: [t], bubbles: true, cancelable: true
        }));
      }
      fire('touchstart', x1); fire('touchmove', x2);
      var moved = GAME.input.touch.camDX;
      fire('touchend', x2);
      GAME.input.touch.camDX = 0;
      return moved;
    }
    function shot() {
      var fire = document.getElementById('touch-layer').querySelector('.tbtn');
      return { zoneLeft: zone.style.left, zoneRight: zone.style.right,
               btnLeft: fire.style.left, btnRight: fire.style.right, inset: fire.__inset };
    }
    var W = window.innerWidth;
    var right = shot();
    var rightCamLeft = drag(W * 0.2, W * 0.2 + 40);    // left half: the stick's, not the camera's
    var rightCamRight = drag(W * 0.8, W * 0.8 + 40);
    btn.click();
    var lefty = shot(), leftyOn = GAME.touch.lefty, pref = !!(GAME.prefs && GAME.prefs.lefty);
    var leftyLabel = btn.textContent;
    var leftyCamLeft = drag(W * 0.2, W * 0.2 + 40);    // now the camera's half
    var leftyCamRight = drag(W * 0.8, W * 0.8 + 40);
    btn.click();
    var back = shot();
    return { right: right, lefty: lefty, back: back, leftyOn: leftyOn, pref: pref,
             rightCamLeft: rightCamLeft, rightCamRight: rightCamRight,
             leftyCamLeft: leftyCamLeft, leftyCamRight: leftyCamRight,
             backOn: GAME.touch.lefty, leftyLabel: leftyLabel, backLabel: btn.textContent };
  });
  check('touch: by default the stick owns the left and the buttons the right (anchor sanity)',
    hand.right.zoneLeft === '0px' && hand.right.btnRight !== '' && hand.right.btnLeft === 'auto' &&
    hand.right.inset !== undefined,
    JSON.stringify(hand.right));
  check('touch: and the camera drag lives on the half the stick does not own',
    hand.rightCamLeft === 0 && hand.rightCamRight !== 0,
    'left=' + hand.rightCamLeft + ' right=' + hand.rightCamRight);
  check('touch: switching hands moves the stick to the other side',
    hand.leftyOn === true && hand.lefty.zoneRight === '0px' && hand.lefty.zoneLeft === 'auto',
    JSON.stringify(hand.lefty));
  check('touch: the buttons keep their inset, measured from the other edge',
    hand.lefty.btnLeft === hand.right.inset + 'px' && hand.lefty.btnRight === 'auto',
    'left=' + hand.lefty.btnLeft + ' right=' + hand.lefty.btnRight + ' inset=' + hand.right.inset);
  check('touch: and the camera drag moves with them',
    hand.leftyCamLeft !== 0 && hand.leftyCamRight === 0,
    'left=' + hand.leftyCamLeft + ' right=' + hand.leftyCamRight);
  check('touch: the choice is remembered and the label says which hand it is on',
    hand.pref === true && /LEFT/.test(hand.leftyLabel) && /RIGHT/.test(hand.backLabel),
    'pref=' + hand.pref + ' lefty="' + hand.leftyLabel + '" back="' + hand.backLabel + '"');
  check('touch: switching back restores the original layout',
    hand.backOn === false && hand.back.zoneLeft === '0px' && hand.back.btnRight === hand.right.btnRight,
    JSON.stringify(hand.back));
  check('touch: zero page errors on the touch layer', touchErrors.length === 0, touchErrors[0]);
  await tctx.close();

  // ---------- 14: the broadphase survives a non-finite lookup ----------
  // Math.floor(±Infinity) is ±Infinity and i++ never moves off it, so the
  // cell loops spin forever and the frame loop stops dead. Every caller hands
  // these an entity position, so one bad number in the physics reaches them.
  // NaN was never the problem — NaN <= NaN is false, so those loops run zero
  // times. If this group times out, the guard is gone.
  var hash = null;
  try {
    hash = await withTimeout(page.evaluate(function () {
      var P = GAME.player, h = GAME.city.hash;
      return {
        normal: h.query(P.pos.x, P.pos.z, 60).length,
        infX: h.query(Infinity, P.pos.z, 10).length,
        negInfZ: h.query(P.pos.x, -Infinity, 10).length,
        nan: h.query(NaN, P.pos.z, 10).length,
        infR: h.query(P.pos.x, P.pos.z, Infinity).length,
        segFinite: h.segmentClear(P.pos.x, P.pos.z, P.pos.x + 0.1, P.pos.z + 0.1),
        segInf: h.segmentClear(P.pos.x, P.pos.z, Infinity, P.pos.z),
        segNan: h.segmentClear(P.pos.x, P.pos.z, NaN, P.pos.z)
      };
    }), 15000);
  } catch (e) { /* hung */ }
  check('broadphase: it answered at all (a timeout here means no guard)', !!hash);
  if (hash) {
    check('broadphase: an ordinary query still finds the city (anchor sanity)',
      hash.normal > 0, 'boxes=' + hash.normal);
    check('broadphase: an ordinary segment test still answers (anchor sanity)',
      typeof hash.segFinite === 'boolean', 'got=' + hash.segFinite);
    check('broadphase: an infinite coordinate returns nothing',
      hash.infX === 0 && hash.negInfZ === 0, '+x=' + hash.infX + ' -z=' + hash.negInfZ);
    check('broadphase: an infinite radius returns nothing', hash.infR === 0, 'boxes=' + hash.infR);
    check('broadphase: NaN returns nothing, as it always did', hash.nan === 0, 'boxes=' + hash.nan);
    check('broadphase: an infinite segment endpoint answers like a NaN one',
      hash.segInf === hash.segNan, 'inf=' + hash.segInf + ' nan=' + hash.segNan);
  }

  await browser.close();
  srv.close();
  if (failures.length) {
    console.log('\nREGRESSIONS: ' + failures.length + ' failure(s): ' + failures.join(', '));
    process.exit(1);
  }
  console.log('\nREGRESSIONS: all checks passed');
})().catch(function (e) { console.error('REGRESSIONS: runner crashed — ' + e.message); process.exit(1); });
