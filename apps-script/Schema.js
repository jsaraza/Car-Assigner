/*
 * The Google Sheet layout: one tab per table, first row is the header.
 * Column names here are the keys the rest of the code reads.
 */

var TABLES = {
  settings: {
    sheet: 'Settings',
    headers: ['key', 'value', 'notes']
  },
  people: {
    sheet: 'People',
    headers: ['id', 'name', 'phone', 'email', 'can_drive', 'drives_self_to_work',
      'gets_rides_to_work', 'work_place', 'commute_minutes', 'active']
  },
  cars: {
    sheet: 'Cars',
    headers: ['id', 'name', 'is_ev', 'bluetooth_name']
  },
  places: {
    sheet: 'Places',
    headers: ['id', 'name', 'minutes_from_home']
  },
  shifts: {
    sheet: 'Work Schedule',
    headers: ['person', 'date', 'start', 'end', 'note']
  },
  school: {
    sheet: 'School Exceptions',
    headers: ['date', 'no_school', 'dropoff', 'pickup', 'note']
  },
  plans: {
    sheet: 'Plans',
    headers: ['id', 'person', 'type', 'date', 'start', 'end', 'days', 'until', 'place', 'note']
  },
  assignments: {
    sheet: 'Assignments',
    headers: ['key', 'date', 'kind', 'driver', 'car', 'event_id', 'synced', 'updated_by', 'updated_at']
  },
  log: {
    sheet: 'Change Log',
    headers: ['when', 'by', 'date', 'what', 'from', 'to', 'late']
  }
};

/** Plan types people can add on the My Plans screen. */
var PLAN_TYPES = {
  busy: 'Busy',
  bus_lot: 'Driving to the bus lot',
  pickup: 'Need a pickup'
};
