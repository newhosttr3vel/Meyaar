'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const appsScript = fs.readFileSync(path.join(root, 'apps-script', 'Code.gs'), 'utf8');
const syncModule = fs.readFileSync(path.join(root, 'js', 'modules', '10-google-sheets-sync.js'), 'utf8');
const domainModule = fs.readFileSync(path.join(root, 'js', 'modules', '00-domain-foundation.js'), 'utf8');

assert.doesNotThrow(() => new vm.Script(appsScript, { filename: 'apps-script/Code.gs' }),
  'Apps Script must remain syntactically valid');

assert.match(appsScript, /SHEET_NAME:\s*'DB_TRANSACTIONS'/,
  'The existing transaction sheet name is unchanged');
assert.match(appsScript, /COLUMN_COUNT:\s*12/,
  'The transaction schema remains A:L');
assert.match(appsScript, /SETTINGS_SHEET_NAME:\s*'SYS_APP_SETTINGS'/,
  'Shared settings live in their own sheet');
assert.match(appsScript, /function getSharedSettingsSheet\(\)/,
  'Settings sheet creation and validation are isolated');
assert.match(appsScript, /function readSharedSettingsRecord\(sheet\)/,
  'Shared settings have a dedicated reader');
assert.match(appsScript, /function saveSharedSettings\(data\)/,
  'Shared settings have a dedicated writer');
assert.match(appsScript, /function mergeSharedSettingsState\(/,
  'The server merges a device patch against the base snapshot');
assert.match(appsScript, /action === 'state'/,
  'GET?action=state is supported');
assert.match(appsScript, /action === 'savestate'/,
  'POST action=savestate is supported');

const stateGetPosition = appsScript.indexOf("if (action === 'state')");
const transactionGetPosition = appsScript.indexOf('const sheet = getTransactionsSheet()', stateGetPosition);
assert.ok(stateGetPosition >= 0 && transactionGetPosition > stateGetPosition,
  'The state GET route is checked before the transaction sheet route');

const postSettingsPosition = appsScript.indexOf("if (action === 'savestate')");
const postTransactionPosition = appsScript.indexOf('const sheet = getTransactionsSheet()', postSettingsPosition);
assert.ok(postSettingsPosition >= 0 && postTransactionPosition > postSettingsPosition,
  'The settings POST route is handled before opening DB_TRANSACTIONS');

assert.match(syncModule, /baseState:\s*baseSnapshot/,
  'The frontend sends the base snapshot for conflict-safe merges');
assert.match(syncModule, /expectedRevision:\s*baseRevision/,
  'The frontend sends the revision it last loaded');
assert.match(syncModule, /mergeSharedSettingsSnapshots\(/,
  'The frontend reconciles remote updates with local pending edits');
assert.match(domainModule, /incomeSources:\s*source\.incomeSources/,
  'Income sources are part of the shared settings payload');
assert.match(domainModule, /function mergeSharedSettingsSnapshots\(/,
  'Shared collections have a three-way merge helper');
assert.match(domainModule, /'accounts', 'prices'/,
  'Account and asset-price data are included in shared settings');

console.log('Shared-sync contract tests passed: separate settings sheet, stable transaction schema, and cross-device merge routes.');
