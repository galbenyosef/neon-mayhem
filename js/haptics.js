// Optional haptic feedback — a short buzz for the knocks you can already see.
//
// navigator.vibrate is an Android and desktop-Chrome API; iOS Safari has never
// shipped it, and a device without a motor no-ops it. So this is a bonus where
// the hardware and the browser agree and silence everywhere else, and nothing
// in the game may depend on it: every call here is safe when it is missing,
// refused, or switched off.
//
// Two rules make a channel this narrow legible.
//
// SHAPE. navigator.vibrate takes a pattern — [on, off, on, ...], odd slots
// silent — and not just a duration. That matters more than it sounds: with
// length alone every event in the game would arrive as the same thud a little
// longer or shorter, which is worse than no feedback at all, because a player
// learns to ignore a channel that never says anything specific. Counting taps
// is the most readable haptic idiom there is, so the star patterns count.
// Gaps are 55 ms and up: a rotating-mass motor does not spin down inside a
// shorter one, so two pulses closer than that are felt as one long buzz.
//
// PRIORITY. A pile-up reports contact every frame, a held trigger fires several
// times a second, and a thumb on a button taps all day; with no floor between
// them the motor would simply stay on, which reads as a fault rather than as
// feedback. So each kind carries a tier, and inside the quiet window — or while
// a pattern is still playing — only a STRICTLY higher tier gets through. A
// stream of button taps can never stamp on a crash, and a crash can never be
// cut short by the tap that lands after it.
GAME.haptics = (function () {
  var enabled = true;
  var lastT = -1e9, lastPri = -1, lastEnergy = 0, busyUntil = -1e9;
  var last = null;         // what was last sent, for the headless checks
  var WINDOW = 90;         // ms of quiet after a buzz before an equal one may follow
  var MIN_PULSE = 8;       // shorter than a motor can render as anything
  var MAX_PULSE = 120;     // one pulse longer than this reads as a fault, not an event
  var MAX_SPAN = 600;      // and a pattern outlasting what it describes is noise

  // Who may interrupt whom.
  var PRI = {
    UI: 0,       // a button under your thumb
    LIGHT: 1,    // your own trigger, a round connecting, something picked up
    NOTE: 2,     // a checkpoint, a refusal
    BODY: 3,     // something hit you, or you hit something
    STATE: 4,    // the law, or the car, changing what the next minute looks like
    ALARM: 5     // act now or the game is over
  };

  function available() {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  // Normalise to the array form and clamp it. A scalar is a one-pulse pattern.
  function clean(pattern) {
    var arr = Array.isArray(pattern) ? pattern : [pattern];
    var span = 0, energy = 0, out = [];
    for (var i = 0; i < arr.length; i++) {
      var v = Math.round(U.clamp(arr[i] || 0, 0, MAX_PULSE));
      // An ON slot too short to render drops the rest of the pattern with it.
      // Keeping the gap that followed would only shift the tail out of time,
      // and a pattern felt out of time is a different pattern.
      if (i % 2 === 0 && v < MIN_PULSE) break;
      if (span + v > MAX_SPAN) break;
      span += v; if (i % 2 === 0) energy += v; out.push(v);
    }
    // never end on a gap: a trailing pause is time the caller cannot feel
    if (out.length % 2 === 0) { span -= out.pop(); }
    return out.length ? { p: out, span: span, energy: energy } : null;
  }

  function send(pattern, pri) {
    if (!enabled || !available()) return false;
    var c = clean(pattern);
    if (!c) return false;
    var now = performance.now();
    // Busy, or still inside the quiet window. Two ways past it, and both
    // matter: a higher TIER always preempts, and inside one tier the harder
    // knock still wins on motor time — which is the rule that lets the big
    // hit in a pile-up through while the taps around it are dropped.
    if (now < busyUntil || now - lastT < WINDOW) {
      if (pri < lastPri) return false;
      if (pri === lastPri && c.energy <= lastEnergy) return false;
    }
    lastT = now; lastPri = pri; lastEnergy = c.energy; busyUntil = now + c.span;
    last = { pattern: c.p, pri: pri, span: c.span, energy: c.energy };
    // a browser may refuse (no user gesture yet, a background tab, a policy):
    // that is its business, and never the game's problem
    try { navigator.vibrate(c.p.length === 1 ? c.p[0] : c.p); } catch (e) { }
    return true;
  }

  return {
    get available() { return available(); },
    get on() { return enabled; },
    PRI: PRI,
    setOn: function (v) {
      enabled = !!v;
      if (!enabled && available()) { try { navigator.vibrate(0); } catch (e) { } }
      return enabled;
    },

    // ---- impacts: things your hands would actually feel ----

    // a camera shake, in the motor. 0..1 of fresh knock — the same number the
    // camera is about to shake by, so the two channels always agree.
    // Clamped here rather than left to the module's own ceiling: 55 ms is this
    // channel's tuned top end, and MAX_PULSE is twice that so the deliberate
    // long patterns below have somewhere to go.
    knock: function (s) { return send(10 + U.clamp(s, 0, 1) * 45, PRI.BODY); },
    // the red flash when something takes a bite out of you
    hurt: function () { return send(22, PRI.BODY); },
    // your own trigger. Deliberately the lightest thing here: at automatic fire
    // rates the window rations it to a stutter rather than a drone, and any
    // real knock is stronger and preempts it anyway.
    shot: function () { return send(10, PRI.LIGHT); },
    // a round CONNECTING, as against merely leaving the barrel. Fired in the
    // same frame as the shot above and one tier over it, so it preempts rather
    // than queues: a hit is a single firmer tick, a miss the light one. A
    // double-tap would read better still, but at automatic rates its span
    // outlasts the gap between rounds and the motor never gets to stop.
    hit: function () { return send(26, PRI.NOTE); },
    // somebody went under the wheels. A body is not a wall, so it is not the
    // wall's single sharp thud: the bonnet, then the weight of it passing
    // beneath, the second scaled by how fast you were going. 0..1.
    splat: function (s) { return send([16, 60, 12 + U.clamp(s, 0, 1) * 28], PRI.BODY); },

    // ---- the law ----

    // Stars gained, counted out in taps — one per star up to three, with the
    // last held longer the higher it goes, so five reads as heavier than three
    // without taking five taps to say so.
    wantedUp: function (n) {
      var taps = U.clamp(Math.floor(n), 1, 3), p = [];
      for (var i = 0; i < taps; i++) {
        if (i) p.push(65);
        p.push(i === taps - 1 ? 20 + n * 8 : 20);
      }
      return send(p, PRI.STATE);
    },
    // and shaken off: the same idea upside down, heavy falling to light, so
    // you know you are clear without looking up at the HUD to check
    wantedClear: function () { return send([55, 70, 20], PRI.STATE); },

    // ---- warnings ----

    // the ride is on fire and there is about a second to get out of it. The
    // only pattern here allowed to insist.
    onFire: function () { return send([60, 70, 60, 70, 60], PRI.ALARM); },
    // and the gentler one: still driveable, but it won't take much more
    smoking: function () { return send([26, 70, 26], PRI.STATE); },

    // ---- rewards ----

    // a mission, a race, a shift: two taps and a flourish
    win: function () { return send([30, 65, 30, 65, 70], PRI.STATE); },
    // a jump scored. Lands in the same frame as the landing thud and outranks
    // it on purpose — the fanfare is the more informative of the two, and you
    // felt the landing through the car anyway.
    stunt: function () { return send([22, 60, 22, 60, 50], PRI.STATE); },
    checkpoint: function () { return send([16, 55, 16], PRI.NOTE); },
    pickup: function () { return send(14, PRI.LIGHT); },
    // no. The universal flat double buzz — you are short, or it is not yours.
    deny: function () { return send([38, 60, 38], PRI.NOTE); },

    // ---- the end of a life ----

    wasted: function () { return send([120, 80, 90, 80, 60], PRI.ALARM); },
    busted: function () { return send([70, 70, 70, 70, 70], PRI.ALARM); },

    // ---- the screen you are touching ----

    // A virtual button has no travel and no click, so without this it never
    // feels pressed at all. Bottom tier: it must never be able to suppress
    // anything the world is trying to say.
    uiTap: function () { return send(9, PRI.UI); },

    // headless hooks: the buzz that WOULD be sent without needing a motor, what
    // it was, and a clear window to send it in — otherwise a test of one hook
    // is really a test of whatever buzzed just before it
    testBuzz: function (ms, pri) { return send(ms, pri === undefined ? PRI.BODY : pri); },
    testLast: function () { return last; },
    testReset: function () { lastT = -1e9; lastPri = -1; lastEnergy = 0; busyUntil = -1e9; last = null; }
  };
})();
