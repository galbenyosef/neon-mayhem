GAME.hud = (function () {
  var el = {};
  var shownCash = 0, targetCash = 0;
  var msgT = 0, zoneT = 0, lastZone = '';
  var radioT = 0;
  var mapBuffer = null, MAP_S = 0.5, MAP_OX = 520, MAP_OY = 560;
  var MAP_W = 1020, MAP_H = 560;   // world -520..1520 by -560..560, at 0.5 px/m
  var dmgFlash = null;
  var PICKUP_BLIP = {
    pistol: '#eef0ff', smg: '#ffe14f', shotgun: '#ff8a3d',
    health: '#ff4d6a', armor: '#39c8ff', rifle: '#8dffd8'
  };

  function $(id) { return document.getElementById(id); }

  function init() {
    ['minimap', 'cash', 'wanted-stars', 'health-fill', 'armor-fill', 'weapon-line', 'radio-popup', 'zone-popup',
      'msg-line', 'poi-hint', 'mission-hud', 'mission-title', 'mission-obj', 'mission-timer', 'title-screen', 'pause-screen',
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
    pauseBtn('pause-map', function () { if (GAME.paused) GAME.togglePause(); api.toggleMap(true); });
    pauseBtn('pause-mute', function () { var m = GAME.audio.toggleMute(); $('pause-mute').textContent = m ? '🔇 MUTED' : '🔊 SOUND'; });
    // music and effects are separate taps: kill the radio and keep the crashes,
    // or the other way round. The choice is remembered.
    function paintAudioBtns() {
      $('pause-music').textContent = GAME.audio.musicOn ? '🎵 MUSIC: ON' : '🎵 MUSIC: OFF';
      $('pause-sfx').textContent = GAME.audio.sfxOn ? '💥 SFX: ON' : '💥 SFX: OFF';
    }
    pauseBtn('pause-music', function () {
      GAME.audio.setMusicOn(!GAME.audio.musicOn);
      if (GAME.prefs) { GAME.prefs.musicOff = !GAME.audio.musicOn; GAME.save(); }
      paintAudioBtns();
    });
    pauseBtn('pause-sfx', function () {
      GAME.audio.setSfxOn(!GAME.audio.sfxOn);
      if (GAME.prefs) { GAME.prefs.sfxOff = !GAME.audio.sfxOn; GAME.save(); }
      paintAudioBtns();
    });
    if (GAME.prefs) {
      if (GAME.prefs.musicOff) GAME.audio.setMusicOn(false);
      if (GAME.prefs.sfxOff) GAME.audio.setSfxOn(false);
    }
    paintAudioBtns();
    pauseBtn('pause-crt', function () { GAME.hud.toggleCRT(); });
    pauseBtn('pause-day', function () { api.refreshTimeBtn(GAME.cycleTimeMode()); });
    api.refreshTimeBtn(GAME.timeMode);
    pauseBtn('pause-fs', function () { GAME.toggleFullscreen(); });
    // the save travels: export downloads a file, import reads one back and
    // reloads into the imported life
    pauseBtn('pause-export', function () {
      var blob = new Blob([GAME.exportSave()], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'neon-mayhem-save.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      GAME.track('save-exported');
    });
    pauseBtn('pause-import', function () {
      // an import is an overwrite: make sure the player knows the life they
      // are living right now is about to be replaced, and offer the way out
      if (!window.confirm(
        'Importing a save REPLACES your current progress — cash, property, garage, look, everything.\n\n' +
        'If you want to keep this life, press Cancel and use EXPORT SAVE first.\n\nImport and overwrite?')) return;
      $('save-file').click();
    });
    $('save-file').addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var r = GAME.importSave(String(rd.result));
        if (r.ok) { GAME.track('save-imported'); location.reload(); }
        else alert(r.why);
      };
      rd.readAsText(f);
    });
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
    api.refreshFsBtn();
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (ev) {
      document.addEventListener(ev, function () { api.refreshFsBtn(); });
    });

    el['bigmap'].addEventListener('click', onMapClick);
    el['map-clear'].addEventListener('click', function () { GAME.nav.clear(); drawBigMap(); });
    el['map-close'].addEventListener('click', function () { api.toggleMap(false); });

    // legend entries behave like a chart's: click one to hide that marker
    // family on both maps, click again to bring it back. Choices persist.
    (GAME.prefs && GAME.prefs.mapHidden || []).forEach(function (k) { mapHidden[k] = true; });
    refreshLegend();
  }

  // ---------- toggleable legend ----------
  var mapHidden = {};
  var LEGEND = [
    ['#ff8a3d', 'Race', 'race'], ['#38e8ff', 'Courier', 'courier'], ['#ff4fa3', 'Rampage', 'rampage'],
    ['#c86bff', 'S — Respray', 'respray'], ['#ff8aa8', 'H — Hospital', 'hospital'], ['#5aa0ff', 'P — Police', 'police'],
    ['#eef0ff', 'Weapon', 'weapon'], ['#ff4d6a', 'Health', 'health'], ['#39c8ff', 'Armor', 'armor'],
    ['#8de0ff', '✈ Airport · Ⓗ Helipad', 'airport'], ['#ffd7e4', '☀ Ice cream depot', 'icecream'],
    ['#8de8b0', '$ Shops & property', 'shops'], ['#5dff9e', '⌂ Your safehouse', 'home'],
    ['#ff8aff', 'Destination', 'dest'], ['#ffe14f', 'Objective', 'objective']
  ];
  function catVis(k) { return !mapHidden[k]; }
  function pickupCat(t) { return t === 'health' ? 'health' : t === 'armor' ? 'armor' : 'weapon'; }
  function toggleCat(k) {
    mapHidden[k] = !mapHidden[k];
    GAME.prefs = GAME.prefs || {};
    GAME.prefs.mapHidden = Object.keys(mapHidden).filter(function (k2) { return mapHidden[k2]; });
    GAME.save();
    refreshLegend();
    if (GAME.mapOpen) drawBigMap();
  }
  function refreshLegend() {
    var box = $('map-legend');
    box.innerHTML = LEGEND.map(function (e) {
      return '<span class="lgd' + (mapHidden[e[2]] ? ' off' : '') + '" data-k="' + e[2] + '">' +
        '<i style="background:' + e[0] + '"></i>' + e[1] + '</span>';
    }).join('');
    for (var i = 0; i < box.children.length; i++) {
      // taps don't reliably become clicks in this app (same reason the pause
      // screen and fs button bind both); touchend's preventDefault also stops
      // the browser double-firing a synthetic click after it
      ['click', 'touchend'].forEach(function (ev) {
        box.children[i].addEventListener(ev, function (e) {
          e.preventDefault();
          e.stopPropagation();
          toggleCat(this.getAttribute('data-k'));
        });
      });
    }
  }

  // ---------- full-screen map ----------
  var mapScale = 1, mapOffY = 0;
  function drawBigMap() {
    var cv = el.bigmap;
    // short screens hand more of their height to the legend and buttons —
    // a map you can see all of beats a bigger map with the CLOSE button
    // pushed off the bottom
    var hFactor = window.innerHeight < 460 ? 0.52 : 0.68;
    var size = Math.floor(Math.min(window.innerWidth * 0.92, window.innerHeight * hFactor * MAP_W / MAP_H, 900));
    cv.width = size; cv.height = Math.floor(size * MAP_H / MAP_W);
    var g = cv.getContext('2d');
    mapScale = size / MAP_W; mapOffY = 0;
    g.fillStyle = '#141020';
    g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(mapBuffer, 0, 0, MAP_W * mapScale, MAP_H * mapScale);
    function w2mx(x) { return (x + MAP_OX) * MAP_S * mapScale; }
    function w2my(z) { return mapOffY + (z + MAP_OY) * MAP_S * mapScale; }
    // route + destination
    var P = GAME.player;
    var px = P.inCar && P.car ? P.car.pos.x : P.pos.x;
    var pz = P.inCar && P.car ? P.car.pos.z : P.pos.z;
    if (GAME.nav.dest && catVis('dest')) {
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
    var mroute = catVis('objective') ? GAME.missions.getRoutePoints() : null;
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
      if (mb[i].kind && !catVis(mb[i].kind)) continue;
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
      if (!catVis(pickupCat(pk.type))) return;
      g.fillStyle = PICKUP_BLIP[pk.type];
      g.beginPath();
      g.arc(w2mx(pk.pos.x), w2my(pk.pos.z), 3.5, 0, Math.PI * 2);
      g.fill();
    });
    if (catVis('hospital')) GAME.city.pois.hospitals.forEach(function (hp) { badge(hp.x, hp.z, '#ff8aa8', 'H'); });
    if (catVis('police')) GAME.city.pois.stations.forEach(function (st) { badge(st.x, st.z, '#5aa0ff', 'P'); });
    if (catVis('respray')) GAME.city.pois.resprays.forEach(function (r) { badge(r.door.x, r.door.z, '#c86bff', 'S'); });
    if (GAME.shops) GAME.shops.blips().forEach(function (s) {
      if (!catVis(s.home ? 'home' : 'shops')) return;
      if (!s.home) { badge(s.x, s.z, s.color, s.label); return; }
      // property you OWN is a landmark, not a shop dot: a ringed disc with a
      // drawn house (fonts can't be trusted with ⌂) — the legend does the
      // talking, the way a map should
      var hx = w2mx(s.x), hy = w2my(s.z);
      g.fillStyle = s.color;
      g.beginPath(); g.arc(hx, hy, 11, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#ffffff'; g.lineWidth = 2.2; g.stroke();
      g.fillStyle = '#0c2418';
      g.beginPath();                        // roof
      g.moveTo(hx - 6, hy - 0.5); g.lineTo(hx, hy - 6); g.lineTo(hx + 6, hy - 0.5);
      g.closePath(); g.fill();
      g.fillRect(hx - 4, hy - 0.5, 8, 5.5); // walls
      g.fillStyle = s.color;
      g.fillRect(hx - 1.2, hy + 1.4, 2.4, 3.6); // door
    });
    if (catVis('airport')) badge(GAME.city.airport.apron.x, GAME.city.airport.apron.z, '#8de0ff', '✈');
    if (catVis('icecream') && GAME.city.islaPois) badge(GAME.city.islaPois.factory.x, GAME.city.islaPois.factory.z, '#ffd7e4', '☀');
    // helipad: a ringed cyan disc with an H
    if (catVis('airport')) {
      var hpb = GAME.city.helipad;
      g.fillStyle = '#8de0ff';
      g.beginPath(); g.arc(w2mx(hpb.x), w2my(hpb.z), 8, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.stroke();
      g.strokeStyle = '#0c0816'; g.lineWidth = 2;
      g.beginPath();
      g.moveTo(w2mx(hpb.x) - 3, w2my(hpb.z) - 3.5); g.lineTo(w2mx(hpb.x) - 3, w2my(hpb.z) + 3.5);
      g.moveTo(w2mx(hpb.x) + 3, w2my(hpb.z) - 3.5); g.lineTo(w2mx(hpb.x) + 3, w2my(hpb.z) + 3.5);
      g.moveTo(w2mx(hpb.x) - 3, w2my(hpb.z)); g.lineTo(w2mx(hpb.x) + 3, w2my(hpb.z));
      g.stroke();
    }
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
    wx = U.clamp(wx, -495, 1500);
    wz = U.clamp(wz, -540, 540);
    GAME.nav.setDest(wx, wz);
    drawBigMap();
  }

  // ---------- controls hint bar ----------
  var ctlMode = '';
  function refreshControlsBar() {
    if (GAME.isTouch) { el['controls-bar'].style.display = 'none'; return; }
    var hidden = GAME.prefs && GAME.prefs.hideCtl;
    if (!GAME.started || hidden) { el['controls-bar'].style.display = 'none'; ctlMode = ''; return; }
    var mode = GAME.player.parachuting ? 'chute'
      : (GAME.player.inCar && GAME.player.car && GAME.player.car.spec.plane) ? 'plane'
        : (GAME.player.inCar && GAME.player.car && GAME.player.car.spec.heli) ? 'heli'
          : GAME.player.inCar ? 'car' : 'foot';
    if (mode === ctlMode && el['controls-bar'].style.display === 'block') return;
    ctlMode = mode;
    var txt = {
      car: '<b>WASD</b> drive · <b>Space</b> handbrake · <b>Q/E</b> drive-by · <b>F</b> exit · <b>,/.</b> radio · <b>P</b> map · <b>H</b> hide',
      foot: '<b>WASD</b> move · <b>Shift</b> sprint · <b>Space</b> jump · <b>RMB</b> aim · <b>LMB</b> fire · <b>1-5</b> weapons · <b>F</b> enter car · <b>P</b> map · <b>H</b> hide',
      heli: '<b>Space</b> up · <b>Shift</b> down · <b>W/S</b> forward · <b>A/D</b> yaw · <b>F</b> exit / bail out · <b>P</b> map',
      plane: '<b>W/S</b> throttle · <b>Space</b> climb · <b>Shift</b> dive · <b>A/D</b> turn · <b>Q/E</b> barrel roll · <b>F</b> bail out',
      chute: '<b>WASD</b> steer your descent · glide down to land'
    };
    el['controls-bar'].innerHTML = txt[mode];
    el['controls-bar'].style.display = 'block';
  }

  function buildMapBuffer() {
    mapBuffer = document.createElement('canvas');
    mapBuffer.width = MAP_W; mapBuffer.height = MAP_H;
    var g = mapBuffer.getContext('2d');
    function mx(x) { return (x + MAP_OX) * MAP_S; }
    function my(z) { return (z + MAP_OY) * MAP_S; }
    // island: water everywhere, then scan-fill the landmass with a sand rim
    var c = GAME.city;
    g.fillStyle = '#16305a';
    g.fillRect(0, 0, MAP_W, MAP_H);
    // every landmass draws the same way, so a second island needs no second
    // branch here — it is land if some island contains it
    function isLand(x, z) { return !!c.islandAt(x, z); }
    var CELL = 8;
    for (var wx = -520; wx < 1520; wx += CELL) {
      for (var wz = -560; wz < 560; wz += CELL) {
        var cxm = wx + CELL / 2, czm = wz + CELL / 2;
        if (!isLand(cxm, czm)) continue;
        var rim = !isLand(cxm + CELL, czm) || !isLand(cxm - CELL, czm) || !isLand(cxm, czm + CELL) || !isLand(cxm, czm - CELL);
        // relief shading, so the hills read on the map as well as underfoot
        var gy = rim ? 0 : c.groundY(cxm, czm);
        g.fillStyle = rim ? '#8a7a58' : gy > 2
          ? 'rgb(' + Math.round(20 + gy * 1.5) + ',' + Math.round(16 + gy * 2.2) + ',' + Math.round(32 + gy * 0.8) + ')'
          : '#141020';
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
    // Isla Verde: its roads are polylines, so they draw as polylines
    if (GAME.city.isla) {
      var IS = GAME.city.isla;
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = '#4a4462';
      IS.net.forEach(function (seg) {
        g.lineWidth = Math.max(2, seg.w * MAP_S * 2.0);
        g.beginPath();
        for (var k = 0; k < seg.pts.length; k++) {
          var pt = seg.pts[k];
          if (k) g.lineTo(mx(pt[0]), my(pt[1])); else g.moveTo(mx(pt[0]), my(pt[1]));
        }
        g.stroke();
      });
      // the bridges, in the same pink they are lit in
      g.strokeStyle = '#b8548a'; g.lineWidth = 5;
      IS.spans.forEach(function (sp) {
        g.beginPath();
        for (var k2 = 0; k2 < sp.pts.length; k2++) {
          var q = sp.pts[k2];
          if (k2) g.lineTo(mx(q[0]), my(q[1])); else g.moveTo(mx(q[0]), my(q[1]));
        }
        g.stroke();
      });
      g.lineCap = 'butt'; g.lineJoin = 'miter';
    }
    // piers
    g.strokeStyle = '#6a5a48'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(mx(360), my(250)); g.lineTo(mx(505), my(250)); g.stroke();
    g.beginPath(); g.moveTo(mx(360), my(-180)); g.lineTo(mx(470), my(-180)); g.stroke();
    // airport: fenced apron, a runway strip with a dashed centreline
    var A = GAME.city.airport;
    g.fillStyle = 'rgba(60,66,84,0.55)';
    g.fillRect(mx(A.fx0), my(A.fz0), (A.fx1 - A.fx0) * MAP_S, (A.fz1 - A.fz0) * MAP_S);
    g.strokeStyle = '#7a808e'; g.lineWidth = 1;
    g.strokeRect(mx(A.fx0), my(A.fz0), (A.fx1 - A.fx0) * MAP_S, (A.fz1 - A.fz0) * MAP_S);
    g.fillStyle = '#2a2c34';
    g.fillRect(mx(A.minX), my(A.cz - 13), (A.maxX - A.minX) * MAP_S, 26 * MAP_S);
    g.strokeStyle = '#d8c46a'; g.lineWidth = 1; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(mx(A.minX + 8), my(A.cz)); g.lineTo(mx(A.maxX - 8), my(A.cz)); g.stroke();
    g.setLineDash([]);
    // helipad: cyan ring
    var hp = GAME.city.helipad;
    g.strokeStyle = '#8de0ff'; g.lineWidth = 2;
    g.beginPath(); g.arc(mx(hp.x), my(hp.z), 5, 0, Math.PI * 2); g.stroke();
    // POIs
    g.fillStyle = '#ff8aa8';
    GAME.city.pois.hospitals.forEach(function (H) { g.fillRect(mx(H.x) - 3, my(H.z) - 3, 6, 6); });
    g.fillStyle = '#5aa0ff';
    GAME.city.pois.stations.forEach(function (st) { g.fillRect(mx(st.x) - 3, my(st.z) - 3, 6, 6); });
    g.fillStyle = '#c86bff';
    GAME.city.pois.resprays.forEach(function (r) { g.fillRect(mx(r.door.x) - 3, my(r.door.z) - 3, 6, 6); });
    // the landmasses name themselves, written on the sea below each one
    g.font = 'italic 700 17px "Segoe UI", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(150,200,240,0.85)';
    g.fillText('ISLA ROSA', mx(-70), my(542));
    if (GAME.city.isla) {
      // just under the island's own southernmost point, wherever that is
      var southZ = -1e9, cxIsla = 0, n = 0;
      for (var la = 0; la < Math.PI * 2; la += 0.05) {
        var q = GAME.city.isla.ringPt(la, 1);
        southZ = Math.max(southZ, q[1]); cxIsla += q[0]; n++;
      }
      g.fillText('ISLA VERDE', mx(cxIsla / n), my(Math.min(southZ + 26, 545)));
    }
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
      if (!catVis(pickupCat(pp.type))) continue;
      if (U.dist2(pp.pos.x, pp.pos.z, px, pz) > 150 * 150) continue;
      blip(pp.pos.x, pp.pos.z, PICKUP_BLIP[pp.type], 2.6 / zoom);
    }
    // nearby shops and property, so the doormats are findable from the radar.
    // Homes you own ignore the range gate and wear a white ring — wherever
    // you are, the radar says which way home is.
    if (GAME.shops) {
      var sb = GAME.shops.blips();
      for (var sbi = 0; sbi < sb.length; sbi++) {
        var sbp = sb[sbi];
        if (!catVis(sbp.home ? 'home' : 'shops')) continue;
        if (!sbp.home && U.dist2(sbp.x, sbp.z, px, pz) > 170 * 170) continue;
        if (sbp.home) {
          // clamp far homes to the radar rim so the direction still reads
          var rx = (sbp.x - px) * MAP_S, rz = (sbp.z - pz) * MAP_S;
          var rr = Math.sqrt(rx * rx + rz * rz);
          var lim = 78 / zoom;
          if (rr > lim) { rx = rx / rr * lim; rz = rz / rr * lim; }
          g.fillStyle = sbp.color;
          g.beginPath(); g.arc(rx, rz, 4.4 / zoom, 0, Math.PI * 2); g.fill();
          g.strokeStyle = '#ffffff'; g.lineWidth = 1.6 / zoom; g.stroke();
        } else {
          blip(sbp.x, sbp.z, sbp.color, 3.2 / zoom);
        }
      }
    }
    // active mission route (race checkpoints / current delivery stop)
    var mroute = catVis('objective') ? GAME.missions.getRoutePoints() : null;
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
    if (GAME.nav.dest && catVis('dest')) {
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
    for (var i = 0; i < mb.length; i++) {
      if (mb[i].kind && !catVis(mb[i].kind)) continue;
      blip(mb[i].x, mb[i].z, mb[i].color, mb[i].size);
    }
    // airport + helipad landmarks: a ringed cyan blip so they stand out on the radar
    function landmark(x, z) {
      var lx = (x - px) * MAP_S, lz = (z - pz) * MAP_S;
      g.fillStyle = '#8de0ff';
      g.beginPath(); g.arc(lx, lz, 3.4 / zoom, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#ffffff'; g.lineWidth = 1.2 / zoom;
      g.beginPath(); g.arc(lx, lz, 5.6 / zoom, 0, Math.PI * 2); g.stroke();
    }
    if (catVis('airport')) {
      landmark(GAME.city.airport.apron.x, GAME.city.airport.apron.z);
      landmark(GAME.city.helipad.x, GAME.city.helipad.z);
    }
    if (catVis('icecream') && GAME.city.islaPois) landmark(GAME.city.islaPois.factory.x, GAME.city.islaPois.factory.z);
    var cars = GAME.world.cars;
    for (var c = 0; c < cars.length; c++) {
      var pc = cars[c];
      // only actively-pursuing cruisers show as blips (not idle/parked ones)
      if (pc.isPolice && !pc.dead && pc.ai && (pc.ai.mode === 'chase' || pc.ai.mode === 'roadblock')) blip(pc.pos.x, pc.pos.z, '#5aa0ff', 3);
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
    if (GAME.frame % 10 === 0) { refreshControlsBar(); api.refreshFsBtn(); }
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
      var zf = GAME.focus();
      var zn = GAME.city.districtName(zf.x, zf.z);
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
      else if (!GAME.paused) GAME.audio.resume(); // don't leave the context suspended
      if (GAME.syncOverlayMusic) GAME.syncOverlayMusic();
      api.refreshFsBtn();
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
      if (!el['weapon-line']) return; // may fire before the HUD is wired up
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
    // the corner fullscreen control — available everywhere (menus, portrait
    // overlay and in-game) and hidden only once you're actually fullscreen.
    refreshFsBtn: function () {
      var e = $('fs-btn');
      if (!e) return;
      // always on hand until you're actually fullscreen, then it's redundant
      e.style.display = document.fullscreenElement ? 'none' : 'flex';
    },
    // AUTO runs the day/night cycle; DAY / NIGHT pin it
    refreshTimeBtn: function (mode) {
      var e = $('pause-day');
      if (!e) return;
      e.textContent = mode === 'day' ? '☀ TIME: DAY' : mode === 'night' ? '🌙 TIME: NIGHT' : '🕓 TIME: AUTO';
    },
    // names the POI you're near ('' hides it)
    setPoiHint: function (text) {
      var e = el['poi-hint'];
      if (!e) return;
      if (text) { if (e.textContent !== text) e.textContent = text; e.style.opacity = 1; }
      else e.style.opacity = 0;
    },
    showBig: function (kind, sub) {
      var scr = el[kind + '-screen'];
      scr.style.display = 'flex';
      scr.querySelector('.big-sub').textContent = sub || '';
      var hint = scr.querySelector('.big-hint');
      if (hint) hint.textContent = GAME.isTouch ? 'TAP TO CONTINUE' : 'PRESS R TO CONTINUE';
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
      api.refreshFsBtn();
    },
    setPaused: function (p) {
      el['pause-screen'].style.display = p ? 'flex' : 'none';
      var sj = $('pause-stunts');
      if (sj && GAME.stunts) {
        sj.textContent = 'STUNT JUMPS  ' + GAME.stunts.found + ' / ' + GAME.stunts.total +
          (GAME.stunts.complete ? '   ·   ALL FOUND' : '');
      }
      api.refreshFsBtn();
    },
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

  function key(n) { return n.id; }

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
    // route to the road nearest the destination, then a short hop off the road,
    // so the drawn line stays on the streets instead of cutting through blocks
    var rp = GAME.city.nearestRoadPoint(dest.x, dest.z);
    dest.rx = rp.x; dest.rz = rp.z;
    path = roadPath(px, pz, rp.x, rp.z);
    path.push({ x: rp.x, z: rp.z });
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
      // Arrived means near, not on top of. A map click often lands mid-block,
      // somewhere no road passes — so pulling up on the kerb beside it counts,
      // and a car counts from further out than a person walking the last bit.
      var R2 = P.inCar ? 26 * 26 : 12 * 12;
      var dNow = U.dist2(px, pz, dest.x, dest.z);
      var dRoad = dest.rx !== undefined ? U.dist2(px, pz, dest.rx, dest.rz) : 1e18;
      if (dNow < R2 || (dRoad < R2 && dNow < 55 * 55)) {
        dest = null; path = [];
        GAME.hud.message('You have arrived.', 2.5);
        GAME.audio.pickup();
      }
    }
  };
})();
