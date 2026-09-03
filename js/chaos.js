// How much the city fights with itself.
//
// Everything social that the strangers on the pavement do to each OTHER —
// squaring up over a bump, a driver getting out to argue, the odd one who is
// carrying, and whether the police care — is rated off this one knob, so a
// player who wants a quiet city can have one and a player who wants the place
// on fire can have that instead.
//
// OFF is not "a bit calmer". It is the game exactly as it was before any of
// this existed: every rate below is zero, every gate reads false, and no code
// path that this module gates can run at all. That makes the switch an escape
// hatch as well as a preference — if the crowd turns out to be irritating in
// some way nobody predicted, one press puts it back.
GAME.chaos = (function () {
  var KEY = 'nm_chaos';
  var NAMES = ['OFF', 'CALM', 'NORMAL', 'LIVELY', 'MAYHEM'];

  // One row per level. Rates are per-second-per-candidate unless noted; the
  // chances are rolled once per provocation.
  //
  // These are not a smooth curve on purpose. CALM is meant to read as "people
  // notice things" — flinches, shouting, someone stepping back — with a real
  // fight being a surprise. The jump into LIVELY is where scuffles stop being
  // an event and start being scenery, and MAYHEM is deliberately past what
  // anyone would call realistic.
  // The range column is the one that actually decides how much fighting there
  // is, which was not obvious until it was measured. Eighteen people spread
  // over a 150 m bubble are mostly alone: at 9 m only 6% of the hot-tempered
  // have anyone at all to argue with, so the rate barely matters — CALM,
  // NORMAL and LIVELY all came out at one fight a minute, indistinguishable.
  // Availability by radius, measured: 9 m 6%, 14 m 14%, 20 m 33%, 28 m 53%,
  // 40 m 70%. So range carries the level and the rate is fine trim.
  //
  // It reads better this way too. At CALM a fight is someone you were already
  // standing next to; at MAYHEM people cross the road to find one.
  // The numbers come from sweeping rate against range and counting fights over
  // three minutes a point, not from a model — two attempts at predicting this
  // arithmetically were both wrong. What the sweep gives, in fights per minute
  // with the player parked and doing nothing:
  //
  //   0.016 / 10 m -> 0.7      0.022 / 20 m -> 4.3      0.05 / 42 m ->  9.7
  //   0.018 / 13 m -> 3.0      0.024 / 24 m -> 3.3      0.07 / 42 m -> 19.7
  //   0.020 / 16 m -> 2.0      0.024 / 28 m -> 5.7
  //
  // The middle of that is not monotone, which is the measurement telling you
  // three minutes is not enough samples at these rates — worth about ±1.5/min
  // there. So the levels are placed on the points that are far enough apart to
  // be real, rather than fitted to the curve: roughly 0.7, 2.5, 5.7 and 20.
  var ROWS = [
    // name    react  fight  spark  range  armed  police  maxFights
    ['OFF',    0,     0,     0,     0,     0,     false,  0],
    ['CALM',   0.55,  0.10,  0.016, 10,    0,     true,   1],
    ['NORMAL', 0.85,  0.28,  0.018, 14,    0.02,  true,   2],
    ['LIVELY', 1,     0.50,  0.024, 28,    0.06,  true,   3],
    ['MAYHEM', 1,     0.85,  0.070, 42,    0.18,  true,   5]
  ];

  // LIVELY. The city being too quiet is the thing being fixed, so the default
  // has to be loud enough that a player notices without going looking.
  var idx = 3;
  try {
    var saved = localStorage.getItem(KEY);
    if (saved !== null) {
      var n = parseInt(saved, 10);
      if (n >= 0 && n < ROWS.length) idx = n;
    }
  } catch (e) { }

  function row() { return ROWS[idx]; }

  var api = {
    // the level itself
    get level() { return idx; },
    get name() { return NAMES[idx]; },
    get on() { return idx > 0; },
    levels: NAMES.slice(),

    // Does anyone react at all to being shoved, hit or cut up? Below this
    // the pavement is the old scenery that walks through everything.
    get reactChance() { return row()[1]; },
    // Given that they reacted: do they square up, or back off?
    get fightChance() { return row()[2]; },
    // Strangers finding a reason on their own, per candidate per second.
    get sparkRate() { return row()[3]; },
    // How far one will go looking. See the note on ROWS — this, not the
    // rate above, is what separates one level from the next.
    get sparkRange() { return row()[4]; },
    // Of those who square up, how many are carrying.
    get armedChance() { return row()[5]; },
    // Do the police care about any of it?
    get policeRespond() { return row()[6]; },
    // A ceiling on simultaneous brawls in the bubble, so a bad roll cannot
    // turn every stroller in sight into a boxer at once.
    get maxFights() { return row()[7]; },

    set: function (n) {
      idx = Math.max(0, Math.min(ROWS.length - 1, n | 0));
      try { localStorage.setItem(KEY, String(idx)); } catch (e) { }
      return idx;
    },
    cycle: function () { return api.set((idx + 1) % ROWS.length); },

    // one place for "roll a die against a chaos rate", so a caller cannot
    // accidentally run a gated behaviour at OFF by forgetting the check
    roll: function (chance) { return idx > 0 && chance > 0 && Math.random() < chance; },
    // the same, for a rate over a period
    rollRate: function (perSecond, dt) { return idx > 0 && perSecond > 0 && Math.random() < perSecond * dt; }
  };
  return api;
})();
