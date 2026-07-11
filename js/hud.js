GAME.hud = (function () {
  var el = {};
  var shownCash = 0, targetCash = 0;
  var msgT = 0, zoneT = 0, lastZone = '';
  var radioT = 0;
  var mapBuffer = null, MAP_S = 0.5, MAP_OX = 520, MAP_OY = 520;
  var dmgFlash = null;

  function $(id) { return document.getElementById(id); }

  function init() {
    ['minimap', 'cash', 'wanted-stars', 'health-fill', 'armor-fill', 'weapon-line', 'radio-popup', 'zone-popup',
      'msg-line', 'mission-hud', 'mission-title', 'mission-obj', 'mission-timer', 'title-screen', 'pause-screen',
      'wasted-screen', 'busted-screen', 'fade-layer', 'crt-layer', 'press-enter', 'title-best', 'pause-controls']
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
    el['title-screen'].addEventListener('touchend', function () { GAME.startGame(); });
  }

  function buildMapBuffer() {
    mapBuffer = document.createElement('canvas');
    mapBuffer.width = 700; mapBuffer.height = 520;
    var g = mapBuffer.getContext('2d');
    g.fillStyle = '#141020';
    g.fillRect(0, 0, 700, 520);
    function mx(x) { return (x + MAP_OX) * MAP_S; }
    function my(z) { return (z + MAP_OY) * MAP_S; }
    // sand + water
    g.fillStyle = '#3a3350';
    g.beginPath();
    g.moveTo(mx(365), my(-500));
    for (var z = -500; z <= 500; z += 25) g.lineTo(mx(GAME.city.shoreline(z)), my(z));
    g.lineTo(mx(365), my(500));
    g.closePath();
    g.fill();
    g.fillStyle = '#16305a';
    g.beginPath();
    g.moveTo(mx(880), my(-500));
    for (var z2 = -500; z2 <= 500; z2 += 25) g.lineTo(mx(GAME.city.shoreline(z2)), my(z2));
    g.moveTo(mx(880), my(-500));
    g.lineTo(mx(880), my(500));
    g.closePath();
    g.fill();
    g.fillRect(mx(500), my(-500), 700 - mx(500), 520);
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
    var H = GAME.city.pois.hospital;
    g.fillStyle = '#ff8aa8'; g.fillRect(mx(H.x) - 3, my(H.z) - 3, 6, 6);
    var PD = GAME.city.pois.police;
    g.fillStyle = '#5aa0ff'; g.fillRect(mx(PD.x) - 3, my(PD.z) - 3, 6, 6);
  }

  function drawMinimap() {
    var cv = el.minimap, g = cv.getContext('2d');
    var P = GAME.player;
    var px = P.inCar && P.car ? P.car.pos.x : P.pos.x;
    var pz = P.inCar && P.car ? P.car.pos.z : P.pos.z;
    g.clearRect(0, 0, 180, 180);
    var zoom = P.inCar ? 0.62 : 0.85;
    g.save();
    g.translate(90, 90);
    g.scale(zoom, zoom);
    g.drawImage(mapBuffer, -(px + MAP_OX) * MAP_S, -(pz + MAP_OY) * MAP_S);
    // blips
    function blip(x, z, color, size) {
      g.fillStyle = color;
      g.beginPath();
      g.arc((x - px) * MAP_S, (z - pz) * MAP_S, size, 0, Math.PI * 2);
      g.fill();
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
    // player arrow (rotates with heading)
    var h = P.inCar && P.car ? P.car.heading : P.heading;
    g.save();
    g.translate(90, 90);
    g.rotate(Math.atan2(Math.sin(h), Math.cos(h)) * -1 + Math.PI);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#ff4fa3';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, 6); g.lineTo(4.5, -5); g.lineTo(0, -2); g.lineTo(-4.5, -5);
    g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  function updateCashText() {
    el.cash.textContent = '$' + Math.floor(shownCash);
  }

  function update(dt) {
    if (!mapBuffer) return;
    if (GAME.frame % 3 === 0) drawMinimap();
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

  return {
    init: init,
    update: update,
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
    hideTitle: function () { el['title-screen'].style.display = 'none'; },
    setPaused: function (p) { el['pause-screen'].style.display = p ? 'flex' : 'none'; },
    toggleCRT: function () {
      var on = el['crt-layer'].style.display !== 'block';
      el['crt-layer'].style.display = on ? 'block' : 'none';
      return on;
    }
  };
})();
