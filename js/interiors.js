// Interiors you can walk into.
//
// Every door in the city was a menu: step on the mat of the condo you own and
// a SLEEP IT OFF card came up on the pavement; the casino was a counter on the
// pier. Now the homes you own and the casino are rooms. Step on the mat and
// you go in — a bed at the back of your place (it is where you sleep it off
// now), a couch and a TV and a window on the night; the Lucky Gull's wheel up
// on the back wall, a bar with drinks that patch you up, slot machines, and a
// floor of people who are not going anywhere. Step back on the mat by the
// door to leave.
//
// The rooms are built out past the edge of the world, in the fog nobody flies
// into, and while you are in one the rest of the game goes on around its
// front door: that is where the streets stay filled, where the radar points,
// and where anybody hunting you is waiting when you come back out. Nobody
// sees you in there — a home is somewhere to lie low — but the casino's
// doorman will not let you in with the law on your tail.
GAME.interiors = (function () {
  var ROOM_X = -3400, ROOM_GAP = 80, FADE = 0.45;
  var ROOMS = [
    { id: 'home_dock', name: 'DOCKSIDE FLAT', kind: 'home', w: 9, d: 8, h: 3.0,
      floor: 0x7a6248, wall: 0xa59a86, trim: 0x5a4a3a, accent: 0x38b8c8, sofa: 0x6a7a8a },
    { id: 'home_condo', name: 'STRIP CONDO', kind: 'home', w: 12, d: 10, h: 3.2,
      floor: 0x2e2440, wall: 0xe8dff0, trim: 0x8a6ab0, accent: 0xff4fa3, sofa: 0xf0f0f4, kitchen: true },
    { id: 'home_villa', name: 'MARINA VILLA', kind: 'home', w: 15, d: 12, h: 3.6,
      floor: 0xd8c8a8, wall: 0xf6f1e6, trim: 0xb8a888, accent: 0x38b8c8, sofa: 0x3a8a9a, kitchen: true },
    { id: 'casino0', name: 'THE LUCKY GULL', kind: 'casino', w: 24, d: 18, h: 5.5,
      floor: 0x6a1428, wall: 0x2a1236, trim: 0xffd24a, accent: 0xff4fa3, music: true }
  ];
  // Every business has a room too: walk in through the door, do your
  // business at the counter, walk out. One template per trade; each shop in
  // the world gets its own room from it at build time (shops.js has the
  // list), so both hardware stores and every station's desk have one.
  var SHOP_ROOMS = {
    hardware: { w: 12, d: 10, h: 3.4, floor: 0x45464c, wall: 0x7a7a62, trim: 0x2a2a22, accent: 0xffd24a,
      hello: ' — guns on the wall, the counter at the back.' },
    dress: { w: 12, d: 10, h: 3.4, floor: 0xe6dce6, wall: 0xf6e6ee, trim: 0xd86aa8, accent: 0xff8fd0,
      hello: ' — the racks are on the walls, the mirror at the back.' },
    barber: { w: 10, d: 9, h: 3.2, floor: 0xeeeeee, wall: 0xdcecf4, trim: 0x3a6a8a, accent: 0x8fd0ff,
      hello: ' — take the empty chair.' },
    showroom: { w: 22, d: 16, h: 5.5, floor: 0xd4d8e4, wall: 0x2e3346, trim: 0x8dffd8, accent: 0x8dffd8,
      hello: ' — the sales desk is at the back. What you buy waits for you outside.' },
    bribe: { w: 12, d: 10, h: 3.6, floor: 0x5c6272, wall: 0xb4bccc, trim: 0x22305a, accent: 0x4da3ff,
      hello: ' — the sergeant is at the desk.' }
  };
  var byId = {};
  var cur = null;            // { room, loc, door: {x,y,z}, heading }
  var pending = null;        // a fade in progress: { t, fn, half }
  var built = false;

  // ---------- building ----------
  // Unlit, with the light baked into the faces: a room looks the same at
  // midnight as at noon, which is what a lit room does.
  function shade(b, from) {
    for (var i = from; i < b.n; i++) {
      var ny = b.nrm[i * 3 + 1], nx = b.nrm[i * 3];
      var k = ny > 0.5 ? 1 : ny < -0.5 ? 0.55 : Math.abs(nx) > 0.5 ? 0.84 : 0.7;
      b.col[i * 3] *= k; b.col[i * 3 + 1] *= k; b.col[i * 3 + 2] *= k;
    }
  }
  function box(b, x, y, z, w, h, d, color) {
    var n0 = b.n;
    b.addBox(x, y, z, w, h, d, 0, color, 0);
    shade(b, n0);
  }
  function solid(x, z, w, d, h) { GAME.city.addSolid(x, z, w, d, h, 'prop'); }
  function ring(room, x, z, color, label, act) {
    var m = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.0, 32), new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.04, z);
    GAME.scene.add(m);
    room.rings.push({ x: x, z: z, mesh: m, label: label, act: act, armed: false });
  }
  function glow(x, y, z, w, h, d, color) {
    var m = new THREE.Mesh(sharedBoxGeo(w, h, d), sharedBasic(color));
    m.position.set(x, y, z);
    GAME.scene.add(m);
    return m;
  }
  function figure(x, z, heading, look) {
    var m = GAME.peds.buildPedMesh(look || {});
    m.position.set(x, 0, z);
    m.rotation.y = heading;
    GAME.scene.add(m);
    return m;
  }

  function buildRoom(b, room, i) {
    var ox = ROOM_X - i * ROOM_GAP, oz = 0, w = room.w, d = room.d, h = room.h;
    room.ox = ox; room.oz = oz;
    room.rings = []; room.anim = [];
    room.entry = { x: ox, z: oz - d / 2 + 1.7 };
    // what you stand on (a deck: out here it would otherwise be open sea)
    GAME.city.addDeck({ x: ox, z: oz, w: w, len: d, rot: 0, y0: 0, y1: 0 });
    box(b, ox, -0.1, oz, w, 0.2, d, room.floor);
    box(b, ox, h + 0.1, oz, w + 0.6, 0.2, d + 0.6, room.kind === 'casino' ? 0x1a0a22 : 0xf4f0ea);
    // four walls, solid, and a skirting board round the bottom
    box(b, ox, h / 2, oz + d / 2 + 0.15, w + 0.6, h, 0.3, room.wall);
    box(b, ox, h / 2, oz - d / 2 - 0.15, w + 0.6, h, 0.3, room.wall);
    box(b, ox - w / 2 - 0.15, h / 2, oz, 0.3, h, d, room.wall);
    box(b, ox + w / 2 + 0.15, h / 2, oz, 0.3, h, d, room.wall);
    GAME.city.addSolid(ox, oz + d / 2 + 0.4, w + 1.4, 0.8, h + 0.4, 'building');
    GAME.city.addSolid(ox, oz - d / 2 - 0.4, w + 1.4, 0.8, h + 0.4, 'building');
    GAME.city.addSolid(ox - w / 2 - 0.4, oz, 0.8, d + 1.4, h + 0.4, 'building');
    GAME.city.addSolid(ox + w / 2 + 0.4, oz, 0.8, d + 1.4, h + 0.4, 'building');
    box(b, ox, 0.08, oz + d / 2 - 0.02, w, 0.16, 0.04, room.trim);
    box(b, ox - w / 2 + 0.02, 0.08, oz, 0.04, 0.16, d, room.trim);
    box(b, ox + w / 2 - 0.02, 0.08, oz, 0.04, 0.16, d, room.trim);
    // the way you came in, and the mat that takes you back out
    box(b, ox, 1.15, oz - d / 2 + 0.04, 1.4, 2.3, 0.08, room.kind === 'casino' ? 0x3a2410 : room.trim);
    box(b, ox + 0.5, 1.1, oz - d / 2 + 0.1, 0.08, 0.08, 0.08, 0xffd24a);
    ring(room, ox, oz - d / 2 + 1.0, 0x8de8b0, 'EXIT — step on to go back out', exitRoom);
    if (room.kind === 'home') furnishHome(b, room);
    else if (room.kind === 'shop') furnishShop(b, room);
    else furnishCasino(b, room);
  }

  function furnishHome(b, room) {
    var ox = room.ox, oz = room.oz, w = room.w, d = room.d, h = room.h;
    // a rug in the middle
    box(b, ox, 0.012, oz + 0.3, w * 0.42, 0.024, d * 0.38, (room.accent & 0xfefefe) >> 1);
    // the bed, back right, and the mat beside it
    var bx = ox + w / 2 - 1.3, bz = oz + d / 2 - 1.6;
    box(b, bx, 0.22, bz, 2.0, 0.44, 2.6, room.trim);
    box(b, bx, 0.56, bz, 1.86, 0.24, 2.46, 0xf4f0ea);
    box(b, bx, 0.74, bz + 0.92, 1.4, 0.14, 0.42, 0xffffff);
    box(b, bx, 0.71, bz - 0.38, 1.9, 0.1, 1.66, room.accent);
    box(b, bx, 0.85, bz + 1.32, 2.0, 1.2, 0.12, room.trim);
    solid(bx, bz, 2.0, 2.6, 0.7);
    ring(room, bx - 1.75, bz - 0.5, room.accent, 'YOUR BED — step on to sleep it off', function () {
      if (GAME.shops && cur && cur.loc) GAME.shops.open(cur.loc);
    });
    // the couch and the TV, back left
    var cx = ox - w / 2 + 2.2, cz = oz + d / 2 - 3.4;
    box(b, cx, 0.24, cz, 2.6, 0.48, 0.95, room.sofa);
    box(b, cx, 0.62, cz - 0.4, 2.6, 0.8, 0.2, room.sofa);
    box(b, cx - 1.38, 0.4, cz, 0.18, 0.8, 0.95, room.sofa);
    box(b, cx + 1.38, 0.4, cz, 0.18, 0.8, 0.95, room.sofa);
    solid(cx, cz - 0.1, 3.0, 1.1, 0.8);
    var tz = oz + d / 2 - 0.5;
    box(b, cx, 0.3, tz, 1.8, 0.6, 0.5, room.trim);
    box(b, cx, 1.1, tz, 1.5, 0.9, 0.1, 0x101016);
    solid(cx, tz, 1.8, 0.6, 1.5);
    var screen = glow(cx, 1.1, tz - 0.06, 1.34, 0.76, 0.02, 0x5a8ad8);
    screen.material = new THREE.MeshBasicMaterial({ color: 0x5a8ad8 });
    room.anim.push({ tv: screen });
    // a window on the city at night, on the back wall between them
    var wx = ox - 0.2, wz = oz + d / 2 - 0.02;
    box(b, wx, 1.6, wz, 2.8, 1.4, 0.04, 0x0c1430);
    for (var k = 0; k < 9; k++) {
      var bh = 0.3 + ((k * 37) % 7) * 0.12;
      box(b, wx - 1.2 + k * 0.3, 0.9 + bh / 2 + 0.05, wz - 0.03, 0.22, bh, 0.02, 0x1c2850);
      box(b, wx - 1.2 + k * 0.3, 0.95 + bh * 0.6, wz - 0.04, 0.05, 0.05, 0.02, 0xffe9a0);
    }
    box(b, wx, 2.24, wz - 0.03, 2.6, 0.04, 0.02, 0xff4fa3);
    box(b, wx, 1.6, wz - 0.05, 2.9, 0.06, 0.06, room.trim);
    // a lamp and a plant by the door
    box(b, ox - w / 2 + 0.6, 0.8, oz - d / 2 + 0.9, 0.08, 1.6, 0.08, 0x30303a);
    glow(ox - w / 2 + 0.6, 1.7, oz - d / 2 + 0.9, 0.5, 0.36, 0.5, 0xffe2a8);
    box(b, ox + w / 2 - 0.6, 0.25, oz - d / 2 + 0.9, 0.5, 0.5, 0.5, 0xb06a3a);
    box(b, ox + w / 2 - 0.6, 0.8, oz - d / 2 + 0.9, 0.7, 0.7, 0.7, 0x3a8a4a);
    box(b, ox + w / 2 - 0.6, 1.25, oz - d / 2 + 0.9, 0.45, 0.45, 0.45, 0x4aa05a);
    // the wardrobe, halfway down the left wall: everything you own, on
    // hangers (shops.js, kind 'wardrobe') — clear of the path in from the door
    var wx2 = ox - w / 2 + 0.35, wz2 = oz - 0.5;
    box(b, wx2, 1.05, wz2, 0.6, 2.1, 1.3, room.trim);
    box(b, wx2 + 0.31, 1.05, wz2 - 0.32, 0.02, 1.9, 0.6, (room.trim & 0xfefefe) >> 1);
    box(b, wx2 + 0.31, 1.05, wz2 + 0.32, 0.02, 1.9, 0.6, (room.trim & 0xfefefe) >> 1);
    box(b, wx2 + 0.33, 1.1, wz2 - 0.06, 0.04, 0.16, 0.04, 0xffd24a);
    box(b, wx2 + 0.33, 1.1, wz2 + 0.06, 0.04, 0.16, 0.04, 0xffd24a);
    solid(wx2, wz2, 0.6, 1.3, 2.1);
    ring(room, wx2 + 1.25, wz2, room.accent, 'YOUR WARDROBE — step on to change', function () {
      if (GAME.shops) GAME.shops.open(WARDROBE);
    });
    // a picture, on the wall by the door
    box(b, ox + w / 4, 1.7, oz - d / 2 + 0.03, 1.2, 0.8, 0.04, room.accent);
    box(b, ox + w / 4, 1.7, oz - d / 2 + 0.05, 1.0, 0.6, 0.04, 0xf4e0c0);
    if (room.kitchen) {
      // a counter down the right-hand wall
      var kx = ox + w / 2 - 0.45, kz = oz - 0.6;
      box(b, kx, 0.45, kz, 0.8, 0.9, 3.4, 0xd8d8e0);
      box(b, kx, 0.92, kz, 0.86, 0.06, 3.46, 0x30303a);
      box(b, kx + 0.2, 1.7, kz, 0.4, 0.7, 3.0, 0xe8e8f0);
      solid(kx, kz, 0.8, 3.4, 1.0);
    }
  }

  function furnishCasino(b, room) {
    var ox = room.ox, oz = room.oz, w = room.w, d = room.d, h = room.h;
    // a gold-flecked carpet
    for (var gx = -w / 2 + 1.5; gx < w / 2; gx += 3) {
      for (var gz = -d / 2 + 1.5; gz < d / 2; gz += 3) box(b, ox + gx, 0.005, oz + gz, 0.3, 0.01, 0.3, 0xb8902a);
    }
    // the wheel, up on the back wall, and its mat
    var wz = oz + d / 2 - 0.25, wy = 3.0;
    var wheel = new THREE.Group();
    var segCols = [0xff2d95, 0xf5f0ff, 0x2de8ff, 0xffd24a];
    for (var s = 0; s < 12; s++) {
      var seg = new THREE.Mesh(sharedBoxGeo(0.5, 2.0, 0.12), sharedBasic(segCols[s % 4]));
      var a = s / 12 * Math.PI * 2;
      seg.position.set(Math.sin(a) * 1.05, Math.cos(a) * 1.05, 0);
      seg.rotation.z = -a;
      wheel.add(seg);
    }
    var hub = new THREE.Mesh(sharedBoxGeo(0.6, 0.6, 0.2), sharedBasic(0xffd24a));
    wheel.add(hub);
    wheel.position.set(ox, wy, wz);
    GAME.scene.add(wheel);
    box(b, ox, wy, wz + 0.12, 4.9, 4.9, 0.1, 0x14061c);
    box(b, ox, wy + 2.25, wz - 0.1, 0.3, 0.5, 0.2, 0xffd24a);   // the pointer
    room.anim.push({ wheel: wheel });
    var stage = oz + d / 2 - 2.6;
    ring(room, ox, stage, 0xffd24a, 'THE WHEEL — step on to place a bet', function () {
      if (GAME.shops && cur && cur.loc) GAME.shops.open(cur.loc);
    });
    // the sign
    glow(ox, h - 0.6, oz + d / 2 - 0.08, 6.5, 0.5, 0.06, 0xff4fa3);
    glow(ox, h - 1.05, oz + d / 2 - 0.08, 4.0, 0.16, 0.06, 0xffd24a);
    // the bar, down the left wall, with somebody behind it
    var bx = ox - w / 2 + 2.0, bz = oz + 1.0;
    box(b, bx, 0.55, bz, 1.0, 1.1, 7.0, 0x3a1a10);
    box(b, bx, 1.13, bz, 1.12, 0.06, 7.1, 0xffd24a);
    box(b, ox - w / 2 + 0.35, 1.8, bz, 0.5, 0.06, 6.6, 0x5a3a20);
    box(b, ox - w / 2 + 0.35, 2.5, bz, 0.5, 0.06, 6.6, 0x5a3a20);
    var bottle = [0x40c070, 0xc04060, 0xf0d070, 0x6080e0, 0xe0e0f0];
    for (var bt = 0; bt < 14; bt++) {
      box(b, ox - w / 2 + 0.35, 2.0 + (bt % 2) * 0.7, bz - 3 + bt * 0.45, 0.14, 0.36, 0.14, bottle[bt % 5]);
    }
    solid(bx, bz, 1.0, 7.0, 1.2);
    for (var st = 0; st < 5; st++) {
      box(b, bx + 1.0, 0.36, bz - 2.6 + st * 1.3, 0.45, 0.72, 0.45, 0x2a2a30);
      box(b, bx + 1.0, 0.76, bz - 2.6 + st * 1.3, 0.55, 0.08, 0.55, 0xc02848);
    }
    room.anim.push({ fig: figure(ox - w / 2 + 1.0, bz + 0.5, Math.PI / 2, { look: { shirt: 0xf4f4f8, pants: 0x14141a, skin: 0xc89870, hair: 'slick', hairCol: 0x1a1210 } }), sway: 0.5 });
    ring(room, bx + 2.2, bz, 0xff8fc8, 'THE BAR — step on for a drink', function () {
      if (GAME.shops) GAME.shops.open(BAR);
    });
    // Gull Downs (derby.js): race terminals down the right wall, every one
    // of them showing the race, a big screen above them all, and the
    // regulars at their terminals, cheering their horses home
    var raceTex = GAME.derby ? GAME.derby.texture() : null;
    var screenMat = raceTex ? new THREE.MeshBasicMaterial({ map: raceTex }) : sharedBasic(0x101018);
    function screen(x, y, z, sw, sh) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), screenMat);
      m.position.set(x, y, z);
      m.rotation.y = -Math.PI / 2;     // facing into the room
      GAME.scene.add(m);
      return m;
    }
    for (var sm = 0; sm < 6; sm++) {
      var sx = ox + w / 2 - 0.6, sz = oz - d / 2 + 3 + sm * 2.0;
      box(b, sx, 0.8, sz, 0.8, 1.6, 1.0, 0x30205a);
      box(b, sx - 0.42, 1.55, sz, 0.06, 0.52, 0.9, 0x101018);
      screen(sx - 0.46, 1.55, sz, 0.84, 0.42);
      box(b, sx - 0.5, 1.0, sz, 0.3, 0.06, 0.8, 0xffd24a);          // the betting slip shelf
      solid(sx, sz, 0.8, 1.0, 1.6);
      var lamp = glow(sx - 0.1, 1.75 + 0.2, sz, 0.3, 0.12, 0.8, sm % 2 ? 0x2de8ff : 0xff2d95);
      room.anim.push({ blink: lamp, phase: sm * 0.7 });
      if (sm % 2 === 0) room.anim.push({ fig: figure(sx - 1.2, sz, Math.PI / 2), sway: 0.3 + sm * 0.1, fan: true });
    }
    var bigZ = oz - d / 2 + 8;
    box(b, ox + w / 2 - 0.08, 3.75, bigZ, 0.12, 3.5, 6.8, 0x101018);
    screen(ox + w / 2 - 0.16, 3.75, bigZ, 6.4, 3.2);
    glow(ox + w / 2 - 0.12, 2.0, bigZ, 0.06, 0.08, 6.8, 0x6fe08a);
    // the free terminal in the middle is yours
    ring(room, ox + w / 2 - 1.8, oz - d / 2 + 9, 0x6fe08a, 'GULL DOWNS — step up to bet on the horses', function () {
      if (!GAME.shops || !GAME.derby) return;
      GAME.shops.open(GAME.derby.loc);
    });
    // two card tables with players round them
    [[-2.5, -1.5], [3.5, -2.5]].forEach(function (t, k) {
      var tx = ox + t[0], tz = oz + t[1];
      box(b, tx, 0.38, tz, 2.6, 0.76, 1.6, 0x0e5a34);
      box(b, tx, 0.8, tz, 2.8, 0.08, 1.8, 0x3a1a10);
      solid(tx, tz, 2.8, 1.8, 0.85);
      room.anim.push({ fig: figure(tx, tz - 1.4, 0), sway: 0.2 + k * 0.3 });
      room.anim.push({ fig: figure(tx + 1.7, tz, -Math.PI / 2), sway: 0.6 + k * 0.2 });
      room.anim.push({ fig: figure(tx, tz + 1.4, Math.PI), sway: 0.9 + k * 0.1 });
    });
    // and lights hung from the ceiling
    for (var cl = 0; cl < 3; cl++) glow(ox - 6 + cl * 6, h - 0.35, oz - 1, 1.2, 0.3, 1.2, 0xffe2a8);
  }

  // ---------- the businesses ----------
  function counterRing(room, x, z, label) {
    ring(room, x, z, room.accent, label, function () {
      if (GAME.shops && cur && cur.loc) GAME.shops.open(cur.loc);
    });
  }
  function furnishShop(b, room) {
    var ox = room.ox, oz = room.oz, w = room.w, d = room.d, h = room.h, back = oz + d / 2;
    var fn = { hardware: furnishHardware, dress: furnishThreads, barber: furnishBarber, showroom: furnishShowroom, bribe: furnishDesk }[room.shop];
    if (fn) fn(b, room, ox, oz, w, d, h, back);
    // a strip light or two across the ceiling, whatever the trade
    glow(ox, h - 0.08, oz, Math.min(6, w * 0.4), 0.06, 0.4, 0xfff2dc);
  }
  // a counter across the back with somebody behind it, and its ring
  function counter(b, room, ox, back, len, top, col, clerkLook, label) {
    var cz = back - 2.2;
    box(b, ox, 0.55, cz, len, 1.1, 0.9, col);
    box(b, ox, 1.13, cz, len + 0.1, 0.06, 1.0, top);
    solid(ox, cz, len, 0.9, 1.15);
    room.anim.push({ fig: figure(ox, back - 1.2, Math.PI, clerkLook), sway: 0.4 });
    counterRing(room, ox, cz - 1.5, label);
  }
  function furnishHardware(b, room, ox, oz, w, d, h, back) {
    counter(b, room, ox, back, 5, 0x1a1a14, 0x5a4a32, { look: { shirt: 0x6a7a4a, pants: 0x2a2a22, skin: 0xb08060, hair: 'crew', hairCol: 0x2a2018 } },
      'THE COUNTER — step up to buy');
    // the gun wall: pegboard, and what hangs on it
    box(b, ox, 1.9, back - 0.06, w - 2, 1.8, 0.06, 0x6a5a3a);
    for (var g = 0; g < 7; g++) {
      var gx = ox - (w - 3) / 2 + g * (w - 3) / 6;
      box(b, gx, 2.45, back - 0.12, 1.3, 0.12, 0.06, 0x16161a);        // a long gun
      box(b, gx - 0.5, 2.38, back - 0.12, 0.3, 0.2, 0.06, 0x3a2a1a);   // its stock
      box(b, gx, 1.6, back - 0.12, 0.42, 0.12, 0.06, 0x1e1e24);        // a pistol
      box(b, gx + 0.14, 1.5, back - 0.12, 0.1, 0.2, 0.06, 0x1e1e24);
    }
    // shelves of rounds down both sides
    [-1, 1].forEach(function (sd) {
      var sx = ox + sd * (w / 2 - 0.4);
      for (var sh = 0; sh < 3; sh++) {
        box(b, sx, 0.5 + sh * 0.7, oz + 0.5, 0.6, 0.05, 5.5, 0x4a3a28);
        for (var k = 0; k < 6; k++) box(b, sx, 0.62 + sh * 0.7, oz - 1.8 + k * 0.9, 0.36, 0.2, 0.5, [0xd8b030, 0x3a7a3a, 0xc04030][(k + sh) % 3]);
      }
      solid(sx, oz + 0.5, 0.6, 5.5, 2.2);
    });
    // and a target on the side wall, for the look of the place
    box(b, ox - w / 2 + 0.05, 1.7, back - 3.2, 0.04, 1.0, 1.0, 0xf4f0e8);
    box(b, ox - w / 2 + 0.07, 1.7, back - 3.2, 0.04, 0.6, 0.6, 0xc02020);
    box(b, ox - w / 2 + 0.09, 1.7, back - 3.2, 0.04, 0.25, 0.25, 0xf4f0e8);
  }
  function furnishThreads(b, room, ox, oz, w, d, h, back) {
    var W = GAME.shops && GAME.shops.wardrobe, shirts = W ? W.SHIRTS : [], pants = W ? W.PANTS : [];
    // racks down both walls: a rail, and what hangs on it in this season's colours
    [-1, 1].forEach(function (sd) {
      var rx = ox + sd * (w / 2 - 0.8);
      box(b, rx, 1.75, oz, 0.06, 0.06, 6.0, 0xc0c0c8);
      box(b, rx, 0.9, oz - 3, 0.06, 1.8, 0.06, 0xc0c0c8);
      box(b, rx, 0.9, oz + 3, 0.06, 1.8, 0.06, 0xc0c0c8);
      var list = sd < 0 ? shirts : pants;
      for (var k = 0; k < 10; k++) {
        var c = list.length ? list[k % list.length].hex : 0xff8fd0;
        box(b, rx, sd < 0 ? 1.35 : 1.15, oz - 2.6 + k * 0.58, 0.5, sd < 0 ? 0.7 : 1.1, 0.07, c);
      }
      solid(rx, oz, 0.7, 6.2, 1.9);
    });
    // mannequins in the window, dressed
    room.anim.push({ fig: figure(ox - 2.2, oz - d / 2 + 2.0, 0, { look: { shirt: 0xf78ab8, pants: 0xd8c8a8, skin: 0xe8e0d8, hair: 'none', hairCol: 0 } }), sway: 0 });
    room.anim.push({ fig: figure(ox + 2.2, oz - d / 2 + 2.0, 0, { look: { shirt: 0x8fd0f0, pants: 0x2a2a34, skin: 0xe8e0d8, hair: 'none', hairCol: 0 } }), sway: 0 });
    // the mirror and the changing booth at the back
    glow(ox, 1.4, back - 0.08, 1.4, 2.2, 0.04, 0xcfe6f6);
    box(b, ox, 1.4, back - 0.04, 1.6, 2.4, 0.04, room.trim);
    box(b, ox + 3, 1.3, back - 0.9, 0.06, 2.6, 1.6, 0xff8fd0);
    box(b, ox - 3, 1.3, back - 0.9, 0.06, 2.6, 1.6, 0xff8fd0);
    room.anim.push({ fig: figure(ox + 4.4, back - 1.2, Math.PI, { look: { shirt: 0x23242e, pants: 0x23242e, skin: 0xd8a888, hair: 'ponytail', hairCol: 0x6a2a4a } }), sway: 0.7 });
    counterRing(room, ox, back - 1.6, 'THE MIRROR — step on to try things on');
  }
  function furnishBarber(b, room, ox, oz, w, d, h, back) {
    // the checkerboard
    for (var tx = 0; tx < w; tx++) for (var tz = 0; tz < d; tz++) {
      if ((tx + tz) % 2) box(b, ox - w / 2 + tx + 0.5, 0.006, oz - d / 2 + tz + 0.5, 1, 0.012, 1, 0x1a1a22);
    }
    // two chairs before two mirrors; somebody is in one of them
    [-2, 2].forEach(function (cx, k) {
      var x = ox + cx;
      glow(x, 1.6, back - 0.06, 1.3, 1.1, 0.04, 0xdcecf8);
      for (var bl = 0; bl < 5; bl++) glow(x - 0.6 + bl * 0.3, 2.25, back - 0.06, 0.1, 0.1, 0.06, 0xffe9a0);
      box(b, x, 0.9, back - 0.25, 1.6, 0.06, 0.4, 0xe8e8f0);
      box(b, x, 0.2, back - 1.6, 0.3, 0.4, 0.3, 0xc0c0c8);
      box(b, x, 0.52, back - 1.6, 0.75, 0.16, 0.7, 0xc02838);
      box(b, x, 0.95, back - 1.25, 0.75, 0.8, 0.14, 0xc02838);
      solid(x, back - 1.6, 0.8, 0.8, 1.0);
      if (k === 0) room.anim.push({ fig: figure(x + 1.0, back - 1.9, Math.PI * 0.75, { look: { shirt: 0xf4f4f8, pants: 0x2a2a34, skin: 0xa87050, hair: 'slick', hairCol: 0x1a1210 } }), sway: 0.6 });
    });
    // the pole by the door, turning
    var pole = new THREE.Group();
    for (var ps = 0; ps < 6; ps++) {
      var band = new THREE.Mesh(sharedBoxGeo(0.22, 0.16, 0.22), sharedBasic(ps % 2 ? 0xf4f4f8 : 0xd02030));
      band.position.y = ps * 0.16;
      band.rotation.y = ps * 0.4;
      pole.add(band);
    }
    pole.position.set(ox + w / 2 - 0.6, 1.1, oz - d / 2 + 1.0);
    GAME.scene.add(pole);
    room.anim.push({ pole: pole });
    // the waiting bench
    box(b, ox - w / 2 + 0.6, 0.4, oz - 0.5, 0.7, 0.12, 3.0, 0x5a3a28);
    solid(ox - w / 2 + 0.6, oz - 0.5, 0.7, 3.0, 0.5);
    counterRing(room, ox + 2, back - 2.7, 'THE CHAIR — sit down for a cut');
  }
  function furnishShowroom(b, room, ox, oz, w, d, h, back) {
    // two of the stock under the lights, on turntables
    [['sports', -4.5], ['superbike', 4.5]].forEach(function (c, k) {
      var x = ox + c[1], z = oz - 0.5;
      box(b, x, 0.04, z, 5.6, 0.08, 5.6, 0x3a3e4e);
      var m = GAME.vehicles.buildMesh(c[0]);
      if (m) {
        m.traverse(function (o) {
          if (o.isMesh && o.material) o.material = new THREE.MeshBasicMaterial({ color: o.material.color ? o.material.color.clone() : 0xffffff, vertexColors: !!o.material.vertexColors });
        });
        m.position.set(x, 0.08, z);
        GAME.scene.add(m);
        room.anim.push({ turntable: m, rate: k ? -0.25 : 0.25 });
      }
      solid(x, z, 4.6, 4.6, 1.4);
      glow(x, h - 0.1, z, 1.4, 0.08, 1.4, 0xf4f8ff);
    });
    counter(b, room, ox, back, 4, 0x8dffd8, 0x2a2e3a, { look: { shirt: 0xf4f4f8, pants: 0x2a2a34, skin: 0xc89870, hair: 'slick', hairCol: 0x2a1a10 } },
      'THE SALES DESK — step up to browse');
    // the name in lights across the back
    glow(ox, h - 1.0, back - 0.06, 8, 0.5, 0.04, 0x8dffd8);
  }
  function furnishDesk(b, room, ox, oz, w, d, h, back) {
    counter(b, room, ox, back, 5, 0x22305a, 0x3a4a6a, { cop: true }, 'THE DESK — a word with the sergeant');
    // the badge on the wall behind him, and a WANTED board
    glow(ox, 2.5, back - 0.06, 1.0, 1.0, 0.04, 0xffd24a);
    glow(ox, 2.5, back - 0.08, 0.6, 0.6, 0.04, 0x22305a);
    box(b, ox - w / 2 + 0.05, 1.7, oz, 0.04, 1.2, 2.4, 0x5a4a32);
    for (var wp = 0; wp < 4; wp++) box(b, ox - w / 2 + 0.08, 1.75 + (wp % 2 ? -0.3 : 0.25), oz - 0.8 + (wp >> 1) * 1.0 + (wp % 2) * 0.5, 0.03, 0.45, 0.35, 0xf0ece0);
    // benches for the waiting, a flag in the corner
    [-1, 1].forEach(function (sd) {
      box(b, ox + sd * (w / 2 - 0.6), 0.4, oz - 1.0, 0.6, 0.12, 3.2, 0x3a3a42);
      solid(ox + sd * (w / 2 - 0.6), oz - 1.0, 0.6, 3.2, 0.5);
    });
    box(b, ox + w / 2 - 0.8, 1.3, back - 0.8, 0.06, 2.6, 0.06, 0xc0c0c8);
    box(b, ox + w / 2 - 0.8, 2.25, back - 1.25, 0.04, 0.6, 0.9, 0x4da3ff);
  }

  // the counter at the bar is a shop like any other (shops.js, kind 'bar')
  var BAR = { id: 'bar0', kind: 'bar', name: 'THE GULL BAR', tag: 'Drinks that put you back together', color: 0xff8fc8, at: { x: 0, z: 0 } };
  // and so is the wardrobe at home (kind 'wardrobe')
  var WARDROBE = { id: 'wardrobe0', kind: 'wardrobe', name: 'YOUR WARDROBE', tag: 'Everything you own, on hangers', color: 0xff8fd0, at: { x: 0, z: 0 } };

  function build() {
    if (built) return;
    built = true;
    var b = new GeoBatch();
    // a room for every business in the world, from its trade's template
    var shops = GAME.shops && GAME.shops.locations ? GAME.shops.locations() : [];
    shops.forEach(function (loc) {
      var tpl = SHOP_ROOMS[loc.kind];
      if (!tpl || byId[loc.id]) return;
      var room = { id: loc.id, name: loc.name, kind: 'shop', shop: loc.kind };
      for (var k in tpl) room[k] = tpl[k];
      ROOMS.push(room);
      byId[loc.id] = room;
    });
    for (var i = 0; i < ROOMS.length; i++) {
      byId[ROOMS[i].id] = ROOMS[i];
      buildRoom(b, ROOMS[i], i);
    }
    var mesh = new THREE.Mesh(b.build(), sharedVertexBasic());
    mesh.matrixAutoUpdate = false;
    GAME.scene.add(mesh);
    buildLift();
  }

  // ---------- the tower lift ----------
  // The downtown helipad was out of the sky or nothing: a helicopter on a roof
  // seventy metres up with no way to it on foot. A ring at the lobby doors and
  // one by the lift house on the roof now; step on either and you ride to the
  // other (city.js builds the doors). It runs whatever is going on — a lift
  // to a helicopter is a fine way to leave a chase.
  var lift = null, LIFT_ON = 1.0, LIFT_REARM = 1.7, LIFT_HINT = 8;
  function buildLift() {
    var L = GAME.city.towerLift;
    if (!L) return;
    lift = [];
    [['street', 'roof', 'ELEVATOR — step on to ride up to the helipad'],
      ['roof', 'street', 'ELEVATOR — step on to go down to the street']].forEach(function (s) {
      var at = L[s[0]];
      var m = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.0, 32), new THREE.MeshBasicMaterial({
        color: 0x8fb4ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(at.x, at.y + 0.09, at.z);
      GAME.scene.add(m);
      lift.push({ id: s[0], at: at, to: L[s[1]], toId: s[1], mesh: m, label: s[2], armed: true });
    });
  }
  function stepLift() {
    var P = GAME.player;
    if (!lift) return;
    for (var i = 0; i < lift.length; i++) lift[i].mesh.material.opacity = 0.5 + 0.25 * Math.sin(GAME.time * 3 + i);
    if (P.state !== 'alive' || P.inCar || P.swimming || P.parachuting || P.mantle) return;
    var hint = '';
    for (var k = 0; k < lift.length; k++) {
      var s = lift[k];
      var d2 = Math.abs(P.pos.y - s.at.y) < 2.5 ? U.dist2(P.pos.x, P.pos.z, s.at.x, s.at.z) : 1e9;
      if (d2 > LIFT_REARM * LIFT_REARM) s.armed = true;
      if (d2 < LIFT_HINT * LIFT_HINT) hint = s.label;
      if (s.armed && d2 < LIFT_ON * LIFT_ON && !P.airborne && !GAME.shopOpen) { ride(s); return; }
    }
    if (hint) GAME.hud.setPoiHint(hint);
  }
  function ride(s) {
    var P = GAME.player, to = s.to, up = s.toId === 'roof';
    s.armed = false;
    GAME.audio.pagerBeep();
    fadeThen(function () {
      if (P.state !== 'alive' || P.inCar) return;
      var y = up ? to.y : GAME.city.groundY(to.out.x, to.out.z);
      P.pos.set(to.out.x, y, to.out.z);
      P.heading = to.heading; P.velY = 0; P.airborne = false; P.moveSpeed = 0; P.mantle = null; P.roofCar = null;
      GAME.cam.yaw = P.heading; GAME.cam.x = 0;
      for (var i = 0; i < lift.length; i++) lift[i].armed = false;
      GAME.hud.message(up ? 'HELIPAD — seventy metres up. Mind the edge.' : 'Street level.', 2.5);
      GAME.track('lift-' + s.toId);
    });
  }

  // ---------- going in and out ----------
  function enterable(loc) {
    if (!loc || !byId[loc.id]) return false;
    if (loc.kind === 'casino' || byId[loc.id].kind === 'shop') return true;
    return loc.kind === 'safehouse' && !!(GAME.shops && GAME.shops.owns(loc.sh.id));
  }
  // true when the mat has been dealt with here — gone in, or turned away
  function enter(loc) {
    var room = byId[loc.id], P = GAME.player;
    if (!room || cur || pending) return false;
    // (a shop can be popped into mid-job, the way its doormat always could)
    if (GAME.missions && GAME.missions.active && room.kind !== 'shop') {
      GAME.hud.message('Not now — you are on a job.', 2.2);
      return true;
    }
    if (room.kind === 'casino' && GAME.police.wanted > 0) {
      GAME.hud.message('The doorman takes one look at you — not with the law on your tail.', 3);
      return true;
    }
    var heading = P.heading;
    fadeThen(function () {
      cur = { room: room, loc: loc, door: { x: loc.at.x, y: GAME.city.groundY(loc.at.x, loc.at.z), z: loc.at.z }, heading: heading };
      P.interior = room;
      if (GAME.stopSwim) GAME.stopSwim();
      P.pos.set(room.entry.x, 0, room.entry.z);
      P.heading = 0; P.velY = 0; P.airborne = false; P.moveSpeed = 0; P.mantle = null; P.roofCar = null;
      GAME.cam.yaw = 0; GAME.cam.pitch = 0.2; GAME.cam.x = 0;
      for (var i = 0; i < room.rings.length; i++) room.rings[i].armed = false;
      GAME.hud.message(room.name + (room.kind === 'home'
        ? (GAME.police.wanted > 0 ? ' — nobody can see you in here. The bed is at the back.' : ' — the bed is at the back, your wardrobe on the left. The mat by the door takes you out.')
        : room.kind === 'shop' ? room.hello + (GAME.police.wanted > 0 && room.shop !== 'bribe' ? ' The law is waiting outside.' : '')
          : ' — the wheel is at the back, the bar on the left. The mat by the door takes you out.'), 4);
      if (room.music && GAME.audio.radio && !GAME.audio.muted) GAME.audio.radio.setVolume(0.45);
      GAME.applyTimeOfDay(GAME.timeOfDay);   // the room's own light (main.js)
      GAME.track('interior-' + room.id);
      if (room.kind === 'casino' && GAME.lola) GAME.lola.first('casino');
    });
    return true;
  }
  function exitRoom() {
    if (!cur) return;
    var P = GAME.player, c = cur;
    fadeThen(function () { leave(c); });
  }
  function leave(c) {
    var P = GAME.player;
    cur = null;
    P.interior = null;
    P.pos.set(c.door.x, GAME.city.groundY(c.door.x, c.door.z), c.door.z);
    P.heading = c.heading + Math.PI;
    P.velY = 0; P.airborne = false; P.moveSpeed = 0;
    GAME.cam.yaw = P.heading; GAME.cam.x = 0;
    if (c.room.music && GAME.audio.radio) GAME.audio.radio.setVolume(0);
    GAME.applyTimeOfDay(GAME.timeOfDay);
    GAME.hud.setPoiHint('');
  }
  // out without ceremony: a respawn, a teleport, a reload
  function reset() {
    pending = null;
    if (!cur) return;
    var c = cur;
    cur = null;
    GAME.player.interior = null;
    if (c.room.music && GAME.audio.radio) GAME.audio.radio.setVolume(0);
    GAME.applyTimeOfDay(GAME.timeOfDay);
    GAME.hud.fadeSet(0);
  }
  // the fade runs on game time, so a pause holds it
  function fadeThen(fn) {
    pending = { t: FADE, fn: fn, half: false };
    GAME.hud.fadeSet(1);
  }

  // ---------- inside ----------
  function update(dt) {
    var P = GAME.player;
    if (pending) {
      pending.t -= dt;
      if (pending.t <= 0) {
        var fn = pending.fn;
        pending = null;
        fn();
        GAME.hud.fadeSet(0);
      }
      return;
    }
    if (!cur) { stepLift(); return; }
    if (P.state !== 'alive') return;
    var room = cur.room, hint = '', hd = 1e9;
    for (var i = 0; i < room.rings.length; i++) {
      var r = room.rings[i];
      r.mesh.material.opacity = 0.5 + 0.25 * Math.sin(GAME.time * 3 + i);
      var d2 = U.dist2(P.pos.x, P.pos.z, r.x, r.z);
      if (d2 > 1.7 * 1.7) r.armed = true;
      if (d2 < 16 && d2 < hd) { hd = d2; hint = r.label; }
      if (r.armed && d2 < 1.0 && !GAME.shopOpen) { r.armed = false; r.act(); return; }
    }
    GAME.hud.setPoiHint(hint);
    var t = GAME.time;
    for (var a = 0; a < room.anim.length; a++) {
      var an = room.anim[a];
      if (an.wheel) an.wheel.rotation.z += dt * 0.35;
      else if (an.pole) an.pole.rotation.y += dt * 1.6;
      else if (an.turntable) an.turntable.rotation.y += dt * an.rate;
      else if (an.tv) an.tv.material.color.setHSL((t * 0.05) % 1, 0.45, 0.45 + 0.08 * Math.sin(t * 9) * Math.sin(t * 2.3));
      else if (an.blink) an.blink.visible = Math.sin(t * 4 + an.phase) > -0.3;
      else if (an.fig) {
        var j = an.fig.userData.joints, s = Math.sin(t * 1.6 + an.sway * 7);
        if (an.fan && GAME.derby && GAME.derby.cheering) {
          // come on, number four!
          var c = Math.sin(t * 9 + an.sway * 5);
          j.armL.rotation.x = -2.5 + c * 0.35; j.armR.rotation.x = -2.6 - c * 0.35;
          an.fig.position.y = Math.max(0, c) * 0.06;
          continue;
        }
        an.fig.position.y = 0;
        j.armL.rotation.x = s * 0.12; j.armR.rotation.x = -s * 0.1 - 0.2;
        j.torso.rotation.y = s * 0.05;
      }
    }
  }

  // what the camera may not rise past, in here
  function ceiling() { return cur ? cur.room.h - 0.3 : null; }

  return {
    build: build, update: update, enter: enter, enterable: enterable, reset: reset, ceiling: ceiling,
    get current() { return cur ? cur.room : null; },
    get door() { return cur ? cur.door : null; },
    get busy() { return !!pending; },
    leave: exitRoom,
    // headless: the two lift stops
    lift: function () { return lift; },
    rooms: function () { return ROOMS; },
    bar: BAR
  };
})();
