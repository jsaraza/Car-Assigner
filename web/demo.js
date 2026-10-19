/*
 * Demo mode: the whole backend running in the browser on sample data, so the
 * app can be tried before the Google Sheet is set up. Nothing leaves the phone.
 */
var DemoApi = (function () {
  var STORAGE_KEY = 'ca.demo.tables';
  var store = null;

  function localNow() {
    var d = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return {
      date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
      minutes: d.getHours() * 60 + d.getMinutes(),
      ms: d.getTime()
    };
  }

  function getStore() {
    if (store) return store;
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { saved = null; }
    store = createMemoryStore(saved || sampleTables(localNow().date));
    return store;
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(getStore().tables)); } catch (e) { /* private mode */ }
  }

  function env() {
    var now = localNow();
    var cutoff = normalizeData(getStore().load()).settings.cutoff;
    return {
      store: getStore(),
      now: now,
      deadlineMs: function (date) {
        var p = addDays(date, -1).split('-');
        return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), Math.floor(cutoff / 60), cutoff % 60).getTime();
      },
      onLate: function () { /* the real app emails and updates the calendar here */ }
    };
  }

  return {
    call: function (req) {
      try {
        var res = runAction(req, env());
        save();
        return res;
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    reset: function () {
      store = null;
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    }
  };
})();
