/*
 * Starter data for a new sheet and for the demo. Names are placeholders;
 * edit them in the sheet. Rows with note "sample" can be cleared with
 * removeSampleData() once the real schedules are in.
 */

function sampleTables(today) {
  var shifts = [];
  var plans = [];
  for (var i = 0; i < 21; i++) {
    var date = addDays(today, i);
    var dn = dayName(date);
    var weekday = WEEK_ORDER.indexOf(dn) < 5;
    if (weekday) {
      shifts.push({ person: 'dad', date: date, start: '08:00', end: '16:30', note: 'sample' });
      shifts.push(dn === 'Tue'
        ? { person: 'mom', date: date, start: '11:00', end: '19:00', note: 'sample' }
        : { person: 'mom', date: date, start: '09:00', end: '15:00', note: 'sample' });
    }
    if (dn === 'Mon' || dn === 'Wed' || dn === 'Thu') {
      shifts.push({ person: 'sister', date: date, start: '09:00', end: '17:00', note: 'sample' });
    }
    if (dn === 'Sat') {
      shifts.push({ person: 'sister', date: date, start: '10:00', end: '16:00', note: 'sample' });
    }
  }
  plans.push({ id: 'sample-class', person: 'me', type: 'busy', date: today, start: '08:30', end: '13:00',
    days: 'Mon,Wed,Fri', until: '', place: '', note: 'sample' });
  plans.push({ id: 'sample-lot', person: 'me', type: 'bus_lot', date: today, start: '07:00', end: '16:30',
    days: 'Thu', until: '', place: '', note: 'sample' });

  return {
    settings: [
      { key: 'planners', value: 'dad', notes: 'Who assigns drivers and cars (People ids, comma-separated). Empty = every driver can.' },
      { key: 'cutoff_time', value: '17:00', notes: "Tomorrow's plan locks at this time. Changes after it are LATE." },
      { key: 'alert_time', value: '12:00', notes: 'Midday email if tomorrow still has problems.' },
      { key: 'school_dropoff', value: '07:30', notes: 'PLACEHOLDER - set the real morning drop-off time.' },
      { key: 'school_pickup', value: '15:05', notes: 'Afternoon pickup.' },
      { key: 'school_days', value: 'Mon-Fri', notes: 'Days off and early releases go in the School Exceptions tab.' },
      { key: 'school_first_day', value: '', notes: 'Optional, YYYY-MM-DD.' },
      { key: 'school_last_day', value: '', notes: 'Optional, YYYY-MM-DD.' },
      { key: 'school_rider', value: 'brothers', notes: 'People id of who gets driven to school.' },
      { key: 'school_place', value: 'school', notes: 'Places id of the school.' },
      { key: 'bus_lot_place', value: 'bus_lot', notes: 'Places id of the bus parking lot.' },
      { key: 'ev_to_longest_commute', value: 'TRUE', notes: 'Prefer giving the EV to whoever drives furthest.' },
      { key: 'calendar_id', value: '', notes: 'Filled in by setup().' },
      { key: 'notify_server', value: 'https://ntfy.sh', notes: 'Where phone notifications are sent (free ntfy app).' },
      { key: 'api_url', value: '', notes: 'Paste the web app URL from Deploy > Manage deployments.' },
      { key: 'app_url', value: '', notes: 'The GitHub Pages address of the app.' }
    ],
    people: [
      { id: 'me', name: 'Me', phone: 'iphone', email: '', can_drive: 'lexus', drives_self_to_work: 'FALSE',
        gets_rides_to_work: 'FALSE', work_place: '', commute_minutes: '', active: 'TRUE' },
      { id: 'mom', name: 'Mom', phone: 'android', email: '', can_drive: 'ev, lexus, pathfinder', drives_self_to_work: 'FALSE',
        gets_rides_to_work: 'TRUE', work_place: 'mom_work', commute_minutes: '', active: 'TRUE' },
      { id: 'dad', name: 'Dad', phone: 'android', email: '', can_drive: 'ev, lexus, pathfinder', drives_self_to_work: 'TRUE',
        gets_rides_to_work: 'FALSE', work_place: '', commute_minutes: '45', active: 'TRUE' },
      { id: 'sister', name: 'Sister', phone: 'iphone', email: '', can_drive: 'ev, lexus', drives_self_to_work: 'TRUE',
        gets_rides_to_work: 'FALSE', work_place: '', commute_minutes: '20', active: 'TRUE' },
      { id: 'brothers', name: 'Brothers', phone: '', email: '', can_drive: '', drives_self_to_work: 'FALSE',
        gets_rides_to_work: 'FALSE', work_place: '', commute_minutes: '', active: 'TRUE' },
      { id: 'grandparents', name: 'Mama and Papa', phone: '', email: '', can_drive: 'grandparents_car',
        drives_self_to_work: 'FALSE', gets_rides_to_work: 'FALSE', work_place: '', commute_minutes: '',
        helper: 'TRUE', active: 'TRUE' }
    ],
    cars: [
      { id: 'ev', name: 'EV', is_ev: 'TRUE', bluetooth_name: '' },
      { id: 'lexus', name: 'Lexus', is_ev: 'FALSE', bluetooth_name: '' },
      { id: 'pathfinder', name: 'Pathfinder', is_ev: 'FALSE', bluetooth_name: '' },
      { id: 'grandparents_car', name: "Mama and Papa's car", is_ev: 'FALSE', bluetooth_name: '' }
    ],
    places: [
      { id: 'home', name: 'Home', minutes_from_home: '0' },
      { id: 'school', name: "Brothers' school", minutes_from_home: '10' },
      { id: 'mom_work', name: "Mom's work", minutes_from_home: '20' },
      { id: 'bus_lot', name: 'Bus lot', minutes_from_home: '10' }
    ],
    shifts: shifts,
    school: [],
    plans: plans,
    assignments: [],
    log: []
  };
}
