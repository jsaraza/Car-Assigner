/*
 * What the app can ask for. Shared by the real backend (Api.js, which stores
 * data in the Google Sheet) and the demo (which keeps it in the browser).
 *
 * env = {
 *   store:      { load, upsertAssignment, appendLog, addPlan, deletePlan, readLog },
 *   now:        { date: 'YYYY-MM-DD', minutes, ms },
 *   deadlineMs: function (date) -> epoch ms when that day's plan locks,
 *   onLate:     function ({ dates, by, changes, notifyAll }) -> void
 * }
 */

function runAction(req, env) {
  var handlers = {
    state: actState,
    assign: actAssign,
    suggest: actSuggest,
    applySuggestion: actApplySuggestion,
    addPlan: actAddPlan,
    deletePlan: actDeletePlan,
    log: actLog
  };
  var handler = handlers[req && req.action];
  if (!handler) throw new Error('Unknown action.');
  return handler(req, env, normalizeData(env.store.load()));
}

function actState(req, env, data) {
  var from = normalizeDate(req.from) || env.now.date;
  var count = Math.max(1, Math.min(31, Number(req.days) || 8));
  var days = planDays(data, from, count, env.now);
  days.forEach(function (d) { d.deadlineMs = env.deadlineMs(d.date); });
  return {
    ok: true,
    now: env.now,
    settings: { cutoff: data.settings.cutoff, alert: data.settings.alert, lotPlace: data.settings.lotPlace },
    people: data.people.filter(function (p) { return p.active; }).map(function (p) {
      return {
        id: p.id, name: p.name, canDrive: p.canDrive,
        isDriver: isDriver(p), isPlanner: isPlanner(data, p), isMember: isMember(data, p)
      };
    }),
    cars: data.cars.map(function (c) { return { id: c.id, name: c.name, isEv: c.isEv }; }),
    places: Object.keys(data.places).map(function (k) { return data.places[k]; }),
    plans: data.plans,
    days: days
  };
}

function actAssign(req, env, data) {
  var by = requirePlanner(data, req.by);
  var key = String(req.itemKey || '');
  var date = normalizeDate(key.slice(0, 10));
  if (!date) throw new Error('Missing ride.');
  var day = buildDay(data, date);
  var item = findItem(day, key);
  if (!item) throw new Error('That ride is no longer on the schedule. Refresh and try again.');

  var driver = item.kind === 'hold' ? item.person : id(req.driver);
  var car = id(req.car);
  if (driver && !personById(data, driver)) throw new Error('Unknown person.');
  if (car && !carById(data, car)) throw new Error('Unknown car.');
  if (driver && car && personById(data, driver).canDrive.indexOf(car) < 0) {
    throw new Error(personName(data, driver) + " can't drive the " + carName(data, car) + '.');
  }

  var change = writeChoice(data, env, by, item, driver, car);
  if (change && change.late) env.onLate({ dates: [date], by: by.id, changes: [change] });
  return { ok: true, changed: !!change };
}

function actSuggest(req, env, data) {
  var date = normalizeDate(req.date);
  if (!date) throw new Error('Missing date.');
  return { ok: true, suggestion: suggestDay(data, buildDay(data, date)), late: isLateNow(data, env, date) };
}

function actApplySuggestion(req, env, data) {
  var by = requirePlanner(data, req.by);
  var date = normalizeDate(req.date);
  if (!date) throw new Error('Missing date.');
  var day = buildDay(data, date);
  var suggestion = suggestDay(data, day);
  var changes = [];
  suggestion.changes.forEach(function (ch) {
    var change = writeChoice(data, env, by, findItem(day, ch.key), ch.driver, ch.car);
    if (change) changes.push(change);
  });
  var late = changes.filter(function (c) { return c.late; });
  if (late.length) env.onLate({ dates: [date], by: by.id, changes: late });
  return { ok: true, applied: changes.length, unresolved: suggestion.unresolved };
}

function actAddPlan(req, env, data) {
  var by = requireMember(data, req.by);
  var p = req.plan || {};
  var type = id(p.type);
  if (!PLAN_TYPES[type]) throw new Error('Pick what kind of plan this is.');
  var date = normalizeDate(p.date);
  if (!date) throw new Error('Pick a date.');
  var start = toMinutes(p.start);
  var end = toMinutes(p.end);
  if (type === 'pickup') {
    if (start == null) throw new Error('Pick a pickup time.');
    if (!id(p.place) || !data.places[id(p.place)]) throw new Error('Pick where to be picked up.');
    end = null;
  } else if (start != null && end != null && end <= start) {
    throw new Error('The end time has to be after the start time.');
  }
  var days = normalizeDays(p.days);
  var until = normalizeDate(p.until);
  if (until && until < date) throw new Error('"Until" has to be after the start date.');

  var forPerson = by;
  if (p.person && id(p.person) !== by.id) {
    if (!isPlanner(data, by)) throw new Error('You can only add plans for yourself.');
    forPerson = personById(data, id(p.person));
    if (!forPerson || !forPerson.active) throw new Error('Unknown person.');
  }

  var row = {
    id: 'p' + env.now.ms.toString(36) + Math.floor(Math.random() * 1296).toString(36),
    person: forPerson.id,
    type: type,
    date: date,
    start: start == null ? '' : fromMinutes(start),
    end: end == null ? '' : fromMinutes(end),
    days: days.join(','),
    until: until || '',
    place: type === 'pickup' ? id(p.place) : '',
    note: String(p.note || '').trim().slice(0, 200)
  };
  env.store.addPlan(row);
  var plan = normalizeData({ plans: [row] }).plans[0];
  recordPlanChange(data, env, by, plan, 'Added', '', planSummary(data, plan));
  return { ok: true, plan: plan };
}

function actDeletePlan(req, env, data) {
  var by = requireMember(data, req.by);
  var plan = null;
  data.plans.forEach(function (p) { if (p.id === String(req.id)) plan = p; });
  if (!plan) throw new Error('That plan was already removed.');
  if (plan.person !== by.id && !isPlanner(data, by)) throw new Error('You can only remove your own plans.');
  env.store.deletePlan(plan.id);
  recordPlanChange(data, env, by, plan, 'Removed', planSummary(data, plan), '');
  return { ok: true };
}

function actLog(req, env) {
  return { ok: true, log: env.store.readLog(Math.max(1, Math.min(200, Number(req.limit) || 50))) };
}

// ---------------------------------------------------------------------------

function requireMember(data, by) {
  var p = personById(data, id(by));
  if (!isMember(data, p)) throw new Error('Pick your name first.');
  return p;
}

function requirePlanner(data, by) {
  var p = requireMember(data, by);
  if (!isPlanner(data, p)) throw new Error('Only ' + plannerNames(data) + ' can change who drives.');
  return p;
}

function plannerNames(data) {
  var names = data.people.filter(function (p) { return isPlanner(data, p); }).map(function (p) { return p.name; });
  return names.length ? names.join(' or ') : 'the planner';
}

function isLateNow(data, env, date) {
  return isLate(date, env.now.date, env.now.minutes, data.settings.cutoff);
}

function stamp(env) {
  return env.now.date + ' ' + fromMinutes(env.now.minutes);
}

/** Saves a driver/car choice and logs it. Returns the change, or null if nothing changed. */
function writeChoice(data, env, by, item, driver, car) {
  driver = driver || '';
  car = car || '';
  if (item.car === car && (item.kind === 'hold' || item.driver === driver)) return null;
  var date = item.key.slice(0, 10);
  var late = isLateNow(data, env, date);
  var change = {
    key: item.key,
    label: item.label,
    before: describeChoice(data, item, item.driver, item.car),
    after: describeChoice(data, item, driver, car),
    late: late,
    people: uniq([item.driver, driver].filter(Boolean))
  };
  env.store.upsertAssignment({
    key: item.key,
    date: date,
    kind: item.kind,
    driver: item.kind === 'hold' ? item.person : driver,
    car: car,
    updated_by: by.id,
    updated_at: stamp(env)
  });
  env.store.appendLog({
    when: stamp(env), by: by.name, date: date, what: item.label,
    from: change.before, to: change.after, late: late ? 'LATE' : ''
  });
  item.driver = item.kind === 'hold' ? item.person : driver;
  item.car = car;
  return change;
}

/** Logs a plan change; if it touches a day that's already locked, tells everyone. */
function recordPlanChange(data, env, by, plan, verb, before, after) {
  var lateDates = [env.now.date, addDays(env.now.date, 1)].filter(function (d) {
    return planAppliesOn(plan, d) && isLateNow(data, env, d);
  });
  env.store.appendLog({
    when: stamp(env), by: by.name, date: plan.date,
    what: verb + ' plan: ' + PLAN_TYPES[plan.type] + (plan.person !== by.id ? ' for ' + personName(data, plan.person) : ''),
    from: before, to: after, late: lateDates.length ? 'LATE' : ''
  });
  if (lateDates.length) {
    env.onLate({
      dates: lateDates,
      by: by.id,
      notifyAll: true,
      changes: [{ label: personName(data, plan.person) + ' - ' + PLAN_TYPES[plan.type], before: before || '(none)', after: after || '(removed)', late: true, people: [] }]
    });
  }
}

function planSummary(data, plan) {
  var when = plan.type === 'pickup'
    ? 'at ' + formatTime12(plan.start) + (plan.place ? ', ' + placeName(data, plan.place) : '')
    : (plan.start == null ? 'all day' : formatTime12(plan.start) + '-' + formatTime12(orDefault(plan.end, 1440)));
  var repeat = plan.days.length
    ? 'every ' + plan.days.join(', ') + ' from ' + plan.date + (plan.until ? ' until ' + plan.until : '')
    : plan.date;
  return PLAN_TYPES[plan.type] + ', ' + repeat + ', ' + when + (plan.note ? ' (' + plan.note + ')' : '');
}

// ---------------------------------------------------------------------------
// In-memory store, for the demo and the tests.
// ---------------------------------------------------------------------------

function createMemoryStore(tables) {
  var t = JSON.parse(JSON.stringify(tables));
  Object.keys(TABLES).forEach(function (k) { t[k] = t[k] || []; });
  return {
    tables: t,
    load: function () { return JSON.parse(JSON.stringify(t)); },
    upsertAssignment: function (row) {
      for (var i = 0; i < t.assignments.length; i++) {
        if (t.assignments[i].key === row.key) {
          Object.keys(row).forEach(function (k) { t.assignments[i][k] = row[k]; });
          return;
        }
      }
      t.assignments.push(row);
    },
    appendLog: function (row) { t.log.push(row); },
    addPlan: function (row) { t.plans.push(row); },
    deletePlan: function (planId) {
      t.plans = t.plans.filter(function (p) { return String(p.id) !== String(planId); });
    },
    readLog: function (limit) { return t.log.slice(-limit).reverse(); }
  };
}
