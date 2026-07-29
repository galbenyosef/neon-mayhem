GAME.world = { cars: [], peds: [], pickups: [], markers: [] };

// pooled particle + tracer effects
GAME.fx = (function () {
  var MAXP = 360, MAXT = 32;
  var parts = [], tracers = [], flashes = [];
  var pGeo, pPts, tGeo, tLines, scene;

  function init(sc) {
    scene = sc;
    var pos = new Float32Array(MAXP * 3), col = new Float32Array(MAXP * 3);
    for (var i = 0; i < MAXP; i++) { pos[i * 3 + 1] = -1000; parts.push({ life: 0 }); }
    pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    pPts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.85, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    pPts.frustumCulled = false;
    scene.add(pPts);

    var tpos = new Float32Array(MAXT * 6);
    tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
    tLines = new THREE.LineSegments(tGeo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    tLines.frustumCulled = false;
    for (var t = 0; t < MAXT; t++) tracers.push({ life: 0 });
    scene.add(tLines);

    for (var f = 0; f < 4; f++) {
      var m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb050, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.visible = false;
      scene.add(m);
      flashes.push({ mesh: m, life: 0, max: 0 });
    }
  }

  var pCursor = 0, tCursor = 0;
  function spawn(x, y, z, o) {
    var n = o.count || 6;
    for (var i = 0; i < n; i++) {
      var p = parts[pCursor];
      pCursor = (pCursor + 1) % MAXP;
      p.life = p.maxLife = (o.life || 0.6) * (0.6 + Math.random() * 0.7);
      p.x = x; p.y = y; p.z = z;
      var sp = o.spread || 1;
      p.vx = (Math.random() - 0.5) * sp + (o.vx || 0);
      p.vy = Math.random() * sp * 0.8 + (o.vy || 1);
      p.vz = (Math.random() - 0.5) * sp + (o.vz || 0);
      p.grav = o.grav !== undefined ? o.grav : -2;
      p.color = o.color !== undefined ? o.color : 0xff8040;
      p.idx = pCursor;
    }
  }
  function tracer(x0, y0, z0, x1, y1, z1) {
    var t = tracers[tCursor];
    tCursor = (tCursor + 1) % MAXT;
    t.life = 0.07;
    var a = tGeo.attributes.position.array, i = t.i = tracers.indexOf(t) * 6;
    a[i] = x0; a[i + 1] = y0; a[i + 2] = z0; a[i + 3] = x1; a[i + 4] = y1; a[i + 5] = z1;
    tGeo.attributes.position.needsUpdate = true;
  }
  function flash(x, y, z, scale) {
    for (var i = 0; i < flashes.length; i++) {
      if (flashes[i].life <= 0) {
        var f = flashes[i];
        f.mesh.position.set(x, y, z);
        f.mesh.visible = true;
        f.life = f.max = 0.45;
        f.scale = scale || 5;
        return;
      }
    }
  }
  function update(dt) {
    if (!pGeo) return;
    var pa = pGeo.attributes.position.array, ca = pGeo.attributes.color.array;
    for (var i = 0; i < MAXP; i++) {
      var p = parts[i];
      if (p.life > 0) {
        p.life -= dt;
        p.vy += p.grav * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y < 0.1 && p.grav < 0) { p.y = 0.1; p.vy = 0; }
        pa[i * 3] = p.x; pa[i * 3 + 1] = p.life > 0 ? p.y : -1000; pa[i * 3 + 2] = p.z;
        var c = p.color, fade = Math.max(0, p.life / p.maxLife);
        ca[i * 3] = ((c >> 16 & 255) / 255) * fade;
        ca[i * 3 + 1] = ((c >> 8 & 255) / 255) * fade;
        ca[i * 3 + 2] = ((c & 255) / 255) * fade;
      } else if (pa[i * 3 + 1] > -999) pa[i * 3 + 1] = -1000;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
    var ta = tGeo.attributes.position.array;
    for (var t = 0; t < MAXT; t++) {
      var tr = tracers[t];
      if (tr.life > 0) {
        tr.life -= dt;
        if (tr.life <= 0) { ta[t * 6] = 0; ta[t * 6 + 1] = -1000; ta[t * 6 + 2] = 0; ta[t * 6 + 3] = 0; ta[t * 6 + 4] = -1000; ta[t * 6 + 5] = 0; tGeo.attributes.position.needsUpdate = true; }
      }
    }
    for (var f = 0; f < flashes.length; f++) {
      var fl = flashes[f];
      if (fl.life > 0) {
        fl.life -= dt;
        var k = 1 - fl.life / fl.max;
        fl.mesh.scale.setScalar(0.5 + k * fl.scale);
        fl.mesh.material.opacity = 0.9 * (1 - k);
        if (fl.life <= 0) fl.mesh.visible = false;
      }
    }
  }
  return { init: init, spawn: spawn, tracer: tracer, flash: flash, update: update };
})();

var VEHICLES = {
  sports: { label: 'Vulture GT', maxSpeed: 40, accel: 17, grip: 3.6, turn: 2.7, hp: 150, l: 4.3, w: 1.95, cabinH: 0.5, bodyH: 0.5, colors: [0xff2f7a, 0x38e8ff, 0xffe14f, 0xffffff, 0xb040ff] },
  sedan: { label: 'Cadenza', maxSpeed: 29, accel: 10, grip: 5.2, turn: 2.1, hp: 175, l: 4.5, w: 1.9, cabinH: 0.62, bodyH: 0.55, colors: [0x9fb4c8, 0xc0a0d8, 0x88c8a8, 0xd8d0c0, 0x8090b0] },
  taxi: { label: 'Taxi', maxSpeed: 30, accel: 10.5, grip: 5.2, turn: 2.2, hp: 175, l: 4.5, w: 1.9, cabinH: 0.62, bodyH: 0.55, colors: [0xf0c020] },
  van: { label: 'Cargo Van', maxSpeed: 23, accel: 7, grip: 6, turn: 1.7, hp: 260, l: 5.1, w: 2.1, cabinH: 1.0, bodyH: 0.9, colors: [0x9a8a78, 0x7888a0, 0xa87868] },
  police: { label: 'Cruiser', maxSpeed: 35, accel: 13.5, grip: 5.0, turn: 2.4, hp: 200, l: 4.6, w: 1.95, cabinH: 0.6, bodyH: 0.55, colors: [0xe8ecf2] },
  ambulance: { label: 'Ambulance', maxSpeed: 27, accel: 8.5, grip: 5.6, turn: 1.8, hp: 240, l: 5.3, w: 2.15, cabinH: 1.15, bodyH: 1.0, colors: [0xf2f2f6] },
  motorcycle: { label: 'Neon Streak', maxSpeed: 46, accel: 22, grip: 2.9, turn: 3.1, hp: 130, l: 2.2, w: 0.7, cabinH: 0.0, bodyH: 0.45, colors: [0xff2f7a, 0x38e8ff, 0x20242e, 0xffe14f], bike: true },
  helicopter: { label: 'Pelicano', maxSpeed: 34, accel: 12, grip: 4, turn: 2, hp: 130, l: 8.5, w: 2.4, cabinH: 1.4, bodyH: 1.5, colors: [0x2a2e3a, 0xf0f0f0, 0xff2f7a], heli: true },
  monster: { label: 'Sledgehammer', maxSpeed: 33, accel: 15, grip: 5.8, turn: 2.3, hp: 420, l: 5.2, w: 2.6, cabinH: 1.1, bodyH: 1.2, colors: [0x7a3ad8, 0x38e8ff, 0xff2f7a], monster: true },
  airplane: { label: 'Skywhistle', maxSpeed: 72, accel: 20, grip: 4, turn: 2, hp: 150, l: 11, w: 3, cabinH: 1.4, bodyH: 1.4, colors: [0xf0f0f4, 0xff2f7a, 0x38e8ff], plane: true, stall: 17, wheelH: 1.1 },
  // Isla Verde's own stock. The buggy is for the cove, the pickup for the
  // villa lanes, the limo for the resort — and the truck sells ice cream.
  buggy: { label: 'Dune Hopper', maxSpeed: 33, accel: 15, grip: 4.2, turn: 3.0, hp: 110, l: 3.4, w: 1.85, cabinH: 0.0, bodyH: 0.42, colors: [0xffb03a, 0x6ae8a0, 0xff6a8a, 0xf0f0f4], buggy: true },
  pickup: { label: 'Sierra 4x4', maxSpeed: 30, accel: 10, grip: 6.0, turn: 2.0, hp: 240, l: 5.0, w: 2.05, cabinH: 0.78, bodyH: 0.78, colors: [0x7a8a68, 0xa8683a, 0x486888, 0xd0c0a0], pickup: true },
  limo: { label: 'Vista Royale', maxSpeed: 31, accel: 8.5, grip: 5.4, turn: 1.5, hp: 210, l: 7.2, w: 2.0, cabinH: 0.62, bodyH: 0.55, colors: [0x14141a, 0xf0ece0] },
  icecream: { label: 'Sunny Scoops', maxSpeed: 21, accel: 6.2, grip: 5.8, turn: 1.7, hp: 200, l: 5.2, w: 2.2, cabinH: 0, bodyH: 0.55, colors: [0xfdf6ec], icecream: true }
};

function buildBikeMesh(colorHex) {
  var g = new THREE.Group();
  var b = new GeoBatch();
  b.addBox(0, 0.62, 0, 0.28, 0.34, 1.5, 0, colorHex, 0);       // fuel tank / frame
  b.addBox(0, 0.78, -0.55, 0.42, 0.14, 0.5, 0, 0x141824, 0);    // seat
  b.addBox(0, 0.98, 0.62, 0.5, 0.1, 0.1, 0, 0x101014, 0);       // handlebars
  b.addBox(0, 0.7, 0.7, 0.16, 0.24, 0.24, 0, 0x0c0c10, 0);      // front cowl
  var wheel = new GeoBatch();
  wheel.addBox(0, 0.34, 0.82, 0.16, 0.68, 0.68, 0, 0x0c0c10, 0);
  wheel.addBox(0, 0.34, -0.82, 0.16, 0.68, 0.68, 0, 0x0c0c10, 0);
  var body = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  g.add(body);
  g.add(new THREE.Mesh(wheel.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
  var hl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.06), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
  hl.position.set(0, 0.72, 0.83);
  g.add(hl);
  g.userData.bodyMesh = body;
  return g;
}

// a seated rider posed to straddle a bike, added as a child of the bike group
// so it moves and leans with it. Used for AI traffic bikes (and reusable).
function buildBikeRider() {
  var r = GAME.peds.buildPedMesh({});
  var j = r.userData.joints;
  j.torso.rotation.x = 0.34;                       // lean toward the bars
  j.legL.rotation.x = -0.55; j.legR.rotation.x = -0.55;
  j.legL.rotation.z = 0.2; j.legR.rotation.z = -0.2; // straddle the tank
  j.armL.rotation.x = -1.05; j.armR.rotation.x = -1.05; // reach the handlebars
  r.position.set(0, -0.02, -0.35);                 // hips on the seat
  return r;
}

function buildHeliMesh(colorHex) {
  var g = new THREE.Group();
  var b = new GeoBatch();
  b.addBox(0, 1.2, -0.6, 2.2, 1.7, 3.6, 0, colorHex, 0);        // cabin
  b.addBox(0, 1.5, 1.2, 1.7, 1.1, 1.4, 0, 0x141824, 0);         // canopy glass
  b.addBox(0, 1.4, -3.4, 0.5, 0.5, 3.6, 0, colorHex, 0);        // tail boom
  b.addBox(0, 1.9, -5.1, 0.16, 1.1, 0.7, 0, colorHex, 0);       // tail fin
  b.addBox(-0.9, 0.2, -0.4, 0.14, 0.14, 3.4, 0, 0x0c0c10, 0);   // left skid
  b.addBox(0.9, 0.2, -0.4, 0.14, 0.14, 3.4, 0, 0x0c0c10, 0);    // right skid
  b.addBox(-0.9, 0.6, 0.6, 0.1, 0.6, 0.1, 0, 0x0c0c10, 0);
  b.addBox(0.9, 0.6, 0.6, 0.1, 0.6, 0.1, 0, 0x0c0c10, 0);
  b.addBox(0, 2.05, -0.6, 0.24, 0.3, 0.24, 0, 0x0c0c10, 0);     // rotor mast
  var body = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  g.add(body);
  // spinning main rotor
  var rg = new GeoBatch();
  rg.addBox(0, 0, 0, 0.3, 0.06, 11, 0, 0x1a1a20, 0);
  rg.addBox(0, 0, 0, 11, 0.06, 0.3, 0, 0x1a1a20, 0);
  var rotor = new THREE.Mesh(rg.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  rotor.position.set(0, 2.3, -0.6);
  g.add(rotor);
  var tg = new GeoBatch();
  tg.addBox(0, 0, 0, 0.14, 0.05, 2.2, 0, 0x1a1a20, 0);
  var tail = new THREE.Mesh(tg.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  tail.position.set(0.2, 1.9, -5.1);
  g.add(tail);
  var hl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.06), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
  hl.position.set(0, 1.2, 2.0);
  g.add(hl);
  g.userData.bodyMesh = body;
  g.userData.rotor = rotor;
  g.userData.tailRotor = tail;
  return g;
}

function buildPlaneMesh(colors) {
  var body = colors[0], accent = colors[1] || 0xff2f7a;
  var g = new THREE.Group();
  g.rotation.order = 'YXZ';
  var b = new GeoBatch();
  b.addBox(0, 1.2, 0, 1.5, 1.5, 9, 0, body, 0);            // fuselage
  b.addBox(0, 1.5, 3.0, 1.1, 0.9, 2.2, 0, 0x141824, 0);    // cockpit glass
  b.addBox(0, 1.35, -0.4, 12, 0.28, 2.2, 0, body, 0);      // main wing
  b.addBox(0, 1.35, -0.4, 12, 0.3, 0.3, 0, accent, 0);     // wing stripe
  b.addBox(0, 1.4, -4.4, 4.4, 0.22, 1.2, 0, body, 0);      // tailplane
  b.addBox(0, 2.1, -4.4, 0.22, 1.6, 1.2, 0, accent, 0);    // vertical fin
  b.addBox(-0.55, 0.35, 1.0, 0.14, 0.7, 0.14, 0, 0x0c0c10, 0);
  b.addBox(0.55, 0.35, 1.0, 0.14, 0.7, 0.14, 0, 0x0c0c10, 0);
  b.addBox(0, 0.4, -3.5, 0.12, 0.5, 0.12, 0, 0x0c0c10, 0);
  var mesh = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  g.add(mesh);
  // nose light + spinning prop
  var pg = new GeoBatch();
  pg.addBox(0, 0, 0, 0.24, 3.4, 0.14, 0, 0x1a1a20, 0);
  pg.addBox(0, 0, 0, 3.4, 0.24, 0.14, 0, 0x1a1a20, 0);
  var prop = new THREE.Mesh(pg.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  prop.position.set(0, 1.2, 4.7);
  g.add(prop);
  var hl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.06), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
  hl.position.set(0, 1.2, 4.8);
  g.add(hl);
  g.userData.bodyMesh = mesh;
  g.userData.prop = prop;
  return g;
}

function buildMonsterMesh(colorHex) {
  var g = new THREE.Group();
  var b = new GeoBatch();
  b.addBox(0, 1.85, 0, 2.3, 0.9, 4.6, 0, colorHex, 0);          // chassis
  b.addBox(0, 2.65, -0.3, 1.9, 0.85, 2.2, 0, 0x141824, 0);      // cab
  b.addBox(0, 1.25, 0, 0.5, 0.35, 4.0, 0, 0x22262e, 0);         // spine
  b.addBox(0, 1.85, 2.35, 2.2, 0.5, 0.2, 0, 0x22262e, 0);       // bar
  var wh = new GeoBatch();
  // the tyre tops used to land on exactly the chassis top (both y=2.30) and the
  // two coplanar faces fought for depth wherever they overlapped — tucked under
  // it now, still sitting on the ground at y=0
  [[1.25, 1.5], [-1.25, 1.5], [1.25, -1.5], [-1.25, -1.5]].forEach(function (w) {
    wh.addBox(w[0], 1.06, w[1], 0.62, 2.12, 2.12, 0, 0x0c0c10, 0);
  });
  var body = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  g.add(body);
  g.add(new THREE.Mesh(wh.build(), new THREE.MeshLambertMaterial({ vertexColors: true })));
  var glow = new GeoBatch();
  glow.addBox(0.7, 2.1, 2.32, 0.4, 0.2, 0.06, 0, 0xfff2c0, 0);
  glow.addBox(-0.7, 2.1, 2.32, 0.4, 0.2, 0.06, 0, 0xfff2c0, 0);
  g.add(new THREE.Mesh(glow.build(), new THREE.MeshBasicMaterial({ vertexColors: true })));
  g.userData.bodyMesh = body;
  return g;
}

function buildCarMesh(type, colorHex) {
  var s = VEHICLES[type];
  if (s.monster) return buildMonsterMesh(colorHex);
  if (s.plane) return buildPlaneMesh(s.colors);
  if (s.heli) return buildHeliMesh(colorHex);
  if (s.bike) return buildBikeMesh(colorHex);
  var g = new THREE.Group();
  var b = new GeoBatch();
  var hl = s.l / 2, hw = s.w / 2;
  b.addBox(0, 0.42, 0, s.w, s.bodyH, s.l, 0, colorHex, 0);
  if (type === 'ambulance') {
    // tall box body + red cross panels
    b.addBox(0, 0.42 + s.bodyH / 2 + 0.5, -0.2, s.w, 1.0, s.l * 0.62, 0, colorHex, 0);
    b.addBox(hw + 0.01, 1.3, -0.2, 0.05, 0.5, 0.16, 0, 0xd83040, 0);
    b.addBox(hw + 0.01, 1.3, -0.2, 0.05, 0.16, 0.5, 0, 0xd83040, 0);
    b.addBox(-hw - 0.01, 1.3, -0.2, 0.05, 0.5, 0.16, 0, 0xd83040, 0);
    b.addBox(-hw - 0.01, 1.3, -0.2, 0.05, 0.16, 0.5, 0, 0xd83040, 0);
  }
  if (type === 'icecream') {
    // A tall, square, upright van: one slab of a body from the windscreen to
    // the back doors, a stripe round it, a serving hatch with an awning on the
    // kerb side, and a cone on the roof you can see three streets away.
    var boxTop = 2.55;
    b.addBox(0, 1.5, -0.25, s.w, 2.1, s.l * 0.78, 0, colorHex, 0);         // body
    b.addBox(0, 1.02, hl - 0.42, s.w * 0.98, 0.92, 0.9, 0, colorHex, 0);   // stubby bonnet
    b.addBox(0, 1.9, hl - 0.5, s.w * 0.84, 0.86, 0.14, 0, 0x141824, 0);    // windscreen
    b.addBox(hw - 0.02, 1.9, hl - 1.25, 0.1, 0.7, 1.0, 0, 0x141824, 0);    // cab windows
    b.addBox(-hw + 0.02, 1.9, hl - 1.25, 0.1, 0.7, 1.0, 0, 0x141824, 0);
    // the livery: a pink band and a blue pinstripe the length of the van
    b.addBox(0, 1.28, -0.25, s.w + 0.06, 0.34, s.l * 0.78, 0, 0xff7fb2, 0);
    b.addBox(0, 1.02, -0.25, s.w + 0.06, 0.1, s.l * 0.78, 0, 0x53c8ea, 0);
    // serving hatch, awning and counter on the kerb side
    b.addBox(hw + 0.03, 1.82, -0.5, 0.08, 0.9, 1.9, 0, 0x2a2230, 0);
    b.addBox(hw + 0.34, 2.36, -0.5, 0.72, 0.08, 2.1, 0, 0xff7fb2, 0);
    b.addBox(hw + 0.16, 1.3, -0.5, 0.34, 0.1, 2.0, 0, 0xf0e6d2, 0);
    // roof cone: a stack that reads as a cone under a swirl of soft serve
    b.addBox(0, boxTop + 0.05, -0.3, 0.5, 0.5, 0.5, 0.7, 0xe0a860, 0);
    b.addBox(0, boxTop + 0.42, -0.3, 0.66, 0.34, 0.66, 0.35, 0xffd7e4, 0);
    b.addBox(0, boxTop + 0.72, -0.3, 0.5, 0.3, 0.5, 0.9, 0xfff0f4, 0);
    b.addBox(0, boxTop + 0.94, -0.3, 0.28, 0.24, 0.28, 0, 0xffd7e4, 0);
    // a chime horn on the roof, because the chimes have to come from somewhere
    b.addBox(-0.62, boxTop + 0.2, 0.9, 0.3, 0.3, 0.44, 0, 0xd8c47a, 0);
  }
  if (type === 'pickup') {
    b.addBox(0, 0.42 + s.bodyH / 2 + 0.22, -1.05, s.w, 0.45, s.l * 0.44, 0, 0x2a2a34, 0);   // bed walls
  }
  var cabL = s.l * (type === 'van' ? 0.85 : type === 'icecream' ? 0.34 : type === 'limo' ? 0.72 : 0.5);
  var cabZ = type === 'sports' ? -0.35 : type === 'van' ? -0.1
    : type === 'icecream' ? s.l * 0.28 : type === 'pickup' ? 0.35 : -0.15;
  if (s.buggy) {
    // no cabin at all: a roll hoop over an open tub
    b.addBox(0, 1.05, -0.5, 0.12, 1.2, 0.12, 0, 0x2a2a34, 0);
    b.addBox(0, 1.05, 0.5, 0.12, 1.2, 0.12, 0, 0x2a2a34, 0);
    b.addBox(0, 1.6, 0, 0.12, 0.12, 1.1, 0, 0x2a2a34, 0);
  }
  if (s.cabinH > 0) {
    b.addBox(0, 0.42 + s.bodyH / 2 + s.cabinH / 2 - 0.05, cabZ, s.w * 0.82, s.cabinH, cabL, 0, type === 'police' ? 0x20242e : 0x141824, 0);
  }
  b.addBox(0, 0.28, hl * 0.72, s.w * 0.9, 0.32, 0.55, 0, 0x22262e, 0);
  b.addBox(0, 0.28, -hl * 0.72, s.w * 0.9, 0.32, 0.55, 0, 0x22262e, 0);
  var wy = 0.32, wx = hw - 0.12, wz = hl * 0.56;
  [[wx, wz], [-wx, wz], [wx, -wz], [-wx, -wz]].forEach(function (w) {
    b.addBox(w[0], wy, w[1], 0.32, 0.64, 0.72, 0, 0x0c0c10, 0);
  });
  if (type === 'police') {
    b.addBox(0, 0.42 + s.bodyH / 2, s.l * 0.28, s.w * 0.7, 0.1, 1.2, 0, 0x30405a, 0);
  }
  var body = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  g.add(body);

  var glow = new GeoBatch();
  glow.addBox(hw * 0.55, 0.5, hl + 0.02, 0.38, 0.16, 0.06, 0, 0xfff2c0, 0);
  glow.addBox(-hw * 0.55, 0.5, hl + 0.02, 0.38, 0.16, 0.06, 0, 0xfff2c0, 0);
  glow.addBox(hw * 0.55, 0.5, -hl - 0.02, 0.38, 0.14, 0.06, 0, 0xff3040, 0);
  glow.addBox(-hw * 0.55, 0.5, -hl - 0.02, 0.38, 0.14, 0.06, 0, 0xff3040, 0);
  if (type === 'taxi') glow.addBox(0, 1.35, -0.1, 0.7, 0.24, 0.34, 0, 0xffd040, 0);
  var glowMesh = new THREE.Mesh(glow.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
  g.add(glowMesh);

  if (type === 'police') {
    var barR = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.34), new THREE.MeshBasicMaterial({ color: 0xff2030 }));
    barR.position.set(0.28, 1.28, -0.5);
    var barB = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.34), new THREE.MeshBasicMaterial({ color: 0x2050ff }));
    barB.position.set(-0.28, 1.28, -0.5);
    g.add(barR); g.add(barB);
    g.userData.lightbar = [barR, barB];
  }
  g.userData.bodyMesh = body;
  return g;
}

GAME.vehicles = (function () {
  var world = GAME.world;
  var carRng = mulberry32(777);

  function spawnCar(type, x, z, heading, opts) {
    opts = opts || {};
    var spec = VEHICLES[type] || VEHICLES.sedan;
    var color = opts.color !== undefined ? opts.color : U.pick(carRng, spec.colors);
    var mesh = buildCarMesh(type, color);
    // Yaw first, then pitch and roll about the body's own axes. On the default
    // XYZ order the pitch is applied about the world X axis after the heading,
    // so a vehicle driving east or west got no pitch at all and sat flat while
    // the ramp climbed out from under its nose.
    if (!spec.heli && !spec.plane) mesh.rotation.order = 'YXZ';
    mesh.position.set(x, GAME.city.groundY(x, z), z);
    mesh.rotation.y = heading || 0;
    GAME.scene.add(mesh);
    var car = {
      kind: 'car',
      type: type, spec: spec, mesh: mesh,
      pos: mesh.position,
      heading: heading || 0,
      speed: 0, lat: 0,
      hp: spec.hp, stage: 0, dead: false, fireFuse: 0,
      occupied: opts.occupied || null,
      isPolice: type === 'police',
      controls: { throttle: 0, steer: 0, handbrake: false },
      ai: opts.ai || null,
      parkedSpot: opts.parkedSpot || null,
      mission: opts.mission || false,
      smokeT: 0, unstickT: 0, reverseT: 0,
      radius: spec.l * 0.42
    };
    // AI-ridden bikes get a visible rider (empty motorbikes look abandoned)
    if (spec.bike && car.occupied === 'ai') {
      var rider = buildBikeRider();
      mesh.add(rider);
      car.riderMesh = rider;
    }
    world.cars.push(car);
    return car;
  }

  function removeCar(car) {
    var i = world.cars.indexOf(car);
    if (i >= 0) world.cars.splice(i, 1);
    if (car.parkedSpot) car.parkedSpot.live = null;
    GAME.scene.remove(car.mesh);
    disposeTree(car.mesh);
  }

  function fwdX(car) { return Math.sin(car.heading); }
  function fwdZ(car) { return Math.cos(car.heading); }

  function surfaceGrip(car) {
    if (GAME.city.isOnSand(car.pos.x, car.pos.z)) return 0.45;
    return 1;
  }

  function stepPhysics(car, dt) {
    var c = car.controls, spec = car.spec;
    var surf = surfaceGrip(car);
    // booster strips slam the throttle open for a moment, so you leave the lip
    // far faster than you arrived. A bike is already the quickest thing on the
    // road and takes a smaller multiplier — giving it the same 3x a car gets
    // would fire it off the ramp at half again everything else.
    car.boostT = Math.max(0, (car.boostT || 0) - dt);
    car.hitCd = Math.max(0, (car.hitCd || 0) - dt);
    var boost = car.boostT > 0 ? (spec.bike ? 2 : 3) : 1;
    var maxSp = spec.maxSpeed * boost * (surf < 1 ? 0.55 : 1) * (car.spiked ? 0.55 : 1);
    var accel = spec.accel * boost * boost * (surf < 1 ? 0.6 : 1);
    if (car.stage >= 2) { maxSp *= 0.6; accel *= 0.5; }

    if (c.throttle > 0) car.speed += accel * c.throttle * dt;
    else if (c.throttle < 0) {
      car.speed += (car.speed > 1 ? accel * 1.6 : accel * 0.6) * c.throttle * dt;
    }
    car.speed = U.clamp(car.speed, -maxSp * 0.4, maxSp);
    car.speed *= Math.exp(-0.25 * dt);
    if (Math.abs(car.speed) < 0.06 && c.throttle === 0) car.speed = 0;

    var steerFactor = Math.min(1, Math.abs(car.speed) / 7) / (1 + Math.abs(car.speed) * 0.022);
    var dir = car.speed < -0.5 ? -1 : 1;
    car.heading += c.steer * spec.turn * steerFactor * dir * dt;

    var grip = spec.grip * surf * (c.handbrake ? 0.22 : 1) * (car.spiked ? 0.5 : 1);
    if (c.handbrake) car.speed *= Math.exp(-0.9 * dt);
    // lateral slip decays toward zero; handbrake keeps it alive for drifts
    var slip = c.steer * car.speed * 0.16 * (c.handbrake ? 2.4 : 1);
    car.lat = (car.lat + slip * dt * 8) * Math.exp(-grip * dt);

    var fx = fwdX(car), fz = fwdZ(car);
    var sx = fz, sz = -fx;
    var vx = fx * car.speed + sx * car.lat;
    var vz = fz * car.speed + sz * car.lat;
    car.vx = vx; car.vz = vz;
    car.pos.x += vx * dt;
    car.pos.z += vz * dt;

    // vertical: ride the ground (or a ramp deck / a roof you've landed on), and
    // go ballistic off a lip
    var gy = GAME.city.driveSurfaceY(car.pos.x, car.pos.z, car.pos.y);
    var ramp = GAME.city.rampAt(car.pos.x, car.pos.z);
    var wasAirborne = (car.air || 0) > 0.05;
    var stickTol = car.air ? 0.08 : 0.6;   // already flying? tight. On wheels? follow the road down.
    if (car.pos.y > gy + stickTol) {
      if (!car.air) { car.jumpX = car.pos.x; car.jumpZ = car.pos.z; car.jumpSpin = 0; car.jumpRamp = car.onRampIdx; }
      car.jumpSpin = (car.jumpSpin || 0) + U.wrapPI(car.heading - (car.lastHeading || car.heading));
      car.vy = (car.vy || 0) - 24 * dt;
      car.pos.y += car.vy * dt;
      car.air = (car.air || 0) + dt;
      if (car.pos.y <= gy) {
        var impact = -(car.vy || 0);
        car.pos.y = gy; car.vy = 0;
        landStunt(car, impact);
      }
    } else {
      car.pos.y = gy;
      // on a ramp the deck itself drives the climb rate; carry that off the lip
      car.vy = ramp ? Math.max(0, car.speed) * ramp.slope : 0;
      car.onRampIdx = ramp ? ramp.idx : null;
      if (ramp && ramp.boost) {
        if (!car.boostT && car === GAME.player.car && GAME.player.inCar) {
          GAME.audio.pickup();
          GAME.cameraShake = 0.35;
        }
        car.boostT = 1.4;
        car.speed = Math.max(car.speed, 12);   // a standing start still gets launched
      }
      if (car.air) landStunt(car, 0);
    }
    car.mesh.rotation.y = car.heading;
    // Pitch to the ground under the axles rather than to one point beneath the
    // middle. A centre-only slope reads flat until the middle crosses the lip
    // and then jumps to the full grade, and while the body eases into that the
    // nose is buried in the ramp — worst on the long vehicles. Sampling front
    // and rear means the body tips as it rides on, and once it is fully on the
    // ramp the chord is the ramp's own slope anyway.
    var wb = spec.l * 0.36;
    var fyF = GAME.city.driveSurfaceY(car.pos.x + fx * wb, car.pos.z + fz * wb, car.pos.y);
    var fyR = GAME.city.driveSurfaceY(car.pos.x - fx * wb, car.pos.z - fz * wb, car.pos.y);
    var chord = Math.atan2(fyF - fyR, wb * 2);
    // over the lip the front sample has already dropped past the ramp — hold
    // the nose up on the ramp's own grade until the wheels actually leave
    // negative pitches the nose up about the body's lateral axis
    var pitch = -(car.air > 0.05 ? U.clamp((car.vy || 0) * 0.035, -0.5, 0.5)
      : ramp ? Math.max(chord, Math.atan(ramp.slope)) : chord);
    // touching back down puts the wheels on the surface at once, so the body
    // takes the new grade immediately instead of easing out of its flight pose
    // and burying the nose in the ramp it just landed on
    var justLanded = wasAirborne && !((car.air || 0) > 0.05);
    car.mesh.rotation.x = justLanded ? pitch : U.lerp(car.mesh.rotation.x, pitch, Math.min(1, dt * 22));
    car.mesh.rotation.z = U.lerp(car.mesh.rotation.z, -car.lat * 0.02, dt * 6);
    car.lastHeading = car.heading;

    collideStatic(car, dt);
    if (GAME.city.isInWater(car.pos.x, car.pos.z)) sinkCar(car);
  }

  // a jump has ended: score it if the player pulled it off, and take the knock
  function landStunt(car, impact) {
    var airT = car.air || 0;
    car.air = 0;
    var isPlayer = car === GAME.player.car && GAME.player.inCar;
    if (isPlayer && airT > 0.45) {
      var dist = U.dist(car.pos.x, car.pos.z, car.jumpX || car.pos.x, car.jumpZ || car.pos.z);
      var spins = Math.floor(Math.abs(car.jumpSpin || 0) / (Math.PI * 2));
      var cash = Math.round(airT * 120 + dist * 6 + spins * 400);
      var label = spins > 0 ? (spins > 1 ? spins + 'x SPIN!' : '360 SPIN!')
        : airT > 1.6 ? 'INSANE JUMP!' : airT > 1.0 ? 'BIG AIR!' : 'NICE JUMP!';
      GAME.addCash(cash);
      GAME.audio.sting('win');
      GAME.hud.message(label + '   ' + airT.toFixed(1) + 's · ' + Math.round(dist) + 'm · +$' + cash, 3);
      GAME.missions.notifyChaos(60);
      // a jump launched off one of the city's ramps also logs it as found
      if (car.jumpRamp !== undefined && car.jumpRamp !== null) GAME.stunts.credit(car.jumpRamp, airT, dist);
    }
    car.jumpSpin = 0; car.jumpRamp = null;
    // hard landings still hurt
    if (impact > 16) {
      damageCar(car, Math.min(40, (impact - 16) * 2.2), 'wall');
      GAME.audio.crash(Math.min(1, impact / 30));
      if (isPlayer) GAME.cameraShake = Math.min(1, impact / 26);
      if (car.spec.bike && isPlayer && GAME.player.onBike && impact > 24) GAME.ejectBike(impact);
    }
  }

  function collideStatic(car, dt) {
    var fx = fwdX(car), fz = fwdZ(car);
    var sxv = fz, szv = -fx;
    var hl = car.spec.l / 2 - 0.2, hw = car.spec.w / 2;
    var corners = [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]];
    var boxes = GAME.city.hash.query(car.pos.x, car.pos.z, car.spec.l);
    if (!boxes.length) return;
    for (var ci = 0; ci < corners.length; ci++) {
      var lx = corners[ci][0], lw = corners[ci][1];
      var px = car.pos.x + fx * lx + sxv * lw;
      var pz = car.pos.z + fz * lx + szv * lw;
      for (var bi = 0; bi < boxes.length; bi++) {
        var b = boxes[bi];
        // jumped clear of it — don't clip a car that's sailing over a fence
        if (b.h !== undefined && b.h < car.pos.y - 0.3) continue;
        // and don't clip a car driving under one: a bridge parapet belongs to
        // the deck it stands on, not to the road it crosses over
        if (b.minY !== undefined && car.pos.y < b.minY - 1) continue;
        if (px > b.minX && px < b.maxX && pz > b.minZ && pz < b.maxZ) {
          // push out along the smallest penetration axis
          var dxl = px - b.minX, dxr = b.maxX - px, dzl = pz - b.minZ, dzr = b.maxZ - pz;
          var m = Math.min(dxl, dxr, dzl, dzr);
          var nx = 0, nz = 0;
          if (m === dxl) nx = -1; else if (m === dxr) nx = 1; else if (m === dzl) nz = -1; else nz = 1;
          car.pos.x += nx * m; car.pos.z += nz * m;
          var impact = Math.abs(car.vx * nx + car.vz * nz);
          var vn = car.vx * nx + car.vz * nz;
          if (vn < 0) {
            car.vx -= nx * vn * 1.4; car.vz -= nz * vn * 1.4;
            // decompose back into speed/lat
            car.speed = car.vx * fx + car.vz * fz;
            car.lat = car.vx * fz + car.vz * -fx;
          }
          // one event per contact: a car grinding along a wall reports a hit
          // every frame, which both shreds its health and machine-guns the
          // crash sound until it works free
          if (impact > 4 && (car.hitCd || 0) <= 0) {
            car.hitCd = 0.25;
            damageCar(car, Math.min(32, impact * 1.5), 'wall');
            GAME.audio.crash(impact / 18);
            GAME.fx.spawn(px, 0.7, pz, { count: 5, color: 0xffd890, spread: 3, life: 0.4, grav: -4 });
            if (car === GAME.player.car) GAME.cameraShake = Math.min(1, impact / 16);
            // riders get thrown off in a hard wall hit
            if (car.spec.bike && car === GAME.player.car && GAME.player.onBike && impact > 9) {
              GAME.ejectBike(impact);
            }
          }
          return;
        }
      }
    }
  }

  function collideCars(dt) {
    var cars = world.cars;
    for (var i = 0; i < cars.length; i++) {
      var a = cars[i];
      if (a.spec.heli || a.spec.plane) continue; // aircraft don't shove ground traffic
      for (var j = i + 1; j < cars.length; j++) {
        var b = cars[j];
        if (b.spec.heli || b.spec.plane) continue;
        // one of them is up on a roof and the other at street level — they
        // pass each other, they don't crash
        if (Math.abs(a.pos.y - b.pos.y) > 3) continue;
        var dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        var rr = a.radius + b.radius;
        var d2 = dx * dx + dz * dz;
        if (d2 > rr * rr || d2 < 0.0001) continue;
        var d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
        var overlap = rr - d;
        a.pos.x -= nx * overlap / 2; a.pos.z -= nz * overlap / 2;
        b.pos.x += nx * overlap / 2; b.pos.z += nz * overlap / 2;
        var avx = a.vx || 0, avz = a.vz || 0, bvx = b.vx || 0, bvz = b.vz || 0;
        var rel = (avx - bvx) * nx + (avz - bvz) * nz;
        if (rel > 3 && (a.hitCd || 0) <= 0 && (b.hitCd || 0) <= 0) {
          a.hitCd = 0.25; b.hitCd = 0.25;
          var dmg = Math.min(26, rel * 1.3);
          damageCar(a, dmg * 0.6, b); damageCar(b, dmg * 0.6, a);
          GAME.audio.crash(rel / 20);
          GAME.fx.spawn((a.pos.x + b.pos.x) / 2, 0.8, (a.pos.z + b.pos.z) / 2, { count: 6, color: 0xffe0a0, spread: 3, life: 0.35 });
          if (a === GAME.player.car || b === GAME.player.car) GAME.cameraShake = Math.min(1, rel / 18);
          var pc = GAME.player.car;
          if ((a === pc || b === pc) && rel > 6) {
            var other = a === pc ? b : a;
            if (other.isPolice) GAME.police.reportCrime('hit_cop_car', pc.pos);
            else if (other.ai && other.ai.mode === 'traffic') GAME.police.reportCrime('hit_car', pc.pos);
          }
        }
        // transfer momentum crudely
        var push = rel > 0 ? rel * 0.35 : 0;
        a.speed -= push * (nx * fwdX(a) + nz * fwdZ(a)) * 0.5;
        b.speed += push * (nx * fwdX(b) + nz * fwdZ(b)) * 0.5;
      }
    }
  }

  function damageCar(car, amt, source, byPlayer) {
    if (car.dead) return;
    var pc = GAME.player.car;
    // remember if the player is responsible, so a delayed burn-out still counts
    if (byPlayer || source === 'gun' || source === 'fist' ||
      (source === pc && pc && Math.abs(pc.speed) > 9)) car.byPlayer = true;
    car.hp -= amt;
    if (car.hp < car.spec.hp * 0.35 && car.stage < 1) car.stage = 1;
    if (car.hp < car.spec.hp * 0.14 && car.stage < 2) { car.stage = 2; car.fireFuse = 5.5; }
    if (car.hp <= 0) explodeCar(car, source, car.byPlayer);
  }

  function explodeCar(car, source, byPlayerIn) {
    if (car.dead) return;
    car.dead = true; car.stage = 3;
    // player-caused if this blast (or the damage that led to it) traces to the player
    var byPlayer = !!(byPlayerIn || car.byPlayer);
    GAME.audio.explosion();
    GAME.fx.flash(car.pos.x, 1.5, car.pos.z, 9);
    GAME.fx.spawn(car.pos.x, 1.2, car.pos.z, { count: 30, color: 0xff9030, spread: 7, vy: 5, life: 1.1, grav: -3 });
    GAME.fx.spawn(car.pos.x, 1.5, car.pos.z, { count: 20, color: 0x333333, spread: 4, vy: 4, life: 1.6, grav: -0.5 });
    var oldMat = car.mesh.userData.bodyMesh.material;
    car.mesh.userData.bodyMesh.material = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    if (oldMat && oldMat.dispose) oldMat.dispose();
    if (car.mesh.userData.lightbar) car.mesh.userData.lightbar.forEach(function (m) { m.visible = false; });
    car.speed *= 0.2;
    // area damage
    var p = GAME.player;
    if (!p.inCar || p.car !== car) {
      // altitude counts: a wreck going up underneath you shouldn't catch you
      // while you're hanging off a parachute or standing on a roof
      var dy = Math.abs(p.pos.y - car.pos.y);
      if (U.dist2(p.pos.x, p.pos.z, car.pos.x, car.pos.z) < 64 && dy < 7) GAME.playerDamage(55, 'explosion');
    }
    if (p.car === car) GAME.playerDamage(200, 'explosion');
    world.peds.forEach(function (ped) {
      if (!ped.dead && U.dist2(ped.pos.x, ped.pos.z, car.pos.x, car.pos.z) < 55) GAME.peds.kill(ped, 'explosion', byPlayer);
    });
    world.cars.forEach(function (c2) {
      if (c2 !== car && !c2.dead && U.dist2(c2.pos.x, c2.pos.z, car.pos.x, car.pos.z) < 60) damageCar(c2, 40, 'explosion', byPlayer);
    });
    if (car.isPolice && byPlayer) GAME.police.reportCrime('kill_cop', car.pos);
    if (car.occupied === 'ai') car.occupied = null;
    GAME.missions.notifyChaos(500);
  }

  function sinkCar(car) {
    if (car.sinking) return;
    car.sinking = true;
    GAME.audio.splash();
    GAME.fx.spawn(car.pos.x, 0.5, car.pos.z, { count: 14, color: 0x88bbdd, spread: 3, vy: 3, life: 0.8 });
    if (car === GAME.player.car) GAME.playerDrown();
    else setTimeout(function () { removeCar(car); }, 900);
  }

  // ---------- traffic AI ----------
  function trafficControls(car, dt) {
    var ai = car.ai;
    var city = GAME.city;
    if (!ai.node) {
      ai.node = city.nearestNode(car.pos.x, car.pos.z);
      ai.prev = null;
    }
    var tx = ai.node.x + ai.laneX, tz = ai.node.z + ai.laneZ;
    var dx = tx - car.pos.x, dz = tz - car.pos.z;
    var distN = Math.sqrt(dx * dx + dz * dz);
    if (distN < 6) {
      var nbs = city.neighbors(ai.node).filter(function (n) { return n !== ai.prev; });
      if (!nbs.length) nbs = [ai.prev];
      // prefer continuing straight
      var next = null;
      if (ai.prev && Math.random() < 0.6) {
        var ddx = ai.node.x - ai.prev.x, ddz = ai.node.z - ai.prev.z;
        for (var k = 0; k < nbs.length; k++) {
          if (Math.sign(nbs[k].x - ai.node.x) === Math.sign(ddx) && Math.sign(nbs[k].z - ai.node.z) === Math.sign(ddz)) { next = nbs[k]; break; }
        }
      }
      if (!next) next = nbs[Math.floor(Math.random() * nbs.length)];
      ai.prev = ai.node; ai.node = next;
      // lane offset: keep right of travel direction
      var mx = next.x - ai.prev.x, mz = next.z - ai.prev.z;
      var ml = Math.sqrt(mx * mx + mz * mz) || 1;
      ai.laneX = (mz / ml) * 3.1; ai.laneZ = (-mx / ml) * 3.1;
      tx = ai.node.x + ai.laneX; tz = ai.node.z + ai.laneZ;
      dx = tx - car.pos.x; dz = tz - car.pos.z;
    }
    var targetH = Math.atan2(dx, dz);
    var dh = U.wrapPI(targetH - car.heading);
    var steer = U.clamp(dh * 2.2, -1, 1);

    // wedged against something: back out
    if (Math.abs(car.speed) < 0.8 && distN > 8) car.unstickT += dt; else car.unstickT = 0;
    if (car.unstickT > 1.6) { car.reverseT = 1.1; car.unstickT = 0; }
    if (car.reverseT > 0) {
      car.reverseT -= dt;
      return { throttle: -0.8, steer: dh > 0 ? -1 : 1, handbrake: false };
    }

    var desired = ai.desired || 11;
    // brake for things ahead
    var fx = fwdX(car), fz = fwdZ(car);
    var lookA = 5 + car.speed * 0.8;
    var ax = car.pos.x + fx * lookA, az = car.pos.z + fz * lookA;
    var blocked = false, hard = false;
    var cars = world.cars;
    for (var i = 0; i < cars.length; i++) {
      var o = cars[i];
      if (o === car) continue;
      if (Math.abs(o.pos.y - car.pos.y) > 3) continue;   // not on the same level
      var odx = o.pos.x - car.pos.x, odz = o.pos.z - car.pos.z;
      var fd = odx * fx + odz * fz;
      if (fd < 1 || fd > lookA + 3) continue;
      var side = Math.abs(odx * fz - odz * fx);
      if (side < 2.6) { blocked = true; if (fd < 7) hard = true; }
    }
    var P = GAME.player;
    if (!P.inCar && Math.abs(P.pos.y - car.pos.y) < 3) {
      var pdx = P.pos.x - car.pos.x, pdz = P.pos.z - car.pos.z;
      var pfd = pdx * fx + pdz * fz;
      if (pfd > 0 && pfd < lookA + 2 && Math.abs(pdx * fz - pdz * fx) < 2.4) { blocked = true; if (pfd < 6) hard = true; }
    }
    var peds = world.peds;
    for (var pi = 0; pi < peds.length; pi++) {
      var pd = peds[pi];
      if (pd.dead) continue;
      if (Math.abs(pd.pos.y - car.pos.y) > 3) continue;   // not on the same level
      var qdx = pd.pos.x - car.pos.x, qdz = pd.pos.z - car.pos.z;
      var qfd = qdx * fx + qdz * fz;
      if (qfd > 0 && qfd < lookA && Math.abs(qdx * fz - qdz * fx) < 2.2) { blocked = true; if (qfd < 6) hard = true; }
    }
    var throttle;
    if (hard) throttle = car.speed > 0.5 ? -1 : 0;
    else if (blocked) throttle = car.speed > desired * 0.4 ? -0.4 : 0.15;
    else throttle = car.speed < desired ? 0.55 : 0;
    return { throttle: throttle, steer: steer, handbrake: false };
  }

  function spawnTraffic() {
    var fc = GAME.focus();
    var live = 0;
    for (var i = 0; i < world.cars.length; i++) {
      if (world.cars[i].ai && world.cars[i].ai.mode === 'traffic') live++;
    }
    var maxT = GAME.settings.maxTraffic;
    if (live >= maxT) return;
    var city = GAME.city;
    for (var tries = 0; tries < 6 && live < maxT; tries++) {
      var ang = Math.random() * Math.PI * 2;
      var r = U.randRange(Math.random, 80, GAME.settings.bubbleRadius);
      var x = fc.x + Math.cos(ang) * r, z = fc.z + Math.sin(ang) * r;
      var rp = city.nearestRoadPoint(x, z);
      var onIsla = rp.axis === 'net';
      if (!onIsla && (rp.x < -480 || rp.x > 352 || Math.abs(rp.z) > 480)) continue;
      if (city.inAirport(rp.x, rp.z)) continue; // keep the airfield clear
      if (rp.kind === 'local') continue;        // no through traffic down a cul-de-sac
      // avoid spawning on top of others
      var clear = true;
      for (var c = 0; c < world.cars.length; c++) {
        if (U.dist2(world.cars[c].pos.x, world.cars[c].pos.z, rp.x, rp.z) < 100) { clear = false; break; }
      }
      if (!clear) continue;
      // the island runs a different mix, so crossing a bridge changes the
      // traffic around you as well as the scenery
      var types = onIsla
        ? ['sedan', 'buggy', 'pickup', 'van', 'sports', 'limo', 'motorcycle']
        : ['sedan', 'sedan', 'taxi', 'sports', 'van', 'motorcycle'];
      var type = types[Math.floor(Math.random() * types.length)];
      var heading = onIsla ? rp.heading + (Math.random() < 0.5 ? 0 : Math.PI)
        : rp.axis === 'z' ? (Math.random() < 0.5 ? 0 : Math.PI) : (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      var car = spawnCar(type, rp.x, rp.z, heading, { occupied: 'ai', ai: { mode: 'traffic', desired: U.randRange(Math.random, 9, 13), laneX: 0, laneZ: 0 } });
      car.speed = 6;
      live++;
    }
  }

  function spawnParked() {
    var fc = GAME.focus();
    var P = GAME.player;
    var spots = GAME.city.parkedSpots;
    var live = 0;
    for (var i = 0; i < spots.length; i++) if (spots[i].live) live++;
    for (var s = 0; s < spots.length; s++) {
      var sp = spots[s];
      var d2 = U.dist2(sp.x, sp.z, fc.x, fc.z);
      // special vehicles (police/ambulance/bikes/aircraft) are guaranteed near their
      // spot — no distance floor, larger spawn range, and exempt from the parked cap
      var special = sp.police || sp.vtype;
      if (!special && GAME.city.inAirport(sp.x, sp.z)) continue; // no random cars on the airfield
      // don't park a twin of the special vehicle the player is currently driving
      // (e.g. a second ambulance sitting in the bay you just took yours from)
      if (sp.vtype && !sp.live && P.inCar && P.car && P.car.type === sp.vtype) continue;
      var minD = special ? 0 : 40 * 40;
      var range = special ? 210 : 140;
      var despawnR = special ? 260 : 190;
      if (!sp.live && (special || live < GAME.settings.maxParked) && d2 < range * range && d2 >= minD) {
        var clear = true;
        for (var c = 0; c < world.cars.length; c++) {
          if (U.dist2(world.cars[c].pos.x, world.cars[c].pos.z, sp.x, sp.z) < 60) { clear = false; break; }
        }
        if (!clear) continue;
        var types = sp.isla ? ['sedan', 'buggy', 'pickup', 'van', 'limo', 'sports']
          : ['sedan', 'sports', 'taxi', 'van', 'sedan'];
        var type = sp.police ? 'police' : (sp.vtype || types[Math.floor(Math.random() * types.length)]);
        // special vehicles keep their exact heading; ordinary parked cars flip randomly
        var head = special ? sp.heading : sp.heading + (Math.random() < 0.5 ? 0 : Math.PI);
        var car = spawnCar(type, sp.x, sp.z, head, { parkedSpot: sp, ai: { mode: 'parked' } });
        sp.live = car;
        live++;
      } else if (sp.live && d2 > despawnR * despawnR && sp.live !== GAME.player.car && !sp.live.dead) {
        removeCar(sp.live);
      }
    }
  }

  function update(dt) {
    var P = GAME.player;
    var fc = GAME.focus();
    var cars = world.cars;
    for (var i = cars.length - 1; i >= 0; i--) {
      var car = cars[i];
      // despawn far traffic
      if (car.ai && car.ai.mode === 'traffic' && !car.mission) {
        if (U.dist2(car.pos.x, car.pos.z, fc.x, fc.z) > 200 * 200) { removeCar(car); continue; }
      }
      if (car.dead) {
        if (!car.deadT) car.deadT = 0;
        car.deadT += dt;
        GAME.fx.spawn(car.pos.x, 1.2, car.pos.z, { count: 1, color: 0x222222, spread: 0.5, vy: 1.5, life: 1.4, grav: 0.2 });
        if (car.deadT > 14 && car !== P.car) { removeCar(car); continue; }
        continue;
      }
      if (car.stage >= 1) {
        car.smokeT -= dt;
        if (car.smokeT <= 0) {
          car.smokeT = 0.12;
          var col = car.stage >= 2 ? 0xff7020 : 0x555560;
          GAME.fx.spawn(car.pos.x + fwdX(car) * 1.4, 1.0, car.pos.z + fwdZ(car) * 1.4, { count: 2, color: col, spread: 0.6, vy: 2, life: 0.8, grav: 0.5 });
        }
        if (car.stage >= 2) {
          car.fireFuse -= dt;
          if (car.fireFuse <= 0) explodeCar(car, 'fire');
        }
      }
      if (car.spec.heli || car.spec.plane) {
        // aircraft are flown from player.js; abandoned airborne ones fall.
        var powered = (car === P.car && P.inCar);
        var restY = car.spec.plane ? (car.spec.wheelH || 1.1) : 1.4;
        if (!powered) {
          var hgy = GAME.city.groundY(car.pos.x, car.pos.z);
          if (car.pos.y > hgy + restY + 0.05) {
            car.vy = (car.vy || 0) - 12 * dt;
            car.pos.y += car.vy * dt;
            if (car.pos.y <= hgy + restY) {
              car.pos.y = hgy + restY;
              if (car.vy < -6) { explodeCar(car, 'fire'); continue; }
              car.vy = 0;
            }
          }
          car.speed = (car.speed || 0) * Math.exp(-1.5 * dt);
        }
        car.rotorSpin = U.damp(car.rotorSpin || 0, (powered || (car.vy || 0) < -2) ? 42 : 0, 1.5, dt);
        if (car.mesh.userData.rotor) car.mesh.userData.rotor.rotation.y += car.rotorSpin * dt;
        if (car.mesh.userData.tailRotor) car.mesh.userData.tailRotor.rotation.x += car.rotorSpin * dt;
        if (car.mesh.userData.prop) car.mesh.userData.prop.rotation.z += (powered ? 40 : car.rotorSpin) * dt;
        continue;
      }
      if (car === P.car && P.inCar) {
        // controls set by player.js
        stepPhysics(car, dt);
      } else if (car.ai && car.ai.mode === 'traffic' && car.occupied === 'ai') {
        car.controls = trafficControls(car, dt);
        stepPhysics(car, dt);
      } else if (car.ai && car.ai.mode === 'chase') {
        stepPhysics(car, dt); // controls written by police.js
      } else if (car.ai && car.ai.mode === 'race') {
        stepPhysics(car, dt); // controls written by missions.js
      } else {
        // ownerless: coast to a stop
        if (Math.abs(car.speed) > 0.1 || Math.abs(car.lat) > 0.1) {
          car.controls = { throttle: 0, steer: 0, handbrake: false };
          stepPhysics(car, dt);
        }
      }
    }
    collideCars(dt);
    if (GAME.frame % 15 === 0) { spawnTraffic(); spawnParked(); }
  }

  function findNearestCar(x, z, maxDist, excl) {
    var best = null, bd = maxDist * maxDist;
    for (var i = 0; i < world.cars.length; i++) {
      var c = world.cars[i];
      if (c.dead || c === excl) continue;
      var d = U.dist2(c.pos.x, c.pos.z, x, z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  return {
    TYPES: VEHICLES,
    spawnCar: spawnCar,
    removeCar: removeCar,
    update: update,
    damageCar: damageCar,
    explodeCar: explodeCar,
    trafficControls: trafficControls,
    findNearestCar: findNearestCar,
    fwdX: fwdX, fwdZ: fwdZ
  };
})();
