// Lola, as the voice in your ear and not only the one with work for you.
//
// The first time something happens that the game never explains — a cassette
// picked up off the pavement, a ramp that pays, a star, a boat — nobody said
// what it was or why it mattered. Now Lola pages it, once: the first tape,
// the first jump, the first star, the first time in each kind of vehicle, the
// first shift on offer, the first night in hospital. Each line is said once
// for the life of the save, and TIPS on the pause screen turns them off for
// anybody who knows the town already.
GAME.lola = (function () {
  function K(code) { return GAME.controls ? GAME.controls.label(code) : code.replace(/^Key/, ''); }
  function touch() { return !!GAME.isTouch; }
  // the lines, written as she talks; a function where it names a control
  var TIPS = {
    tape: 'That\'s a lost tape. A pirate DJ broadcast off the end of the pier till they shut him down, and his mixtapes went everywhere — thirty of them, both islands. Each one pays; the radar glints when you\'re close. Find them all and he\'s back on the air.',
    stunt: 'Unique stunt jump! Every ramp in town pays the first time you clear it — the faster the better. Find them all and it\'s worth your while.',
    islaJump: 'Isla Verde keeps its own ten jumps, on a tally of their own — and a prize of its own when you\'ve cleared them all.',
    star: 'You\'ve caught the law\'s eye. Get out of sight and lie low and it fades. Fresh paint at a respray loses a star or two, and the desk sergeant at the station can lose the paperwork — for a price.',
    stars3: 'Three stars: they know your face now, so paint won\'t fool them. Break their line of sight and lie low, or go and see the sergeant. A night at home helps too.',
    wasted: 'You\'ll live. The hospital keeps your cash but your guns are gone. Own a place and you wake up there instead, with everything.',
    busted: 'Busted. They take a fine and your hardware. Next time lose the stars before they box you in — a car stopped next to a cruiser is a car they can cuff you out of.',
    boat: 'A boat! No cruiser can follow you out on the water. The bay has work of its own, too — look for the rings by the piers.',
    heli: function () { return touch() ? 'Now you\'re flying. UP and DN take her up and down. The ceiling\'s around two hundred metres — and the law follows up here with a helicopter of its own.'
      : 'Now you\'re flying. ' + K('Space') + ' takes her up, ' + K('ShiftLeft') + ' down. The ceiling\'s around two hundred metres — and the law follows up here with a helicopter of its own.'; },
    plane: function () { return 'Runway\'s that way. Build some speed, pull up, and if it all goes wrong, ' + (touch() ? 'EXIT' : K('KeyF')) + ' gets you out with a parachute.'; },
    swim: 'Swimming? You can\'t hold a gun in the water. Climb out up the sand, onto a pier, or anywhere low enough to grab.',
    respray: 'Fresh paint, fresh start — up to two stars go with the old colour. From three up they know your face, and paint won\'t help.',
    job: function () { return 'That ride has work in it. ' + (touch() ? 'Press JOB' : 'Press ' + K('KeyJ')) + ' to start a shift — every run pays, and each level asks a bit more of you.'; },
    shop: 'Shops are walk-ins: stand on the glowing mat at the door. Guns, clothes, cars, a place to live — if you\'ve got the money.',
    home: 'Your own place. Sleep it off to skip eight hours and shed some heat, and if you go down nearby you wake up here instead of the hospital.',
    casino: 'The Lucky Gull. The wheel\'s honest, mostly, the horses run on the screens down the right, and the bar patches you up. Spend what you can afford to lose.',
    derby: 'Gull Downs! Pick a horse and a stake. The odds are on the board: a 4/1 shot pays four times your stake plus your money back, and the long shots pay big because they mostly lose. Then watch it run.',
    wardrobe: 'Everything you own hangs in here, and changing is free. Buy something at THREADS and it turns up in every place you own.',
    photo: function () { return 'Nice shot. Your photos are kept in the album — ' + (touch() ? 'PAUSE' : 'Esc') + ', then PHOTOS — and you can download the ones you like.'; }
  };

  function prefs() { GAME.prefs = GAME.prefs || {}; return GAME.prefs; }
  function seen() { var p = prefs(); return p.lolaSeen || (p.lolaSeen = {}); }
  function tipsOn() { return !prefs().tipsOff; }

  // The first time `key` comes up: say it (if tips are on) and remember it
  // was said either way, so switching tips back on later does not bring a
  // backlog of everything that happened while they were off.
  function first(key) {
    var line = TIPS[key];
    if (!line) return false;
    var s = seen();
    if (s[key]) return false;
    s[key] = true;
    if (GAME.save) GAME.save();
    if (!tipsOn() || !GAME.hud || !GAME.hud.pager) return false;
    GAME.hud.pager('LOLA', typeof line === 'function' ? line() : line);
    if (GAME.track) GAME.track('tip-' + key);
    return true;
  }
  function setTips(on) {
    prefs().tipsOff = !on;
    if (GAME.save) GAME.save();
  }

  return {
    first: first,
    setTips: setTips,
    get tips() { return tipsOn(); },
    keys: function () { return Object.keys(TIPS); },
    // headless: what a tip says, as it would be said now
    line: function (key) { var l = TIPS[key]; return typeof l === 'function' ? l() : l; }
  };
})();
