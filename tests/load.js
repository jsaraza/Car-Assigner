// Loads the shared Apps Script files into one sandbox, the way Apps Script
// and the browser see them (plain globals, no modules).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SHARED = ['Util.js', 'Schema.js', 'Planner.js', 'Notify.js', 'Sample.js', 'Actions.js'];

function loadShared() {
  const ctx = vm.createContext({ console });
  for (const file of SHARED) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', file), 'utf8');
    vm.runInContext(src, ctx, { filename: file });
  }
  return ctx;
}

module.exports = { loadShared, SHARED };
