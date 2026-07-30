// Places that take your money. Jobs, fares and rampages pour cash in; this is
// where it goes back out — a gun counter, a tailor, a barber, property with
// your name on it, a showroom, the desk sergeant's open palm and a crooked
// wheel on the pier. Every shop is a walk-in: stand on the glowing doormat and
// the counter opens. The world freezes while you browse, the way the map does.
GAME.shops = (function () {
  var el = {}, openShop = null, sel = 0, locations = [], markerMesh = null, markerData = [];
  var leftSince = {};   // reopen only after you step off the mat

  // ---------- wardrobe ----------
  var SHIRTS = [
    { id: 'white', name: 'Club White', hex: 0xf0f0f8 },
    { id: 'flamingo', name: 'Flamingo Pink', hex: 0xf78ab8 },
    { id: 'mint', name: 'Mint Breeze', hex: 0x9fe8d8 },
    { id: 'banana', name: 'Banana Cream', hex: 0xf9d99a },
    { id: 'skyline', name: 'Skyline Blue', hex: 0x8fd0f0 },
    { id: 'violet', name: 'Violet Hour', hex: 0x8a6ae8 },
    { id: 'ember', name: 'Ember Red', hex: 0xe86a5a },
    { id: 'noir', name: 'Midnight Noir', hex: 0x23242e }
  ];
  var PANTS = [
    { id: 'teal', name: 'Teal Classics', hex: 0x38b8c8 },
    { id: 'navy', name: 'Navy Slacks', hex: 0x3a4a68 },
    { id: 'sand', name: 'Sand Chinos', hex: 0xd8c8a8 },
    { id: 'brick', name: 'Brick Cords', hex: 0x8a4a4a },
    { id: 'charcoal', name: 'Charcoal', hex: 0x2a2a34 },
    { id: 'lilac', name: 'Lilac Flares', hex: 0xb090d8 }
  ];
  var HAIRSTYLES = [
    { id: 'crew', name: 'Crew Cut' },
    { id: 'flat', name: 'Flattop' },
    { id: 'mohawk', name: 'Mohawk' },
    { id: 'buzz', name: 'Shaved (back to bald)' }
  ];
  var HAIRCOLORS = [
    { id: 'black', name: 'Black', hex: 0x1c1a18 },
    { id: 'brown', name: 'Brown', hex: 0x5a3c22 },
    { id: 'blond', name: 'Blond', hex: 0xd8b86a },
    { id: 'red', name: 'Copper Red', hex: 0xa8482a },
    { id: 'pink', name: 'Hot Pink', hex: 0xf050a0 },
    { id: 'cyan', name: 'Electric Cyan', hex: 0x38c8e8 }
  ];

  function outfit() {
    GAME.prefs = GAME.prefs || {};
    if (!GAME.prefs.outfit) GAME.prefs.outfit = { shirt: 'white', pants: 'teal', hairStyle: 'crew', hairColor: 'black' };
    return GAME.prefs.outfit;
  }
  function byId(list, id, fallback) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[fallback || 0];
  }

  // the player's look, rebuilt from the saved outfit — called at boot and
  // after every purchase in the changing room
  function applyOutfit() {
    var P = GAME.player, o = outfit();
    if (!P.mesh) return;
    var j = P.mesh.userData.joints;
    j.torso.material.color.setHex(byId(SHIRTS, o.shirt).hex);
    j.legL.children[0].material.color.setHex(byId(PANTS, o.pants).hex);
    // hair rides the head so aiming poses carry it
    if (P.hairMesh) { P.hairMesh.parent.remove(P.hairMesh); disposeTree(P.hairMesh); P.hairMesh = null; }
    var hair = GAME.peds.makeHair(o.hairStyle, byId(HAIRCOLORS, o.hairColor).hex);
    if (hair) {
      // the head sits at y=1.6 in the body group; makeHair builds around origin
      hair.position.y = 1.6;
      P.mesh.add(hair);
      P.hairMesh = hair;
    }
  }

  // ---------- safehouses ----------
  var SAFEHOUSES = [
    { id: 'dock', name: 'DOCKSIDE FLAT', price: 6000, at: { x: -404, z: 64 }, tag: 'A cot over the harbor. It counts.' },
    { id: 'condo', name: 'STRIP CONDO', price: 18000, at: { x: 361, z: 208 }, tag: 'Neon out every window.' },
    { id: 'villa', name: 'MARINA VILLA', price: 45000, at: null, isla: true, tag: 'The good life, across the channel.' }
  ];
  function ownedList() {
    GAME.prefs = GAME.prefs || {};
    if (!GAME.prefs.safehouses) GAME.prefs.safehouses = [];
    return GAME.prefs.safehouses;
  }
  function owns(id) { return ownedList().indexOf(id) >= 0; }
  function ownsAny() {
    var unlocked = !GAME.isla || GAME.isla.isOpen();
    for (var i = 0; i < SAFEHOUSES.length; i++) {
      if (owns(SAFEHOUSES[i].id) && (!SAFEHOUSES[i].isla || unlocked)) return true;
    }
    return false;
  }
  // where you wake up when you own property: the nearest bed that is actually
  // reachable (nothing behind a locked bridge)
  function homeSpawn(x, z) {
    var unlocked = !GAME.isla || GAME.isla.isOpen();
    var best = null, bd = 1e18;
    for (var i = 0; i < SAFEHOUSES.length; i++) {
      var s = SAFEHOUSES[i];
      if (!owns(s.id) || !s.at) continue;
      if (s.isla && !unlocked) continue;
      var d = U.dist2(x, z, s.at.x, s.at.z);
      if (d < bd) { bd = d; best = { x: s.at.x, z: s.at.z, name: s.name }; }
    }
    return best;
  }

  // ---------- placement ----------
  // nudge a doormat off roads, water, ramps and out of walls — the same spiral
  // hunt the island uses for its POIs
  function clearSpot(x, z) {
    for (var ring = 0; ring < 9; ring++) {
      for (var a = 0; a < 8; a++) {
        var px = x + Math.cos(a / 8 * Math.PI * 2) * ring * 3;
        var pz = z + Math.sin(a / 8 * Math.PI * 2) * ring * 3;
        if (GAME.city.isInWater(px, pz) && !GAME.city.isOnPier(px, pz)) continue;
        if (GAME.city.inAirport(px, pz)) continue;
        if (GAME.city.nearCrossing && GAME.city.nearCrossing(px, pz, 12)) continue;
        if (GAME.city.rampAt(px, pz)) continue;
        var rp = GAME.city.nearestRoadPoint(px, pz);
        if (U.dist2(px, pz, rp.x, rp.z) < 9.5 * 9.5) continue;
        var boxes = GAME.city.hash.query(px, pz, 2.5), hit = false;
        for (var b = 0; b < boxes.length; b++) {
          var q = boxes[b];
          if (px > q.minX - 1.6 && px < q.maxX + 1.6 && pz > q.minZ - 1.6 && pz < q.maxZ + 1.6) { hit = true; break; }
        }
        if (!hit) return { x: px, z: pz };
      }
    }
    return { x: x, z: z };
  }

  // ---------- catalogue ----------
  function hardwareItems() {
    var P = GAME.player;
    function gun(id, name, price, ammo, ds) {
      var have = P.weapons[id] && P.weapons[id].have;
      return { id: id, name: name + (have ? '  ·  ammo +' + ammo : ''), ds: ds, price: price };
    }
    return [
      gun('pistol', 'PISTOL', 400, 40, 'Reliable. Forty rounds in the box.'),
      gun('smg', 'SMG', 2500, 120, 'Spray-friendly, drive-by approved.'),
      gun('shotgun', 'SHOTGUN', 1500, 24, 'Ends conversations at close range.'),
      gun('rifle', 'RIFLE', 5000, 30, 'The observatory special, over the counter.'),
      { id: 'armor', name: 'BODY ARMOR', ds: 'Takes the hits so you don’t.', price: 800, off: P.armor >= 100 },
      { id: 'medkit', name: 'FIRST-AID KIT', ds: 'Patches you back to full.', price: 150, off: P.health >= 100 }
    ];
  }
  function dressItems() {
    var o = outfit(), rows = [];
    SHIRTS.forEach(function (s) {
      rows.push({ id: 'shirt_' + s.id, name: 'SHIRT · ' + s.name, price: 150, sw: s.hex, owned: o.shirt === s.id, ds: o.shirt === s.id ? 'Wearing it now.' : '' });
    });
    PANTS.forEach(function (s) {
      rows.push({ id: 'pants_' + s.id, name: 'PANTS · ' + s.name, price: 150, sw: s.hex, owned: o.pants === s.id, ds: o.pants === s.id ? 'Wearing them now.' : '' });
    });
    return rows;
  }
  function barberItems() {
    var o = outfit(), rows = [];
    HAIRSTYLES.forEach(function (s) {
      rows.push({ id: 'style_' + s.id, name: 'CUT · ' + s.name, price: 150, owned: o.hairStyle === s.id, ds: o.hairStyle === s.id ? 'Your current cut.' : '' });
    });
    HAIRCOLORS.forEach(function (s) {
      rows.push({ id: 'color_' + s.id, name: 'COLOR · ' + s.name, price: 100, sw: s.hex, owned: o.hairColor === s.id, ds: o.hairColor === s.id ? 'Your current color.' : '' });
    });
    return rows;
  }
  function safehouseItems(loc) {
    var s = loc.sh;
    if (owns(s.id)) {
      return [{ id: 'rest', name: 'REST', ds: 'Your place. Sleep it off — health restored.', price: 0 }];
    }
    return [{ id: 'buy', name: 'BUY ' + s.name, ds: s.tag + '  You’ll wake up here, gear intact.', price: s.price }];
  }
  function showroomItems() {
    var islaOpen = !GAME.isla || GAME.isla.isOpen();
    return [
      { id: 'motorcycle', name: 'NEON STREAK', ds: 'The bike. Fast, loud, unwise.', price: 4000 },
      { id: 'buggy', name: 'DUNE BUGGY', ds: 'Made for sand and bad decisions.', price: 9000 },
      { id: 'limo', name: 'STRETCH LIMO', ds: 'Arrive like you own the strip.', price: 18000 },
      { id: 'monster', name: 'SLEDGEHAMMER', ds: 'The monster truck, no stunt jumps required.', price: 35000 },
      { id: 'helicopter', name: 'PELICANO', ds: islaOpen ? 'Your own bird, delivered outside.' : 'Import license pending — open the bridges first.', price: 60000, off: !islaOpen }
    ];
  }
  function bribeItems() {
    var w = GAME.police.wanted;
    return [
      { id: 'star', name: 'LOSE ONE STAR', ds: w > 0 ? 'The sergeant looks away.' : 'You’re clean already.', price: 300, off: w <= 0 },
      { id: 'slate', name: 'CLEAN SLATE', ds: w > 0 ? 'All ' + w + ' star' + (w > 1 ? 's' : '') + ', forgotten.' : 'Nothing on the books.', price: 300 * Math.max(1, w), off: w <= 0 }
    ];
  }
  function casinoItems() {
    return [
      { id: 'bet100', name: 'SPIN THE WHEEL · $100', ds: 'Mostly it eats your money. Mostly.', price: 100 },
      { id: 'bet500', name: 'SPIN THE WHEEL · $500', ds: 'Now it’s interesting.', price: 500 },
      { id: 'bet2000', name: 'SPIN THE WHEEL · $2,000', ds: 'The gull always wins. Probably.', price: 2000 }
    ];
  }

  // ---------- buying ----------
  function buyHardware(id) {
    var P = GAME.player;
    if (id === 'armor') { P.armor = 100; note('Strapped in.'); }
    else if (id === 'medkit') { P.health = 100; note('Good as new.'); }
    else {
      var packs = { pistol: 40, smg: 120, shotgun: 24, rifle: 30 };
      GAME.combat.giveWeapon(id, packs[id]);
      note('Bagged, no questions asked.');
    }
    GAME.combat.refreshWeaponHud();
  }
  function buyDress(id) {
    var o = outfit();
    if (id.indexOf('shirt_') === 0) o.shirt = id.slice(6);
    else o.pants = id.slice(6);
    applyOutfit(); GAME.save();
    note('Looking sharp.');
  }
  function buyBarber(id) {
    var o = outfit();
    if (id.indexOf('style_') === 0) o.hairStyle = id.slice(6);
    else o.hairColor = id.slice(6);
    applyOutfit(); GAME.save();
    note(o.hairStyle === 'buzz' ? 'Clean down to the skin.' : 'Fresh off the chair.');
  }
  function buySafehouse(loc, id) {
    var P = GAME.player;
    if (id === 'rest') { P.health = 100; note('You slept like 1986 would never end.'); return; }
    ownedList().push(loc.sh.id);
    GAME.save();
    GAME.track('safehouse-bought');
    note('The keys are yours.');
    GAME.hud.message(loc.sh.name + ' is yours — you’ll wake up here from now on, weapons and all.', 5);
    GAME.share.show({
      slug: 'safehouse-' + loc.sh.id,
      eyebrow: 'COSTA ROSA · 1986',
      title: 'HOME SWEET HOME',
      subtitle: loc.sh.name + ' — bought with honest-ish money',
      accent: '#8de8b0',
      stats: [{ label: 'Property', value: loc.sh.name.split(' ')[0] },
        { label: 'Paid', value: '$' + loc.sh.price.toLocaleString() },
        { label: 'Perk', value: 'GEAR KEPT' }]
    });
  }
  function buyShowroom(loc, id) {
    var at = loc.forecourt;
    var spot = clearSpot(at.x, at.z);
    var car = GAME.vehicles.spawnCar(id, spot.x, spot.z, loc.heading || 0, {});
    if (id === 'monster') GAME.city.unlockMonsterTruck();
    GAME.track('showroom-' + id);
    note('Keys in the ignition, right outside.');
    GAME.hud.message('Delivered to the forecourt. Try not to scratch it immediately.', 4);
    return car;
  }
  function buyBribe(id) {
    var w = GAME.police.wanted;
    if (id === 'star') GAME.police.setWanted(Math.max(0, w - 1));
    else GAME.police.clearWanted();
    GAME.track('bribe-paid');
    note(GAME.police.wanted > 0 ? 'One star quietly shredded.' : 'The file is empty. What file?');
  }
  function spinWheel(bet) {
    var r = Math.random(), mult, label;
    if (r < 0.60) { mult = 0; label = 'THE GULL EATS IT.'; }
    else if (r < 0.85) { mult = 1.5; label = 'SMALL WIN!'; }
    else if (r < 0.95) { mult = 3; label = 'TRIPLE!'; }
    else { mult = 5; label = 'JACKPOT!'; }
    var win = Math.round(bet * mult);
    if (win > 0) { GAME.addCash(win); GAME.audio.sting('win'); }
    else GAME.audio.crash(0.2);
    GAME.track(win > 0 ? 'casino-win' : 'casino-loss');
    note(label + (win > 0 ? '  +$' + win.toLocaleString() : '') + '  (stake included)');
  }

  // ---------- shop registry ----------
  function buildLocations() {
    var stations = GAME.city.pois.stations || [];
    locations = [
      { id: 'hardware0', kind: 'hardware', name: 'ROSA HARDWARE', tag: 'Tools for loud problems', at: clearSpot(361, -64), color: 0xffd24a },
      { id: 'dress0', kind: 'dress', name: 'THREADS', tag: 'The changing room is that way', at: clearSpot(361, 92), color: 0xff8fd0 },
      { id: 'barber0', kind: 'barber', name: 'CORTES CUTS', tag: 'Walk-ins welcome', at: clearSpot(361, -120), color: 0x8fd0ff },
      { id: 'showroom0', kind: 'showroom', name: 'GRAN ROSA MOTORS', tag: 'Special orders, delivered outside', at: clearSpot(-160, 378), forecourt: { x: -176, z: 386 }, heading: Math.PI / 2, color: 0x8dffd8 },
      { id: 'casino0', kind: 'casino', name: 'THE LUCKY GULL', tag: 'A wheel, a bird, your wallet', at: clearSpot(448, 250), color: 0xffe14f }
    ];
    // a bribe desk at every station, both sides of the channel
    stations.forEach(function (st, i) {
      locations.push({
        id: 'bribe' + i, kind: 'bribe', name: 'DESK SERGEANT', tag: 'Certain paperwork can be lost',
        at: clearSpot(st.spawn.x + 10, st.spawn.z + 6), isla: !!st.isla, color: 0x4da3ff
      });
    });
    // property: the island villa anchors to the marina once the island exists
    SAFEHOUSES.forEach(function (s) {
      if (!s.at && s.isla && GAME.isla) {
        var M = GAME.isla.pois().marina;
        s.at = clearSpot(M.x - 22, M.z + 26);
      } else if (s.at) {
        s.at = clearSpot(s.at.x, s.at.z);
      }
      if (s.at) locations.push({
        id: 'home_' + s.id, kind: 'safehouse', name: s.name, tag: owns(s.id) ? 'Yours' : 'For sale',
        at: s.at, sh: s, isla: !!s.isla, color: 0x8de8b0
      });
    });
    // hardware over the channel too, by the ice cream factory gates
    if (GAME.isla) {
      var F = GAME.isla.pois().factory;
      locations.push({ id: 'hardware1', kind: 'hardware', name: 'VERDE HARDWARE', tag: 'Tools for loud problems', at: clearSpot(F.x - 34, F.z - 26), isla: true, color: 0xffd24a });
    }
  }

  // one instanced-ish batch of glowing doormats, pulsing in update()
  function buildMarkers(scene) {
    var g = new THREE.Group();
    locations.forEach(function (loc) {
      var y = GAME.city.groundY(loc.at.x, loc.at.z);
      var ring = new THREE.Mesh(
        new THREE.CylinderGeometry(2.2, 2.2, 0.18, 18, 1, true),
        new THREE.MeshBasicMaterial({ color: loc.color, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
      );
      ring.position.set(loc.at.x, y + 0.35, loc.at.z);
      g.add(ring);
      var post = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 2.6, 0.5),
        new THREE.MeshBasicMaterial({ color: loc.color, transparent: true, opacity: 0.5 })
      );
      post.position.set(loc.at.x, y + 1.5, loc.at.z);
      g.add(post);
      markerData.push({ ring: ring, post: post, loc: loc, y: y });
    });
    scene.add(g);
    markerMesh = g;
  }

  // ---------- the counter (DOM) ----------
  function $(id) { return document.getElementById(id); }
  function note(t) { if (el.note) el.note.textContent = t || ''; }
  function items(loc) {
    switch (loc.kind) {
      case 'hardware': return hardwareItems();
      case 'dress': return dressItems();
      case 'barber': return barberItems();
      case 'safehouse': return safehouseItems(loc);
      case 'showroom': return showroomItems();
      case 'bribe': return bribeItems();
      case 'casino': return casinoItems();
    }
    return [];
  }
  function render() {
    if (!openShop) return;
    var P = GAME.player, list = items(openShop);
    el.title.textContent = openShop.name;
    el.tag.textContent = openShop.tag || '';
    el.cash.textContent = '$' + P.cash.toLocaleString();
    el.items.innerHTML = '';
    sel = Math.max(0, Math.min(sel, list.length - 1));
    list.forEach(function (it, i) {
      var row = document.createElement('div');
      var afford = P.cash >= it.price;
      row.className = 'shop-row' + (i === sel ? ' sel' : '') + ((it.off || !afford) && !it.owned ? ' off' : '') + (it.owned ? ' owned' : '');
      var sw = it.sw !== undefined ? '<span class="sw" style="background:#' + it.sw.toString(16).padStart(6, '0') + '"></span>' : '';
      row.innerHTML = '<div><div class="nm">' + sw + it.name + '</div>' + (it.ds ? '<div class="ds">' + it.ds + '</div>' : '') + '</div>' +
        '<div class="pr">' + (it.owned ? 'YOURS' : it.price > 0 ? '$' + it.price.toLocaleString() : 'FREE') + '</div>';
      row.addEventListener('click', function () { sel = i; buy(it.id); });
      el.items.appendChild(row);
    });
  }
  function buy(id) {
    if (!openShop) return false;
    var list = items(openShop), it = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { it = list[i]; break; }
    if (!it || it.owned || it.off) { render(); return false; }
    var P = GAME.player;
    if (P.cash < it.price) { note('You’re $' + (it.price - P.cash).toLocaleString() + ' short.'); GAME.audio.crash(0.12); return false; }
    GAME.addCash(-it.price);
    switch (openShop.kind) {
      case 'hardware': buyHardware(id); break;
      case 'dress': buyDress(id); break;
      case 'barber': buyBarber(id); break;
      case 'safehouse': buySafehouse(openShop, id); break;
      case 'showroom': buyShowroom(openShop, id); break;
      case 'bribe': buyBribe(id); break;
      case 'casino': spinWheel(it.price); break;
    }
    if (openShop) render();   // a purchase can close the shop (share card) — guard
    GAME.audio.pickup();
    return true;
  }
  function open(idOrLoc) {
    var loc = typeof idOrLoc === 'string' ? locations.filter(function (l) { return l.id === idOrLoc; })[0] : idOrLoc;
    if (!loc || openShop) return false;
    openShop = loc;
    sel = 0;
    note('');
    el.screen.style.display = 'flex';
    GAME.shopOpen = true;
    if (document.exitPointerLock) document.exitPointerLock();
    if (GAME.syncOverlayMusic) GAME.syncOverlayMusic();
    GAME.audio.engineState(false, 0); GAME.audio.skid(0); GAME.audio.siren(0);
    render();
    GAME.track('shop-open-' + loc.kind);
    return true;
  }
  function close() {
    if (!openShop) return;
    leftSince[openShop.id] = false;   // must step off the mat before it reopens
    openShop = null;
    el.screen.style.display = 'none';
    GAME.shopOpen = false;
    if (GAME.syncOverlayMusic) GAME.syncOverlayMusic();
  }

  function onKey(e) {
    if (!GAME.shopOpen || !openShop) return;
    var list = items(openShop);
    if (e.code === 'KeyS' || e.code === 'ArrowDown') { sel = (sel + 1) % list.length; render(); }
    else if (e.code === 'KeyW' || e.code === 'ArrowUp') { sel = (sel - 1 + list.length) % list.length; render(); }
    else if (e.code === 'Enter' || e.code === 'KeyE') { if (list[sel]) buy(list[sel].id); }
  }

  function init(scene) {
    ['shop-screen', 'shop-title', 'shop-tag', 'shop-cash', 'shop-items', 'shop-note', 'shop-close']
      .forEach(function (id) { el[id.replace('shop-', '')] = $(id); });
    if (el.close) el.close.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    buildLocations();
    buildMarkers(scene);
    applyOutfit();
  }

  // walk-in check + marker pulse; the hint line is served to missions.js so it
  // shares the one POI readout instead of fighting over it
  function update(dt) {
    var P = GAME.player;
    for (var i = 0; i < markerData.length; i++) {
      var m = markerData[i];
      var pulse = 0.55 + 0.3 * Math.sin(GAME.time * 3 + i);
      m.ring.material.opacity = pulse;
      m.ring.rotation.y += dt * 0.8;
      // owned property mats calm down to a steady glow
      if (m.loc.kind === 'safehouse' && owns(m.loc.sh.id)) m.ring.material.opacity = 0.35;
    }
    if (GAME.shopOpen || !GAME.started || P.state !== 'alive') return;
    var unlocked = !GAME.isla || GAME.isla.isOpen();
    for (var k = 0; k < locations.length; k++) {
      var loc = locations[k];
      if (loc.isla && !unlocked) continue;
      var d2 = U.dist2(P.pos.x, P.pos.z, loc.at.x, loc.at.z);
      if (d2 > 5.5 * 5.5) { leftSince[loc.id] = true; continue; }
      if (P.inCar || d2 > 2.6 * 2.6) continue;
      if (leftSince[loc.id] === false) continue;   // still standing where it closed
      open(loc);
      return;
    }
  }

  // the nearest doormat's label for the shared POI hint line
  function nearHint(px, pz) {
    var unlocked = !GAME.isla || GAME.isla.isOpen();
    var best = null;
    for (var i = 0; i < locations.length; i++) {
      var loc = locations[i];
      if (loc.isla && !unlocked) continue;
      var d = U.dist2(px, pz, loc.at.x, loc.at.z);
      if (d < 30 * 30 && (!best || d < best.d)) {
        var extra = loc.kind === 'safehouse' && !owns(loc.sh.id) ? ' · $' + loc.sh.price.toLocaleString() : '';
        best = { d: d, text: loc.name + extra + ' — step onto the light' + (GAME.player.inCar ? ' (on foot)' : '') };
      }
    }
    return best;
  }

  function blips() {
    var out = [];
    for (var i = 0; i < locations.length; i++) {
      var loc = locations[i];
      out.push({
        x: loc.at.x, z: loc.at.z,
        color: '#' + loc.color.toString(16).padStart(6, '0'),
        label: loc.kind === 'safehouse' ? (owns(loc.sh.id) ? 'H' : '$') : '$'
      });
    }
    return out;
  }

  return {
    init: init, update: update, open: open, close: close, buy: buy,
    nearHint: nearHint, blips: blips, applyOutfit: applyOutfit,
    homeSpawn: homeSpawn, ownsAny: ownsAny, owns: owns,
    get isOpen() { return !!openShop; },
    get current() { return openShop; },
    locations: function () { return locations; },
    wardrobe: { SHIRTS: SHIRTS, PANTS: PANTS, HAIRSTYLES: HAIRSTYLES, HAIRCOLORS: HAIRCOLORS }
  };
})();
