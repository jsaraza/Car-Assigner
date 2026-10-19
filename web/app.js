/*
 * The phone app. Talks to the Apps Script backend (or the in-browser demo),
 * and shows Tomorrow, Week, My Plans and Changes.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- storage

  var LS = {
    get: function (k) {
      try { return localStorage.getItem('ca.' + k); } catch (e) { return null; }
    },
    set: function (k, v) {
      try {
        if (v == null) localStorage.removeItem('ca.' + k);
        else localStorage.setItem('ca.' + k, v);
      } catch (e) { /* private mode: settings just won't stick */ }
    }
  };

  // The family link looks like ...?api=<web app url>&key=<family key>.
  // It stays in the address so "Add to Home Screen" keeps it.
  var params = new URLSearchParams(location.search);
  if (params.get('api') && params.get('key')) {
    LS.set('api', params.get('api'));
    LS.set('key', params.get('key'));
    LS.set('mode', 'live');
  } else if (params.get('demo') === '1') {
    LS.set('mode', 'demo');
  }

  var S = {
    mode: LS.get('mode'),
    me: LS.get('me'),
    tab: LS.get('tab') || 'tomorrow',
    data: null,
    loadedAt: 0,
    skew: 0,
    error: null,
    log: null
  };

  // ---------------------------------------------------------------- backend

  function call(action, payload) {
    var req = Object.assign({ action: action, key: LS.get('key'), by: S.me }, payload || {});
    var p = S.mode === 'demo'
      ? Promise.resolve().then(function () { return DemoApi.call(req); })
      : fetch(LS.get('api'), {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(req)
        }).then(function (r) {
          if (!r.ok) throw new Error('The server said ' + r.status + '.');
          return r.json();
        });
    return p.then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Something went wrong.');
      return res;
    });
  }

  function load() {
    if (!S.data) render();
    return call('state', { days: 8 }).then(function (res) {
      S.data = res;
      S.loadedAt = Date.now();
      S.skew = res.now.ms - Date.now();
      S.error = null;
      if (S.me && !memberById(S.me)) S.me = null;
      render();
    }).catch(function (err) {
      S.error = err.message;
      render();
    });
  }

  // ---------------------------------------------------------------- helpers

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel) { return document.querySelector(sel); }
  function person(pid) {
    return (S.data.people || []).filter(function (p) { return p.id === pid; })[0] || null;
  }
  function memberById(pid) {
    var p = S.data && person(pid);
    return p && p.isMember ? p : null;
  }
  function amPlanner() {
    var p = memberById(S.me);
    return !!(p && p.isPlanner);
  }
  function plannerNames() {
    var names = S.data.people.filter(function (p) { return p.isPlanner; }).map(function (p) { return p.name; });
    return names.length ? names.join(' or ') : 'the planner';
  }
  function nameOf(pid) { var p = person(pid); return p ? p.name : pid; }
  function car(cid) { return (S.data.cars || []).filter(function (c) { return c.id === cid; })[0] || null; }
  function carNameOf(cid) { var c = car(cid); return c ? c.name : cid; }
  function today() { return S.data.now.date; }
  function dayOf(date) { return S.data.days.filter(function (d) { return d.date === date; })[0] || null; }
  function itemsOf(day) { return day.holds.concat(day.rides); }
  function findItem(day, key) { return itemsOf(day).filter(function (i) { return i.key === key; })[0] || null; }

  function fmtDate(date, long) {
    var p = date.split('-');
    var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
    return d.toLocaleDateString(undefined, {
      weekday: long ? 'long' : 'short', month: 'short', day: 'numeric', timeZone: 'UTC'
    });
  }
  function relDay(date) {
    if (date === today()) return 'Today';
    if (date === addDays(today(), 1)) return 'Tomorrow';
    return fmtDate(date, true);
  }
  function fmtRange(start, end) {
    var a = formatTime12(start);
    var b = formatTime12(end);
    if (a.slice(-2) === b.slice(-2)) a = a.slice(0, -2);
    return a + '–' + b;
  }
  function fmtLeft(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return m + 'm';
    var h = Math.floor(m / 60);
    return h < 24 ? h + 'h ' + (m % 60) + 'm' : Math.round(h / 24) + 'd';
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.hidden = true; }, 3500);
  }

  function issueLevel(day, key) {
    var level = '';
    day.issues.forEach(function (i) {
      if (i.keys.indexOf(key) < 0) return;
      if (i.level === 'error') level = 'err';
      else if (!level) level = 'warn';
    });
    return level;
  }

  // ---------------------------------------------------------------- render

  function render() {
    var view = $('#view');
    var chip = $('#me-chip');
    var tabs = $('#tabs');
    closeSheet();

    if (!S.mode) {
      chip.hidden = true;
      tabs.hidden = true;
      view.innerHTML = setupHtml();
      return;
    }
    if (S.error && !S.data) {
      chip.hidden = true;
      tabs.hidden = true;
      view.innerHTML = '<div class="card"><h2>Couldn\'t load the plan</h2><p class="muted">' + esc(S.error) +
        '</p><button class="btn primary block" data-act="reload">Try again</button>' +
        '<button class="btn block" data-act="forget">Use a different link</button></div>';
      return;
    }
    if (!S.data) {
      view.innerHTML = '<div class="center">Loading…</div>';
      return;
    }
    if (!S.me) {
      chip.hidden = true;
      tabs.hidden = true;
      view.innerHTML = pickHtml();
      return;
    }

    chip.hidden = false;
    chip.textContent = nameOf(S.me) + (amPlanner() ? ' · Planner' : '') + ' ▾';
    tabs.hidden = false;
    Array.prototype.forEach.call(tabs.querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === S.tab);
    });

    var html = '';
    if (S.mode === 'demo') {
      html += '<div class="banner">Demo with made-up data. Nothing is shared. ' +
        '<a href="#" data-act="exit-demo">Leave demo</a></div>';
    }
    if (S.error) html += '<div class="banner">' + esc(S.error) + '</div>';
    if (S.tab === 'week') html += weekHtml();
    else if (S.tab === 'plans') html += plansHtml();
    else if (S.tab === 'log') html += logHtml();
    else html += tomorrowHtml();
    view.innerHTML = html;
    if (S.tab === 'plans') syncPlanForm();
    tick();
  }

  function setupHtml() {
    return '<div class="card"><h2>Welcome</h2>' +
      '<p>Open the family link you were sent, or paste it here.</p>' +
      '<label for="link">Family link</label><input id="link" placeholder="https://…?api=…&amp;key=…" autocomplete="off">' +
      '<button class="btn primary block" data-act="use-link">Use this link</button></div>' +
      '<div class="card"><h2>Just looking?</h2>' +
      '<p class="muted">Try the app with made-up sample data. Nothing is shared.</p>' +
      '<button class="btn block" data-act="demo">Try the demo</button></div>';
  }

  function pickHtml() {
    var buttons = S.data.people.filter(function (p) { return p.isMember; }).map(function (p) {
      return '<button class="btn" data-act="pick" data-id="' + esc(p.id) + '">' + esc(p.name) +
        (p.isPlanner ? ' <span class="muted small">· planner</span>' : '') + '</button>';
    }).join('');
    return '<div class="card"><h2>Who are you?</h2><p class="muted">Pick your name. You can change it later.</p>' +
      '<div class="people">' + buttons + '</div></div>';
  }

  function tomorrowHtml() {
    var date = addDays(today(), 1);
    var day = dayOf(date);
    var html = '';
    if (day) {
      html += mySummaryHtml(day);
      html += dayHtml(day);
    }
    var t = dayOf(today());
    if (t && itemsOf(t).length) html += dayHtml(t);
    return html;
  }

  function mySummaryHtml(day) {
    var mine = itemsOf(day).filter(function (i) { return i.driver === S.me && (i.kind === 'ride' || i.car); });
    var body;
    if (!mine.length) {
      body = '<p>You\'re not driving anyone ' + relDay(day.date).toLowerCase() + '. 🎉</p>';
    } else {
      body = '<ul class="issues">' + mine.map(function (i) {
        return '<li><strong>' + (i.kind === 'ride' ? 'Leave by ' : 'From ') + esc(formatTime12(i.start)) + '</strong> · ' + esc(i.label) +
          (i.car ? ' · ' + esc(carNameOf(i.car)) : '') + '</li>';
      }).join('') + '</ul>';
    }
    return '<div class="card"><h3 style="margin-top:0">You, ' + esc(relDay(day.date).toLowerCase()) + '</h3>' + body + '</div>';
  }

  function weekHtml() {
    return S.data.days.map(dayHtml).join('');
  }

  function dayHtml(day) {
    var html = '<section class="card"><div class="day-head"><h2>' + esc(relDay(day.date)) +
      (day.date === today() || day.date === addDays(today(), 1) ? ' <span class="muted small">' + esc(fmtDate(day.date)) + '</span>' : '') +
      '</h2>' + lockHtml(day) + '</div>';

    if (!itemsOf(day).length) {
      return html + '<p class="muted">Nothing planned.</p></section>';
    }
    if (day.holds.length) {
      html += '<h3>Cars for the day</h3>' + day.holds.map(function (i) { return itemHtml(day, i); }).join('');
    }
    if (day.rides.length) {
      html += '<h3>Rides</h3>' + day.rides.map(function (i) { return itemHtml(day, i); }).join('');
    }
    if (day.issues.length) {
      html += '<ul class="issues">' + day.issues.map(function (i) {
        return '<li class="' + i.level + '">' + esc(i.message) + '</li>';
      }).join('') + '</ul>';
    } else {
      html += '<div class="all-good">✓ Everything is covered.</div>';
    }
    if (day.hasErrors && amPlanner()) {
      html += '<button class="btn block" data-act="suggest" data-date="' + day.date + '">Suggest a fix</button>';
    } else if (day.hasErrors && day.date >= today()) {
      html += '<p class="muted small">' + esc(plannerNames()) + ' assigns the rides. If you can\'t drive at some time, ' +
        'add it in My Plans so they know.</p>';
    }
    return html + '</section>';
  }

  function lockHtml(day) {
    if (day.date <= today()) return '<span class="lock locked">Locked</span>';
    if (day.late) return '<span class="lock locked">Locked · changes now are late</span>';
    var deadline = addDays(day.date, -1);
    var when = deadline === today() ? 'today' : fmtDate(deadline);
    return '<span class="lock" data-deadline="' + day.deadlineMs + '">Locks ' + esc(when) + ' at ' +
      esc(formatTime12(S.data.settings.cutoff)) + '<span class="left"></span></span>';
  }

  function itemHtml(day, it) {
    var level = issueLevel(day, it.key);
    var who;
    var none = false;
    if (it.kind === 'hold') {
      who = it.car ? carNameOf(it.car) : 'Needs a car';
      none = !it.car;
    } else if (!it.driver) {
      who = 'Needs a driver';
      none = true;
    } else {
      who = nameOf(it.driver) + ' · ' + (it.car ? carNameOf(it.car) : 'no car yet');
    }
    var sub = '';
    if (it.kind === 'ride') {
      var pickup = it.type === 'school_pm' || it.type === 'work_from' || it.type === 'pickup';
      sub = (pickup ? 'Pick up at ' : 'There by ') + formatTime12(it.at);
    }
    return '<button class="item ' + level + (it.driver === S.me ? ' mine' : '') + '" data-act="edit" data-date="' +
      day.date + '" data-key="' + esc(it.key) + '">' +
      '<span class="time">' + esc(fmtRange(it.start, it.end)) + '</span>' +
      '<span class="what">' + esc(it.label) + '</span>' +
      (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') +
      '<span class="who' + (none ? ' none' : '') + '">' + esc(who) + '</span></button>';
  }

  // Countdown on the lock labels; reload when a deadline passes.
  function tick() {
    var now = Date.now() + S.skew;
    var passed = false;
    Array.prototype.forEach.call(document.querySelectorAll('[data-deadline]'), function (el) {
      var left = Number(el.getAttribute('data-deadline')) - now;
      if (left <= 0) passed = true;
      var span = el.querySelector('.left');
      if (span) span.textContent = left > 0 && left < 86400000 ? ' · in ' + fmtLeft(left) : '';
    });
    if (passed && S.data && Date.now() - S.loadedAt > 30000) load();
  }

  // ---------------------------------------------------------------- editing

  function openSheet(html) {
    var sheet = $('#sheet');
    sheet.innerHTML = '<div class="sheet-body" role="dialog" aria-modal="true">' + html + '</div>';
    sheet.hidden = false;
  }
  function closeSheet() {
    var sheet = $('#sheet');
    sheet.hidden = true;
    sheet.innerHTML = '';
  }

  function openEditor(date, key) {
    var day = dayOf(date);
    var it = day && findItem(day, key);
    if (!it) return;
    var html = '<h2>' + esc(it.label) + '</h2><p class="muted">' + esc(relDay(date)) + ' · ' +
      esc(fmtRange(it.start, it.end)) + '</p>';
    var issues = day.issues.filter(function (i) { return i.keys.indexOf(key) >= 0; });
    var issuesHtml = issues.length ? '<ul class="issues">' + issues.map(function (i) {
      return '<li class="' + i.level + '">' + esc(i.message) + '</li>';
    }).join('') + '</ul>' : '';

    if (!amPlanner()) {
      html += '<p><strong>Driver:</strong> ' + esc(it.driver ? nameOf(it.driver) : 'not assigned yet') + '<br>' +
        '<strong>Car:</strong> ' + esc(it.car ? carNameOf(it.car) : 'not picked yet') + '</p>' + issuesHtml +
        '<p class="muted small">Only ' + esc(plannerNames()) + ' can change who drives. ' +
        'Busy then? Add it in My Plans and they\'ll see it.</p>' +
        '<button class="btn block" data-act="close">Close</button>';
      openSheet(html);
      return;
    }

    if (it.kind === 'ride') {
      html += '<label for="ed-driver">Driver</label><select id="ed-driver"><option value="">Nobody yet</option>' +
        S.data.people.filter(function (p) { return p.isDriver && p.id !== it.rider; }).map(function (p) {
          var free = !it.available || it.available.indexOf(p.id) >= 0;
          return '<option value="' + esc(p.id) + '"' + (p.id === it.driver ? ' selected' : '') + '>' +
            esc(p.name) + (p.isHelper ? ' (helper)' : '') + (free ? '' : ' (busy)') + '</option>';
        }).join('') + '</select>';
    }
    html += '<label for="ed-car">Car</label><select id="ed-car"></select>';

    html += issuesHtml;
    if (day.late) {
      html += '<div class="banner">This day is locked. Saving now is a <strong>late change</strong>: ' +
        'the people affected get an email and the calendar updates right away.</div>';
    }
    html += '<div class="row"><button class="btn" data-act="close">Cancel</button>' +
      '<button class="btn primary" data-act="save" data-date="' + date + '" data-key="' + esc(key) + '">Save</button></div>';
    openSheet(html);
    fillCars(it);
    var driverSel = $('#ed-driver');
    if (driverSel) driverSel.addEventListener('change', function () { fillCars(it); });
  }

  function fillCars(it) {
    var driverSel = $('#ed-driver');
    var driver = it.kind === 'hold' ? it.person : driverSel.value;
    var p = person(driver);
    var allowed = p ? p.canDrive : [];
    var sel = $('#ed-car');
    var current = sel.value || it.car;
    var cars = S.data.cars.filter(function (c) { return allowed.indexOf(c.id) >= 0; });
    if (cars.length && !cars.some(function (c) { return c.id === current; })) current = cars.length === 1 ? cars[0].id : '';
    sel.innerHTML = '<option value="">' + (driver ? 'Pick a car' : 'Pick a driver first') + '</option>' +
      cars.map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (c.id === current ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      }).join('');
    sel.disabled = !driver;
  }

  function save(date, key) {
    var driverSel = $('#ed-driver');
    var payload = { itemKey: key, driver: driverSel ? driverSel.value : '', car: $('#ed-car').value };
    var day = dayOf(date);
    busy(true);
    call('assign', payload).then(function (res) {
      var msg = !res.changed ? 'No change.' : day && day.late ? 'Saved. Late change: the people affected were emailed.' : 'Saved.';
      return load().then(function () { afterSave(msg, res.notified); });
    }).catch(function (err) { toast(err.message); busy(false); });
  }

  /** Toast after a save; in the demo, also show the notifications that would go to phones. */
  function afterSave(msg, notified) {
    notified = notified || [];
    var names = notified.map(function (n) { return n.name; });
    if (S.mode !== 'demo' || !notified.length) {
      toast(names.length ? msg + ' Notified ' + names.join(', ') + '.' : msg);
      return;
    }
    openSheet('<h2>Notifications sent</h2><p class="muted small">In the real app these pop up on each person\'s phone.</p>' +
      notified.map(function (n) {
        return '<div class="notif"><div class="notif-head">🚗 Family Cars · to ' + esc(n.name) + '</div>' +
          n.lines.map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') + '</div>';
      }).join('') + '<button class="btn block" data-act="close">OK</button>');
  }

  function busy(on) {
    Array.prototype.forEach.call(document.querySelectorAll('#sheet button'), function (b) { b.disabled = on; });
  }

  function openSuggest(date) {
    openSheet('<div class="center">Working it out…</div>');
    call('suggest', { date: date }).then(function (res) {
      var s = res.suggestion;
      var html = '<h2>Suggested fix</h2><p class="muted">' + esc(relDay(date)) + '</p>';
      if (s.changes.length) {
        html += '<ul class="issues">' + s.changes.map(function (c) {
          return '<li style="background:var(--bg)"><strong>' + esc(c.label) + '</strong><br>' +
            esc(c.fromText) + ' → <strong>' + esc(c.toText) + '</strong></li>';
        }).join('') + '</ul>';
      } else {
        html += '<p>No changes would help.</p>';
      }
      if (s.unresolved.length) {
        html += '<ul class="issues"><li class="error">Nobody is free (with a car they can drive) for: ' +
          esc(s.unresolved.join(', ')) + '. Someone needs to free up time or swap plans.</li></ul>';
      }
      if (res.late && s.changes.length) {
        html += '<div class="banner">This day is locked, so these are <strong>late changes</strong> and the people affected get notified.</div>';
      }
      html += '<div class="row"><button class="btn" data-act="close">Cancel</button>' +
        (s.changes.length ? '<button class="btn primary" data-act="apply" data-date="' + date + '">Apply</button>' : '') +
        '</div>';
      openSheet(html);
    }).catch(function (err) { closeSheet(); toast(err.message); });
  }

  function applySuggestion(date) {
    busy(true);
    call('applySuggestion', { date: date }).then(function (res) {
      var msg = 'Applied ' + res.applied + ' change' + (res.applied === 1 ? '' : 's') + '.';
      return load().then(function () { afterSave(msg, res.notified); });
    }).catch(function (err) { toast(err.message); busy(false); });
  }

  // ---------------------------------------------------------------- plans

  var PLAN_DEFAULTS = {
    busy: { start: '08:00', end: '15:00', startLabel: 'From', endLabel: 'To' },
    bus_lot: { start: '07:00', end: '16:30', startLabel: 'Leave', endLabel: 'Back' },
    pickup: { start: '17:00', end: '', startLabel: 'Pick me up at', endLabel: '' }
  };

  function plansHtml() {
    var tomorrow = addDays(today(), 1);
    var places = S.data.places.filter(function (p) { return p.id !== 'home'; });
    var planner = amPlanner();
    var html = notifyCardHtml() + '<div class="card"><h2>Add a plan</h2>' +
      '<p class="muted small">Block time you\'re not available, a day you take the car to the bus lot, or ask for a pickup.</p>' +
      (planner ? '<label for="pl-person">For</label><select id="pl-person">' +
        S.data.people.filter(function (p) { return p.isMember; }).map(function (p) {
          return '<option value="' + esc(p.id) + '"' + (p.id === S.me ? ' selected' : '') + '>' +
            esc(p.id === S.me ? p.name + ' (me)' : p.name) + '</option>';
        }).join('') + '</select>' : '') +
      '<label for="pl-type">What</label><select id="pl-type">' +
      Object.keys(PLAN_TYPES).map(function (k) { return '<option value="' + k + '">' + esc(PLAN_TYPES[k]) + '</option>'; }).join('') +
      '</select>' +
      '<label for="pl-date">Date</label><input type="date" id="pl-date" value="' + tomorrow + '" min="' + today() + '">' +
      '<div class="row"><div><label for="pl-start" id="pl-start-label">From</label><input type="time" id="pl-start"></div>' +
      '<div id="pl-end-wrap"><label for="pl-end" id="pl-end-label">To</label><input type="time" id="pl-end"></div></div>' +
      '<div id="pl-place-wrap" hidden><label for="pl-place">Where</label><select id="pl-place">' +
      places.map(function (p) {
        return '<option value="' + esc(p.id) + '"' + (p.id === S.data.settings.lotPlace ? ' selected' : '') + '>' + esc(p.name) + '</option>';
      }).join('') +
      '</select></div>' +
      '<label>Repeat every (optional)</label><div class="days">' +
      WEEK_ORDER.map(function (d) { return '<label><input type="checkbox" name="pl-day" value="' + d + '">' + d + '</label>'; }).join('') +
      '</div>' +
      '<div id="pl-until-wrap"><label for="pl-until">Until (optional)</label><input type="date" id="pl-until"></div>' +
      '<label for="pl-note">Note (optional)</label><input id="pl-note" maxlength="200" placeholder="e.g. Class, work, dentist">' +
      '<button class="btn primary block" data-act="add-plan">Add plan</button></div>';

    var mine = S.data.plans.filter(function (p) {
      var last = p.days.length ? (p.until || '9999-12-31') : p.date;
      return (planner || p.person === S.me) && last >= today();
    }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    html += '<div class="card"><h2>' + (planner ? 'Everyone\'s plans' : 'My plans') + '</h2>' + (mine.length ? mine.map(function (p) {
      return '<div class="plan"><div><strong>' + (planner ? esc(nameOf(p.person)) + ': ' : '') + esc(PLAN_TYPES[p.type]) + '</strong>' +
        (p.note ? ' · ' + esc(p.note) : '') + '<div class="muted small">' + esc(planWhen(p)) + '</div></div>' +
        '<button class="btn danger" data-act="del-plan" data-id="' + esc(p.id) + '">Remove</button></div>';
    }).join('') : '<p class="muted">No plans yet.</p>') + '</div>';
    return html;
  }

  function notifyCardHtml() {
    var me = person(S.me);
    var steps = '<ol class="small steps"><li>Install the free <strong>ntfy</strong> app ' +
      '(<a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener">iPhone</a> · ' +
      '<a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">Android</a>).</li>' +
      '<li>Tap <strong>+</strong> and subscribe to the channel below.</li></ol>';
    var html = '<div class="card"><h2>Phone notifications</h2>' +
      '<p class="muted small">Get a notification when you\'re assigned to drive, or when someone is dropping you off or picking you up.</p>';
    if (S.mode === 'demo') {
      return html + steps + '<p class="muted small">In the demo, saving a ride shows the notifications instead of sending them.</p></div>';
    }
    if (!me || !me.notifyTopic) {
      return html + '<p class="muted small">Notifications aren\'t set up yet. Run setup() in the Apps Script editor once more.</p></div>';
    }
    html += steps + topicRow(me.name + ' (you)', me.notifyTopic);
    if (amPlanner()) {
      var others = S.data.people.filter(function (p) { return p.id !== S.me && p.notifyTopic; });
      if (others.length) {
        html += '<p class="muted small" style="margin-top:12px">Everyone else\'s channel, for setting up their phones:</p>' +
          others.map(function (p) { return topicRow(p.name, p.notifyTopic); }).join('');
      }
    }
    return html + '</div>';
  }

  function topicRow(label, topic) {
    return '<div class="topic"><div><div class="small muted">' + esc(label) + '</div><code>' + esc(topic) + '</code></div>' +
      '<button class="btn" data-act="copy" data-text="' + esc(topic) + '">Copy</button></div>';
  }

  function planWhen(p) {
    var time = p.type === 'pickup'
      ? 'at ' + formatTime12(p.start) + (p.place ? ', ' + placeLabel(p.place) : '')
      : p.start == null ? 'all day' : fmtRange(p.start, p.end == null ? 1440 : p.end);
    var when = p.days.length
      ? 'Every ' + p.days.join(', ') + ' from ' + fmtDate(p.date) + (p.until ? ' until ' + fmtDate(p.until) : '')
      : fmtDate(p.date, true);
    return when + ' · ' + time;
  }

  function placeLabel(pid) {
    var p = S.data.places.filter(function (x) { return x.id === pid; })[0];
    return p ? p.name : pid;
  }

  function syncPlanForm() {
    var type = $('#pl-type');
    if (!type) return;
    var apply = function () {
      var d = PLAN_DEFAULTS[type.value];
      $('#pl-start').value = d.start;
      $('#pl-end').value = d.end;
      $('#pl-start-label').textContent = d.startLabel;
      $('#pl-end-label').textContent = d.endLabel;
      $('#pl-end-wrap').hidden = type.value === 'pickup';
      $('#pl-place-wrap').hidden = type.value !== 'pickup';
    };
    type.addEventListener('change', apply);
    apply();
  }

  function addPlan(btn) {
    var days = Array.prototype.map.call(document.querySelectorAll('input[name="pl-day"]:checked'), function (c) { return c.value; });
    var plan = {
      person: $('#pl-person') ? $('#pl-person').value : S.me,
      type: $('#pl-type').value,
      date: $('#pl-date').value,
      start: $('#pl-start').value,
      end: $('#pl-type').value === 'pickup' ? '' : $('#pl-end').value,
      place: $('#pl-place').value,
      days: days.join(','),
      until: days.length ? $('#pl-until').value : '',
      note: $('#pl-note').value
    };
    btn.disabled = true;
    call('addPlan', { plan: plan }).then(function () {
      toast('Plan added.');
      return load();
    }).catch(function (err) { toast(err.message); btn.disabled = false; });
  }

  function deletePlan(planId, btn) {
    if (!confirm('Remove this plan?')) return;
    btn.disabled = true;
    call('deletePlan', { id: planId }).then(function () {
      toast('Plan removed.');
      return load();
    }).catch(function (err) { toast(err.message); btn.disabled = false; });
  }

  // ---------------------------------------------------------------- log

  function logHtml() {
    if (!S.log) {
      loadLog();
      return '<div class="center">Loading changes…</div>';
    }
    if (!S.log.length) return '<div class="card"><h2>Changes</h2><p class="muted">No changes yet.</p></div>';
    return '<div class="card"><h2>Changes</h2>' + S.log.map(function (r) {
      return '<div class="log-row">' + (r.late ? '<span class="tag">LATE</span> ' : '') +
        '<strong>' + esc(r.what) + '</strong> <span class="muted">· ' + esc(r.date ? fmtDate(r.date) : '') + '</span>' +
        '<div>' + esc(r.from || '(none)') + ' → ' + esc(r.to || '(none)') + '</div>' +
        '<div class="muted small">' + esc(r.by) + ' · ' + esc(r.when) + '</div></div>';
    }).join('') + '</div>';
  }

  function loadLog() {
    call('log', { limit: 100 }).then(function (res) {
      S.log = res.log;
      if (S.tab === 'log') render();
    }).catch(function (err) {
      S.log = [];
      toast(err.message);
    });
  }

  // ---------------------------------------------------------------- events

  document.addEventListener('click', function (e) {
    var tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      S.tab = tabBtn.getAttribute('data-tab');
      LS.set('tab', S.tab);
      if (S.tab === 'log') S.log = null;
      render();
      window.scrollTo(0, 0);
      return;
    }
    if (e.target.id === 'sheet') { closeSheet(); return; }
    if (e.target.closest('#me-chip')) {
      S.me = null;
      LS.set('me', null);
      render();
      return;
    }
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (el.tagName === 'A') e.preventDefault();

    switch (act) {
      case 'use-link': {
        var url;
        try { url = new URL($('#link').value.trim()); } catch (err) { toast("That doesn't look like a link."); return; }
        var api = url.searchParams.get('api');
        var key = url.searchParams.get('key');
        if (!api || !key) { toast('That link is missing its family key.'); return; }
        location.href = location.pathname + '?api=' + encodeURIComponent(api) + '&key=' + encodeURIComponent(key);
        return;
      }
      case 'demo':
        location.href = location.pathname + '?demo=1';
        return;
      case 'exit-demo':
        DemoApi.reset();
        LS.set('mode', null);
        LS.set('me', null);
        location.href = location.pathname;
        return;
      case 'forget':
        LS.set('mode', null);
        LS.set('api', null);
        LS.set('key', null);
        location.href = location.pathname;
        return;
      case 'reload':
        S.error = null;
        S.data = null;
        load();
        return;
      case 'pick':
        S.me = el.getAttribute('data-id');
        LS.set('me', S.me);
        render();
        return;
      case 'edit':
        openEditor(el.getAttribute('data-date'), el.getAttribute('data-key'));
        return;
      case 'close':
        closeSheet();
        return;
      case 'save':
        save(el.getAttribute('data-date'), el.getAttribute('data-key'));
        return;
      case 'suggest':
        openSuggest(el.getAttribute('data-date'));
        return;
      case 'apply':
        applySuggestion(el.getAttribute('data-date'));
        return;
      case 'add-plan':
        addPlan(el);
        return;
      case 'copy': {
        var text = el.getAttribute('data-text');
        var done = function () { toast('Copied.'); };
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { prompt('Copy this:', text); });
        else prompt('Copy this:', text);
        return;
      }
      case 'del-plan':
        deletePlan(el.getAttribute('data-id'), el);
        return;
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSheet();
  });

  // Refresh when the app comes back to the foreground.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && S.mode && Date.now() - S.loadedAt > 60000) load();
  });
  setInterval(tick, 30000);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () { /* offline support is optional */ });
  }

  if (S.mode) load();
  else render();
})();
