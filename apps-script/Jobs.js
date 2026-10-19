/*
 * Timed jobs, Google Calendar invites and emails. Apps Script only.
 *
 *   noonCheck     - around alert_time: email the planner if tomorrow has problems
 *   lockTomorrow  - just after cutoff_time: put tomorrow's plan on the calendar
 *                   and invite each driver to their rides
 *   late changes  - after the cutoff, every change updates the calendar right
 *                   away and emails the people it affects
 *
 * Run installTriggers() once (and again after changing the times in Settings).
 */

function installTriggers() {
  var handlers = ['noonCheck', 'lockTomorrow'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  var st = loadSheetData_().settings;
  dailyTrigger_('noonCheck', st.alert);
  // Apps Script runs "near" a minute (within ~15 min), so aim a little after
  // the cutoff to make sure the lock never runs before it.
  dailyTrigger_('lockTomorrow', st.cutoff + 15);
  console.log('Triggers installed: noonCheck near ' + fromMinutes(st.alert) +
    ', lockTomorrow near ' + fromMinutes(st.cutoff + 15) + ' (' + Session.getScriptTimeZone() + ').');
}

function dailyTrigger_(handler, minutes) {
  var m = Math.min(minutes, 23 * 60 + 59);
  ScriptApp.newTrigger(handler).timeBased().everyDays(1)
    .atHour(Math.floor(m / 60)).nearMinute(m % 60).create();
}

function loadSheetData_() {
  return normalizeData(sheetStore_().load());
}

function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function noonCheck() {
  var data = loadSheetData_();
  var tomorrow = addDays(today_(), 1);
  var issues = checkDay(data, buildDay(data, tomorrow)).filter(function (i) { return i.level === 'error'; });
  if (!issues.length) return;
  sendMail_(
    emailsOf_(data, data.people.filter(function (p) { return isPlanner(data, p); }).map(function (p) { return p.id; })),
    'Car plan for ' + prettyDate_(tomorrow) + ' needs attention',
    "Tomorrow's car plan still has problems. It locks at " + formatTime12(data.settings.cutoff) + ' today.\n\n' +
      issues.map(function (i) { return '- ' + i.message; }).join('\n') +
      appLinkLine_(data)
  );
}

function lockTomorrow() {
  syncCalendarDay_(addDays(today_(), 1));
}

/** Called by the app's actions when something changes after a day locked. */
function handleLateChange_(info) {
  var data = loadSheetData_();
  info.dates.forEach(function (d) { syncCalendarDay_(d); });
  var who = personName(data, info.by);
  var ids = info.notifyAll
    ? data.people.filter(isDriver).map(function (p) { return p.id; })
    : uniq([].concat.apply([], info.changes.map(function (c) { return c.people; })));
  var lines = info.changes.map(function (c) {
    return '- ' + c.label + ': ' + c.before + ' -> ' + c.after;
  });
  sendMail_(
    emailsOf_(data, ids),
    'LATE change to the car plan for ' + info.dates.map(prettyDate_).join(' and '),
    who + ' changed the car plan after the ' + formatTime12(data.settings.cutoff) + ' cutoff:\n\n' +
      lines.join('\n') + appLinkLine_(data)
  );
}

/**
 * Makes the calendar match the plan for one day: one event per assigned ride
 * or car hold, with the driver invited so it shows on their own phone.
 */
function syncCalendarDay_(date) {
  var data = loadSheetData_();
  if (!data.settings.calendarId) return;
  var cal = CalendarApp.getCalendarById(data.settings.calendarId);
  if (!cal) {
    console.error('Calendar not found: ' + data.settings.calendarId);
    return;
  }
  var day = buildDay(data, date);
  var items = {};
  day.holds.concat(day.rides).forEach(function (it) { items[it.key] = it; });

  Object.keys(data.assignments).forEach(function (key) {
    var a = data.assignments[key];
    if (a.date !== date) return;
    var it = items[key];
    var assigned = !!(it && it.driver && it.car);
    var sig = assigned ? [it.driver, it.car, it.start, it.end].join('|') : '';
    if (sig === a.synced && (!assigned || a.eventId)) return;

    var event = a.eventId ? getEvent_(cal, a.eventId) : null;
    var sameDriver = assigned && a.synced.split('|')[0] === it.driver;
    if (event && !sameDriver) {
      event.deleteEvent();
      event = null;
    }
    if (!assigned) {
      updateRow_('assignments', 'key', key, { event_id: '', synced: '' });
      return;
    }
    var title = eventTitle_(data, it);
    var start = toDate_(date, it.start);
    var end = toDate_(date, Math.max(it.end, it.start + 1));
    if (event) {
      event.setTitle(title);
      event.setTime(start, end);
    } else {
      var person = personById(data, it.driver);
      var opts = { description: eventDescription_(data, it) };
      if (person && person.email) {
        opts.guests = person.email;
        opts.sendInvites = true;
      }
      event = cal.createEvent(title, start, end, opts);
    }
    updateRow_('assignments', 'key', key, { event_id: event.getId(), synced: sig });
  });
}

function getEvent_(cal, eventId) {
  try {
    return cal.getEventById(eventId);
  } catch (err) {
    return null;
  }
}

function eventTitle_(data, it) {
  if (it.kind === 'hold') return '🔑 ' + personName(data, it.person) + ' has the ' + carName(data, it.car);
  return '🚗 ' + personName(data, it.driver) + ': ' + it.label + ' (' + carName(data, it.car) + ')';
}

function eventDescription_(data, it) {
  if (it.kind === 'hold') return it.label + '. Planned with Car Assigner.';
  return it.label + ' at ' + formatTime12(it.at) + '. Leave by ' + formatTime12(it.start) +
    ' in the ' + carName(data, it.car) + '. Planned with Car Assigner.';
}

function emailsOf_(data, ids) {
  return uniq(ids.map(function (pid) {
    var p = personById(data, pid);
    return p && p.email ? p.email : '';
  }).filter(Boolean));
}

function sendMail_(to, subject, body) {
  if (!to.length) return;
  try {
    MailApp.sendEmail({ to: to.join(','), subject: subject, body: body });
  } catch (err) {
    console.error('Email failed: ' + err);
  }
}

function prettyDate_(date) {
  return Utilities.formatDate(toDate_(date, 12 * 60), Session.getScriptTimeZone(), 'EEE MMM d');
}

function appLinkLine_(data) {
  var link = familyLinkUrl_(data);
  return link ? '\n\nOpen the app: ' + link : '';
}

function familyLinkUrl_(data) {
  var key = PropertiesService.getScriptProperties().getProperty('FAMILY_KEY');
  if (!data.settings.appUrl || !data.settings.apiUrl || !key) return '';
  return data.settings.appUrl.replace(/\/?$/, '/') + '?api=' + encodeURIComponent(data.settings.apiUrl) +
    '&key=' + encodeURIComponent(key);
}
