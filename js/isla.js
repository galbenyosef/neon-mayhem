// Isla Verde — the second landmass, east across the channel, and the bridge
// that reaches it.
//
// Phase one is deliberately grey-boxed: the ground, the coastline, a street
// grid and enough massing to read as a skyline through the haze. The point is
// to answer two questions before any content is built — does the crossing feel
// like an event, and does the far shore make you want to go — because those are
// the only two things that can't be judged from a plan.
GAME.isla = (function () {
  var city = null;

  // Channel width is the whole trick. Fog closes at 430 m on desktop and 320 on
  // touch, so at this range the far shore is a hazy silhouette: enough to know
  // a city is out there, not enough to see what it holds.
  var C = { cx: 995, cz: 30, rx: 262, rz: 335 };

  // an off-round coastline, so it doesn't read as the same rectangle again
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

  // The bridge carries the z=50 boulevard east. It climbs off the mainland,
  // runs flat over open water, and comes back down onto the far shore; the
  // grade eases at every join so nothing bangs over a crease.
  var B = { z: 50, half: 7, h: 9, x0: 352, x1: 0, rampIn: 70, rampOut: 70 };

  function ease(t) { return t * t * (3 - 2 * t); }

  function deckY(x, z) {
    if (Math.abs(z - B.z) > B.half) return null;
    if (x < B.x0 || x > B.x1) return null;
    var upEnd = B.x0 + B.rampIn, downStart = B.x1 - B.rampOut;
    if (x >= upEnd && x <= downStart) return B.h;
    if (x < upEnd) return B.h * ease((x - B.x0) / B.rampIn);
    return B.h * ease((B.x1 - x) / B.rampOut);
  }

  function register(c) {
    city = c;
    city.addIsland({ id: 'isla', name: 'Isla Verde', contains: contains, centre: { x: C.cx, z: C.cz } });
    // the far abutment sits wherever the coast actually is on this line
    var bx = 600;
    while (bx < 1400 && !contains(bx, B.z)) bx += 1;
    B.x1 = bx + 6;
    city.addCrossing({ id: 'causeway', name: 'Isla Verde Bridge', z: B.z, half: B.half, deckY: deckY,
      x0: B.x0, x1: B.x1, height: B.h });
    city.isla = { bounds: C, bridge: B, contains: contains };
  }

  // ---------- geometry ----------
  function buildGround(scene, b) {
    // the land itself, as a fan of quads following the coastline
    var STEP = 0.06;
    for (var a = 0; a < Math.PI * 2 - 0.001; a += STEP) {
      var a2 = a + STEP;
      var r1 = edge(a), r2 = edge(a2);
      var p1 = [C.cx + Math.cos(a) * C.rx * r1, 0, C.cz + Math.sin(a) * C.rz * r1];
      var p2 = [C.cx + Math.cos(a2) * C.rx * r2, 0, C.cz + Math.sin(a2) * C.rz * r2];
      b.addQuad([C.cx, 0, C.cz], p1, p2, [C.cx, 0, C.cz], 0x18141f, [0, 1, 0]);
      // a pale rim so the coast reads against the water from across the channel
      var s1 = [p1[0] + (C.cx - p1[0]) * 0.045, 0.04, p1[2] + (C.cz - p1[2]) * 0.045];
      var s2 = [p2[0] + (C.cx - p2[0]) * 0.045, 0.04, p2[2] + (C.cz - p2[2]) * 0.045];
      b.addQuad([p1[0], 0.04, p1[2]], [p2[0], 0.04, p2[2]], s2, s1, 0x6a6048, [0, 1, 0]);
    }
  }

  // a street grid clipped to the coast, offset from the mainland's so the two
  // don't read as the same town twice
  // the bridge line is one of the island's own streets, so the boulevard simply
  // carries on across the water instead of landing in the side of a building
  var GX = [790, 890, 990, 1090, 1190], GZ = [-250, -150, -50, 50, 150, 250];
  var HALF = 6;

  function onRoad(x, z) {
    for (var i = 0; i < GX.length; i++) if (Math.abs(x - GX[i]) < HALF) return true;
    for (var j = 0; j < GZ.length; j++) if (Math.abs(z - GZ[j]) < HALF) return true;
    return false;
  }

  function buildRoads(scene, b) {
    var i, t;
    for (i = 0; i < GX.length; i++) {
      for (t = C.cz - C.rz * 1.2; t < C.cz + C.rz * 1.2; t += 8) {
        if (contains(GX[i], t)) b.addGroundQuad(GX[i], 0.05, t + 4, HALF * 2, 8.2, 0, 0x100e16);
      }
    }
    for (i = 0; i < GZ.length; i++) {
      for (t = C.cx - C.rx * 1.2; t < C.cx + C.rx * 1.2; t += 8) {
        if (contains(t, GZ[i])) b.addGroundQuad(t + 4, 0.05, GZ[i], 8.2, HALF * 2, 0, 0x100e16);
      }
    }
  }

  // Grey-box massing. Not the final architecture — just enough silhouette to
  // judge whether the far shore pulls you toward it.
  function buildBlocks(scene, b, rng) {
    var shades = [0x231d33, 0x2b2340, 0x1d1a2c, 0x322745];
    for (var i = 0; i < GX.length - 1; i++) {
      for (var j = 0; j < GZ.length - 1; j++) {
        var cx = (GX[i] + GX[i + 1]) / 2, cz = (GZ[j] + GZ[j + 1]) / 2;
        for (var k = 0; k < 4; k++) {
          var ox = cx + U.randRange(rng, -30, 30), oz = cz + U.randRange(rng, -30, 30);
          if (onRoad(ox, oz) || !contains(ox, oz)) continue;
          // keep the bridge landing clear so you arrive on tarmac, not a wall
          if (ox < GX[0] + 24 && Math.abs(oz - B.z) < 26) continue;
          // inland towers stand tallest, so the skyline builds up behind the coast
          var inland = 1 - Math.min(1, U.dist(ox, oz, C.cx, C.cz) / (C.rx * 1.05));
          var w = U.randRange(rng, 18, 30), d = U.randRange(rng, 18, 30);
          var h = U.randRange(rng, 22, 46) + inland * U.randRange(rng, 20, 90);
          b.addBox(ox, h / 2, oz, w, h, d, 0, U.pick(rng, shades), 0);
          city.addSolid(ox, oz, w, d, h);
        }
      }
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
      // the girder under it, raked with the deck
      var gN = zN - 0.6, gS = zS + 0.6, D = 1.4;
      b.addQuad([x, ya - D, gN], [x, ya, gN], [x1, yb, gN], [x1, yb - D, gN], 0x232038, [0, 0, -1]);
      b.addQuad([x, ya - D, gS], [x1, yb - D, gS], [x1, yb, gS], [x, ya, gS], 0x232038, [0, 0, 1]);
      b.addQuad([x, ya - D, gN], [x1, yb - D, gN], [x1, yb - D, gS], [x, ya - D, gS], 0x1a1830, [0, -1, 0]);
      // parapets, and the neon that makes the span read at night from the beach
      for (var e = 0; e < 2; e++) {
        var ez = e ? zS : zN;
        strip(x, x1, ya + 1.4, yb + 1.4, ez - 0.35, ez + 0.35, 0x46405e);
        b.addQuad([x, ya, ez - 0.35], [x1, yb, ez - 0.35], [x1, yb + 1.4, ez - 0.35], [x, ya + 1.4, ez - 0.35], 0x46405e, [0, 0, -1]);
        b.addQuad([x1, yb, ez + 0.35], [x, ya, ez + 0.35], [x, ya + 1.4, ez + 0.35], [x1, yb + 1.4, ez + 0.35], 0x46405e, [0, 0, 1]);
        strip(x, x1, ya + 1.48, yb + 1.48, ez - 0.15, ez + 0.15, e ? 0xff4fa3 : 0x38e8ff);
        city.addSolid((x + x1) / 2, ez, SEG, 0.7, ym + 1.4, 'parapet', true);
      }
    }
    // piers down into the water
    for (var px = B.x0 + 30; px < B.x1 - 20; px += 40) {
      var py = deckY(px, B.z) || 0;
      if (py < 2) continue;
      var col = py + 2;
      b.addBox(px, col / 2 - 2, B.z - 8.2, 3.4, col, 3.4, 0, 0x2e2b44, 0);
      b.addBox(px, col / 2 - 2, B.z + 8.2, 3.4, col, 3.4, 0, 0x2e2b44, 0);
      b.addBox(px, py - 1.8, B.z, 3.4, 0.9, 19, 0, 0x2a2740, 0);
    }
    // a lit portal at each end so the crossing announces itself
    for (var t = 0; t < 2; t++) {
      var tx = t ? B.x1 - 14 : B.x0 + 14, ty = deckY(tx, B.z) || 0;
      b.addBox(tx, ty + 9, zN - 1.2, 1.6, 18, 1.6, 0, 0x3a3552, 0);
      b.addBox(tx, ty + 9, zS + 1.2, 1.6, 18, 1.6, 0, 0x3a3552, 0);
      b.addBox(tx, ty + 17.4, B.z, 1.6, 1.6, B.half * 2 + 4, 0, 0x3a3552, 0);
      b.addBox(tx, ty + 18.3, B.z, 0.7, 0.4, B.half * 2 + 4, 0, 0x38e8ff, 0);
    }
  }

  function build(scene) {
    var rng = mulberry32(0x15a5e);
    var b = new GeoBatch();
    buildGround(scene, b);
    buildRoads(scene, b);
    buildBlocks(scene, b, rng);
    buildBridge(scene, b);
    var mesh = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    city.islaMesh = mesh;
  }

  return { register: register, build: build, contains: contains, deckY: deckY };
})();
