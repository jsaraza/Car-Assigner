const test = require('node:test');
const assert = require('node:assert/strict');
const { createGoogle } = require('./fake-google');

// Monday Oct 19 2026, 9:00am New York time.
const MON_9AM = new Date('2026-10-19T09:00:00-04:00');
const TUE = '2026-10-20';

function ready() {
  const google = createGoogle(MON_9AM);
  google.g.setup();
  const key = google.props.FAMILY_KEY;
  const call = (body) => google.post(Object.assign({ key }, body));
  return Object.assign(google, { key, call });
}

function setEmail(google, personId, email) {
  const rows = google.sheet('People').rows;
  const col = rows[0].indexOf('email');
  rows.find((r) => r[0] === personId)[col] = email;
}

test('setup creates every tab, sample data, a family key and the calendar', () => {
  const google = ready();
  const names = google.ss.getSheets().map((s) => s.getName());
  assert.deepEqual(names, ['Settings', 'People', 'Cars', 'Places', 'Work Schedule', 'School Exceptions',
    'Plans', 'Assignments', 'Change Log']);
  assert.ok(google.key && google.key.length >= 16);
  assert.ok(google.sheet('Work Schedule').rows.length > 10);
  const calId = google.sheet('Settings').rows.find((r) => r[0] === 'calendar_id')[1];
  assert.ok(google.calendars[calId]);

  // Running it again changes nothing.
  google.g.setup();
  assert.equal(Object.keys(google.calendars).length, 1);
  assert.equal(google.ss.getSheets().length, 9);
});

test('requests need the family key', () => {
  const google = ready();
  const res = google.post({ key: 'wrong', action: 'state' });
  assert.equal(res.ok, false);
  assert.match(res.error, /family link/);
});

test('state and assign go through the sheet', () => {
  const google = ready();
  const state = google.call({ action: 'state', days: 3 });
  assert.equal(state.ok, true, state.error);
  assert.equal(state.now.date, '2026-10-19');
  assert.ok(state.days[1].deadlineMs > 0);

  const res = google.call({ action: 'assign', by: 'dad', itemKey: `${TUE}:school_am:brothers`, driver: 'mom', car: 'ev' });
  assert.equal(res.ok, true, res.error);
  const row = google.sheet('Assignments').rows[1];
  assert.equal(row[0], `${TUE}:school_am:brothers`);
  assert.equal(row[3], 'mom');
  assert.equal(google.sheet('Change Log').rows.length, 2);

  const again = google.call({ action: 'state', from: TUE, days: 1 });
  assert.equal(again.days[0].rides.find((r) => r.type === 'school_am').driver, 'mom');

  // Changing it updates the same row instead of adding one.
  google.call({ action: 'assign', by: 'dad', itemKey: `${TUE}:school_am:brothers`, driver: 'mom', car: 'pathfinder' });
  assert.equal(google.sheet('Assignments').rows.length, 2);
});

test('5pm lock puts tomorrow on the calendar and invites the driver', () => {
  const google = ready();
  setEmail(google, 'mom', 'mom@example.com');
  google.call({ action: 'applySuggestion', by: 'dad', date: TUE });

  google.g.lockTomorrow();
  const cal = Object.values(google.calendars)[0];
  const events = Object.values(cal.events);
  assert.ok(events.length >= 3);
  const momEvent = events.find((e) => e.opts.guests === 'mom@example.com');
  assert.ok(momEvent, 'Mom is invited to a ride she drives');
  assert.equal(momEvent.opts.sendInvites, true);

  // Running the lock again doesn't duplicate events.
  google.g.lockTomorrow();
  assert.equal(Object.keys(cal.events).length, events.length);
});

test('a late change updates the calendar and emails old and new drivers', () => {
  const google = ready();
  setEmail(google, 'mom', 'mom@example.com');
  setEmail(google, 'me', 'me@example.com');
  google.call({ action: 'assign', by: 'dad', itemKey: `${TUE}:school_am:brothers`, driver: 'mom', car: 'pathfinder' });
  google.g.lockTomorrow();
  const cal = Object.values(google.calendars)[0];
  assert.equal(Object.values(cal.events)[0].opts.guests, 'mom@example.com');

  google.setNow(new Date('2026-10-19T21:30:00-04:00'));
  const res = google.call({ action: 'assign', by: 'dad', itemKey: `${TUE}:school_am:brothers`, driver: 'me', car: 'lexus' });
  assert.equal(res.ok, true, res.error);

  const events = Object.values(cal.events);
  assert.equal(events.length, 1, 'old event replaced, not duplicated');
  assert.equal(events[0].opts.guests, 'me@example.com');
  assert.match(events[0].title, /Me: Brothers to school \(Lexus\)/);

  const email = google.mail.at(-1);
  assert.match(email.subject, /LATE change/);
  assert.match(email.to, /mom@example.com/);
  assert.match(email.to, /me@example.com/);
  assert.match(email.body, /Mom \(Pathfinder\) -> Me \(Lexus\)/);
  assert.equal(google.sheet('Change Log').rows.at(-1).at(-1), 'LATE');
});

test('noon check emails the planner only when tomorrow has problems', () => {
  const google = ready();
  setEmail(google, 'dad', 'dad@example.com');
  setEmail(google, 'me', 'me@example.com');
  google.g.noonCheck();
  assert.equal(google.mail.length, 1);
  assert.equal(google.mail[0].to, 'dad@example.com');
  assert.match(google.mail[0].subject, /needs attention/);
  assert.match(google.mail[0].body, /has no driver yet/);

  google.call({ action: 'applySuggestion', by: 'dad', date: TUE });
  google.g.noonCheck();
  assert.equal(google.mail.length, 1, 'no email once tomorrow is covered');
});

test('installTriggers sets the noon check and the lock just after the cutoff', () => {
  const google = ready();
  google.g.installTriggers();
  google.g.installTriggers();
  const t = google.triggers.map((x) => [x.handler, x.hour, x.minute]);
  assert.deepEqual(JSON.parse(JSON.stringify(t)), [['noonCheck', 12, 0], ['lockTomorrow', 17, 15]]);
});

test('plans are saved to and removed from the sheet; sample data can be cleared', () => {
  const google = ready();
  const added = google.call({ action: 'addPlan', by: 'me', plan: { type: 'busy', date: TUE, start: '09:00', end: '11:00' } });
  assert.equal(added.ok, true, added.error);
  assert.ok(google.sheet('Plans').rows.some((r) => r[0] === added.plan.id));
  google.call({ action: 'deletePlan', by: 'me', id: added.plan.id });
  assert.ok(!google.sheet('Plans').rows.some((r) => r[0] === added.plan.id));

  google.g.removeSampleData();
  assert.equal(google.sheet('Work Schedule').rows.length, 1);
  assert.equal(google.sheet('Plans').rows.length, 1);
});

test('familyLink builds the link from the settings', () => {
  const google = ready();
  const rows = google.sheet('Settings').rows;
  rows.find((r) => r[0] === 'api_url')[1] = 'https://script.google.com/macros/s/abc/exec';
  rows.find((r) => r[0] === 'app_url')[1] = 'https://someone.github.io/Car-Assigner';
  const data = google.g.loadSheetData_();
  const link = google.g.familyLinkUrl_(data);
  assert.equal(link, 'https://someone.github.io/Car-Assigner/?api=' +
    encodeURIComponent('https://script.google.com/macros/s/abc/exec') + '&key=' + google.key);
});
