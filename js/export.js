// Import/export: a crane on the harbour with a board of
// wanted cars beside it. Bring one that is on a list into the ring, in one
// piece, and it goes up on the hook and out on the next boat: paid for what
// it is and the state it is in, ticked off the board, and not wanted again.
// Fill a list and the buyer pays a bonus on top.
GAME.exporter = (function () {
  var LISTS = [
    { name: 'LIST ONE', bonus: 4000, cars: ['sedan', 'taxi', 'van', 'sports', 'motorcycle', 'police'] },
    { name: 'LIST TWO', bonus: 8000, cars: ['ambulance', 'pickup', 'limo', 'buggy', 'icecream', 'superbike'] }
  ];
  var PAY = { sedan: 600, taxi: 700, van: 800, sports: 1500, motorcycle: 900, police: 1800,
    ambulance: 1400, pickup: 1100, limo: 2200, buggy: 1000, icecream: 1600, superbike: 3000 };
  var RING_R = 6, MIN_HP = 0.4;
  var site = null, ring = null, board = null, boardTex = null, boardCv = null, enabled = true, hint = '';

  function prefs() { GAME.prefs = GAME.prefs || {}; return GAME.prefs.exported || (GAME.prefs.exported = {}); }
  function wanted(type) {
    if (prefs()[type]) return false;
    for (var i = 0; i < LISTS.length; i++) if (LISTS[i].cars.indexOf(type) >= 0) return true;
    return false;
  }
  function listOf(type) { for (var i = 0; i < LISTS.length; i++) if (LISTS[i].cars.indexOf(type) >= 0) return LISTS[i]; return null; }
  function done(list) { return list.cars.every(function (t) { return !!prefs()[t]; }); }
  function label(type) { var s = GAME.vehicles.TYPES[type]; return s ? s.label.toUpperCase() : type.toUpperCase(); }

  // ---------- the place: a crane on the quay, a board, a ring ----------
  function build() {
    if (site || !GAME.city || !GAME.city.hash) return;
    var C = GAME.city, rp = C.nearestRoadPoint(-330, 292);
    var h = rp.axis === 'net' ? rp.heading : rp.axis === 'z' ? 0 : Math.PI / 2;
    var sx = Math.cos(h), sz = -Math.sin(h);
    site = { x: rp.x, z: rp.z, y: C.groundY(rp.x, rp.z), side: { x: sx, z: sz } };
    // the ring, in the road: driven into
    ring = new THREE.Mesh(new THREE.CylinderGeometry(RING_R, RING_R, 0.2, 28, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffb35a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    ring.position.set(site.x, site.y + 0.3, site.z);
    GAME.scene.add(ring);
    // the crane and the board on the kerb beside it
    var kx = site.x + sx * 9.4 - sz * 6, kz = site.z + sz * 9.4 + sx * 6, ky = C.groundY(kx, kz);
    // (where the hook hangs: a car that ships goes up to it)
    site.hook = { x: kx - sx * 11, y: ky + 7.2, z: kz - sz * 11 };
    var g = new THREE.Group();
    function piece(x, y, z, w, hh, d, col) {
      var m = new THREE.Mesh(sharedBoxGeo(w, hh, d), sharedLambert(col));
      m.position.set(x, y, z); g.add(m); return m;
    }
    piece(kx, ky + 9, kz, 1.4, 18, 1.4, 0xd8a83a);                                 // the mast
    // the arm slews, its hook runs in and out along it and drops on a cable
    // (crane() poses them): the export is a lift, out over the road to the
    // car and round to the container on the quay
    var arm = piece(0, 0, 0, 1, 1, 14, 0xd8a83a);
    var cable = piece(0, 0, 0, 0.1, 1, 0.1, 0x2a2a2a);
    var hook = piece(0, 0, 0, 1.2, 0.6, 1.2, 0x3a3a3a);
    piece(kx, ky + 1, kz, 3, 2, 3, 0x6a6a72);                                      // its footing
    C.addSolid(kx, kz, 3, 3, ky + 18);
    site.mast = { x: kx, y: ky, z: kz };
    site.crane = { arm: arm, cable: cable, hook: hook, home: Math.atan2(-sx, -sz) };
    site.pose = { a: site.crane.home, r: 11, y: ky + 8 };
    crane(site.pose.a, site.pose.r, site.pose.y);
    // the container it goes into: an open box on the quay, the far side of
    // the mast, its long side along the kerb
    var cx = kx + sx * 11, cz = kz + sz * 11, cy = C.groundY(cx, cz), along = Math.abs(sx) > 0.5;
    var CW = 3, CL = 8.6, CH = 2.8;
    site.box = { x: cx, z: cz, y: cy, h: Math.atan2(along ? 0 : 1, along ? 1 : 0) };
    function wall(dx, dz, w, d) { piece(cx + dx, cy + CH / 2, cz + dz, w, CH, d, 0xb8502a); }
    var lw = along ? CW : CL, ld = along ? CL : CW;
    piece(cx, cy + 0.15, cz, lw, 0.3, ld, 0x7a3a22);                              // its floor
    if (along) {
      wall(-CW / 2, 0, 0.15, CL); wall(CW / 2, 0, 0.15, CL); wall(0, -CL / 2, CW, 0.15); wall(0, CL / 2, CW, 0.15);
    } else {
      wall(0, -CW / 2, CL, 0.15); wall(0, CW / 2, CL, 0.15); wall(-CL / 2, 0, 0.15, CW); wall(CL / 2, 0, 0.15, CW);
    }
    C.addSolid(cx, cz, lw, ld, cy + CH, 'prop');
    // the board: a canvas, redrawn when a car goes out
    boardCv = document.createElement('canvas');
    boardCv.width = 256; boardCv.height = 256;
    boardTex = new THREE.CanvasTexture(boardCv);
    board = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ map: boardTex }));
    var bx = site.x + sx * 8.8 + sz * 5, bz = site.z + sz * 8.8 - sx * 5;
    board.position.set(bx, C.groundY(bx, bz) + 2.6, bz);
    board.rotation.y = Math.atan2(-sx, -sz);
    g.add(board);
    piece(bx, C.groundY(bx, bz) + 0.4, bz, 0.25, 0.8, 0.25, 0x3a3a3a);
    GAME.scene.add(g);
    paint();
  }
  // the arm at heading a, the hook r out along it and hanging at height y
  function crane(a, r, y) {
    var K = site.crane, m = site.mast, dx = Math.sin(a), dz = Math.cos(a), top = m.y + 18.4;
    K.arm.position.set(m.x + dx * 6, top, m.z + dz * 6);
    K.arm.rotation.y = a;
    var hx = m.x + dx * r, hz = m.z + dz * r, len = Math.max(0.2, top - 0.5 - (y + 0.3));
    K.cable.position.set(hx, y + 0.3 + len / 2, hz);
    K.cable.scale.y = len;
    K.hook.position.set(hx, y, hz);
    site.pose.a = a; site.pose.r = r; site.pose.y = y;
    site.hook = { x: hx, y: y, z: hz };
  }
  function paint() {
    if (!boardCv) return;
    var c = boardCv.getContext('2d');
    c.fillStyle = '#10141c'; c.fillRect(0, 0, 256, 256);
    c.strokeStyle = '#ffb35a'; c.lineWidth = 4; c.strokeRect(2, 2, 252, 252);
    c.fillStyle = '#ffb35a'; c.font = '900 20px "Segoe UI", Arial, sans-serif'; c.textAlign = 'center';
    c.fillText('EXPORT — WANTED', 128, 26);
    c.textAlign = 'left'; c.font = '700 13px "Segoe UI", Arial, sans-serif';
    var y = 48;
    LISTS.forEach(function (L) {
      c.fillStyle = done(L) ? '#7dff6a' : '#9fd8ff';
      c.fillText(L.name + (done(L) ? ' — DONE' : ''), 12, y); y += 16;
      L.cars.forEach(function (t) {
        var got = !!prefs()[t];
        c.fillStyle = got ? '#5a6a5a' : '#f4ecff';
        c.fillText((got ? '✓ ' : '· ') + label(t), 20, y); y += 15;
      });
      y += 6;
    });
    if (boardTex) boardTex.needsUpdate = true;
  }

  // ---------- each tick ----------
  function update(dt) {
    if (!enabled || !GAME.started) return;
    if (!site) build();
    if (!site) return;
    // a car being loaded: you have stepped out by the door, and in a beat
    // the crane takes it (the scene); a crane that has loaded one runs its
    // hook back home over the road
    if (shipping) { stepShipping(dt); return; }
    var p0 = site.pose, home = site.crane.home, dy = site.mast.y + 8 - p0.y;
    if (Math.abs(U.wrapPI(home - p0.a)) > 0.01 || Math.abs(p0.r - 11) > 0.05 || Math.abs(dy) > 0.05) {
      crane(U.angleLerp(p0.a, home, Math.min(1, dt * 0.8)), p0.r + (11 - p0.r) * Math.min(1, dt), p0.y + dy * Math.min(1, dt * 1.2));
    }
    ring.material.opacity = 0.4 + 0.2 * Math.sin(GAME.time * 3);
    var P = GAME.player, f = GAME.focus();
    var d2 = U.dist2(f.x, f.z, site.x, site.z);
    ring.visible = d2 < 300 * 300 && !GAME.onJob();
    if (d2 > 40 * 40 || P.state !== 'alive') { hint = ''; return; }
    var car = P.inCar && P.car;
    if (!car) { hint = 'EXPORT — bring a car off the board into the ring'; return; }
    if (!wanted(car.type)) { hint = prefs()[car.type] ? 'EXPORT — already shipped one of those' : 'EXPORT — nobody wants a ' + label(car.type); return; }
    if (car.hp < car.spec.hp * MIN_HP) { hint = 'EXPORT — they want it in one piece. Fix it up first.'; return; }
    hint = 'EXPORT — ' + label(car.type) + ' wanted: drive into the ring and stop';
    if (d2 < RING_R * RING_R && Math.abs(car.speed) < 1.5 && !(GAME.missions && GAME.missions.active)) ship(car);
  }
  // Shipping a car. It used to be one frame: you were pulled out of the seat,
  // the car shot up to the hook, and the pay was a line among the messages —
  // easy to miss. Now you step out as anyone does, and the crane loads it in
  // a scene: the hook down onto the roof, up, the arm round, and down into
  // the container on the quay, with Nacho on the crane to say what it paid.
  // Then the money, and the result card.
  var shipping = null;
  function ship(car) {
    var type = car.type, L = listOf(type);
    var cond = car.hp / car.spec.hp;
    var pay = Math.round((PAY[type] || 500) * (0.5 + 0.5 * cond) / 10) * 10;
    prefs()[type] = true;
    var finished = !!(L && done(L));
    car.shipping = true; car.speed = 0; car.vx = car.vz = 0;
    GAME.exitCar();
    shipping = { car: car, type: type, pay: pay, cond: cond, list: L, bonus: finished ? L.bonus : 0, t: 0 };
    hint = '';
    paint();
    if (GAME.track) GAME.track('export-' + type);
    if (GAME.save) GAME.save();
  }
  function stepShipping(dt) {
    var S = shipping, car = S.car;
    if (S.scene) return;
    car.speed = 0; car.vx = car.vz = 0;
    S.t += dt;
    if (S.t < 0.9 && GAME.player.state === 'alive') return;   // a beat, stood beside it
    S.scene = true;
    var script = shipScript(S);
    if (!(GAME.scenes && script && GAME.scenes.play(script, function () { shipped(S, true); }))) {
      // (no scene to be had: up on the hook and over, as it always went)
      car.shipping = false;
      GAME.vehicles.stow(car, { x: site.box.x, y: site.box.y + 7, z: site.box.z }, 4.5);
      shipped(S, false);
    }
  }
  function lines(S) {
    var n = label(S.type), out = [
      ['docker', 'A ' + n + '! That one\'s on the board. Hook it up!'],
      ['docker', 'Up she goes... round... and into the box. Easy... easy...'],
      ['docker', 'In one piece' + (S.cond < 0.85 ? ', near enough' : '') + '. $' + S.pay.toLocaleString() + ' for that one.']
    ];
    if (S.bonus) out.push(['docker', 'And that\'s ' + S.list.name.toLowerCase() + ' done. The buyer adds a bonus: $' + S.bonus.toLocaleString() + '.']);
    else out.push(['you', 'There\'s more where that came from.']);
    return out;
  }
  function shipScript(S) {
    var car = S.car, m = site.mast, sx = site.side.x, sz = site.side.z;
    // the camera stands back across the road from the line of crane, car
    // and container, on whichever side has room
    // (well back and up: the arm is eighteen metres up, and the car goes from
    // the ring on one side of the mast to the container on the other)
    var px = -sz, pz = sx, C = GAME.city, cam = null;
    [-1, 1].forEach(function (k) {
      [36, 30, 24].forEach(function (d) {
        if (cam) return;
        var x = m.x + px * d * k, z = m.z + pz * d * k;
        if (!C.isInWater(x, z) && C.surfaceY(x, z) < C.groundY(x, z) + 0.5 &&
          (!C.hash || C.hash.segmentClear(x, z, m.x + px * 6 * k, m.z + pz * 6 * k))) cam = { x: x, z: z, k: k };
      });
    });
    if (!cam) cam = { x: m.x - px * 30, z: m.z - pz * 30, k: -1 };
    var camY = C.groundY(cam.x, cam.z) + 9;
    var tx = m.x - cam.x, tz = m.z - cam.z, tl = Math.hypot(tx, tz);
    tx /= tl; tz /= tl;
    // the two of them on the road where you got out, turned to the camera
    var ax = car.pos.x - tx * 5, az = car.pos.z - tz * 5;
    var box = car.mesh ? new THREE.Box3().setFromObject(car.mesh) : null;
    var roof = box ? box.max.y - car.pos.y : 1.7;
    var A = { a0: 0, r0: 0, set: false, x0: 0, y0: 0, z0: 0, h0: 0 };
    var B = site.box, top = m.y + 12.5;
    var aBox = Math.atan2(B.x - m.x, B.z - m.z), rBox = Math.hypot(B.x - m.x, B.z - m.z);
    function ease(k) { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); }
    function place(x, y, z, h, sway) {
      car.pos.set(x, y, z); car.heading = h;
      if (car.mesh) {
        car.mesh.position.set(x, y, z);
        car.mesh.rotation.set(0, h + sway, Math.sin(sway * 3) * 0.04);
      }
    }
    function act(dt, t) {
      if (!A.set) {
        // the cut hides the hook running out over the car (and the car, if it
        // stopped out of the arm's reach, being nudged under it)
        A.set = true;
        A.a0 = Math.atan2(car.pos.x - m.x, car.pos.z - m.z);
        A.r0 = Math.max(4, Math.min(13, Math.hypot(car.pos.x - m.x, car.pos.z - m.z)));
        A.x0 = m.x + Math.sin(A.a0) * A.r0; A.z0 = m.z + Math.cos(A.a0) * A.r0;
        A.y0 = C.groundY(A.x0, A.z0) + (car.spec.wheelH || 0); A.h0 = car.heading;
        A.hTurn = U.wrapPI(B.h - (A.h0 + U.wrapPI(aBox - A.a0)));
        if (Math.abs(A.hTurn) > Math.PI / 2) A.hTurn = U.wrapPI(A.hTurn + Math.PI);
        place(A.x0, A.y0, A.z0, A.h0, 0);
      }
      var down = ease(t / 1.6), up = ease((t - 2.2) / 2.8), round = ease((t - 5) / 2.6), low = ease((t - 7.6) / 2);
      if (t >= 2.0 && !A.clank) { A.clank = true; GAME.audio.pickup(); }
      var a = A.a0 + U.wrapPI(aBox - A.a0) * round, r = A.r0 + (rBox - A.r0) * round;
      var y = A.y0 + (top - A.y0) * up - (top - (B.y + 0.35)) * low;
      var hx = m.x + Math.sin(a) * r, hz = m.z + Math.cos(a) * r;
      var sway = Math.sin(t * 1.7) * 0.06 * up * (1 - low);
      if (t < 2.2) {
        crane(A.a0, A.r0, (m.y + 8) + (A.y0 + roof - (m.y + 8)) * down);
        place(A.x0, A.y0, A.z0, A.h0, 0);
      } else {
        place(hx, y, hz, A.h0 + U.wrapPI(aBox - A.a0) * round + A.hTurn * round, sway);
        crane(a, r, y + roof);
      }
      if (t >= 9.6 && !A.thud) { A.thud = true; GAME.audio.crash(0.25, hx, hz); }
      if (t > 9.6) crane(a, r, y + roof + (t - 9.6) * 3);
    }
    function view(t) {
      // (one steady frame: tilting up after the lift sent the two of them
      // down behind the subtitles)
      return { pos: { x: cam.x, y: camY, z: cam.z }, look: { x: m.x, y: m.y + 6.2, z: m.z }, fov: 52 };
    }
    var at = function () { return { x: ax, z: az, nx: -tx, nz: -tz }; };
    return { id: 'export', shots: [{ set: at, cast: ['docker', 'you'], lines: lines(S), act: act, view: view, minT: 10.6 }] };
  }
  // over: whatever the crane had still to do is done, the car is gone, and
  // the money is yours
  function shipped(S, scene) {
    shipping = null;
    var car = S.car;
    if (scene && !car.gone) GAME.vehicles.removeCar(car);
    GAME.addCash(S.pay + S.bonus);
    GAME.audio.sting('win');
    GAME.hud.message('EXPORTED: ' + label(S.type) + '  +$' + S.pay + (S.bonus ? '  ·  ' + S.list.name + ' COMPLETE  +$' + S.bonus : ''), 4.5);
    if (S.bonus && GAME.hud.pager) GAME.hud.pager('LOLA', 'Heard you filled a whole list down at the docks. The buyer wants to know who you are. I said nobody.', 7);
    var n = 0, all = 0;
    LISTS.forEach(function (L) { L.cars.forEach(function (t) { all++; if (prefs()[t]) n++; }); });
    var stats = [{ label: 'Paid', value: '$' + S.pay.toLocaleString() }, { label: 'Condition', value: Math.round(S.cond * 100) + '%' }];
    stats.push(S.bonus ? { label: 'List bonus', value: '$' + S.bonus.toLocaleString() } : { label: 'Board', value: n + ' / ' + all });
    if (GAME.share) GAME.share.show({
      slug: 'export-' + S.type,
      eyebrow: 'PUERTO VIEJO DOCKS · EXPORT',
      title: 'EXPORTED',
      subtitle: label(S.type) + ' — on the next boat out',
      accent: '#ffb35a',
      stats: stats
    });
    if (GAME.save) GAME.save();
  }

  return {
    update: update,
    get hint() { return hint; },
    get site() { return site; },
    wanted: wanted,
    LISTS: LISTS,
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; },
    blip: function () { return site ? { x: site.x, z: site.z, color: '#ffb35a' } : null; }
  };
})();
