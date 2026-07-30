// Unique stunt jumps: 25 ramps hidden around the city. Clear one cleanly and
// it's logged; find them all and the city opens up.
GAME.stunts = (function () {
  var found = {}, total = 25, rewarded = false;

  function count() { var n = 0; for (var k in found) if (found[k]) n++; return n; }

  function load() {
    var s = (GAME.prefs && GAME.prefs.stunts) || null;
    if (s) { found = s.found || {}; rewarded = !!s.rewarded; }
    if (rewarded) {
      GAME.unlimitedAmmo = true;
      GAME.combat.giveAllWeapons();
      GAME.city.unlockMonsterTruck();   // the truck stays unlocked between sessions
    }
  }
  function save() {
    if (!GAME.prefs) GAME.prefs = {};
    GAME.prefs.stunts = { found: found, rewarded: rewarded };
    GAME.save();
  }

  // called when a jump that started on ramp `idx` lands successfully
  function credit(idx, airT, dist) {
    if (idx === undefined || idx === null) return 0;
    total = Math.max(total, GAME.city.ramps.length);
    if (found[idx]) return 0;
    found[idx] = true;
    var n = count();
    var bonus = 250 + n * 50;
    GAME.addCash(bonus);
    GAME.audio.sting('win');
    var left = total - n;
    GAME.hud.message('UNIQUE STUNT JUMP  ' + n + ' / ' + total + '   ·   +$' + bonus +
      (left > 0 ? '   —   ' + left + ' more for a special reward' : ''), 4.5);
    GAME.track('stunt-jump-found');
    if (n >= total && !rewarded) grantReward();
    save();
    return bonus;
  }

  function grantReward() {
    rewarded = true;
    GAME.track('all-stunt-jumps');
    GAME.unlimitedAmmo = true;
    GAME.combat.giveAllWeapons();
    GAME.addCash(50000);
    GAME.city.unlockMonsterTruck();
    GAME.hud.message('ALL ' + total + ' STUNT JUMPS!  +$50,000  ·  every weapon with unlimited ammo  ·  MONSTER TRUCK unlocked at the airport', 8);
    GAME.share.show({
      slug: 'all-stunt-jumps',
      eyebrow: 'Costa Rosa · 1986',
      title: 'ALL ' + total + ' STUNT JUMPS',
      subtitle: 'Every ramp in the city, found and cleared',
      accent: '#ffb03a',
      stats: [
        { label: 'Jumps', value: total + ' / ' + total },
        { label: 'Payout', value: '$50,000' },
        { label: 'Unlocked', value: 'MONSTER TRUCK' }
      ]
    });
    // clearing every jump is the other way across the channel
    if (GAME.isla) GAME.isla.checkUnlock();
  }

  return {
    get found() { return count(); },
    get total() { return total; },
    get complete() { return rewarded; },
    load: load, credit: credit,
    isFound: function (i) { return !!found[i]; }
  };
})();

GAME.missions = (function () {
  var DEFS = [
    {
      id: 'race0', type: 'race', name: 'STRIP SPRINT', reward: 500, start: { x: 350, z: -350 },
      cps: [[350, -150], [350, 50], [350, 250], [250, 350], [150, 250], [150, 50]]
    },
    {
      id: 'race1', type: 'race', name: 'HARBOR LOOP', reward: 550, start: { x: -450, z: -100 },
      cps: [[-450, 150], [-350, 250], [-250, 350], [-150, 250], [-150, 50], [-250, -50], [-350, -50]]
    },
    {
      id: 'race2', type: 'race', name: 'DOWNTOWN DASH', reward: 600, start: { x: 50, z: 250 },
      cps: [[50, 50], [150, -50], [50, -250], [-50, -350], [-150, -250], [-150, -50], [-50, 50]]
    },
    // courier drops are generated fresh each run (see rollCourierStops)
    { id: 'courier0', type: 'courier', name: 'HOT PLATES', reward: 300, time: 95, start: { x: 158.4, z: 41.6 }, drops: 4, legMin: 110, legMax: 240 },
    { id: 'courier1', type: 'courier', name: 'NIGHT MAIL', reward: 320, time: 110, start: { x: -241.6, z: -41.6 }, drops: 4, legMin: 120, legMax: 260 },
    { id: 'courier2', type: 'courier', name: 'BEACH RUN', reward: 340, time: 100, start: { x: 364, z: 104 }, drops: 4, legMin: 100, legMax: 220 },
    { id: 'rampage0', type: 'rampage', name: 'STRIP HAVOC', reward: 400, time: 60, target: 3000, weapon: 'smg', ammo: 160, start: { x: 241.6, z: -258.4 } },
    { id: 'rampage1', type: 'rampage', name: 'HARBOR HAVOC', reward: 450, time: 60, target: 3500, weapon: 'shotgun', ammo: 30, start: { x: -341.6, z: 258.4 } },
    { id: 'rampage2', type: 'rampage', name: 'UPTOWN HAVOC', reward: 400, time: 60, target: 2500, weapon: 'smg', ammo: 160, start: { x: 41.6, z: -341.6 } },
    // Isla Verde's own work, and it stays over here — every checkpoint, drop
    // and target is on the island, so nothing ever asks you to cross mid-run.
    // Coordinates come from the island itself once it has registered.
    { id: 'race3', type: 'race', name: 'ALTA VERDE CLIMB', reward: 750, isla: 'climb', start: null, cps: null },
    { id: 'race4', type: 'race', name: 'MIRADOR RUN', reward: 800, isla: 'mirador', start: null, cps: null },
    { id: 'courier3', type: 'courier', name: 'COLD CHAIN', reward: 420, time: 115, isla: 'port', start: null, drops: 4, legMin: 110, legMax: 240 },
    { id: 'rampage3', type: 'rampage', name: 'DORADO HAVOC', reward: 550, time: 60, target: 3200, weapon: 'smg', ammo: 160, isla: 'dorado', start: null }
  ];

  // Island mission anchors, resolved after the island registers. A race's
  // checkpoints are road points around a named loop, so the route follows the
  // curves instead of cutting across a hillside.
  function placeIslaDefs() {
    if (!GAME.city.isla) return;
    var I = GAME.city.isla, tx = I.tx, tz = I.tz;
    function onRoad(x, z) {
      var rp = GAME.city.nearestRoadPoint(x, z);
      return [Math.round(rp.x), Math.round(rp.z)];
    }
    function ringLoop(f, a0, n) {
      var out = [];
      for (var i = 0; i < n; i++) {
        var q = I.ringPt(a0 + i / n * Math.PI * 2, f);
        out.push(onRoad(q[0], q[1]));
      }
      return out;
    }
    DEFS.forEach(function (d) {
      if (!d.isla) return;
      if (d.isla === 'climb') {
        // up the switchback and back down the ring
        var cps = [];
        [[880, -110], [860, -170], [900, -230], [938, -200], [938, -164]].forEach(function (p) {
          cps.push(onRoad(tx(p[0]), tz(p[1])));
        });
        d.cps = cps;
        d.start = { x: onRoad(tx(850), tz(-60))[0], z: onRoad(tx(850), tz(-60))[1] };
      } else if (d.isla === 'mirador') {
        d.cps = ringLoop(0.845, Math.PI * 0.1, 7);
        d.start = { x: d.cps[0][0], z: d.cps[0][1] };
        d.cps = d.cps.slice(1).concat([d.cps[0]]);
      } else if (d.isla === 'port') {
        var st = onRoad(tx(860), tz(100));
        d.start = { x: st[0], z: st[1] };
      } else {
        var sd = onRoad(tx(800), tz(130));
        d.start = { x: sd[0], z: sd[1] };
      }
    });
  }

  var active = null;
  var markers = [];
  var cpMarker = null;
  var resprayCooldown = 0;

  var MARKER_COLORS = { race: 0xff8a3d, courier: 0x38e8ff, rampage: 0xff4fa3 };
  var TYPE_LABEL = { race: 'STREET RACE', courier: 'COURIER RUN', rampage: 'RAMPAGE' };

  function makeMarkerMesh(color, r) {
    var m = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 3.4, 18, 1, true),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    return m;
  }

  function init() {
    placeIslaDefs();
    for (var i = 0; i < DEFS.length; i++) {
      var d = DEFS[i];
      if (d.isla && !d.start) continue;      // island never registered
      var mesh = makeMarkerMesh(MARKER_COLORS[d.type], 2.2);
      mesh.position.set(d.start.x, GAME.city.groundY(d.start.x, d.start.z) + 1.7, d.start.z);
      GAME.scene.add(mesh);
      markers.push({ def: d, mesh: mesh });
    }
    cpMarker = makeMarkerMesh(0xffe14f, 3.2);
    cpMarker.visible = false;
    GAME.scene.add(cpMarker);
    // respray markers
    GAME.city.pois.resprays.forEach(function (g) {
      var rm = makeMarkerMesh(0xc86bff, 3.0);
      rm.position.set(g.door.x - 4, 1.7, g.door.z);
      GAME.scene.add(rm);
    });
  }

  function bestKey(d) { return d.id; }

  // island work only shows up once the bridges are open
  function defAvailable(d) { return !d.isla || (GAME.isla && GAME.isla.isOpen()); }

  // a kerbside spot between minR and maxR of the origin. Verifies the result is
  // actually that far away — snapping to the road grid can pull a point much
  // closer than the radius asked for, which made every fare a short hop.
  function randomRoadPoint(fromX, fromZ, minR, maxR) {
    var best = null, bestErr = 1e18;
    for (var t = 0; t < 60; t++) {
      var a = Math.random() * Math.PI * 2, r = U.randRange(Math.random, minR, maxR);
      var rp = GAME.city.nearestRoadPoint(fromX + Math.cos(a) * r, fromZ + Math.sin(a) * r);
      // the mainland grid has hard edges; the island answers for its own roads
      if (rp.axis !== 'net' && (rp.x < -470 || rp.x > 352 || Math.abs(rp.z) > 470)) continue;
      if (GAME.city.isInWater(rp.x, rp.z)) continue;
      // stay on the landmass you started on: a courier leg that crosses the
      // channel is not a delivery run, it is a swim
      if (GAME.city.islandIdAt(rp.x, rp.z) !== GAME.city.islandIdAt(fromX, fromZ)) continue;
      // nudge onto the sidewalk edge, clear of the driving lanes
      var sgn = Math.random() < 0.5 ? 1 : -1;
      var off = rp.axis === 'net' ? [Math.cos(rp.heading) * 9 * sgn, -Math.sin(rp.heading) * 9 * sgn]
        : rp.axis === 'z' ? [9 * sgn, 0] : [0, 9 * sgn];
      var px = Math.round(rp.x + off[0]), pz = Math.round(rp.z + off[1]);
      var d = U.dist(px, pz, fromX, fromZ);
      if (d >= minR && d <= maxR) return [px, pz];
      // keep the closest near-miss in case nothing lands inside the band
      var err = d < minR ? minR - d : d - maxR;
      if (err < bestErr) { bestErr = err; best = [px, pz]; }
    }
    return best || [Math.round(fromX), Math.round(fromZ)];
  }

  // a route that stays on the streets: road-graph nodes, then in along the
  // nearest road line, then a short hop to the exact marker (never across a block)
  function roadRoute(fromX, fromZ, toX, toZ) {
    var rp = GAME.city.nearestRoadPoint(toX, toZ);
    var nodes = GAME.nav.roadPath(fromX, fromZ, rp.x, rp.z);
    var pts = [];
    for (var i = 0; i < nodes.length; i++) pts.push([nodes[i].x, nodes[i].z]);
    pts.push([rp.x, rp.z]);
    pts.push([toX, toZ]);
    return pts;
  }

  // lay out a fresh delivery round: each drop is a leg away from the last, kept
  // apart from the others so the run covers ground instead of doubling back
  function rollCourierStops(def) {
    var stops = [];
    var cx = def.start.x, cz = def.start.z;
    // Each leg draws its own length inside the run's band rather than every
    // leg using the same one, so the same delivery is a different shape each
    // time you take it instead of the same lap with the pins moved.
    var lo0 = def.legMin || 110, hi0 = def.legMax || 240;
    for (var i = 0; i < (def.drops || 4); i++) {
      var lo = U.randRange(Math.random, lo0 * 0.7, lo0 * 1.25);
      var hi = U.randRange(Math.random, Math.max(lo + 70, hi0 * 0.75), hi0 * 1.45);
      var pt = null;
      for (var t = 0; t < 16; t++) {
        var c = randomRoadPoint(cx, cz, lo, hi);
        var ok = true;
        for (var j = 0; j < stops.length; j++) {
          if (U.dist2(c[0], c[1], stops[j][0], stops[j][1]) < 70 * 70) { ok = false; break; }
        }
        if (U.dist2(c[0], c[1], def.start.x, def.start.z) < 60 * 60) ok = false;
        if (ok) { pt = c; break; }
      }
      if (!pt) pt = randomRoadPoint(cx, cz, lo, hi);
      stops.push(pt);
      cx = pt[0]; cz = pt[1];
    }
    return stops;
  }

  // ---------- the ice cream round ----------
  // Isla Verde's own shift. You drive, the chimes play, and people come out to
  // the hatch when you stop. Each level wants more sales in the time you have.
  function startIceCream() {
    var P = GAME.player;
    GAME.track('job-started-icecream');
    active = {
      def: { type: 'icecream', name: 'ICE CREAM ROUND', id: 'icecream', job: true },
      state: 'run', t: 0, cpIndex: 0, score: 0, racers: [],
      phase: 'sell', level: 1, sales: 0, quota: 4, jobCount: 0, earned: 0,
      targets: [], timeLeft: 120, chimeT: 0, pitch: null, pitchT: 0, routeCp: null
    };
    setMarkersVisible(false);
    updateCp();
    GAME.hud.missionStart(active.def.name, objectiveText());
    GAME.hud.message('Round 1 — sell 4 before the clock runs out. The chimes do the work: pull up where there are people on the pavement and they will come to the hatch. Leave the truck to clock off.', 6);
    GAME.audio.pickup();
  }

  // Where the trade is: the middle of whichever knot of people on the pavement
  // is worth driving to. Nobody is summoned and nobody is marked as waiting —
  // that is a taxi fare, and this is a van with chimes on it.
  function iceCreamPitch() {
    var f = GAME.focus(), peds = GAME.world.peds;
    var best = null, bestScore = 0;
    for (var i = 0; i < peds.length; i++) {
      var a = peds[i];
      if (a.dead || a.isCop || a.jobPed) continue;
      var d = U.dist(f.x, f.z, a.pos.x, a.pos.z);
      if (d < 30 || d > 400) continue;
      var n = 0;
      for (var j = 0; j < peds.length; j++) {
        var b = peds[j];
        if (b.dead || b.isCop || b.jobPed) continue;
        if (U.dist2(a.pos.x, a.pos.z, b.pos.x, b.pos.z) < 30 * 30) n++;
      }
      var score = n / (1 + d / 220);
      if (score > bestScore) { bestScore = score; best = [Math.round(a.pos.x), Math.round(a.pos.z)]; }
    }
    return best;
  }

  function iceCreamSale(tgt) {
    var i = active.targets.indexOf(tgt);
    if (i >= 0) active.targets.splice(i, 1);
    dropArrow(tgt);
    // served, not spirited away: they walk off with it
    if (tgt.ped && !tgt.ped.dead) { tgt.ped.jobPed = false; tgt.ped.state = 'walk'; }
    var pay = 30 + active.level * 12;
    GAME.addCash(pay);
    active.earned += pay;
    active.sales++; active.jobCount++;
    GAME.audio.pickup();
    if (active.sales >= active.quota) {
      active.level++;
      active.sales = 0;
      active.quota += 2;
      active.timeLeft += 55;
      GAME.hud.message('ROUND ' + active.level + ' — +55s, sell ' + active.quota + '  ·  +$' + pay, 3.4);
      GAME.audio.sting('win');
    } else {
      GAME.hud.message('Sold — +$' + pay + '  ·  ' + active.sales + ' / ' + active.quota, 2);
    }
    GAME.hud.missionObjective(objectiveText());
    active.routeCp = null;
    updateCp();
  }

  function updateIceCream(dt, P) {
    if (!P.inCar || !P.car || P.car.type !== 'icecream') { endJob('clocked off'); return; }
    if (P.car.dead) { endJob('truck totalled'); return; }
    active.timeLeft -= dt;
    if (active.timeLeft <= 0) { endJob('out of time'); return; }
    var f = GAME.focus();
    // the chimes, on a loop, because that is the whole job
    active.chimeT -= dt;
    if (active.chimeT <= 0) { active.chimeT = 3.4; GAME.audio.chime(); }
    // point at the busiest pavement within reach, and keep re-pointing as the
    // crowd moves and as you work through it
    active.pitchT = (active.pitchT || 0) - dt;
    if (active.pitchT <= 0 || !active.pitch) {
      active.pitchT = 4;
      var np = iceCreamPitch();
      if (np) active.pitch = np;
    }
    // Anyone on the pavement hears the chimes: stop the truck and whoever is
    // close enough wanders over to the hatch. That is the entire job — nobody
    // is spawned waiting for you and nobody is flagging you down.
    replaceLostTargets();
    active.walkUpT = (active.walkUpT || 0) - dt;
    if (Math.abs(P.car.speed) < 3.5 && active.walkUpT <= 0) {
      var peds = GAME.world.peds;
      for (var w = 0; w < peds.length; w++) {
        var pd = peds[w];
        if (pd.dead || pd.isCop || pd.jobPed) continue;
        if (U.dist2(f.x, f.z, pd.pos.x, pd.pos.z) > 24 * 24) continue;
        pd.jobPed = true;
        pd.state = 'wait';
        active.targets.push({ x: pd.pos.x, z: pd.pos.z, ped: pd, boarding: true, walkUp: true });
        active.walkUpT = 2.2;
        break;
      }
    }
    stepBoarding(dt, f, P);
    updateArrows(dt);
    active.routeT = (active.routeT || 0) - dt;
    if (active.routeT <= 0) {
      active.routeT = 1.0;
      active.courierRoute = active.pitch ? roadRoute(f.x, f.z, active.pitch[0], active.pitch[1]) : null;
    }
    // the sold/quota line was set once at the start of the round and never
    // again — it read as a frozen shift readout however much you sold
    if (GAME.frame % 12 === 0) GAME.hud.missionObjective(objectiveText());
    GAME.hud.missionTimer(active.timeLeft, true);
  }

  function startJob(kind) {
    var P = GAME.player;
    if (active || !P.inCar || !P.car) return;
    if (kind === 'icecream') { startIceCream(); return; }
    GAME.track('job-started-' + kind);
    active = {
      def: { type: kind, name: kind === 'ambulance' ? 'PARAMEDIC' : 'TAXI DRIVER', id: kind, job: true },
      state: 'run', t: 0, cpIndex: 0, score: 0, racers: [],
      phase: 'pickup', pickup: null, dropoff: null,
      // an ambulance fills up before running to the hospital; a cab takes one fare
      capacity: kind === 'ambulance' ? 3 : 1,
      level: 1, targets: [], aboard: 0,
      timeLeft: kind === 'ambulance' ? 110 : 95,
      jobCount: 0, earned: 0, routeCp: null
    };
    startRound();
    setMarkersVisible(false);
    updateCp();
    GAME.hud.missionStart(active.def.name, objectiveText());
    GAME.hud.message(kind === 'ambulance'
      ? 'Level 1 — collect the patient and run them to a hospital. Each level adds more patients, further out. Leave the ambulance to clock off.'
      : 'Level 1 — pick up your fare and drive them to the drop-off. Fares get further out each level. Leave the cab to clock off.', 5);
    GAME.audio.pickup();
  }

  // push a point out of any road corridor onto the nearest kerb, so drop-offs
  // never land in a live traffic lane
  function clearOfRoad(x, z) {
    // the island's roads are curves, so push out along the road's own normal
    if (GAME.isla && GAME.isla.contains(x, z)) {
      var ip = GAME.city.nearestRoadPoint(x, z);
      var d = U.dist(x, z, ip.x, ip.z);
      if (d > 11) return [Math.round(x), Math.round(z)];
      var ux = d > 0.01 ? (x - ip.x) / d : Math.cos(ip.heading);
      var uz = d > 0.01 ? (z - ip.z) / d : -Math.sin(ip.heading);
      return [Math.round(ip.x + ux * 11), Math.round(ip.z + uz * 11)];
    }
    var half = (GAME.city.ROAD_HALF || 6) + 3;
    var lanes = [-450, -350, -250, -150, -50, 50, 150, 250, 350];
    for (var i = 0; i < lanes.length; i++) {
      if (Math.abs(x - lanes[i]) < half) x = lanes[i] + (x >= lanes[i] ? half : -half);
      if (Math.abs(z - lanes[i]) < half) z = lanes[i] + (z >= lanes[i] ? half : -half);
    }
    return [Math.round(x), Math.round(z)];
  }

  // how far out this level's calls are: ramps with the level and then plateaus.
  // A cab works a wider band so fares aren't all short hops.
  function targetBand() {
    var kind = active.def.id, lv = active.level;
    var minR = kind === 'ambulance' ? Math.min(55 + (lv - 1) * 22, 210) : Math.min(80 + (lv - 1) * 20, 230);
    var maxR = kind === 'ambulance' ? Math.min(minR + 95, 330) : Math.min(minR + 170, 400);
    return [minR, maxR];
  }

  // Where a fare wants to go. It was a fixed 90–210 m band, so every ride was
  // the same two blocks whatever else changed — the band opens up with the
  // level, and each individual fare draws its own leg inside it, so a shift is
  // a mix of short hops and long runs rather than one distance repeated.
  function dropBand() {
    var lv = active.level;
    var minR = Math.min(70 + (lv - 1) * 45, 320);
    var maxR = Math.min(minR + 180 + (lv - 1) * 60, 900);
    // each fare picks its own slice of that band
    var lo = U.randRange(Math.random, minR, minR + (maxR - minR) * 0.62);
    return [lo, U.randRange(Math.random, lo + 45, maxR)];
  }

  // one level of the shift: more people, spread further out, each level
  function startRound() {
    var kind = active.def.id;
    var lv = active.level;
    var count = kind === 'ambulance' ? Math.min(lv, 5) : 1;
    var band = targetBand(), minR = band[0], maxR = band[1];
    var P = GAME.player;
    var ox = P.car ? P.car.pos.x : P.pos.x, oz = P.car ? P.car.pos.z : P.pos.z;
    active.targets = [];
    for (var i = 0; i < count; i++) {
      var pt = null;
      // keep the pickups spread apart so it's a real route, not one clump
      for (var tries = 0; tries < 14; tries++) {
        var c = randomRoadPoint(ox, oz, minR, maxR);
        var ok = true;
        for (var j = 0; j < active.targets.length; j++) {
          if (U.dist2(c[0], c[1], active.targets[j].x, active.targets[j].z) < 60 * 60) { ok = false; break; }
        }
        if (ok) { pt = c; break; }
      }
      if (!pt) pt = randomRoadPoint(ox, oz, minR, maxR);
      // the marker is where the vehicle pulls up; the person waits on the
      // pavement beside it and walks over once you stop
      var wp = kerbWaitSpot(pt[0], pt[1]);
      active.targets.push({ x: pt[0], z: pt[1], ped: spawnWaitingPed(wp[0], wp[1]), boarding: false });
    }
    active.phase = 'pickup';
    active.aboard = 0;
    active.routeCp = null;
  }

  // a spot on the pavement beside the pickup marker, pushed clear of the
  // carriageway on the same side of the road and jittered along the kerb
  function kerbWaitSpot(x, z) {
    var rp = GAME.city.nearestRoadPoint(x, z);
    var out = 14, jitter = U.randRange(Math.random, -5, 5);
    var wx, wz;
    if (rp.axis === 'net') {       // a curved road: step out along its normal
      var sgn = U.dist2(x, z, rp.x + Math.cos(rp.heading), rp.z - Math.sin(rp.heading)) <
        U.dist2(x, z, rp.x - Math.cos(rp.heading), rp.z + Math.sin(rp.heading)) ? 1 : -1;
      wx = rp.x + Math.cos(rp.heading) * out * sgn + Math.sin(rp.heading) * jitter;
      wz = rp.z - Math.sin(rp.heading) * out * sgn + Math.cos(rp.heading) * jitter;
    } else if (rp.axis === 'z') {          // road runs along z; step out in x
      wx = rp.x + (x >= rp.x ? out : -out);
      wz = z + jitter;
    } else {                        // road runs along x; step out in z
      wx = x + jitter;
      wz = rp.z + (z >= rp.z ? out : -out);
    }
    var s = GAME.resolveCircle(wx, wz, 0.5);
    return [s.x, s.z];
  }

  // someone standing at the kerb waiting — arm raised, and they stay put
  // (state 'wait' is handled by no movement branch in peds.update)
  function spawnWaitingPed(x, z) {
    var ped = GAME.peds.spawnPed(x, z);
    ped.jobPed = true;
    ped.state = 'wait';
    ped.speed = 0;
    var j = ped.mesh.userData.joints;
    j.armR.rotation.x = -2.6;   // hailing / calling for help
    j.armR.rotation.z = 0.3;
    return ped;
  }

  // the floating marker that hovers over whoever is waiting for you
  function makeArrow() {
    var g = new THREE.ConeGeometry(0.45, 1.0, 4);
    g.rotateX(Math.PI);           // point the tip down at their head
    var m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffe14f }));
    GAME.scene.add(m);
    return m;
  }
  function dropArrow(t) {
    if (!t || !t.arrow) return;
    GAME.scene.remove(t.arrow);
    disposeTree(t.arrow);
    t.arrow = null;
  }
  // if a fare or patient is killed (run over, caught in a blast) the call is
  // reassigned somewhere else — you're never left waiting at a marker for
  // someone who can't come
  function replaceLostTargets() {
    var kind = active.def.id;
    if (kind === 'icecream') {
      // nobody on this job was called out, so nobody is owed a replacement
      for (var w = 0; w < active.targets.length; w++) {
        var wt = active.targets[w];
        if (!wt.ped || wt.ped.dead || GAME.world.peds.indexOf(wt.ped) < 0) {
          dropArrow(wt); active.targets.splice(w--, 1);
        }
      }
      return;
    }
    for (var i = 0; i < active.targets.length; i++) {
      var t = active.targets[i];
      var gone = !t.ped || t.ped.dead || GAME.world.peds.indexOf(t.ped) < 0;
      if (!gone) continue;
      dropArrow(t);

      var f = GAME.focus();
      var band = targetBand();
      var pt = randomRoadPoint(f.x, f.z, band[0], band[1]);
      var wp = kerbWaitSpot(pt[0], pt[1]);
      t.x = pt[0]; t.z = pt[1];
      t.ped = spawnWaitingPed(wp[0], wp[1]);
      t.boarding = false;
      active.routeCp = null;
      updateCp();
      GAME.hud.message(kind === 'ambulance'
        ? 'You lost that patient — a new call is marked.'
        : 'That fare is gone — a new pickup is marked.', 3);
    }
  }

  // bob and spin each arrow above its person
  function updateArrows(dt) {
    if (!active || !active.targets) return;
    for (var i = 0; i < active.targets.length; i++) {
      var t = active.targets[i];
      if (!t.ped || t.ped.dead) { dropArrow(t); continue; }
      if (!t.arrow) t.arrow = makeArrow();
      t.arrow.position.set(t.ped.pos.x, t.ped.pos.y + 2.75 + Math.sin(GAME.time * 3 + i) * 0.18, t.ped.pos.z);
      t.arrow.rotation.y += dt * 2.2;
    }
  }

  // walk anyone who's been hailed over to the vehicle and load them in
  function stepBoarding(dt, f, P) {
    for (var i = active.targets.length - 1; i >= 0; i--) {
      var t = active.targets[i];
      if (!t.boarding) continue;
      var ped = t.ped;
      if (!ped || ped.dead) { t.boarding = false; continue; }
      // drove off again — they go back to waiting
      if (U.dist2(f.x, f.z, t.x, t.z) > 40 * 40) { t.boarding = false; continue; }
      var dx = f.x - ped.pos.x, dz = f.z - ped.pos.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d < 2.2) { collectTarget(t); continue; }
      ped.heading = Math.atan2(dx, dz);
      ped.speed = 4.2;
      ped.pos.x += Math.sin(ped.heading) * ped.speed * dt;
      ped.pos.z += Math.cos(ped.heading) * ped.speed * dt;
      var rp = GAME.resolveCircle(ped.pos.x, ped.pos.z, 0.4);
      ped.pos.x = rp.x; ped.pos.z = rp.z;
      ped.pos.y = GAME.city.groundY(ped.pos.x, ped.pos.z);
      ped.mesh.rotation.y = ped.heading;
      // running animation while they hurry over
      ped.walkPhase += ped.speed * dt * 3;
      var j = ped.mesh.userData.joints;
      var sw = Math.sin(ped.walkPhase) * 0.9;
      j.legL.rotation.x = sw; j.legR.rotation.x = -sw;
      j.armL.rotation.x = -sw; j.armR.rotation.set(sw, 0, 0);
    }
  }

  function nearestTarget() {
    if (!active.targets.length) return null;
    var f = GAME.focus(), best = active.targets[0], bd = 1e18;
    for (var i = 0; i < active.targets.length; i++) {
      var d = U.dist2(f.x, f.z, active.targets[i].x, active.targets[i].z);
      if (d < bd) { bd = d; best = active.targets[i]; }
    }
    return best;
  }

  // hospital drop-off: the ambulance bay apron, clear of both the parking spot
  // and any traffic lane (patients were being unloaded in the middle of a road)
  function hospitalDropoff(f) {
    var hs = GAME.city.pois.hospitals, best = null, bd = 1e18;
    var here = GAME.city.islandIdAt(f.x, f.z);
    for (var hi = 0; hi < hs.length; hi++) {
      // the run stays on this landmass — a shift never sends you over a bridge
      if (GAME.city.islandIdAt(hs[hi].x, hs[hi].z) !== here) continue;
      var dd = U.dist2(f.x, f.z, hs[hi].x, hs[hi].z);
      if (dd < bd) { bd = dd; best = hs[hi]; }
    }
    best = best || hs[0];
    return clearOfRoad(best.x + 30, best.spawn.z);
  }

  // collect whoever is at this stop
  function collectTarget(tgt) {
    if (active.def.id === 'icecream') { iceCreamSale(tgt); return; }
    var i = active.targets.indexOf(tgt);
    if (i >= 0) active.targets.splice(i, 1);
    dropArrow(tgt);
    if (tgt.ped && !tgt.ped.dead) GAME.peds.removePed(tgt.ped);
    active.aboard++;
    GAME.audio.pickup();
    var kind = active.def.id;
    var who = kind === 'ambulance' ? 'Patient' : 'Fare';
    // head for the drop-off once we're full or there's nobody else left
    if (active.aboard >= active.capacity || !active.targets.length) {
      active.phase = 'dropoff';
      var db = dropBand();
      active.dropoff = kind === 'ambulance' ? hospitalDropoff(GAME.focus())
        : randomRoadPoint(GAME.focus().x, GAME.focus().z, db[0], db[1]);
      GAME.hud.message(who + ' aboard (' + active.aboard + '/' + active.capacity + ') — ' +
        (kind === 'ambulance' ? 'get to the hospital!' : 'to the drop-off!'), 2.6);
    } else {
      GAME.hud.message(who + ' aboard (' + active.aboard + '/' + active.capacity + ') — ' +
        active.targets.length + ' more waiting', 2.6);
    }
    active.routeCp = null;
    updateCp();
    GAME.hud.missionObjective(objectiveText());
  }

  // everyone aboard is delivered: pay out, then either go back for the rest of
  // this level's people or move up a level
  function completeFare(kind, f, tgt) {
    var n = active.aboard;
    active.jobCount += n;
    var per = (kind === 'ambulance' ? 180 : 130) + active.level * 15;
    var fare = per * n;
    GAME.addCash(fare); active.earned += fare;
    GAME.audio.sting('win');
    for (var i = 0; i < n; i++) {
      var out = GAME.peds.spawnPed(tgt[0] + (i - n / 2) * 1.4, tgt[1] + 1.5);
      out.state = 'flee'; out.fleeT = 3.5; out.fleeX = f.x; out.fleeZ = f.z;
    }
    active.aboard = 0;
    var word = kind === 'ambulance' ? (n > 1 ? n + ' patients delivered' : 'Patient delivered') : 'Fare dropped';
    var msg = word + '! +$' + fare;
    active.timeLeft = Math.min(active.timeLeft + (kind === 'ambulance' ? 45 : 50) + n * 12, 190);

    if (active.targets.length) {
      // still people waiting on this level — go back out for them
      active.phase = 'pickup';
      GAME.hud.message(msg + '  ·  ' + active.targets.length + ' still waiting — go back', 3.4);
    } else {
      active.level++;
      var bonus = 100 * (active.level - 1);
      GAME.addCash(bonus); active.earned += bonus;
      msg += '   —   LEVEL ' + active.level + '!  bonus +$' + bonus;
      if (active.level % 5 === 0) {
        var streak = 250 * (active.level / 5);
        GAME.addCash(streak); active.earned += streak;
        msg += '  ·  STREAK +$' + streak;
      }
      GAME.hud.message(msg, 4);
      startRound();
    }
    active.routeCp = null;
    updateCp();
    GAME.hud.missionObjective(objectiveText());
  }

  // end an ongoing taxi/ambulance shift (clock off, totalled, or timed out)
  function endJob(reason) {
    var count = active.jobCount, earned = active.earned, lv = active.level;
    var unit = active.def.id === 'ambulance' ? 'patient' : active.def.id === 'icecream' ? 'sale' : 'fare';
    // send any waiting people home with the shift. Someone who only wandered
    // over for an ice cream was an ordinary passer-by a minute ago, so they get
    // to carry on being one rather than vanishing off the pavement.
    for (var i = 0; i < active.targets.length; i++) {
      dropArrow(active.targets[i]);
      var tp2 = active.targets[i].ped;
      if (!tp2 || tp2.dead) continue;
      if (active.targets[i].walkUp) { tp2.jobPed = false; tp2.state = 'walk'; }
      else GAME.peds.removePed(tp2);
    }
    active.targets = [];
    if (count > 0) {
      GAME.audio.sting('win');
      GAME.hud.message('SHIFT OVER — level ' + lv + ', ' + count + ' ' + unit + (count === 1 ? '' : 's') +
        ', $' + earned + ' earned' + (reason ? '  (' + reason + ')' : ''), 4.5);
      var id = active.def.id;
      var CARD = {
        ambulance: { slug: 'paramedic-shift', eyebrow: 'PARAMEDIC', sub: 'Costa Rosa General — patients delivered', accent: '#ff4d6a', unit: 'Patients' },
        taxifare: { slug: 'taxi-shift', eyebrow: 'TAXI DRIVER', sub: 'Costa Rosa cabs — fares run', accent: '#f0c020', unit: 'Fares' },
        icecream: { slug: 'icecream-round', eyebrow: 'ICE CREAM ROUND', sub: 'Isla Verde — the chimes did their work', accent: '#ffd7e4', unit: 'Sales' }
      }[id] || { slug: id, eyebrow: 'SHIFT', sub: '', accent: '#38e8ff', unit: 'Jobs' };
      GAME.track('job-completed-' + id);
      GAME.share.show({
        slug: CARD.slug, eyebrow: CARD.eyebrow, title: 'SHIFT OVER', subtitle: CARD.sub,
        accent: CARD.accent,
        stats: [
          { label: 'Level', value: String(lv) },
          { label: CARD.unit, value: String(count) },
          { label: 'Earned', value: '$' + earned }
        ]
      });
    } else {
      GAME.hud.message('Shift over.' + (reason ? ' ' + reason + '.' : ''), 2.5);
    }
    cleanup();
  }

  // seed a crowd + traffic around the player so a rampage always has targets
  function spawnRampageTargets(nPeds, nCars) {
    var f = GAME.focus();
    var px = f.x, pz = f.z;
    for (var i = 0; i < nPeds; i++) {
      var a = Math.random() * Math.PI * 2, r = U.randRange(Math.random, 7, 34);
      var x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
      if (GAME.city.isInWater(x, z)) continue;
      var rp = GAME.resolveCircle(x, z, 0.5);
      GAME.peds.spawnPed(rp.x, rp.z);
    }
    var types = ['sedan', 'taxi', 'sports', 'van'];
    for (var c = 0; c < nCars; c++) {
      var a2 = Math.random() * Math.PI * 2, r2 = U.randRange(Math.random, 12, 40);
      var rp2 = GAME.city.nearestRoadPoint(px + Math.cos(a2) * r2, pz + Math.sin(a2) * r2);
      if (GAME.city.isInWater(rp2.x, rp2.z)) continue;
      GAME.vehicles.spawnCar(types[Math.floor(Math.random() * types.length)], rp2.x, rp2.z,
        Math.random() * Math.PI * 2,
        { occupied: 'ai', ai: { mode: 'traffic', desired: U.randRange(Math.random, 7, 11), laneX: 0, laneZ: 0 } });
    }
  }

  function start(def) {
    var P = GAME.player;
    GAME.track('mission-started-' + def.type);
    active = {
      def: def, t: 0, cpIndex: 0, score: 0,
      timeLeft: def.time || 0, racers: [], state: 'countdown', countdown: def.type === 'race' ? 3.2 : 0,
      // a fresh set of drops every time you take the run
      stops: def.type === 'courier' ? rollCourierStops(def) : null
    };
    if (def.type === 'race') {
      for (var i = 0; i < 3; i++) {
        var off = (i + 1) * 5;
        var rx = def.start.x - Math.sin(P.car.heading) * off + Math.cos(P.car.heading) * (i % 2 ? 3.5 : -3.5);
        var rz = def.start.z - Math.cos(P.car.heading) * off - Math.sin(P.car.heading) * (i % 2 ? 3.5 : -3.5);
        var car = GAME.vehicles.spawnCar('sports', rx, rz, P.car.heading, { occupied: 'ai', ai: { mode: 'race' }, mission: true, color: [0xffe14f, 0xb040ff, 0x38e8ff][i] });
        car.cpIndex = 0;
        // rivals shrug off scrapes — a race should be decided on the road, not by
        // one of them cooking off against a lamp post
        car.hp = car.spec.hp * 5;
        active.racers.push(car);
      }
      GAME.hud.message('3...', 1);
      setTimeout(function () { if (active) GAME.hud.message('2...', 1); }, 1000);
      setTimeout(function () { if (active) GAME.hud.message('1...', 1); }, 2000);
      setTimeout(function () { if (active) { GAME.hud.message('GO!', 1); } }, 3000);
    } else if (def.type === 'rampage') {
      // the rampage arsenal is on loan — remember it so it can be reclaimed at the
      // end (otherwise the marker is a free-ammo dispenser on repeat)
      active.grantWeapon = def.weapon;
      active.grantAmmo = def.ammo;
      active.grantHad = !!(P.weapons[def.weapon] && P.weapons[def.weapon].have);
      GAME.combat.giveWeapon(def.weapon, def.ammo);
      active.state = 'run';
      active.topupT = 0;
      spawnRampageTargets(14, 6);
      GAME.hud.message('Cause $' + def.target + ' of mayhem! Wreck cars and crowds.', 3.5);
    } else {
      active.state = 'run';
      GAME.hud.message('First delivery is marked. Go!', 3);
    }
    setMarkersVisible(false);
    GAME.hud.missionStart(def.name, objectiveText());
    GAME.audio.pickup();
    updateCp();
  }

  // race position: further along the checkpoint list wins, ties broken by who's
  // closer to the next one. Returns 1-based place among player + rivals.
  function racePosition() {
    if (!active || active.def.type !== 'race') return 1;
    var d = active.def, P = GAME.player;
    var px = P.car ? P.car.pos.x : P.pos.x, pz = P.car ? P.car.pos.z : P.pos.z;
    var pcp = d.cps[Math.min(active.cpIndex, d.cps.length - 1)];
    var pd = U.dist2(px, pz, pcp[0], pcp[1]);
    var place = 1;
    for (var i = 0; i < active.racers.length; i++) {
      var r = active.racers[i];
      if (r.dead) continue;
      var ri = r.cpIndex || 0;
      if (ri > active.cpIndex) { place++; continue; }
      if (ri < active.cpIndex) continue;
      var rcp = d.cps[Math.min(ri, d.cps.length - 1)];
      if (U.dist2(r.pos.x, r.pos.z, rcp[0], rcp[1]) < pd) place++;
    }
    return place;
  }
  function ordinal(n) { return n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'); }

  function objectiveText() {
    if (!active) return '';
    var d = active.def;
    if (d.type === 'race') {
      var field = 1 + active.racers.filter(function (r) { return !r.dead; }).length;
      return ordinal(racePosition()) + ' / ' + field + '   ·   Checkpoint ' + (active.cpIndex + 1) + ' / ' + d.cps.length;
    }
    if (d.type === 'courier') return 'Delivery ' + (active.cpIndex + 1) + ' / ' + active.stops.length;
    if (d.type === 'icecream') {
      return 'Round ' + active.level + '  ·  sold ' + active.sales + ' / ' + active.quota +
        (active.pitch ? '  ·  crowd marked' : '  ·  find a crowd') +
        '  ·  $' + active.earned + ' taken';
    }
    if (d.type === 'taxifare' || d.type === 'ambulance') {
      var amb = d.type === 'ambulance';
      var head = active.phase === 'pickup'
        ? (amb ? 'Collect patient' : 'Pick up the fare') + (active.targets.length > 1 ? ' (' + active.targets.length + ' waiting)' : '')
        : (amb ? 'To the hospital' : 'To the drop-off');
      var load = active.capacity > 1 ? '  ·  aboard ' + active.aboard + '/' + active.capacity : '';
      return 'Lv ' + active.level + '  ·  ' + head + load + '  ·  ' + active.jobCount + ' done';
    }
    return '$' + Math.floor(active.score) + ' / $' + d.target;
  }

  function currentCp() {
    var d = active.def;
    if (d.type === 'race') return d.cps[active.cpIndex] || null;
    if (d.type === 'courier') return active.stops[active.cpIndex] || null;
    if (d.type === 'taxifare' || d.type === 'ambulance') {
      if (active.phase !== 'pickup') return active.dropoff;
      var t = nearestTarget();
      return t ? [t.x, t.z] : null;
    }
    if (d.type === 'icecream') return active.pitch || null;
    return null;
  }

  function updateCp() {
    if (!active || active.def.type === 'rampage') { if (cpMarker) cpMarker.visible = false; return; }
    var cp = currentCp();
    if (cp) {
      cpMarker.visible = true;
      cpMarker.position.set(cp[0], GAME.city.groundY(cp[0], cp[1]) + 1.7, cp[1]);
    } else cpMarker.visible = false;
  }

  function setMarkersVisible(v) {
    for (var i = 0; i < markers.length; i++) markers[i].mesh.visible = v;
  }

  function finish(win, reason) {
    var d = active.def;
    var reward = active.reward || d.reward || 0;
    if (win) {
      var value = d.type === 'rampage' ? Math.floor(active.score) : Math.round(active.t * 10) / 10;
      var bests = GAME.bests || (GAME.bests = {});
      var prev = bests[bestKey(d)];
      var isBest = d.type === 'rampage' ? (!prev || value > prev) : (!prev || value < prev);
      if (isBest) bests[bestKey(d)] = value;
      GAME.addCash(reward);
      // finishing enough work is what opens the channel
      var opened = GAME.isla && GAME.isla.checkUnlock();
      GAME.audio.sting('win');
      var head = d.job ? 'JOB DONE! +$' : 'MISSION PASSED! +$';
      // races report the finishing place and time alongside the payout
      if (d.type === 'race') {
        var field = 1 + active.racers.length;
        head = 'RACE WON — 1st / ' + field + '  ·  ' + value.toFixed(1) + 's  ·  +$';
      }
      GAME.hud.message(head + reward + (isBest ? '  ·  NEW BEST!' : ''), 4.5);
      GAME.track('mission-completed-' + d.type);
      // a finished run is worth showing off — the card carries the numbers
      var cardStats = [{ label: 'Reward', value: '$' + reward }];
      if (d.type === 'race') {
        cardStats.unshift({ label: 'Place', value: '1st / ' + (1 + active.racers.length) });
        cardStats.push({ label: 'Time', value: value.toFixed(1) + 's' });
      } else if (d.type === 'rampage') {
        cardStats.push({ label: 'Mayhem', value: '$' + value });
      } else {
        cardStats.push({ label: 'Time', value: value.toFixed(1) + 's' });
      }
      if (isBest) cardStats.push({ label: 'Result', value: 'NEW BEST' });
      if (opened) return cleanup();     // the bridges card takes the screen
      GAME.share.show({
        slug: d.id,
        eyebrow: TYPE_LABEL[d.type] || 'COSTA ROSA · 1986',
        title: d.type === 'race' ? 'RACE WON' : 'MISSION PASSED',
        subtitle: d.name,
        accent: d.type === 'race' ? '#ff8a3d' : d.type === 'rampage' ? '#ff4fa3' : '#38e8ff',
        stats: cardStats
      });
    } else {
      GAME.audio.sting('wasted');
      var tail = '';
      if (d.type === 'race') {
        var f2 = 1 + active.racers.length;
        // abandoning the car is a DNF — don't credit a position you walked away from
        tail = (GAME.player.inCar && GAME.player.car && !GAME.player.car.dead)
          ? '  ·  finished ' + ordinal(racePosition()) + ' / ' + f2
          : '  ·  DNF';
      }
      GAME.hud.message('MISSION FAILED — ' + reason + tail, 4);
    }
    cleanup();
  }

  function cleanup() {
    if (active) {
      for (var i = 0; i < active.racers.length; i++) GAME.vehicles.removeCar(active.racers[i]);
      if (active.targets) {
        for (var ti = 0; ti < active.targets.length; ti++) {
          var tp = active.targets[ti].ped;
          dropArrow(active.targets[ti]);
          if (!tp || tp.dead) continue;
          if (active.targets[ti].walkUp) { tp.jobPed = false; tp.state = 'walk'; }
          else GAME.peds.removePed(tp);
        }
      }
      // reclaim the rampage loadout so the marker can't be farmed for ammo
      if (active.grantWeapon) {
        var inv = GAME.player.weapons[active.grantWeapon];
        if (inv) {
          inv.ammo = Math.max(0, inv.ammo - (active.grantAmmo || 0));
          if (!active.grantHad && inv.ammo <= 0) inv.have = false;
          if (GAME.player.currentWeapon === active.grantWeapon && !inv.have) GAME.player.currentWeapon = 'fist';
        }
        GAME.combat.refreshWeaponHud();
      }
    }
    active = null;
    cpMarker.visible = false;
    setMarkersVisible(true);
    GAME.hud.missionEnd();
    GAME.save();
  }

  function failActive(reason) {
    if (active) finish(false, reason);
  }

  function notifyChaos(pts) {
    if (active && active.def.type === 'rampage' && active.state === 'run') {
      active.score += pts;
      GAME.hud.missionObjective(objectiveText());
    }
  }

  function racerControls(car, dt) {
    var d = active.def;
    var cp = d.cps[Math.min(car.cpIndex, d.cps.length - 1)];
    if (U.dist2(car.pos.x, car.pos.z, cp[0], cp[1]) < 144) {
      car.cpIndex++;
      if (car.cpIndex >= d.cps.length) return null; // finished
      cp = d.cps[car.cpIndex];
      car.path = null;
    }
    // rivals drive the streets to the next checkpoint. Beelining at a diagonal
    // checkpoint just parks them against a building, which is what made the
    // field look slow — they were stuck, not slow.
    car.pathT = (car.pathT || 0) - dt;
    if (!car.path || !car.path.length || car.pathT <= 0) {
      car.pathT = 2.5;
      var nodes = GAME.nav.roadPath(car.pos.x, car.pos.z, cp[0], cp[1]);
      var pts = [];
      for (var i = 0; i < nodes.length; i++) pts.push([nodes[i].x, nodes[i].z]);
      pts.push(cp);
      var toCp = U.dist2(car.pos.x, car.pos.z, cp[0], cp[1]);
      // drop leading nodes we're already on top of, or that would send us
      // backwards away from the checkpoint (the nearest node can be behind us)
      while (pts.length > 1 && (U.dist2(car.pos.x, car.pos.z, pts[0][0], pts[0][1]) < 400 ||
        U.dist2(pts[0][0], pts[0][1], cp[0], cp[1]) > toCp)) pts.shift();
      car.path = pts;
    }
    var tgt = car.path[0];
    if (car.path.length > 1 && U.dist2(car.pos.x, car.pos.z, tgt[0], tgt[1]) < 256) {
      car.path.shift();
      tgt = car.path[0];
    }
    var dx = tgt[0] - car.pos.x, dz = tgt[1] - car.pos.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    var dh = U.wrapPI(Math.atan2(dx, dz) - car.heading);
    // committed on the straights, but genuinely brake for corners — flat-out
    // into a junction just puts them into a wall
    var ad = Math.abs(dh);
    var throttle = 1;
    if (ad > 1.0 && Math.abs(car.speed) > 16) throttle = -0.5;
    else if (ad > 0.55) throttle = 0.45;
    else if (ad > 0.3) throttle = 0.78;
    // ease off on the approach so they arrive at a sane speed
    else if (dist < 26 && Math.abs(car.speed) > 30) throttle = 0.5;
    // two-way rubber band: leaders ease a little, stragglers get a push, so the
    // pack stays on your bumper instead of falling away
    var lead = car.cpIndex - active.cpIndex;
    if (lead > 0) throttle *= 0.94;
    else if (lead < 0) throttle = Math.min(1, throttle * 1.16);
    // the handbrake is for genuine hairpins only; using it mid-corner spins them
    var handbrake = ad > 1.5 && Math.abs(car.speed) > 30;

    // look ahead and lift for anything in the way — rivals shouldn't win by
    // shunting the player off the start line
    var fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    var look = 6 + Math.abs(car.speed) * 0.55;
    var steerBias = 0;
    var cars = GAME.world.cars;
    for (var oi = 0; oi < cars.length; oi++) {
      var o = cars[oi];
      if (o === car || o.dead) continue;
      var odx = o.pos.x - car.pos.x, odz = o.pos.z - car.pos.z;
      var fd = odx * fx + odz * fz;
      if (fd < 0.5 || fd > look) continue;
      if (Math.abs(odx * fz - odz * fx) > 2.8) continue;
      throttle = fd < look * 0.45 ? -0.6 : Math.min(throttle, 0);
      // ease around rather than sitting on their bumper
      steerBias = (odx * fz - odz * fx) > 0 ? -0.45 : 0.45;
      break;
    }
    if (Math.abs(car.speed) < 1) { car.unstickT = (car.unstickT || 0) + dt; } else car.unstickT = 0;
    if (car.unstickT > 1.5) car.reverseT = 0.9;
    if (car.reverseT > 0) { car.reverseT -= dt; return { throttle: -1, steer: dh > 0 ? -1 : 1, handbrake: false }; }
    return { throttle: throttle, steer: U.clamp(dh * 2.6 + steerBias, -1, 1), handbrake: handbrake };
  }

  function update(dt) {
    resprayCooldown -= dt;
    var P = GAME.player;
    var t = GAME.time;
    // pulse markers
    for (var i = 0; i < markers.length; i++) {
      if (markers[i].mesh.visible) {
        markers[i].mesh.material.opacity = 0.3 + 0.15 * Math.sin(t * 3 + i);
        markers[i].mesh.rotation.y += dt * 0.6;
      }
    }
    if (cpMarker.visible) cpMarker.material.opacity = 0.35 + 0.2 * Math.sin(t * 4);

    checkRespray();

    if (!active) {
      if (P.state !== 'alive') return;
      // taxi / ambulance jobs start from within the vehicle
      var jobKind = null;
      if (P.inCar && P.car) {
        if (P.car.type === 'taxi') jobKind = 'taxifare';
        else if (P.car.type === 'ambulance') jobKind = 'ambulance';
        else if (P.car.type === 'icecream') jobKind = 'icecream';
      }
      GAME.jobAvailable = jobKind;
      if (jobKind && (GAME.keyPressed('KeyJ') || GAME.input.touch.job)) {
        GAME.input.touch.job = false;
        startJob(jobKind);
        return;
      }
      var px = P.inCar ? P.car.pos.x : P.pos.x, pz = P.inCar ? P.car.pos.z : P.pos.z;
      var py = P.inCar ? P.car.pos.y : P.pos.y;
      // Everything below is a street-level prompt and every test for it looks
      // only at the ground plane, so flying over a marker reads as standing on
      // it. Set down first — a landed aircraft is close enough to count.
      if (py - GAME.city.groundY(px, pz) > 4) { GAME.hud.setPoiHint(''); return; }
      var hint = null;
      for (var m = 0; m < markers.length; m++) {
        var d = markers[m].def;
        if (!defAvailable(d)) { markers[m].mesh.visible = false; continue; }
        markers[m].mesh.visible = true;
        // races and courier deliveries need a vehicle; rampages can start on foot
        var need = d.type === 'race' || d.type === 'courier';
        var air = P.car && (P.car.spec.heli || P.car.spec.plane);
        var dd = U.dist2(px, pz, d.start.x, d.start.z);
        // name what the marker is (and what it wants) whenever you're standing near it
        if (dd < 34 * 34) {
          var label = TYPE_LABEL[d.type] + ' · ' + d.name;
          if (need && !P.inCar) label += '   —   come back in a vehicle';
          else if (d.type === 'race' && air) label += '   —   not in an aircraft';
          else if (dd < (need ? 20 : 7)) label += '   —   starting…';
          if (!hint || dd < hint.d) hint = { d: dd, text: label };
        }
        if (need && !P.inCar) continue;
        // no cheesing a street race from a helicopter or plane
        if (d.type === 'race' && air) continue;
        if (dd < (need ? 20 : 7)) {
          start(d);
          hint = null;
          break;
        }
      }
      // respray garages announce themselves the same way
      var doors = GAME.city.pois.resprays;
      for (var rg = 0; rg < doors.length; rg++) {
        var rd = U.dist2(px, pz, doors[rg].door.x, doors[rg].door.z);
        if (rd < 34 * 34 && (!hint || rd < hint.d)) {
          hint = { d: rd, text: 'RESPRAY · $100 — repairs your ride and clears the heat' + (P.inCar ? '' : '   —   drive in') };
        }
      }
      // and the shops share the one readout instead of talking over it
      var sh = GAME.shops && GAME.shops.nearHint(px, pz);
      if (sh && (!hint || sh.d < hint.d)) hint = sh;
      GAME.hud.setPoiHint(hint ? hint.text : '');
      return;
    }
    GAME.jobAvailable = null;
    GAME.hud.setPoiHint('');
    // J (or the JOB button) again clocks off an ongoing shift
    if (active.def.job && (GAME.keyPressed('KeyJ') || GAME.input.touch.job)) {
      GAME.input.touch.job = false;
      endJob('clocked off');
      return;
    }

    // active mission
    var d2 = active.def;
    active.t += dt;
    if (active.state === 'countdown') {
      active.countdown -= dt;
      if (P.car) { P.car.controls.throttle = 0; P.car.speed *= 0.9; }
      for (var r0 = 0; r0 < active.racers.length; r0++) active.racers[r0].controls = { throttle: 0, steer: 0, handbrake: true };
      if (active.countdown <= 0) { active.state = 'run'; active.t = 0; }
      return;
    }

    if (d2.type === 'race') {
      if (!P.inCar || !P.car || P.car.dead) { finish(false, 'You lost your ride.'); return; }
      for (var r = 0; r < active.racers.length; r++) {
        var rc = active.racers[r];
        if (rc.dead) continue;
        var ctl = racerControls(rc, dt);
        if (ctl === null) { finish(false, 'A rival finished first.'); return; }
        rc.controls = ctl;
      }
      var cp = currentCp();
      if (cp && U.dist2(P.car.pos.x, P.car.pos.z, cp[0], cp[1]) < 100) {
        active.cpIndex++;
        GAME.audio.pickup();
        if (active.cpIndex >= d2.cps.length) { finish(true); return; }
        GAME.hud.missionObjective(objectiveText());
        updateCp();
      }
      // keep the live position readout current
      if (GAME.frame % 12 === 0) GAME.hud.missionObjective(objectiveText());
      // draw the race line along the streets (checkpoints can be diagonal neighbors)
      active.routeT = (active.routeT || 0) - dt;
      if (active.routeT <= 0 || active.routeCp !== active.cpIndex) {
        active.routeT = 1.0; active.routeCp = active.cpIndex;
        var rc = P.car ? [P.car.pos.x, P.car.pos.z] : [P.pos.x, P.pos.z];
        var pts = [];
        for (var k = active.cpIndex; k < d2.cps.length; k++) {
          var seg = roadRoute(rc[0], rc[1], d2.cps[k][0], d2.cps[k][1]);
          for (var si = 0; si < seg.length; si++) pts.push(seg[si]);
          rc = d2.cps[k];
        }
        active.raceRoute = pts;
      }
      GAME.hud.missionTimer(active.t, false);
    } else if (d2.type === 'courier') {
      active.timeLeft -= dt;
      if (active.timeLeft <= 0) { finish(false, 'Out of time.'); return; }
      var px2 = P.inCar ? P.car.pos.x : P.pos.x, pz2 = P.inCar ? P.car.pos.z : P.pos.z;
      var stop = currentCp();
      if (stop && U.dist2(px2, pz2, stop[0], stop[1]) < 25) {
        active.cpIndex++;
        GAME.audio.pickup();
        if (active.cpIndex >= active.stops.length) { finish(true); return; }
        GAME.hud.message('Delivered! Next stop is marked.', 2);
        GAME.hud.missionObjective(objectiveText());
        active.routeCp = -1; // force route recompute for the new stop
        updateCp();
      }
      // road-route the line to the current stop so it follows streets
      active.routeT = (active.routeT || 0) - dt;
      if (active.routeT <= 0 || active.routeCp !== active.cpIndex) {
        active.routeT = 1.0; active.routeCp = active.cpIndex;
        var st2 = currentCp();
        active.courierRoute = st2 ? roadRoute(px2, pz2, st2[0], st2[1]) : null;
      }
      GAME.hud.missionTimer(active.timeLeft, true);
    } else if (d2.type === 'rampage') {
      active.timeLeft -= dt;
      GAME.hud.missionTimer(active.timeLeft, true);
      // keep a crowd around the player so there's always something to wreck
      active.topupT -= dt;
      if (active.topupT <= 0) {
        active.topupT = 3;
        var f = GAME.focus(), near = 0;
        for (var pi = 0; pi < GAME.world.peds.length; pi++) {
          var pd = GAME.world.peds[pi];
          if (!pd.dead && !pd.isCop && U.dist2(pd.pos.x, pd.pos.z, f.x, f.z) < 55 * 55) near++;
        }
        if (near < 8) spawnRampageTargets(9, 3);
      }
      if (active.score >= d2.target) { finish(true); return; }
      if (active.timeLeft <= 0) { finish(false, 'Time up — $' + Math.floor(active.score) + ' of $' + d2.target); return; }
    } else if (d2.type === 'icecream') {
      updateIceCream(dt, P);
    } else if (d2.type === 'taxifare' || d2.type === 'ambulance') {
      // clock off simply by leaving the vehicle; the shift also ends if it's totalled
      if (!P.inCar || !P.car) { endJob('clocked off'); return; }
      if (P.car.dead) { endJob('vehicle totalled'); return; }
      active.timeLeft -= dt;
      if (active.timeLeft <= 0) { endJob('out of time'); return; }
      var f = GAME.focus(), tgt = currentCp();
      if (active.phase === 'pickup') {
        replaceLostTargets();
        // stop on the marker and whoever is waiting will come to you
        var near = nearestTarget();
        if (near && U.dist2(f.x, f.z, near.x, near.z) < 90 && Math.abs(P.car.speed) < 5 && !near.boarding) {
          near.boarding = true;
          GAME.hud.message(d2.type === 'ambulance' ? 'Patient is coming — hold still.' : 'Your fare is coming over.', 2);
        }
        stepBoarding(dt, f, P);
      } else if (tgt && U.dist2(f.x, f.z, tgt[0], tgt[1]) < 38 && Math.abs(P.car.speed) < 4) {
        completeFare(d2.type, f, tgt);
      }
      updateArrows(dt);
      active.routeT = (active.routeT || 0) - dt;
      if (active.routeT <= 0 || active.routeCp !== active.phase) {
        active.routeT = 1.0; active.routeCp = active.phase;
        var jt = currentCp();
        active.courierRoute = jt ? roadRoute(f.x, f.z, jt[0], jt[1]) : null;
      }
      GAME.hud.missionTimer(active.timeLeft, true);
    }
  }

  function checkRespray() {
    var P = GAME.player;
    if (!P.inCar || !P.car || resprayCooldown > 0 || P.state !== 'alive') return;
    var doors = GAME.city.pois.resprays;
    var near = false;
    for (var i = 0; i < doors.length; i++) {
      if (U.dist2(P.car.pos.x, P.car.pos.z, doors[i].door.x, doors[i].door.z) <= 36) { near = true; break; }
    }
    if (!near) return;
    if (P.cash < 100) {
      GAME.hud.message('Respray costs $100 — you\'re short.', 2.5);
      resprayCooldown = 4;
      return;
    }
    GAME.addCash(-100);
    GAME.police.clearWanted();
    // works for any driven vehicle, motorcycles included: full repair + fresh paint
    var car = P.car;
    car.hp = car.spec.hp; car.stage = 0; car.spiked = false; car.fireFuse = 0;
    if (car.mesh.userData.bodyMesh) {
      car.mesh.userData.bodyMesh.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    }
    GAME.fx.flash(car.pos.x, 1.5, car.pos.z, 4);
    GAME.audio.pickup();
    GAME.hud.message('Resprayed & fully repaired — the heat is off.', 3);
    GAME.track('respray-used');
    resprayCooldown = 8;
  }

  return {
    DEFS: DEFS,
    get active() { return active; },
    // headless hooks, so the generators can be sampled without playing a shift
    testDropBand: function (lv) { var a = active; active = { level: lv, def: { id: 'taxifare' } }; var r = dropBand(); active = a; return r; },
    testRollCourier: rollCourierStops,
    testCollect: collectTarget,
    testStartRound: startRound,
    init: init,
    update: update,
    failActive: failActive,
    notifyChaos: notifyChaos,
    objectiveText: objectiveText,
    getRoutePoints: function () {
      if (!active || active.state === 'countdown') return null;
      if (active.def.type === 'race') return active.raceRoute || active.def.cps.slice(active.cpIndex);
      if (active.courierRoute) return active.courierRoute; // courier / taxi / ambulance
      return null;
    },
    // the immediate target marker (checkpoint / stop / pickup / drop-off)
    getObjectivePoint: function () {
      if (!active || active.state === 'countdown') return null;
      return currentCp();
    },
    getBlips: function () {
      var out = [];
      GAME.city.pois.resprays.forEach(function (g) {
        out.push({ x: g.door.x, z: g.door.z, color: '#c86bff', size: 4 });
      });
      if (!active) {
        for (var i = 0; i < markers.length; i++) {
          var d = markers[i].def;
          if (!defAvailable(d)) continue;
          out.push({ x: d.start.x, z: d.start.z, color: '#' + MARKER_COLORS[d.type].toString(16).padStart(6, '0'), size: 4 });
        }
      } else {
        // every waiting fare/patient shows on the map, not just the nearest
        if (active.targets) {
          for (var t = 0; t < active.targets.length; t++) {
            out.push({ x: active.targets[t].x, z: active.targets[t].z, color: '#ffe14f', size: 4 });
          }
        }
        if (cpMarker.visible) out.push({ x: cpMarker.position.x, z: cpMarker.position.z, color: '#ffe14f', size: 5 });
      }
      return out;
    }
  };
})();
