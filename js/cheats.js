// Cheats: every code the game knows, in a list to pick from.
//
// Typed straight into the game they would trip over the controls — half the
// alphabet already does something (P is the map, N the night, M the sound) —
// so they are a list of cards instead: on the pause screen, behind the `
// key, and on a touchscreen the joystick in the row beside the radar
// (touch.js). Picking one is the whole of it, with a mouse, a finger or a
// pad, and the list closes and the game carries on. On
// a keyboard, typing narrows the list, so the code words still work. And on
// a pad each one has a combo of eight presses that works in the middle of
// play, without opening anything.
//
// Most of them do a thing once. The rest switch a way the town works on,
// and picking one again switches it back off: what they switch is
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
  // a sky, pinned — or, picked again with that sky already pinned, the
  // weather left to come and go on its own again (AUTO)
  function weather(mode, said) {
    return function () {
      var on = GAME.weather.mode !== mode;
      GAME.weather.setMode(on ? mode : 'auto');
      off = !on;
      return on ? said : 'The weather comes and goes again';
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
    ALOVELYDAY: weather('clear', 'Sunny'),
    APLEASANTDAY: weather('clear', 'Fine weather'),
    ABITDRIEG: weather('overcast', 'Overcast'),
    CATSANDDOGS: weather('rain', 'Rain'),
    CANTSEEATHING: weather('fog', 'Fog'),
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
  function armPed(p) {
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
      if (on.armed) armPed(p);
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

  // ---------- the list ----------
  // Every code as a card: what it is, what it does, its word and its combo
  // on a pad. `on` says whether a switch is on (a sky is one too: picked
  // again it goes back to AUTO).
  // A pad combo is eight presses of LB, RB, A, B and the D-pad's ↑ ← →
  // (the buttons that do least in play — never the triggers, X, Y or ↓),
  // no button three times running, each one different from the rest.
  function sw(key) { return function () { return !!GAME.cheatOn[key]; }; }
  function sky(m) { return function () { return GAME.weather.mode === m; }; }
  var GROUPS = [['you', 'YOU'], ['arms', 'WEAPONS'], ['law', 'THE LAW'], ['ride', 'SOMETHING TO DRIVE'],
    ['cars', 'CARS AND BOATS'], ['crowd', 'THE CROWD'], ['sky', 'THE SKY AND THE CLOCK']];
  var CATALOG = [
    { code: 'ASPIRINE', g: 'you', icon: '❤️', name: 'Health', what: 'Back to full health.', pad: 'UP LEFT B A A RB UP RIGHT' },
    { code: 'PRECIOUSPROTECTION', g: 'you', icon: '🛡️', name: 'Armour', what: 'A full vest.', pad: 'LEFT B UP RIGHT LEFT B UP LB' },
    { code: 'STILLLIKEDRESSINGUP', g: 'you', icon: '👕', name: 'New look', what: 'A random outfit and cut off the racks, kept.', pad: 'UP LEFT RIGHT UP RIGHT B RIGHT B' },
    { code: 'DEEPFRIEDMARSBARS', g: 'you', icon: '🍔', name: 'Fat', what: 'You put on weight. Again for your old self.', pad: 'A A UP UP RIGHT LB RB LEFT', on: function () { return build === 'fat'; } },
    { code: 'PROGRAMMER', g: 'you', icon: '💻', name: 'Skinny', what: 'Thin as a rake. Again for your old self.', pad: 'A UP UP RIGHT UP A LEFT RB', on: function () { return build === 'thin'; } },
    { code: 'ICANTTAKEITANYMORE', g: 'you', icon: '💀', name: 'Wasted', what: 'Ends it, here and now.', pad: 'RIGHT RIGHT LB B UP A RIGHT RB', grim: true },
    { code: 'THUGSTOOLS', g: 'arms', icon: '🏏', name: 'The thug\'s set', what: 'Bat, Molotovs, pistol, shotgun, SMG and rifle.', pad: 'LEFT B UP A UP B UP B' },
    { code: 'PROFESSIONALTOOLS', g: 'arms', icon: '🔪', name: 'The professional\'s set', what: 'Knife, grenades, pistol, shotgun, SMG, rifle and sniper.', pad: 'B A LB LB UP B UP LEFT' },
    { code: 'NUTTERTOOLS', g: 'arms', icon: '🚀', name: 'The nutter\'s set', what: 'Chainsaw, grenades, pistol, shotgun, SMG, sniper and rockets.', pad: 'B RB B UP B RIGHT RIGHT LB' },
    { code: 'LEAVEMEALONE', g: 'law', icon: '😇', name: 'Lose the stars', what: 'Wanted level cleared.', pad: 'LB A LEFT RIGHT A A LB RB' },
    { code: 'YOUWONTTAKEMEALIVE', g: 'law', icon: '🚨', name: 'Two more stars', what: 'Wanted level up by two.', pad: 'LB A UP B A B LEFT RB' },
    { code: 'PANZER', g: 'ride', icon: '💣', name: 'Tank', what: 'A tank beside you.', pad: 'B LEFT B RIGHT RIGHT RB UP UP' },
    { code: 'GETTHEREFAST', g: 'ride', icon: '🏎️', name: 'Fast car', what: 'A sports car beside you.', pad: 'RIGHT LEFT LB LB RB B LEFT A' },
    { code: 'GETTHEREAMAZINGLYFAST', g: 'ride', icon: '🏍️', name: 'Very fast bike', what: 'A superbike beside you.', pad: 'LEFT UP RIGHT LEFT UP LB RIGHT RIGHT' },
    { code: 'ROCKANDROLLCAR', g: 'ride', icon: '🎸', name: 'Limousine', what: 'A limo beside you.', pad: 'LEFT LB B UP UP RIGHT LEFT UP' },
    { code: 'RUBBISHCAR', g: 'ride', icon: '🚐', name: 'Van', what: 'A van beside you.', pad: 'B UP LB LEFT LEFT UP A RB' },
    { code: 'BETTERTHANWALKING', g: 'ride', icon: '🏖️', name: 'Buggy', what: 'A dune buggy beside you.', pad: 'LEFT RIGHT RB RB A LEFT RB LB' },
    { code: 'COMEFLYWITHME', g: 'cars', icon: '🛫', name: 'Flying cars', what: 'Floor it past 70 km/h and take off: throttle climbs, brake dives.', pad: 'RIGHT UP RIGHT B A RB A RB', on: sw('flyCars') },
    { code: 'SEAWAYS', g: 'cars', icon: '🌊', name: 'Cars on water', what: 'Drive out on the sea instead of sinking.', pad: 'LEFT B RIGHT A LB UP LEFT LB', on: sw('seaWays') },
    { code: 'AIRSHIP', g: 'cars', icon: '🚤', name: 'Flying boats', what: 'Flat out on the water and a boat takes off.', pad: 'LB LB RB LEFT LB LB RIGHT LEFT', on: sw('flyBoats') },
    { code: 'WHEELSAREALLINEED', g: 'cars', icon: '⭕', name: 'Wheels only', what: 'Every car down to its wheels.', pad: 'UP B B RIGHT RB RB B A', on: sw('wheelsOnly') },
    { code: 'LOADSOFLITTLETHINGS', g: 'cars', icon: '🚙', name: 'Big wheels', what: 'Wheels nearly twice the size.', pad: 'LB UP LB LEFT RB B RB RB', on: sw('bigWheels') },
    { code: 'AHAIRDRESSERSCAR', g: 'cars', icon: '💗', name: 'Pink traffic', what: 'Every car pink.', pad: 'LB A RIGHT LB LB RIGHT A UP', on: function () { return GAME.cheatOn.paint === PINK; } },
    { code: 'IWANTITPAINTEDBLACK', g: 'cars', icon: '🖤', name: 'Black traffic', what: 'Every car black.', pad: 'LEFT B UP B UP RIGHT RB UP', on: function () { return GAME.cheatOn.paint === BLACK; } },
    { code: 'MIAMITRAFFIC', also: 'MAYHEMTRAFFIC', g: 'cars', icon: '😤', name: 'Aggressive traffic', what: 'Faster, on the horn, round anything, braking for nobody.', pad: 'B LB RB B RB UP LB LB', on: sw('madTraffic') },
    { code: 'BIGBANG', g: 'cars', icon: '💥', name: 'Big bang', what: 'Every car nearby goes up.', pad: 'B RIGHT RIGHT A B LB LEFT RIGHT' },
    { code: 'NOBODYLIKESME', g: 'crowd', icon: '😠', name: 'Everybody hates you', what: 'Everybody near comes for you.', pad: 'A RB RIGHT LB LB LEFT A B', on: sw('hateYou') },
    { code: 'OURGODGIVENRIGHTTOBEARARMS', g: 'crowd', icon: '🔫', name: 'Everybody armed', what: 'A pistol in every hand.', pad: 'LEFT LB A RIGHT RIGHT LEFT B B', on: sw('armed') },
    { code: 'FIGHTFIGHTFIGHT', g: 'crowd', icon: '👊', name: 'Riot', what: 'Everybody squares up to whoever is nearest.', pad: 'RIGHT B RB UP LEFT LEFT LB UP', on: sw('riot') },
    { code: 'HOPINGIRL', g: 'crowd', icon: '🚕', name: 'Hitchhikers', what: 'Stop, and somebody walks over and gets in.', pad: 'A LEFT RIGHT LB LEFT A B UP', on: sw('hopIn') },
    { code: 'ALOVELYDAY', g: 'sky', icon: '☀️', name: 'Sunny', what: 'Clear sky.', pad: 'RIGHT UP UP A RB RIGHT B RIGHT', on: sky('clear') },
    { code: 'APLEASANTDAY', g: 'sky', icon: '🌤️', name: 'Fine weather', what: 'Clear sky.', pad: 'RIGHT LEFT RB B UP RB RB UP', on: sky('clear') },
    { code: 'ABITDRIEG', g: 'sky', icon: '☁️', name: 'Overcast', what: 'A grey lid of cloud, and no rain.', pad: 'UP LB B A A RIGHT LB LB', on: sky('overcast') },
    { code: 'CATSANDDOGS', g: 'sky', icon: '🌧️', name: 'Rain', what: 'A downpour.', pad: 'A UP LEFT A LEFT A A RB', on: sky('rain') },
    { code: 'CANTSEEATHING', g: 'sky', icon: '🌫️', name: 'Fog', what: 'A fog bank rolls in off the sea.', pad: 'UP RIGHT UP LB A RB A LB', on: sky('fog') },
    { code: 'LIFEISPASSINGMEBY', g: 'sky', icon: '🕒', name: 'Six hours on', what: 'The clock jumps a quarter of a day.', pad: 'RIGHT LB RIGHT RB LEFT B A B' },
    { code: 'ONSPEED', g: 'sky', icon: '⏩', name: 'Fast game', what: 'Everything half as fast again.', pad: 'LEFT RIGHT UP A RB LEFT UP A', on: function () { return GAME.gameSpeed === 1.5; } },
    { code: 'BOOOOOORING', g: 'sky', icon: '🐢', name: 'Slow motion', what: 'Everything at half speed.', pad: 'RIGHT RB RB LB RIGHT UP LEFT RIGHT', on: function () { return GAME.gameSpeed === 0.5; } }
  ];
  var PAD_GLYPH = { A: 'Ⓐ', B: 'Ⓑ', LB: 'LB', RB: 'RB', UP: '↑', LEFT: '←', RIGHT: '→' };
  function padText(combo) { return combo.split(' ').map(function (t) { return PAD_GLYPH[t]; }).join(' '); }

  // ---------- combos on a pad, in play ----------
  // controls.js hands over every button pressed while no menu is up; the
  // last eight, close enough together, are looked up. Anything else pressed
  // in between (a trigger, X, Y) neither counts nor breaks the run.
  var PAD_TOKEN = { 0: 'A', 1: 'B', 4: 'LB', 5: 'RB', 12: 'UP', 14: 'LEFT', 15: 'RIGHT' };
  var BY_COMBO = {}, presses = [], lastPress = -1e9, COMBO_GAP = 1.5;
  CATALOG.forEach(function (c) { BY_COMBO[c.pad] = c.code; });
  function padPress(b) {
    var t = PAD_TOKEN[b];
    if (!t) return null;
    var now = performance.now() / 1000;
    if (now - lastPress > COMBO_GAP) presses.length = 0;
    lastPress = now;
    presses.push(t);
    if (presses.length > 8) presses.shift();
    var code = presses.length === 8 ? BY_COMBO[presses.join(' ')] : null;
    if (!code) return null;
    presses.length = 0;
    return enter(code);
  }

  // ---------- the box ----------
  function $(id) { return document.getElementById(id); }
  var cards = [], shown = [], sel = 0, find = '', fromPause = false;
  function makeList() {
    var list = $('cheat-list');
    if (!list || cards.length) return;
    GROUPS.forEach(function (gr) {
      var sec = document.createElement('div');
      sec.className = 'cgroup';
      sec.innerHTML = '<h4>' + gr[1] + '</h4><div class="cgrid"></div>';
      var grid = sec.lastChild;
      CATALOG.forEach(function (c) {
        if (c.g !== gr[0]) return;
        var el = document.createElement('div');
        el.className = 'ccard' + (c.grim ? ' grim' : '');
        el.innerHTML = '<div class="ci">' + c.icon + '</div><div class="cb"><div class="cn">' + c.name + '</div>' +
          '<div class="cw">' + c.what + '</div><div class="cc">' + c.code + (c.also ? ' · ' + c.also : '') + '</div>' +
          '<div class="cp">🎮 ' + padText(c.pad) + '</div></div><div class="con">ON</div>';
        el.addEventListener('click', function (e) { e.stopPropagation(); pick(c.code); });
        grid.appendChild(el);
        cards.push({ c: c, el: el, sec: sec });
      });
      list.appendChild(sec);
    });
  }
  function words(c) { return c.code + ' ' + (c.also || '') + ' ' + c.name.toUpperCase().replace(/[^A-Z]/g, ''); }
  function refilter() {
    shown = [];
    cards.forEach(function (k) {
      var hit = !find || words(k.c).indexOf(find) >= 0;
      k.el.classList.toggle('hide', !hit);
      if (hit) shown.push(k);
    });
    Array.prototype.forEach.call($('cheat-list').querySelectorAll('.cgroup'), function (sec) {
      sec.classList.toggle('hide', !shown.some(function (k) { return k.sec === sec; }));
    });
    $('cheat-find').textContent = find ? 'SEARCH: ' + find + (shown.length ? '' : ' — no code like that') : '';
    sel = 0;
    paintSel();
  }
  function paintSel() {
    cards.forEach(function (k) { k.el.classList.remove('sel'); });
    var k = shown[sel];
    if (!k) return;
    k.el.classList.add('sel');
    if (k.el.scrollIntoView) k.el.scrollIntoView({ block: 'nearest' });
  }
  function paintOn() { cards.forEach(function (k) { k.el.classList.toggle('on', !!(k.c.on && k.c.on())); }); }
  // round the cards by where they stand: left and right through the list,
  // up and down to the card nearest above or below
  function move(dir) {
    if (!shown.length) return;
    if (dir === 'ArrowLeft') sel = Math.max(0, sel - 1);
    else if (dir === 'ArrowRight') sel = Math.min(shown.length - 1, sel + 1);
    else {
      var down = dir === 'ArrowDown', cur = shown[sel].el.getBoundingClientRect(), best = -1, bd = Infinity;
      for (var i = 0; i < shown.length; i++) {
        var r = shown[i].el.getBoundingClientRect(), dy = down ? r.top - cur.top : cur.top - r.top;
        if (dy < 4) continue;
        var score = dy * 1000 + Math.abs(r.left - cur.left);
        if (score < bd) { bd = score; best = i; }
      }
      if (best >= 0) sel = best;
    }
    paintSel();
  }
  function onPad() { return !!(GAME.controls && GAME.controls.usingPad && GAME.controls.usingPad()); }
  function keyLabel() { return GAME.controls ? GAME.controls.label('Backquote') : '`'; }
  function open() {
    if (GAME.cheatOpen || !GAME.started || P().state !== 'alive') return false;
    if (GAME.mapOpen || GAME.shopOpen || GAME.shareOpen || GAME.lolaOpen || GAME.sceneOpen) return false;
    if (GAME.hud.dialogOpen && GAME.hud.dialogOpen()) return false;
    var box = $('cheat-box');
    if (!box) return false;
    makeList();
    // the game holds still under it: it is the pause screen, out of sight
    fromPause = !!GAME.paused;
    if (!GAME.paused) GAME.togglePause();
    document.body.classList.add('cheats-up');
    GAME.cheatOpen = true;
    box.style.display = 'flex';
    $('cheat-sub').textContent = 'Pick one and it works at once. A switch shows ON: pick it again to turn it off.';
    $('cheat-keys').textContent = GAME.isTouch ? 'Tap one to use it.'
      : onPad() ? 'D-pad to choose · Ⓐ use it · Ⓑ back. In play, a cheat\'s 🎮 combo works on its own.'
        : 'Click one, or arrows and Enter · type to search · Esc closes · ' + keyLabel() + ' opens this in play';
    find = '';
    paintOn();
    refilter();
    $('cheat-list').scrollTop = 0;
    if (GAME.track) GAME.track('cheats-opened');
    return true;
  }
  // Away, and back to the game — or, opened from the pause screen and left
  // without picking anything, back to the pause screen
  function close(resume) {
    if (!GAME.cheatOpen) return;
    GAME.cheatOpen = false;
    $('cheat-box').style.display = 'none';
    document.body.classList.remove('cheats-up');
    if ((resume || !fromPause) && GAME.paused) GAME.togglePause();
  }
  function pick(code) {
    if (!GAME.cheatOpen) return null;
    var said = enter(code);
    close(true);
    if (!said) msg('Not right now.');
    return said;
  }
  // the keyboard, straight from the keys (utils.js): typed letters narrow
  // the list, the arrows walk it, Enter picks
  function keyEvent(e) {
    var c = e.code;
    if (c === 'Escape') { if (find) { find = ''; refilter(); } else close(false); return; }
    if (GAME.controls && GAME.controls.map(c) === 'Backquote') { close(false); return; }
    if (c === 'Enter' || c === 'NumpadEnter' || c === 'Space') { if (shown[sel]) pick(shown[sel].c.code); return; }
    if (c === 'Backspace') { find = find.slice(0, -1); refilter(); return; }
    if (/^Arrow/.test(c)) { move(c); return; }
    if (/^Key[A-Z]$/.test(c) && !e.ctrlKey && !e.metaKey && !e.altKey && find.length < 32) { find += c.slice(3); refilter(); }
  }
  // a pad's buttons, as the menu keys they stand for (controls.js)
  function padKey(code) {
    if (code === 'Escape') close(false);
    else if (code === 'Enter') { if (shown[sel]) pick(shown[sel].c.code); }
    else if (/^Arrow/.test(code)) move(code);
  }
  function init() {
    var box = $('cheat-box');
    if (!box) return;
    // a click on the dark round the card is a way out, as Esc is
    box.addEventListener('click', function (e) { if (e.target === box) close(false); });
    $('cheat-card').addEventListener('click', function (e) { e.stopPropagation(); });
    $('cheat-close').addEventListener('click', function (e) { e.stopPropagation(); close(false); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  return {
    enter: enter,
    open: open,
    close: close,
    update: update,
    keyEvent: keyEvent,
    padKey: padKey,
    padPress: padPress,
    get isOpen() { return !!GAME.cheatOpen; },
    // the list as it stands: every card's code, and which are showing,
    // picked out and on
    catalog: function () { return CATALOG.map(function (c) { return { code: c.code, also: c.also || null, name: c.name, group: c.g, pad: c.pad }; }); },
    shown: function () { return shown.map(function (k) { return k.c.code; }); },
    get selected() { return shown[sel] ? shown[sel].c.code : null; },
    onCodes: function () { return cards.filter(function (k) { return k.el.classList.contains('on'); }).map(function (k) { return k.c.code; }); },
    pick: pick,
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
      presses.length = 0;
    }
  };
})();
