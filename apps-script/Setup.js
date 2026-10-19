/*
 * One-time setup and maintenance. Run these from the Apps Script editor
 * (pick the function in the toolbar, then Run). Apps Script only.
 */

/** Creates the tabs, fills in starter data, the family key and the calendar. Safe to re-run. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sample = sampleTables(today_());

  Object.keys(TABLES).forEach(function (k) {
    var def = TABLES[k];
    var sheet = ss.getSheetByName(def.sheet) || ss.insertSheet(def.sheet);
    sheet.getRange(1, 1, sheet.getMaxRows(), Math.max(def.headers.length, sheet.getMaxColumns()))
      .setNumberFormat('@');
    if (sheet.getLastRow() > 0) {
      addMissingColumns_(sheet, def.headers);
      return;
    }
    sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    var rows = (sample[k] || []).map(function (r) {
      return def.headers.map(function (h) { return r[h] == null ? '' : String(r[h]); });
    });
    if (rows.length) sheet.getRange(2, 1, rows.length, def.headers.length).setValues(rows);
    sheet.autoResizeColumns(1, def.headers.length);
  });

  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('FAMILY_KEY')) props.setProperty('FAMILY_KEY', newKey_());

  fillNotifyTopics_();

  var data = loadSheetData_();
  if (!data.settings.calendarId) {
    var cal = CalendarApp.createCalendar('Family Cars', { summary: 'Who drives who, planned with Car Assigner.' });
    setSetting_('calendar_id', cal.getId());
  }

  console.log('Setup done. Time zone: ' + Session.getScriptTimeZone() +
    ' (change it in Project Settings if that is wrong).');
  console.log('Next: Deploy > New deployment > Web app, then paste the URL into Settings > api_url and run familyLink().');
}

/** Prints the link to send to the family (needs api_url and app_url in Settings). */
function familyLink() {
  var link = familyLinkUrl_(loadSheetData_());
  if (!link) {
    console.log('Fill in api_url and app_url in the Settings tab first, then run this again.');
    return;
  }
  console.log('Family link (keep it in the family):\n' + link);
}

/** Makes a new family key. Old links stop working; send everyone the new one from familyLink(). */
function newFamilyKey() {
  PropertiesService.getScriptProperties().setProperty('FAMILY_KEY', newKey_());
  familyLink();
}

/** Deletes the made-up starter shifts and plans (rows whose note is "sample"). */
function removeSampleData() {
  ['shifts', 'plans'].forEach(function (k) { deleteRowWhere_(k, 'note', 'sample'); });
  console.log('Sample shifts and plans removed.');
}

function newKey_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 20);
}

/** Gives everyone without one a private notification channel name (an ntfy topic). */
function fillNotifyTopics_() {
  readTable_('people').forEach(function (r) {
    if (String(r.id || '').trim() && !String(r.notify_topic || '').trim()) {
      updateRow_('people', 'id', r.id, { notify_topic: 'familycars-' + newKey_().slice(0, 16) });
    }
  });
}

/** Older sheets: add any columns that newer versions of the app use. */
function addMissingColumns_(sheet, headers) {
  var have = headersOf_(sheet);
  headers.forEach(function (h) {
    if (have.indexOf(h) >= 0) return;
    var col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col).setValue(h);
    sheet.getRange(1, col).setFontWeight('bold');
    have.push(h);
  });
}
