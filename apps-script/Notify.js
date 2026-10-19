/*
 * Phone notifications: who gets told what when a ride or car changes hands.
 * The messages are built here (shared, so they can be tested and previewed
 * in the demo). Jobs.js sends them through ntfy (free push notifications).
 */

var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'today', 'tomorrow', or 'Wed Oct 21' */
function dayPhrase(date, today) {
  if (date === today) return 'today';
  if (date === addDays(today, 1)) return 'tomorrow';
  return dayName(date) + ' ' + MONTH_NAMES[Number(date.slice(5, 7)) - 1] + ' ' + Number(date.slice(8, 10));
}

function isPickupRide(item) {
  return item.type === 'school_pm' || item.type === 'work_from' || item.type === 'pickup';
}

/** "Mama and Papa are", "Jim is" */
function nameWithVerb(name) {
  return name + (/(\band\b|&|,)/i.test(name) ? ' are' : ' is');
}

function rideWhere(data, item, forRider) {
  switch (item.type) {
    case 'school_am': return forRider ? 'off at school' : 'to school';
    case 'work_to': return forRider ? 'off at work' : 'to work';
    case 'school_pm': return forRider ? 'up from school' : 'from school';
    case 'work_from': return forRider ? 'up from work' : 'from work';
    case 'pickup': return (forRider ? 'up ' : '') + (item.place ? 'at ' + placeName(data, item.place) : '');
  }
  return '';
}

/**
 * changes: [{ item, before: {driver, car}, after: {driver, car} }]
 * Returns one notification per person: [{ person, name, lines: [...] }]
 */
function rideNotifications(data, changes, today) {
  var byPerson = {};
  var order = [];
  function add(pid, line) {
    if (!pid) return;
    if (!byPerson[pid]) {
      byPerson[pid] = [];
      order.push(pid);
    }
    byPerson[pid].push(line);
  }

  changes.forEach(function (ch) {
    var it = ch.item;
    var b = ch.before;
    var a = ch.after;
    var when = dayPhrase(it.key.slice(0, 10), today);
    var car = a.car ? carName(data, a.car) : '';

    if (it.kind === 'hold') {
      if (a.car && a.car !== b.car) {
        add(it.person, 'You have the ' + car + ' ' + when + (it.type === 'bus_lot' ? ' for the bus lot.' : ' for work.'));
      }
      return;
    }

    if (b.driver && b.driver !== a.driver) {
      add(b.driver, "You're no longer driving: " + it.label + ' ' + when + '.');
    }
    if (!a.driver || !a.car) return;

    var time = formatTime12(it.at);
    var rider = personName(data, it.rider);
    if (a.driver !== b.driver) {
      add(a.driver, isPickupRide(it)
        ? "You're picking up " + rider + ' ' + rideWhere(data, it, false) + ' ' + when + ' at ' + time +
          ' (' + car + '). Leave by ' + formatTime12(it.start) + '.'
        : "You're driving " + rider + ' ' + rideWhere(data, it, false) + ' ' + when + ' (' + car + '). Leave by ' +
          formatTime12(it.start) + ', be there by ' + time + '.');
      if (it.rider && it.rider !== a.driver) {
        add(it.rider, nameWithVerb(personName(data, a.driver)) + (isPickupRide(it) ? ' picking you ' : ' dropping you ') +
          rideWhere(data, it, true) + ' ' + when + ' at ' + time + '.');
      }
    } else if (a.car !== b.car) {
      add(a.driver, 'Car change: ' + it.label + ' ' + when + ' is now in the ' + car + '.');
    }
  });

  return order.map(function (pid) {
    return { person: pid, name: personName(data, pid), lines: byPerson[pid] };
  });
}
