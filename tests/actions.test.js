const test = require('node:test');
const assert = require('node:assert/strict');
const { loadShared } = require('./load');

const g = loadShared();
const plain = (x) => JSON.parse(JSON.stringify(x));

const MON = '2026-10-19';
const TUE = '2026-10-20';

function setup(nowDate, nowTime) {
  const store = g.createMemoryStore(g.sampleTables(MON));
  const late = [];
  const env = {
    store,
    now: { date: nowDate, minutes: g.toMinutes(nowTime), ms: 1760000000000 },
    deadlineMs: () => 0,
    onLate: (info) => late.push(info)
  };
  const call = (req) => g.runAction(req, env);
  return { store, late, call };
}

test('state returns days with rides, holds and issues', () => {
  const { call } = setup(MON, '09:00');
  const res = call({ action: 'state', days: 3 });
  assert.equal(res.ok, true);
  assert.equal(res.days.length, 3);
  assert.equal(res.days[0].date, MON);
  assert.ok(res.days[1].rides.length > 0);
  assert.ok(res.days[1].hasErrors);
  assert.ok(res.people.find((p) => p.id === 'brothers' && !p.isDriver));
  assert.equal(res.people.find((p) => p.id === 'me').isDriver, true);
});

test('assigning before the cutoff is not late; after the cutoff it is', () => {
  const early = setup(MON, '16:59');
  early.call({ action: 'assign', by: 'me', itemKey: `${TUE}:school_am:brothers`, driver: 'me', car: 'lexus' });
  assert.equal(early.late.length, 0);
  assert.equal(early.store.tables.log.at(-1).late, '');

  const late = setup(MON, '17:01');
  late.call({ action: 'assign', by: 'mom', itemKey: `${TUE}:school_am:brothers`, driver: 'me', car: 'lexus' });
  assert.equal(late.late.length, 1);
  assert.deepEqual(plain(late.late[0].changes[0].people), ['me']);
  assert.equal(late.store.tables.log.at(-1).late, 'LATE');
  assert.equal(late.store.tables.log.at(-1).by, 'Mom');
  assert.equal(late.store.tables.log.at(-1).to, 'Me (Lexus)');
});

test('assignment shows up in the next state', () => {
  const { call } = setup(MON, '09:00');
  call({ action: 'assign', by: 'me', itemKey: `${TUE}:school_am:brothers`, driver: 'mom', car: 'pathfinder' });
  const day = call({ action: 'state', from: TUE, days: 1 }).days[0];
  const ride = day.rides.find((r) => r.type === 'school_am');
  assert.equal(ride.driver, 'mom');
  assert.equal(ride.car, 'pathfinder');
});

test('rejects a car the driver is not allowed to drive, and unknown names', () => {
  const { call } = setup(MON, '09:00');
  assert.throws(
    () => call({ action: 'assign', by: 'me', itemKey: `${TUE}:school_am:brothers`, driver: 'me', car: 'ev' }),
    /Me can't drive the EV/
  );
  assert.throws(
    () => call({ action: 'assign', by: 'brothers', itemKey: `${TUE}:school_am:brothers`, driver: 'mom', car: 'ev' }),
    /Pick your name/
  );
});

test('apply suggestion fills in the day', () => {
  const { call } = setup(MON, '09:00');
  const res = call({ action: 'applySuggestion', by: 'me', date: TUE });
  assert.ok(res.applied > 0);
  assert.deepEqual(plain(res.unresolved), []);
  const day = call({ action: 'state', from: TUE, days: 1 }).days[0];
  assert.equal(day.hasErrors, false, day.issues.map((i) => i.message).join('\n'));
});

test('apply suggestion reports what it could not cover', () => {
  // In the sample, Me has class Wednesday mornings and Dad and Sister work,
  // so nobody is free to take Mom to work.
  const { call } = setup(MON, '09:00');
  const res = call({ action: 'applySuggestion', by: 'me', date: '2026-10-21' });
  assert.deepEqual(plain(res.unresolved), ['Mom to work']);
});

test('plans can be added and removed; only by their owner', () => {
  const { call, store, late } = setup(MON, '09:00');
  const added = call({
    action: 'addPlan', by: 'me',
    plan: { type: 'busy', date: '2026-10-22', start: '10:00', end: '12:00', days: '', note: 'Dentist' }
  });
  assert.equal(added.plan.type, 'busy');
  assert.equal(late.length, 0);
  assert.ok(store.tables.plans.find((p) => p.id === added.plan.id));

  assert.throws(() => call({ action: 'deletePlan', by: 'sister', id: added.plan.id }), /your own plans/);
  call({ action: 'deletePlan', by: 'me', id: added.plan.id });
  assert.ok(!store.tables.plans.find((p) => p.id === added.plan.id));
  assert.equal(store.tables.log.length, 2);
});

test('a plan added for tomorrow after the cutoff is late and notifies everyone', () => {
  const { call, late } = setup(MON, '20:00');
  call({ action: 'addPlan', by: 'me', plan: { type: 'bus_lot', date: TUE, start: '07:00', end: '16:00' } });
  assert.equal(late.length, 1);
  assert.equal(late[0].notifyAll, true);
  assert.deepEqual(plain(late[0].dates), [TUE]);
});

test('plan validation', () => {
  const { call } = setup(MON, '09:00');
  assert.throws(() => call({ action: 'addPlan', by: 'me', plan: { type: 'pickup', date: TUE } }), /pickup time/);
  assert.throws(() => call({ action: 'addPlan', by: 'me', plan: { type: 'busy', date: TUE, start: '12:00', end: '11:00' } }), /end time/);
  assert.throws(() => call({ action: 'addPlan', by: 'me', plan: { type: 'nope', date: TUE } }), /kind of plan/);
});

test('log returns newest first', () => {
  const { call } = setup(MON, '09:00');
  call({ action: 'assign', by: 'me', itemKey: `${TUE}:school_am:brothers`, driver: 'mom', car: 'ev' });
  call({ action: 'assign', by: 'me', itemKey: `${TUE}:school_pm:brothers`, driver: 'mom', car: 'ev' });
  const log = call({ action: 'log' }).log;
  assert.equal(log[0].what, 'Pick up Brothers from school');
});
