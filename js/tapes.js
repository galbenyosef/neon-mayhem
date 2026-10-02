// Lost tapes: thirty cassettes hidden over both islands — the mixtapes of a
// pirate DJ who broadcast off the end of the pier until the station was shut
// down. Down alleys between buildings, out at the end of the piers, on the
// sand, up on a couple of roofs, and over on Isla Verde. Nothing marks them on
// the map; close enough, the radar shows a glint. Each one pays, every ten pay
// more, and finding all thirty puts the DJ back on the air: TAPE DECK FM, on
// every car radio from then on.
//
// They are found, not hand-placed — seeded, so the same spots every visit —
// and each is known by where it stands, so a save remembers which it has.
GAME.tapes = (function () {
  var MAINLAND = 20, ISLA = 10;
  var MILESTONES = [[10, 5000], [20, 15000], [30, 50000]];
  var GRAB_R2 = 2.3 * 2.3, GLINT_R = 32;
  var list = [];                 // { id, x, y, z, isla, mesh, taken }
  var got = {}, paid = {};
  var geo = null, haloGeo = null, mat = null, haloMat = null;
  var scene = null;

  function count() { var n = 0; for (var i = 0; i < list.length; i++) if (got[list[i].id]) n++; return n; }
  function total() { return list.length; }

  // Somewhere a person could stand and pick something up: on dry land (or a
  // pier or jetty), and not inside anything.
  function standable(x, z, y) {
    var C = GAME.city;
    if (C.isInWater(x, z, y)) return false;
    var bx = C.hash.query(x, z, 1.2);
    for (var i = 0; i < bx.length; i++) {
      var b = bx[i];
      if (b.h !== undefined && b.h <= y + 0.3) continue;
      if (b.minY !== undefined && b.minY > y + 2.2) continue;
      if (x > b.minX - 0.8 && x < b.maxX + 0.8 && z > b.minZ - 0.8 && z < b.maxZ + 0.8) return false;
    }
    return true;
  }
  function add(x, z, y, isla) {
    list.push({ id: (isla ? 'i' : 'm') + Math.round(x) + '_' + Math.round(z), x: x, y: y, z: z, isla: !!isla, mesh: null, taken: false });
  }
  function farFromAll(x, z, d) {
    for (var i = 0; i < list.length; i++) if (U.dist2(x, z, list[i].x, list[i].z) < d * d) return false;
    return true;
  }
  // An alley: off the road, out of the way, with buildings close on more than
  // one side. Scanned on a lattice and taken in a seeded shuffle, spaced out.
  function alleys(onIsla, want, spacing, rng) {
    var C = GAME.city, I = GAME.isla, cands = [];
    var x0 = onIsla ? 700 : -480, x1 = onIsla ? 1560 : 380, z0 = onIsla ? -560 : -480, z1 = onIsla ? 600 : 480;
    for (var x = x0; x <= x1; x += 8) {
      for (var z = z0; z <= z1; z += 8) {
        var isl = !!(I && I.contains(x, z));
        if (isl !== onIsla || C.isInWater(x, z)) continue;
        cands.push([x, z]);
      }
    }
    for (var k = cands.length - 1; k > 0; k--) {
      var m = Math.floor(rng() * (k + 1)), t = cands[k]; cands[k] = cands[m]; cands[m] = t;
    }
    var n = 0;
    for (var c = 0; c < cands.length && n < want; c++) {
      var px = cands[c][0], pz = cands[c][1];
      if (!farFromAll(px, pz, spacing)) continue;
      if (C.inAirport(px, pz) || C.rampAt(px, pz) || C.nearCrossing(px, pz, 14)) continue;
      var rp = C.nearestRoadPoint(px, pz);
      if (U.dist2(px, pz, rp.x, rp.z) < 11 * 11) continue;
      var gy = C.groundY(px, pz);
      if (!standable(px, pz, gy)) continue;
      // tucked in: buildings close by on two sides or more
      var near = C.hash.query(px, pz, 14), blocks = 0;
      for (var b = 0; b < near.length; b++) if (near[b].tag === 'building' && near[b].h > gy + 3) blocks++;
      if (blocks < 2) continue;
      add(px, pz, gy, onIsla);
      n++;
    }
  }
  function place() {
    var C = GAME.city, rng = mulberry32(1986);
    // out at the end of both piers
    [[500, 250], [466, -180]].forEach(function (p) {
      if (C.isOnPier(p[0], p[1])) add(p[0], p[1], C.groundY(p[0], p[1]), false);
    });
    // on the sand, far up and far down the beach
    [440, -440].forEach(function (z) {
      var x = C.shoreline(z) - 9;
      if (standable(x, z, C.groundY(x, z))) add(x, z, C.groundY(x, z), false);
    });
    // up on two flat roofs, for anybody with a helicopter
    var roofs = C.hash.all.filter(function (b) {
      if (b.tag !== 'building' || b.h === undefined || b.h < 7 || b.h > 16 || b.minY !== undefined) return false;
      var cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      if (GAME.isla && GAME.isla.contains(cx, cz)) return false;
      return b.maxX - b.minX >= 14 && b.maxZ - b.minZ >= 14 && C.surfaceY(cx, cz) <= b.h + 0.05;
    });
    for (var r = 0, nr = 0; r < roofs.length && nr < 2; r++) {
      var B = roofs[Math.floor(rng() * roofs.length)];
      var bx = (B.minX + B.maxX) / 2, bz = (B.minZ + B.maxZ) / 2;
      if (!farFromAll(bx, bz, 150)) continue;
      add(bx, bz, B.h, false);
      nr++;
    }
    alleys(false, MAINLAND - list.length, 70, rng);
    if (!GAME.isla || !GAME.isla.pois) return;
    // Isla Verde: the lighthouse, the end of the marina's outer jetty, the
    // summit pad, the cove — and alleys in the port town for the rest
    var P = GAME.isla.pois(), start = list.length;
    function islaSpot(x, z) {
      var y = C.surfaceY(x, z, C.groundY(x, z) + 0.5);
      if (standable(x, z, y) && farFromAll(x, z, 40)) add(x, z, y, true);
    }
    if (P.lighthouse) islaSpot(P.lighthouse.x + 8, P.lighthouse.z);
    if (P.marina) islaSpot(P.marina.x - 58, P.marina.z + 24);
    if (P.helipad) islaSpot(P.helipad.x + 9, P.helipad.z + 4);
    if (P.cove) islaSpot(P.cove.x + 4, P.cove.z - 8);
    alleys(true, ISLA - (list.length - start), 80, rng);
  }

  function build() {
    var b = new GeoBatch();
    b.addBox(0, 0, 0, 0.62, 0.4, 0.1, 0, 0x1a1a24, 0);          // shell
    b.addBox(0, 0.06, 0, 0.5, 0.18, 0.12, 0, 0xff4fa3, 0);      // label
    b.addBox(-0.13, -0.05, 0, 0.09, 0.09, 0.13, 0, 0xf4f0ff, 0); // reels
    b.addBox(0.13, -0.05, 0, 0.09, 0.09, 0.13, 0, 0xf4f0ff, 0);
    geo = b.build();
    mat = sharedVertexBasic();
    haloGeo = new THREE.RingGeometry(0.46, 0.62, 24);
    haloMat = new THREE.MeshBasicMaterial({ color: 0xff4fa3, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false });
  }
  function meshFor(t) {
    var g = new THREE.Group();
    g.add(new THREE.Mesh(geo, mat));
    g.add(new THREE.Mesh(haloGeo, haloMat));
    g.position.set(t.x, t.y + 1.0, t.z);
    g.rotation.y = (t.x * 7 + t.z * 3) % 6.28;
    return g;
  }

  function init(sc) {
    scene = sc;
    var s = GAME.prefs && GAME.prefs.tapes;
    if (s) { got = s.got || {}; paid = s.paid || {}; }
    place();
    build();
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      t.taken = !!got[t.id];
      if (t.taken) continue;
      t.mesh = meshFor(t);
      scene.add(t.mesh);
    }
  }
  function save() {
    GAME.prefs = GAME.prefs || {};
    GAME.prefs.tapes = { got: got, paid: paid };
    GAME.save();
  }

  function collect(t) {
    t.taken = true;
    got[t.id] = true;
    if (t.mesh) { scene.remove(t.mesh); t.mesh = null; }
    var n = count(), all = total();
    GAME.addCash(250);
    GAME.audio.pickup();
    GAME.haptics.pickup();
    GAME.fx.spawn(t.x, t.y + 1, t.z, { count: 10, color: 0xff8fc8, spread: 2, vy: 2.5, life: 0.6, grav: -4, keep: true });
    GAME.hud.message('LOST TAPE  ' + n + ' / ' + all + '   ·   +$250', 3.5);
    GAME.track('tape-found');
    for (var i = 0; i < MILESTONES.length; i++) {
      var m = MILESTONES[i];
      var at = Math.min(m[0], all);
      if (n >= at && !paid[m[0]]) {
        paid[m[0]] = true;
        GAME.addCash(m[1]);
        GAME.audio.sting('win');
        if (n >= all) {
          GAME.prefs = GAME.prefs || {};
          GAME.prefs.tapeDeck = true;
          GAME.hud.message('ALL ' + all + ' LOST TAPES!  +$' + m[1].toLocaleString() + '  ·  the DJ is back on the air — TAPE DECK FM is on every car radio', 8);
          GAME.track('all-tapes');
          GAME.share.show({
            slug: 'all-tapes', eyebrow: 'Costa Rosa · 1986', title: 'ALL ' + all + ' LOST TAPES',
            subtitle: 'Every mixtape found — the pirate station is back', accent: '#ff4fa3',
            stats: [{ label: 'Tapes', value: all + ' / ' + all }, { label: 'Payout', value: '$' + m[1].toLocaleString() }, { label: 'Unlocked', value: 'TAPE DECK FM' }]
          });
        } else {
          GAME.hud.message(at + ' LOST TAPES  ·  +$' + m[1].toLocaleString() + '  ·  ' + (all - n) + ' still out there', 5);
        }
      }
    }
    save();
  }

  function update(dt) {
    var P = GAME.player;
    if (P.state !== 'alive' || !list.length || P.interior) return;
    var f = GAME.focus(), spin = dt * 2.2, bob = Math.sin(GAME.time * 2.4) * 0.12;
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (t.taken) continue;
      var d2 = U.dist2(f.x, f.z, t.x, t.z);
      if (d2 < 140 * 140 && t.mesh) { t.mesh.rotation.y += spin; t.mesh.position.y = t.y + 1.0 + bob; }
      if (d2 < GRAB_R2 && Math.abs(f.y - t.y) < 2.4) collect(t);
    }
  }

  // the radar's glint: untaken tapes close enough to hear the hiss
  var nearOut = [];
  function nearby(x, z) {
    nearOut.length = 0;
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (!t.taken && U.dist2(x, z, t.x, t.z) < GLINT_R * GLINT_R) nearOut.push(t);
    }
    return nearOut;
  }

  return {
    init: init, update: update, nearby: nearby,
    get found() { return count(); },
    get total() { return total(); },
    get complete() { return list.length > 0 && count() >= list.length; },
    // headless: where they all are
    list: function () { return list; }
  };
})();
