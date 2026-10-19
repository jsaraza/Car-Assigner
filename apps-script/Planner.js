/*
 * The planner: turns the sheet data into each day's rides and car holds,
 * checks them against the family's rules, and suggests fixes.
 *
 * Two kinds of things need a car on a given day:
 *   ride - someone has to drive someone else (brothers to school, Mom to work,
 *          a pickup request). Needs a driver and a car.
 *   hold - someone keeps a car for a stretch of the day (Dad and Sister
 *          commuting, a bus-lot day). The holder is the driver; needs a car.
 *
 * Rides and holds are worked out from the schedules every time, never stored.
 * Only the choices people make (driver + car) are stored, in Assignments,
 * keyed by the item's key.
 */

// ---------------------------------------------------------------------------
// Reading the sheet
// ---------------------------------------------------------------------------

/** Raw tables (arrays of {column: string}) -> clean data the planner uses. */
function normalizeData(tables) {
  var raw = {};
  (tables.settings || []).forEach(function (r) {
    var k = String(r.key == null ? '' : r.key).trim();
    if (k) raw[k] = String(r.value == null ? '' : r.value).trim();
  });

  var settings = {
    cutoff: orDefault(toMinutes(raw.cutoff_time), 17 * 60),
    alert: orDefault(toMinutes(raw.alert_time), 12 * 60),
    schoolDropoff: toMinutes(raw.school_dropoff),
    schoolPickup: toMinutes(raw.school_pickup),
    schoolDays: normalizeDays(raw.school_days || 'Mon-Fri'),
    schoolRider: id(raw.school_rider),
    schoolPlace: id(raw.school_place),
    schoolFirstDay: normalizeDate(raw.school_first_day),
    schoolLastDay: normalizeDate(raw.school_last_day),
    lotPlace: id(raw.bus_lot_place),
    planners: splitList(raw.planners),
    evPreference: raw.ev_to_longest_commute === undefined || raw.ev_to_longest_commute === '' ||
      isTrue(raw.ev_to_longest_commute),
    calendarId: raw.calendar_id || '',
    apiUrl: raw.api_url || '',
    appUrl: raw.app_url || ''
  };

  var people = (tables.people || []).filter(function (r) { return id(r.id); }).map(function (r) {
    return {
      id: id(r.id),
      name: String(r.name || r.id).trim(),
      phone: String(r.phone || '').trim().toLowerCase(),
      email: String(r.email || '').trim(),
      canDrive: splitList(r.can_drive),
      drivesSelf: isTrue(r.drives_self_to_work),
      getsRides: isTrue(r.gets_rides_to_work),
      workPlace: id(r.work_place),
      commute: Number(r.commute_minutes) || 0,
      active: String(r.active == null ? '' : r.active).trim() === '' || isTrue(r.active)
    };
  });

  var cars = (tables.cars || []).filter(function (r) { return id(r.id); }).map(function (r) {
    return {
      id: id(r.id),
      name: String(r.name || r.id).trim(),
      isEv: isTrue(r.is_ev),
      bluetooth: String(r.bluetooth_name || '').trim()
    };
  });

  var places = {};
  (tables.places || []).forEach(function (r) {
    var pid = id(r.id);
    if (pid) places[pid] = { id: pid, name: String(r.name || pid).trim(), minutes: Number(r.minutes_from_home) || 0 };
  });

  var shifts = [];
  (tables.shifts || []).forEach(function (r) {
    var date = normalizeDate(r.date);
    var start = toMinutes(r.start);
    var end = toMinutes(r.end);
    if (!id(r.person) || !date || start == null || end == null) return;
    if (end <= start) end = 1440; // overnight shifts are cut off at midnight
    shifts.push({ person: id(r.person), date: date, start: start, end: end, note: String(r.note || '') });
  });

  var school = {};
  (tables.school || []).forEach(function (r) {
    var date = normalizeDate(r.date);
    if (!date) return;
    school[date] = {
      noSchool: isTrue(r.no_school),
      dropoff: toMinutes(r.dropoff),
      pickup: toMinutes(r.pickup),
      note: String(r.note || '')
    };
  });

  var plans = [];
  (tables.plans || []).forEach(function (r) {
    var date = normalizeDate(r.date);
    var type = id(r.type);
    if (!id(r.id) || !id(r.person) || !date || !PLAN_TYPES[type]) return;
    plans.push({
      id: String(r.id).trim(),
      person: id(r.person),
      type: type,
      date: date,
      start: toMinutes(r.start),
      end: toMinutes(r.end),
      days: normalizeDays(r.days),
      until: normalizeDate(r.until),
      place: id(r.place),
      note: String(r.note || '').trim()
    });
  });

  var assignments = {};
  (tables.assignments || []).forEach(function (r) {
    var key = String(r.key || '').trim();
    if (!key) return;
    assignments[key] = {
      key: key,
      date: normalizeDate(r.date) || key.slice(0, 10),
      kind: String(r.kind || '').trim(),
      driver: id(r.driver),
      car: id(r.car),
      eventId: String(r.event_id || '').trim(),
      synced: String(r.synced || '').trim()
    };
  });

  return {
    settings: settings,
    people: people,
    cars: cars,
    places: places,
    shifts: shifts,
    school: school,
    plans: plans,
    assignments: assignments
  };
}

function id(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

function orDefault(v, d) {
  return v == null ? d : v;
}

function personById(data, pid) {
  for (var i = 0; i < data.people.length; i++) if (data.people[i].id === pid) return data.people[i];
  return null;
}

function carById(data, cid) {
  for (var i = 0; i < data.cars.length; i++) if (data.cars[i].id === cid) return data.cars[i];
  return null;
}

function personName(data, pid) {
  var p = personById(data, pid);
  return p ? p.name : pid;
}

function carName(data, cid) {
  var c = carById(data, cid);
  return c ? c.name : cid;
}

function placeName(data, pid) {
  return data.places[pid] ? data.places[pid].name : pid;
}

function isDriver(person) {
  return !!person && person.active && person.canDrive.length > 0;
}

/**
 * Planners decide who drives. With no planners set in Settings, every driver
 * can plan.
 */
function isPlanner(data, person) {
  if (!person || !person.active) return false;
  if (!data.settings.planners.length) return isDriver(person);
  return data.settings.planners.indexOf(person.id) >= 0;
}

/** People who use the app: drivers and planners. */
function isMember(data, person) {
  return isDriver(person) || isPlanner(data, person);
}

function planAppliesOn(plan, date) {
  if (!plan.days.length) return plan.date === date;
  if (date < plan.date) return false;
  if (plan.until && date > plan.until) return false;
  return plan.days.indexOf(dayName(date)) >= 0;
}

// ---------------------------------------------------------------------------
// Building a day
// ---------------------------------------------------------------------------

/** Everything that needs a car on `date`, with saved assignments filled in. */
function buildDay(data, date) {
  var st = data.settings;
  var rides = [];
  var holds = [];
  var busy = {};

  function minutesTo(placeId) {
    return data.places[placeId] ? data.places[placeId].minutes : 0;
  }
  function addBusy(pid, start, end, reason) {
    (busy[pid] = busy[pid] || []).push({ start: start, end: end, reason: reason });
  }
  function addRide(type, rider, place, at, suffix) {
    var m = minutesTo(place);
    rides.push({
      key: date + ':' + type + ':' + rider + (suffix ? ':' + suffix : ''),
      kind: 'ride',
      type: type,
      rider: rider,
      place: place,
      at: at,
      start: Math.max(0, at - m),
      end: Math.min(1440, at + m)
    });
  }
  function addHold(reason, pid, start, end, commute, suffix) {
    holds.push({
      key: date + ':hold:' + reason + ':' + pid + (suffix ? ':' + suffix : ''),
      kind: 'hold',
      type: reason,
      person: pid,
      start: Math.max(0, start),
      end: Math.min(1440, end),
      commute: commute
    });
  }

  // School runs.
  var exc = data.school[date];
  var inSchoolYear = (!st.schoolFirstDay || date >= st.schoolFirstDay) &&
    (!st.schoolLastDay || date <= st.schoolLastDay);
  var schoolToday = exc ? !exc.noSchool : inSchoolYear && st.schoolDays.indexOf(dayName(date)) >= 0;
  if (schoolToday && st.schoolRider && personById(data, st.schoolRider)) {
    var dropoff = exc && exc.dropoff != null ? exc.dropoff : st.schoolDropoff;
    var pickup = exc && exc.pickup != null ? exc.pickup : st.schoolPickup;
    if (dropoff != null) addRide('school_am', st.schoolRider, st.schoolPlace, dropoff);
    if (pickup != null) addRide('school_pm', st.schoolRider, st.schoolPlace, pickup);
  }

  // Work: people at work are busy; some get driven, some keep a car all day.
  data.people.forEach(function (p) {
    if (!p.active) return;
    var shifts = data.shifts
      .filter(function (s) { return s.person === p.id && s.date === date; })
      .sort(function (a, b) { return a.start - b.start; });
    if (!shifts.length) return;
    shifts.forEach(function (s, i) {
      addBusy(p.id, s.start, s.end, 'at work');
      if (p.getsRides) {
        var suffix = shifts.length > 1 ? String(i + 1) : '';
        addRide('work_to', p.id, p.workPlace, s.start, suffix);
        addRide('work_from', p.id, p.workPlace, s.end, suffix);
      }
    });
    if (p.drivesSelf && !p.getsRides) {
      addHold('commute', p.id, shifts[0].start - p.commute, shifts[shifts.length - 1].end + p.commute, p.commute);
    }
  });

  // Plans people added themselves.
  data.plans.forEach(function (pl) {
    var p = personById(data, pl.person);
    if (!p || !p.active || !planAppliesOn(pl, date)) return;
    if (pl.type === 'busy') {
      addBusy(pl.person, orDefault(pl.start, 0), orDefault(pl.end, 1440), pl.note || 'busy');
    } else if (pl.type === 'bus_lot') {
      var start = orDefault(pl.start, 7 * 60);
      var end = orDefault(pl.end, 17 * 60);
      addHold('bus_lot', pl.person, start, end, minutesTo(st.lotPlace), pl.id);
      addBusy(pl.person, start, end, 'away on a bus-lot day');
    } else if (pl.type === 'pickup' && pl.start != null) {
      addRide('pickup', pl.person, pl.place, pl.start, pl.id);
    }
  });

  var byStart = function (a, b) { return a.start - b.start || (a.key < b.key ? -1 : 1); };
  rides.sort(byStart);
  holds.sort(byStart);

  holds.concat(rides).forEach(function (it) {
    var a = data.assignments[it.key];
    it.driver = it.kind === 'hold' ? it.person : (a && a.driver) || '';
    it.car = (a && a.car) || '';
    it.label = itemLabel(data, it);
  });

  return { date: date, rides: rides, holds: holds, busy: busy };
}

function itemLabel(data, it) {
  var who = personName(data, it.kind === 'hold' ? it.person : it.rider);
  switch (it.type) {
    case 'school_am': return who + ' to school';
    case 'school_pm': return 'Pick up ' + who + ' from school';
    case 'work_to': return who + ' to work';
    case 'work_from': return 'Pick up ' + who + ' from work';
    case 'pickup': return 'Pick up ' + who + (it.place ? ' at ' + placeName(data, it.place) : '');
    case 'commute': return who + ' drives to work';
    case 'bus_lot': return who + ' drives to the bus lot';
  }
  return who;
}

function findItem(day, key) {
  var all = day.holds.concat(day.rides);
  for (var i = 0; i < all.length; i++) if (all[i].key === key) return all[i];
  return null;
}

/** "Me (Lexus)", "nobody", "Lexus", "no car" */
function describeChoice(data, item, driver, car) {
  if (item.kind === 'hold') return car ? carName(data, car) : 'no car';
  if (!driver && !car) return 'nobody';
  return (driver ? personName(data, driver) : 'no driver') + ' (' + (car ? carName(data, car) : 'no car') + ')';
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** Problem with one driver+car choice on its own, or null. */
function choiceProblem(data, day, item, driver, car) {
  var person = personById(data, driver);
  var c = carById(data, car);
  if (!person) return 'Unknown person "' + driver + '".';
  if (!c) return 'Unknown car "' + car + '".';
  if (person.canDrive.indexOf(car) < 0) return person.name + " can't drive the " + c.name + '.';
  if (item.kind === 'ride') {
    if (item.rider === driver) return person.name + ' is the passenger on "' + item.label + '".';
    var list = day.busy[driver] || [];
    for (var i = 0; i < list.length; i++) {
      if (overlaps(list[i], item)) return person.name + ' is ' + list[i].reason + ' during "' + item.label + '".';
    }
  }
  return null;
}

/**
 * Problem between two items happening at overlapping times, or null.
 * The same person driving the same car on overlapping items is fine: it's one
 * trip (e.g. dropping the brothers off and then Mom).
 */
function pairProblem(data, a, b) {
  if (!overlaps(a, b)) return null;
  if (a.car === b.car && a.driver !== b.driver) {
    return 'The ' + carName(data, a.car) + ' is double-booked: "' + a.label + '" (' +
      personName(data, a.driver) + ') and "' + b.label + '" (' + personName(data, b.driver) + ').';
  }
  if (a.driver === b.driver && a.car !== b.car) {
    return personName(data, a.driver) + " can't be in the " + carName(data, a.car) + ' and the ' +
      carName(data, b.car) + ' at the same time ("' + a.label + '" and "' + b.label + '").';
  }
  var rider = a.rider && a.rider === b.driver ? a : b.rider && b.rider === a.driver ? b : null;
  if (rider) {
    var driving = rider === a ? b : a;
    return personName(data, driving.driver) + ' is riding ("' + rider.label + '") while driving ("' +
      driving.label + '").';
  }
  return null;
}

/** The commuter who should get the EV (longest drive), or null. */
function evTarget(data, day) {
  if (!data.settings.evPreference) return null;
  var ev = null;
  data.cars.forEach(function (c) { if (c.isEv && !ev) ev = c; });
  if (!ev) return null;
  var candidates = day.holds.filter(function (h) {
    var p = personById(data, h.person);
    return p && p.canDrive.indexOf(ev.id) >= 0 && h.commute > 0;
  });
  if (!candidates.length) return null;
  candidates.sort(function (a, b) { return b.commute - a.commute; });
  if (candidates.length > 1 && candidates[0].commute === candidates[1].commute) return null;
  return { hold: candidates[0], car: ev.id };
}

/** All problems on a day: [{level: 'error'|'warn', keys: [...], message}] */
function checkDay(data, day) {
  var issues = [];
  var items = day.holds.concat(day.rides);
  var complete = [];

  items.forEach(function (it) {
    if (it.kind === 'hold' && !it.car) {
      issues.push({ level: 'error', keys: [it.key], message: personName(data, it.person) + ' needs a car for "' + it.label + '".' });
      return;
    }
    if (it.kind === 'ride' && !it.driver) {
      issues.push({ level: 'error', keys: [it.key], message: '"' + it.label + '" has no driver yet.' });
      return;
    }
    if (it.kind === 'ride' && !it.car) {
      issues.push({ level: 'error', keys: [it.key], message: '"' + it.label + '" has no car picked.' });
      return;
    }
    var problem = choiceProblem(data, day, it, it.driver, it.car);
    if (problem) issues.push({ level: 'error', keys: [it.key], message: problem });
    complete.push(it);
  });

  for (var i = 0; i < complete.length; i++) {
    for (var j = i + 1; j < complete.length; j++) {
      var problem = pairProblem(data, complete[i], complete[j]);
      if (problem) issues.push({ level: 'error', keys: [complete[i].key, complete[j].key], message: problem });
    }
  }

  var target = evTarget(data, day);
  if (target && target.hold.car && target.hold.car !== target.car) {
    issues.push({
      level: 'warn',
      keys: [target.hold.key],
      message: 'Preference: the ' + carName(data, target.car) + ' usually goes to ' +
        personName(data, target.hold.person) + ' (longest drive). Fine to skip when needed to cover the rides.'
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

var COST_UNASSIGNED = 100;
var COST_CHANGE = 10;
var COST_EV = 3;
var SEARCH_BUDGET = 200000;

/**
 * Finds the best full plan for a day: every rule satisfied, as few rides left
 * uncovered as possible, as few existing choices changed as possible, EV to
 * the longest commute when it fits, and rides spread between drivers.
 */
function suggestDay(data, day) {
  var items = day.holds.concat(day.rides);
  var drivers = data.people.filter(isDriver);
  var target = evTarget(data, day);

  var options = items.map(function (it) {
    var opts = [];
    var add = function (driver, car) {
      if (carById(data, car) && !choiceProblem(data, day, it, driver, car)) opts.push({ driver: driver, car: car });
    };
    if (it.kind === 'hold') {
      var holder = personById(data, it.person);
      if (holder) holder.canDrive.forEach(function (c) { add(it.person, c); });
    } else {
      drivers.forEach(function (p) { p.canDrive.forEach(function (c) { add(p.id, c); }); });
    }
    // Try the current choice first so the search finds a cheap plan early.
    opts.sort(function (a, b) { return sameChoice(it, b) - sameChoice(it, a); });
    opts.push(null);
    return opts;
  });

  var chosen = new Array(items.length);
  var load = {};
  var best = null;
  var bestCost = Infinity;
  var steps = 0;

  function placed(i, opt) {
    var it = items[i];
    return { key: it.key, kind: it.kind, label: it.label, rider: it.rider, start: it.start, end: it.end,
      driver: opt.driver, car: opt.car };
  }

  function search(i, cost) {
    if (cost >= bestCost || steps > SEARCH_BUDGET) return;
    steps++;
    if (i === items.length) {
      var total = cost;
      if (target) {
        var ti = items.indexOf(target.hold);
        if (chosen[ti] && chosen[ti].car !== target.car) total += COST_EV;
      }
      if (total < bestCost) {
        bestCost = total;
        best = chosen.slice();
      }
      return;
    }
    var it = items[i];
    var hasCurrent = it.kind === 'hold' ? !!it.car : !!(it.driver && it.car);
    options[i].forEach(function (opt) {
      var c;
      if (!opt) {
        c = COST_UNASSIGNED;
      } else {
        var mine = placed(i, opt);
        for (var j = 0; j < i; j++) {
          if (chosen[j] && pairProblem(data, mine, chosen[j])) return;
        }
        c = hasCurrent && !sameChoice(it, opt) ? COST_CHANGE : 0;
        if (it.kind === 'ride') c += load[opt.driver] || 0;
      }
      chosen[i] = opt ? placed(i, opt) : null;
      if (opt && it.kind === 'ride') load[opt.driver] = (load[opt.driver] || 0) + 1;
      search(i + 1, cost + c);
      if (opt && it.kind === 'ride') load[opt.driver]--;
      chosen[i] = null;
    });
  }
  search(0, 0);

  var changes = [];
  var unresolved = [];
  items.forEach(function (it, i) {
    var pick = best ? best[i] : null;
    if (!pick) {
      unresolved.push(it.label);
      return;
    }
    if (!sameChoice(it, pick)) {
      changes.push({
        key: it.key,
        kind: it.kind,
        label: it.label,
        driver: pick.driver,
        car: pick.car,
        fromText: describeChoice(data, it, it.driver, it.car),
        toText: describeChoice(data, it, pick.driver, pick.car)
      });
    }
  });
  return { date: day.date, changes: changes, unresolved: unresolved };
}

function sameChoice(item, opt) {
  if (!opt) return false;
  return item.car === opt.car && (item.kind === 'hold' || item.driver === opt.driver);
}

// ---------------------------------------------------------------------------
// Days for the app
// ---------------------------------------------------------------------------

/** `count` days starting at `from`, ready to show. `now` is {date, minutes}. */
function planDays(data, from, count, now) {
  var out = [];
  for (var i = 0; i < count; i++) {
    var date = addDays(from, i);
    var day = buildDay(data, date);
    var issues = checkDay(data, day);
    // Who could take each ride on their own (ignores clashes with other rides).
    day.rides.forEach(function (r) {
      r.available = data.people.filter(isDriver).filter(function (p) {
        return p.canDrive.some(function (c) { return !choiceProblem(data, day, r, p.id, c); });
      }).map(function (p) { return p.id; });
    });
    out.push({
      date: date,
      dayName: dayName(date),
      late: isLate(date, now.date, now.minutes, data.settings.cutoff),
      holds: day.holds,
      rides: day.rides,
      issues: issues,
      hasErrors: issues.some(function (x) { return x.level === 'error'; })
    });
  }
  return out;
}
