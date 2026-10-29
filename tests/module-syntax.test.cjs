'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
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

for (const relativePath of sourceModules) {
  const filePath = path.join(root, relativePath);
  const text = fs.readFileSync(filePath, 'utf8');
  assert.ok(text.length > 0, relativePath + ' must not be empty');
  assert.doesNotThrow(
    () => new vm.Script(text, { filename: relativePath }),
    relativePath + ' must be syntactically valid JavaScript'
  );
}

console.log('All ' + sourceModules.length + ' source modules pass syntax checks.');
