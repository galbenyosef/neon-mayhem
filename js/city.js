GAME.city = (function () {
  // Roads on a grid; +x east toward the ocean, +z south. Boulevard is the x=350 road.
  var R = [-450, -350, -250, -150, -50, 50, 150, 250, 350];
  var ROAD_HALF = 6, SIDEWALK_OUT = 10;
  var BOARDWALK_X0 = 360, BOARDWALK_X1 = 370, SAND_X0 = 370;
  var rng = mulberry32(198619);

  var city = {
    R: R,
    ROAD_HALF: ROAD_HALF,
    hash: new SpatialHash(25),
    parkedSpots: [],
    pickupSpots: [],
    palmSpots: [],
    signNames: [],
    pois: {
      hospitals: [
        { x: 0, z: 128, spawn: { x: 0, z: 138 } },
        { x: -400, z: 18, spawn: { x: -400, z: 40 } }
      ],
      police: { x: -150, z: -122, spawn: { x: -150, z: -134 } },
      resprays: [
        { x: 180, z: -80, door: { x: 166, z: -80 } },
        { x: -428, z: -180, door: { x: -442, z: -180 } },
        { x: 272, z: -420, door: { x: 258, z: -420 } }
      ]
    },
    landBounds: { minX: -500, maxX: 356, minZ: -500, maxZ: 500 }
  };

  city.shoreline = function (z) {
    return 432 + 20 * Math.sin(z * 0.006) + 8 * Math.sin(z * 0.021 + 2);
  };
  // the city is an island: curved waterlines on the other three sides
  city.westShore = function (z) { return -512 + 7 * Math.sin(z * 0.009 + 1.5); };
  city.northShore = function (x) { return -512 + 7 * Math.sin(x * 0.011 + 4); };
  city.southShore = function (x) { return 512 + 7 * Math.sin(x * 0.013 + 2); };
  city.isOnPier = function (x, z) {
    return x > 356 && x < 505 && (Math.abs(z - 150) < 8 || Math.abs(z + 180) < 8);
  };
  city.isInWater = function (x, z) {
    if (city.isOnPier(x, z)) return false;
    if (x > city.shoreline(z) + 2) return true;
    if (x < city.westShore(z)) return true;
    if (z < city.northShore(x)) return true;
    if (z > city.southShore(x)) return true;
    return false;
  };
  city.isOnSand = function (x, z) {
    if (city.isOnPier(x, z)) return false;
    return x > BOARDWALK_X1 && x <= city.shoreline(z) + 2;
  };
  city.groundY = function (x, z) {
    if (city.isOnPier(x, z) && x > BOARDWALK_X1) return 0.5;
    if (x > BOARDWALK_X0 && x <= BOARDWALK_X1) return 0.3;
    if (city.isOnSand(x, z)) {
      var sh = city.shoreline(z);
      var t = U.clamp((x - SAND_X0) / Math.max(1, sh - SAND_X0), 0, 1);
      return 0.25 - 0.85 * t;
    }
    return 0;
  };
  city.districtAt = function (x, z) {
    if (x >= 160) return 'strip';
    if (x <= -140 && z >= 140) return 'harbor';
    if (x >= -260 && x <= 60 && z >= -260 && z <= 60) return 'downtown';
    return 'residential';
  };
  city.districtName = function (x, z) {
    if (x > 340) return 'Ocean Strip';
    var d = city.districtAt(x, z);
    return d === 'strip' ? 'Ocean Strip' : d === 'harbor' ? 'Puerto Viejo' : d === 'downtown' ? 'Centro Alto' : 'Las Colinas';
  };
  city.nearestRoadPoint = function (x, z) {
    var bx = R[0], bz = R[0], dx = 1e9, dz = 1e9;
    for (var i = 0; i < R.length; i++) {
      if (Math.abs(R[i] - x) < dx) { dx = Math.abs(R[i] - x); bx = R[i]; }
      if (Math.abs(R[i] - z) < dz) { dz = Math.abs(R[i] - z); bz = R[i]; }
    }
    // snap the closer axis, keep the other free (stay on that road line)
    if (dx < dz) return { x: bx, z: U.clamp(z, -480, 480), axis: 'z' };
    return { x: U.clamp(x, -480, 340), z: bz, axis: 'x' };
  };

  // reserved rects that block generation must not overlap
  var reserved = [
    { minX: -40, maxX: 40, minZ: 95, maxZ: 165 },      // hospitals
    { minX: -440, maxX: -360, minZ: -10, maxZ: 48 },
    { minX: -195, maxX: -105, minZ: -138, maxZ: -85 }, // police station
    { minX: 155, maxX: 215, minZ: -110, maxZ: -50 },   // respray garages
    { minX: -448, maxX: -408, minZ: -200, maxZ: -160 },
    { minX: 252, maxX: 292, minZ: -440, maxZ: -400 }
  ];
  function overlapsReserved(minX, maxX, minZ, maxZ) {
    for (var i = 0; i < reserved.length; i++) {
      var r = reserved[i];
      if (minX < r.maxX && maxX > r.minX && minZ < r.maxZ && maxZ > r.minZ) return true;
    }
    return false;
  }

  function addSolid(cx, cz, sx, sz, h, tag, noLOS) {
    city.hash.insert({ minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2, h: h, tag: tag || 'building', noLOS: !!noLOS });
  }

  // ---------- canvas textures ----------
  function windowTexture(bg, litColors, cols, rows, litProb, bandColor) {
    var cv = document.createElement('canvas');
    cv.width = 512; cv.height = 384;
    var g = cv.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, 512, 384);
    var cw = 512 / cols, ch = 384 / rows;
    for (var i = 0; i < cols; i++) for (var j = 0; j < rows; j++) {
      var lit = rng() < litProb;
      var pad = cw * 0.22;
      g.fillStyle = lit ? litColors[Math.floor(rng() * litColors.length)] : 'rgba(30,34,58,0.9)';
      g.fillRect(i * cw + pad, j * ch + ch * 0.2, cw - pad * 2, ch * 0.55);
    }
    if (bandColor) {
      g.fillStyle = bandColor;
      for (var b = 0; b < rows; b++) g.fillRect(0, b * ch - 2, 512, 5);
    }
    // keep left column dark so roof uvs sample facade color
    g.fillStyle = bg; g.fillRect(0, 0, Math.floor(cw * 0.2), 384);
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  var SIGN_TEXTS = ['CLUB FLAMINGO', 'HOTEL MIRAJE', "ROXY'S", 'EL DORADO', 'NEON PALMS', 'TIKI LOUNGE',
    'LA SIRENA', 'STARDUST', 'CASA AZUL', 'VOLTAGE', 'PINK IGUANA', 'INFERNO ROOM',
    'COCKTAILS', 'ARCADE', 'HOTEL RIVIERA', 'PALM COURT', 'DISCO 2000', 'MOTEL LUNA',
    'RESPRAY', 'HOSPITAL', 'POLICE', 'AXIS TOWER', 'COSTA ROSA PIER', 'FUN FAIR'];
  var SIGN_COLORS = ['#ff4fa3', '#38e8ff', '#ffe14f', '#7dff6a', '#ff8a3d', '#c86bff', '#ff5d5d', '#59ffc8'];
  function signAtlas() {
    var cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 1024;
    var g = cv.getContext('2d');
    g.fillStyle = '#07040c'; g.fillRect(0, 0, 1024, 1024);
    var slots = [];
    for (var i = 0; i < SIGN_TEXTS.length; i++) {
      var col = i % 2, row = Math.floor(i / 2);
      var x = col * 512, y = row * 85;
      var color = SIGN_TEXTS[i] === 'HOSPITAL' ? '#ff6a6a' : SIGN_TEXTS[i] === 'POLICE' ? '#5aa0ff' : SIGN_COLORS[i % SIGN_COLORS.length];
      g.save();
      g.font = 'italic 900 52px "Segoe UI", Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = color; g.shadowBlur = 22;
      g.strokeStyle = color; g.lineWidth = 2;
      g.fillStyle = '#ffffff';
      g.strokeText(SIGN_TEXTS[i], x + 256, y + 44, 490);
      g.shadowBlur = 10;
      g.fillText(SIGN_TEXTS[i], x + 256, y + 44, 490);
      g.restore();
      slots.push({ u0: x / 1024, v0: 1 - (y + 85) / 1024, u1: (x + 512) / 1024, v1: 1 - y / 1024 });
    }
    return { tex: new THREE.CanvasTexture(cv), slots: slots };
  }
  function radialGlowTexture(color) {
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    var g = cv.getContext('2d');
    var gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(cv);
  }

  // ---------- build ----------
  city.build = function (scene) {
    city.scene = scene;
    var batches = {
      ground: new GeoBatch(),
      marks: new GeoBatch(),
      downtown: new GeoBatch(),
      strip: new GeoBatch(),
      generic: new GeoBatch(),
      harbor: new GeoBatch(),
      wood: new GeoBatch(),
      glow: new GeoBatch(),
      signs: new GeoBatch()
    };
    var atlas = signAtlas();
    city.signSlots = atlas.slots;

    // base land
    batches.ground.addGroundQuad(-70, 0, 0, 860, 1000, 0, 0x17131f);
    // asphalt: vertical roads
    var asphalt = new GeoBatch();
    for (var i = 0; i < R.length; i++) {
      asphalt.addGroundQuad(R[i], 0.03, 0, ROAD_HALF * 2, 960, 0, 0x100e16);
      asphalt.addGroundQuad(-72, 0.03, R[i], 856, ROAD_HALF * 2, 0, 0x100e16);
      // dashed center lines
      for (var d = -470; d < 470; d += 12) {
        batches.marks.addGroundQuad(R[i], 0.06, d + 3, 0.25, 4, 0, 0xd8c46a);
        if (d > -500 && d < 350) batches.marks.addGroundQuad(d + 3, 0.06, R[i], 4, 0.25, 0, 0xd8c46a);
      }
    }
    // sidewalks around each block
    for (var bi = 0; bi < R.length - 1; bi++) for (var bj = 0; bj < R.length - 1; bj++) {
      var cx = (R[bi] + R[bi + 1]) / 2, cz = (R[bj] + R[bj + 1]) / 2;
      batches.ground.addBox(cx, 0.09, cz - 42, 88, 0.18, 4, 0, 0x2c2838, 0);
      batches.ground.addBox(cx, 0.09, cz + 42, 88, 0.18, 4, 0, 0x2c2838, 0);
      batches.ground.addBox(cx - 42, 0.085, cz, 4, 0.17, 80, 0, 0x2c2838, 0);
      batches.ground.addBox(cx + 42, 0.085, cz, 4, 0.17, 80, 0, 0x2c2838, 0);
    }
    // boulevard east sidewalk
    batches.ground.addBox(358, 0.09, 0, 4, 0.18, 960, 0, 0x2c2838, 0);

    buildBlocks(batches, atlas);
    buildPOIs(batches, atlas);
    buildBeach(scene, batches);
    buildSky(scene);

    // no boundary walls: the surrounding sea is the soft boundary

    // materials + meshes
    var texDowntown = windowTexture('#101322', ['#ffe9a8', '#a8e8ff', '#ffd0e8', '#c8ffe0'], 10, 8, 0.5);
    var texStrip = windowTexture('#241a2e', ['#ffe9a8', '#ffd0e8'], 8, 5, 0.4, 'rgba(90,60,90,0.8)');
    var texGeneric = windowTexture('#181420', ['#ffe0a0', '#d8c8ff'], 9, 7, 0.3);
    var texHarbor = windowTexture('#1a1a20', ['#ffd890'], 6, 3, 0.15, 'rgba(60,62,70,0.9)');

    function lam(tex) {
      return new THREE.MeshLambertMaterial({ map: tex, emissive: 0xbbbbcc, emissiveMap: tex, vertexColors: true });
    }
    function addMesh(batch, mat) {
      var m = new THREE.Mesh(batch.build(), mat);
      m.matrixAutoUpdate = false;
      scene.add(m);
      return m;
    }
    addMesh(batches.ground, new THREE.MeshLambertMaterial({ vertexColors: true }));
    addMesh(asphalt, new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: 0x232e42 }));
    addMesh(batches.marks, new THREE.MeshBasicMaterial({ vertexColors: true }));
    addMesh(batches.downtown, lam(texDowntown));
    addMesh(batches.strip, lam(texStrip));
    addMesh(batches.generic, lam(texGeneric));
    addMesh(batches.harbor, lam(texHarbor));
    addMesh(batches.wood, new THREE.MeshLambertMaterial({ vertexColors: true }));
    city.signMesh = addMesh(batches.signs, new THREE.MeshBasicMaterial({ map: atlas.tex, transparent: true, vertexColors: true, side: THREE.DoubleSide }));
    var glowMat = new THREE.MeshBasicMaterial({ map: radialGlowTexture('rgba(255,176,102,0.55)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    addMesh(batches.glow, glowMat);

    buildInstancedProps(scene);
    buildLandmarks(scene);
    buildLaneGraph();
    buildSpots();
  };

  var signBatchRef = null;
  function addSign(batch, slotIdx, x, y, z, rotY, w, h, tint) {
    var s = city.signSlots[slotIdx];
    batch.addWallQuad(x, y, z, w, h, rotY, tint === undefined ? 0xffffff : tint, s.u0, s.v0, s.u1, s.v1);
  }

  function buildBlocks(batches, atlas) {
    for (var bi = 0; bi < R.length - 1; bi++) for (var bj = 0; bj < R.length - 1; bj++) {
      var cx = (R[bi] + R[bi + 1]) / 2, cz = (R[bj] + R[bj + 1]) / 2;
      var d = city.districtAt(cx, cz);
      if (d === 'downtown') buildDowntownBlock(batches, cx, cz);
      else if (d === 'strip') buildStripBlock(batches, cx, cz, bi === R.length - 2);
      else if (d === 'harbor') buildHarborBlock(batches, cx, cz);
      else buildGenericBlock(batches, cx, cz);
    }
  }

  function tryBuilding(batch, cx, cz, sx, sz, h, color, uvScale) {
    if (overlapsReserved(cx - sx / 2, cx + sx / 2, cz - sz / 2, cz + sz / 2)) return false;
    batch.addBox(cx, h / 2, cz, sx, h, sz, 0, color, uvScale);
    addSolid(cx, cz, sx, sz, h);
    return true;
  }

  function buildDowntownBlock(batches, cx, cz) {
    var shades = [0x8a94b8, 0x6a7aa0, 0x9aa8c8, 0x5a6488, 0x7a88b0];
    for (var lx = -1; lx <= 1; lx += 2) for (var lz = -1; lz <= 1; lz += 2) {
      if (rng() < 0.22) continue;
      var w = U.randRange(rng, 18, 30), dep = U.randRange(rng, 18, 30);
      var h = U.randRange(rng, 32, 88) * (1 - U.dist(cx, cz, -100, -100) / 900);
      var x = cx + lx * 19, z = cz + lz * 19;
      if (tryBuilding(batches.downtown, x, z, w, dep, h, U.pick(rng, shades), 32)) {
        batches.downtown.addBox(x, 1.5, z, w + 4, 3, dep + 4, 0, 0x3a3448, 0);
        if (rng() < 0.28) {
          var slot = U.randInt(rng, 0, 17);
          addSign(batches.signs, slot, x, h + 3, z, rng() * Math.PI * 2, 22, 5);
        }
      }
    }
  }

  function buildStripBlock(batches, cx, cz, frontRow) {
    var pastel = [0xf7a8c4, 0x9fe8d8, 0xf9d99a, 0xb8a8e8, 0x8fd0f0, 0xf0b090, 0xe8f0b0];
    var n = frontRow ? 2 : U.randInt(rng, 2, 3);
    for (var k = 0; k < n; k++) {
      var w = U.randRange(rng, 22, 34), dep = U.randRange(rng, 16, 24);
      var h = U.randRange(rng, 14, 30);
      var x = frontRow ? cx + 18 : cx + U.randRange(rng, -20, 20);
      var z = cz - 38 + dep / 2 + k * (76 / n) + U.randRange(rng, 0, 76 / n - dep - 2);
      z = U.clamp(z, cz - 38 + dep / 2, cz + 38 - dep / 2);
      var col = U.pick(rng, pastel);
      if (tryBuilding(batches.strip, x, z, w, dep, h, col, 24)) {
        // stepped art-deco top
        batches.strip.addBox(x, h + 1.5, z, w * 0.6, 3, dep * 0.6, 0, col, 0);
        batches.strip.addBox(x, h + 3.7, z, w * 0.3, 1.6, dep * 0.3, 0, 0xfff0f8, 0);
        var slot = U.randInt(rng, 0, 17);
        var face = frontRow ? Math.PI / 2 : (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
        var sx = x + (face > 0 ? w / 2 + 0.3 : -w / 2 - 0.3);
        addSign(batches.signs, slot, sx, h * 0.75, z, face > 0 ? Math.PI / 2 : -Math.PI / 2, Math.min(20, dep * 0.9), 4.5);
        city.palmSpots.push({ x: x + U.randRange(rng, -w, w) * 0.7, z: z + dep / 2 + 3, s: U.randRange(rng, 0.8, 1.15) });
      }
    }
  }

  function buildHarborBlock(batches, cx, cz) {
    var w = U.randRange(rng, 46, 62), dep = U.randRange(rng, 26, 34);
    var h = U.randRange(rng, 9, 13);
    tryBuilding(batches.harbor, cx, cz - 16, w, dep, h, U.pick(rng, [0x8a6a58, 0x6a7078, 0x707a68, 0x806858]), 40);
    // container stacks
    var colors = [0xc85040, 0x4078a8, 0x50a068, 0xb89040, 0x9060a0];
    for (var r = 0; r < 3; r++) {
      var zz = cz + 14 + r * 8;
      if (rng() < 0.3) continue;
      var count = U.randInt(rng, 2, 4);
      for (var c = 0; c < count; c++) {
        var xx = cx - 28 + c * 16 + U.randRange(rng, 0, 4);
        var stack = U.randInt(rng, 1, 3);
        for (var s = 0; s < stack; s++) {
          containerData.push({ x: xx, y: 1.3 + s * 2.6, z: zz, rot: U.randRange(rng, -0.06, 0.06), color: colors[U.randInt(rng, 0, colors.length - 1)] });
        }
        addSolid(xx, zz, 12.2, 2.6, 2.6 * stack, 'prop');
      }
    }
  }

  function buildGenericBlock(batches, cx, cz) {
    var shades = [0xb08878, 0x88a090, 0xa898b0, 0x90a8b8, 0xb0a080];
    var n = U.randInt(rng, 3, 5);
    for (var k = 0; k < n; k++) {
      var w = U.randRange(rng, 14, 26), dep = U.randRange(rng, 14, 26);
      var h = U.randRange(rng, 7, 18);
      var x = cx + U.randRange(rng, -24, 24), z = cz + U.randRange(rng, -24, 24);
      var ok = true;
      var q = city.hash.query(x, z, Math.max(w, dep) * 0.72);
      for (var qq = 0; qq < q.length; qq++) if (q[qq].tag === 'building') { ok = false; break; }
      if (ok) tryBuilding(batches.generic, x, z, w, dep, h, U.pick(rng, shades), 28);
    }
    if (rng() < 0.4) city.palmSpots.push({ x: cx + U.randRange(rng, -30, 30), z: cz + U.randRange(rng, -30, 30), s: U.randRange(rng, 0.8, 1.1) });
  }

  function buildPOIs(batches, atlas) {
    var P = city.pois;
    // hospitals
    P.hospitals.forEach(function (H) {
      batches.generic.addBox(H.x, 9, H.z - 12, 60, 18, 28, 0, 0xd8e8f0, 28);
      addSolid(H.x, H.z - 12, 60, 28, 18);
      addSign(batches.signs, 19, H.x, 14, H.z + 2.3, 0, 30, 5);
    });
    // police station
    batches.generic.addBox(P.police.x, 7, P.police.z + 10, 70, 14, 26, 0, 0x8a94c0, 28);
    addSolid(P.police.x, P.police.z + 10, 70, 26, 14);
    addSign(batches.signs, 20, P.police.x, 11, P.police.z - 3.3, Math.PI, 26, 4.5);
    // respray garages: three walls + roof, opening faces west toward a road
    P.resprays.forEach(function (G) {
      batches.generic.addBox(G.x, 4, G.z - 7, 24, 8, 2, 0, 0x585068, 0);
      batches.generic.addBox(G.x, 4, G.z + 7, 24, 8, 2, 0, 0x585068, 0);
      batches.generic.addBox(G.x + 11, 4, G.z, 2, 8, 12, 0, 0x585068, 0);
      batches.generic.addBox(G.x, 8.5, G.z, 26, 1.4, 17, 0, 0x484058, 0);
      addSolid(G.x, G.z - 7, 24, 2, 8, 'building');
      addSolid(G.x, G.z + 7, 24, 2, 8, 'building');
      addSolid(G.x + 11, G.z, 2, 12, 8, 'building');
      addSign(batches.signs, 18, G.x - 12.6, 6.4, G.z, -Math.PI / 2, 12, 3);
    });
  }

  var containerData = [];

  function buildBeach(scene, batches) {
    // boardwalk planks + railing
    batches.wood.addBox(365, 0.15, 0, 10, 0.3, 980, 0, 0x7a5a40, 0);
    for (var z = -488; z < 488; z += 6) {
      if ((z / 6 | 0) % 2 === 0) batches.wood.addBox(365, 0.32, z, 10, 0.04, 3, 0, 0x6a4c34, 0);
    }
    for (var zr = -486; zr < 488; zr += 4) {
      batches.wood.addBox(370.2, 0.9, zr, 0.18, 1.2, 0.18, 0, 0x9a7a58, 0);
    }
    batches.wood.addBox(370.2, 1.45, 0, 0.24, 0.14, 976, 0, 0xb08a60, 0);

    // sand strip built as segments following the shoreline
    var sand = new GeoBatch();
    var sandShades = [0xd8c496, 0xd0bc8e, 0xdcc89c, 0xccb888];
    for (var sz = -500; sz < 500; sz += 20) {
      var mid = sz + 10;
      var w = city.shoreline(mid) + 6 - SAND_X0;
      sand.addGroundQuad(SAND_X0 + w / 2, 0.06, mid, w, 20.5, 0, U.pick(rng, sandShades));
      // darker wet band at the waterline
      sand.addGroundQuad(SAND_X0 + w - 4, 0.07, mid, 9, 20.5, 0, 0xb0a078);
    }
    // narrow sand fringes along the island's other shores
    for (var fz = -520; fz < 520; fz += 20) {
      var wsh = city.westShore(fz + 10);
      sand.addGroundQuad(wsh + 6, 0.05, fz + 10, 26, 20.5, 0, U.pick(rng, sandShades));
    }
    for (var fx = -520; fx < 380; fx += 20) {
      var nsh = city.northShore(fx + 10);
      sand.addGroundQuad(fx + 10, 0.05, nsh + 6, 20.5, 26, 0, U.pick(rng, sandShades));
      var ssh = city.southShore(fx + 10);
      sand.addGroundQuad(fx + 10, 0.05, ssh - 6, 20.5, 26, 0, U.pick(rng, sandShades));
    }
    var sandMesh = new THREE.Mesh(sand.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    sandMesh.matrixAutoUpdate = false;
    scene.add(sandMesh);

    // piers
    var pier = new GeoBatch();
    [[150, 505], [-180, 470]].forEach(function (p) {
      var pz = p[0], endX = p[1];
      pier.addBox((362 + endX) / 2, 0.5, pz, endX - 362, 0.5, 14, 0, 0x7a5a40, 0);
      for (var px = 372; px < endX; px += 12) {
        pier.addBox(px, -0.7, pz - 6, 0.8, 3.4, 0.8, 0, 0x4a3828, 0);
        pier.addBox(px, -0.7, pz + 6, 0.8, 3.4, 0.8, 0, 0x4a3828, 0);
      }
      pier.addBox((362 + endX) / 2, 1.35, pz - 6.8, endX - 362, 0.12, 0.2, 0, 0xb08a60, 0);
      pier.addBox((362 + endX) / 2, 1.35, pz + 6.8, endX - 362, 0.12, 0.2, 0, 0xb08a60, 0);
    });
    var pierMesh = new THREE.Mesh(pier.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    pierMesh.matrixAutoUpdate = false;
    scene.add(pierMesh);
    addSign(batches.signs, 22, 380, 5.5, 143, -Math.PI / 2, 20, 4);
    addSign(batches.signs, 23, 470, 7, -173, -Math.PI / 2, 14, 3.5);

    // ocean surrounds the island
    var og = new THREE.PlaneGeometry(2600, 2600, 52, 52);
    og.rotateX(-Math.PI / 2);
    og.translate(50, -0.35, 0);
    city.oceanGeo = og;
    city.oceanBase = og.attributes.position.array.slice();
    var om = new THREE.MeshPhongMaterial({ color: 0x0d2242, shininess: 120, specular: 0x8899cc, transparent: true, opacity: 0.93 });
    var ocean = new THREE.Mesh(og, om);
    scene.add(ocean);

    // moon glitter streak
    var streakTex = radialGlowTexture('rgba(200,220,255,0.8)');
    var streak = new THREE.Mesh(new THREE.PlaneGeometry(30, 320), new THREE.MeshBasicMaterial({ map: streakTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35 }));
    streak.rotation.x = -Math.PI / 2;
    streak.position.set(600, -0.1, -60);
    scene.add(streak);
    city.streak = streak;

    // beach palms along the boardwalk
    for (var bz = -470; bz < 480; bz += 24) {
      city.palmSpots.push({ x: 372.8, z: bz + U.randRange(rng, -3, 3), s: U.randRange(rng, 0.9, 1.25) });
      if (rng() < 0.5) city.palmSpots.push({ x: U.randRange(rng, 380, 400), z: bz + U.randRange(rng, 0, 20), s: U.randRange(rng, 0.75, 1.1) });
    }
  }

    function skyGradient(stops) {
      var cv = document.createElement('canvas');
      cv.width = 32; cv.height = 256;
      var g = cv.getContext('2d');
      var gr = g.createLinearGradient(0, 256, 0, 0);
      for (var i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
      g.fillStyle = gr; g.fillRect(0, 0, 32, 256);
      return new THREE.CanvasTexture(cv);
    }

  function buildSky(scene) {
    var nightTex = skyGradient([
      [0, '#3a1440'], [0.12, '#5a1e52'], [0.24, '#8a2a5e'],
      [0.38, '#4a2266'], [0.6, '#221244'], [1, '#0a0620']
    ]);
    var dayTex = skyGradient([
      [0, '#ffd7a8'], [0.14, '#ffb98a'], [0.3, '#8fb8e8'],
      [0.55, '#5a92d8'], [1, '#2f63b0']
    ]);
    city.skyTextures = { night: nightTex, day: dayTex };
    var sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 20, 14), new THREE.MeshBasicMaterial({ map: nightTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10;
    scene.add(sky);
    city.sky = sky;

    var starPos = [];
    for (var i = 0; i < 420; i++) {
      var az = rng() * Math.PI * 2, el = 0.12 + rng() * 1.35;
      var r2 = 1300;
      starPos.push(r2 * Math.cos(el) * Math.cos(az), r2 * Math.sin(el), r2 * Math.cos(el) * Math.sin(az));
    }
    var sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    var stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 2.6, fog: false, sizeAttenuation: false }));
    scene.add(stars);
    city.stars = stars;

    var moon = new THREE.Mesh(new THREE.CircleGeometry(60, 24), new THREE.MeshBasicMaterial({ color: 0xf0ead8, fog: false }));
    moon.position.set(1150, 520, -220);
    moon.lookAt(0, 0, 0);
    scene.add(moon);
    city.moon = moon;
    var halo = new THREE.Mesh(new THREE.CircleGeometry(130, 24), new THREE.MeshBasicMaterial({ map: radialGlowTexture('rgba(220,225,255,0.5)'), transparent: true, blending: THREE.AdditiveBlending, fog: false, depthWrite: false }));
    halo.position.copy(moon.position).multiplyScalar(0.985);
    halo.lookAt(0, 0, 0);
    scene.add(halo);
    city.moonHalo = halo;
  }

  city.setDaytime = function (day) {
    if (city.sky) city.sky.material.map = day ? city.skyTextures.day : city.skyTextures.night;
    if (city.sky) city.sky.material.needsUpdate = true;
    if (city.stars) city.stars.visible = !day;
    if (city.moon) { city.moon.material.color.setHex(day ? 0xfff4d8 : 0xf0ead8); }
    if (city.moonHalo) city.moonHalo.material.opacity = day ? 0.25 : 0.5;
    // daylight softens the signs' emissive punch
    city.dayMode = day;
  };

  function buildInstancedProps(scene) {
    var dummy = new THREE.Object3D();

    // palms
    var palms = city.palmSpots;
    // extra palms scattered on boulevard sidewalks
    for (var z = -460; z < 480; z += 40) {
      palms.push({ x: 341.5, z: z, s: 1 });
    }
    var trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 6.4, 5);
    trunkGeo.translate(0, 3.2, 0);
    var trunkMesh = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x6a4c34 }), palms.length);
    var frondB = new GeoBatch();
    for (var f = 0; f < 7; f++) {
      var a = f / 7 * Math.PI * 2;
      var fl = 2.6;
      frondB.addBox(Math.cos(a) * fl * 0.42, 6.3 + 0.28 - 0.34 * (fl * 0.42 / fl), Math.sin(a) * fl * 0.42, fl, 0.1, 0.55, -a, 0x2e7a4a, 0);
    }
    var frondGeo = frondB.build();
    // tilt fronds downward by shifting outer edge: cheap visual, skip exact droop
    var frondMesh = new THREE.InstancedMesh(frondGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), palms.length);
    for (var p = 0; p < palms.length; p++) {
      var pp = palms[p];
      dummy.position.set(pp.x, city.groundY(pp.x, pp.z), pp.z);
      dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      dummy.scale.setScalar(pp.s || 1);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(p, dummy.matrix);
      frondMesh.setMatrixAt(p, dummy.matrix);
      if (pp.x < 356) addSolid(pp.x, pp.z, 0.8, 0.8, 6, 'prop', true);
    }
    scene.add(trunkMesh); scene.add(frondMesh);

    // streetlights along roads; skip spots that land inside a crossing road
    function nearAnyRoad(v) {
      for (var r = 0; r < R.length; r++) if (Math.abs(v - R[r]) < 13) return true;
      return false;
    }
    var lightSpots = [];
    for (var i = 0; i < R.length; i++) {
      for (var d = -450; d <= 450; d += 60) {
        if (!nearAnyRoad(d + 20)) lightSpots.push({ x: R[i] + 7.4, z: d + 20, rot: Math.PI });
        if (!nearAnyRoad(d - 10)) lightSpots.push({ x: R[i] - 7.4, z: d - 10, rot: 0 });
        if (d >= -480 && d + 20 < 356) {
          if (!nearAnyRoad(d + 20)) lightSpots.push({ x: d + 20, z: R[i] + 7.4, rot: Math.PI / 2 });
          if (!nearAnyRoad(d - 10)) lightSpots.push({ x: d - 10, z: R[i] - 7.4, rot: -Math.PI / 2 });
        }
      }
    }
    var poleB = new GeoBatch();
    poleB.addBox(0, 3, 0, 0.22, 6, 0.22, 0, 0x3a3f4a, 0);
    poleB.addBox(0.9, 5.9, 0, 2, 0.16, 0.16, 0, 0x3a3f4a, 0);
    var poleGeo = poleB.build();
    var poleMesh = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), lightSpots.length);
    var headGeo = new THREE.BoxGeometry(0.7, 0.22, 0.3);
    headGeo.translate(1.8, 5.8, 0);
    var headMesh = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: 0xffc88a }), lightSpots.length);
    var glowB = new GeoBatch();
    for (var L = 0; L < lightSpots.length; L++) {
      var ls = lightSpots[L];
      dummy.position.set(ls.x, 0, ls.z);
      dummy.rotation.set(0, ls.rot, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      poleMesh.setMatrixAt(L, dummy.matrix);
      headMesh.setMatrixAt(L, dummy.matrix);
      addSolid(ls.x, ls.z, 0.5, 0.5, 6, 'prop', true);
    }
    scene.add(poleMesh); scene.add(headMesh);
    // warm pools of light on the road
    var glowGeoB = new GeoBatch();
    for (var L2 = 0; L2 < lightSpots.length; L2++) {
      var ls2 = lightSpots[L2];
      glowGeoB.addGroundQuad(ls2.x + Math.cos(ls2.rot) * 1.8, 0.07, ls2.z - Math.sin(ls2.rot) * 1.8, 11, 11, 0, 0xffffff);
    }
    var glowMesh = new THREE.Mesh(glowGeoB.build(), new THREE.MeshBasicMaterial({ map: radialGlowTexture('rgba(255,170,90,0.34)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    glowMesh.matrixAutoUpdate = false;
    scene.add(glowMesh);

    // hydrants at intersection corners
    var hyd = [];
    for (var hi = 0; hi < R.length - 1; hi++) for (var hj = 0; hj < R.length - 1; hj++) {
      if ((hi + hj) % 3 !== 0) continue;
      hyd.push({ x: R[hi] + 8.2, z: R[hj] + 8.2 });
    }
    var hydGeo = new THREE.CylinderGeometry(0.24, 0.3, 0.8, 6);
    hydGeo.translate(0, 0.55, 0);
    var hydMesh = new THREE.InstancedMesh(hydGeo, new THREE.MeshLambertMaterial({ color: 0xc84848 }), hyd.length);
    for (var hh = 0; hh < hyd.length; hh++) {
      dummy.position.set(hyd[hh].x, 0, hyd[hh].z);
      dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
      dummy.updateMatrix();
      hydMesh.setMatrixAt(hh, dummy.matrix);
      addSolid(hyd[hh].x, hyd[hh].z, 0.6, 0.6, 1, 'prop', true);
    }
    scene.add(hydMesh);

    // benches on the boardwalk
    var benches = [];
    for (var bz = -440; bz < 460; bz += 55) benches.push({ x: 367.5, z: bz });
    var benchB = new GeoBatch();
    benchB.addBox(0, 0.5, 0, 0.5, 0.08, 2.2, 0, 0x8a6a48, 0);
    benchB.addBox(-0.25, 0.75, 0, 0.08, 0.6, 2.2, 0, 0x8a6a48, 0);
    benchB.addBox(0.18, 0.25, -0.9, 0.1, 0.5, 0.1, 0, 0x44403a, 0);
    benchB.addBox(0.18, 0.25, 0.9, 0.1, 0.5, 0.1, 0, 0x44403a, 0);
    var benchMesh = new THREE.InstancedMesh(benchB.build(), new THREE.MeshLambertMaterial({ vertexColors: true }), benches.length);
    for (var bb = 0; bb < benches.length; bb++) {
      dummy.position.set(benches[bb].x, 0.3, benches[bb].z);
      dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
      benchMesh.setMatrixAt(bb, dummy.matrix);
    }
    scene.add(benchMesh);

    // shipping containers
    if (containerData.length) {
      var contGeo = new THREE.BoxGeometry(12, 2.6, 2.6);
      var contMesh = new THREE.InstancedMesh(contGeo, new THREE.MeshLambertMaterial(), containerData.length);
      var col = new THREE.Color();
      for (var ci = 0; ci < containerData.length; ci++) {
        var cd = containerData[ci];
        dummy.position.set(cd.x, cd.y, cd.z);
        dummy.rotation.set(0, cd.rot, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
        contMesh.setMatrixAt(ci, dummy.matrix);
        contMesh.setColorAt(ci, col.setHex(cd.color));
      }
      scene.add(contMesh);
    }
  }

  function buildLandmarks(scene) {
    // central tower with lit crown
    var twr = new GeoBatch();
    twr.addBox(-100, 55, -100, 26, 110, 26, Math.PI / 4, 0x9aa8d0, 32);
    twr.addBox(-100, 113, -100, 14, 6, 14, Math.PI / 4, 0x30284a, 0);
    addSolid(-100, -100, 30, 30, 110);
    var twrTex = windowTexture('#0e1226', ['#a8e8ff', '#ffd0e8', '#ffe9a8'], 10, 9, 0.6);
    var twrMesh = new THREE.Mesh(twr.build(), new THREE.MeshLambertMaterial({ map: twrTex, emissive: 0xccccdd, emissiveMap: twrTex, vertexColors: true }));
    twrMesh.matrixAutoUpdate = false;
    scene.add(twrMesh);
    var crown = new THREE.Mesh(new THREE.BoxGeometry(15, 1.6, 15), new THREE.MeshBasicMaterial({ color: 0xff4fa3 }));
    crown.position.set(-100, 110.4, -100);
    crown.rotation.y = Math.PI / 4;
    scene.add(crown);
    var signB = new GeoBatch();
    addSign(signB, 21, -100, 119, -100, 0, 26, 5);
    addSign(signB, 21, -100, 119, -100, Math.PI, 26, 5);
    var sm = new THREE.Mesh(signB.build(), city.signMesh.material);
    sm.matrixAutoUpdate = false;
    scene.add(sm);

    // ferris wheel at the end of the long pier
    var wheel = new THREE.Group();
    var rim = new THREE.Mesh(new THREE.TorusGeometry(15, 0.5, 6, 22), new THREE.MeshBasicMaterial({ color: 0x38e8ff }));
    wheel.add(rim);
    var spokeB = new GeoBatch();
    for (var sI = 0; sI < 8; sI++) {
      spokeB.addBox(0, 0, 0, 30, 0.34, 0.34, sI / 8 * Math.PI, 0xff4fa3, 0);
    }
    var spokes = new THREE.Mesh(spokeB.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
    wheel.add(spokes);
    var cabGeo = new THREE.BoxGeometry(1.8, 1.8, 1.8);
    var cabs = new THREE.InstancedMesh(cabGeo, new THREE.MeshBasicMaterial({ color: 0xffe14f }), 8);
    wheel.add(cabs);
    city.wheelCabs = cabs;
    // spokes lie in the local XY plane; rotate so the wheel faces the shore
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(492, 17.5, 150);
    scene.add(wheel);
    city.wheel = wheel;
    var supB = new GeoBatch();
    supB.addBox(492, 8.5, 144, 1.2, 17, 1.2, 0, 0x555a6a, 0);
    supB.addBox(492, 8.5, 156, 1.2, 17, 1.2, 0, 0x555a6a, 0);
    var sup = new THREE.Mesh(supB.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    sup.matrixAutoUpdate = false;
    scene.add(sup);
    addSolid(492, 150, 3, 14, 17, 'prop');

    // harbor cranes
    var craneB = new GeoBatch();
    [[-380, 460], [-260, 460]].forEach(function (c) {
      craneB.addBox(c[0] - 6, 14, c[1], 1.6, 28, 1.6, 0, 0xb0b060, 0);
      craneB.addBox(c[0] + 6, 14, c[1], 1.6, 28, 1.6, 0, 0xb0b060, 0);
      craneB.addBox(c[0], 28.5, c[1], 30, 2, 2.4, 0, 0xb0b060, 0);
      craneB.addBox(c[0] - 10, 22, c[1], 1, 12, 1, 0, 0x888840, 0);
      addSolid(c[0] - 6, c[1], 2, 2, 28, 'prop');
      addSolid(c[0] + 6, c[1], 2, 2, 28, 'prop');
    });
    var craneMesh = new THREE.Mesh(craneB.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    craneMesh.matrixAutoUpdate = false;
    scene.add(craneMesh);
  }

  function buildLaneGraph() {
    var nodes = [], edges = {};
    for (var i = 0; i < R.length; i++) for (var j = 0; j < R.length; j++) {
      nodes.push({ x: R[i], z: R[j], i: i, j: j });
    }
    city.nodes = nodes;
    city.nodeAt = function (i, j) {
      if (i < 0 || j < 0 || i >= R.length || j >= R.length) return null;
      return nodes[i * R.length + j];
    };
    city.neighbors = function (n) {
      var out = [];
      var a = city.nodeAt(n.i - 1, n.j); if (a) out.push(a);
      a = city.nodeAt(n.i + 1, n.j); if (a) out.push(a);
      a = city.nodeAt(n.i, n.j - 1); if (a) out.push(a);
      a = city.nodeAt(n.i, n.j + 1); if (a) out.push(a);
      return out;
    };
    city.nearestNode = function (x, z) {
      var best = null, bd = 1e18;
      for (var k = 0; k < nodes.length; k++) {
        var d = U.dist2(x, z, nodes[k].x, nodes[k].z);
        if (d < bd) { bd = d; best = nodes[k]; }
      }
      return best;
    };
  }

  function buildSpots() {
    // parked cars hugging the curbs, clear of the driving lanes
    for (var i = 0; i < R.length; i++) {
      for (var d = -430; d < 440; d += U.randRange(rng, 45, 90)) {
        if (rng() < 0.55) city.parkedSpots.push({ x: R[i] + (rng() < 0.5 ? 5.3 : -5.3), z: d, heading: 0 });
        var hx = d + U.randRange(rng, 0, 30);
        if (hx < 340 && rng() < 0.45) city.parkedSpots.push({ x: hx, z: R[i] + (rng() < 0.5 ? 5.3 : -5.3), heading: Math.PI / 2 });
      }
    }
    // pickups at seeded sidewalk corners
    var types = ['health', 'health', 'health', 'armor', 'armor', 'pistol', 'pistol', 'pistol', 'smg', 'smg', 'smg', 'shotgun', 'shotgun', 'health', 'armor', 'smg'];
    var ti = 0;
    for (var pi = 0; pi < R.length - 1 && ti < types.length; pi += 1) {
      for (var pj = (pi % 2); pj < R.length - 1 && ti < types.length; pj += 2) {
        if (rng() < 0.55) continue;
        city.pickupSpots.push({ x: R[pi] + 8.4, z: R[pj] - 8.4, type: types[ti++] });
      }
    }
    // guarantee some key ones
    // parked police cruisers outside the station (stealable)
    city.parkedSpots.push({ x: -158, z: -95, heading: 0, police: true });
    city.parkedSpots.push({ x: -158, z: -70, heading: 0, police: true });
    // an ambulance idling at each hospital (for paramedic jobs)
    city.pois.hospitals.forEach(function (H) {
      city.parkedSpots.push({ x: H.x + 22, z: H.spawn.z, heading: Math.PI / 2, vtype: 'ambulance' });
    });
    // motorcycles: a couple along the boardwalk and by the strip
    city.parkedSpots.push({ x: 360, z: 20, heading: 0, vtype: 'motorcycle' });
    city.parkedSpots.push({ x: 360, z: -40, heading: 0, vtype: 'motorcycle' });
    city.parkedSpots.push({ x: 342, z: 200, heading: 0, vtype: 'motorcycle' });
    city.parkedSpots.push({ x: -152, z: 150, heading: 0, vtype: 'motorcycle' });

    // starter pickups within sight of the spawn point (356, 40)
    city.pickupSpots.push({ x: 358, z: 34, type: 'pistol' });
    city.pickupSpots.push({ x: 358, z: 48, type: 'health' });
    city.pickupSpots.push({ x: 358, z: 60, type: 'smg' });
    city.pickupSpots.push({ x: 358, z: -260, type: 'shotgun' });
    city.pickupSpots.push({ x: 8.4, z: 158.4, type: 'health' });
    city.pickupSpots.push({ x: -141.6, z: -158.4, type: 'armor' });
    city.pickupSpots.push({ x: 365, z: 250, type: 'pistol' });
  }

  city.update = function (dt, t) {
    if (city.oceanGeo) {
      var pos = city.oceanGeo.attributes.position;
      var arr = pos.array, base = city.oceanBase;
      for (var i = 0; i < arr.length; i += 3) {
        var x = base[i], z = base[i + 2];
        arr[i + 1] = base[i + 1] + Math.sin(x * 0.045 + t * 1.1) * 0.28 + Math.sin(z * 0.06 + t * 0.7) * 0.22;
      }
      pos.needsUpdate = true;
    }
    if (city.wheel) {
      city.wheel.rotation.x += dt * 0.15;
      if (!city.cabsSet) {
        var dummy = new THREE.Object3D();
        for (var c = 0; c < 8; c++) {
          var a = c / 8 * Math.PI * 2;
          dummy.position.set(Math.cos(a) * 15, Math.sin(a) * 15, 0);
          dummy.updateMatrix();
          city.wheelCabs.setMatrixAt(c, dummy.matrix);
        }
        city.wheelCabs.instanceMatrix.needsUpdate = true;
        city.cabsSet = true;
      }
    }
    if (city.streak) city.streak.material.opacity = 0.3 + 0.08 * Math.sin(t * 0.7);
    if (city.signMesh) {
      var pulse = 0.9 + 0.1 * Math.sin(t * 2.3);
      city.signMesh.material.color.setScalar(pulse);
    }
  };

  return city;
})();
