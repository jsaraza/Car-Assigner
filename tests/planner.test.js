const test = require('node:test');
const assert = require('node:assert/strict');
const { loadShared } = require('./load');

const g = loadShared();
// Arrays made inside the sandbox have a different prototype; compare as plain JSON.
const plain = (x) => JSON.parse(JSON.stringify(x));

// 2026-10-19 is a Monday.
const MON = '2026-10-19';
const WED = '2026-10-21';
const FRI = '2026-10-23';
const SAT = '2026-10-24';

function tables(shifts, extra) {
  const t = g.sampleTables(MON);
  t.shifts = shifts.map(([person, date, start, end]) => ({ person, date, start, end }));
  t.plans = [];
  return Object.assign(t, extra || {});
}

function assign(t, key, driver, car) {
  t.assignments.push({ key, date: key.slice(0, 10), driver, car });
}

const everyoneWorks = (date) => [
  ['dad', date, '08:00', '16:30'],
  ['sister', date, '09:00', '17:00'],
  ['mom', date, '09:00', '15:00']
];

test('a school + work day has the right rides and car holds', () => {
  const data = g.normalizeData(tables(everyoneWorks(WED)));
  const day = g.buildDay(data, WED);

  const rides = day.rides.map((r) => [r.type, r.rider, g.fromMinutes(r.start), g.fromMinutes(r.end)]);
  assert.deepEqual(plain(rides), [
    ['school_am', 'brothers', '07:20', '07:40'],
    ['work_to', 'mom', '08:40', '09:20'],
    ['work_from', 'mom', '14:40', '15:20'],
    ['school_pm', 'brothers', '14:55', '15:15']
  ]);
  const holds = day.holds.map((h) => [h.person, g.fromMinutes(h.start), g.fromMinutes(h.end)]);
  assert.deepEqual(plain(holds), [
    ['dad', '07:15', '17:15'],
    ['sister', '08:40', '17:20']
  ]);
  assert.equal(day.rides[0].label, 'Brothers to school');
  assert.equal(day.rides[1].label, 'Mom to work');
});

test('no school on weekends or days off; early release changes pickup', () => {
  const t = tables([], {
    school: [
      { date: '2026-10-20', no_school: 'TRUE' },
      { date: '2026-10-22', pickup: '12:30' }
    ]
  });
  const data = g.normalizeData(t);
  assert.equal(g.buildDay(data, SAT).rides.length, 0);
  assert.equal(g.buildDay(data, '2026-10-20').rides.length, 0);
  const thu = g.buildDay(data, '2026-10-22').rides;
  assert.equal(thu.find((r) => r.type === 'school_pm').at, 12 * 60 + 30);
  assert.equal(thu.find((r) => r.type === 'school_am').at, 7 * 60 + 30);
});

test('plans: recurring busy time, bus-lot days and pickup requests', () => {
  const t = tables([]);
  t.plans = [
    { id: 'a', person: 'me', type: 'busy', date: MON, start: '08:30', end: '13:00', days: 'Mon,Wed' },
    { id: 'b', person: 'me', type: 'bus_lot', date: FRI, start: '07:00', end: '16:30' },
    { id: 'c', person: 'me', type: 'pickup', date: FRI, start: '17:30', place: 'bus_lot' }
  ];
  const data = g.normalizeData(t);

  assert.equal(g.buildDay(data, WED).busy.me.length, 1);
  assert.equal(g.buildDay(data, '2026-10-20').busy.me, undefined);

  const fri = g.buildDay(data, FRI);
  assert.equal(fri.holds.length, 1);
  assert.equal(fri.holds[0].type, 'bus_lot');
  assert.equal(fri.holds[0].label, 'Me drives to the bus lot');
  const pickup = fri.rides.find((r) => r.type === 'pickup');
  assert.equal(pickup.label, 'Pick up Me at Bus lot');
  assert.equal(g.fromMinutes(pickup.start), '17:20');
});

test('checkDay flags unassigned rides, wrong cars, busy drivers and double-booking', () => {
  const t = tables(everyoneWorks(WED));
  assign(t, `${WED}:hold:commute:dad`, 'dad', 'lexus');
  assign(t, `${WED}:work_to:mom`, 'me', 'lexus'); // Lexus is with Dad then
  assign(t, `${WED}:school_am:brothers`, 'me', 'pathfinder'); // Me can't drive it
  assign(t, `${WED}:school_pm:brothers`, 'sister', 'ev'); // Sister is at work
  const data = g.normalizeData(t);
  const messages = g.checkDay(data, g.buildDay(data, WED)).map((i) => i.message);

  assert.ok(messages.includes("Me can't drive the Pathfinder."), messages.join('\n'));
  assert.ok(messages.some((m) => m.startsWith('Sister is at work during "Pick up Brothers from school"')));
  assert.ok(messages.some((m) => m.startsWith('The Lexus is double-booked')));
  assert.ok(messages.includes('"Pick up Mom from work" has no driver yet.'));
  assert.ok(messages.some((m) => m.startsWith('Sister needs a car')));
});

test('one trip for two rides is fine (same driver, same car)', () => {
  const t = tables(everyoneWorks(WED));
  assign(t, `${WED}:work_from:mom`, 'me', 'lexus');
  assign(t, `${WED}:school_pm:brothers`, 'me', 'lexus');
  const data = g.normalizeData(t);
  const issues = g.checkDay(data, g.buildDay(data, WED));
  assert.ok(!issues.some((i) => i.keys.includes(`${WED}:school_pm:brothers`)));
});

test('suggestion: when Dad and Sister both work, the Lexus stays home so someone can drive Mom', () => {
  const data = g.normalizeData(tables(everyoneWorks(WED)));
  const s = g.suggestDay(data, g.buildDay(data, WED));
  const pick = Object.fromEntries(s.changes.map((c) => [c.key, [c.driver, c.car]]));

  assert.deepEqual(plain(s.unresolved), []);
  assert.deepEqual(plain(pick[`${WED}:hold:commute:dad`]), ['dad', 'pathfinder']);
  assert.deepEqual(plain(pick[`${WED}:hold:commute:sister`]), ['sister', 'ev']);
  assert.deepEqual(plain(pick[`${WED}:work_to:mom`]), ['me', 'lexus']);

  // Applying the suggestion leaves no errors, only the EV preference note.
  const t = tables(everyoneWorks(WED));
  s.changes.forEach((c) => assign(t, c.key, c.driver, c.car));
  const after = g.normalizeData(t);
  const issues = g.checkDay(after, g.buildDay(after, WED));
  assert.deepEqual(plain(issues.filter((i) => i.level === 'error').map((i) => i.message)), []);
  assert.equal(issues.filter((i) => i.level === 'warn').length, 1);
});

test('suggestion: the EV goes to Dad (longest drive) when that works', () => {
  const data = g.normalizeData(tables([
    ['dad', FRI, '08:00', '16:30'],
    ['mom', FRI, '09:00', '15:00']
  ]));
  const s = g.suggestDay(data, g.buildDay(data, FRI));
  const dad = s.changes.find((c) => c.key === `${FRI}:hold:commute:dad`);
  assert.equal(dad.car, 'ev');
  assert.deepEqual(plain(s.unresolved), []);
});

test('suggestion keeps choices people already made when they work', () => {
  const t = tables(everyoneWorks(WED));
  assign(t, `${WED}:hold:commute:dad`, 'dad', 'pathfinder');
  assign(t, `${WED}:hold:commute:sister`, 'sister', 'ev');
  assign(t, `${WED}:school_am:brothers`, 'mom', 'lexus');
  const data = g.normalizeData(t);
  const s = g.suggestDay(data, g.buildDay(data, WED));
  assert.ok(!s.changes.some((c) => c.key.includes('hold') || c.key.includes('school_am')));
});

test('suggestion reports rides nobody can cover', () => {
  const t = tables(everyoneWorks(WED));
  t.plans = [{ id: 'x', person: 'me', type: 'busy', date: WED, start: '08:00', end: '10:00' }];
  const data = g.normalizeData(t);
  const s = g.suggestDay(data, g.buildDay(data, WED));
  assert.deepEqual(plain(s.unresolved), ['Mom to work']);
});
