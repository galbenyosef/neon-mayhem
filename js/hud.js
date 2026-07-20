GAME.hud = (function () {
  var el = {};
  var shownCash = 0, targetCash = 0;
  var msgT = 0, zoneT = 0, lastZone = '';
  var radioT = 0;
  var mapBuffer = null, MAP_S = 0.5, MAP_OX = 520, MAP_OY = 520;
  var dmgFlash = null;
  var PICKUP_BLIP = {
    pistol: '#eef0ff', smg: '#ffe14f', shotgun: '#ff8a3d',
    health: '#ff4d6a', armor: '#39c8ff'
  };

  function $(id) { return document.getElementById(id); }

  function init() {
    ['minimap', 'cash', 'wanted-stars', 'health-fill', 'armor-fill', 'weapon-line', 'radio-popup', 'zone-popup',
      'msg-line', 'mission-hud', 'mission-title', 'mission-obj', 'mission-timer', 'title-screen', 'pause-screen',
      'wasted-screen', 'busted-screen', 'fade-layer', 'crt-layer', 'press-enter', 'title-best', 'pause-controls',
      'controls-bar', 'map-screen', 'bigmap', 'map-clear', 'map-close']
      .forEach(function (id) { el[id] = $(id); });
    var stars = '';
    for (var i = 0; i < 5; i++) stars += '<span>★</span>';
    el['wanted-stars'].innerHTML = stars;
    el['pause-controls'].innerHTML = document.getElementById('controls-card').innerHTML;

    dmgFlash = document.createElement('div');
    dmgFlash.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:22;background:radial-gradient(ellipse at center, transparent 55%, rgba(255,30,60,.45) 100%);opacity:0;transition:opacity .35s;';
    document.body.appendChild(dmgFlash);

    buildMapBuffer();
    targetCash = shownCash = GAME.player.cash;
    updateCashText();
    var bests = GAME.bests || {};
    var keys = Object.keys(bests);
    if (keys.length) el['title-best'].textContent = 'Best runs saved: ' + keys.length + '  ·  Cash: $' + GAME.player.cash;
    else if (GAME.player.cash !== 250) el['title-best'].textContent = 'Cash: $' + GAME.player.cash;

    el['press-enter'].addEventListener('click', function () { GAME.startGame(); });
    el['title-screen'].addEventListener('click', function () { GAME.startGame(); });
    el['title-screen'].addEventListener('touchend', function () { GAME.startGame(); });

    // pause: tap anywhere resumes; buttons stop the bubble
    el['pause-screen'].addEventListener('click', function () { if (GAME.paused) GAME.togglePause(); });
    el['pause-screen'].addEventListener('touchend', function (e) { e.preventDefault(); if (GAME.paused) GAME.togglePause(); });
    function pauseBtn(id, fn) {
      var b = $(id);
      ['click', 'touchend'].forEach(function (ev) {
        b.addEventListener(ev, function (e) { e.stopPropagation(); e.preventDefault(); fn(); });
      });
    }
    pauseBtn('pause-resume', function () { if (GAME.paused) GAME.togglePause(); });
    pauseBtn('pause-fs', function () { GAME.toggleFullscreen(); });
    pauseBtn('pause-exit', function () { location.reload(); });
    // death screens: tap to skip the wait
    ['wasted-screen', 'busted-screen'].forEach(function (id) {
      ['click', 'touchend'].forEach(function (ev) {
        el[id].addEventListener(ev, function () { GAME.skipScreen = true; });
      });
    });
    // corner fullscreen button
    var fsb = $('fs-btn');
    ['click', 'touchend'].forEach(function (ev) {
      fsb.addEventListener(ev, function (e) { e.stopPropagation(); e.preventDefault(); GAME.toggleFullscreen(); });
    });

    el['bigmap'].addEventListener('click', onMapClick);
    el['map-clear'].addEventListener('click', function () { GAME.nav.clear(); drawBigMap(); });
    el['map-close'].addEventListener('click', function () { api.toggleMap(false); });

    var legend = [
      ['#ff8a3d', 'Race'], ['#38e8ff', 'Courier'], ['#ff4fa3', 'Rampage'],
      ['#c86bff', 'S — Respray'], ['#ff8aa8', 'H — Hospital'], ['#5aa0ff', 'P — Police'],
      ['#eef0ff', 'Weapon'], ['#ff4d6a', 'Health'], ['#39c8ff', 'Armor'],
      ['#ff8aff', 'Destination'], ['#ffe14f', 'Objective']
    ];
    $('map-legend').innerHTML = legend.map(function (e) {
      return '<span class="lgd"><i style="background:' + e[0] + '"></i>' + e[1] + '</span>';
    }).join('');
  }

  // ---------- full-screen map ----------
  var mapScale = 1, mapOffY = 0;
  function drawBigMap() {
    var cv = el.bigmap;
    var size = Math.floor(Math.min(window.innerWidth * 0.86, window.innerHeight * 0.68, 560));
    cv.width = size; cv.height = Math.floor(size * 520 / 700);
    var g = cv.getContext('2d');
    mapScale = size / 700; mapOffY = 0;
    g.fillStyle = '#141020';
    g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(mapBuffer, 0, 0, 700 * mapScale, 520 * mapScale);
    function w2mx(x) { return (x + MAP_OX) * MAP_S * mapScale; }
    function w2my(z) { return mapOffY + (z + MAP_OY) * MAP_S * mapScale; }
    // route + destination
    var P = GAME.player;
    var px = P.inCar && P.car ? P.car.pos.x : P.pos.x;
    var pz = P.inCar && P.car ? P.car.pos.z : P.pos.z;
    if (GAME.nav.dest) {
      g.strokeStyle = 'rgba(141,255,216,.95)';
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(w2mx(px), w2my(pz));
      GAME.nav.path.forEach(function (n) { g.lineTo(w2mx(n.x), w2my(n.z)); });
      g.lineTo(w2mx(GAME.nav.dest.x), w2my(GAME.nav.dest.z));
      g.stroke();
      g.fillStyle = '#ff8aff';
      g.beginPath();
      g.arc(w2mx(GAME.nav.dest.x), w2my(GAME.nav.dest.z), 6, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke();
    }
    // active mission route
    var mroute = GAME.missions.getRoutePoints();
    if (mroute && mroute.length) {
      g.strokeStyle = 'rgba(255,138,61,.95)';
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(w2mx(px), w2my(pz));
      for (var mr = 0; mr < mroute.length; mr++) g.lineTo(w2mx(mroute[mr][0]), w2my(mroute[mr][1]));
      g.stroke();
      var mobj2 = GAME.missions.getObjectivePoint();
      if (mobj2) {
        g.fillStyle = '#ffe14f';
        g.beginPath();
        g.arc(w2mx(mobj2[0]), w2my(mobj2[1]), 5, 0, Math.PI * 2);
        g.fill();
      }
    }
    // mission / respray blips
    var mb = GAME.missions.getBlips();
    for (var i = 0; i < mb.length; i++) {
      g.fillStyle = mb[i].color;
      g.beginPath();
      g.arc(w2mx(mb[i].x), w2my(mb[i].z), 5, 0, Math.PI * 2);
      g.fill();
    }
    // labelled POI badges
    function badge(x, z, color, letter) {
      g.fillStyle = color;
      g.beginPath();
      g.arc(w2mx(x), w2my(z), 8, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1.2; g.stroke();
      g.fillStyle = '#0c0816';
      g.font = 'bold 11px Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(letter, w2mx(x), w2my(z) + 0.5);
    }
    // weapon / health / armor pickups
    GAME.world.pickups.forEach(function (pk) {
      if (pk.taken || !PICKUP_BLIP[pk.type]) return;
      g.fillStyle = PICKUP_BLIP[pk.type];
      g.beginPath();
      g.arc(w2mx(pk.pos.x), w2my(pk.pos.z), 3.5, 0, Math.PI * 2);
      g.fill();
    });
    GAME.city.pois.hospitals.forEach(function (hp) { badge(hp.x, hp.z, '#ff8aa8', 'H'); });
    badge(GAME.city.pois.police.x, GAME.city.pois.police.z, '#5aa0ff', 'P');
    GAME.city.pois.resprays.forEach(function (r) { badge(r.door.x, r.door.z, '#c86bff', 'S'); });
    // player arrow
    var h = P.inCar && P.car ? P.car.heading : P.heading;
    g.save();
    g.translate(w2mx(px), w2my(pz));
    g.rotate(-h);
    g.fillStyle = '#ffffff'; g.strokeStyle = '#ff4fa3'; g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, 8); g.lineTo(6, -7); g.lineTo(0, -3); g.lineTo(-6, -7);
    g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  function onMapClick(e) {
    var rect = el.bigmap.getBoundingClientRect();
    var cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    var wx = cx / mapScale / MAP_S - MAP_OX;
    var wz = (cy - mapOffY) / mapScale / MAP_S - MAP_OY;
    wx = U.clamp(wx, -495, 500);
    wz = U.clamp(wz, -495, 495);
    GAME.nav.setDest(wx, wz);
    drawBigMap();
  }

  // ---------- controls hint bar ----------
  var ctlMode = '';
  function refreshControlsBar() {
    if (GAME.isTouch) { el['controls-bar'].style.display = 'none'; return; }
    var hidden = GAME.prefs && GAME.prefs.hideCtl;
    if (!GAME.started || hidden) { el['controls-bar'].style.display = 'none'; ctlMode = ''; return; }
    var mode = GAME.player.inCar ? 'car' : 'foot';
    if (mode === ctlMode && el['controls-bar'].style.display === 'block') return;
    ctlMode = mode;
    el['controls-bar'].innerHTML = mode === 'car'
      ? '<b>WASD</b> drive · <b>Space</b> handbrake · <b>Q/E</b> drive-by · <b>F</b> exit · <b>,/.</b> radio · <b>P</b> map · <b>H</b> hide'
      : '<b>WASD</b> move · <b>Shift</b> sprint · <b>RMB</b> aim · <b>LMB</b> fire · <b>1-4</b> weapons · <b>F</b> enter car · <b>P</b> map · <b>H</b> hide';
    el['controls-bar'].style.display = 'block';
  }

  function buildMapBuffer() {
    mapBuffer = document.createElement('canvas');
    mapBuffer.width = 700; mapBuffer.height = 520;
    var g = mapBuffer.getContext('2d');
    function mx(x) { return (x + MAP_OX) * MAP_S; }
    function my(z) { return (z + MAP_OY) * MAP_S; }
    // island: water everywhere, then scan-fill the landmass with a sand rim
    var c = GAME.city;
    g.fillStyle = '#16305a';
    g.fillRect(0, 0, 700, 520);
    function isLand(x, z) {
      return !(x > c.shoreline(z) || x < c.westShore(z) || z < c.northShore(x) || z > c.southShore(x));
    }
    var CELL = 8;
    for (var wx = -520; wx < 880; wx += CELL) {
      for (var wz = -520; wz < 520; wz += CELL) {
        var cxm = wx + CELL / 2, czm = wz + CELL / 2;
        if (!isLand(cxm, czm)) continue;
        var rim = !isLand(cxm + CELL, czm) || !isLand(cxm - CELL, czm) || !isLand(cxm, czm + CELL) || !isLand(cxm, czm - CELL);
        g.fillStyle = rim ? '#8a7a58' : '#141020';
        g.fillRect(mx(wx), my(wz), CELL * MAP_S + 0.5, CELL * MAP_S + 0.5);
      }
    }
    // east beach band
    g.fillStyle = '#3a3350';
    g.beginPath();
    g.moveTo(mx(368), my(-500));
    for (var z = -500; z <= 500; z += 25) g.lineTo(mx(GAME.city.shoreline(z) - 4), my(z));
    g.lineTo(mx(368), my(500));
    g.closePath();
    g.fill();
    // roads
    g.strokeStyle = '#4a4462';
    g.lineWidth = 5 * MAP_S * 2.4;
    var R = GAME.city.R;
    for (var i = 0; i < R.length; i++) {
      g.beginPath(); g.moveTo(mx(R[i]), my(-480)); g.lineTo(mx(R[i]), my(480)); g.stroke();
      g.beginPath(); g.moveTo(mx(-480), my(R[i])); g.lineTo(mx(350), my(R[i])); g.stroke();
    }
    g.strokeStyle = '#5a5478';
    g.beginPath(); g.moveTo(mx(350), my(-480)); g.lineTo(mx(350), my(480)); g.stroke();
    // piers
    g.strokeStyle = '#6a5a48'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(mx(360), my(150)); g.lineTo(mx(505), my(150)); g.stroke();
    g.beginPath(); g.moveTo(mx(360), my(-180)); g.lineTo(mx(470), my(-180)); g.stroke();
    // POIs
    g.fillStyle = '#ff8aa8';
    GAME.city.pois.hospitals.forEach(function (H) { g.fillRect(mx(H.x) - 3, my(H.z) - 3, 6, 6); });
    var PD = GAME.city.pois.police;
    g.fillStyle = '#5aa0ff'; g.fillRect(mx(PD.x) - 3, my(PD.z) - 3, 6, 6);
    g.fillStyle = '#c86bff';
    GAME.city.pois.resprays.forEach(function (r) { g.fillRect(mx(r.door.x) - 3, my(r.door.z) - 3, 6, 6); });
  }

  function drawMinimap() {
    var cv = el.minimap, g = cv.getContext('2d');
    var P = GAME.player;
    var px = P.inCar && P.car ? P.car.pos.x : P.pos.x;
    var pz = P.inCar && P.car ? P.car.pos.z : P.pos.z;
    var h = P.inCar && P.car ? P.car.heading : P.heading;
    g.clearRect(0, 0, 180, 180);
    var zoom = P.inCar ? 0.62 : 0.85;
    g.save();
    g.translate(90, 90);
    // heading-up radar: rotate so the player's forward direction points up
    g.rotate(h - Math.PI);
    g.scale(zoom, zoom);
    g.drawImage(mapBuffer, -(px + MAP_OX) * MAP_S, -(pz + MAP_OY) * MAP_S);
    // blips (drawn in the rotated frame so they track the map)
    function blip(x, z, color, size) {
      g.fillStyle = color;
      g.beginPath();
      g.arc((x - px) * MAP_S, (z - pz) * MAP_S, size, 0, Math.PI * 2);
      g.fill();
    }
    // weapon / health / armor pickups near the player
    var pk = GAME.world.pickups;
    for (var pu = 0; pu < pk.length; pu++) {
      var pp = pk[pu];
      if (pp.taken || !PICKUP_BLIP[pp.type]) continue;
      if (U.dist2(pp.pos.x, pp.pos.z, px, pz) > 150 * 150) continue;
      blip(pp.pos.x, pp.pos.z, PICKUP_BLIP[pp.type], 2.6 / zoom);
    }
    // active mission route (race checkpoints / current delivery stop)
    var mroute = GAME.missions.getRoutePoints();
    if (mroute && mroute.length) {
      g.strokeStyle = 'rgba(255,138,61,.95)';
      g.lineWidth = 2.4 / zoom;
      g.beginPath();
      g.moveTo(0, 0);
      for (var mr = 0; mr < mroute.length; mr++) g.lineTo((mroute[mr][0] - px) * MAP_S, (mroute[mr][1] - pz) * MAP_S);
      g.stroke();
      var mobj = GAME.missions.getObjectivePoint();
      if (mobj) blip(mobj[0], mobj[1], '#ffe14f', 4.5 / zoom);
    }
    // nav route
    if (GAME.nav.dest) {
      g.strokeStyle = 'rgba(141,255,216,.95)';
      g.lineWidth = 2.4 / zoom;
      g.beginPath();
      g.moveTo(0, 0);
      var path = GAME.nav.path;
      for (var np = 0; np < path.length; np++) g.lineTo((path[np].x - px) * MAP_S, (path[np].z - pz) * MAP_S);
      g.lineTo((GAME.nav.dest.x - px) * MAP_S, (GAME.nav.dest.z - pz) * MAP_S);
      g.stroke();
      blip(GAME.nav.dest.x, GAME.nav.dest.z, '#ff8aff', 4.5 / zoom);
    }
    var mb = GAME.missions.getBlips();
    for (var i = 0; i < mb.length; i++) blip(mb[i].x, mb[i].z, mb[i].color, mb[i].size);
    var cars = GAME.world.cars;
    for (var c = 0; c < cars.length; c++) {
      if (cars[c].isPolice && !cars[c].dead && cars[c].ai) blip(cars[c].pos.x, cars[c].pos.z, '#5aa0ff', 3);
    }
    var peds = GAME.world.peds;
    for (var pd = 0; pd < peds.length; pd++) {
      if (peds[pd].isCop && !peds[pd].dead) blip(peds[pd].pos.x, peds[pd].pos.z, '#5aa0ff', 2);
    }
    g.restore();
    // player arrow: fixed, always pointing up (the radar rotates beneath it)
    g.save();
    g.translate(90, 90);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#ff4fa3';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 2); g.lineTo(-6, 6);
    g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  function updateCashText() {
    el.cash.textContent = '$' + Math.floor(shownCash);
  }

  function update(dt) {
    if (!mapBuffer) return;
    GAME.nav.update(dt);
    if (GAME.frame % 3 === 0) drawMinimap();
    if (GAME.frame % 10 === 0) refreshControlsBar();
    // cash tick-up
    if (shownCash !== targetCash) {
      var diff = targetCash - shownCash;
      var step = Math.max(1, Math.abs(diff) * dt * 4);
      shownCash += Math.sign(diff) * Math.min(Math.abs(diff), step);
      if (Math.abs(targetCash - shownCash) < 1) shownCash = targetCash;
      else if (GAME.frame % 4 === 0) GAME.audio.cashTick();
      updateCashText();
    }
    var P = GAME.player;
    el['health-fill'].style.width = U.clamp(P.health, 0, 100) + '%';
    el['armor-fill'].style.width = U.clamp(P.armor, 0, 100) + '%';
    if (msgT > 0) { msgT -= dt; if (msgT <= 0) el['msg-line'].style.opacity = 0; }
    if (radioT > 0) { radioT -= dt; if (radioT <= 0) el['radio-popup'].style.opacity = 0; }
    zoneT -= dt;
    if (zoneT <= 0) {
      zoneT = 2;
      var zn = GAME.city.districtName(P.pos.x, P.pos.z);
      if (zn !== lastZone) {
        lastZone = zn;
        el['zone-popup'].textContent = zn;
        el['zone-popup'].style.opacity = 1;
        setTimeout(function () { el['zone-popup'].style.opacity = 0; }, 2600);
      }
    }
  }

  var api = {
    init: init,
    update: update,
    toggleMap: function (force) {
      if (!GAME.started) return;
      var open = force !== undefined ? force : !GAME.mapOpen;
      GAME.mapOpen = open;
      el['map-screen'].style.display = open ? 'flex' : 'none';
      // the sim loop halts while the map is open; silence the engine drone
      if (open) { GAME.audio.engineState(false, 0); GAME.audio.skid(0); GAME.audio.siren(0); drawBigMap(); }
    },
    mapClear: function () { GAME.nav.clear(); if (GAME.mapOpen) drawBigMap(); },
    redrawMap: function () { if (GAME.mapOpen) drawBigMap(); },
    toggleControlsBar: function () {
      GAME.prefs = GAME.prefs || {};
      GAME.prefs.hideCtl = !GAME.prefs.hideCtl;
      GAME.save();
      ctlMode = '';
      refreshControlsBar();
      return !GAME.prefs.hideCtl;
    },
    cashChanged: function () { targetCash = GAME.player.cash; },
    wantedChanged: function (n) {
      var spans = el['wanted-stars'].children;
      for (var i = 0; i < 5; i++) spans[i].className = i < n ? 'lit' : '';
    },
    setWeapon: function (name, ammo) {
      el['weapon-line'].textContent = name + (ammo === '' ? '' : '  ·  ' + ammo);
    },
    message: function (text, dur) {
      el['msg-line'].textContent = text;
      el['msg-line'].style.opacity = 1;
      msgT = dur || 2.5;
    },
    radioPopup: function (name) {
      el['radio-popup'].textContent = '♪ ' + name;
      el['radio-popup'].style.opacity = 1;
      radioT = 2.2;
    },
    damageFlash: function () {
      dmgFlash.style.opacity = 1;
      setTimeout(function () { dmgFlash.style.opacity = 0; }, 120);
    },
    missionStart: function (title, obj) {
      el['mission-hud'].style.display = 'block';
      el['mission-title'].textContent = title;
      el['mission-obj'].textContent = obj;
      el['mission-timer'].textContent = '';
    },
    missionObjective: function (obj) { el['mission-obj'].textContent = obj; },
    missionTimer: function (t, countdown) {
      var s = Math.max(0, t);
      var mm = Math.floor(s / 60), ss = Math.floor(s % 60);
      el['mission-timer'].textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;
      el['mission-timer'].style.color = countdown && s < 12 ? '#ff5d7a' : '#8dffd8';
    },
    missionEnd: function () { el['mission-hud'].style.display = 'none'; },
    showBig: function (kind, sub) {
      var scr = el[kind + '-screen'];
      scr.style.display = 'flex';
      scr.querySelector('.big-sub').textContent = sub || '';
    },
    hideBig: function () {
      el['wasted-screen'].style.display = 'none';
      el['busted-screen'].style.display = 'none';
    },
    fade: function (cb) {
      el['fade-layer'].style.opacity = 1;
      setTimeout(function () {
        try { cb && cb(); } finally {
          setTimeout(function () { el['fade-layer'].style.opacity = 0; }, 150);
        }
      }, 550);
    },
    hideTitle: function () {
      el['title-screen'].style.display = 'none';
      document.getElementById('hud').style.display = 'block';
    },
    setPaused: function (p) { el['pause-screen'].style.display = p ? 'flex' : 'none'; },
    toggleCRT: function () {
      var on = el['crt-layer'].style.display !== 'block';
      el['crt-layer'].style.display = on ? 'block' : 'none';
      return on;
    }
  };
  return api;
})();

// destination routing along the road graph
GAME.nav = (function () {
  var dest = null, path = [], recompT = 0;

  function key(n) { return n.i + ',' + n.j; }

  // BFS along the road-node graph; returns [{x,z}...] start->goal
  function roadPath(x0, z0, x1, z1) {
    var start = GAME.city.nearestNode(x0, z0);
    var goal = GAME.city.nearestNode(x1, z1);
    if (!start || !goal) return [];
    var prev = {}, q = [start];
    prev[key(start)] = null;
    while (q.length) {
      var n = q.shift();
      if (n === goal) break;
      var nbs = GAME.city.neighbors(n);
      for (var i = 0; i < nbs.length; i++) {
        var k = key(nbs[i]);
        if (!(k in prev)) { prev[k] = n; q.push(nbs[i]); }
      }
    }
    var out = [], cur = goal;
    while (cur) { out.unshift({ x: cur.x, z: cur.z }); cur = prev[key(cur)]; }
    return out;
  }

  function computePath() {
    if (!dest) { path = []; return; }
    var P = GAME.player;
    var px = P.inCar && P.car ? P.car.pos.x : P.pos.x;
    var pz = P.inCar && P.car ? P.car.pos.z : P.pos.z;
    path = roadPath(px, pz, dest.x, dest.z);
  }

  return {
    get dest() { return dest; },
    get path() { return path; },
    roadPath: roadPath,
    setDest: function (x, z) {
      dest = { x: x, z: z };
      computePath();
      GAME.hud.message('Destination set — follow the route.', 2);
    },
    clear: function () { dest = null; path = []; },
    update: function (dt) {
      if (!dest) return;
      recompT -= dt;
      if (recompT <= 0) { recompT = 1.5; computePath(); }
      var P = GAME.player;
      var px = P.inCar && P.car ? P.car.pos.x : P.pos.x;
      var pz = P.inCar && P.car ? P.car.pos.z : P.pos.z;
      if (U.dist2(px, pz, dest.x, dest.z) < 240) {
        dest = null; path = [];
        GAME.hud.message('You have arrived.', 2.5);
        GAME.audio.pickup();
      }
    }
  };
})();
