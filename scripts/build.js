'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const bundlePath = path.join(root, 'js', 'app.js');
const sourceModules = [
  'js/modules/00-domain-foundation.js',
  'js/modules/10-google-sheets-sync.js',
  'js/modules/20-state-and-accounting.js',
  'js/modules/30-charts.js',
  'js/modules/40-ui-utilities.js',
  'js/modules/50-views-and-previews.js',
  'js/modules/60-actions-and-event-handlers.js',
  'js/modules/70-daily-weekly-planner.js'
];

function buildSource() {
  return sourceModules
    .map(relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8'))
    .join('');
}

function main() {
  const generated = buildSource();
  const checkOnly = process.argv.includes('--check');

  if (checkOnly) {
    if (!fs.existsSync(bundlePath)) {
      console.error('Missing generated bundle: js/app.js. Run npm run build.');
      process.exitCode = 1;
      return;
    }
    const current = fs.readFileSync(bundlePath, 'utf8');
    if (current !== generated) {
      console.error('js/app.js is out of sync with js/modules/*.js. Run npm run build and review the diff.');
      process.exitCode = 1;
      return;
    }
    console.log('Source modules match js/app.js exactly.');
    return;
  }

  fs.writeFileSync(bundlePath, generated, 'utf8');
  console.log('Built js/app.js from ' + sourceModules.length + ' ordered source files.');
}

main();
