// Places that take your money. Jobs, fares and rampages pour cash in; this is
// where it goes back out — a gun counter, a tailor, a barber, property with
// your name on it, a showroom, the desk sergeant's open palm and a crooked
// wheel on the pier. Every shop is a walk-in: stand on the glowing doormat and
// the counter opens. The world freezes while you browse, the way the map does.
GAME.shops = (function () {
  var el = {}, openShop = null, sel = 0, pendingBuy = null, locations = [], markerMesh = null, markerData = [];
  var leftSince = {};   // reopen only after you step off the mat
  var spinProps = [];   // slow turntables: the showroom's display car, etc.

  // sign-atlas slots for the storefront names — indexes into city.js SIGN_TEXTS,
  // which appends these nine in this exact order after 'ISLA ROSA' (slot 33)
  var SIGN_SLOT = {
    hardware0: 34, hardware1: 35, dress0: 36, barber0: 37,
    showroom0: 38, casino0: 39, home_dock: 40, home_condo: 41, home_villa: 42
  };

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
    { id: 'flattop', name: 'Flattop' },
    { id: 'pompadour', name: 'Pompadour' },
    { id: 'mullet', name: 'Mullet' },
    { id: 'afro', name: 'Afro' },
    { id: 'ponytail', name: 'Ponytail' },
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

  // the same skin palette the crowd draws from — but the player's tone is
  // rolled once and saved, so "you" look like you every session, and the
  // changing-room mannequin can be an honest mirror
  var SKINS = [0xeac8a8, 0xc89878, 0x8a6848, 0x6a4c34, 0xf0d8c0];
  function outfit() {
    GAME.prefs = GAME.prefs || {};
    if (!GAME.prefs.outfit) GAME.prefs.outfit = { shirt: 'white', pants: 'teal', hairStyle: 'crew', hairColor: 'black' };
    if (!GAME.prefs.outfit.skin) {
      GAME.prefs.outfit.skin = SKINS[Math.floor(Math.random() * SKINS.length)];
      GAME.save();
    }
    if (GAME.prefs.outfit.hairStyle === 'flat') GAME.prefs.outfit.hairStyle = 'flattop'; // old save id
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
    j.head.material.color.setHex(o.skin);
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
    { id: 'condo', name: 'STRIP CONDO', price: 18000, at: { x: 337, z: 208 }, tag: 'Neon out every window.' },
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
    // cuts first, then dye — and the dye rows say HAIR COLOR out loud, because
    // an unlabeled color swatch next to a head reads as something it isn't
    var o = outfit(), rows = [];
    HAIRSTYLES.forEach(function (s) {
      rows.push({ id: 'style_' + s.id, name: 'CUT · ' + s.name, price: 150, owned: o.hairStyle === s.id, ds: o.hairStyle === s.id ? 'Your current cut.' : '' });
    });
    HAIRCOLORS.forEach(function (s) {
      rows.push({ id: 'color_' + s.id, name: 'HAIR COLOR · ' + s.name, price: 100, sw: s.hex, owned: o.hairColor === s.id, ds: o.hairColor === s.id ? 'Your current color.' : '' });
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
    function row(id, name, ds, price, off) {
      var inGarage = garage().indexOf(id) >= 0;
      return { id: id, name: name, price: price, off: off,
        owned: inGarage, ds: inGarage ? 'In your garage — a fresh one always waits at home.' : ds };
    }
    return [
      row('motorcycle', 'NEON STREAK', 'The bike. Fast, loud, unwise.', 4000),
      row('superbike', 'CORMORÁN GT', 'Showroom exclusive. Nobody else rides one.', 20000),
      row('buggy', 'DUNE BUGGY', 'Made for sand and bad decisions.', 9000),
      row('limo', 'STRETCH LIMO', 'Arrive like you own the strip.', 18000),
      row('monster', 'SLEDGEHAMMER', 'The monster truck, no stunt jumps required.', 35000),
      row('helicopter', 'PELICANO', islaOpen ? 'Your own bird, delivered outside.' : 'Import license pending — open the bridges first.', 60000, !islaOpen)
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
    refreshGarageSpots();   // the fleet moves home with you
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
  // ---------- the garage ----------
  // A deed, not a rental: every vehicle you buy is registered to a parking
  // spot at your best property (or the showroom forecourt while you rent).
  // The parked-vehicle spawner already guarantees specials at their spot, so
  // wreck it, sink it or leave it across the channel — a fresh one is waiting
  // at home. The registry persists; the spots are rebuilt every boot.
  var garageSpots = {};   // type -> the live parkedSpot object
  function garage() {
    GAME.prefs = GAME.prefs || {};
    if (!GAME.prefs.garage) GAME.prefs.garage = [];
    return GAME.prefs.garage;
  }
  function homeBase() {
    // the priciest property you own is home; the forecourt is the fallback
    var unlocked = !GAME.isla || GAME.isla.isOpen();
    var best = null;
    for (var i = 0; i < SAFEHOUSES.length; i++) {
      var s = SAFEHOUSES[i];
      if (!owns(s.id) || !s.at) continue;
      if (s.isla && !unlocked) continue;
      if (!best || s.price > best.price) best = s;
    }
    if (best) return { x: best.at.x, z: best.at.z, heading: 0 };
    var sr = locations.filter(function (l) { return l.kind === 'showroom'; })[0];
    return sr ? { x: sr.forecourt.x, z: sr.forecourt.z, heading: sr.heading || 0 } : { x: 0, z: 0, heading: 0 };
  }
  function refreshGarageSpots() {
    var base = homeBase();
    garage().forEach(function (type, i) {
      var s = clearSpot(base.x + 6 + (i % 3) * 5, base.z + 6 + Math.floor(i / 3) * 6);
      var g = garageSpots[type];
      if (!g) {
        g = { x: s.x, z: s.z, heading: base.heading, vtype: type, owned: true };
        garageSpots[type] = g;
        GAME.city.parkedSpots.push(g);
      } else {
        g.x = s.x; g.z = s.z; g.heading = base.heading;
      }
    });
  }

  function buyShowroom(loc, id) {
    var at = loc.forecourt;
    var spot = clearSpot(at.x, at.z);
    var car = GAME.vehicles.spawnCar(id, spot.x, spot.z, loc.heading || 0, {});
    if (id === 'monster') GAME.city.unlockMonsterTruck();
    if (garage().indexOf(id) < 0) garage().push(id);
    GAME.save();
    refreshGarageSpots();
    GAME.fx.flash(spot.x, 1.5, spot.z, 5);
    GAME.audio.sting('win');
    GAME.track('showroom-' + id);
    var spec = GAME.vehicles.TYPES[id];
    note('Keys in the ignition, right outside.');
    GAME.hud.message('Delivered to the forecourt — and registered to your garage: lose it and a fresh one waits at ' +
      (ownsAny() ? 'your place' : 'the showroom') + '.', 5);
    GAME.share.show({
      slug: 'bought-' + id,
      eyebrow: 'GRAN ROSA MOTORS · 1986',
      title: (spec ? spec.label.toUpperCase() : id.toUpperCase()),
      subtitle: 'Bought outright, registered to your garage',
      accent: '#8dffd8',
      stats: [{ label: 'Paid', value: '$' + (items(loc).filter(function (r) { return r.id === id; })[0] || { price: 0 }).price.toLocaleString() },
        { label: 'Plate', value: 'ROSA-' + String(garage().length).padStart(2, '0') },
        { label: 'Kept at', value: ownsAny() ? 'HOME' : 'SHOWROOM' }]
    });
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
      // the strip shops live IN the western building row, facing the strip —
      // reserved slots in city.js keep those footprints clear, so the shops
      // replace nameless blocks instead of squatting on the beach footpath
      { id: 'hardware0', kind: 'hardware', name: 'ROSA HARDWARE', tag: 'Tools for loud problems', at: clearSpot(337, -64), color: 0xffd24a },
      { id: 'dress0', kind: 'dress', name: 'THREADS', tag: 'The changing room is that way', at: clearSpot(337, 92), color: 0xff8fd0 },
      { id: 'barber0', kind: 'barber', name: 'CORTES CUTS', tag: 'Walk-ins welcome', at: clearSpot(337, -120), color: 0x8fd0ff },
      // the dealership sits on the southern arterial with room for a glass
      // hall and a forecourt — it used to squat at the airport's entry gate
      { id: 'showroom0', kind: 'showroom', name: 'GRAN ROSA MOTORS', tag: 'Special orders, delivered outside', at: clearSpot(90, 378), forecourt: { x: 64, z: 384 }, heading: Math.PI / 2, color: 0x8dffd8 },
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

  // ---------- storefronts ----------
  // Every shop is a real building: the doormat sits at its door and the name
  // is up in lights on the face. The door always looks toward the road the
  // mat was placed off of, and the whole footprint is vetted against solids,
  // roads, water and ramps — with sideways nudges before giving up.
  function buildShopfronts(scene) {
    // Each trade gets its own building, sized and dressed for what it sells —
    // not one grey hut with different labels. Walls are tinted per kind so the
    // row of shops reads at a glance against the city's plain blocks.
    var SIZES = {
      hardware: { w: 14, d: 9, h: 6, wall: 0xd8a25a },
      dress: { w: 13, d: 8, h: 5.5, wall: 0xf0c8dc },
      barber: { w: 10, d: 7, h: 5, wall: 0xbcd8f0 },
      showroom: { w: 26, d: 15, h: 7.5, wall: 0x3c4258 },
      casino: { w: 9, d: 8, h: 5.5, wall: 0xe8c86a },
      safehouse: { w: 10, d: 8, h: 9, wall: 0xc8bca8 }
    };
    var walls = new GeoBatch();      // window-textured shells
    var trims = new GeoBatch();      // doors, awnings, roof lips (unlit color)
    var signs = new GeoBatch();
    // ramps were placed before the shops existed, and their placement vetted
    // an empty air corridor past the lip — don't build a wall into it now
    function corridorClear(cx, cz, sx, sz) {
      var ramps = GAME.city.ramps || [];
      var half = Math.max(sx, sz) / 2;
      for (var i = 0; i < ramps.length; i++) {
        var r = ramps[i];
        var ux = Math.sin(r.rot), uz = Math.cos(r.rot);
        var lx = r.x + ux * r.len / 2, lz = r.z + uz * r.len / 2;
        var L = r.boost ? 260 : 90;
        var t = ((cx - lx) * ux + (cz - lz) * uz) / L;
        if (t < -0.15 || t > 1) continue;
        var px = lx + ux * t * L, pz = lz + uz * t * L;
        if (U.dist2(cx, cz, px, pz) < Math.pow(r.w / 2 + half + 3, 2)) return false;
      }
      return true;
    }
    function footprintClear(cx, cz, sx, sz) {
      if (!corridorClear(cx, cz, sx, sz)) return false;
      var pts = [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]];
      for (var i = 0; i < pts.length; i++) {
        var px = cx + pts[i][0] * (sx / 2 + 0.6), pz = cz + pts[i][1] * (sz / 2 + 0.6);
        if (GAME.city.isInWater(px, pz) && !GAME.city.isOnPier(px, pz)) return false;
        if (GAME.city.rampAt(px, pz)) return false;
        if (GAME.city.nearCrossing && GAME.city.nearCrossing(px, pz, 10)) return false;
        var rp = GAME.city.nearestRoadPoint(px, pz);
        if (U.dist2(px, pz, rp.x, rp.z) < 8.5 * 8.5) return false;
        var boxes = GAME.city.hash.query(px, pz, 1);
        for (var b = 0; b < boxes.length; b++) {
          var q = boxes[b];
          if (px > q.minX - 0.4 && px < q.maxX + 0.4 && pz > q.minZ - 0.4 && pz < q.maxZ + 0.4) return false;
        }
      }
      return true;
    }
    locations.forEach(function (loc) {
      if (loc.kind === 'bribe') return;   // the police station is already a building
      var S = SIZES[loc.kind];
      if (!S) return;
      // Hunt outward from the intended spot for a mat whose building fits:
      // the door faces whatever road is nearest to each candidate. Boot-time,
      // a handful of shops — the ring search costs nothing and survives any
      // future reshuffle of ramps and blocks around it.
      var placed = null;
      var cands = [[0, 0]];
      for (var ring = 1; ring <= 6 && !placed; ring++) {
        for (var a = 0; a < 8; a++) cands.push([Math.cos(a / 8 * Math.PI * 2) * ring * 5, Math.sin(a / 8 * Math.PI * 2) * ring * 5]);
      }
      for (var si = 0; si < cands.length && !placed; si++) {
        var mx = loc.at.x + cands[si][0], mz = loc.at.z + cands[si][1];
        var rp = GAME.city.nearestRoadPoint(mx, mz);
        var dx = mx - rp.x, dz = mz - rp.z;
        var dir = Math.abs(dx) >= Math.abs(dz) ? { x: Math.sign(dx) || 1, z: 0 } : { x: 0, z: Math.sign(dz) || 1 };
        // the mat itself must be standable and off the carriageway
        if (GAME.city.isInWater(mx, mz) && !GAME.city.isOnPier(mx, mz)) continue;
        if (GAME.city.rampAt(mx, mz)) continue;
        if (U.dist2(mx, mz, rp.x, rp.z) < 9.5 * 9.5) continue;
        var sx = dir.x !== 0 ? S.d : S.w, sz = dir.x !== 0 ? S.w : S.d;
        var cx = mx + dir.x * (S.d / 2 + 1.2), cz = mz + dir.z * (S.d / 2 + 1.2);
        if (footprintClear(cx, cz, sx, sz)) placed = { mx: mx, mz: mz, cx: cx, cz: cz, sx: sx, sz: sz, dir: dir };
      }
      if (!placed) return;                // mat-only fallback; rare
      var dir = placed.dir;
      loc.at = { x: placed.mx, z: placed.mz };
      if (loc.sh) loc.sh.at = loc.at;     // you respawn at the door, not where the mat first landed
      var gy = GAME.city.groundY(placed.cx, placed.cz);
      // shell, sunk half a metre so sloped ground never shows a gap
      walls.addBox(placed.cx, gy + S.h / 2 - 0.25, placed.cz, placed.sx, S.h + 0.5, placed.sz, 0, S.wall, 28);
      trims.addBox(placed.cx, gy + S.h + 0.22, placed.cz, placed.sx + 0.6, 0.34, placed.sz + 0.6, 0, 0x241a36, 0);
      GAME.city.addSolid(placed.cx, placed.cz, placed.sx, placed.sz, gy + S.h);
      // the door face and its outward normal (-dir); everything on the
      // facade hangs off these
      var fx = placed.cx - dir.x * (S.d / 2), fz = placed.cz - dir.z * (S.d / 2);
      var px2 = { x: dir.z, z: -dir.x };  // along-facade axis
      var doorW = Math.min(2.6, S.w - 2);
      function onFace(out, along, y, w, h, thick, color) {
        // a box on the facade plane: `along` slides it sideways, `out` stands
        // it proud, w × h in the face, `thick` into it
        trims.addBox(fx - dir.x * out + px2.x * along, y, fz - dir.z * out + px2.z * along,
          dir.x !== 0 ? thick : w, h, dir.x !== 0 ? w : thick, 0, color, 0);
      }
      // door
      onFace(0.09, 0, gy + 1.5, doorW, 3.0, 0.18, 0x120c1e);
      // awning in the shop's color
      onFace(0.55, 0, gy + 3.15, S.w - 1.2, 0.16, 1.1, loc.color);
      // ---- per-trade dressing ----
      if (loc.kind === 'dress') {
        // lit display windows flanking the door, a dressed dummy in each
        [-1, 1].forEach(function (sside) {
          var off = sside * (doorW / 2 + 2.4);
          onFace(0.12, off, gy + 1.7, 3.2, 2.6, 0.14, 0xfff4e0);
          onFace(0.3, off, gy + 1.15, 0.5, 0.9, 0.3, sside < 0 ? 0xf78ab8 : 0x8fd0f0);
          onFace(0.3, off, gy + 1.85, 0.34, 0.34, 0.3, 0xeac8a8);
        });
      } else if (loc.kind === 'barber') {
        // the pole: red-white-blue courses, standing proud beside the door
        for (var pb = 0; pb < 6; pb++) {
          onFace(0.6, doorW / 2 + 1.1, gy + 1.1 + pb * 0.34, 0.34, 0.34, 0.34,
            pb % 3 === 0 ? 0xe23a3a : pb % 3 === 1 ? 0xf2f2f2 : 0x3a6ae2);
        }
        onFace(0.12, -(doorW / 2 + 1.9), gy + 1.8, 2.4, 2.2, 0.14, 0xfff4e0);
      } else if (loc.kind === 'hardware') {
        // roller door beside the entrance and a steel band over the front
        onFace(0.1, doorW / 2 + 2.6, gy + 1.6, 4.0, 3.2, 0.16, 0x585c66);
        onFace(0.14, 0, gy + S.h - 1.9, S.w - 1.0, 0.5, 0.2, 0x585c66);
      } else if (loc.kind === 'casino') {
        // the gull's wheel over the door, wedge-striped in gold and night
        for (var cs = 0; cs < 8; cs++) {
          var ca = cs / 8 * Math.PI * 2;
          onFace(0.25, Math.cos(ca) * 1.5, gy + S.h + 1.5 + Math.sin(ca) * 1.5, 0.8, 0.8, 0.3,
            cs % 2 ? 0xffe14f : 0x241a36);
        }
      } else if (loc.kind === 'showroom') {
        // a glass hall: full-width lit glazing, and the trade's own proof —
        // a machine on a turntable out front (spun in update())
        onFace(0.12, 0, gy + 2.3, S.w - 2, 4.2, 0.14, 0x9fd8e8);
        // the skirt strip stands clear of the glazing's planes — at 0.2 its
        // inner face shared the glass's and the two banded strips flickered
        onFace(0.3, 0, gy + 0.35, S.w - 1.6, 0.7, 0.3, 0x8dffd8);
        var plX = fx - dir.x * 7 + px2.x * (S.w / 2 - 3);
        var plZ = fz - dir.z * 7 + px2.z * (S.w / 2 - 3);
        trims.addBox(plX, gy + 0.4, plZ, 4.4, 0.8, 4.4, 0, 0x8dffd8, 0);
        GAME.city.addSolid(plX, plZ, 4.4, 4.4, gy + 0.8, 'prop', true);
        var showCar = GAME.vehicles.buildMesh('sports');
        if (showCar) {
          showCar.position.set(plX, gy + 0.8, plZ);
          scene.add(showCar);
          spinProps.push({ mesh: showCar, rate: 0.35 });
        }
      } else if (loc.kind === 'safehouse') {
        // a home: upstairs window band and a lamp by the door. The band stops
        // below the sign board — at -2.2 the two shared planes AND a 0.4 m
        // strip of facade, and the lit windows flickered against the board
        onFace(0.12, 0, gy + S.h - 2.65, S.w - 3, 1.6, 0.14, 0xffe9b0);
        onFace(0.45, doorW / 2 + 0.8, gy + 3.4, 0.3, 0.5, 0.3, 0xffd890);
      }
      // the name in lights
      var slot = SIGN_SLOT[loc.id];
      if (slot !== undefined) {
        var rotY = dir.x !== 0 ? (dir.x < 0 ? Math.PI / 2 : -Math.PI / 2) : (dir.z < 0 ? 0 : Math.PI);
        // a dark board behind the glyphs so the name reads day and night
        onFace(0.12, 0, gy + S.h - 0.85, Math.min(S.w - 0.8, 11) + 0.8, 1.9, 0.14, 0x14101f);
        GAME.city.addSign(signs, slot, fx - dir.x * 0.22, gy + S.h - 0.85, fz - dir.z * 0.22,
          rotY, Math.min(S.w - 0.8, 11), 1.6);
      }
    });
    var wallMesh = new THREE.Mesh(walls.build(), GAME.city.lam(GAME.city.tex.strip));
    wallMesh.matrixAutoUpdate = false;
    scene.add(wallMesh);
    var trimMesh = new THREE.Mesh(trims.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
    trimMesh.matrixAutoUpdate = false;
    scene.add(trimMesh);
    var signMesh = new THREE.Mesh(signs.build(), GAME.city.signMesh.material);
    signMesh.matrixAutoUpdate = false;
    scene.add(signMesh);
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
      var buyable = !it.owned && !it.off && afford;
      row.className = 'shop-row' + (i === sel ? ' sel' : '') + ((it.off || !afford) && !it.owned ? ' off' : '') + (it.owned ? ' owned' : '');
      var sw = it.sw !== undefined ? '<span class="sw" style="background:#' + it.sw.toString(16).padStart(6, '0') + '"></span>' : '';
      // Trying is free; paying goes through a gate. Hover or click previews;
      // the selected row wears a BUY chip, and BUY (or Enter, or a second
      // click) opens a confirmation card — nothing is ever bought without
      // answering it. Re-visiting a row can only ever re-preview it.
      var armed = i === sel && buyable;
      var priceCell = it.owned ? 'YOURS'
        : armed ? 'BUY · ' + (it.price > 0 ? '$' + it.price.toLocaleString() : 'FREE')
          : it.price > 0 ? '$' + it.price.toLocaleString() : 'FREE';
      row.innerHTML = '<div><div class="nm">' + sw + it.name + '</div>' + (it.ds ? '<div class="ds">' + it.ds + '</div>' : '') + '</div>' +
        '<div class="pr' + (armed ? ' buychip' : '') + '">' + priceCell + '</div>';
      row.addEventListener('click', function () {
        if (sel !== i) { sel = i; render(); }
        else openConfirm(it);
      });
      row.addEventListener('mouseenter', function () { if (sel !== i) { sel = i; render(); } });
      el.items.appendChild(row);
    });
    // the keyboard walks the whole list: keep the selected row in view
    var selRow = el.items.children[sel];
    if (selRow && selRow.scrollIntoView) selRow.scrollIntoView({ block: 'nearest' });
    setPreview(list[sel]);
  }

  // ---------- the turntable ----------
  // A live 3D preview beside the list: the mannequin wears whatever the
  // selected row would put on you, the showroom spins the actual machine.
  // Its own tiny renderer, driven from the main loop's rAF (the sim is
  // frozen behind a shop, the render loop is not).
  var pv = { renderer: null, scene: null, cam: null, obj: null, key: '', on: false };
  function ensurePv() {
    if (pv.renderer) return;
    var canvas = $('shop-preview');
    pv.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    pv.renderer.setSize(300, 340, false);
    pv.scene = new THREE.Scene();
    pv.scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x2a2038, 1.0));
    var dl = new THREE.DirectionalLight(0xfff0d8, 0.9);
    dl.position.set(3, 5, 4);
    pv.scene.add(dl);
    pv.cam = new THREE.PerspectiveCamera(38, 300 / 340, 0.1, 60);
  }
  function clearPvObj() {
    if (!pv.obj) return;
    pv.scene.remove(pv.obj);
    disposeTree(pv.obj);
    pv.obj = null;
  }
  function previewOutfit(it) {
    var o = { shirt: outfit().shirt, pants: outfit().pants, hairStyle: outfit().hairStyle, hairColor: outfit().hairColor, skin: outfit().skin };
    if (it) {
      if (it.id.indexOf('shirt_') === 0) o.shirt = it.id.slice(6);
      else if (it.id.indexOf('pants_') === 0) o.pants = it.id.slice(6);
      else if (it.id.indexOf('style_') === 0) o.hairStyle = it.id.slice(6);
      else if (it.id.indexOf('color_') === 0) o.hairColor = it.id.slice(6);
    }
    return o;
  }
  // small helper for the prop previews: a colored box added to a group
  function pbox(g, x, y, z, w, h, d, color, glow) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial(glow
        ? { color: color, emissive: color, emissiveIntensity: 0.6 }
        : { color: color }));
    m.position.set(x, y, z);
    g.add(m);
    return m;
  }
  // every counter shows its goods: guns and kit at the hardware store, the
  // cash itself at the police desk, a chip stack at the casino, the house
  // at a safehouse — nothing is bought sight unseen
  function propPreview(kind, it) {
    var g = new THREE.Group();
    pbox(g, 0, 0.03, 0, 3.4, 0.06, 3.4, 0x2a2f4a);            // display plinth
    if (kind === 'hardware') {
      var shape = { armor: 'armor', medkit: 'health' }[it.id] || it.id;
      var m = GAME.combat.pickupShape(shape);
      m.scale.set(2.1, 2.1, 2.1);
      m.position.y = 1.0;
      g.add(m);
    } else if (kind === 'bribe') {
      // the bribe is money on the table — CLEAN SLATE stacks one bundle per star
      var n = it.id === 'slate' ? Math.max(1, GAME.police.wanted) : 1;
      for (var i = 0; i < n; i++) {
        var b = GAME.combat.pickupShape('cash');
        b.scale.set(1.7, 1.7, 1.7);
        b.position.y = 0.55 + i * 0.42;
        b.rotation.y = (i % 2) * 0.5 - 0.25;
        g.add(b);
      }
    } else if (kind === 'casino') {
      // your stake as a chip stack: taller bet, taller tower
      var chips = { bet100: 4, bet500: 9, bet2000: 18 }[it.id] || 4;
      var cols = [0xff2d95, 0x2de8ff, 0xf5f0ff];
      for (var c = 0; c < chips; c++) {
        var chip = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 18),
          new THREE.MeshLambertMaterial({ color: cols[c % 3], emissive: cols[c % 3], emissiveIntensity: 0.35 }));
        chip.position.set(Math.sin(c * 2.4) * 0.03, 0.62 + c * 0.13, Math.cos(c * 2.4) * 0.03);
        g.add(chip);
      }
    } else if (kind === 'safehouse') {
      var sh = openShop.sh || {};
      if (sh.id === 'dock') {
        [-0.7, 0.7].forEach(function (px) { [-0.55, 0.55].forEach(function (pz) {
          pbox(g, px, 0.31, pz, 0.09, 0.5, 0.09, 0x7a5b3e); }); });
        pbox(g, 0, 0.6, 0, 1.9, 0.08, 1.6, 0x9a7b52);          // deck on stilts
        pbox(g, 0, 1.1, 0, 1.5, 0.92, 1.2, 0x9adfe8);          // the shack
        pbox(g, 0, 1.6, 0, 1.7, 0.08, 1.4, 0xf2f2f6);          // flat roof
        pbox(g, 0.3, 1.0, 0.62, 0.34, 0.56, 0.05, 0x30323e);   // door
        pbox(g, -0.32, 1.2, 0.62, 0.34, 0.3, 0.04, 0xfff3b8, true);
      } else if (sh.id === 'villa') {
        pbox(g, 0.2, 0.56, 0, 2.5, 1.0, 1.7, 0xffe8d1);        // ground floor
        pbox(g, -0.35, 1.46, 0, 1.3, 0.8, 1.3, 0xffd9e8);      // upper wing
        pbox(g, -0.35, 1.9, 0, 1.5, 0.08, 1.5, 0xf2f2f6);
        pbox(g, 0.85, 1.1, 0, 1.3, 0.08, 1.8, 0xf2f2f6);       // terrace lip
        pbox(g, 0.6, 0.62, 0.88, 0.36, 0.62, 0.05, 0x30323e);  // door
        pbox(g, 0.6, 1.02, 0.92, 0.8, 0.07, 0.3, 0xff7fb8);    // awning
        [-0.2, -0.9].forEach(function (px) { pbox(g, px, 0.62, 0.88, 0.4, 0.34, 0.04, 0xb8f6ff, true); });
      } else {
        pbox(g, 0, 1.2, 0, 1.35, 2.3, 1.35, 0xf3d9e2);         // the condo tower
        pbox(g, 0, 2.4, 0, 1.5, 0.09, 1.5, 0xffffff);
        for (var r = 0; r < 4; r++) for (var q = -1; q <= 1; q++)
          pbox(g, q * 0.4, 0.82 + r * 0.42, 0.69, 0.26, 0.24, 0.03, 0xfff3b8, true);
        pbox(g, 0, 0.45, 0.69, 0.34, 0.7, 0.04, 0x30323e);     // lobby door
      }
    }
    return g;
  }
  function setPreview(it) {
    var kind = openShop && openShop.kind;
    var wants = it && kind;
    var side = $('shop-side');
    pv.on = !!wants;
    if (side) side.style.display = wants ? 'block' : 'none';
    if (!wants) { clearPvObj(); pv.key = ''; return; }
    ensurePv();
    var tag = $('shop-preview-tag');
    if (kind === 'hardware' || kind === 'bribe' || kind === 'casino' || kind === 'safehouse') {
      var pkey2 = 'prop:' + kind + ':' + it.id + (kind === 'bribe' ? ':' + GAME.police.wanted : '');
      if (tag) tag.textContent = kind === 'safehouse' ? openShop.sh.name : it.name;
      if (pkey2 === pv.key) return;
      pv.key = pkey2;
      clearPvObj();
      pv.obj = propPreview(kind, it);
      var tall = kind === 'safehouse' && (!openShop.sh || openShop.sh.id !== 'dock' && openShop.sh.id !== 'villa');
      pv.cam.position.set(0, tall ? 2.2 : 1.8, tall ? 4.8 : 4.0);
      pv.cam.lookAt(0, tall ? 1.2 : 0.85, 0);
    } else if (kind === 'showroom') {
      var key = 'car:' + it.id;
      if (tag) tag.textContent = it.name;
      if (key === pv.key) return;
      pv.key = key;
      clearPvObj();
      pv.obj = GAME.vehicles.buildMesh(it.id);
      if (!pv.obj) return;
      var spec = GAME.vehicles.TYPES[it.id];
      var r = Math.max(spec.l, 4) * 0.62 + 2.2;
      pv.cam.position.set(r * 0.75, spec.l * 0.28 + 1.6, r * 0.75);
      pv.cam.lookAt(0, Math.max(0.8, spec.l * 0.1), 0);
    } else {
      // an honest mirror: YOUR skin, YOUR current outfit, with only the
      // hovered row swapped in — this is exactly how you'd walk out
      var o = previewOutfit(it);
      var pkey = 'ped:' + o.shirt + '/' + o.pants + '/' + o.hairStyle + '/' + o.hairColor + '/' + o.skin;
      if (tag) tag.textContent = 'YOU · wearing ' + it.name.replace(/^(SHIRT|PANTS|CUT|HAIR COLOR) · /, '');
      if (pkey === pv.key) return;
      pv.key = pkey;
      clearPvObj();
      var m = GAME.peds.buildPedMesh({ noHair: true });
      var j = m.userData.joints;
      j.torso.material = new THREE.MeshLambertMaterial({ color: byId(SHIRTS, o.shirt).hex });
      j.armL.children[0].material = j.torso.material;
      j.armR.children[0].material = j.torso.material;
      j.legL.children[0].material = new THREE.MeshLambertMaterial({ color: byId(PANTS, o.pants).hex });
      j.legR.children[0].material = j.legL.children[0].material;
      j.head.material = new THREE.MeshLambertMaterial({ color: o.skin });
      var hair = GAME.peds.makeHair(o.hairStyle, byId(HAIRCOLORS, o.hairColor).hex);
      if (hair) { hair.position.y = 1.6; m.add(hair); }
      pv.obj = m;
      pv.cam.position.set(0, 1.5, 3.2);
      pv.cam.lookAt(0, 1.0, 0);
    }
    pv.scene.add(pv.obj);
  }
  function renderPreview() {
    if (!pv.on || !pv.renderer || !pv.obj || !GAME.shopOpen) return;
    pv.obj.rotation.y += 0.016;
    pv.renderer.render(pv.scene, pv.cam);
  }
  // the purchase gate. The card names the thing and its price; only CONFIRM
  // (or Enter while it's up) actually spends money, in every shop alike.
  function openConfirm(it) {
    if (!openShop || !it || it.owned || it.off) return;
    var P = GAME.player;
    if (P.cash < it.price) { note('You’re $' + (it.price - P.cash).toLocaleString() + ' short.'); GAME.audio.crash(0.12); return; }
    pendingBuy = it.id;
    $('shop-confirm-name').textContent = it.name;
    $('shop-confirm-price').textContent = it.price > 0 ? 'Price: $' + it.price.toLocaleString() : 'Free';
    $('shop-confirm').style.display = 'flex';
  }
  function cancelConfirm() {
    pendingBuy = null;
    var c = $('shop-confirm');
    if (c) c.style.display = 'none';
  }
  function confirmYes() {
    var id = pendingBuy;
    cancelConfirm();
    if (id) buy(id);
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
    cancelConfirm();
    note('');
    var hint = $('shop-hint');
    if (hint) hint.textContent =
      loc.kind === 'dress' || loc.kind === 'barber'
        ? 'Click or W/S to try it on — the mirror is you, free of charge  ·  BUY asks before it charges  ·  Esc leave'
        : loc.kind === 'showroom'
          ? 'Click or W/S to put it on the turntable  ·  BUY asks before it charges  ·  Esc leave'
          : 'Click or W/S to select  ·  BUY (or Enter) asks before it charges  ·  Esc leave';
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
    if (pendingBuy !== null) { cancelConfirm(); return; }   // Esc backs out of the card first
    leftSince[openShop.id] = false;   // must step off the mat before it reopens
    openShop = null;
    el.screen.style.display = 'none';
    GAME.shopOpen = false;
    pv.on = false;
    clearPvObj();
    pv.key = '';
    if (GAME.syncOverlayMusic) GAME.syncOverlayMusic();
  }

  function onKey(e) {
    if (!GAME.shopOpen || !openShop) return;
    if (pendingBuy !== null) {
      // the confirmation card owns the keys while it's up
      if (e.code === 'Enter' || e.code === 'KeyE') confirmYes();
      return;
    }
    var list = items(openShop);
    if (e.code === 'KeyS' || e.code === 'ArrowDown') { sel = (sel + 1) % list.length; render(); }
    else if (e.code === 'KeyW' || e.code === 'ArrowUp') { sel = (sel - 1 + list.length) % list.length; render(); }
    else if (e.code === 'Enter' || e.code === 'KeyE') { if (list[sel]) openConfirm(list[sel]); }
  }

  function init(scene) {
    ['shop-screen', 'shop-title', 'shop-tag', 'shop-cash', 'shop-items', 'shop-note', 'shop-close']
      .forEach(function (id) { el[id.replace('shop-', '')] = $(id); });
    if (el.close) el.close.addEventListener('click', close);
    ['click', 'touchend'].forEach(function (ev) {
      $('shop-confirm-yes').addEventListener(ev, function (e) { e.preventDefault(); confirmYes(); });
      $('shop-confirm-no').addEventListener(ev, function (e) { e.preventDefault(); cancelConfirm(); });
    });
    window.addEventListener('keydown', onKey);
    buildLocations();
    buildShopfronts(scene);   // may slide a doormat to fit its building
    buildMarkers(scene);
    refreshGarageSpots();     // bought vehicles wait at home from last session
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
    for (var sp = 0; sp < spinProps.length; sp++) spinProps[sp].mesh.rotation.y += dt * spinProps[sp].rate;
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
      var home = loc.kind === 'safehouse' && owns(loc.sh.id);
      out.push({
        x: loc.at.x, z: loc.at.z,
        color: home ? '#5dff9e' : '#' + loc.color.toString(16).padStart(6, '0'),
        label: loc.kind === 'safehouse' ? (home ? '⌂' : '$') : '$',
        home: home
      });
    }
    return out;
  }

  return {
    init: init, update: update, open: open, close: close, buy: buy,
    nearHint: nearHint, blips: blips, applyOutfit: applyOutfit,
    homeSpawn: homeSpawn, ownsAny: ownsAny, owns: owns,
    renderPreview: renderPreview,
    garage: function () { return garage().slice(); },
    garageSpot: function (type) { return garageSpots[type] || null; },
    get isOpen() { return !!openShop; },
    get current() { return openShop; },
    get selected() { return openShop ? items(openShop)[sel] : null; },
    locations: function () { return locations; },
    wardrobe: { SHIRTS: SHIRTS, PANTS: PANTS, HAIRSTYLES: HAIRSTYLES, HAIRCOLORS: HAIRCOLORS }
  };
})();
