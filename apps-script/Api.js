/*
 * The web app endpoint the phone app talks to. Apps Script only.
 *
 * Every request is a POST with a JSON body (sent as text/plain so browsers
 * skip the CORS preflight that Apps Script can't answer):
 *   { action, key, by, ...action fields }
 * `key` must match the FAMILY_KEY script property made by setup().
 */

var WRITE_ACTIONS = { assign: true, applySuggestion: true, addPlan: true, deletePlan: true };

function doGet() {
  return json_({ ok: true, app: 'car-assigner' });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Bad request.' });
  }
  var familyKey = PropertiesService.getScriptProperties().getProperty('FAMILY_KEY');
  if (!familyKey || req.key !== familyKey) {
    return json_({ ok: false, error: 'This family link is wrong or out of date. Ask for the new link.' });
  }

  var lock = null;
  if (WRITE_ACTIONS[req.action]) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return json_({ ok: false, error: 'Someone else is saving right now. Try again.' });
  }
  try {
    return json_(runAction(req, appsEnv_()));
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: err.message || String(err) });
  } finally {
    if (lock) lock.releaseLock();
  }
}

function appsEnv_() {
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var cutoff = null;
  return {
    store: sheetStore_(),
    now: {
      date: Utilities.formatDate(now, tz, 'yyyy-MM-dd'),
      minutes: toMinutes(Utilities.formatDate(now, tz, 'HH:mm')),
      ms: now.getTime()
    },
    deadlineMs: function (date) {
      if (cutoff == null) cutoff = normalizeData({ settings: readTable_('settings') }).settings.cutoff;
      return toDate_(addDays(date, -1), cutoff).getTime();
    },
    onLate: handleLateChange_
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 'YYYY-MM-DD' + minutes -> Date in the script's time zone. */
function toDate_(date, minutes) {
  var m = Math.max(0, Math.min(1439, minutes));
  return Utilities.parseDate(date + ' ' + fromMinutes(m), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}
