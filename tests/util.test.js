const test = require('node:test');
const assert = require('node:assert/strict');
const { loadShared } = require('./load');

const g = loadShared();

test('toMinutes reads common time formats', () => {
  assert.equal(g.toMinutes('07:30'), 450);
  assert.equal(g.toMinutes('7:30'), 450);
  assert.equal(g.toMinutes('15:05'), 905);
  assert.equal(g.toMinutes('3:05pm'), 905);
  assert.equal(g.toMinutes('3:05 PM'), 905);
  assert.equal(g.toMinutes('12am'), 0);
  assert.equal(g.toMinutes('12:15pm'), 735);
  assert.equal(g.toMinutes(''), null);
  assert.equal(g.toMinutes('soon'), null);
  assert.equal(g.toMinutes('25:00'), null);
});

test('time formatting', () => {
  assert.equal(g.fromMinutes(450), '07:30');
  assert.equal(g.formatTime12(905), '3:05pm');
  assert.equal(g.formatTime12(0), '12:00am');
  assert.equal(g.formatTime12(720), '12:00pm');
});

test('dates', () => {
  assert.equal(g.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(g.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(g.dayName('2026-10-19'), 'Mon');
  assert.equal(g.normalizeDate('10/19/2026'), '2026-10-19');
  assert.equal(g.normalizeDate('1/5/27'), '2027-01-05');
  assert.equal(g.normalizeDate('2026-02-30'), null);
});

test('normalizeDays understands ranges and words', () => {
  assert.deepEqual([...g.normalizeDays('Mon-Fri')], ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  assert.deepEqual([...g.normalizeDays('weekdays')], ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  assert.deepEqual([...g.normalizeDays('fri, mon wednesday')], ['Mon', 'Wed', 'Fri']);
  assert.deepEqual([...g.normalizeDays('mon-sun')].length, 7);
  assert.deepEqual([...g.normalizeDays('sat-mon')], ['Mon', 'Sat', 'Sun']);
  assert.deepEqual([...g.normalizeDays('')], []);
});

test('isLate: a day locks at the cutoff on the day before', () => {
  const cutoff = 17 * 60;
  assert.equal(g.isLate('2026-10-20', '2026-10-19', 16 * 60 + 59, cutoff), false);
  assert.equal(g.isLate('2026-10-20', '2026-10-19', 17 * 60, cutoff), true);
  assert.equal(g.isLate('2026-10-20', '2026-10-20', 8 * 60, cutoff), true);
  assert.equal(g.isLate('2026-10-22', '2026-10-19', 23 * 60, cutoff), false);
});
