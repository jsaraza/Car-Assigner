/*
 * Reading and writing the Google Sheet. Apps Script only.
 */

function sheetFor_(tableKey) {
  var def = TABLES[tableKey];
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(def.sheet);
  if (!sheet) throw new Error('Missing tab "' + def.sheet + '". Run setup() in the Apps Script editor.');
  return sheet;
}

function headersOf_(sheet) {
  if (sheet.getLastColumn() === 0) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) {
    return String(h).trim().toLowerCase();
  });
}

/** Cells are stored as plain text, but handle dates/times typed into unformatted cells too. */
function cellToString_(value) {
  if (value instanceof Date) {
    var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    return value.getFullYear() < 1900
      ? Utilities.formatDate(value, tz, 'HH:mm')
      : Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }
  if (value === true) return 'TRUE';
  if (value === false) return 'FALSE';
  return String(value == null ? '' : value).trim();
}

function readTable_(tableKey) {
  var sheet = sheetFor_(tableKey);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = {};
    var empty = true;
    headers.forEach(function (h, c) {
      if (!h) return;
      row[h] = cellToString_(values[r][c]);
      if (row[h] !== '') empty = false;
    });
    if (!empty) {
      row._row = r + 1;
      rows.push(row);
    }
  }
  return rows;
}

function appendRow_(tableKey, obj) {
  var sheet = sheetFor_(tableKey);
  var headers = headersOf_(sheet);
  var row = headers.map(function (h) { return obj[h] == null ? '' : String(obj[h]); });
  var r = sheet.getLastRow() + 1;
  var range = sheet.getRange(r, 1, 1, headers.length);
  range.setNumberFormat('@');
  range.setValues([row]);
}

/** Sets some columns on the row whose `keyColumn` equals `keyValue`. Returns false if no such row. */
function updateRow_(tableKey, keyColumn, keyValue, fields) {
  var sheet = sheetFor_(tableKey);
  var headers = headersOf_(sheet);
  var keyIndex = headers.indexOf(keyColumn);
  if (keyIndex < 0 || sheet.getLastRow() < 2) return false;
  var keys = sheet.getRange(2, keyIndex + 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]).trim() !== String(keyValue)) continue;
    Object.keys(fields).forEach(function (f) {
      var c = headers.indexOf(f);
      if (c < 0) return;
      var cell = sheet.getRange(i + 2, c + 1);
      cell.setNumberFormat('@');
      cell.setValue(fields[f] == null ? '' : String(fields[f]));
    });
    return true;
  }
  return false;
}

function deleteRowWhere_(tableKey, keyColumn, keyValue) {
  var sheet = sheetFor_(tableKey);
  var headers = headersOf_(sheet);
  var keyIndex = headers.indexOf(keyColumn);
  if (keyIndex < 0 || sheet.getLastRow() < 2) return;
  var keys = sheet.getRange(2, keyIndex + 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = keys.length - 1; i >= 0; i--) {
    if (String(keys[i][0]).trim() === String(keyValue)) sheet.deleteRow(i + 2);
  }
}

function setSetting_(key, value) {
  if (!updateRow_('settings', 'key', key, { value: value })) appendRow_('settings', { key: key, value: value });
}

function sheetStore_() {
  return {
    load: function () {
      var t = {};
      Object.keys(TABLES).forEach(function (k) {
        if (k !== 'log') t[k] = readTable_(k);
      });
      return t;
    },
    upsertAssignment: function (row) {
      var fields = {};
      Object.keys(row).forEach(function (k) { if (k !== 'key') fields[k] = row[k]; });
      if (!updateRow_('assignments', 'key', row.key, fields)) appendRow_('assignments', row);
    },
    appendLog: function (row) { appendRow_('log', row); },
    addPlan: function (row) { appendRow_('plans', row); },
    deletePlan: function (planId) { deleteRowWhere_('plans', 'id', planId); },
    readLog: function (limit) {
      var rows = readTable_('log');
      return rows.slice(-limit).reverse().map(function (r) { delete r._row; return r; });
    }
  };
}
