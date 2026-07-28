// Isla Verde — the second landmass, east across the channel.
//
// Built the other way round from the mainland. Costa Rosa is a grid of axis
// lines laid down first, with everything since written against it; trying to
// thread a curve or a raised road through it afterwards meant fighting every
// system that already knew roads were straight and land was flat. Here the
// terrain and the road network come first and everything else is placed
// against them, so a bend is just a segment with a radius and a climb is just
// ground — no exceptions to bolt on later, and nothing to drive underneath.
GAME.isla = (function () {
  var city = null;

  // Channel width is the whole trick. At this range fog leaves the far shore a
  // hazy silhouette from the mainland beach: enough to know a city is out
  // there, not enough to see what it holds.
  var C = { cx: 995, cz: 30, rx: 262, rz: 335 };

  function edge(ang) {
    return 1 + 0.10 * Math.sin(ang * 3 + 0.7) + 0.06 * Math.sin(ang * 5 + 2.1)
      - 0.05 * Math.cos(ang * 2 + 1.1);
  }
  function contains(x, z) {
    var dx = x - C.cx, dz = z - C.cz;
    var r = edge(Math.atan2(dz, dx));
    var ax = dx / (C.rx * r), az = dz / (C.rz * r);
    return ax * ax + az * az <= 1;
  }
  // how far inside the coast a point is, 0 at the waterline and 1 at the middle
  function inland(x, z) {
    var dx = x - C.cx, dz = z - C.cz;
    var r = edge(Math.atan2(dz, dx));
    var ax = dx / (C.rx * r), az = dz / (C.rz * r);
    return U.clamp(1 - Math.sqrt(ax * ax + az * az), 0, 1);
  }

  // ---------- terrain ----------
  // Three hills, and a coast that always comes back down to the waterline so
  // the shoreline meets the sea cleanly whatever the relief does inland.
  var HILLS = [
    { x: 905, z: -140, r: 150, h: 26 },
    { x: 1080, z: 120, r: 175, h: 21 },
    { x: 1010, z: -30, r: 120, h: 12 }
  ];
  function terrainY(x, z) {
    var y = 0;
    for (var i = 0; i < HILLS.length; i++) {
      var H = HILLS[i];
      var d = U.dist(x, z, H.x, H.z) / H.r;
      if (d < 1) { var f = 1 - d * d; y += H.h * f * f; }
    }
    // hold the last 18% of the approach to the coast down to sea level
    return y * U.clamp(inland(x, z) / 0.18, 0, 1);
  }

  // ---------- road network ----------
  // Segments, not axis lines: a straight is a segment, a bend is a segment with
  // a radius, and everything that asks "am I on a road?" asks the network.
  var NET = [];
  function line(ax, az, bx, bz, w) { NET.push({ kind: 'line', ax: ax, az: az, bx: bx, bz: bz, w: w || 12 }); }
  function arc(cx, cz, r, a0, a1, w) { NET.push({ kind: 'arc', cx: cx, cz: cz, r: r, a0: a0, a1: a1, w: w || 12 }); }

  function defineNetwork() {
    NET.length = 0;
    var P = Math.PI;
    // the bridge boulevard runs in from the west and bends north around the hill
    line(770, 50, 900, 50, 14);
    arc(900, -30, 80, P / 2, 0, 14);
    line(980, -30, 980, -120, 14);
    arc(1040, -120, 60, P, P * 1.5, 14);
    line(1040, -180, 1140, -180, 12);
    // the coast road, closed into a full circuit — a ring road that stops
    // halfway round is a dead end you drive into and sit at
    arc(995, 30, 218, -P * 0.5, P * 0.5, 12);
    arc(995, 30, 218, P * 0.5, P * 1.5, 12);
    // a climb over the northern hill, joining the two
    line(900, 50, 880, -60, 11);
    arc(940, -100, 62, P, P * 1.62, 11);
    // southern loop
    arc(995, 30, 150, P * 0.55, P * 1.45, 11);
    line(845, 90, 900, 50, 11);
    line(1120, 180, 1160, 90, 11);
  }

  // closest point on a segment, as {d, y along the road}
  function segClosest(s, x, z) {
    if (s.kind === 'line') {
      var vx = s.bx - s.ax, vz = s.bz - s.az;
      var len2 = vx * vx + vz * vz;
      var t = U.clamp(((x - s.ax) * vx + (z - s.az) * vz) / len2, 0, 1);
      return { d: U.dist(x, z, s.ax + vx * t, s.az + vz * t), t: t };
    }
    var ang = Math.atan2(z - s.cz, x - s.cx);
    var a0 = s.a0, a1 = s.a1;
    var span = a1 - a0;
    var rel = U.wrapPI(ang - a0);
    if (span > 0 && rel < 0) rel += Math.PI * 2;
    if (span < 0 && rel > 0) rel -= Math.PI * 2;
    var t = U.clamp(rel / span, 0, 1);
    var pa = a0 + span * t;
    return { d: U.dist(x, z, s.cx + Math.cos(pa) * s.r, s.cz + Math.sin(pa) * s.r), t: t };
  }
  function segLength(s) {
    if (s.kind === 'line') return U.dist(s.ax, s.az, s.bx, s.bz);
    return Math.abs(s.a1 - s.a0) * s.r;
  }
  function segPoint(s, t) {
    if (s.kind === 'line') return [s.ax + (s.bx - s.ax) * t, s.az + (s.bz - s.az) * t];
    var a = s.a0 + (s.a1 - s.a0) * t;
    return [s.cx + Math.cos(a) * s.r, s.cz + Math.sin(a) * s.r];
  }

  // Road heights are sampled from the terrain along each centreline and then
  // smoothed, so a road takes a gentle grade over a hill instead of tracing
  // every bump in it. The land is cut down or filled up to meet the road.
  var N_SAMP = 40, MEET = 20;
  // Height every road together rather than each on its own. Two passes run to
  // convergence: smooth along each road so its grade stays gentle, then pull
  // samples that sit near a sample of another road toward a shared height. That
  // second pass is what stops a junction being a step — grading each road
  // independently leaves them disagreeing wherever they meet.
  function gradeNetwork() {
    var i, i2, k, m, pass;
    for (i = 0; i < NET.length; i++) {
      var s = NET[i];
      s.pts = []; s.h = [];
      for (k = 0; k <= N_SAMP; k++) {
        var p = segPoint(s, k / N_SAMP);
        s.pts.push(p);
        // damped down to the waterline before relaxing, so the descent to the
        // coast gets smoothed into a grade rather than left as a drop
        s.h.push(terrainY(p[0], p[1]) * coastDamp(p[0], p[1]));
      }
    }
    // which samples are close enough to have to agree, worked out once
    var meets = [];
    for (i = 0; i < NET.length; i++) {
      for (i2 = i + 1; i2 < NET.length; i2++) {
        for (k = 0; k <= N_SAMP; k++) {
          for (m = 0; m <= N_SAMP; m++) {
            var d = U.dist(NET[i].pts[k][0], NET[i].pts[k][1], NET[i2].pts[m][0], NET[i2].pts[m][1]);
            if (d < MEET) meets.push([i, k, i2, m, 0.5 * (1 - d / MEET)]);
          }
        }
      }
    }
    for (pass = 0; pass < 30; pass++) {
      for (i = 0; i < NET.length; i++) {
        var s2 = NET[i], out = s2.h.slice();
        for (k = 0; k <= N_SAMP; k++) {
          var lo = Math.max(0, k - 2), hi = Math.min(N_SAMP, k + 2), sum = 0, n = 0;
          for (var j = lo; j <= hi; j++) { sum += s2.h[j]; n++; }
          out[k] = sum / n;
        }
        s2.h = out;
      }
      for (var q = 0; q < meets.length; q++) {
        var e = meets[q], A = NET[e[0]], Bs = NET[e[2]];
        var mean = (A.h[e[1]] + Bs.h[e[3]]) / 2;
        A.h[e[1]] = U.lerp(A.h[e[1]], mean, e[4]);
        Bs.h[e[3]] = U.lerp(Bs.h[e[3]], mean, e[4]);
      }
      limitGrades();
    }
    limitGrades();
  }

  // No road may exceed this, and it is enforced rather than aimed at: a short
  // segment that would have to fall off a hillside gets held back until the
  // land around it takes the drop instead. That keeps the layout free — any
  // road laid down later is drivable by construction, not by hand-tuning.
  var MAX_GRADE = 0.085;
  function limitGrades() {
    for (var i = 0; i < NET.length; i++) {
      var s = NET[i], cap = MAX_GRADE * (segLength(s) / N_SAMP), k, d;
      for (k = 1; k <= N_SAMP; k++) {
        d = s.h[k] - s.h[k - 1];
        if (d > cap) s.h[k] = s.h[k - 1] + cap;
        else if (d < -cap) s.h[k] = s.h[k - 1] - cap;
      }
      for (k = N_SAMP - 1; k >= 0; k--) {
        d = s.h[k] - s.h[k + 1];
        if (d > cap) s.h[k] = s.h[k + 1] + cap;
        else if (d < -cap) s.h[k] = s.h[k + 1] - cap;
      }
    }
  }
  function coastDamp(x, z) { return U.clamp(inland(x, z) / 0.10, 0, 1); }
  function segY(s, t) {
    var f = U.clamp(t, 0, 1) * N_SAMP;
    var i = Math.min(N_SAMP - 1, Math.floor(f));
    return U.lerp(s.h[i], s.h[i + 1], f - i);
  }

  var SHOULDER = 16;
  // The island's ground: terrain with the roads cut into it. Every road within
  // reach contributes by weight rather than the nearest one winning outright —
  // picking a winner puts a cliff along the line midway between two roads at
  // different heights, which is exactly where junctions are.
  function groundY(x, z) {
    var wsum = 0, ysum = 0;
    for (var i = 0; i < NET.length; i++) {
      var s = NET[i], c = segClosest(s, x, z), half = s.w / 2;
      if (c.d > half + SHOULDER) continue;
      // full weight right across the carriageway, easing to nothing at the far
      // edge of the verge. It has to be continuous: giving the road you are on
      // an overriding weight puts a step exactly at the kerb line wherever two
      // roads overlap, which is every junction.
      var k = c.d <= half ? 0 : (c.d - half) / SHOULDER;
      var w = 1 - k * k * (3 - 2 * k);
      wsum += w; ysum += w * segY(s, c.t);
    }
    var base = terrainY(x, z) * coastDamp(x, z);
    if (wsum <= 0) return base;
    var roadY = ysum / wsum;
    var blend = Math.min(1, wsum);
    return U.lerp(base, roadY, blend);
  }

  function onRoad(x, z, pad) {
    for (var i = 0; i < NET.length; i++) {
      var c = segClosest(NET[i], x, z);
      if (c.d < NET[i].w / 2 + (pad || 0)) return true;
    }
    return false;
  }
  // nearest point on the network, for anything that needs to put something on a
  // road over here the way nearestRoadPoint does on the mainland
  function nearestRoadPoint(x, z) {
    var best = null, bestD = 1e9;
    for (var i = 0; i < NET.length; i++) {
      var c = segClosest(NET[i], x, z);
      if (c.d < bestD) { bestD = c.d; best = { s: NET[i], t: c.t }; }
    }
    var p = segPoint(best.s, best.t);
    return { x: p[0], z: p[1], axis: 'net' };
  }

  // ---------- the bridge ----------
  var B = { z: 50, half: 7, h: 9, x0: 352, x1: 0, rampIn: 70, rampOut: 90 };
  function ease(t) { return t * t * (3 - 2 * t); }
  function deckY(x, z) {
    if (Math.abs(z - B.z) > B.half) return null;
    if (x < B.x0 || x > B.x1) return null;
    var upEnd = B.x0 + B.rampIn, downStart = B.x1 - B.rampOut;
    if (x >= upEnd && x <= downStart) return B.h;
    if (x < upEnd) return B.h * ease((x - B.x0) / B.rampIn);
    // come down to meet whatever the island road is doing at the abutment
    var land = groundY(B.x1, B.z);
    return U.lerp(land, B.h, ease((B.x1 - x) / B.rampOut));
  }

  function register(c) {
    city = c;
    defineNetwork();
    gradeNetwork();
    city.addIsland({
      id: 'isla', name: 'Isla Verde', contains: contains,
      centre: { x: C.cx, z: C.cz }, groundY: groundY,
      onRoad: onRoad, nearestRoadPoint: nearestRoadPoint
    });
    var bx = 600;
    while (bx < 1400 && !contains(bx, B.z)) bx += 1;
    B.x1 = bx + 10;
    city.addCrossing({ id: 'causeway', name: 'Isla Verde Bridge', z: B.z, half: B.half, deckY: deckY,
      x0: B.x0, x1: B.x1, height: B.h });
    city.isla = { bounds: C, bridge: B, contains: contains, net: NET, hills: HILLS,
      terrainY: terrainY, groundY: groundY, onRoad: onRoad };
  }

  // ---------- geometry ----------
  // the land as a polar mesh, so the coast is the mesh edge and the relief is
  // whatever groundY says — the roads are already cut into it
  function buildLand(scene, b) {
    var RINGS = 26, SECT = 96;
    for (var s = 0; s < SECT; s++) {
      var a0 = s / SECT * Math.PI * 2, a1 = (s + 1) / SECT * Math.PI * 2;
      var e0 = edge(a0), e1 = edge(a1);
      for (var r = 0; r < RINGS; r++) {
        var f0 = r / RINGS, f1 = (r + 1) / RINGS;
        var p = [];
        var pairs = [[a0, e0, f0], [a1, e1, f0], [a1, e1, f1], [a0, e0, f1]];
        for (var k = 0; k < 4; k++) {
          var aa = pairs[k][0], ee = pairs[k][1], ff = pairs[k][2];
          var px = C.cx + Math.cos(aa) * C.rx * ee * (1 - ff);
          var pz = C.cz + Math.sin(aa) * C.rz * ee * (1 - ff);
          p.push([px, groundY(px, pz), pz]);
        }
        // green inland, pale at the waterline
        var t = 1 - f0;
        var col = t > 0.93 ? 0x6a6048 : (groundY(p[0][0], p[0][2]) > 9 ? 0x1f2a24 : 0x1a1a26);
        b.addQuad(p[0], p[1], p[2], p[3], col, [0, 1, 0]);
      }
    }
  }

  function buildRoads(scene, b) {
    for (var i = 0; i < NET.length; i++) {
      var s = NET[i], half = s.w / 2;
      var STEPS = 60;
      for (var k = 0; k < STEPS; k++) {
        var t0 = k / STEPS, t1 = (k + 1) / STEPS;
        var p0 = segPoint(s, t0), p1 = segPoint(s, t1);
        var dx = p1[0] - p0[0], dz = p1[1] - p0[1];
        var l = Math.sqrt(dx * dx + dz * dz) || 1;
        var nx = -dz / l * half, nz = dx / l * half;
        var y0 = segY(s, t0) + 0.06, y1 = segY(s, t1) + 0.06;
        b.addQuad([p0[0] - nx, y0, p0[1] - nz], [p1[0] - nx, y1, p1[1] - nz],
          [p1[0] + nx, y1, p1[1] + nz], [p0[0] + nx, y0, p0[1] + nz], 0x100e16, [0, 1, 0]);
        if (k % 2 === 0) {
          var cw = 0.3;
          var mx = -dz / l * cw, mz = dx / l * cw;
          b.addQuad([p0[0] - mx, y0 + 0.02, p0[1] - mz], [p1[0] - mx, y1 + 0.02, p1[1] - mz],
            [p1[0] + mx, y1 + 0.02, p1[1] + mz], [p0[0] + mx, y0 + 0.02, p0[1] + mz], 0xd8b84a, [0, 1, 0]);
        }
      }
    }
  }

  // Grey-box massing, placed against the network rather than a grid: anywhere
  // off the road and inside the coast, sitting on whatever the ground does.
  function buildBlocks(scene, b, rng) {
    var shades = [0x231d33, 0x2b2340, 0x1d1a2c, 0x322745];
    for (var n = 0; n < 260; n++) {
      var a = rng() * Math.PI * 2, rr = Math.sqrt(rng());
      var ox = C.cx + Math.cos(a) * C.rx * rr * 0.92;
      var oz = C.cz + Math.sin(a) * C.rz * rr * 0.92;
      if (!contains(ox, oz) || inland(ox, oz) < 0.1) continue;
      if (onRoad(ox, oz, 12)) continue;
      if (ox < 830 && Math.abs(oz - B.z) < 26) continue;   // keep the landing clear
      var w = U.randRange(rng, 16, 28), d = U.randRange(rng, 16, 28);
      if (onRoad(ox, oz, 8 + Math.max(w, d) / 2)) continue;
      var gy = groundY(ox, oz);
      // the hills already lift the skyline, so the towers need not be so tall
      var h = U.randRange(rng, 18, 40) + inland(ox, oz) * U.randRange(rng, 10, 55);
      b.addBox(ox, gy + h / 2, oz, w, h, d, 0, U.pick(rng, shades), 0);
      city.addSolid(ox, oz, w, d, gy + h);
    }
  }

  function buildBridge(scene, b) {
    var SEG = 6, zN = B.z - B.half, zS = B.z + B.half;
    function strip(x0, x1, ya, yb, z0, z1, color) {
      b.addQuad([x0, ya, z0], [x1, yb, z0], [x1, yb, z1], [x0, ya, z1], color, [0, 1, 0]);
    }
    for (var x = B.x0; x < B.x1; x += SEG) {
      var x1 = Math.min(x + SEG, B.x1);
      var ya = deckY(x, B.z) || 0, yb = deckY(x1, B.z) || 0, ym = (ya + yb) / 2;
      strip(x, x1, ya + 0.06, yb + 0.06, zN, zS, 0x100e16);
      if (((x - B.x0) / SEG) % 2 === 0) {
        strip(x + 0.8, x1 - 0.8, ya + 0.08, yb + 0.08, B.z - 0.28, B.z + 0.28, 0xd8b84a);
      }
      var gN = zN - 0.6, gS = zS + 0.6, D = 1.4;
      b.addQuad([x, ya - D, gN], [x, ya, gN], [x1, yb, gN], [x1, yb - D, gN], 0x232038, [0, 0, -1]);
      b.addQuad([x, ya - D, gS], [x1, yb - D, gS], [x1, yb, gS], [x, ya, gS], 0x232038, [0, 0, 1]);
      b.addQuad([x, ya - D, gN], [x1, yb - D, gN], [x1, yb - D, gS], [x, ya - D, gS], 0x1a1830, [0, -1, 0]);
      for (var e = 0; e < 2; e++) {
        var ez = e ? zS : zN;
        strip(x, x1, ya + 1.4, yb + 1.4, ez - 0.35, ez + 0.35, 0x46405e);
        b.addQuad([x, ya, ez - 0.35], [x1, yb, ez - 0.35], [x1, yb + 1.4, ez - 0.35], [x, ya + 1.4, ez - 0.35], 0x46405e, [0, 0, -1]);
        b.addQuad([x1, yb, ez + 0.35], [x, ya, ez + 0.35], [x, ya + 1.4, ez + 0.35], [x1, yb + 1.4, ez + 0.35], 0x46405e, [0, 0, 1]);
        strip(x, x1, ya + 1.48, yb + 1.48, ez - 0.15, ez + 0.15, e ? 0xff4fa3 : 0x38e8ff);
        city.addSolid((x + x1) / 2, ez, SEG, 0.7, ym + 1.4, 'parapet', true);
      }
    }
    for (var px = B.x0 + 30; px < B.x1 - 30; px += 40) {
      var py = deckY(px, B.z) || 0;
      if (py < 2) continue;
      var col = py + 2;
      b.addBox(px, col / 2 - 2, B.z - 8.2, 3.4, col, 3.4, 0, 0x2e2b44, 0);
      b.addBox(px, col / 2 - 2, B.z + 8.2, 3.4, col, 3.4, 0, 0x2e2b44, 0);
      b.addBox(px, py - 1.8, B.z, 3.4, 0.9, 19, 0, 0x2a2740, 0);
    }
    for (var t = 0; t < 2; t++) {
      var tx = t ? B.x1 - 16 : B.x0 + 14, ty = deckY(tx, B.z) || 0;
      b.addBox(tx, ty + 9, zN - 1.2, 1.6, 18, 1.6, 0, 0x3a3552, 0);
      b.addBox(tx, ty + 9, zS + 1.2, 1.6, 18, 1.6, 0, 0x3a3552, 0);
      b.addBox(tx, ty + 17.4, B.z, 1.6, 1.6, B.half * 2 + 4, 0, 0x3a3552, 0);
      b.addBox(tx, ty + 18.3, B.z, 0.7, 0.4, B.half * 2 + 4, 0, 0x38e8ff, 0);
    }
  }

  function build(scene) {
    var rng = mulberry32(0x15a5e);
    var b = new GeoBatch();
    buildLand(scene, b);
    buildRoads(scene, b);
    buildBlocks(scene, b, rng);
    buildBridge(scene, b);
    var mesh = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    city.islaMesh = mesh;
  }

  return { register: register, build: build, contains: contains, deckY: deckY, groundY: groundY };
})();
