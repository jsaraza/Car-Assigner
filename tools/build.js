// Builds the site into dist/web:
//   - the phone app (web/)
//   - the shared planner code it runs in demo mode (apps-script/*.js -> lib/)
//   - apps-script/Code.gs: every backend file in one, for pasting into the
//     Apps Script editor without installing anything
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist', 'web');
const SHARED = ['Util.js', 'Schema.js', 'Planner.js', 'Sample.js', 'Actions.js'];
const BACKEND = SHARED.concat(['Store.js', 'Api.js', 'Jobs.js', 'Setup.js']);

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'web'), out, { recursive: true });

fs.mkdirSync(path.join(out, 'lib'), { recursive: true });
for (const f of SHARED) fs.copyFileSync(path.join(root, 'apps-script', f), path.join(out, 'lib', f));

const gsDir = path.join(out, 'apps-script');
fs.mkdirSync(gsDir, { recursive: true });
const bundle = BACKEND.map((f) => {
  const src = fs.readFileSync(path.join(root, 'apps-script', f), 'utf8');
  return '// ===== ' + f + ' =====\n' + src;
}).join('\n');
fs.writeFileSync(
  path.join(gsDir, 'Code.gs'),
  '// Car Assigner backend. Paste this whole file into Code.gs in the Apps Script editor.\n' +
    '// Generated from apps-script/ in the repo; edit those files, not this one.\n\n' + bundle
);
fs.copyFileSync(path.join(root, 'apps-script', 'appsscript.json'), path.join(gsDir, 'appsscript.json'));

console.log('Built ' + path.relative(root, out));
