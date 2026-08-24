// Optional haptic feedback — a short buzz for the knocks you can already see.
//
// navigator.vibrate is an Android and desktop-Chrome API; iOS Safari has never
// shipped it, and a device without a motor no-ops it. So this is a bonus where
// the hardware and the browser agree and silence everywhere else, and nothing
// in the game may depend on it: every call here is safe when it is missing,
// refused, or switched off.
//
// The buzzes are rationed on purpose. A pile-up reports contact on every frame
// and a held trigger fires several times a second; with no floor between them
// the motor would simply stay on, which reads as a fault rather than as
// feedback. Inside the window only a HARDER knock gets through, the same rule
// the crash voice in audio.js uses to keep a pile-up from becoming a buzz.
GAME.haptics = (function () {
  var enabled = true;
  var lastT = -1e9, lastMs = 0;
  var WINDOW = 90;   // ms between buzzes, unless the new one is stronger
  var MAX = 60;      // nothing longer: past this it stops reading as an event

  function available() {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  function buzz(ms) {
    if (!enabled || !available()) return false;
    ms = Math.round(U.clamp(ms, 0, MAX));
    if (ms < 8) return false;   // shorter than a motor can render as anything
    var now = performance.now();
    if (now - lastT < WINDOW && ms <= lastMs) return false;
    lastT = now; lastMs = ms;
    // a browser may refuse (no user gesture yet, a background tab, a policy):
    // that is its business, and never the game's problem
    try { navigator.vibrate(ms); } catch (e) { }
    return true;
  }

  return {
    get available() { return available(); },
    get on() { return enabled; },
    setOn: function (v) {
      enabled = !!v;
      if (!enabled && available()) { try { navigator.vibrate(0); } catch (e) { } }
      return enabled;
    },
    // a camera shake, in the motor. 0..1 of fresh knock — the same number the
    // camera is about to shake by, so the two channels always agree.
    knock: function (s) { return buzz(10 + s * 45); },
    // the red flash when something takes a bite out of you
    hurt: function () { return buzz(22); },
    // your own trigger. Deliberately the lightest of the three: at automatic
    // fire rates the window rations it to a stutter rather than a drone, and
    // any real knock is stronger and preempts it anyway.
    shot: function () { return buzz(10); },
    // headless hooks: the buzz that WOULD be sent without needing a motor, and
    // a clear window to send it in — otherwise a test of one of the hooks is
    // really a test of whatever buzzed just before it
    testBuzz: function (ms) { return buzz(ms); },
    testReset: function () { lastT = -1e9; lastMs = 0; }
  };
})();
