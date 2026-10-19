const test = require('node:test');
const assert = require('node:assert/strict');
const { loadShared } = require('./load');

const g = loadShared();
const plain = (x) => JSON.parse(JSON.stringify(x));

const MON = '2026-10-19';
const TUE = '2026-10-20';
const WED = '2026-10-21';

function dayData() {
  const t = g.sampleTables(MON);
  t.people.find((p) => p.id === 'me').name = 'Jim';
  return g.normalizeData(t);
}

function notify(data, date, key, before, after) {
  const item = g.findItem(g.buildDay(data, date), key);
  return plain(g.rideNotifications(data, [{ item, before, after }], MON));
}

const none = { driver: '', car: '' };

test('drop-off: the driver and the person being dropped off are both told', () => {
  const data = dayData();
  const out = notify(data, TUE, `${TUE}:school_am:brothers`, none, { driver: 'me', car: 'lexus' });
  assert.deepEqual(out, [
    { person: 'me', name: 'Jim', lines: ["You're driving Brothers to school tomorrow (Lexus). Leave by 7:20am, be there by 7:30am."] },
    { person: 'brothers', name: 'Brothers', lines: ['Jim is dropping you off at school tomorrow at 7:30am.'] }
  ]);
});

test('pick-up by the grandparents: "are picking you up"', () => {
  const data = dayData();
  const out = notify(data, WED, `${WED}:school_pm:brothers`, none, { driver: 'grandparents', car: 'grandparents_car' });
  assert.equal(out[0].lines[0],
    "You're picking up Brothers from school Wed Oct 21 at 3:05pm (Mama and Papa's car). Leave by 2:55pm.");
  assert.equal(out[1].lines[0], 'Mama and Papa are picking you up from school Wed Oct 21 at 3:05pm.');
});

test('Mom being driven to and from work', () => {
  const data = dayData();
  const to = notify(data, TUE, `${TUE}:work_to:mom`, none, { driver: 'dad', car: 'ev' });
  assert.equal(to[1].lines[0], 'Dad is dropping you off at work tomorrow at 11:00am.');
  const from = notify(data, TUE, `${TUE}:work_from:mom`, none, { driver: 'sister', car: 'ev' });
  assert.equal(from[0].lines[0], "You're picking up Mom from work tomorrow at 7:00pm (EV). Leave by 6:40pm.");
  assert.equal(from[1].lines[0], 'Sister is picking you up from work tomorrow at 7:00pm.');
});

test('swapping drivers tells the old driver they are off the hook', () => {
  const data = dayData();
  const out = notify(data, TUE, `${TUE}:school_am:brothers`, { driver: 'me', car: 'lexus' }, { driver: 'mom', car: 'ev' });
  assert.deepEqual(out.map((n) => n.person), ['me', 'mom', 'brothers']);
  assert.equal(out[0].lines[0], "You're no longer driving: Brothers to school tomorrow.");
  assert.equal(out[2].lines[0], 'Mom is dropping you off at school tomorrow at 7:30am.');
});

test('a car-only change goes to the driver; clearing a ride tells only the old driver', () => {
  const data = dayData();
  const car = notify(data, TUE, `${TUE}:school_am:brothers`, { driver: 'mom', car: 'ev' }, { driver: 'mom', car: 'lexus' });
  assert.deepEqual(car, [{ person: 'mom', name: 'Mom', lines: ['Car change: Brothers to school tomorrow is now in the Lexus.'] }]);
  const cleared = notify(data, TUE, `${TUE}:school_am:brothers`, { driver: 'mom', car: 'ev' }, none);
  assert.deepEqual(cleared.map((n) => n.person), ['mom']);
});

test('car for the day', () => {
  const data = dayData();
  const out = notify(data, TUE, `${TUE}:hold:commute:dad`, { driver: 'dad', car: '' }, { driver: 'dad', car: 'ev' });
  assert.deepEqual(out, [{ person: 'dad', name: 'Dad', lines: ['You have the EV tomorrow for work.'] }]);
});

test('several changes for one person become one notification', () => {
  const data = dayData();
  const day = g.buildDay(data, TUE);
  const changes = [`${TUE}:school_am:brothers`, `${TUE}:school_pm:brothers`].map((key) => ({
    item: g.findItem(day, key), before: none, after: { driver: 'me', car: 'lexus' }
  }));
  const out = plain(g.rideNotifications(data, changes, MON));
  assert.equal(out.length, 2);
  assert.equal(out[0].lines.length, 2);
  assert.equal(out[1].lines.length, 2);
});

test('helpers (grandparents) can be assigned but are never suggested or app users', () => {
  const data = dayData();
  const gp = g.personById(data, 'grandparents');
  assert.equal(g.isDriver(gp), true);
  assert.equal(g.isMember(data, gp), false);
  for (const date of [TUE, WED, '2026-10-22', '2026-10-23']) {
    const s = g.suggestDay(data, g.buildDay(data, date));
    assert.ok(!s.changes.some((c) => c.driver === 'grandparents'), date);
  }
});

test('saving a ride returns who was notified', () => {
  const store = g.createMemoryStore(g.sampleTables(MON));
  const sent = [];
  const env = {
    store, now: { date: MON, minutes: 540, ms: 1 }, deadlineMs: () => 0, onLate: () => {},
    notify: (list) => { sent.push(...list); return list.filter((n) => n.person !== 'brothers'); }
  };
  const res = g.runAction({ action: 'assign', by: 'dad', itemKey: `${TUE}:school_am:brothers`, driver: 'me', car: 'lexus' }, env);
  assert.deepEqual(sent.map((n) => n.person), ['me', 'brothers']);
  assert.deepEqual(plain(res.notified).map((n) => n.person), ['me']);
});
