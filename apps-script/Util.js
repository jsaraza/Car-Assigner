/*
 * Small shared helpers.
 *
 * Everything in Util.js, Schema.js, Planner.js, Notify.js, Sample.js and Actions.js is
 * plain global functions (no modules) so the same files run in Google Apps
 * Script, in the browser demo, and in the Node tests.
 *
 * Conventions:
 *   dates are 'YYYY-MM-DD' strings
 *   times are minutes since midnight (7:30am = 450)
 */

var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var WEEK_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** '7:30', '07:30', '15:05', '3:05pm', '9am' -> minutes since midnight, or null. */
function toMinutes(value) {
  if (typeof value === 'number' && isFinite(value)) return Math.round(value);
  var s = String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  var m = s.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?(am|pm|a|p)?$/);
  if (!m) return null;
  var h = Number(m[1]);
  var min = m[2] ? Number(m[2]) : 0;
  var ap = m[3];
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (h === 12) h = 0;
    if (ap[0] === 'p') h += 12;
  }
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** 450 -> '07:30' */
function fromMinutes(minutes) {
  var m = Math.max(0, Math.min(1440, Math.round(minutes)));
  var h = Math.floor(m / 60);
  var mm = m % 60;
  return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
}

/** 450 -> '7:30am', 905 -> '3:05pm' */
function formatTime12(minutes) {
  if (minutes == null) return '';
  var m = Math.max(0, Math.min(1440, Math.round(minutes))) % 1440;
  var h = Math.floor(m / 60);
  var mm = m % 60;
  var suffix = h < 12 ? 'am' : 'pm';
  var h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ':' + (mm < 10 ? '0' : '') + mm + suffix;
}

function dateToUtcMs(dateStr) {
  var p = dateStr.split('-');
  return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

function addDays(dateStr, n) {
  return new Date(dateToUtcMs(dateStr) + n * 86400000).toISOString().slice(0, 10);
}

/** '2026-10-19' -> 'Mon' */
function dayName(dateStr) {
  return DAY_NAMES[new Date(dateToUtcMs(dateStr)).getUTCDay()];
}

/** Accepts '2026-10-19', '10/19/2026' or '10/19/26'. Returns 'YYYY-MM-DD' or null. */
function normalizeDate(value) {
  var s = String(value == null ? '' : value).trim();
  var y, mo, d, m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) {
    y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]);
  } else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) {
    mo = Number(m[1]); d = Number(m[2]); y = Number(m[3]);
    if (y < 100) y += 2000;
  } else {
    return null;
  }
  var dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** 'ev, Lexus' -> ['ev', 'lexus'] */
function splitList(value) {
  return String(value == null ? '' : value)
    .split(/[,;\s]+/)
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(Boolean);
}

function isTrue(value) {
  if (value === true) return true;
  return /^(true|yes|y|1|x|on)$/i.test(String(value == null ? '' : value).trim());
}

/**
 * 'Mon-Fri', 'weekdays', 'mon,wed,fri', 'Tuesday Thursday', 'daily'
 * -> ['Mon', 'Tue', ...] in week order.
 */
function normalizeDays(value) {
  var out = {};
  var s = String(value == null ? '' : value).trim().toLowerCase();
  if (!s) return [];
  s.split(/[,;\s\/]+/).forEach(function (tok) {
    if (!tok) return;
    if (tok === 'weekdays') { WEEK_ORDER.slice(0, 5).forEach(function (d) { out[d] = true; }); return; }
    if (tok === 'weekends') { out.Sat = true; out.Sun = true; return; }
    if (tok === 'daily' || tok === 'everyday' || tok === 'all') {
      WEEK_ORDER.forEach(function (d) { out[d] = true; });
      return;
    }
    var range = tok.split('-');
    if (range.length === 2) {
      var a = WEEK_ORDER.indexOf(dayToken(range[0]));
      var b = WEEK_ORDER.indexOf(dayToken(range[1]));
      if (a >= 0 && b >= 0) {
        var i = a;
        out[WEEK_ORDER[i]] = true;
        while (i !== b) {
          i = (i + 1) % 7;
          out[WEEK_ORDER[i]] = true;
        }
        return;
      }
    }
    var d = dayToken(tok);
    if (d) out[d] = true;
  });
  return WEEK_ORDER.filter(function (d) { return out[d]; });
}

function dayToken(tok) {
  var t = String(tok).slice(0, 3);
  for (var i = 0; i < WEEK_ORDER.length; i++) {
    if (WEEK_ORDER[i].toLowerCase() === t) return WEEK_ORDER[i];
  }
  return null;
}

/** Two time windows {start, end} overlap (touching ends do not count). */
function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

/**
 * The plan for `date` locks at `cutoff` (minutes) on the day before.
 * Changes after that are "late".
 */
function isLate(date, nowDate, nowMinutes, cutoff) {
  var deadlineDate = addDays(date, -1);
  if (nowDate > deadlineDate) return true;
  return nowDate === deadlineDate && nowMinutes >= cutoff;
}

function uniq(list) {
  var seen = {};
  return list.filter(function (x) {
    if (seen[x]) return false;
    seen[x] = true;
    return true;
  });
}
