// A small stand-in for the Google Apps Script services the backend uses,
// so Store/Api/Jobs/Setup can be tested without a Google account.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { SHARED } = require('./load');

const BACKEND = SHARED.concat(['Store.js', 'Api.js', 'Jobs.js', 'Setup.js']);
const TZ = 'America/New_York';

function tzParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(date);
  const o = {};
  parts.forEach((p) => { o[p.type] = p.value; });
  return o;
}

function makeSheet(name) {
  const rows = [];
  const sheet = {
    rows,
    name,
    getName: () => name,
    getLastRow: () => rows.length,
    getLastColumn: () => rows.reduce((m, r) => Math.max(m, r.length), 0),
    getMaxRows: () => Math.max(rows.length, 1000),
    getMaxColumns: () => 26,
    getDataRange: () => sheet.getRange(1, 1, Math.max(rows.length, 1), Math.max(sheet.getLastColumn(), 1)),
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = [];
          for (let j = 0; j < nc; j++) row.push((rows[r - 1 + i] || [])[c - 1 + j] ?? '');
          out.push(row);
        }
        return out;
      },
      setValues: (vals) => {
        vals.forEach((v, i) => {
          rows[r - 1 + i] = rows[r - 1 + i] || [];
          v.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = x; });
        });
        return sheet.getRange(r, c, nr, nc);
      },
      setValue: (v) => {
        rows[r - 1] = rows[r - 1] || [];
        rows[r - 1][c - 1] = v;
      },
      setNumberFormat() { return this; },
      setFontWeight() { return this; }
    }),
    deleteRow: (r) => { rows.splice(r - 1, 1); },
    setFrozenRows: () => {},
    autoResizeColumns: () => {}
  };
  return sheet;
}

function createGoogle(now) {
  const sheets = [makeSheet('Sheet1')];
  const props = {};
  const calendars = {};
  const mail = [];
  const triggers = [];
  const fetched = [];
  let uuid = 0;
  let clock = now;

  const ss = {
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n) => { const s = makeSheet(n); sheets.push(s); return s; },
    getSheets: () => sheets.slice(),
    deleteSheet: (s) => { sheets.splice(sheets.indexOf(s), 1); },
    getSpreadsheetTimeZone: () => TZ
  };

  function makeCalendar(calId) {
    const events = {};
    let n = 0;
    return {
      events,
      getId: () => calId,
      createEvent: (title, start, end, opts) => {
        const evId = 'ev' + (++n);
        const ev = {
          title, start, end, opts: opts || {},
          getId: () => evId,
          setTitle: (t) => { ev.title = t; },
          setTime: (s, e) => { ev.start = s; ev.end = e; },
          deleteEvent: () => { delete events[evId]; }
        };
        events[evId] = ev;
        return ev;
      },
      getEventById: (evId) => events[evId] || null
    };
  }

  const ctx = {
    console: { log: () => {}, error: () => {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    Session: { getScriptTimeZone: () => TZ },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const p = tzParts(d);
        if (fmt === 'yyyy-MM-dd') return `${p.year}-${p.month}-${p.day}`;
        if (fmt === 'HH:mm') return `${p.hour}:${p.minute}`;
        if (fmt === 'EEE MMM d') return `${p.weekday} ${p.month}/${p.day}`;
        throw new Error('fake formatDate: ' + fmt);
      },
      parseDate: (s) => {
        // 'yyyy-MM-dd HH:mm' in New York; good enough for tests (EDT, UTC-4, in October).
        const [d, t] = s.split(' ');
        return new Date(d + 'T' + t + ':00-04:00');
      },
      getUuid: () => (++uuid).toString(16).padStart(8, '0') + '-0123-4567-89ab-cdef01234567'
    },
    CalendarApp: {
      createCalendar: (name) => { const c = makeCalendar('cal-' + name); calendars[c.getId()] = c; return c; },
      getCalendarById: (calId) => calendars[calId] || null
    },
    MailApp: { sendEmail: (m) => mail.push(m) },
    UrlFetchApp: {
      fetch: (url, opts) => {
        fetched.push({ url, opts, body: JSON.parse(opts.payload) });
        return { getResponseCode: () => 200, getContentText: () => '{}' };
      }
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } })
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: (handler) => {
        const t = { handler, getHandlerFunction: () => handler };
        const b = {
          timeBased: () => b, everyDays: () => b,
          atHour: (h) => { t.hour = h; return b; },
          nearMinute: (m) => { t.minute = m; return b; },
          create: () => { triggers.push(t); return t; }
        };
        return b;
      }
    }
  };
  // Freeze "now" for code that calls new Date().
  const RealDate = Date;
  ctx.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(clock.getTime()); }
    static now() { return clock.getTime(); }
  };
  vm.createContext(ctx);
  for (const file of BACKEND) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', file), 'utf8'), ctx, { filename: file });
  }

  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  return {
    g: ctx, ss, props, calendars, mail, triggers, fetched, post,
    setNow: (d) => { clock = d; },
    sheet: (n) => ss.getSheetByName(n)
  };
}

module.exports = { createGoogle };
