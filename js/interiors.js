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
    if (room.kind === 'home') furnishHome(b, room); else furnishCasino(b, room);
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
    // pictures
    box(b, ox - w / 2 + 0.03, 1.7, oz - 0.5, 0.04, 0.8, 1.2, room.accent);
    box(b, ox - w / 2 + 0.05, 1.7, oz - 0.5, 0.04, 0.6, 1.0, 0xf4e0c0);
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
    // slot machines down the right wall, blinking
    for (var sm = 0; sm < 6; sm++) {
      var sx = ox + w / 2 - 0.6, sz = oz - d / 2 + 3 + sm * 2.0;
      box(b, sx, 0.8, sz, 0.8, 1.6, 1.0, 0x30205a);
      box(b, sx - 0.42, 1.55, sz, 0.06, 0.5, 0.8, 0x101018);
      solid(sx, sz, 0.8, 1.0, 1.6);
      var lamp = glow(sx - 0.1, 1.75 + 0.2, sz, 0.3, 0.12, 0.8, sm % 2 ? 0x2de8ff : 0xff2d95);
      room.anim.push({ blink: lamp, phase: sm * 0.7 });
      if (sm % 2 === 0) room.anim.push({ fig: figure(sx - 1.2, sz, -Math.PI / 2), sway: 0.3 + sm * 0.1 });
    }
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

  // the counter at the bar is a shop like any other (shops.js, kind 'bar')
  var BAR = { id: 'bar0', kind: 'bar', name: 'THE GULL BAR', tag: 'Drinks that put you back together', color: 0xff8fc8, at: { x: 0, z: 0 } };

  function build() {
    if (built) return;
    built = true;
    var b = new GeoBatch();
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
    if (loc.kind === 'casino') return true;
    return loc.kind === 'safehouse' && !!(GAME.shops && GAME.shops.owns(loc.sh.id));
  }
  // true when the mat has been dealt with here — gone in, or turned away
  function enter(loc) {
    var room = byId[loc.id], P = GAME.player;
    if (!room || cur || pending) return false;
    if (GAME.missions && GAME.missions.active) {
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
        ? (GAME.police.wanted > 0 ? ' — nobody can see you in here. The bed is at the back.' : ' — the bed is at the back. The mat by the door takes you out.')
        : ' — the wheel is at the back, the bar on the left. The mat by the door takes you out.'), 4);
      if (room.music && GAME.audio.radio && !GAME.audio.muted) GAME.audio.radio.setVolume(0.45);
      GAME.applyTimeOfDay(GAME.timeOfDay);   // the room's own light (main.js)
      GAME.track('interior-' + room.id);
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
      else if (an.tv) an.tv.material.color.setHSL((t * 0.05) % 1, 0.45, 0.45 + 0.08 * Math.sin(t * 9) * Math.sin(t * 2.3));
      else if (an.blink) an.blink.visible = Math.sin(t * 4 + an.phase) > -0.3;
      else if (an.fig) {
        var j = an.fig.userData.joints, s = Math.sin(t * 1.6 + an.sway * 7);
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
