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
      police: { x: -100, z: -122, spawn: { x: -100, z: -134 } },
      // every landmass gets its own station; stations[] is what the game asks
      stations: [],
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
  // the east piers. The z=150 slot belongs to the south bridge now, so the
  // pier that used to sit there stepped down a block.
  var PIERS = [[250, 505], [-180, 470]];
  city.isOnPier = function (x, z) {
    for (var i = 0; i < PIERS.length; i++) {
      if (x > 356 && x < PIERS[i][1] && Math.abs(z - PIERS[i][0]) < 8) return true;
    }
    return false;
  };

  // The world is a set of landmasses rather than one. Costa Rosa is the first;
  // anything else registers itself here before the city is built, and every
  // water test goes through the same list — so a new island is dry land to the
  // ocean mesh, the drown check and the spawners without any of them knowing
  // there is more than one.
  city.islands = [{
    id: 'costa', name: 'Isla Rosa', centre: { x: -70, z: 0 },
    contains: function (x, z) {
      return x <= city.shoreline(z) + 2 && x >= city.westShore(z) &&
        z >= city.northShore(x) && z <= city.southShore(x);
    }
  }];
  city.addIsland = function (isl) { city.islands.push(isl); return isl; };
  city.islandAt = function (x, z) {
    for (var i = 0; i < city.islands.length; i++) {
      if (city.islands[i].contains(x, z)) return city.islands[i];
    }
    return null;
  };
  // which landmass a point belongs to, by id — '' for open water
  city.islandIdAt = function (x, z) {
    var isl = city.islandAt(x, z);
    return isl ? isl.id : '';
  };

  // spans of road carried over water, registered the same way. A crossing is
  // dry land for the water tests and drivable ground for the height lookup.
  city.crossings = [];
  city.addCrossing = function (c) { city.crossings.push(c); return c; };
  // `atY`, when given, is the height of whatever is asking. A deck only counts
  // as ground once you are up at its level: without that, its height applies to
  // anything inside its footprint, so driving up the sand alongside a bridge
  // and turning in lifts you onto the deck — past whatever was blocking it.
  city.crossingY = function (x, z, atY) {
    for (var i = 0; i < city.crossings.length; i++) {
      var y = city.crossings[i].deckY(x, z);
      if (y === null) continue;
      if (atY !== undefined && atY < y - 2.5) continue;
      return y;
    }
    return null;
  };

  // Walkable surfaces that are not terrain: a flight of steps, a terrace.
  // A deck is a rectangle that may slope along its local +z, so one entry
  // describes a staircase and another the landing at the top of it.
  city.decks = [];
  city.addDeck = function (d) {
    d.cos = Math.cos(d.rot || 0); d.sin = Math.sin(d.rot || 0);
    var r = Math.max(d.w, d.len) / 2 + 1;
    d.minX = d.x - r; d.maxX = d.x + r; d.minZ = d.z - r; d.maxZ = d.z + r;
    city.decks.push(d);
    return d;
  };
  city.deckAt = function (x, z) {
    var best = null;
    for (var i = 0; i < city.decks.length; i++) {
      var d = city.decks[i];
      if (x < d.minX || x > d.maxX || z < d.minZ || z > d.maxZ) continue;
      var dx = x - d.x, dz = z - d.z;
      var lx = dx * d.cos - dz * d.sin, lz = dx * d.sin + dz * d.cos;
      if (Math.abs(lx) > d.w / 2 || Math.abs(lz) > d.len / 2) continue;
      var t = (lz + d.len / 2) / d.len;
      var y = d.y0 + (d.y1 - d.y0) * t;
      if (best === null || y > best) best = y;
    }
    return best;
  };

  // `atY` matters here for the same reason it matters to the height lookup: a
  // bridge overhead does not keep you dry when you are in the sea under it.
  // is this within `pad` of a bridge deck, at any height? For deciding where
  // not to plant a palm or stand a lamp post
  city.nearCrossing = function (x, z, pad) {
    for (var i = 0; i < city.crossings.length; i++) {
      var c = city.crossings[i];
      if (c.nearBy && c.nearBy(x, z, pad)) return true;
    }
    return false;
  };

  city.isInWater = function (x, z, atY) {
    if (city.isOnPier(x, z)) return false;
    if (city.crossings.length && city.crossingY(x, z, atY) !== null) return false;
    return !city.islandAt(x, z);
  };
  // Is there sea under this point, whatever is carried over it? A bridge deck
  // is not water for the drown check, but it is still water underneath — which
  // is what decides whether anything could be standing down there.
  city.isOpenWater = function (x, z) {
    return !city.isOnPier(x, z) && !city.islandAt(x, z);
  };
  city.isOnSand = function (x, z) {
    if (city.isOnPier(x, z)) return false;
    return x > BOARDWALK_X1 && x <= city.shoreline(z) + 2;
  };
  // stunt ramps. Each is a wedge rising along its local +z; rampAt returns the
  // deck height and the slope so vehicles get launched off the lip.
  city.ramps = [];
  city.rampAt = function (x, z) {
    for (var i = 0; i < city.ramps.length; i++) {
      var r = city.ramps[i];
      if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
      var dx = x - r.x, dz = z - r.z;
      var lx = dx * r.cos - dz * r.sin;      // across the ramp
      var lz = dx * r.sin + dz * r.cos;      // up the ramp
      if (Math.abs(lx) > r.w / 2 || lz < -r.len / 2 || lz > r.len / 2) continue;
      var t = (lz + r.len / 2) / r.len;
      return { idx: r.idx, y: r.h * t, slope: r.h / r.len, rot: r.rot, boost: r.boost };
    }
    return null;
  };

  city.groundY = function (x, z, atY) {
    if (city.ramps.length) {
      var rp = city.rampAt(x, z);
      if (rp) return rp.y;
    }
    if (city.crossings.length) {
      var cy = city.crossingY(x, z, atY);
      if (cy !== null) return cy;
    }
    if (city.decks.length) {
      var dy = city.deckAt(x, z);
      if (dy !== null) return dy;
    }
    // a landmass may carry its own relief; Costa Rosa is flat, others need not be
    for (var ii = 1; ii < city.islands.length; ii++) {
      var isl = city.islands[ii];
      if (isl.groundY && isl.contains(x, z)) return isl.groundY(x, z);
    }
    if (city.isOnPier(x, z) && x > BOARDWALK_X1) return 0.5;
    if (x > BOARDWALK_X0 && x <= BOARDWALK_X1) return 0.3;
    if (city.isOnSand(x, z)) {
      var sh = city.shoreline(z);
      var t = U.clamp((x - SAND_X0) / Math.max(1, sh - SAND_X0), 0, 1);
      return 0.25 - 0.85 * t;
    }
    return 0;
  };
  // the surface a ground vehicle rests on at (x,z), given it is currently at
  // height y. A roof only counts once you're actually up at its level, so
  // street traffic never snaps onto a building — but a car that clears a roof
  // on a jump can land on it and drive around up there.
  city.driveSurfaceY = function (x, z, y) {
    var best = city.groundY(x, z, y);
    var boxes = city.hash.query(x, z, 1);
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (b.tag !== 'building' || b.h === undefined) continue;
      if (b.h <= best || b.h > y + 1.4) continue;
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) best = b.h;
    }
    return best;
  };
  // top surface at a point: the tallest solid building roof containing it,
  // else the terrain height. Used so aircraft can set down on rooftops.
  city.surfaceY = function (x, z, atY) {
    var y = city.groundY(x, z, atY);
    var boxes = city.hash.query(x, z, 1);
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (b.tag !== 'building') continue; // land on buildings, not props/fences
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.h > y) y = b.h;
    }
    return y;
  };

  city.districtAt = function (x, z) {
    if (x >= 160) return 'strip';
    if (x <= -140 && z >= 140) return 'harbor';
    if (x >= -260 && x <= 60 && z >= -260 && z <= 60) return 'downtown';
    return 'residential';
  };
  // the station or hospital you would actually be taken to from here
  city.nearestStation = function (x, z) {
    var list = city.pois.stations, best = null, bd = 1e18;
    var unlocked = !GAME.isla || GAME.isla.isOpen();
    for (var i = 0; i < list.length; i++) {
      // a station behind a locked bridge cannot be where you're released
      if (list[i].isla && !unlocked) continue;
      var d = U.dist2(x, z, list[i].x, list[i].z);
      if (d < bd) { bd = d; best = list[i]; }
    }
    return best || city.pois.police;
  };
  // The shore you would actually crawl out onto. Every landmass answers for
  // its own coast; the mainland's is four curves, the island's is one.
  city.washAshore = function (x, z) {
    var best = null, bd = 1e18;
    var unlocked = !GAME.isla || GAME.isla.isOpen();
    for (var i = 0; i < city.islands.length; i++) {
      var isl = city.islands[i];
      // you do not wash up on a shore the game has not opened yet — drowning
      // in the channel is not a ferry to the locked island
      if (isl.id !== 'costa' && !unlocked) continue;
      var c = isl.centre || { x: -70, z: 0 };
      var d = U.dist2(x, z, c.x, c.z);
      if (d < bd) { bd = d; best = isl; }
    }
    if (best && best.shorePoint) return best.shorePoint(x, z);
    var px = U.clamp(x, -560, 560), pz = U.clamp(z, -560, 560);
    if (px > city.shoreline(pz)) px = city.shoreline(pz) - 22;
    if (px < city.westShore(pz)) px = city.westShore(pz) + 24;
    if (pz < city.northShore(px)) pz = city.northShore(px) + 24;
    if (pz > city.southShore(px)) pz = city.southShore(px) - 24;
    return { x: px, z: pz };
  };

  city.districtName = function (x, z) {
    if (GAME.isla && GAME.isla.contains(x, z)) return GAME.isla.districtName(x, z);
    if (x > 340) return 'Ocean Strip';
    var d = city.districtAt(x, z);
    return d === 'strip' ? 'Ocean Strip' : d === 'harbor' ? 'Puerto Viejo' : d === 'downtown' ? 'Centro Alto' : 'Las Colinas';
  };
  city.nearestRoadPoint = function (x, z) {
    // each landmass answers for its own roads; asking the mainland grid where
    // the nearest road is when you are stood on the island puts you in the sea
    for (var ii = 1; ii < city.islands.length; ii++) {
      var isl = city.islands[ii];
      if (isl.nearestRoadPoint && isl.contains(x, z)) return isl.nearestRoadPoint(x, z);
    }
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
    { minX: -26, maxX: 26, minZ: -226, maxZ: -174 },   // the helipad tower
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

  // `minY`, when given, is the level the solid starts at — anything well below
  // it passes underneath instead of hitting it
  function addSolid(cx, cz, sx, sz, h, tag, noLOS, minY) {
    var box = { minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2, h: h, tag: tag || 'building', noLOS: !!noLOS };
    if (minY !== undefined) box.minY = minY;
    city.hash.insert(box);
    return box;
  }

  city.addSolid = function (cx, cz, sx, sz, h, tag, noLOS, minY) { return addSolid(cx, cz, sx, sz, h, tag, noLOS, minY); };
  city.addSign = function (batch, slotIdx, x, y, z, rotY, w, h, tint) { addSign(batch, slotIdx, x, y, z, rotY, w, h, tint); };

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
    'RESPRAY', 'HOSPITAL', 'POLICE', 'AXIS TOWER', 'COSTA ROSA PIER', 'FUN FAIR',
    // Isla Verde keeps its own names; appended, so every index above still holds
    'SUNNY SCOOPS', 'EL FARO', 'PUERTO DORADO', 'MARINA VERDE', 'MIRADOR',
    'CASA DEL SOL', 'BAHIA CLUB', 'VERDE MOTORS',
    // The two ends of the world, for the signs over the bridges. Costa Rosa
    // is the CITY — the whole map, both islands. The mainland is Isla Rosa,
    // the neon island; Isla Verde is the green one across the channel.
    'ISLA VERDE', 'ISLA ROSA'];
  var SIGN_COLORS = ['#ff4fa3', '#38e8ff', '#ffe14f', '#7dff6a', '#ff8a3d', '#c86bff', '#ff5d5d', '#59ffc8'];
  function signAtlas() {
    var cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 1024;
    var g = cv.getContext('2d');
    g.fillStyle = '#07040c'; g.fillRect(0, 0, 1024, 1024);
    var slots = [];
    // Rows are sized from the list, so adding a name never overruns the canvas
    // — and the glyphs and their glow are sized to the row, because a 52 px
    // face with a 22 px halo in a 60 px row bleeds into the slots above and
    // below it, and every quad using those slots shows the neighbour's smear.
    var ROW = Math.floor(1024 / Math.ceil(SIGN_TEXTS.length / 2));
    var FONT = Math.min(52, ROW - 20), HALO = Math.min(22, Math.floor(ROW * 0.17));
    for (var i = 0; i < SIGN_TEXTS.length; i++) {
      var col = i % 2, row = Math.floor(i / 2);
      var x = col * 512, y = row * ROW;
      var color = SIGN_TEXTS[i] === 'HOSPITAL' ? '#ff6a6a' : SIGN_TEXTS[i] === 'POLICE' ? '#5aa0ff' : SIGN_COLORS[i % SIGN_COLORS.length];
      g.save();
      g.font = 'italic 900 ' + FONT + 'px "Segoe UI", Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = color; g.shadowBlur = HALO;
      g.strokeStyle = color; g.lineWidth = 2;
      g.fillStyle = '#ffffff';
      g.strokeText(SIGN_TEXTS[i], x + 256, y + ROW / 2, 490);
      g.shadowBlur = Math.min(10, HALO);
      g.fillText(SIGN_TEXTS[i], x + 256, y + ROW / 2, 490);
      g.restore();
      slots.push({ u0: x / 1024, v0: 1 - (y + ROW) / 1024, u1: (x + 512) / 1024, v1: 1 - y / 1024 });
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
  city.pois.stations.push(city.pois.police);

  city.build = function (scene) {
    // second landmass registers first: the ocean mask, the drown test and every
    // spawner ask the water model, and it has to know the full world by then
    if (GAME.isla) GAME.isla.register(city);
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
    // the grid stops at the airport fence: the roads that used to run the full
    // strip carried straight across the runway. Anything overlapping the fence
    // box ends just north of it instead.
    var AP = city.airport;
    for (var i = 0; i < R.length; i++) {
      var hitsAirport = R[i] + ROAD_HALF > AP.fx0 && R[i] - ROAD_HALF < AP.fx1;
      var zEnd = hitsAirport ? AP.fz0 - 1 : 480;
      asphalt.addGroundQuad(R[i], 0.03, (-480 + zEnd) / 2, ROAD_HALF * 2, zEnd + 480, 0, 0x100e16);
      asphalt.addGroundQuad(-72, 0.03, R[i], 856, ROAD_HALF * 2, 0, 0x100e16);
      // dashed center lines
      for (var d = -470; d < 470; d += 12) {
        if (d + 5 < zEnd) batches.marks.addGroundQuad(R[i], 0.06, d + 3, 0.25, 4, 0, 0xd8c46a);
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
    // the second landmass draws its own meshes but shares the city's window
    // textures and sign atlas, so the two read as one world
    city.tex = { downtown: texDowntown, strip: texStrip, generic: texGeneric, harbor: texHarbor };
    city.signTex = atlas.tex;
    city.lam = lam;
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
    buildAirport(scene);
    // last, so its clearance tests can see every structure in the world — the
    // terminal, the hospitals, the station, the tower and the bridges all
    // register after the streets do, and a ramp placed before them can end up
    // inside one, or square across a bridge deck
    if (GAME.isla) GAME.isla.build(scene);
    buildRamps(scene);
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

  // true if the footprint would sit on a driving lane of any road
  function overlapsRoad(minX, maxX, minZ, maxZ) {
    var m = ROAD_HALF + 1.5;
    for (var i = 0; i < R.length; i++) {
      if (minX < R[i] + m && maxX > R[i] - m) return true;
      if (minZ < R[i] + m && maxZ > R[i] - m) return true;
    }
    return false;
  }

  function tryBuilding(batch, cx, cz, sx, sz, h, color, uvScale) {
    if (overlapsReserved(cx - sx / 2, cx + sx / 2, cz - sz / 2, cz + sz / 2)) return false;
    // never build across a carriageway — it blocks the street and makes map
    // routes look like they run straight through the block
    if (overlapsRoad(cx - sx / 2, cx + sx / 2, cz - sz / 2, cz + sz / 2)) return false;
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
    // hospitals (the island builds its own; this is Costa Rosa's)
    P.hospitals.forEach(function (H) {
      if (H.isla) return;
      batches.generic.addBox(H.x, 9, H.z - 12, 60, 18, 28, 0, 0xd8e8f0, 28);
      addSolid(H.x, H.z - 12, 60, 28, 18);
      addSign(batches.signs, 19, H.x, 14, H.z + 2.3, 0, 30, 5);
    });
    // The find: a helipad crowning a downtown tower, with a helicopter on it.
    // It shows on no map — the way onto it is out of the sky, a parachute off
    // the plane onto the roof, and the reward for arriving is a way off again.
    // This is the mainland's only helicopter. It used to sit on the hospital
    // roof, but eighteen metres is barely a find; now it takes real flying.
    var HT = { x: 0, z: -200, h: 72 };
    batches.downtown.addBox(HT.x, HT.h / 2, HT.z, 30, HT.h, 30, 0, 0xb8c4e8, 28);
    addSolid(HT.x, HT.z, 30, 30, HT.h);
    var roofY = HT.h + 0.06, padX = HT.x, padZ = HT.z;
    // low parapet, scenery only — a wall solid up here would fight the skids
    [[-14.4, 0, 1.2, 30], [14.4, 0, 1.2, 30], [0, -14.4, 30, 1.2], [0, 14.4, 30, 1.2]].forEach(function (pp) {
      batches.generic.addBox(HT.x + pp[0], HT.h + 0.5, HT.z + pp[1], pp[2], 1.0, pp[3], 0, 0x8a94b8, 0);
    });
    batches.ground.addGroundQuad(padX, roofY + 0.06, padZ, 16, 16, 0, 0x1a1a22);
    batches.marks.addGroundQuad(padX - 2.2, roofY + 0.12, padZ, 1, 7, 0, 0xf0d020);
    batches.marks.addGroundQuad(padX + 2.2, roofY + 0.12, padZ, 1, 7, 0, 0xf0d020);
    batches.marks.addGroundQuad(padX, roofY + 0.12, padZ, 3.6, 1, 0, 0xf0d020);
    // corner ring segments, drawn as four bars so it reads from the air
    [[-6.6, 0, 1.2, 13.6], [6.6, 0, 1.2, 13.6], [0, -6.6, 13.6, 1.2], [0, 6.6, 13.6, 1.2]].forEach(function (q) {
      batches.marks.addGroundQuad(padX + q[0], roofY + 0.1, padZ + q[1], q[2], q[3], 0, 0x3ac8e0);
    });
    city.roofHelipad = { x: padX, z: padZ, y: roofY };
    city.parkedSpots.push({ x: padX, z: padZ, y: roofY, heading: Math.PI / 2, vtype: 'helicopter' });

    // police station (Costa Rosa's; the island builds its own)
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
    // Boardwalk planks and railing, in lengths with a gap wherever a bridge
    // approach crosses. Laid as one long run it put a handrail straight across
    // the road onto the bridge.
    function crossed(z) {
      return city.crossings.length &&
        (city.crossingY(360, z) !== null || city.crossingY(371, z) !== null);
    }
    var runZ = null;
    for (var bz = -490; bz <= 490; bz += 2) {
      var open = !crossed(bz);
      if (open && runZ === null) runZ = bz;
      if ((!open || bz >= 490) && runZ !== null) {
        var mid = (runZ + bz) / 2, span = bz - runZ;
        if (span > 4) {
          batches.wood.addBox(365, 0.15, mid, 10, 0.3, span, 0, 0x7a5a40, 0);
          batches.wood.addBox(370.2, 1.45, mid, 0.24, 0.14, span - 1, 0, 0xb08a60, 0);
        }
        runZ = null;
      }
    }
    for (var z = -488; z < 488; z += 6) {
      if ((z / 6 | 0) % 2 === 0 && !crossed(z)) batches.wood.addBox(365, 0.32, z, 10, 0.04, 3, 0, 0x6a4c34, 0);
    }
    for (var zr = -486; zr < 488; zr += 4) {
      if (!crossed(zr)) batches.wood.addBox(370.2, 0.9, zr, 0.18, 1.2, 0.18, 0, 0x9a7a58, 0);
    }

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
    PIERS.forEach(function (p) {
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
    addSign(batches.signs, 22, 380, 5.5, 243, -Math.PI / 2, 20, 4);
    addSign(batches.signs, 23, 470, 7, -173, -Math.PI / 2, 14, 3.5);

    // ocean surrounds the island
    // wide enough to reach past the far island; the plane has to hold both
    // landmasses and the horizon beyond them
    var og = new THREE.PlaneGeometry(3600, 3000, 72, 60);
    og.rotateX(-Math.PI / 2);
    og.translate(450, -0.35, 0);
    city.oceanGeo = og;
    city.oceanBase = og.attributes.position.array.slice();
    // the ocean plane spans the whole map, so its inland vertices sit just under
    // the streets. Sink those and never animate them — otherwise wave crests rise
    // through the asphalt as flickering blue patches.
    var ob = city.oceanBase, mask = new Uint8Array(ob.length / 3);
    for (var vi = 0, m = 0; vi < ob.length; vi += 3, m++) {
      var vx = ob[vi], vz = ob[vi + 2];
      mask[m] = city.isInWater(vx, vz) ? 1 : 0;
      if (!mask[m]) og.attributes.position.array[vi + 1] = -4;
    }
    city.oceanMask = mask;
    og.attributes.position.needsUpdate = true;
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
    // base dusk/night dome (tinted darker at deep night) with a day dome fading over it
    var sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 20, 14), new THREE.MeshBasicMaterial({ map: nightTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10;
    scene.add(sky);
    city.sky = sky;
    var skyDay = new THREE.Mesh(new THREE.SphereGeometry(1390, 20, 14), new THREE.MeshBasicMaterial({ map: dayTex, side: THREE.BackSide, fog: false, depthWrite: false, transparent: true, opacity: 0 }));
    skyDay.renderOrder = -9;
    scene.add(skyDay);
    city.skyDay = skyDay;

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

  // df in [0,1]: 0 = deep night, ~0.4 = dusk/sunset, 1 = full day
  city.applyTimeOfDay = function (df) {
    if (city.sky) city.sky.material.color.setScalar(U.clamp(0.32 + df * 1.1, 0.32, 1));
    if (city.skyDay) city.skyDay.material.opacity = U.clamp((df - 0.6) / 0.32, 0, 1);
    if (city.stars) { city.stars.material.opacity = U.clamp(1 - df * 2.2, 0, 1); city.stars.material.transparent = true; city.stars.visible = df < 0.5; }
    if (city.moon) city.moon.material.opacity = U.clamp(1 - df * 1.6, 0.05, 1), city.moon.material.transparent = true;
    if (city.moonHalo) city.moonHalo.material.opacity = U.clamp(0.5 - df * 0.8, 0, 0.5);
    // street lamps burn at night, fade out through dusk, and are off in daylight
    var lampOn = U.clamp(1 - (df - 0.45) / 0.35, 0, 1);
    if (city.lampGlow) {
      city.lampGlow.material.opacity = lampOn;
      city.lampGlow.visible = lampOn > 0.02;
    }
    if (city.lampHeads) {
      city.lampHeads.material.color.setRGB(
        U.lerp(0.42, 1, lampOn), U.lerp(0.44, 0.784, lampOn), U.lerp(0.5, 0.54, lampOn));
    }
    city.dayMode = df > 0.7;
  };
  city.setDaytime = function (day) { city.applyTimeOfDay(day ? 1 : 0); };
  // reward for finding every stunt jump: a monster truck waiting at the airport
  city.monsterSpot = null;
  city.unlockMonsterTruck = function () {
    if (city.monsterSpot) return;
    city.monsterSpot = { x: city.airport.apron.x + 14, z: city.airport.apron.z + 16, heading: 0, vtype: 'monster' };
    city.parkedSpots.push(city.monsterSpot);
  };

  function buildInstancedProps(scene) {
    var dummy = new THREE.Object3D();

    // palms
    // extra palms scattered on boulevard sidewalks
    for (var z = -460; z < 480; z += 40) {
      city.palmSpots.push({ x: 341.5, z: z, s: 1 });
    }
    // nothing gets planted where a bridge runs — a palm through the deck is
    // as wrong as a building on it
    var palms = city.palmSpots.filter(function (q) { return !city.nearCrossing(q.x, q.z, 9); });
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
    function addLight(x, z, rot) {
      if (city.inAirport(x, z) || city.nearCrossing(x, z, 9)) return;
      lightSpots.push({ x: x, z: z, rot: rot });
    }
    for (var i = 0; i < R.length; i++) {
      for (var d = -450; d <= 450; d += 60) {
        if (!nearAnyRoad(d + 20)) addLight(R[i] + 7.4, d + 20, Math.PI);
        if (!nearAnyRoad(d - 10)) addLight(R[i] - 7.4, d - 10, 0);
        if (d >= -480 && d + 20 < 356) {
          if (!nearAnyRoad(d + 20)) addLight(d + 20, R[i] + 7.4, Math.PI / 2);
          if (!nearAnyRoad(d - 10)) addLight(d - 10, R[i] - 7.4, -Math.PI / 2);
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
    // the lamps switch off in daylight (see applyTimeOfDay)
    city.lampHeads = headMesh;
    city.lampGlow = glowMesh;

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

    // ferris wheel at the end of the long pier — an outer group orients it,
    // an inner group spins about the hub (local Z) with rim, spokes and cabs rigid
    var wheel = new THREE.Group();
    var spin = new THREE.Group();
    wheel.add(spin);
    var rim = new THREE.Mesh(new THREE.TorusGeometry(15, 0.5, 6, 22), new THREE.MeshBasicMaterial({ color: 0x38e8ff }));
    spin.add(rim);
    var spokeMat = new THREE.MeshBasicMaterial({ color: 0xff4fa3 });
    for (var sI = 0; sI < 4; sI++) {
      var spoke = new THREE.Mesh(new THREE.BoxGeometry(30, 0.34, 0.34), spokeMat);
      spoke.rotation.z = sI / 4 * Math.PI; // spread in the wheel's XY plane
      spin.add(spoke);
    }
    var cabGeo = new THREE.BoxGeometry(1.8, 1.8, 1.8);
    var cabs = new THREE.InstancedMesh(cabGeo, new THREE.MeshBasicMaterial({ color: 0xffe14f }), 8);
    spin.add(cabs);
    city.wheelCabs = cabs;
    city.wheelSpin = spin;
    // stand the wheel up facing the shore. It rides the pier, and the pier
    // moved a block south when the bridge took the z=150 slot.
    var WZ = PIERS[0][0];
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(492, 17.5, WZ);
    scene.add(wheel);
    city.wheel = wheel;
    var supB = new GeoBatch();
    supB.addBox(492, 8.5, WZ - 6, 1.2, 17, 1.2, 0, 0x555a6a, 0);
    supB.addBox(492, 8.5, WZ + 6, 1.2, 17, 1.2, 0, 0x555a6a, 0);
    var sup = new THREE.Mesh(supB.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    sup.matrixAutoUpdate = false;
    scene.add(sup);
    addSolid(492, WZ, 3, 14, 17, 'prop');

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

  // long runway in the open southern strip (no blocks are generated past z=350)
  city.airport = {
    cx: -230, cz: 432, minX: -430, maxX: -30, z0: 419, z1: 445, apron: { x: -412, z: 432 },
    fx0: -448, fx1: -12, fz0: 404, fz1: 488, gate: { x: -160, w: 26 } // perimeter fence + a gate gap
  };
  function buildAirport(scene) {
    var A = city.airport;
    buildAirportFence(scene, A);
    var b = new GeoBatch();
    var marks = new GeoBatch();
    // runway asphalt
    b.addGroundQuad((A.minX + A.maxX) / 2, 0.04, A.cz, A.maxX - A.minX, 26, 0, 0x0e0c14);
    // dashed centerline
    for (var x = A.minX + 12; x < A.maxX - 12; x += 14) marks.addGroundQuad(x, 0.07, A.cz, 6, 0.5, 0, 0xd8c46a);
    // threshold bars at each end
    for (var t = -1; t <= 1; t += 2) {
      for (var k = -4; k <= 4; k += 2) {
        marks.addGroundQuad(A.cx + t * ((A.maxX - A.minX) / 2 - 6), 0.07, A.cz + k * 1.4, 4, 0.9, 0, 0xf0f0f0);
      }
    }
    // apron pad
    b.addGroundQuad(A.apron.x, 0.05, A.apron.z, 34, 34, 0, 0x1a1a22);
    var rw = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    rw.matrixAutoUpdate = false; scene.add(rw);
    var mk = new THREE.Mesh(marks.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
    mk.matrixAutoUpdate = false; scene.add(mk);
    // terminal building + control tower, south of the runway
    var tb = new GeoBatch();
    tb.addBox(A.cx + 30, 5, A.cz + 28, 84, 10, 16, 0, 0x8a94b0, 28);
    tb.addBox(A.cx + 40, 12, A.cz + 26, 8, 24, 8, 0, 0x9aa8c8, 0); // tower
    tb.addBox(A.cx + 40, 25, A.cz + 26, 11, 4, 11, 0, 0x141824, 0); // tower cab
    var tbm = new THREE.Mesh(tb.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    tbm.matrixAutoUpdate = false; scene.add(tbm);
    addSolid(A.cx + 30, A.cz + 28, 84, 16, 10);
    addSolid(A.cx + 40, A.cz + 26, 8, 8, 24);
    // runway edge lights
    var glowB = new GeoBatch();
    for (var gx = A.minX; gx <= A.maxX; gx += 24) {
      glowB.addGroundQuad(gx, 0.06, A.cz - 13.5, 2, 2, 0, 0xffffff);
      glowB.addGroundQuad(gx, 0.06, A.cz + 13.5, 2, 2, 0, 0xffffff);
    }
    var glowMesh = new THREE.Mesh(glowB.build(), new THREE.MeshBasicMaterial({ map: radialGlowTexture('rgba(120,180,255,0.6)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    glowMesh.matrixAutoUpdate = false; scene.add(glowMesh);
  }
  city.inAirport = function (x, z) {
    var A = city.airport;
    return x > A.fx0 && x < A.fx1 && z > A.fz0 && z < A.fz1;
  };

  function buildAirportFence(scene, A) {
    var b = new GeoBatch();
    var railColor = 0x9aa0ac, postColor = 0x6a7078;
    // posts + top rail along a segment (x0,z0)->(x1,z1)
    function run(x0, z0, x1, z1) {
      var len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 5));
      for (var k = 0; k <= n; k++) {
        var t = k / n, px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
        b.addBox(px, 1.4, pz, 0.24, 2.8, 0.24, 0, postColor, 0);
      }
      var mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, ang = Math.atan2(x1 - x0, z1 - z0);
      b.addBox(mx, 2.5, mz, 0.1, 0.16, len, ang, railColor, 0);
      b.addBox(mx, 1.7, mz, 0.1, 0.12, len, ang, railColor, 0);
      b.addBox(mx, 0.9, mz, 0.1, 0.12, len, ang, railColor, 0);
    }
    // north edge split around the gate
    var gL = A.gate.x - A.gate.w / 2, gR = A.gate.x + A.gate.w / 2;
    run(A.fx0, A.fz0, gL, A.fz0); run(gR, A.fz0, A.fx1, A.fz0);
    run(A.fx0, A.fz1, A.fx1, A.fz1);       // south
    run(A.fx0, A.fz0, A.fx0, A.fz1);       // west
    run(A.fx1, A.fz0, A.fx1, A.fz1);       // east
    var mesh = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    // solid collision segments (thin walls), leaving the gate open
    addSolid((A.fx0 + gL) / 2, A.fz0, gL - A.fx0, 0.5, 3, 'fence', true);
    addSolid((gR + A.fx1) / 2, A.fz0, A.fx1 - gR, 0.5, 3, 'fence', true);
    addSolid((A.fx0 + A.fx1) / 2, A.fz1, A.fx1 - A.fx0, 0.5, 3, 'fence', true);
    addSolid(A.fx0, (A.fz0 + A.fz1) / 2, 0.5, A.fz1 - A.fz0, 3, 'fence', true);
    addSolid(A.fx1, (A.fz0 + A.fz1) / 2, 0.5, A.fz1 - A.fz0, 3, 'fence', true);
  }

  // The only helipad in the world is on the Alta Verde lookout now — Isla Verde
  // sets this when it registers. Until the bridges open there is no helicopter
  // anywhere, which is the point.
  city.helipad = { x: 402, z: 300 };

  // wedge-shaped jump ramps scattered around the city. They are drivable
  // surfaces (see rampAt / groundY), not solids, so you ride up and launch.
  // Lay out the 25 stunt-jump ramps. Anchors go near landmarks; the rest fill
  // in along road verges, spread out and clear of buildings and water.
  function rollStuntSpots() {
    var A = city.airport, H = city.pois.hospitals, PL = city.pois.police;
    var anchors = [
      { x: -194, z: 208, rot: Math.PI / 2, h: 6.6, len: 22 },   // harbour warehouses
      { x: -294, z: 308, rot: Math.PI / 2, h: 6.6, len: 22 },
      { x: -430, z: -170, rot: Math.PI, h: 5.6, len: 24 },      // riverside
      { x: 366, z: -230, rot: Math.PI, h: 5.0, len: 26 },       // boardwalk
      { x: 366, z: 330, rot: 0, h: 5.0, len: 26 },              // beach, other way
      { x: -78, z: A.cz, rot: Math.PI / 2, h: 7.2, len: 32, boost: true }, // runway end -> over the fence
      { x: A.cx + 30, z: 462, rot: Math.PI / 2, h: 6.4, len: 30 }, // airport apron
      { x: A.cx - 90, z: 462, rot: -Math.PI / 2, h: 6.4, len: 30 },
      { x: H[0].x + 34, z: H[0].z + 30, rot: 0, h: 4.6, len: 22 },  // hospital
      { x: H[1].x + 34, z: H[1].z + 30, rot: 0, h: 4.6, len: 22 },
      { x: PL.x + 34, z: PL.z + 30, rot: 0, h: 4.6, len: 22 },      // police station
      { x: 232, z: 132, rot: Math.PI, h: 4.6, len: 22 },            // ferris wheel side
      { x: 68, z: -168, rot: 0, h: 4.2, len: 20 },
      { x: -168, z: -68, rot: Math.PI / 2, h: 4.2, len: 20 }
    ];
    var out = [], TARGET = 25;
    // ramps come in four sizes so no two jumps feel the same; every third one
    // gets a booster strip that slams the throttle open as you ride up it
    var SHAPES = [
      { w: 9, len: 16, h: 3.2 },    // kicker  — narrow, line it up
      { w: 13, len: 22, h: 4.4 },   // standard
      { w: 17, len: 28, h: 5.8 },   // long
      { w: 22, len: 34, h: 7.4 }    // mega    — wide enough to hit at an angle
    ];
    function varyRamp(x, z, rot, n) {
      var sh = SHAPES[n % SHAPES.length];
      return { x: x, z: z, rot: rot, w: sh.w, len: sh.len, h: sh.h, boost: n % 3 === 2 };
    }
    function ok(x, z) {
      if (city.isInWater(x, z)) return false;
      if (city.nearCrossing(x, z, 16)) return false;   // not on a bridge approach
      if (x < -470 || x > 396 || Math.abs(z) > 476) return false;
      for (var i = 0; i < out.length; i++) if (U.dist2(x, z, out[i].x, out[i].z) < 78 * 78) return false;
      var boxes = city.hash.query(x, z, 18);
      for (var b = 0; b < boxes.length; b++) {
        var q = boxes[b];
        if (x > q.minX - 14 && x < q.maxX + 14 && z > q.minZ - 14 && z < q.maxZ + 14) return false;
      }
      return true;
    }
    function offRoad(x, z) {
      for (var i = 0; i < R.length; i++) if (Math.abs(x - R[i]) < 12 || Math.abs(z - R[i]) < 12) return false;
      return true;
    }
    // The ramp deck and the run-up leading to it have to be clear across the
    // full width — testing only the centre point lets a wall sit square across
    // the approach, and then the jump can never be lined up at all.
    function approachClear(x, z, rot, w, len) {
      var c = Math.cos(rot), s = Math.sin(rot);
      for (var lz = -len / 2 - 34; lz <= len / 2; lz += 4) {
        for (var lx = -w / 2; lx <= w / 2 + 0.01; lx += w / 2) {
          var px = x + lx * c + lz * s, pz = z - lx * s + lz * c;
          var boxes = city.hash.query(px, pz, 3);
          for (var b = 0; b < boxes.length; b++) {
            var q = boxes[b];
            if (px > q.minX - 1.5 && px < q.maxX + 1.5 && pz > q.minZ - 1.5 && pz < q.maxZ + 1.5) return false;
          }
        }
      }
      return true;
    }
    // A jump you cannot land is not a jump. Range grows with the square of the
    // exit speed, so a boosted ramp throws you the better part of a block —
    // check where that puts you down before committing to the direction.
    function landingOk(x, z, rot, h, len, boost) {
      var v = boost ? 100 : 34;
      var range = v * v * (h / len) / 12;
      var ux = Math.sin(rot), uz = Math.cos(rot);
      for (var t = 0.45; t <= 1.3; t += 0.085) {
        var lx = x + ux * (len / 2 + range * t);
        var lz = z + uz * (len / 2 + range * t);
        if (lx < -466 || lx > 392 || Math.abs(lz) > 472) return false;
        if (city.isInWater(lx, lz)) return false;
      }
      // and nothing tall in the air corridor: a wall two metres past the lip
      // turns the jump into a face-plant that can never be credited
      for (var t2 = 0.1; t2 <= 1.3; t2 += 0.06) {
        var cx2 = x + ux * (len / 2 + range * t2);
        var cz2 = z + uz * (len / 2 + range * t2);
        var boxes = city.hash.query(cx2, cz2, 3);
        for (var b2 = 0; b2 < boxes.length; b2++) {
          var q2 = boxes[b2];
          if (q2.h === undefined || q2.h < 3) continue;
          if (cx2 > q2.minX - 2 && cx2 < q2.maxX + 2 && cz2 > q2.minZ - 2 && cz2 < q2.maxZ + 2) return false;
        }
      }
      return true;
    }
    for (var a = 0; a < anchors.length && out.length < TARGET; a++) {
      var an = anchors[a];
      // nudge an anchor off the carriageway if it landed on one
      for (var n = 0; n < 8 && !offRoad(an.x, an.z); n++) { an.x += 4; an.z += 4; }
      if (offRoad(an.x, an.z) && ok(an.x, an.z)) {
        var abst = an.boost !== undefined ? an.boost : (a % 3 === 1);
        // keep the hand-placed direction if it lands, else fire it the other way
        var arot = an.rot, aok = false;
        for (var f = 0; f < 2; f++) {
          if (landingOk(an.x, an.z, arot, an.h, an.len, abst) && approachClear(an.x, an.z, arot, 12, an.len)) { aok = true; break; }
          arot += Math.PI;
        }
        if (!aok) continue;
        out.push({ x: an.x, z: an.z, rot: arot, w: 12, len: an.len, h: an.h, boost: abst });
      }
    }
    // fill the rest along road verges, alternating orientation
    for (var pass = 0; pass < 4 && out.length < TARGET; pass++) {
      for (var i2 = 0; i2 < R.length && out.length < TARGET; i2++) {
        for (var d = -400; d <= 400 && out.length < TARGET; d += 100) {
          var side = (i2 + pass) % 2 ? 1 : -1;
          var jitter = ((i2 * 37 + d + pass * 13) % 60) - 30;
          // wider ramps sit further from the kerb so they never reach the lanes
          var shape = SHAPES[out.length % SHAPES.length];
          var vergeOut = 11 + shape.w / 2;
          var bst = out.length % 3 === 2;
          // verge beside a north-south road, launching along it
          var vx = R[i2] + side * vergeOut, vz = d + jitter;
          if (offRoad(vx, vz) && ok(vx, vz)) {
            var vrot = side > 0 ? 0 : Math.PI, vok = false;
            for (var fv = 0; fv < 2; fv++) {
              if (landingOk(vx, vz, vrot, shape.h, shape.len, bst) && approachClear(vx, vz, vrot, shape.w, shape.len)) { vok = true; break; }
              vrot += Math.PI;
            }
            if (vok) { out.push(varyRamp(vx, vz, vrot, out.length)); continue; }
          }
          // verge beside an east-west road
          var hx = d + jitter, hz = R[i2] + side * vergeOut;
          if (hx < 340 && offRoad(hx, hz) && ok(hx, hz)) {
            var hrot = side > 0 ? Math.PI / 2 : -Math.PI / 2, hok = false;
            for (var fh = 0; fh < 2; fh++) {
              if (landingOk(hx, hz, hrot, shape.h, shape.len, bst) && approachClear(hx, hz, hrot, shape.w, shape.len)) { hok = true; break; }
              hrot += Math.PI;
            }
            if (!hok) continue;
            out.push(varyRamp(hx, hz, hrot, out.length));
          }
        }
      }
    }
    return out;
  }

  function buildRamps(scene) {
    // 25 unique stunt jumps scattered across the city: construction ramps
    // parked on verges and aprons near landmarks, each one a find.
    var SPOTS = rollStuntSpots();
    var pos = [], col = [], nrm = [];
    function tri(ax, ay, az, bx, by, bz, cx2, cy, cz2, r, g, b) {
      var ux = bx - ax, uy = by - ay, uz = bz - az;
      var vx = cx2 - ax, vy = cy - ay, vz = cz2 - az;
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      var l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= l; ny /= l; nz /= l;
      pos.push(ax, ay, az, bx, by, bz, cx2, cy, cz2);
      for (var k = 0; k < 3; k++) { nrm.push(nx, ny, nz); col.push(r, g, b); }
    }
    for (var i = 0; i < SPOTS.length; i++) {
      var s = SPOTS[i];
      var c = Math.cos(s.rot), sn = Math.sin(s.rot);
      // world position of a local (across, along, up) point
      function P(lx, lz, ly) {
        return [s.x + lx * c + lz * sn, ly, s.z - lx * sn + lz * c];
      }
      var hw = s.w / 2, hl = s.len / 2;
      var a0 = P(-hw, -hl, 0), b0 = P(hw, -hl, 0);      // bottom lip
      var a1 = P(-hw, hl, s.h), b1 = P(hw, hl, s.h);    // top lip
      var a1g = P(-hw, hl, 0), b1g = P(hw, hl, 0);      // top lip at ground
      // weathered concrete deck with a hazard-striped lip, like a construction
      // ramp left on site — not a neon prop
      var R1 = 0.44, G1 = 0.43, B1 = 0.47;
      if (s.boost) { R1 = 0.16; G1 = 0.72; B1 = 0.80; }   // booster strip
      var lipT = P(-hw, hl - 2.2, s.h * (1 - 2.2 / s.len)), lipB = P(hw, hl - 2.2, s.h * (1 - 2.2 / s.len));
      tri(a0[0], a0[1], a0[2], b0[0], b0[1], b0[2], lipB[0], lipB[1], lipB[2], R1, G1, B1);
      tri(a0[0], a0[1], a0[2], lipB[0], lipB[1], lipB[2], lipT[0], lipT[1], lipT[2], R1, G1, B1);
      // yellow warning band across the take-off edge
      var lipR = s.boost ? 0.30 : 0.85, lipG = s.boost ? 1.0 : 0.70, lipB2 = s.boost ? 1.0 : 0.18;
      tri(lipT[0], lipT[1], lipT[2], lipB[0], lipB[1], lipB[2], b1[0], b1[1], b1[2], lipR, lipG, lipB2);
      tri(lipT[0], lipT[1], lipT[2], b1[0], b1[1], b1[2], a1[0], a1[1], a1[2], lipR, lipG, lipB2);
      // booster decks wear chevrons up both edges so you can read the direction
      if (s.boost) {
        var deckY = function (lz) { return s.h * ((lz + hl) / s.len) + 0.07; };
        for (var ci = 0; ci < 3; ci++) {
          var cz2 = -hl + s.len * (0.28 + ci * 0.22);
          for (var sgn = -1; sgn <= 1; sgn += 2) {
            var ax2 = sgn * (s.w / 2 - 1.5);
            var tip = P(ax2, cz2 + 1.5, deckY(cz2 + 1.5));
            var bl = P(ax2 - 1.1, cz2 - 0.7, deckY(cz2 - 0.7));
            var br = P(ax2 + 1.1, cz2 - 0.7, deckY(cz2 - 0.7));
            tri(bl[0], bl[1], bl[2], br[0], br[1], br[2], tip[0], tip[1], tip[2], 0.60, 1.0, 1.0);
          }
        }
      }
      // back face
      tri(a1[0], a1[1], a1[2], b1[0], b1[1], b1[2], b1g[0], b1g[1], b1g[2], 0.20, 0.19, 0.23);
      tri(a1[0], a1[1], a1[2], b1g[0], b1g[1], b1g[2], a1g[0], a1g[1], a1g[2], 0.20, 0.19, 0.23);
      // side walls
      tri(a0[0], a0[1], a0[2], a1[0], a1[1], a1[2], a1g[0], a1g[1], a1g[2], 0.31, 0.30, 0.34);
      tri(b0[0], b0[1], b0[2], b1g[0], b1g[1], b1g[2], b1[0], b1[1], b1[2], 0.31, 0.30, 0.34);

      var rad = Math.max(s.w, s.len) / 2 + 2;
      city.ramps.push({
        idx: i, x: s.x, z: s.z, rot: s.rot, w: s.w, len: s.len, h: s.h, boost: !!s.boost,
        cos: c, sin: sn,
        minX: s.x - rad, maxX: s.x + rad, minZ: s.z - rad, maxZ: s.z + rad
      });
      // the tall back face is solid: come at it from behind and you hit a wall.
      // It sits just beyond the lip and stops short of it, so a car launching
      // off the top sails over while one approaching from behind is stopped.
      var bc = P(0, hl + 1.1, 0);
      var across = Math.abs(Math.cos(s.rot)) > 0.5;
      addSolid(bc[0], bc[2], across ? s.w : 2.0, across ? 2.0 : s.w, s.h * 0.62, 'building');
      // the raked flanks are solid too. Every ramp is axis-aligned, so each
      // side is three stepped boxes rising with the deck — walk or drive into
      // the side and you hit a wall, while anyone ON the deck stands above the
      // step beside them and riding up the low quarter still works for angled
      // hits on the approach. Boxes run lengthways along the ramp (world axis
      // depends on the rotation), one metre thick, flush with the deck edge.
      for (var sd = -1; sd <= 1; sd += 2) {
        for (var st = 0; st < 3; st++) {
          var t0 = 0.25 + st * 0.25, t1 = t0 + 0.25;
          var lzMid = -hl + s.len * (t0 + t1) / 2, lzLen = s.len * 0.25 + 0.2;
          var wc = P(sd * (s.w / 2 + 0.5), lzMid, 0);
          addSolid(wc[0], wc[2],
            across ? 1.0 : lzLen, across ? lzLen : 1.0,
            s.h * t1, 'prop', true);
        }
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    var mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
  }

  // One graph for the whole world. The mainland's is a grid and the island's
  // follows its curves, but both are just nodes with a neighbour list — traffic
  // and the map router never learn which landmass they are on.
  function buildLaneGraph() {
    var nodes = [], i, j;
    var grid = [];
    for (i = 0; i < R.length; i++) for (j = 0; j < R.length; j++) {
      grid.push({ x: R[i], z: R[j], i: i, j: j, nb: [] });
    }
    function gridAt(a, b) {
      if (a < 0 || b < 0 || a >= R.length || b >= R.length) return null;
      return grid[a * R.length + b];
    }
    grid.forEach(function (n) {
      [gridAt(n.i - 1, n.j), gridAt(n.i + 1, n.j), gridAt(n.i, n.j - 1), gridAt(n.i, n.j + 1)]
        .forEach(function (a) { if (a) n.nb.push(a); });
    });
    nodes = grid;
    if (GAME.isla) {
      var isl = GAME.isla.laneNodes(), spans = GAME.isla.spanNodes();
      nodes = nodes.concat(isl, spans);
      // stitch each bridge's end nodes into whichever graph is nearest
      spans.forEach(function (s) {
        var best = null, bd = 60 * 60;
        for (var k = 0; k < nodes.length; k++) {
          var n = nodes[k];
          if (n.span) continue;
          var d = U.dist2(s.x, s.z, n.x, n.z);
          if (d < bd) { bd = d; best = n; }
        }
        if (best) { s.nb.push(best); best.nb.push(s); }
      });
    }
    for (i = 0; i < nodes.length; i++) nodes[i].id = i;
    city.nodes = nodes;
    city.neighbors = function (n) { return n.nb; };
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
    city.parkedSpots.push({ x: -108, z: -95, heading: 0, police: true });
    city.parkedSpots.push({ x: -108, z: -70, heading: 0, police: true });
    // an ambulance idling at each hospital (for paramedic jobs)
    city.pois.hospitals.forEach(function (H) {
      city.parkedSpots.push({ x: H.x + 22, z: H.spawn.z, heading: Math.PI / 2, vtype: 'ambulance' });
    });
    // airplane on the runway apron, lined up to taxi east
    city.parkedSpots.push({ x: city.airport.apron.x, z: city.airport.apron.z, heading: Math.PI / 2, vtype: 'airplane' });
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
      var arr = pos.array, base = city.oceanBase, mask = city.oceanMask;
      for (var i = 0, mi = 0; i < arr.length; i += 3, mi++) {
        if (mask && !mask[mi]) continue; // inland vertex: stays sunk under the streets
        var x = base[i], z = base[i + 2];
        arr[i + 1] = base[i + 1] + Math.sin(x * 0.045 + t * 1.1) * 0.28 + Math.sin(z * 0.06 + t * 0.7) * 0.22;
      }
      pos.needsUpdate = true;
    }
    if (city.wheelSpin) {
      city.wheelSpin.rotation.z += dt * 0.15; // spin about the hub axis
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
