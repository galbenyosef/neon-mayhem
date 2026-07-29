// Isla Verde — the second landmass, east across the channel.
//
// Built the other way round from the mainland. Costa Rosa is a grid of axis
// lines laid down first, with everything since written against it; trying to
// thread a curve or a raised road through it afterwards meant fighting every
// system that already knew roads were straight and land was flat. Here the
// terrain and the road network come first and everything else is placed
// against them, so a bend is just a segment with a radius and a climb is just
// ground — no exceptions to bolt on later.
//
// The island is laid out in the frame the plan was drawn in and mapped into
// the world in one place (tx/tz), so the plan and the game agree by
// construction rather than by two sets of numbers being kept in step by hand.
GAME.isla = (function () {
  var city = null;
  var TAU = Math.PI * 2;

  // Channel width is the whole trick. At this range fog leaves the far shore a
  // hazy silhouette from the mainland beach: enough to know a city is out
  // there, not enough to see what it holds.
  var C = { cx: 1100, cz: 25, rx: 370, rz: 465 };
  var AX = 1025, AZ = 25, GROW = 1.285;      // plan frame -> world
  function tx(x) { return C.cx + (x - AX) * GROW; }
  function tz(z) { return C.cz + (z - AZ) * GROW; }
  function T(p) { return [tx(p[0]), tz(p[1])]; }

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
  // a point at fraction f of the way from the middle to the coast
  function ringPt(a, f) {
    var e = edge(a) * f;
    return [C.cx + Math.cos(a) * C.rx * e, C.cz + Math.sin(a) * C.rz * e];
  }
  // dry land nearest a point out in the water, for washing someone ashore
  function shorePoint(x, z) {
    var a = Math.atan2(z - C.cz, x - C.cx);
    var e = ringPt(a, 1);
    var d = U.dist(e[0], e[1], C.cx, C.cz) || 1;
    var q = ringPt(a, Math.max(0, 1 - 26 / d));
    return { x: q[0], z: q[1] };
  }

  // ---------- terrain ----------
  // Two big hills and a low shoulder between them, with a coast that always
  // comes back down to the waterline so the shoreline meets the sea cleanly
  // whatever the relief does inland.
  var HILLS = [
    { x: 940, z: -160, r: 165, h: 27 },     // Alta Verde
    { x: 1150, z: 120, r: 175, h: 22 },     // Mirador
    { x: 1030, z: -20, r: 120, h: 11 }
  ].map(function (H) { return { x: tx(H.x), z: tz(H.z), r: H.r * GROW, h: H.h }; });

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
  function coastDamp(x, z) { return U.clamp(inland(x, z) / 0.10, 0, 1); }

  // ---------- road network ----------
  // Every road is a polyline: a straight is two points, a bend is a handful,
  // and anything that asks "am I on a road?" asks the network rather than a
  // list of axis lines. One shape means one grading solver and one lookup.
  var NET = [];
  function road(pts, w, kind) { NET.push({ pts: pts, w: w || 12, kind: kind || 'road' }); return NET[NET.length - 1]; }
  function iroad(pts, w, kind) { return road(pts.map(T), w, kind); }

  function arcp(cx, cz, r, a0, a1, n) { return spiral(cx, cz, r, r, a0, a1, n); }
  // A leg of a switchback: the radius shrinks as the angle sweeps, so the leg
  // climbs the hillside steadily and consecutive legs share an endpoint at the
  // hairpin. Legs at constant radius sit on one contour instead, which puts
  // the entire climb into the turn and leaves the legs level.
  function spiral(cx, cz, r0, r1, a0, a1, n) {
    var out = [];
    n = n || 26;
    for (var i = 0; i <= n; i++) {
      var t = i / n, a = a0 + (a1 - a0) * t, r = r0 + (r1 - r0) * t;
      out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    return out;
  }
  // replace each interior corner with a short arc, so a polyline used as a
  // driving surface has no wedge of nothing on the outside of a bend
  function roundCorners(pts, r) {
    if (pts.length < 3) return pts.slice();
    var out = [pts[0]];
    for (var i = 1; i < pts.length - 1; i++) {
      var a = pts[i - 1], b = pts[i], c = pts[i + 1];
      var ax = a[0] - b[0], az = a[1] - b[1], cx = c[0] - b[0], cz = c[1] - b[1];
      var la = Math.hypot(ax, az) || 1, lc = Math.hypot(cx, cz) || 1;
      var cut = Math.min(r, la * 0.45, lc * 0.45);
      var p0 = [b[0] + ax / la * cut, b[1] + az / la * cut];
      var p1 = [b[0] + cx / lc * cut, b[1] + cz / lc * cut];
      out.push(p0);
      for (var k = 1; k < 5; k++) {
        var t = k / 5, s = t * (1 - t) * 2;   // quadratic bezier through b
        out.push([p0[0] * (1 - t) * (1 - t) + b[0] * s + p1[0] * t * t,
          p0[1] * (1 - t) * (1 - t) + b[1] * s + p1[1] * t * t]);
      }
      out.push(p1);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  function defineNetwork() {
    NET.length = 0;
    var i;

    // the coastal ring, closed into a full circuit — a ring road that stops
    // halfway round is a dead end you drive into and sit at
    var ring = [];
    for (i = 0; i <= 200; i++) ring.push(ringPt(i / 200 * TAU, 0.845));
    road(ring, 14, 'ring').closed = true;

    // Puerto Dorado — the island's only grid, because a port earns one
    [-40, 30, 100, 170].forEach(function (gz) { iroad([[768, gz], [930, gz]], 13, 'port'); });
    // two north-south streets, not three: the westmost one ran alongside the
    // coast road for its whole length and served the same buildings
    [865, 930].forEach(function (gx) { iroad([[gx, -40], [gx, 170]], 13, 'port'); });

    // Alta Verde — a switchback, hairpin to hairpin, up to the summit. Each leg
    // is its own road rather than one long polyline: a polyline that doubles
    // back passes within a few metres of itself at a very different height, and
    // a road can only report one height at a point, so the lookup snaps between
    // the two loops and puts a cliff down the middle of the hillside.
    iroad(spiral(940, -160, 132, 104, TAU * 0.60, TAU * 0.93), 11, 'hill');
    iroad(spiral(940, -160, 104, 76, TAU * 0.93, TAU * 0.60), 11, 'hill');
    iroad(spiral(940, -160, 76, 48, TAU * 0.60, TAU * 0.92), 11, 'hill');
    iroad(spiral(940, -160, 48, 20, TAU * 0.92, TAU * 0.63), 11, 'hill');
    // the last leg turns in to the summit, where the lookout and the pad are
    iroad(spiral(940, -160, 20, 4, TAU * 0.63, TAU * 0.30), 11, 'hill');

    // Mirador — the same shape at a gentler pitch, plus a level resort ring
    iroad(spiral(1150, 120, 150, 92, TAU * 0.52, TAU * 0.96), 11, 'hill');
    iroad(spiral(1150, 120, 92, 44, TAU * 0.96, TAU * 0.44), 11, 'hill');
    iroad(spiral(1150, 120, 44, 8, TAU * 0.44, TAU * 0.86), 11, 'hill');
    // The plan drew a resort ring road round this hill. It is gone: a ring at a
    // fixed radius sits at the same elevation the climb sweeps through, so the
    // two ran alongside each other for a quarter of a kilometre and neither
    // took you anywhere the other did not. The climb passes the resort anyway.

    // Costa Sur promenade, just inside the ring along the south shore
    var prom = [];
    for (i = 0; i <= 40; i++) prom.push(ringPt(TAU * (0.10 + 0.30 * i / 40), 0.70));
    road(prom, 12, 'prom');

    // connectors that tie it all together
    iroad(roundCorners([[930, 100], [988, 68], [1016, 52]], 26), 12, 'port');
    iroad([[930, -40], [900, -100]], 11, 'hill');
    iroad(arcp(1030, -20, 118, TAU * 0.80, TAU * 0.98), 11, 'hill');

    // Cul-de-sacs through the villa belts. Each one starts on the road it
    // branches off — a lane that begins forty metres from anything is a lane
    // nothing can reach — and then follows the contour rather than a straight
    // bearing, because a straight lane across a hillside has to climb faster
    // than anything can drive.
    [[880, -230, 0.5, 44], [1000, -230, 2.5, 44], [858, -120, 3.5, 38],
      [1012, -120, 5.7, 38], [900, -280, 1.2, 34], [1230, 70, 4.2, 40],
      [1210, 190, 1.1, 40], [1090, 190, 2.1, 36]].forEach(function (L) {
      var o = T([L[0], L[1]]);
      var j = scanNearest(o[0], o[1]);
      if (!j || j.d > 120) return;
      // On a steep flank the only level line is the contour, which is the line
      // the road already takes — so a lane there is a second road running
      // beside the first. Lanes go where the ground is gentle enough to lay
      // one out in any direction.
      var gx2 = terrainY(j.x + 3, j.z) - terrainY(j.x - 3, j.z);
      var gz2 = terrainY(j.x, j.z + 3) - terrainY(j.x, j.z - 3);
      if (Math.hypot(gx2, gz2) / 6 > 0.075) return;
      var lane = contourWalk(j.x, j.z, L[3] + j.d * 0.5, L[2]);
      // near the coast the contour is the coast, so a lane that follows it just
      // runs alongside the ring road for its whole length
      var shadow = 0;
      for (var k = 1; k < lane.length; k++) {
        var a = Math.atan2(lane[k][1] - C.cz, lane[k][0] - C.cx);
        var rp = ringPt(a, 0.845);
        if (U.dist(lane[k][0], lane[k][1], rp[0], rp[1]) < 26) shadow++;
      }
      if (lane.length < 3 || shadow > (lane.length - 1) * 0.3) return;
      road(lane, 8, 'local');
    });
  }

  // nearest point on anything already in the network, before the index exists
  function scanNearest(x, z) {
    var best = null;
    for (var i = 0; i < NET.length; i++) {
      var s = NET[i];
      for (var e = 0; e < s.pts.length - 1; e++) {
        var a = s.pts[e], b = s.pts[e + 1];
        var vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz;
        var t = l2 > 1e-9 ? U.clamp(((x - a[0]) * vx + (z - a[1]) * vz) / l2, 0, 1) : 0;
        var px = a[0] + vx * t, pz = a[1] + vz * t;
        var d = U.dist(x, z, px, pz);
        if (!best || d < best.d) best = { x: px, z: pz, d: d };
      }
    }
    return best;
  }

  function contourWalk(x, z, len, hint) {
    var pts = [[x, z]], px = x, pz = z, step = 6, last = null;
    var hx = Math.cos(hint), hz = Math.sin(hint);
    for (var i = 0; i < Math.round(len / step); i++) {
      var gx = terrainY(px + 2, pz) - terrainY(px - 2, pz);
      var gz = terrainY(px, pz + 2) - terrainY(px, pz - 2);
      var ux = -gz, uz = gx, l = Math.hypot(ux, uz);
      if (l < 1e-3) { ux = hx; uz = hz; }         // flat ground: take the hint
      else { ux /= l; uz /= l; }
      var ref = last || [hx, hz];
      if (ux * ref[0] + uz * ref[1] < 0) { ux = -ux; uz = -uz; }
      last = [ux, uz];
      px += ux * step; pz += uz * step;
      if (!contains(px, pz) || inland(px, pz) < 0.04) break;
      pts.push([px, pz]);
    }
    return pts.length > 1 ? pts : [[x, z], [x + hx * 20, z + hz * 20]];
  }

  // ---------- polyline geometry ----------
  function prep(s) {
    var i, cum = [0], len = 0;
    for (i = 1; i < s.pts.length; i++) {
      len += U.dist(s.pts[i - 1][0], s.pts[i - 1][1], s.pts[i][0], s.pts[i][1]);
      cum.push(len);
    }
    s.cum = cum; s.len = Math.max(1e-6, len);
    // sample roughly every 12 m, so the grading solver works in metres rather
    // than in fractions of however long this particular road happens to be
    s.n = U.clamp(Math.round(s.len / 12), 8, 220);
    s.step = s.len / s.n;
  }
  function segPointAt(s, t) {
    var d = U.clamp(t, 0, 1) * s.len, lo = 0, hi = s.cum.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (s.cum[mid] <= d) lo = mid; else hi = mid; }
    var seg = s.cum[hi] - s.cum[lo];
    var f = seg > 1e-9 ? (d - s.cum[lo]) / seg : 0;
    return [U.lerp(s.pts[lo][0], s.pts[hi][0], f), U.lerp(s.pts[lo][1], s.pts[hi][1], f)];
  }
  // distance from (x,z) to edge i of s, and the global parameter of the foot
  function edgeClosest(s, i, x, z) {
    var a = s.pts[i], b = s.pts[i + 1];
    var vx = b[0] - a[0], vz = b[1] - a[1];
    var l2 = vx * vx + vz * vz;
    var t = l2 > 1e-9 ? U.clamp(((x - a[0]) * vx + (z - a[1]) * vz) / l2, 0, 1) : 0;
    var px = a[0] + vx * t, pz = a[1] + vz * t;
    return { d: U.dist(x, z, px, pz), t: (s.cum[i] + Math.sqrt(l2) * t) / s.len };
  }
  function segClosest(s, x, z) {
    var best = { d: 1e9, t: 0 };
    for (var i = 0; i < s.pts.length - 1; i++) {
      var c = edgeClosest(s, i, x, z);
      if (c.d < best.d) best = c;
    }
    return best;
  }

  // ---------- grading ----------
  // Road heights are sampled from the terrain along each centreline and then
  // smoothed, so a road takes a gentle grade over a hill instead of tracing
  // every bump in it. The land is cut down or filled up to meet the road.
  //
  // Every road is heighted together rather than each on its own. Two passes run
  // to convergence: smooth along each road so its grade stays gentle, then pull
  // samples that sit near a sample of another road toward a shared height. That
  // second pass is what stops a junction being a step — grading each road
  // independently leaves them disagreeing wherever they meet.
  var MEET = 20, MAX_GRADE = 0.085;
  function gradeNetwork() {
    var i, i2, k, m, pass, s;
    for (i = 0; i < NET.length; i++) {
      s = NET[i];
      s.samp = []; s.h = [];
      for (k = 0; k <= s.n; k++) {
        var p = segPointAt(s, k / s.n);
        s.samp.push(p);
        // damped down to the waterline before relaxing, so the descent to the
        // coast gets smoothed into a grade rather than left as a drop
        s.h.push(terrainY(p[0], p[1]) * coastDamp(p[0], p[1]));
      }
    }
    // which samples are close enough to have to agree, worked out once
    var meets = [];
    for (i = 0; i < NET.length; i++) {
      for (i2 = i + 1; i2 < NET.length; i2++) {
        var A = NET[i], B = NET[i2];
        for (k = 0; k <= A.n; k++) {
          for (m = 0; m <= B.n; m++) {
            var d = U.dist(A.samp[k][0], A.samp[k][1], B.samp[m][0], B.samp[m][1]);
            if (d < MEET) meets.push([i, k, i2, m, 0.5 * (1 - d / MEET)]);
          }
        }
      }
    }
    for (pass = 0; pass < 30; pass++) {
      for (i = 0; i < NET.length; i++) {
        var s2 = NET[i], out = s2.h.slice();
        for (k = 0; k <= s2.n; k++) {
          // a closed road wraps; an open one leaves its ends alone, because a
          // one-sided average drags a summit or a shoreline toward the middle
          // of the road and the end never gets where it was going
          if (!s2.closed && (k === 0 || k === s2.n)) continue;
          var sum = 0, n = 0;
          for (var j = k - 2; j <= k + 2; j++) {
            var jj = s2.closed ? ((j % s2.n) + s2.n) % s2.n : j;
            if (jj < 0 || jj > s2.n) continue;
            sum += s2.h[jj]; n++;
          }
          out[k] = sum / n;
        }
        if (s2.closed) out[s2.n] = out[0];
        s2.h = out;
      }
      for (var q = 0; q < meets.length; q++) {
        var e = meets[q], EA = NET[e[0]], EB = NET[e[2]];
        var mean = (EA.h[e[1]] + EB.h[e[3]]) / 2;
        EA.h[e[1]] = U.lerp(EA.h[e[1]], mean, e[4]);
        EB.h[e[3]] = U.lerp(EB.h[e[3]], mean, e[4]);
      }
      // hold the coastal band down to the damped terrain, so a road that meets
      // the sea arrives at the waterline instead of ending on a low cliff
      for (i = 0; i < NET.length; i++) {
        var s3 = NET[i];
        for (k = 0; k <= s3.n; k++) {
          var cd = coastDamp(s3.samp[k][0], s3.samp[k][1]);
          if (cd < 1) s3.h[k] = U.lerp(s3.h[k], terrainY(s3.samp[k][0], s3.samp[k][1]) * cd, 1 - cd);
        }
        if (s3.closed) s3.h[s3.n] = s3.h[0];
      }
      limitGrades();
    }
    limitGrades();
  }

  // No road may exceed this, and it is enforced rather than aimed at: a stretch
  // that would have to fall off a hillside gets held back until the land around
  // it takes the drop instead. That keeps the layout free — any road laid down
  // later is drivable by construction, not by hand-tuning.
  function limitGrades() {
    for (var i = 0; i < NET.length; i++) {
      var s = NET[i], cap = MAX_GRADE * s.step, k, d;
      // a closed road is walked twice so the limit carries across the seam
      var laps = s.closed ? 2 : 1;
      for (var lap = 0; lap < laps; lap++) {
      for (k = 1; k <= s.n; k++) {
        d = s.h[k] - s.h[k - 1];
        if (d > cap) s.h[k] = s.h[k - 1] + cap;
        else if (d < -cap) s.h[k] = s.h[k - 1] - cap;
      }
      for (k = s.n - 1; k >= 0; k--) {
        d = s.h[k] - s.h[k + 1];
        if (d > cap) s.h[k] = s.h[k + 1] + cap;
        else if (d < -cap) s.h[k] = s.h[k + 1] - cap;
      }
      if (s.closed) s.h[s.n] = s.h[0];
      }
    }
  }
  function segY(s, t) {
    var f = U.clamp(t, 0, 1) * s.n;
    var i = Math.min(s.n - 1, Math.floor(f));
    return U.lerp(s.h[i], s.h[i + 1], f - i);
  }

  // ---------- road lookup ----------
  // groundY runs for every wheel of every vehicle every frame, so the network
  // gets a flat uniform grid over it: a cell lists the road edges whose verge
  // reaches into it, and nothing else is ever considered.
  // How far the land is cut down or filled up to meet a road. A fixed verge
  // leaves an embankment wherever the road sits well below the hill it crosses
  // — the ground has to come back to the terrain somewhere, and over 16 m an
  // eight-metre difference is a wall. The width follows the height difference
  // instead, so the batter always lies back at roughly the same angle.
  var CUT_SLOPE = 0.26, MIN_SHOULDER = 10, MAX_SHOULDER = 64;
  var GX0 = 0, GZ0 = 0, GNX = 0, GNZ = 0, GCELL = 40, GRID = null;
  var sBestD = null, sBestT = null, sStamp = null, stampCtr = 0;

  function buildIndex() {
    GX0 = C.cx - C.rx * 1.3; GZ0 = C.cz - C.rz * 1.3;
    GNX = Math.ceil(C.rx * 2.6 / GCELL) + 1;
    GNZ = Math.ceil(C.rz * 2.6 / GCELL) + 1;
    GRID = new Array(GNX * GNZ);
    for (var i = 0; i < NET.length; i++) {
      var s = NET[i], pad = s.w / 2 + MAX_SHOULDER;
      for (var e = 0; e < s.pts.length - 1; e++) {
        var a = s.pts[e], b = s.pts[e + 1];
        var x0 = Math.min(a[0], b[0]) - pad, x1 = Math.max(a[0], b[0]) + pad;
        var z0 = Math.min(a[1], b[1]) - pad, z1 = Math.max(a[1], b[1]) + pad;
        var cx0 = cellX(x0), cx1 = cellX(x1), cz0 = cellZ(z0), cz1 = cellZ(z1);
        for (var cx = cx0; cx <= cx1; cx++) {
          for (var cz = cz0; cz <= cz1; cz++) {
            var k = cz * GNX + cx;
            (GRID[k] || (GRID[k] = [])).push(i, e);
          }
        }
      }
    }
    sBestD = new Float64Array(NET.length);
    sBestT = new Float64Array(NET.length);
    sStamp = new Int32Array(NET.length);
  }
  function cellX(x) { return U.clamp(Math.floor((x - GX0) / GCELL), 0, GNX - 1); }
  function cellZ(z) { return U.clamp(Math.floor((z - GZ0) / GCELL), 0, GNZ - 1); }
  function cellAt(x, z) {
    if (x < GX0 || z < GZ0) return null;
    var cx = Math.floor((x - GX0) / GCELL), cz = Math.floor((z - GZ0) / GCELL);
    if (cx < 0 || cz < 0 || cx >= GNX || cz >= GNZ) return null;
    return GRID[cz * GNX + cx] || null;
  }

  var touched = [];
  // The island's ground: terrain with the roads cut into it. Every road within
  // reach contributes by weight rather than the nearest one winning outright —
  // picking a winner puts a cliff along the line midway between two roads at
  // different heights, which is exactly where junctions are.
  function groundY(x, z) {
    var list = cellAt(x, z);
    var base = terrainY(x, z) * coastDamp(x, z);
    if (!list) return base;
    stampCtr++;
    touched.length = 0;
    for (var i = 0; i < list.length; i += 2) {
      var si = list[i], s = NET[si];
      var c = edgeClosest(s, list[i + 1], x, z);
      if (sStamp[si] !== stampCtr) {
        sStamp[si] = stampCtr; sBestD[si] = c.d; sBestT[si] = c.t; touched.push(si);
      } else if (c.d < sBestD[si]) { sBestD[si] = c.d; sBestT[si] = c.t; }
    }
    var wsum = 0, ysum = 0;
    for (var t = 0; t < touched.length; t++) {
      var ti = touched[t], sg = NET[ti], half = sg.w / 2, d = sBestD[ti];
      var y = segY(sg, sBestT[ti]);
      var sh = U.clamp(Math.abs(y - base) / CUT_SLOPE, MIN_SHOULDER, MAX_SHOULDER);
      if (d > half + sh) continue;
      // full weight right across the carriageway, easing to nothing at the far
      // edge of the batter. It has to be continuous: giving the road you are on
      // an overriding weight puts a step exactly at the kerb line wherever two
      // roads overlap, which is every junction.
      var k = d <= half ? 0 : (d - half) / sh;
      var w = 1 - k * k * (3 - 2 * k);
      wsum += w; ysum += w * y;
    }
    if (wsum <= 0) return base;
    return U.lerp(base, ysum / wsum, Math.min(1, wsum));
  }

  function onRoad(x, z, pad) {
    var list = cellAt(x, z);
    if (!list) return false;
    for (var i = 0; i < list.length; i += 2) {
      var s = NET[list[i]];
      if (edgeClosest(s, list[i + 1], x, z).d < s.w / 2 + (pad || 0)) return true;
    }
    return false;
  }
  // nearest point on the network, for anything that needs to put something on a
  // road over here the way nearestRoadPoint does on the mainland
  function nearestRoadPoint(x, z) {
    var best = null, bestD = 1e9, i;
    var list = cellAt(x, z);
    if (list) {
      for (i = 0; i < list.length; i += 2) {
        var c = edgeClosest(NET[list[i]], list[i + 1], x, z);
        if (c.d < bestD) { bestD = c.d; best = { s: NET[list[i]], t: c.t }; }
      }
    }
    if (!best) {
      for (i = 0; i < NET.length; i++) {
        var c2 = segClosest(NET[i], x, z);
        if (c2.d < bestD) { bestD = c2.d; best = { s: NET[i], t: c2.t }; }
      }
    }
    var p = segPointAt(best.s, best.t);
    var q = segPointAt(best.s, U.clamp(best.t + 0.004, 0, 1));
    return { x: p[0], z: p[1], axis: 'net', kind: best.s.kind,
      heading: Math.atan2(q[0] - p[0], q[1] - p[1]) };
  }

  // Is this too close to a bridge deck to put something at? The spans were not
  // in the road network, so nothing checked against them — and a bridge ended
  // inside a building because of it.
  function nearSpan(x, z, pad) {
    for (var i = 0; i < SPANS.length; i++) {
      var sp = SPANS[i];
      if (!sp.cum) continue;
      if (segClosest(sp, x, z).d < sp.half + (pad || 0)) return true;
    }
    return false;
  }

  // Nudge a hand-placed structure out of every carriageway. A landmark sited
  // from a drawing lands wherever the roads happen to run, and a warehouse
  // across a road is a road you cannot use. Pushing away from the nearest
  // offending centreline converges in a few passes because every push strictly
  // increases the clearance that was worst.
  function clearOfRoads(x, z, half, gap) {
    var px = x, pz = z;
    gap = gap === undefined ? 5 : gap;
    for (var pass = 0; pass < 40; pass++) {
      var worst = null, worstPush = 0, i, sg, c, need;
      for (i = 0; i < NET.length; i++) {
        sg = NET[i]; c = segClosest(sg, px, pz);
        need = sg.w / 2 + half + gap;
        if (c.d >= need) continue;
        if (need - c.d > worstPush) { worstPush = need - c.d; worst = segPointAt(sg, c.t); }
      }
      for (i = 0; i < SPANS.length; i++) {
        sg = SPANS[i];
        if (!sg.cum) continue;
        c = segClosest(sg, px, pz);
        need = sg.half + half + gap + 6;
        if (c.d >= need) continue;
        if (need - c.d > worstPush) { worstPush = need - c.d; worst = segPointAt(sg, c.t); }
      }
      if (!worst) break;
      var dx = px - worst[0], dz = pz - worst[1], l = Math.hypot(dx, dz);
      if (l < 0.01) { dx = 1; dz = 0; l = 1; }
      px += dx / l * (worstPush + 0.6);
      pz += dz / l * (worstPush + 0.6);
      // never push it into the sea
      if (inland(px, pz) < 0.05) {
        var a = Math.atan2(pz - C.cz, px - C.cx);
        var q = ringPt(a, 0.90);
        px = q[0]; pz = q[1];
      }
    }
    return { x: px, z: pz };
  }

  // ---------- the bridges ----------
  // A crossing is a polyline deck with a half-width: it rises off the mainland,
  // runs level, and comes back down to meet whatever the island road is doing
  // at the far abutment. Same shape as a road, so the same lookup works.
  var SPANS = [];
  function ease(t) { return t * t * (3 - 2 * t); }

  function makeSpan(opts) {
    var s = { pts: opts.pts, w: opts.half * 2, kind: 'span' };
    prep(s);
    s.half = opts.half; s.h = opts.h;
    s.rampIn = opts.rampIn; s.rampOut = opts.rampOut;
    // the access road: the first stretch is ordinary tarmac at street level, so
    // the bridge starts a little way off the junction rather than out of it
    s.flatIn = opts.flatIn || 0;
    s.startY = 0; s.endY = 0;
    s.deckY = function (x, z) {
      var c = segClosest(s, x, z);
      if (c.d > s.half) return null;
      var d = c.t * s.len;
      if (d <= s.flatIn) return s.startY;
      if (d < s.flatIn + s.rampIn) return U.lerp(s.startY, s.h, ease((d - s.flatIn) / s.rampIn));
      if (d > s.len - s.rampOut) return U.lerp(s.endY, s.h, ease((s.len - d) / s.rampOut));
      return s.h;
    };
    // how high the deck stands over whatever is under it, which is what decides
    // where a parapet belongs and where the deck is just a road
    s.liftAt = function (x, z) {
      var y = s.deckY(x, z);
      if (y === null) return 0;
      var g = contains(x, z) ? groundY(x, z) : 0;
      return y - g;
    };
    // where the deck runs, and how wide, for the geometry and the barriers
    s.pointAt = function (t) { return segPointAt(s, t); };
    SPANS.push(s);
    return s;
  }

  // march from a point in the water to a point on the island, stopping at the
  // waterline — so a bridge always lands exactly on the shore whatever the
  // coast is doing at that angle
  function coastHit(ax, az, bx, bz) {
    var lo = 0, hi = 1;
    for (var i = 0; i < 44; i++) {
      var mid = (lo + hi) / 2;
      if (contains(ax + (bx - ax) * mid, az + (bz - az) * mid)) hi = mid; else lo = mid;
    }
    return [ax + (bx - ax) * hi, az + (bz - az) * hi];
  }

  // ---------- unlock ----------
  // Both bridges and the airspace open together, once you have finished enough
  // work on the mainland. Until then the far shore is a rumour.
  var REQUIRED = 4;
  var open = false;
  function missionsDone() {
    var b = GAME.bests || {}, n = 0;
    for (var i = 0; i < GAME.missions.DEFS.length; i++) {
      if (b[GAME.missions.DEFS[i].id] !== undefined) n++;
    }
    return n;
  }
  function setOpen(v) {
    if (open === v) return;
    open = v;
    for (var i = 0; i < gates.length; i++) gates[i].h = open ? -100 : gates[i].gateH;
    if (city.islaGateMesh) city.islaGateMesh.visible = !open;
  }
  function checkUnlock() {
    if (open) return false;
    if (missionsDone() < REQUIRED) return false;
    setOpen(true);
    GAME.hud.message('THE BRIDGES ARE OPEN — Isla Verde is east across the channel.', 6);
    GAME.audio.sting('win');
    GAME.track('isla-unlocked');
    GAME.share.show({
      slug: 'isla-open',
      eyebrow: 'COSTA ROSA · 1986',
      title: 'BRIDGES OPEN',
      subtitle: 'Isla Verde is yours to explore',
      accent: '#8de8b0',
      stats: [{ label: 'Jobs done', value: String(missionsDone()) },
        { label: 'Bridges', value: '2' },
        { label: 'Next', value: 'Head east' }]
    });
    return true;
  }
  // how close you are, for the sign on the barrier and the HUD nudge
  function unlockProgress() { return { done: Math.min(REQUIRED, missionsDone()), need: REQUIRED }; }

  var gates = [];

  function register(c) {
    city = c;
    defineNetwork();

    // Each bridge carries on over the shore and sets down on the coastal ring
    // itself. Landing at the waterline instead needed a slip road to climb to
    // the ring, and to keep that inside a drivable grade it had to run a
    // hundred metres along the coast — shadowing the ring the whole way for no
    // gain. A viaduct over the last stretch of land does the same job.
    function landing(fx, fz, tx2, tz2) {
      var c = coastHit(fx, fz, tx2, tz2);
      var a = Math.atan2(c[1] - C.cz, c[0] - C.cx);
      return ringPt(a, 0.845);
    }
    // Aimed so the descent does not graze the outer switchback leg: land a
    // bridge across a road at two metres of clearance and the road under it
    // stops being a road.
    var nB = landing(400, -400, tx(1012), tz(-200));
    var sB = landing(city.shoreline(150) + 8, 150, C.cx, 150);
    // Both approaches leave along a street rather than out of the middle of a
    // junction: the deck runs level with the road for its first stretch and
    // only then starts to climb.
    var north = makeSpan({
      pts: roundCorners([[352, -350], [416, -350], [nB[0], nB[1]]], 42),
      half: 7, h: 9, flatIn: 46, rampIn: 78, rampOut: 130
    });
    var south = makeSpan({
      pts: [[352, 150], [sB[0], sB[1]]],
      half: 7, h: 9, flatIn: 40, rampIn: 78, rampOut: 130
    });
    north.id = 'north'; north.name = 'North Bridge';
    south.id = 'south'; south.name = 'South Bridge';

    for (var i = 0; i < NET.length; i++) prep(NET[i]);
    buildIndex();
    gradeNetwork();

    north.endY = groundY(nB[0], nB[1]);
    south.endY = groundY(sB[0], sB[1]);

    city.addIsland({
      id: 'isla', name: 'Isla Verde', contains: contains,
      centre: { x: C.cx, z: C.cz }, groundY: groundY, shorePoint: shorePoint,
      onRoad: onRoad, nearestRoadPoint: nearestRoadPoint
    });
    SPANS.forEach(function (s) {
      city.addCrossing({ id: s.id, name: s.name, deckY: s.deckY, span: s,
        nearBy: function (x, z, pad) { return segClosest(s, x, z).d < s.half + (pad || 0); } });
    });
    city.isla = { bounds: C, contains: contains, net: NET, hills: HILLS, spans: SPANS,
      terrainY: terrainY, groundY: groundY, onRoad: onRoad, inland: inland,
      ringPt: ringPt, tx: tx, tz: tz };
    definePois();
  }

  // ---------- landmarks ----------
  var POI = {};
  function definePois() {
    // half-extents, so each one is pushed out by as much as it actually covers
    function site(x, z, half) { var p = clearOfRoads(x, z, half); p.half = half; return p; }
    POI.police = site(tx(880), tz(65), 30);
    POI.hospital = site(tx(830), tz(-60), 30);
    POI.helipad = { x: tx(938), z: tz(-164), half: 9 };   // the Alta Verde summit
    POI.factory = site(tx(1075), tz(330), 26);
    POI.lighthouse = site(tx(845), tz(300), 8);
    POI.marina = site(tx(792), tz(205), 26);
    POI.container = site(tx(800), tz(20), 40);
    POI.observatory = site(HILLS[1].x, HILLS[1].z, 34);
    POI.cove = { x: tx(1245), z: tz(20), half: 30 };
    city.islaPois = POI;
    // the world's one helipad moved over here with the helicopter
    city.helipad = { x: POI.helipad.x, z: POI.helipad.z };
    city.pois.hospitals.push({ x: POI.hospital.x, z: POI.hospital.z,
      spawn: { x: POI.hospital.x, z: POI.hospital.z + 16 }, isla: true });
    city.islaPolice = { x: POI.police.x, z: POI.police.z,
      spawn: { x: POI.police.x, z: POI.police.z - 16 }, isla: true };
    city.pois.stations.push(city.islaPolice);
  }

  // ---------- geometry ----------
  // the land as a polar mesh, so the coast is the mesh edge and the relief is
  // whatever groundY says — the roads are already cut into it
  function buildLand(b) {
    var RINGS = 34, SECT = 128;
    for (var s = 0; s < SECT; s++) {
      var a0 = s / SECT * TAU, a1 = (s + 1) / SECT * TAU;
      for (var r = 0; r < RINGS; r++) {
        var f0 = 1 - r / RINGS, f1 = 1 - (r + 1) / RINGS;
        var p = [], pairs = [[a0, f0], [a1, f0], [a1, f1], [a0, f1]];
        for (var k = 0; k < 4; k++) {
          var q = ringPt(pairs[k][0], pairs[k][1]);
          p.push([q[0], groundY(q[0], q[1]), q[1]]);
        }
        var mid = ringPt((a0 + a1) / 2, (f0 + f1) / 2);
        var y = groundY(mid[0], mid[1]);
        var col = f0 > 0.965 ? 0x6a6048 : y > 16 ? 0x2a3526 : y > 6 ? 0x22301f : 0x1b2620;
        b.addQuad(p[0], p[1], p[2], p[3], col, [0, 1, 0]);
      }
    }
  }

  function buildRoads(b) {
    for (var i = 0; i < NET.length; i++) {
      var s = NET[i], half = s.w / 2;
      var STEPS = Math.max(24, Math.round(s.len / 6));
      for (var k = 0; k < STEPS; k++) {
        var t0 = k / STEPS, t1 = (k + 1) / STEPS;
        var p0 = segPointAt(s, t0), p1 = segPointAt(s, t1);
        var dx = p1[0] - p0[0], dz = p1[1] - p0[1];
        var l = Math.sqrt(dx * dx + dz * dz) || 1;
        var nx = -dz / l * half, nz = dx / l * half;
        var y0 = segY(s, t0) + 0.07, y1 = segY(s, t1) + 0.07;
        b.addQuad([p0[0] - nx, y0, p0[1] - nz], [p1[0] - nx, y1, p1[1] - nz],
          [p1[0] + nx, y1, p1[1] + nz], [p0[0] + nx, y0, p0[1] + nz], 0x100e16, [0, 1, 0]);
        if (k % 2 === 0) {
          var mx = -dz / l * 0.3, mz = dx / l * 0.3;
          b.addQuad([p0[0] - mx, y0 + 0.02, p0[1] - mz], [p1[0] - mx, y1 + 0.02, p1[1] - mz],
            [p1[0] + mx, y1 + 0.02, p1[1] + mz], [p0[0] + mx, y0 + 0.02, p0[1] + mz], 0xd8b84a, [0, 1, 0]);
        }
      }
    }
  }

  // Massing chosen by what the ground is doing underneath: the hills carry
  // bungalows and villas, the lower slopes carry walk-up apartments, and the
  // only skyline on the island stands on the flat by the port. Putting the
  // tall stuff "further inland" is what buried the hills under towers.
  // Isla Verde is a hill island, not a second downtown: it wants space between
  // things. The gaps are what you actually see — a plot every twenty metres
  // reads as a wall of massing whatever is standing on it.
  var BANDS = {
    villa: { sx: [11, 16], sz: [9, 13], h: [4.5, 7.5], gap: 52, cols: [0xd8cfae, 0xe6dcc0, 0xcfc4a2, 0xdcd0b4], tex: null },
    apart: { sx: [16, 24], sz: [14, 20], h: [11, 22], gap: 40, cols: [0x7a6f92, 0x6b6386, 0x8a7ea6, 0x6f688e], tex: 'generic' },
    tower: { sx: [20, 30], sz: [20, 30], h: [30, 68], gap: 30, cols: [0x8a94b8, 0x6a7aa0, 0x9aa8c8, 0x7a88b0], tex: 'downtown' },
    shop: { sx: [18, 30], sz: [12, 18], h: [7, 14], gap: 34, cols: [0xd9a0b6, 0xa8d8c8, 0xe0c898, 0xa8c0e0, 0xd8b0e0], tex: 'strip' }
  };
  // names for the ones that face a street, the way the mainland signs its own
  var ISLA_SIGNS = [24, 25, 26, 27, 28, 29, 30, 31];
  var TOWN_SIGNS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

  function bandAt(x, z) {
    var y = groundY(x, z);
    if (y >= 13) return 'villa';
    if (y >= 5) return 'apart';
    var a = [(x - C.cx) / GROW + AX, (z - C.cz) / GROW + AZ];
    if (a[0] > 760 && a[0] < 950 && a[1] > -60 && a[1] < 190) return 'tower';
    return 'shop';
  }

  var placed = [];
  function buildBlocks(batches, rng) {
    for (var n = 0; n < 12000 && placed.length < 150; n++) {
      var a = rng() * TAU, rr = Math.sqrt(rng());
      var q = ringPt(a, rr * 0.94);
      var ox = q[0], oz = q[1];
      if (!contains(ox, oz) || inland(ox, oz) < 0.05) continue;
      var band = BANDS[bandAt(ox, oz)];
      var w = U.randRange(rng, band.sx[0], band.sx[1]);
      var d = U.randRange(rng, band.sz[0], band.sz[1]);
      if (onRoad(ox, oz, 6 + Math.max(w, d) / 2)) continue;
      if (nearSpan(ox, oz, 12 + Math.max(w, d) / 2)) continue;
      var clear = true;
      for (var p = 0; p < placed.length; p++) {
        if (U.dist2(ox, oz, placed[p][0], placed[p][1]) < band.gap * band.gap) { clear = false; break; }
      }
      if (!clear) continue;
      if (nearReserved(ox, oz, Math.max(w, d) / 2 + 12)) continue;
      var gy = groundY(ox, oz);
      var h = U.randRange(rng, band.h[0], band.h[1]);
      var rot = rng() * TAU;
      var batch = band.tex ? batches[band.tex] : batches.plain;
      batch.addBox(ox, gy + h / 2, oz, w, h, d, rot, U.pick(rng, band.cols), band.tex ? 14 : 0);
      // a villa gets a shallow roof so the hills don't read as a field of boxes
      if (!band.tex) batches.plain.addBox(ox, gy + h + 0.5, oz, w + 1.6, 1, d + 1.6, rot, 0x8f5a48, 0);
      city.addSolid(ox, oz, w * 1.02, d * 1.02, gy + h);
      placed.push([ox, oz]);
      // a name on the street face, for the ones with a street to face
      if (band.tex && rng() < 0.55) {
        var pool = rng() < 0.5 ? ISLA_SIGNS : TOWN_SIGNS;
        var slot = pool[U.randInt(rng, 0, pool.length - 1)];
        var out = d / 2 + 0.35;
        city.addSign(batches.signs, slot, ox + Math.sin(rot) * out,
          gy + Math.min(h - 2.6, h * 0.66), oz + Math.cos(rot) * out, rot,
          Math.min(w * 0.92, 20), 3.8);
      }
    }
  }

  var reserved = [];
  function reserve(x, z, r) { reserved.push([x, z, r]); }
  function nearReserved(x, z, pad) {
    for (var i = 0; i < reserved.length; i++) {
      if (U.dist2(x, z, reserved[i][0], reserved[i][1]) < (reserved[i][2] + pad) * (reserved[i][2] + pad)) return true;
    }
    return false;
  }

  function buildLandmarks(batches, scene) {
    var b = batches.plain, sg = batches.signs;
    var y;

    // police station — the island's only one, in the middle of the port grid
    y = groundY(POI.police.x, POI.police.z);
    b.addBox(POI.police.x, y + 7, POI.police.z + 12, 56, 14, 24, 0, 0x8a94c0, 0);
    city.addSolid(POI.police.x, POI.police.z + 12, 56, 24, y + 14);
    city.addSign(sg, 20, POI.police.x, y + 11, POI.police.z - 0.2, Math.PI, 24, 4.2);

    // hospital — the island's only one, on the flat at the head of the grid
    y = groundY(POI.hospital.x, POI.hospital.z);
    b.addBox(POI.hospital.x, y + 8, POI.hospital.z - 12, 52, 16, 24, 0, 0xd8e8f0, 0);
    city.addSolid(POI.hospital.x, POI.hospital.z - 12, 52, 24, y + 16);
    city.addSign(sg, 19, POI.hospital.x, y + 12.5, POI.hospital.z + 0.2, 0, 26, 4.4);

    // ice cream factory — a cream slab with a cone on the roof you can see from
    // the promenade, and a forecourt where the truck waits
    y = groundY(POI.factory.x, POI.factory.z);
    b.addBox(POI.factory.x, y + 8, POI.factory.z, 46, 16, 30, 0, 0xf2e6cf, 0);
    b.addBox(POI.factory.x - 14, y + 20, POI.factory.z, 8, 8, 8, 0, 0xe8d2b0, 0);
    city.addSolid(POI.factory.x, POI.factory.z, 46, 30, y + 16);
    var cone = new THREE.Mesh(new THREE.ConeGeometry(3.4, 9, 14),
      new THREE.MeshLambertMaterial({ color: 0xe8c088 }));
    cone.position.set(POI.factory.x + 12, y + 20.5, POI.factory.z);
    cone.rotation.z = Math.PI;
    scene.add(cone);
    var scoop = new THREE.Mesh(new THREE.SphereGeometry(4.2, 14, 10),
      new THREE.MeshLambertMaterial({ color: 0xffd7e4, emissive: 0x442230 }));
    scoop.position.set(POI.factory.x + 12, y + 27, POI.factory.z);
    scene.add(scoop);
    city.addSign(sg, 24, POI.factory.x, y + 11, POI.factory.z + 15.3, 0, 30, 5);

    // lighthouse on the south-west point
    y = groundY(POI.lighthouse.x, POI.lighthouse.z);
    var tower = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 4.4, 26, 12),
      new THREE.MeshLambertMaterial({ color: 0xe8e4dc }));
    tower.position.set(POI.lighthouse.x, y + 13, POI.lighthouse.z);
    scene.add(tower);
    var lamp = new THREE.Mesh(new THREE.SphereGeometry(2.2, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
    lamp.position.set(POI.lighthouse.x, y + 27, POI.lighthouse.z);
    scene.add(lamp);
    city.addSolid(POI.lighthouse.x, POI.lighthouse.z, 9, 9, y + 26);
    city.addSign(sg, 25, POI.lighthouse.x, y + 6.5, POI.lighthouse.z + 5, 0, 16, 3);

    // marina: finger jetties and a line of moored hulls
    city.addSign(sg, 27, POI.marina.x + 6, groundY(POI.marina.x + 6, POI.marina.z - 34) + 7,
      POI.marina.z - 34, 0, 24, 4);
    y = 0.5;
    for (var j = 0; j < 4; j++) {
      var jz = POI.marina.z - 24 + j * 16;
      b.addBox(POI.marina.x - 16, y, jz, 42, 0.6, 3.2, 0, 0x7a5a40, 0);
      for (var m = 0; m < 3; m++) {
        var hx = POI.marina.x - 32 + m * 13;
        b.addBox(hx, y + 0.7, jz + 5, 9, 1.6, 3.4, 0, U.pick(Math.random, [0xd8d8e0, 0xc0d8e8, 0xe8e0d0]), 0);
      }
    }

    // Container port: stacks and two gantry cranes, and every last one of them
    // checked against the road network before it goes down. A yard laid out on
    // a fixed grid put boxes across three carriageways.
    var ccol = [0xc85040, 0x4078a8, 0x50a068, 0xb89040, 0x9060a0];
    for (var r2 = 0; r2 < 5; r2++) {
      for (var c2 = 0; c2 < 6; c2++) {
        var bx2 = POI.container.x - 33 + c2 * 14, bz2 = POI.container.z - 26 + r2 * 12;
        if (onRoad(bx2, bz2, 12) || nearSpan(bx2, bz2, 14) || inland(bx2, bz2) < 0.05) continue;
        var cy = groundY(bx2, bz2);
        var stack = 1 + ((r2 * 3 + c2 * 5) % 3);
        for (var st = 0; st < stack; st++) {
          b.addBox(bx2, cy + 1.4 + st * 2.7, bz2, 12, 2.6, 5, 0, ccol[(r2 + c2 + st) % 5], 0);
        }
        city.addSolid(bx2, bz2, 12, 5, cy + stack * 2.7);
      }
    }
    for (var cr = 0; cr < 2; cr++) {
      var crx = POI.container.x - 26, crz = POI.container.z - 44 + cr * 88;
      if (onRoad(crx + 12, crz, 34) || nearSpan(crx + 12, crz, 40) || inland(crx, crz) < 0.06) continue;
      var gy2 = groundY(crx, crz);
      b.addBox(crx, gy2 + 14, crz, 2.4, 28, 2.4, 0, 0xd8a030, 0);
      b.addBox(crx + 24, gy2 + 14, crz, 2.4, 28, 2.4, 0, 0xd8a030, 0);
      b.addBox(crx + 12, gy2 + 28, crz, 60, 2.4, 3, 0, 0xd8a030, 0);
      city.addSolid(crx, crz, 3, 3, gy2 + 28);
      city.addSolid(crx + 24, crz, 3, 3, gy2 + 28);
    }
    city.addSign(sg, 26, POI.container.x, groundY(POI.container.x, POI.container.z) + 12,
      POI.container.z - 34, 0, 30, 5);

    buildObservatory(b, sg, scene);

    // helipad on the Alta Verde lookout, at the top of the switchback
    y = groundY(POI.helipad.x, POI.helipad.z) + 0.09;
    b.addQuad([POI.helipad.x - 9, y, POI.helipad.z - 9], [POI.helipad.x + 9, y, POI.helipad.z - 9],
      [POI.helipad.x + 9, y, POI.helipad.z + 9], [POI.helipad.x - 9, y, POI.helipad.z + 9], 0x1a1a22, [0, 1, 0]);
    b.addBox(POI.helipad.x - 2.2, y + 0.03, POI.helipad.z, 1, 0.02, 7, 0, 0xf0d020, 0);
    b.addBox(POI.helipad.x + 2.2, y + 0.03, POI.helipad.z, 1, 0.02, 7, 0, 0xf0d020, 0);
    b.addBox(POI.helipad.x, y + 0.03, POI.helipad.z, 3.6, 0.02, 1, 0, 0xf0d020, 0);
    var ring = new THREE.Mesh(new THREE.RingGeometry(7.4, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xf0d020, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(POI.helipad.x, y + 0.04, POI.helipad.z);
    scene.add(ring);

    // cove beach: a pale apron where the east coast dips in
    y = groundY(POI.cove.x, POI.cove.z);
    b.addQuad([POI.cove.x - 30, y + 0.05, POI.cove.z - 34], [POI.cove.x + 26, y + 0.05, POI.cove.z - 34],
      [POI.cove.x + 26, y + 0.05, POI.cove.z + 34], [POI.cove.x - 30, y + 0.05, POI.cove.z + 34],
      0xd8c496, [0, 1, 0]);

    [POI.police, POI.hospital, POI.factory, POI.lighthouse, POI.marina,
      POI.container, POI.observatory, POI.helipad, POI.cove].forEach(function (P) {
      reserve(P.x, P.z, 42);
    });
  }

  // The Mirador observatory: a terraced building you can walk up into rather
  // than a block sitting on the hill. A flight of steps on the south face
  // climbs to an open first floor — no interior, just the roof terrace, its
  // parapet, and the rotunda rising out of the middle of it. The far end of
  // the terrace is the only place in the world the rifle exists.
  var OBS = { W: 46, D: 34, H: 7.2, STAIR_W: 9, STAIR_L: 22, PAR: 1.1 };
  function buildObservatory(b, sg, scene) {
    var O = POI.observatory;
    var y = groundY(O.x, O.z);
    var hw = OBS.W / 2, hd = OBS.D / 2, top = y + OBS.H;

    // plinth and main block
    b.addBox(O.x, y + 0.6, O.z, OBS.W + 6, 1.2, OBS.D + 6, 0, 0xb8b4ac, 0);
    b.addBox(O.x, y + OBS.H / 2, O.z, OBS.W, OBS.H, OBS.D, 0, 0xdcdcd4, 0);
    city.addSolid(O.x, O.z, OBS.W, OBS.D, top);
    // pilasters down the long faces, so it reads as a building and not a slab
    for (var i = -3; i <= 3; i++) {
      var px = O.x + i * (OBS.W / 7.4);
      b.addBox(px, y + OBS.H / 2, O.z + hd + 0.35, 1.6, OBS.H, 0.7, 0, 0xf0efe6, 0);
      b.addBox(px, y + OBS.H / 2, O.z - hd - 0.35, 1.6, OBS.H, 0.7, 0, 0xf0efe6, 0);
    }
    // cornice
    b.addBox(O.x, top + 0.3, O.z, OBS.W + 2.4, 0.6, OBS.D + 2.4, 0, 0xf0efe6, 0);

    // The steps. A sloped deck, not a stack of boxes: the walk code will only
    // step you up 20 cm at a time, which would take thirty-six of them.
    // The flight has to arrive at the terrace already at terrace height: stop it
    // short and you are blocked at the wall you are trying to climb onto, and
    // leave a gap instead and there is a strip belonging to neither, which you
    // fall through. So the steps reach `top` exactly at the wall, and a flat
    // landing spans the seam.
    var sx = O.x, foot = O.z + hd + OBS.STAIR_L, sz = O.z + hd + OBS.STAIR_L / 2;
    var footY = groundY(sx, foot);
    city.addDeck({ x: sx, z: sz, w: OBS.STAIR_W, len: OBS.STAIR_L, rot: Math.PI, y0: footY, y1: top });
    city.addDeck({ x: sx, z: O.z + hd - 1.5, w: OBS.STAIR_W, len: 7, rot: 0, y0: top, y1: top });
    var STEPS = 18;
    for (var k = 0; k < STEPS; k++) {
      var t0 = (k + 0.5) / STEPS;
      var zz = foot - OBS.STAIR_L * t0;
      b.addBox(sx, footY + (top - footY) * t0 - 0.06, zz,
        OBS.STAIR_W, 0.18, OBS.STAIR_L / STEPS + 0.06, 0, k % 2 ? 0xd0cfc6 : 0xdcdbd2, 0);
    }
    // cheek walls either side of the flight, so you cannot walk off it
    for (var e2 = 0; e2 < 2; e2++) {
      var ex = sx + (e2 ? 1 : -1) * (OBS.STAIR_W / 2 + 0.5);
      b.addBox(ex, y + OBS.H / 2 + 0.4, sz, 1, OBS.H + 0.8, OBS.STAIR_L, 0, 0xcfcec4, 0);
      city.addSolid(ex, sz, 1, OBS.STAIR_L, top + 0.9);
    }

    // the terrace parapet, open only where the steps arrive
    function parapet(cx, cz, w, d) {
      b.addBox(cx, top + OBS.PAR / 2 + 0.6, cz, w, OBS.PAR, d, 0, 0xf0efe6, 0);
      city.addSolid(cx, cz, w, d, top + OBS.PAR + 0.6);
    }
    parapet(O.x, O.z - hd + 0.5, OBS.W, 1);                       // north
    parapet(O.x - hw + 0.5, O.z, 1, OBS.D);                       // west
    parapet(O.x + hw - 0.5, O.z, 1, OBS.D);                       // east
    var gapHalf = OBS.STAIR_W / 2 + 0.6;                          // south, split
    var run = (OBS.W - gapHalf * 2) / 2;
    parapet(O.x - gapHalf - run / 2, O.z + hd - 0.5, run, 1);
    parapet(O.x + gapHalf + run / 2, O.z + hd - 0.5, run, 1);

    // the rotunda and its dome, standing in the middle of the terrace so the
    // north end of it stays open — that far strip is where the reward sits
    b.addBox(O.x, top + 4.2, O.z, 16, 8, 16, 0, 0xe8e7de, 0);
    city.addSolid(O.x, O.z, 16, 16, top + 8.2);
    var dome = new THREE.Mesh(new THREE.SphereGeometry(8.4, 20, 12, 0, TAU, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0xe4e8f0 }));
    dome.position.set(O.x, top + 8.2, O.z);
    scene.add(dome);
    // two smaller domes on the wings, the way an observatory carries them
    [-1, 1].forEach(function (sgn) {
      var wx = O.x + sgn * (hw - 4.5);
      b.addBox(wx, top + 2.2, O.z + 10, 9, 4, 9, 0, 0xe8e7de, 0);
      city.addSolid(wx, O.z + 10, 9, 9, top + 4.2);
      var d2 = new THREE.Mesh(new THREE.SphereGeometry(4.6, 14, 9, 0, TAU, 0, Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: 0xdfe4ee }));
      d2.position.set(wx, top + 4.2, O.z + 10);
      scene.add(d2);
    });
    var beacon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xff6a9a }));
    beacon.position.set(O.x, top + 18.6, O.z);
    scene.add(beacon);
    city.islaBeacon = beacon;
    city.addSign(sg, 28, O.x, y + 4.6, O.z + hd + 0.9, 0, 26, 4.4);

    // the reward, on the far strip of the terrace from the steps
    city.pickupSpots.push({ x: O.x, z: O.z - hd + 4.5, y: top + 1.1, type: 'rifle' });
    city.islaRifle = { x: O.x, z: O.z - hd + 4.5, y: top + 1.1 };
  }

  // ---------- planting and lighting ----------
  // The island is mostly green, and green nothing reads as a golf course. What
  // grows where follows the same rule as the buildings: palms on the coastal
  // flat, cypress up the hills.
  function buildPlanting(b, rng) {
    var n = 0;
    for (var tries = 0; tries < 6000 && n < 520; tries++) {
      var a = rng() * TAU, rr = Math.sqrt(rng());
      var q = ringPt(a, rr * 0.97);
      var x = q[0], z = q[1];
      if (!contains(x, z) || inland(x, z) < 0.012) continue;
      if (onRoad(x, z, 4)) continue;
      if (nearSpan(x, z, 14)) continue;
      if (nearReserved(x, z, 16)) continue;
      var y = groundY(x, z), hit = false;
      for (var p = 0; p < placed.length; p++) {
        if (U.dist2(x, z, placed[p][0], placed[p][1]) < 13 * 13) { hit = true; break; }
      }
      if (hit) continue;
      n++;
      city.addSolid(x, z, 0.9, 0.9, y + 5, 'prop', true);
      if (y < 5) {
        // palm: a leaning trunk and four fronds
        var s = U.randRange(rng, 0.85, 1.3), th = 6.2 * s;
        b.addBox(x, y + th / 2, z, 0.34 * s, th, 0.34 * s, 0, 0x6a4c34, 0);
        for (var f = 0; f < 4; f++) {
          var fa = f / 4 * TAU + rng();
          b.addBox(x + Math.cos(fa) * 1.5 * s, y + th - 0.2, z + Math.sin(fa) * 1.5 * s,
            3.4 * s, 0.16, 0.7 * s, -fa, 0x2f8a4a, 0);
        }
      } else {
        // cypress: a dark spike, the thing that makes a hillside read as a hill
        var ch = U.randRange(rng, 5, 11);
        b.addBox(x, y + 0.7, z, 0.4, 1.4, 0.4, 0, 0x5a4230, 0);
        b.addBox(x, y + 1.4 + ch * 0.34, z, 2.1, ch * 0.7, 2.1, rng(), 0x1f5c33, 0);
        b.addBox(x, y + 1.4 + ch * 0.82, z, 1.2, ch * 0.42, 1.2, rng(), 0x246a3a, 0);
      }
    }
  }

  // lamps down every road, so the island is not a black hole after dark
  function buildLights(b, glow) {
    for (var i = 0; i < NET.length; i++) {
      var s = NET[i];
      if (s.len < 50) continue;
      var spacing = 58;
      for (var d = spacing / 2; d < s.len; d += spacing) {
        var t = d / s.len;
        var p = segPointAt(s, t), q = segPointAt(s, Math.min(1, t + 0.01));
        var ang = Math.atan2(q[0] - p[0], q[1] - p[1]);
        var side = ((d / spacing) | 0) % 2 ? 1 : -1;
        var ox = p[0] + Math.cos(ang) * (s.w / 2 + 1.4) * side;
        var oz = p[1] - Math.sin(ang) * (s.w / 2 + 1.4) * side;
        // a lamp set off one road can land in the middle of the next one
        if (onRoad(ox, oz, 1)) continue;
        if (nearSpan(ox, oz, 7)) continue;
        var y = groundY(ox, oz);
        b.addBox(ox, y + 3, oz, 0.28, 6, 0.28, 0, 0x3a3a46, 0);
        b.addBox(ox - Math.cos(ang) * 1.1 * side, y + 6.1, oz + Math.sin(ang) * 1.1 * side,
          2.4, 0.22, 0.22, ang, 0x3a3a46, 0);
        glow.addBox(ox - Math.cos(ang) * 2.1 * side, y + 5.9, oz + Math.sin(ang) * 2.1 * side,
          0.7, 0.2, 0.4, ang, 0xffc88a, 0);
        city.addSolid(ox, oz, 0.5, 0.5, y + 6, 'prop', true);
      }
    }
  }

  // ---------- bridge geometry ----------
  // the land under a point, whichever landmass it belongs to
  function groundYAt(x, z) { return contains(x, z) ? groundY(x, z) : 0; }

  function buildSpans(batches, scene) {
    var b = batches.plain, sg = batches.signs, gateBatch = new GeoBatch();
    SPANS.forEach(function (s) {
      var STEPS = Math.max(40, Math.round(s.len / 6));
      for (var k = 0; k < STEPS; k++) {
        var t0 = k / STEPS, t1 = (k + 1) / STEPS;
        var p0 = segPointAt(s, t0), p1 = segPointAt(s, t1);
        var y0 = s.deckY(p0[0], p0[1]), y1 = s.deckY(p1[0], p1[1]);
        if (y0 === null || y1 === null) continue;
        var dx = p1[0] - p0[0], dz = p1[1] - p0[1];
        var l = Math.sqrt(dx * dx + dz * dz) || 1;
        var nx = -dz / l * s.half, nz = dx / l * s.half;
        // deck
        b.addQuad([p0[0] - nx, y0 + 0.07, p0[1] - nz], [p1[0] - nx, y1 + 0.07, p1[1] - nz],
          [p1[0] + nx, y1 + 0.07, p1[1] + nz], [p0[0] + nx, y0 + 0.07, p0[1] + nz], 0x100e16, [0, 1, 0]);
        if (k % 2 === 0) {
          var mx = -dz / l * 0.3, mz = dx / l * 0.3;
          b.addQuad([p0[0] - mx, y0 + 0.09, p0[1] - mz], [p1[0] - mx, y1 + 0.09, p1[1] - mz],
            [p1[0] + mx, y1 + 0.09, p1[1] + mz], [p0[0] + mx, y0 + 0.09, p0[1] + mz], 0xd8b84a, [0, 1, 0]);
        }
        // box girder under the deck, so it reads as a structure from the water
        var D = 1.6;
        b.addQuad([p0[0] - nx, y0 - D, p0[1] - nz], [p0[0] - nx, y0, p0[1] - nz],
          [p1[0] - nx, y1, p1[1] - nz], [p1[0] - nx, y1 - D, p1[1] - nz], 0x232038, null);
        b.addQuad([p0[0] + nx, y0 - D, p0[1] + nz], [p1[0] + nx, y1 - D, p1[1] + nz],
          [p1[0] + nx, y1, p1[1] + nz], [p0[0] + nx, y0, p0[1] + nz], 0x232038, null);
        b.addQuad([p0[0] - nx, y0 - D, p0[1] - nz], [p1[0] - nx, y1 - D, p1[1] - nz],
          [p1[0] + nx, y1 - D, p1[1] + nz], [p0[0] + nx, y0 - D, p0[1] + nz], 0x1a1830, [0, -1, 0]);
        // Parapets only where the deck is actually a bridge. Over the access
        // road at either end it is a street, and a street with a wall down both
        // sides is not an approach, it is a chute.
        var lift = Math.min(s.liftAt(p0[0], p0[1]), s.liftAt(p1[0], p1[1]));
        var fromEnd = Math.min(t0 * s.len, (1 - t1) * s.len);
        var ux = dx / l, uz = dz / l;
        // The abutment wall goes in as soon as the deck is off the ground —
        // not only where the railings are. Anywhere it stands clear of the land
        // beside it without a wall is somewhere you can drive up alongside and
        // pop out on top, because the deck's height applies to anything within
        // half a carriageway of its centreline.
        if (lift > 1.0) {
          for (var aw = 0; aw < 2; aw++) {
            var asg = aw ? 1 : -1;
            var ax0 = p0[0] + nx * asg, az0 = p0[1] + nz * asg;
            var ax1 = p1[0] + nx * asg, az1 = p1[1] + nz * asg;
            var aoX = -uz * asg, aoZ = ux * asg;
            // over open water there is nothing down there to drive on, and a
            // wall to the waterline would make the span read as a causeway
            if (city.isOpenWater(ax0, az0) && city.isOpenWater(ax1, az1)) continue;
            var gb = Math.min(groundYAt(ax0, az0), groundYAt(ax1, az1)) - 0.4;
            b.addQuad([ax0, gb, az0], [ax1, gb, az1], [ax1, y1, az1], [ax0, y0, az0],
              0x2a2740, [aoX, 0, aoZ]);
            city.addSolid((ax0 + ax1) / 2 + aoX * 0.4, (az0 + az1) / 2 + aoZ * 0.4,
              Math.abs(ax1 - ax0) + 0.7, Math.abs(az1 - az0) + 0.7,
              (y0 + y1) / 2, 'abutment', true);
          }
        }
        if (lift < 2.6 || fromEnd < 16) continue;
        for (var e = 0; e < 2; e++) {
          var sgn = e ? 1 : -1;
          var ex0 = p0[0] + nx * sgn, ez0 = p0[1] + nz * sgn;
          var ex1 = p1[0] + nx * sgn, ez1 = p1[1] + nz * sgn;
          // outward normal for this side, so the wall is drawn facing the way
          // it actually points. Handing both sides the same winding leaves one
          // of the two railings backface-culled — invisible from the deck.
          var oX = -uz * sgn, oZ = ux * sgn;
          var TH = 0.34;
          var ix0 = ex0 - oX * TH, iz0 = ez0 - oZ * TH;
          var ix1 = ex1 - oX * TH, iz1 = ez1 - oZ * TH;
          // inner face, looking back across the carriageway
          b.addQuad([ix0, y0, iz0], [ix1, y1, iz1], [ix1, y1 + 1.4, iz1], [ix0, y0 + 1.4, iz0],
            0x46405e, [-oX, 0, -oZ]);
          // outer face, looking out over the water
          b.addQuad([ex0, y0, ez0], [ex1, y1, ez1], [ex1, y1 + 1.4, ez1], [ex0, y0 + 1.4, ez0],
            0x3b3550, [oX, 0, oZ]);
          // the cap, and the neon strip along the top of it
          b.addQuad([ix0, y0 + 1.4, iz0], [ix1, y1 + 1.4, iz1], [ex1, y1 + 1.4, ez1], [ex0, y0 + 1.4, ez0],
            0x4e4768, [0, 1, 0]);
          b.addQuad([ix0, y0 + 1.44, iz0], [ix1, y1 + 1.44, iz1],
            [ix1 + oX * 0.12, y1 + 1.44, iz1 + oZ * 0.12], [ix0 + oX * 0.12, y0 + 1.44, iz0 + oZ * 0.12],
            e ? 0xff4fa3 : 0x38e8ff, [0, 1, 0]);
          city.addSolid((ex0 + ex1) / 2, (ez0 + ez1) / 2, Math.abs(ex1 - ex0) + 0.7,
            Math.abs(ez1 - ez0) + 0.7, (y0 + y1) / 2 + 1.4, 'parapet', true,
            Math.min(y0, y1) - 0.6);
        }
      }
      // piers down to whatever is below — water in the channel, land at the
      // island end where the deck runs on over the shore
      for (var t = 0.06; t < 0.95; t += 0.085) {
        var pp = segPointAt(s, t), py = s.deckY(pp[0], pp[1]);
        if (py === null || s.liftAt(pp[0], pp[1]) < 4) continue;
        var base = contains(pp[0], pp[1]) ? groundY(pp[0], pp[1]) : -1.6;
        b.addBox(pp[0], (py + base) / 2, pp[1], 4, py - base, 4, 0, 0x2e2b44, 0);
      }
      // Lamps down the middle of the span, but only over open water. Over land
      // the deck runs low past whatever is beside it, and a lamp post there
      // lands in a tree or on a roof.
      for (var lt = 0.05; lt < 0.96; lt += 0.055) {
        var lp = segPointAt(s, lt), ly = s.deckY(lp[0], lp[1]);
        if (ly === null || city.islandAt(lp[0], lp[1])) continue;
        if (s.liftAt(lp[0], lp[1]) < 3) continue;
        var ln = segPointAt(s, Math.min(1, lt + 0.01));
        var la = Math.atan2(ln[0] - lp[0], ln[1] - lp[1]);
        // The arm and its head lean IN over the carriageway, whichever side the
        // post stands on. The old offset ignored which side that was, so every
        // other lamp hung its head outward over the sea — and the arm's spin
        // used the mirrored angle, which turned it off-axis on the diagonal
        // span. In this addBox convention a box long in x with rotY=a points
        // along (cos a, -sin a), the across-deck normal, so rotY is +la.
        var lnx = Math.cos(la), lnz = -Math.sin(la);
        var lside = ((lt * 100) | 0) % 2 ? 1 : -1;
        var lx = lp[0] + lnx * (s.half - 0.5) * lside;
        var lz = lp[1] + lnz * (s.half - 0.5) * lside;
        b.addBox(lx, ly + 3.4, lz, 0.26, 6, 0.26, 0, 0x3a3a46, 0);
        b.addBox(lx - lnx * lside * 1.1, ly + 6.5, lz - lnz * lside * 1.1, 2.2, 0.2, 0.2, la, 0x3a3a46, 0);
        batches.glow.addBox(lx - lnx * lside * 2.0, ly + 6.3, lz - lnz * lside * 2.0, 0.66, 0.2, 0.4, la, 0xffc88a, 0);
      }
      // gantries where the climb starts and where it sets down, not out in the
      // junction the approach leaves from. Each carries the name of where the
      // deck is taking you.
      [(s.flatIn + 6) / s.len, 1 - (s.rampOut * 0.55) / s.len].forEach(function (t2, endI) {
        var g = segPointAt(s, t2), gy = s.deckY(g[0], g[1]);
        if (gy === null) return;
        var nxt = segPointAt(s, U.clamp(t2 + 0.01, 0, 1));
        var ang = Math.atan2(nxt[0] - g[0], nxt[1] - g[1]);
        var px = Math.cos(ang) * s.half, pz = -Math.sin(ang) * s.half;
        b.addBox(g[0] + px, gy + 9, g[1] + pz, 1.6, 18, 1.6, 0, 0x3a3552, 0);
        b.addBox(g[0] - px, gy + 9, g[1] - pz, 1.6, 18, 1.6, 0, 0x3a3552, 0);
        b.addBox(g[0], gy + 17.4, g[1], Math.abs(px) * 2 + 2, 1.6, Math.abs(pz) * 2 + 2, 0, 0x3a3552, 0);
        // the destination board, hung under the beam and facing the driver
        // coming at it — one at each end of each bridge, four in all
        // hung 1.2 m off the gantry line: the pillars are 1.6 m deep, so a
        // board at 0.8 m sits exactly in their faces and shimmers against them
        var slot = endI === 0 ? 32 : 33;              // ISLA VERDE / COSTA ROSA
        var facing = endI === 0 ? ang + Math.PI : ang;
        var back = endI === 0 ? -1 : 1;
        city.addSign(sg, slot, g[0] + Math.sin(ang) * back * 1.2, gy + 12.2,
          g[1] + Math.cos(ang) * back * 1.2, facing, s.half * 2 - 1, 3.6);
      });

      // The barrier: a police line across the mainland end, gone once the
      // bridges open. It stands where the railings begin rather than out on the
      // flat approach — down there the deck is at street level with open sand
      // either side, so you could drive round the end of it and rejoin the
      // bridge further along. Between the walls there is nowhere to go.
      var gd = s.flatIn + 10;
      while (gd < s.len * 0.5) {
        var gq = segPointAt(s, gd / s.len);
        if (s.liftAt(gq[0], gq[1]) >= 2.9) break;
        gd += 2;
      }
      gd += 6;
      var gp = segPointAt(s, gd / s.len);
      var gnx = segPointAt(s, (gd + 10) / s.len);
      var ga = Math.atan2(gnx[0] - gp[0], gnx[1] - gp[1]);
      var gy2 = s.deckY(gp[0], gp[1]) || 0;
      gateBatch.addBox(gp[0], gy2 + 1.3, gp[1], s.half * 2 + 2, 2.6, 1.4, ga, 0xd8d0c0, 0);
      gateBatch.addBox(gp[0], gy2 + 2.8, gp[1], s.half * 2 + 2, 0.5, 1.6, ga, 0xff4f4f, 0);
      var g1 = city.addSolid(gp[0], gp[1], Math.abs(Math.cos(ga)) * (s.half * 2 + 2) + 1.6,
        Math.abs(Math.sin(ga)) * (s.half * 2 + 2) + 1.6, gy2 + 3.0, 'gate', true);
      g1.gateH = gy2 + 2.6;
      gates.push(g1);
    });
    var gm = new THREE.Mesh(gateBatch.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    gm.matrixAutoUpdate = false;
    scene.add(gm);
    city.islaGateMesh = gm;
  }

  // ---------- spots ----------
  function buildSpots(rng) {
    // parked cars along the island roads, hugging the verge
    for (var i = 0; i < NET.length; i++) {
      var s = NET[i];
      if (s.kind === 'ring' || s.len < 40) continue;
      for (var d = 30; d < s.len - 30; d += U.randRange(rng, 60, 130)) {
        var t = d / s.len;
        var p = segPointAt(s, t), q = segPointAt(s, Math.min(1, t + 0.01));
        var ang = Math.atan2(q[0] - p[0], q[1] - p[1]);
        var side = rng() < 0.5 ? 1 : -1;
        var ox = p[0] + Math.cos(ang) * (s.w / 2 - 0.8) * side;
        var oz = p[1] - Math.sin(ang) * (s.w / 2 - 0.8) * side;
        if (nearSpan(ox, oz, 8)) continue;
        city.parkedSpots.push({ x: ox, z: oz, heading: ang, isla: true });
      }
    }
    // the ice cream truck waits on the factory forecourt
    city.parkedSpots.push({ x: POI.factory.x + 30, z: POI.factory.z + 8, heading: Math.PI / 2, vtype: 'icecream' });
    // cruisers outside the island station, an ambulance at the island hospital
    city.parkedSpots.push({ x: POI.police.x - 20, z: POI.police.z - 6, heading: 0, police: true });
    city.parkedSpots.push({ x: POI.police.x + 20, z: POI.police.z - 6, heading: 0, police: true });
    // the helicopter, which now lives only up here
    city.parkedSpots.push({ x: POI.helipad.x, z: POI.helipad.z, heading: Math.PI, vtype: 'helicopter' });
    // a buggy on the cove, a pickup at the villas, a limo at the resort
    city.parkedSpots.push({ x: POI.cove.x - 12, z: POI.cove.z + 6, heading: Math.PI, vtype: 'buggy' });
    city.parkedSpots.push({ x: tx(900), z: tz(-282), heading: 0, vtype: 'pickup' });
    city.parkedSpots.push({ x: tx(1206), z: tz(66), heading: Math.PI / 2, vtype: 'limo' });

    // pickups on the island: a couple of weapons and some health
    var pk = [['health', 902, 78], ['armor', 1268, 150], ['smg', 1006, -278],
      ['health', 1164, 420], ['shotgun', 812, 260]];
    pk.forEach(function (P) { city.pickupSpots.push({ x: P[1], z: P[2], type: P[0] }); });
  }

  // ---------- lane graph ----------
  // nodes strung along every road, joined end to end and cross-linked wherever
  // two roads pass close, so traffic and the map router treat the island's
  // curves exactly like the mainland's grid
  function laneNodes() {
    var nodes = [], i, k;
    for (i = 0; i < NET.length; i++) {
      var s = NET[i];
      var n = Math.max(1, Math.round(s.len / 34));
      var run = [];
      for (k = 0; k <= n; k++) {
        var p = segPointAt(s, k / n);
        var nd = { x: p[0], z: p[1], nb: [], isla: true };
        nodes.push(nd); run.push(nd);
      }
      for (k = 1; k < run.length; k++) { run[k - 1].nb.push(run[k]); run[k].nb.push(run[k - 1]); }
    }
    for (i = 0; i < nodes.length; i++) {
      for (k = i + 1; k < nodes.length; k++) {
        if (U.dist2(nodes[i].x, nodes[i].z, nodes[k].x, nodes[k].z) > 18 * 18) continue;
        if (nodes[i].nb.indexOf(nodes[k]) >= 0) continue;
        nodes[i].nb.push(nodes[k]); nodes[k].nb.push(nodes[i]);
      }
    }
    return nodes;
  }
  // where each bridge meets the mainland and the island, so the two graphs join
  function spanNodes() {
    var out = [];
    SPANS.forEach(function (s) {
      var n = Math.max(2, Math.round(s.len / 34)), run = [];
      for (var k = 0; k <= n; k++) {
        var p = segPointAt(s, k / n);
        var nd = { x: p[0], z: p[1], nb: [], span: true };
        out.push(nd); run.push(nd);
      }
      for (var j = 1; j < run.length; j++) { run[j - 1].nb.push(run[j]); run[j].nb.push(run[j - 1]); }
    });
    return out;
  }

  function build(scene) {
    var rng = mulberry32(0x15a5e);
    var batches = {
      plain: new GeoBatch(), generic: new GeoBatch(),
      strip: new GeoBatch(), downtown: new GeoBatch(), signs: new GeoBatch(),
      glow: new GeoBatch()
    };
    buildLand(batches.plain);
    buildRoads(batches.plain);
    buildLandmarks(batches, scene);
    buildBlocks(batches, rng);
    buildPlanting(batches.plain, rng);
    buildLights(batches.plain, batches.glow);
    buildSpans(batches, scene);
    buildSpots(rng);

    function addMesh(batch, mat) {
      var m = new THREE.Mesh(batch.build(), mat);
      m.matrixAutoUpdate = false;
      scene.add(m);
      return m;
    }
    addMesh(batches.plain, new THREE.MeshLambertMaterial({ vertexColors: true }));
    addMesh(batches.generic, city.lam(city.tex.generic));
    addMesh(batches.strip, city.lam(city.tex.strip));
    addMesh(batches.downtown, city.lam(city.tex.downtown));
    addMesh(batches.glow, new THREE.MeshBasicMaterial({ vertexColors: true }));
    addMesh(batches.signs, new THREE.MeshBasicMaterial({
      map: city.signTex, transparent: true, vertexColors: true, side: THREE.DoubleSide
    }));

    setOpen(missionsDone() >= REQUIRED);
  }

  // A word at the barrier, so a closed bridge explains itself instead of just
  // being a thing you bounce off.
  var hintT = 0, arrived = false;
  function tick(dt) {
    var P = GAME.player;
    if (!P || P.state !== 'alive') return;
    var px = P.inCar && P.car ? P.car.pos.x : P.pos.x;
    var pz = P.inCar && P.car ? P.car.pos.z : P.pos.z;
    if (!arrived && contains(px, pz)) {
      arrived = true;
      GAME.hud.message('ISLA VERDE — hill roads, a working port, and a factory that makes ice cream.', 5);
      GAME.track('isla-first-arrival');
    }
    hintT -= dt;
    if (open || hintT > 0 || !gates.length) return;
    for (var i = 0; i < gates.length; i++) {
      var g = gates[i];
      var cx = (g.minX + g.maxX) / 2, cz = (g.minZ + g.maxZ) / 2;
      if (U.dist2(px, pz, cx, cz) > 34 * 34) continue;
      var p = unlockProgress();
      hintT = 6;
      GAME.hud.message('BRIDGE CLOSED — finish ' + (p.need - p.done) + ' more job' +
        (p.need - p.done === 1 ? '' : 's') + ' in Costa Rosa and it opens.', 3.5);
      return;
    }
  }

  // the island's own district names, so the HUD reads the same over here
  function districtName(x, z) {
    var a = (x - C.cx) / GROW + AX, b = (z - C.cz) / GROW + AZ;
    if (b < -100) return 'Alta Verde';
    if (a > 1090) return 'Mirador';
    if (b > 230) return 'Costa Sur';
    return 'Puerto Dorado';
  }

  return {
    register: register, build: build, contains: contains, groundY: groundY,
    onRoad: onRoad, nearestRoadPoint: nearestRoadPoint, districtName: districtName,
    laneNodes: laneNodes, spanNodes: spanNodes, pois: function () { return POI; }, tick: tick,
    bounds: function () { return C; },
    isOpen: function () { return open; }, setOpen: setOpen,
    checkUnlock: checkUnlock, required: REQUIRED, unlockProgress: unlockProgress,
    missionsDone: missionsDone, spans: function () { return SPANS; }
  };
})();
