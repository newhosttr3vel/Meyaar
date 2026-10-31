'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const appsScript = fs.readFileSync(path.join(root, 'apps-script', 'Code.gs'), 'utf8');
const syncModule = fs.readFileSync(path.join(root, 'js', 'modules', '10-google-sheets-sync.js'), 'utf8');
const domainModule = fs.readFileSync(path.join(root, 'js', 'modules', '00-domain-foundation.js'), 'utf8');
const plannerModule = fs.readFileSync(path.join(root, 'js', 'modules', '70-daily-weekly-planner.js'), 'utf8');

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
assert.match(appsScript, /LEGACY_SETTINGS_RECORD_KEY:\s*'shared_settings_v1'/,
  'The previously deployed shared_settings_v1 record remains readable');
assert.match(appsScript, /LEGACY_SETTINGS_HEADERS:\s*\['Key', 'Value', 'UpdatedAt'\]/,
  'The previously deployed three-column settings header is recognized');
assert.match(appsScript, /key === CONFIG\.LEGACY_SETTINGS_RECORD_KEY/,
  'Legacy settings are read by their original record key');
assert.match(appsScript, /current\.recordKey === CONFIG\.SETTINGS_RECORD_KEY && current\.rowNumber/,
  'Saves update the current state row rather than overwriting a legacy recovery row');
assert.doesNotMatch(appsScript, /contains extra rows beyond its single state record/,
  'Other settings rows are preserved rather than rejected or overwritten');
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

const getTasksPosition = appsScript.indexOf("if (action === 'tasks')");
assert.ok(getTasksPosition >= 0 && stateGetPosition < getTasksPosition &&
  getTasksPosition < transactionGetPosition,
  'The task-list GET route is handled separately before the transaction sheet route');

const saveTaskPosition = appsScript.indexOf("action === 'savetask'");
const deleteTaskPosition = appsScript.indexOf("action === 'deletetask'");
assert.ok(saveTaskPosition > postSettingsPosition && saveTaskPosition < postTransactionPosition &&
  deleteTaskPosition > postSettingsPosition && deleteTaskPosition < postTransactionPosition,
  'Task save/delete routes are handled before opening DB_TRANSACTIONS');

assert.match(syncModule, /baseState:\s*baseSnapshot/,
  'The frontend sends the base snapshot for conflict-safe merges');
assert.match(syncModule, /expectedRevision:\s*baseRevision/,
  'The frontend sends the revision it last loaded');
assert.match(syncModule, /mergeSharedSettingsSnapshots\(/,
  'The frontend reconciles remote updates with local pending edits');
assert.doesNotMatch(domainModule, /plannerTasks:\s*source\.plannerTasks/,
  'Planner tasks are excluded from the financial shared-settings payload');
assert.doesNotMatch(domainModule, /plannerTasks: item => String\(item && item\.id \|\| ''\)/,
  'Planner tasks no longer merge through the financial settings collection');
assert.match(appsScript, /TASKS_SHEET_NAME:\s*'TASKS'/,
  'The planner has its own TASKS worksheet');
assert.match(appsScript, /function migrateLegacyPlannerTasksIfNeeded\(sheet\)/,
  'Legacy tasks migrate into TASKS without deleting the previous recovery copy');
assert.match(appsScript, /function readPlannerTasks\(sheet\)/,
  'The server can list active tasks and deletion tombstones');
assert.match(appsScript, /function savePlannerTask\(sheet, data\)/,
  'The server persists a single task independently');
assert.match(appsScript, /function deletePlannerTask\(sheet, data\)/,
  'The server deletes tasks through tombstones rather than transaction rows');
assert.match(plannerModule, /async function loadPlannerTasksFromGoogle/,
  'The planner reads its dedicated worksheet endpoint');
assert.match(plannerModule, /action:\s*'savetask'/,
  'The planner saves single tasks to the dedicated endpoint');
assert.match(plannerModule, /action:\s*'deletetask'/,
  'The planner deletes single tasks through the dedicated endpoint');
assert.match(appsScript, /supportedKeys: CONFIG\.SHARED_STATE_KEYS\.slice\(\)/,
  'The shared-settings API continues to advertise its supported collections for compatibility');

assert.match(domainModule, /plannerSettings:\s*source\.plannerSettings/,
  'Planner working hours and load preferences synchronize across devices');
assert.match(appsScript, /'Area', 'Project', 'DueDate', 'EstimateMinutes', 'ActualMinutes'/,
  'TASKS retains extended metadata columns after the original 12');
assert.match(appsScript, /function getTasksSheet\(\)[\s\S]*?legacy headers[\s\S]*?No existing task rows were changed/,
  'Legacy TASKS headers upgrade in place without rewriting original rows');
assert.match(appsScript, /'plannerTasks', 'plannerSettings'/,
  'Legacy planner tasks remain readable for safe migration');
assert.match(plannerModule, /function plannerGenerateDay\(/,
  'The productivity planner has an automatic day-scheduling engine');
assert.match(plannerModule, /function plannerPriorityScore\(/,
  'Task priority uses urgency, impact, priority and effort');
assert.match(plannerModule, /function plannerAvailableWindowsBase\(/,
  'Personal and work availability are calculated separately');
assert.match(plannerModule, /data-planner-focus-start/,
  'Tasks support focus sessions and actual-time tracking');
assert.match(plannerModule, /pc-review-kpis/,
  'The planner includes execution and time-use analytics');

assert.match(domainModule, /incomeSources:\s*source\.incomeSources/,
  'Income sources are part of the shared settings payload');
assert.match(domainModule, /function mergeSharedSettingsSnapshots\(/,
  'Shared collections have a three-way merge helper');
assert.match(domainModule, /'accounts', 'prices'/,
  'Account and asset-price data are included in shared settings');

console.log('Shared-sync contract tests passed: separate settings sheet, stable transaction schema, and cross-device merge routes.');
