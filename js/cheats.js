// Cheats: words, typed in. Typed straight off the keyboard mid-game they
// would trip over the controls — half the alphabet already does
// something (P is the map, N the night, M the sound), so they are typed into
// CHEATS on the pause screen instead — which a touchscreen's keyboard can
// reach too. A code that is not one is just "nothing happens".
//
// Most of them do a thing once. The rest switch a way the town works on,
// and the same code typed again switches it back off: what they switch is
// GAME.cheatOn (utils.js), read where each one bites — the cars' flight,
// paint and wheels and the traffic's manners in vehicles.js, the crowd's
// guns and tempers in peds.js and below. None of it is saved: a new visit
// starts with the town as it was.
GAME.cheats = (function () {
  var used = 0, off = false;
  function P() { return GAME.player; }
  function msg(t) { GAME.hud.message(t, 3); }
  // a switch: on, or (typed again) off, and whatever has to happen either way
  function toggle(key, onSaid, offSaid, then) {
    return function () {
      var on = GAME.cheatOn[key] = !GAME.cheatOn[key];
      off = !on;
      if (then) then(on);
      return on ? onSaid : offSaid;
    };
  }
  // one paint for every car on the street, or (typed again) their own back
  var PINK = 0xff5fae, BLACK = 0x141418;
  function paint(color, said) {
    return function () {
      var on = GAME.cheatOn.paint !== color;
      GAME.cheatOn.paint = on ? color : null;
      off = !on;
      GAME.vehicles.paintAll(GAME.cheatOn.paint);
      return on ? said : 'Traffic back in its own colours';
    };
  }
  // the whole game faster or slower, or (typed again) back to time
  function speed(k, said) {
    return function () {
      var on = GAME.gameSpeed !== k;
      GAME.gameSpeed = on ? k : 1;
      off = !on;
      return on ? said : 'Normal speed';
    };
  }
  // your build, or (typed again) your own
  function shape(kind, said) {
    return function () {
      var on = build !== kind;
      setBuild(on ? kind : null);
      off = !on;
      return on ? said : 'Back to your old self';
    };
  }
  function arm(list) {
    list.forEach(function (w) { GAME.combat.giveWeapon(w[0], w[1]); });
    GAME.combat.selectWeapon(list[list.length - 1][0]);
  }
  // a vehicle of your own, beside you
  function ride(type) {
    var p = P(), f = GAME.focus(), h = p.inCar && p.car ? p.car.heading : p.heading;
    var x = f.x + Math.sin(h + Math.PI / 2) * 5, z = f.z + Math.cos(h + Math.PI / 2) * 5;
    if (GAME.city.isInWater(x, z)) { x = f.x + Math.sin(h) * 7; z = f.z + Math.cos(h) * 7; }
    return GAME.vehicles.spawnCar(type, x, z, h, {});
  }
  var CODES = {
    ASPIRINE: function () { P().health = 100; return 'Health restored'; },
    PRECIOUSPROTECTION: function () { P().armor = 100; return 'Armour'; },
    THUGSTOOLS: function () { arm([['bat'], ['molotov', 10], ['pistol', 100], ['shotgun', 50], ['smg', 200], ['rifle', 50]]); return 'Weapons — the thug\'s set'; },
    PROFESSIONALTOOLS: function () { arm([['knife'], ['grenade', 10], ['pistol', 100], ['shotgun', 50], ['smg', 200], ['rifle', 50], ['sniper', 30]]); return 'Weapons — the professional\'s set'; },
    NUTTERTOOLS: function () { arm([['chainsaw'], ['grenade', 10], ['pistol', 100], ['shotgun', 50], ['smg', 200], ['sniper', 30], ['rocket', 10]]); return 'Weapons — the nutter\'s set'; },
    LEAVEMEALONE: function () { GAME.police.clearWanted(); return 'Wanted level cleared'; },
    YOUWONTTAKEMEALIVE: function () { GAME.police.setWanted(Math.min(GAME.police.MAX_STARS || 6, GAME.police.wanted + 2)); return 'Wanted level up'; },
    PANZER: function () { return ride('tank') ? 'Tank' : null; },
    GETTHEREFAST: function () { return ride('sports') ? 'A fast car' : null; },
    GETTHEREAMAZINGLYFAST: function () { return ride('superbike') ? 'A very fast bike' : null; },
    ROCKANDROLLCAR: function () { return ride('limo') ? 'Limousine' : null; },
    RUBBISHCAR: function () { return ride('van') ? 'A van' : null; },
    BETTERTHANWALKING: function () { return ride('buggy') ? 'A buggy' : null; },
    BIGBANG: function () {
      var f = GAME.focus(), n = 0;
      GAME.world.cars.slice().forEach(function (c) {
        if (c.dead || c === P().car || c.spec.heli || c.spec.plane || c.spec.boat) return;
        if (U.dist2(c.pos.x, c.pos.z, f.x, f.z) > 90 * 90) return;
        GAME.vehicles.explodeCar(c, 'fire', true); n++;
      });
      return n ? 'Everything nearby goes up' : 'Nothing nearby to go up';
    },
    ICANTTAKEITANYMORE: function () { if (GAME.godMode) return null; P().health = 0; GAME.playerWasted('cheat'); return 'Goodbye, cruel world'; },
    ALOVELYDAY: function () { GAME.weather.setMode('clear'); return 'Sunny'; },
    APLEASANTDAY: function () { GAME.weather.setMode('clear'); return 'Fine weather'; },
    ABITDRIEG: function () { GAME.weather.setMode('overcast'); return 'Overcast'; },
    CATSANDDOGS: function () { GAME.weather.setMode('rain'); return 'Rain'; },
    CANTSEEATHING: function () { GAME.weather.setMode('fog'); return 'Fog'; },
    LIFEISPASSINGMEBY: function () { GAME.dayPhase = (GAME.dayPhase + 0.25) % 1; return 'Six hours later'; },
    // ---- switches: typed again, each one is off ----
    COMEFLYWITHME: toggle('flyCars', 'Cars fly — floor it to take off', 'Cars stay on the ground'),
    SEAWAYS: toggle('seaWays', 'Cars drive on water', 'The sea is wet again'),
    AIRSHIP: toggle('flyBoats', 'Boats fly — flat out to take off', 'Boats stay on the water'),
    WHEELSAREALLINEED: toggle('wheelsOnly', 'Only the wheels show', 'The bodywork is back',
      function () { GAME.vehicles.dressAll(); }),
    LOADSOFLITTLETHINGS: toggle('bigWheels', 'Big wheels', 'Wheels back to size',
      function () { GAME.vehicles.dressAll(); }),
    MIAMITRAFFIC: toggle('madTraffic', 'Aggressive traffic', 'The traffic calms down'),
    AHAIRDRESSERSCAR: paint(PINK, 'Pink traffic'),
    IWANTITPAINTEDBLACK: paint(BLACK, 'Black traffic'),
    NOBODYLIKESME: toggle('hateYou', 'Everybody hates you', 'The town forgives you'),
    OURGODGIVENRIGHTTOBEARARMS: toggle('armed', 'Everybody is armed', 'Guns away',
      function (on) { if (on) scan(); else disarm(); }),
    FIGHTFIGHTFIGHT: toggle('riot', 'Riot!', 'The riot is over'),
    HOPINGIRL: toggle('hopIn', 'People hop into your car', 'No more passengers'),
    STILLLIKEDRESSINGUP: function () { return redress() ? 'A new look' : null; },
    DEEPFRIEDMARSBARS: shape('fat', 'You put on weight'),
    PROGRAMMER: shape('thin', 'Skinny'),
    ONSPEED: speed(1.5, 'Faster gameplay'),
    BOOOOOORING: speed(0.5, 'Slow motion')
  };
  CODES.MAYHEMTRAFFIC = CODES.MIAMITRAFFIC;   // the same, by its other name
  // Enter a code; what it did, or null for nothing
  function enter(text) {
    var code = String(text || '').toUpperCase().replace(/[^A-Z]/g, '');
    var fn = CODES[code];
    if (!fn || !GAME.started || P().state !== 'alive') return null;
    off = false;
    var said = fn();
    if (!said) return null;
    used++;
    GAME.prefs = GAME.prefs || {};
    GAME.prefs.cheats = (GAME.prefs.cheats || 0) + 1;
    GAME.audio.sting('win');
    msg((off ? 'CHEAT OFF — ' : 'CHEAT ACTIVATED — ') + said);
    if (GAME.track) GAME.track('cheat-' + code.toLowerCase());
    return said;
  }

  // ---------- what you look like ----------
  // STILLLIKEDRESSINGUP: a shirt, trousers and a cut off the shops' own
  // racks, at random, and kept as if you had bought them
  function redress() {
    var W = GAME.shops && GAME.shops.wardrobe;
    if (!W || !GAME.prefs) return false;
    var o = GAME.prefs.outfit || (GAME.prefs.outfit = {});
    function other(list, now) {
      var pick = list[Math.floor(Math.random() * list.length)];
      for (var i = 0; i < 6 && pick.id === now; i++) pick = list[Math.floor(Math.random() * list.length)];
      return pick.id;
    }
    o.shirt = other(W.SHIRTS, o.shirt);
    o.pants = other(W.PANTS, o.pants);
    o.hairStyle = other(W.HAIRSTYLES, o.hairStyle);
    o.hairColor = other(W.HAIRCOLORS, o.hairColor);
    GAME.shops.applyOutfit();
    if (GAME.save) GAME.save();
    return true;
  }
  // DEEPFRIEDMARSBARS and PROGRAMMER: the same figure, built heavier or
  // slighter — the body and the limbs' thickness, never their length, so
  // every pose and every seat still fits
  var BUILDS = {
    normal: { torso: [1, 1, 1], arm: [1, 1], armX: 0.3, leg: [1, 1], legX: 0.13 },
    fat: { torso: [1.5, 1.04, 1.9], arm: [1.35, 1.35], armX: 0.42, leg: [1.45, 1.45], legX: 0.17 },
    thin: { torso: [0.7, 1, 0.72], arm: [0.55, 0.55], armX: 0.23, leg: [0.6, 0.6], legX: 0.1 }
  };
  var build = null;
  function setBuild(kind) {
    build = kind;
    var mesh = P().mesh, j = mesh && mesh.userData.joints;
    if (!j) return;
    var b = BUILDS[kind || 'normal'];
    j.torso.scale.set(b.torso[0], b.torso[1], b.torso[2]);
    j.armL.scale.set(b.arm[0], 1, b.arm[1]); j.armR.scale.set(b.arm[0], 1, b.arm[1]);
    j.armL.position.x = -b.armX; j.armR.position.x = b.armX;
    j.legL.scale.set(b.leg[0], 1, b.leg[1]); j.legR.scale.set(b.leg[0], 1, b.leg[1]);
    j.legL.position.x = -b.legX; j.legR.position.x = b.legX;
  }

  // ---------- the crowd ----------
  // Every half second: who is carrying (OURGODGIVENRIGHTTOBEARARMS), who
  // comes for you (NOBODYLIKESME), and who squares up to whoever is nearest
  // (FIGHTFIGHTFIGHT). Not the law, and not anybody a job has a part for.
  var scanT = 0;
  function arm(p) {
    var ud = p.mesh.userData;
    if (ud.cheatGun) return;
    if (!p.carrying) { p.carrying = true; ud.cheatCarry = true; }
    // a pistol in the right hand, barrel down the arm: down by the side
    // walking, at the target when he draws (peds.js raises the arm)
    var gun = new THREE.Mesh(sharedBoxGeo(0.07, 0.26, 0.13), sharedLambert(0x1a1a20));
    gun.position.set(0, -0.68, 0.03);
    ud.joints.armR.add(gun);
    ud.cheatGun = gun;
  }
  function disarm() {
    GAME.world.peds.forEach(function (p) {
      var ud = p.mesh.userData;
      if (!ud.cheatGun) return;
      ud.joints.armR.remove(ud.cheatGun);
      ud.cheatGun = null;
      if (ud.cheatCarry) { p.carrying = undefined; ud.cheatCarry = false; }
    });
  }
  function about(p) {
    return !p.dead && !p.gone && !p.isCop && !p.jobPed && !p.boss && p.state !== 'inside' && p.state !== 'enter';
  }
  function scan() {
    var on = GAME.cheatOn, Pl = P(), f = GAME.focus(), peds = GAME.world.peds;
    for (var i = 0; i < peds.length; i++) {
      var p = peds[i];
      if (!about(p)) continue;
      if (on.armed) arm(p);
      if (hop && hop.ped === p) continue;
      var calm = p.state === 'walk' || p.state === 'idle' || p.state === 'flee';
      var d2 = U.dist2(p.pos.x, p.pos.z, f.x, f.z);
      if (on.hateYou && calm && Pl.state === 'alive' && d2 < 32 * 32 && Math.abs(p.pos.y - f.y) < 3) {
        GAME.peds.startFight(p, { kind: 'player' }, 20);
        continue;
      }
      if (on.riot && (p.state === 'walk' || p.state === 'idle') && d2 < 90 * 90) {
        var best = null, bd = 25 * 25;
        for (var k = 0; k < peds.length; k++) {
          var q = peds[k];
          if (q === p || !about(q) || (hop && hop.ped === q) || Math.abs(q.pos.y - p.pos.y) > 2) continue;
          var e2 = U.dist2(p.pos.x, p.pos.z, q.pos.x, q.pos.z);
          // somebody not already in a fight first, if there is anybody
          if (q.state === 'attack') e2 += 400;
          if (e2 < bd) { bd = e2; best = q; }
        }
        if (best && GAME.peds.startFight(p, { kind: 'ped', ped: best }, 20) && best.state !== 'attack') {
          GAME.peds.startFight(best, { kind: 'ped', ped: p }, 20);
        }
      }
    }
  }

  // ---------- HOPINGIRL ----------
  // Pull up and stop, and somebody off the pavement walks over and gets in
  // beside you. They ride along until you next stop for a moment, and get
  // out there. One at a time, never on a job, never on two wheels or the
  // water or in the air.
  var hop = null, hopCd = 0;
  var HOP_IN = ['"Mind if I ride along?"', '"Wherever you\'re going is fine by me."', '"Step on it, I\'m late."', '"Nice wheels. Let\'s go."'];
  var HOP_OUT = ['"This\'ll do. Thanks for the lift!"', '"Same time tomorrow?"', '"You drive like my mother."', '"Never again. Thanks, though."'];
  function seats(car) {
    var s = car.spec;
    return !s.bike && !s.boat && !s.heli && !s.plane && !s.rc && !s.tank && !car.dead;
  }
  function doorOf(car) {
    // the passenger's side: the other side from the one you get out of
    var side = car.heading + Math.PI / 2, step = car.spec.w / 2 + 0.9;
    return { x: car.pos.x + Math.sin(side) * step, z: car.pos.z + Math.cos(side) * step };
  }
  function stepHop(dt) {
    var Pl = P(), car = Pl.inCar ? Pl.car : null;
    hopCd -= dt;
    if (hop && hop.ped) {
      // on the way over: the car has to wait for them
      var ped = hop.ped, c = hop.car, door = doorOf(c);
      if (ped.dead || ped.gone || c !== car || c.dead || Math.abs(c.speed) > 2.5 || !GAME.cheatOn.hopIn || ped.state !== 'enter') {
        if (!ped.dead && !ped.gone && ped.state === 'enter') { ped.enterX = NaN; ped.state = 'walk'; ped.wpT = 0; }
        hop = null; hopCd = 4;
        return;
      }
      ped.enterX = door.x; ped.enterZ = door.z;
      if (U.dist2(ped.pos.x, ped.pos.z, door.x, door.z) < 2 * 2) {
        hop.look = ped.look;
        GAME.peds.removePed(ped);
        hop.ped = null; hop.t = 0; hop.stopT = 0;
        GAME.audio.pickup();
        GAME.hud.message(HOP_IN[Math.floor(Math.random() * HOP_IN.length)], 2.5);
      }
      return;
    }
    if (hop) {
      // aboard: out at the next stop, or when you get out yourself
      var cc = hop.car;
      hop.t += dt;
      hop.stopT = Math.abs(cc.speed) < 1 && !cc.air ? hop.stopT + dt : 0;
      var gone = cc !== car || cc.dead || cc.gone || cc.sinking;
      if (gone || (hop.t > 8 && hop.stopT > 1.2)) {
        var at = doorOf(cc);
        if (!cc.gone && !cc.sinking && !GAME.city.isInWater(at.x, at.z) && Math.abs(cc.pos.y - GAME.city.groundY(at.x, at.z, cc.pos.y)) < 2) {
          var out = GAME.peds.spawnPed(at.x, at.z, { look: hop.look });
          if (out) { out.heading = cc.heading - Math.PI / 2; out.wpT = 0; }
          if (!gone) GAME.hud.message(HOP_OUT[Math.floor(Math.random() * HOP_OUT.length)], 2.5);
        }
        hop = null; hopCd = 6;
      }
      return;
    }
    // somebody to come over
    if (!GAME.cheatOn.hopIn || hopCd > 0 || !car || !seats(car) || Math.abs(car.speed) > 1 || car.air || GAME.onJob()) return;
    var best = null, bd = 18 * 18, peds = GAME.world.peds;
    for (var i = 0; i < peds.length; i++) {
      var p = peds[i];
      if (!about(p) || (p.state !== 'walk' && p.state !== 'idle') || Math.abs(p.pos.y - car.pos.y) > 2) continue;
      var d2 = U.dist2(p.pos.x, p.pos.z, car.pos.x, car.pos.z);
      if (d2 < bd) { bd = d2; best = p; }
    }
    if (!best) { hopCd = 1; return; }
    var dd = doorOf(car);
    GAME.peds.walkInto(best, dd.x, dd.z, 12);
    hop = { car: car, ped: best, look: null, t: 0, stopT: 0 };
  }

  function update(dt) {
    var on = GAME.cheatOn;
    if (on.hateYou || on.armed || on.riot) {
      scanT -= dt;
      if (scanT <= 0) { scanT = 0.5; scan(); }
    }
    if (on.hopIn || hop) stepHop(dt);
  }

  // ---------- the box on the pause screen ----------
  function $(id) { return document.getElementById(id); }
  function open() {
    var box = $('cheat-box'), inp = $('cheat-input');
    if (!box) return;
    GAME.cheatOpen = true;
    box.style.display = 'flex';
    $('cheat-said').textContent = '';
    inp.value = '';
    setTimeout(function () { try { inp.focus(); } catch (e) { } }, 30);
  }
  function close() {
    var box = $('cheat-box');
    if (box) box.style.display = 'none';
    GAME.cheatOpen = false;
    try { $('cheat-input').blur(); } catch (e) { }
  }
  function submit() {
    var inp = $('cheat-input'), said = enter(inp.value);
    $('cheat-said').textContent = said ? '✓ ' + said : 'Nothing happens.';
    inp.value = '';
    if (said) setTimeout(function () { close(); if (GAME.paused) GAME.togglePause(); }, 700);
  }
  function init() {
    var inp = $('cheat-input');
    if (!inp) return;
    inp.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    ['keyup', 'keypress'].forEach(function (ev) { inp.addEventListener(ev, function (e) { e.stopPropagation(); }); });
    $('cheat-ok').addEventListener('click', function (e) { e.stopPropagation(); submit(); });
    $('cheat-close').addEventListener('click', function (e) { e.stopPropagation(); close(); });
    $('cheat-box').addEventListener('click', function (e) { e.stopPropagation(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  return {
    enter: enter,
    open: open,
    close: close,
    update: update,
    get used() { return used; },
    codes: function () { return Object.keys(CODES); },
    // what is switched on, by name (and the build and the clock)
    active: function () {
      var on = GAME.cheatOn, out = Object.keys(on).filter(function (k) { return on[k] !== false && on[k] !== null; });
      if (build) out.push(build);
      if (GAME.gameSpeed !== 1) out.push('speed');
      return out;
    },
    get build() { return build; },
    get passenger() { return hop ? { aboard: !hop.ped, ped: hop.ped, car: hop.car, look: hop.look } : null; },
    // headless: every switch off, every look back
    testReset: function () {
      Object.keys(GAME.cheatOn).forEach(function (k) { GAME.cheatOn[k] = k === 'paint' ? null : false; });
      GAME.vehicles.paintAll(null);
      GAME.vehicles.dressAll();
      disarm();
      setBuild(null);
      GAME.gameSpeed = 1;
      if (hop && hop.ped && !hop.ped.gone) { hop.ped.enterX = NaN; hop.ped.state = 'walk'; }
      hop = null; hopCd = 0;
    }
  };
})();
