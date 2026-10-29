'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appPath = path.join(__dirname, '..', 'js', 'app.js');
const source = fs.readFileSync(appPath, 'utf8');
const marker = '\nconst charts = {};';
const cutAt = source.indexOf(marker);
assert.ok(cutAt > 0, 'Financial engine marker exists before UI rendering');
const preUiSource = source.slice(0, cutAt) + `
globalThis.__financeTest = {
  setState(value) { S = normalizeState(value); },
  getState() { return S; },
  rateForDate,
  toEGP,
  recordHistoricalRate,
  makeTransferCloudNote,
  parseTransferCloudNote,
  transferMetadata,
  transferPairIssues,
  monthDueDate,
  recurringOccurrenceKey,
  incomeSourceId,
  INCOME_SOURCE_KINDS,
  INCOME_SOURCE_FREQUENCIES,
  sharedSettingsPayload,
  mergeSharedSettingsSnapshots,
  sharedSettingsEqual,
  goalProgress,
  goalMonthsRemaining,
  goalMonthlyRequired,
  safeToSpendSnapshot,
  makeRecurringCloudNote,
  parseRecurringCloudNote,
  recurringOccurrences,
  markOccurrenceGenerated,
  occurrenceAlreadyGenerated,
  calc,
  P,
  Q
};
`;

const sandbox = {
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { querySelector: () => null, querySelectorAll: () => [] },
  console
};
vm.createContext(sandbox);
vm.runInContext(preUiSource, sandbox, { filename: 'meyaar-finance-core.js' });
const api = sandbox.__financeTest;

function makeState(overrides = {}) {
  return {
    ui: { y: 2026, m: 'all', tab: 'dash', q: '', theme: 'light', fxDate: '2026-01-01' },
    rates: { EGP: 1, SAR: 12.9, USD: 70 },
    baseRates: { EGP: 1, SAR: 12.9, USD: 48.5 },
    rateHistory: [
      { date: '2026-02-01', cur: 'USD', rate: 60 },
      { date: '2026-03-01', cur: 'USD', rate: 65 }
    ],
    budget: { الأساسيات: .5, الرغبات: .15, الادخار: .15, الاستثمارات: .1, الصدقات: .05, الطوارئ: .05 },
    warn: .9,
    accounts: [
      { code: 'CASH', name: 'النقدية', type: 'نقد', open: 0, liq: 1 },
      { code: 'BANK', name: 'الحساب البنكي', type: 'بنك', open: 0, liq: 1 }
    ],
    prices: [],
    tx: [],
    ...overrides
  };
}

// Transaction safety contract: these checks are offline and never connect to the live Google Sheet.
const appsScriptPath = path.join(__dirname, '..', 'apps-script', 'Code.gs');
const appsScriptCode = fs.readFileSync(appsScriptPath, 'utf8');
assert.doesNotThrow(() => new vm.Script(appsScriptCode, { filename: 'apps-script/Code.gs' }),
  'The Apps Script source must be syntactically valid JavaScript');
const expectedSheetHeaders = [
  'Date', 'Type', 'Amount', 'Category', 'Notes', 'Account',
  'Payment', 'Currency', 'Fee', 'AssetCode', 'Quantity', 'Price'
];
assert.match(source, /const KEY = 'fin_dash_pro_v2';/,
  'The existing local storage key remains stable during structural refactoring');
const headerBlock = appsScriptCode.match(/HEADERS:\s*\[([\s\S]*?)\]/);
assert.ok(headerBlock, 'The documented Google Sheets header contract exists');
const documentedSheetHeaders = [...headerBlock[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
assert.deepEqual(documentedSheetHeaders, expectedSheetHeaders,
  'Google Sheets columns A:L keep their established names and order');
assert.match(appsScriptCode, /COLUMN_COUNT:\s*12/,
  'The Google Sheets schema remains exactly 12 columns (A:L)');
assert.match(appsScriptCode, /SETTINGS_SHEET_NAME:\s*'SYS_APP_SETTINGS'/,
  'Shared settings use a separate settings sheet');
assert.match(appsScriptCode, /function getSharedSettingsSheet\(\)/,
  'The separate settings sheet has a dedicated accessor');
assert.match(appsScriptCode, /function saveSharedSettings\(data\)/,
  'Shared settings can be persisted independently of transactions');
assert.match(appsScriptCode, /action === 'savestate'/,
  'The savestate action is supported');
assert.match(appsScriptCode, /action === 'state'/,
  'The shared state GET action is supported');
assert.match(appsScriptCode, /function mergeSharedSettingsState\(/,
  'Backend sync merges changes against the base snapshot');
assert.match(appsScriptCode, /SHEET_NAME:\s*'DB_TRANSACTIONS'/,
  'The transaction sheet retains its existing name');
const saveStart = source.indexOf('async function saveTransactionToGoogle(tx)');
const saveEnd = source.indexOf('async function syncTransactionDetailsToGoogle(tx)', saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart,
  'The existing Google Sheets transaction writer remains present');
const saveFunction = source.slice(saveStart, saveEnd);
const outboundFields = [...saveFunction.matchAll(/^\s{4}([A-Za-z]+):/gm)].map(match => match[1]);
assert.deepEqual(outboundFields, expectedSheetHeaders,
  'The frontend sends the same transaction fields in the established order');

const transactionContractFixture = {
  id: 'TX-LOCK-001', date: '2026-07-15', name: 'معاملة اختبار حماية البيانات',
  type: 'مصروف', cat: 'الأساسيات', sub: '', amt: 1234.56, fee: 12.34,
  cur: 'EGP', pay: 'تحويل بنكي', acc: 'BANK', code: '', qty: '', price: '',
  note: 'ملاحظة يجب أن تبقى كما هي', googleNotes: 'نص العمود Notes الحالي',
  googleSynced: true, st: 'سليم', fixtureTag: 'keep-me'
};
api.setState(makeState({ tx: [transactionContractFixture] }));
const retainedTransaction = api.getState().tx[0];
for (const field of [
  'id', 'date', 'name', 'type', 'cat', 'sub', 'amt', 'fee', 'cur', 'pay',
  'acc', 'code', 'qty', 'price', 'note', 'googleNotes', 'googleSynced', 'st', 'fixtureTag'
]) {
  assert.equal(retainedTransaction[field], transactionContractFixture[field],
    'State normalization preserves transaction field: ' + field);
}

// Cross-device settings merge: concurrent independent additions and map edits must coexist.
api.setState(makeState({
  incomeSources: [{
    id: 'INC-BASE', name: 'مصدر قديم', kind: 'عمل حر', frequency: 'غير منتظم',
    cur: 'EGP', expectedAmount: 0, note: '', active: true, createdAt: ''
  }]
}));
const sharedBase = JSON.parse(JSON.stringify(api.sharedSettingsPayload()));
const sharedLocal = JSON.parse(JSON.stringify(sharedBase));
const sharedRemote = JSON.parse(JSON.stringify(sharedBase));
sharedLocal.incomeSources.push({
  id: 'INC-DESKTOP', name: 'دخل من الكمبيوتر', kind: 'عمل حر', frequency: 'غير منتظم',
  cur: 'EGP', expectedAmount: 0, note: '', active: true, createdAt: ''
});
sharedRemote.incomeSources.push({
  id: 'INC-MOBILE', name: 'دخل من الموبايل', kind: 'مبيعات', frequency: 'غير منتظم',
  cur: 'EGP', expectedAmount: 0, note: '', active: true, createdAt: ''
});
sharedLocal.rates.SAR = 13.4;
sharedRemote.rates.USD = 52.25;
const mergedShared = api.mergeSharedSettingsSnapshots(sharedBase, sharedLocal, sharedRemote);
assert.deepEqual(
  mergedShared.incomeSources.map(item => item.id).sort(),
  ['INC-BASE', 'INC-DESKTOP', 'INC-MOBILE'],
  'Concurrent source additions from two devices are both preserved'
);
assert.equal(mergedShared.rates.SAR, 13.4, 'Local edit to one currency rate is applied');
assert.equal(mergedShared.rates.USD, 52.25, 'Remote edit to a different currency rate is preserved');
assert.equal(Object.prototype.hasOwnProperty.call(mergedShared, 'tx'), false,
  'The shared settings payload never includes transaction rows');

const sharedDeleteLocal = JSON.parse(JSON.stringify(sharedBase));
sharedDeleteLocal.incomeSources = [];
const mergedDelete = api.mergeSharedSettingsSnapshots(sharedBase, sharedDeleteLocal, sharedRemote);
assert.deepEqual(
  mergedDelete.incomeSources.map(item => item.id).sort(),
  ['INC-MOBILE'],
  'A local removal is merged while unrelated records added remotely are retained'
);

// Historical FX: old baseline before the first recorded rate, then effective-dated rates.
api.setState(makeState());
assert.equal(api.toEGP(100, 'USD', '2026-01-15'), 4850, 'Baseline rate applies before first historical record');
assert.equal(api.toEGP(100, 'USD', '2026-02-15'), 6000, 'February rate applies on its effective date');
assert.equal(api.toEGP(100, 'USD', '2026-03-15'), 6500, 'March rate supersedes February rate');
assert.equal(api.toEGP(100, 'EGP', '2026-03-15'), 100, 'EGP always converts 1:1');

api.recordHistoricalRate('USD', 58, '2026-01-20');
assert.equal(api.toEGP(100, 'USD', '2026-01-19'), 4850, 'A new historical rate does not change earlier dates');
assert.equal(api.toEGP(100, 'USD', '2026-01-20'), 5800, 'Historical rates apply from their effective date');
assert.equal(api.toEGP(100, 'USD', '2026-01-31'), 5800, 'Historical rate remains active until the next rate');

const transferId = 'TRF-20260115-TEST';
const note = api.makeTransferCloudNote(transferId, 'CASH', 'BANK', 'اختبار تحويل');
assert.deepEqual(
  JSON.parse(JSON.stringify(api.parseTransferCloudNote(note))),
  { id: transferId, from: 'CASH', to: 'BANK', note: 'اختبار تحويل' },
  'Transfer metadata round-trips inside the existing Notes field'
);

const outgoing = {
  id: 1, date: '2026-02-15', name: 'تحويل إلى الحساب البنكي', type: 'تحويل',
  cat: 'تحويل داخلي', amt: 100, fee: 2, pay: 'نقدي', acc: 'CASH',
  code: '', qty: '', price: '', note: 'اختبار تحويل', googleNotes: note, cur: 'USD',
  transferId, transferFrom: 'CASH', transferTo: 'BANK', transferNote: 'اختبار تحويل'
};
const incoming = {
  id: 2, date: '2026-02-15', name: 'تحويل من النقدية', type: 'تسوية',
  cat: 'تحويل داخلي', amt: 100, fee: 0, pay: 'نقدي', acc: 'BANK',
  code: '', qty: '', price: '', note: 'اختبار تحويل', googleNotes: note, cur: 'USD',
  transferId, transferFrom: 'CASH', transferTo: 'BANK', transferNote: 'اختبار تحويل'
};
api.setState(makeState({ tx: [outgoing, incoming] }));
const calculated = api.calc();
assert.equal(calculated.inc, 0, 'A transfer pair must not increase income');
assert.equal(calculated.exp, 120, 'Only the 2 USD transfer fee is expense, converted at the transfer date rate');
assert.equal(calculated.bal.find(account => account.code === 'CASH').bal, -6120, 'Source account loses amount plus fee');
assert.equal(calculated.bal.find(account => account.code === 'BANK').bal, 6000, 'Destination account receives the transfer amount');
assert.equal(api.transferPairIssues(), 0, 'A complete equal transfer pair passes the audit');

api.setState(makeState({ tx: [outgoing] }));
api.calc();
assert.equal(api.transferPairIssues(), 1, 'A transfer without its receiving side is flagged for audit');


const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const cssPath = path.join(__dirname, '..', 'css', 'style.css');
const css = fs.readFileSync(cssPath, 'utf8');
const legacyHtmlPath = path.join(__dirname, '..', 'Meyaar-main', 'Meyar', 'index.html');
const legacyHtml = fs.readFileSync(legacyHtmlPath, 'utf8');
assert.match(html, /rel="canonical" href="https:\/\/newhosttr3vel\.github\.io\/Meyaar\//, 'Root app declares the canonical GitHub Pages URL');
assert.match(html, /og:image" content="https:\/\/newhosttr3vel\.github\.io\/Meyaar\/assets\/meyaar-social\.png"/, 'Social preview image points to the root assets directory');
assert.ok(legacyHtml.includes("window.location.replace('../../'"),
  'The previous deployed URL redirects to the root app');
assert.match(html, /id="modalTransfer"/, 'The transfer modal exists');
assert.match(html, /id="formTransfer" class="tx-modal-form transfer-modal-form"/, 'The transfer form uses the scrolling modal layout');
assert.match(html, /name="from"/, 'The source account selector is present');
assert.match(html, /name="to"/, 'The destination account selector is present');
assert.match(html, /name="amount"/, 'The transfer amount field is present');
assert.match(html, /id="transferFxPreview"/, 'The transfer preview is visible to the user');
assert.match(html, /id="txFxPreview"/, 'The transaction FX preview is visible to the user');
assert.match(source, /function openTransfer\(tx = null\)/, 'The transfer modal opener exists');
assert.match(source, /TYPES\.filter\(type => type !== 'تحويل' && type !== 'تسوية'\)/, 'New transfers are routed through the paired workflow');
assert.match(source, /async function deleteLinkedTransfer\(tx\)/, 'Transfers are handled as linked pairs for deletion');
assert.match(html, /style\.css\?v=20261029-modules1/, 'Updated CSS cache version is active');
assert.match(html, /app\.js\?v=20261029-modules1/, 'Updated JS cache version is active');
assert.match(html, /data-tab="rec"/, 'The recurring obligations tab is present');
assert.match(html, /id="modalRecurring"/, 'The recurring obligation editor exists');
assert.match(html, /id="formRecurring"/, 'The recurring obligation form exists');
for (const id of ['recName', 'recType', 'recAmount', 'recCurrency', 'recCategory', 'recAccount', 'recStartDate', 'recDueDay', 'recReminderDays']) {
  assert.ok(html.includes('id="' + id + '"'), 'Recurring form field ' + id + ' exists');
}
assert.match(html, /style\.css\?v=20261029-modules1/, 'Recurring CSS cache version is active');
assert.match(html, /app\.js\?v=20261029-modules1/, 'Recurring JS cache version is active');
assert.match(html, /id="btnSidebarToggle"/, 'The sidebar toggle is present');
assert.match(html, /id="appSidebar"/, 'The collapsible sidebar is present');
assert.match(html, /id="sidebarBackdrop"/, 'The sidebar backdrop is present');
assert.match(html, /id="modalIncomeSource"/, 'The income source editor modal exists');
assert.match(html, /id="formIncomeSource"/, 'The income source form exists');
assert.match(html, /data-tab="income"/, 'Income sources navigation is present');
for (const id of ['incomeSourceName', 'incomeSourceKind', 'incomeSourceFrequency', 'incomeSourceCurrency', 'incomeSourceExpected', 'incomeSourceNote']) {
  assert.ok(html.includes('id="' + id + '"'), 'Income source form field ' + id + ' exists');
}
assert.match(source, /function vIncomeSources\(\)/, 'The income sources view is wired');
assert.match(source, /incomeSources:\s*S\.incomeSources/, 'Income sources are included in shared settings');
assert.match(source, /لا ينشئ معاملات ولا يغيّر أرصدة الحسابات أو إجمالي الثروة/, 'Income source catalogue is separate from transaction balances');
for (const tab of ['dash', 'tx', 'income', 'rec', 'goal', 'acc', 'ast', 'set', 'aud']) {
  assert.ok(html.includes('data-tab="' + tab + '"'), 'Sidebar navigation tab ' + tab + ' exists');
}
assert.match(source, /function setSidebarOpen\(open\)/, 'Sidebar open and close behavior exists');
assert.match(source, /e\.key === 'Escape'[\s\S]*?setSidebarOpen\(false\)/, 'Escape closes the sidebar');
assert.match(css, /#appSidebar #navTabs \.nav-link\.active/, 'Sidebar active navigation styling exists');
assert.match(css, /--bg:\s*#f4f7fb/, 'Original light background color is restored');
assert.match(css, /--ac:\s*#0d827a/, 'Original teal accent color is restored');
assert.match(css, /--hero-grad:\s*linear-gradient\(125deg, #15374a/, 'Original hero gradient is restored');
assert.match(css, /@keyframes meyaar-view-enter/, 'Smooth view-transition animation is present');
assert.match(css, /prefers-reduced-motion/, 'Reduced-motion accessibility is respected');
assert.match(css, /--mut:\s*#66788b/, 'Original muted text color is restored');
assert.match(css, /--bg:\s*#0a1320/, 'Original dark-mode background is restored');
assert.match(source, /const COL = \['#0d9488'/, 'Original chart color palette is restored');
assert.match(source, /appRoot\.classList\.add\('view-transition'\)/, 'Section navigation triggers a view transition');
assert.match(source, /function vDash\(c\)/, 'The dashboard view renderer exists');
assert.match(source, /id="dashboardMoreDetails"/, 'Secondary dashboard analytics are grouped in an expandable section');
assert.match(source, /class="dashboard-primary-grid"/, 'Dashboard primary summary container exists');
assert.match(source, /<div class="dashboard-primary-grid" aria-label="الملخص المالي الأساسي">[\s\S]*?\$\{safeSpendPanel\}[\s\S]*?<section class="hero-card dashboard-wealth-card"/, 'Safe-to-spend is shown above total wealth');
assert.match(source, /class="dashboard-wealth-summary">[\s\S]*?إجمالي الثروة[\s\S]*?تقدير للأصول والسيولة[\s\S]*?class="dashboard-wealth-allocation"[\s\S]*?توزيع الثروة/, 'Wealth allocation is shown below the wealth total and description');
assert.match(css, /Dashboard summary hierarchy: safe-to-spend first, then wealth and allocation/, 'Dashboard hierarchy styles are present');
assert.match(css, /Dashboard primary summaries: side-by-side on wide screens, stacked on compact screens[\s\S]*?\.dashboard-primary-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\) !important;/, 'Wealth and safe-to-spend cards sit side by side on wide screens');
assert.match(css, /@media \(max-width: 1199\.98px\) \{[\s\S]*?\.dashboard-primary-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) !important;/, 'Primary dashboard cards stack on compact screens');
assert.match(css, /Dashboard summary hierarchy: safe-to-spend first, then wealth and allocation[\s\S]*?\.dashboard-wealth-main\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) !important;/, 'Wealth total sits above the allocation breakdown');
assert.match(source, /class="dashboard-safe-metrics"/, 'Safe-spend summary uses compact component metrics');
assert.match(source, /class="dashboard-safe-more"/, 'Safe-spend calculation details are collapsed until requested');
assert.match(css, /\.dashboard-primary-grid\s*\{/, 'Primary dashboard summary uses a responsive grid');
assert.match(css, /\.dashboard-safe-metric\s*\{/, 'Compact safe-spend metrics have dedicated styling');
assert.match(css, /grid-template-areas:\s*"label amount" "note note"/, 'Safe-spend result has a readable two-row hierarchy');
assert.match(css, /\.dashboard-wealth-legend \.leg-item\s*\{[\s\S]*?border-radius:\s*10px/, 'Wealth breakdown items are separated into compact readable tiles');
assert.match(css, /\.dashboard-safe-spend\.is-deficit \.safe-spend-result\s*\{[\s\S]*?color-mix\(in srgb, var\(--red\) 8%/, 'A deficit gets a restrained warning treatment');
assert.match(source, /dashboard-kpi-grid/, 'The dashboard uses a dedicated concise KPI grid');
assert.match(source, /dashboard-sync-banner/, 'Cloud sync warnings have a dedicated compact banner');
assert.match(source, /dashboardMoreDetails\.addEventListener\('toggle'/, 'Charts resize when secondary analytics are opened');
assert.match(css, /\.dashboard-header/, 'Dashboard title and report filters use a dedicated layout');
assert.match(css, /\.dashboard-more > summary/, 'The expandable analytics section has clear summary styling');
assert.match(css, /body\s*\{\s*padding-bottom:\s*0 !important/s, 'The old mobile bottom navigation spacing is removed');
assert.match(css, /\.recurring-hero/, 'The recurring page has its own visual treatment');

// Income source definitions are metadata only: they are normalized and shared,
// but do not generate or mutate financial transactions.
assert.ok(api.INCOME_SOURCE_KINDS.includes('وظيفة ومرتب'), 'A salary source type is available');
assert.ok(api.INCOME_SOURCE_FREQUENCIES.includes('شهري'), 'Monthly income frequency is available');
const sourceFixture = {
  id: 'INC-TEST-001', name: 'الراتب', kind: 'وظيفة ومرتب',
  frequency: 'شهري', cur: 'EGP', expectedAmount: 12000, note: '',
  active: true, createdAt: '2026-10-29T00:00:00.000Z'
};
const incomeTxFixture = {
  id: 771, date: '2026-03-15', name: 'راتب مارس', type: 'دخل', cat: 'دخل',
  amt: 100, fee: 0, pay: 'نقدي', acc: 'CASH', code: '', qty: '', price: '',
  note: '', cur: 'USD', st: 'سليم'
};
api.setState(makeState({ tx: [incomeTxFixture], incomeSources: [] }));
const incomeWithoutSource = api.calc().inc;
api.setState(makeState({ tx: [incomeTxFixture], incomeSources: [sourceFixture] }));
const incomeWithSource = api.calc().inc;
assert.equal(incomeWithSource, incomeWithoutSource, 'Adding a source must not alter calculated transaction income');
assert.equal(api.getState().tx[0].amt, 100, 'Adding a source must not change existing transaction amounts');
assert.equal(api.getState().incomeSources.length, 1, 'Income source definitions are retained in normalized state');
assert.equal(api.sharedSettingsPayload().incomeSources.length, 1, 'Income source definitions are included in shared settings');
assert.ok(api.incomeSourceId().startsWith('INC-'), 'Income source IDs use their own namespace');
assert.match(css, /#modalRecurring[\s\S]*?overflow-y:auto/, 'The recurring modal has a mobile scroll layout');
assert.match(source, /function checkRecurringReminders\(\)/, 'Recurring reminders are checked while the site is open');
assert.match(source, /async function generateRecurringOccurrence\(scheduleId, dueDate\)/, 'Occurrence generation is implemented');



// Recurring obligations: month-end clamping, marker round-trip, and idempotent occurrence detection.
assert.equal(api.monthDueDate(2026, 1, 31), '2026-02-28', 'February due dates clamp to its last day');
assert.equal(api.monthDueDate(2026, 3, 31), '2026-04-30', 'April due dates clamp to its last day');
assert.equal(api.monthDueDate(2028, 1, 31), '2028-02-29', 'Leap-year February supports day 29');

const recurringId = 'REC-2026-RENT';
const recurringSchedule = {
  id: recurringId, name: 'إيجار الشقة', type: 'مصروف', cat: 'الأساسيات',
  amount: 5000, fee: 0, cur: 'EGP', acc: 'CASH', pay: 'تحويل بنكي',
  startDate: '2026-01-01', dueDay: 31, reminderDays: 3, note: 'إيجار',
  active: true, createdAt: '2026-01-01T00:00:00.000Z'
};
api.setState(makeState({ recurringSchedules: [recurringSchedule] }));
let recurringDates = api.recurringOccurrences({
  fromDate: '2026-02-27', daysAhead: 4, todayDate: '2026-02-27'
});
assert.ok(recurringDates.some(item => item.dueDate === '2026-02-28'),
  'A due date at month end is shown in the agenda');
assert.ok(recurringDates.some(item => item.dueDate === '2026-01-31' && item.daysUntil < 0),
  'An ungenerated due date is identified as overdue');

api.markOccurrenceGenerated(recurringId, '2026-01-31', 'transaction-12');
recurringDates = api.recurringOccurrences({
  fromDate: '2026-02-27', daysAhead: 4, todayDate: '2026-02-27'
});
assert.ok(!recurringDates.some(item => item.dueDate === '2026-01-31'),
  'A generated occurrence is removed from the unrecorded agenda');

const recurringNote = api.makeRecurringCloudNote(recurringId, '2026-02-28', 'إيجار الشقة', 'إيجار فبراير');
assert.deepEqual(
  JSON.parse(JSON.stringify(api.parseRecurringCloudNote(recurringNote))),
  { id: recurringId, date: '2026-02-28', name: 'إيجار الشقة', note: 'إيجار فبراير' },
  'Recurring occurrence marker round-trips through the existing Notes column'
);
api.setState(makeState({ recurringSchedules: [recurringSchedule], tx: [{
  id: 13, date: '2026-02-28', type: 'مصروف', cat: 'الأساسيات', amt: 5000,
  acc: 'CASH', cur: 'EGP', note: 'إيجار فبراير', googleNotes: recurringNote
}] }));
assert.equal(api.occurrenceAlreadyGenerated(recurringId, '2026-02-28'), true,
  'A sheet transaction marker prevents a second generation of the same occurrence');



// Financial goals: completion ratio, monthly plan, deadline handling, and state normalization.
assert.equal(api.goalProgress({ target: 60000, current: 15000 }), 25, 'Goal progress is calculated from current and target balances');
assert.equal(api.goalProgress({ target: 0, current: 10 }), 0, 'A zero target cannot create an invalid progress ratio');
assert.equal(api.goalMonthsRemaining('2027-10-28', '2026-10-28'), 12, 'A one-year goal has twelve saving months');
assert.equal(api.goalMonthlyRequired({ target: 60000, current: 0, deadline: '2027-10-28' }, '2026-10-28'), 5000,
  'A 60000 target over twelve months requires 5000 per month before returns');
assert.equal(api.goalMonthlyRequired({ target: 60000, current: 10000, deadline: '2027-10-28' }, '2026-10-28'), 4166.67,
  'Existing goal balance is subtracted before calculating the monthly plan');
assert.equal(api.goalMonthlyRequired({ target: 60000, current: 60000, deadline: '2027-10-28' }, '2026-10-28'), 0,
  'A completed goal does not ask for additional monthly savings');
assert.equal(api.goalMonthlyRequired({ target: 60000, current: 10000, deadline: '2026-10-01' }, '2026-10-28'), 50000,
  'For an overdue goal the remaining balance is surfaced as an immediate catch-up amount');

const validGoal = {
  id: 'GOAL-TEST-1', name: 'صندوق الطوارئ', category: 'احتياطي الطوارئ',
  target: 60000, current: 5000, cur: 'EGP', deadline: '2027-10-28',
  note: '', active: true, createdAt: '2026-10-28T00:00:00.000Z', history: []
};
api.setState(makeState({ financialGoals: [validGoal], pendingFinancialGoalIds: ['GOAL-TEST-1'] }));
assert.equal(api.getState().financialGoals.length, 1, 'A valid financial goal survives shared state normalization');
assert.equal(api.getState().pendingFinancialGoalIds[0], 'GOAL-TEST-1', 'Pending goal changes are retained until cloud sync');
assert.ok(html.includes('data-tab="goal"') && html.includes('id="formGoal"') && html.includes('id="formGoalContribution"'),
  'Goals navigation and both goal forms exist');
assert.match(source, /function vFinancialGoals\(\)/, 'The financial goals screen is wired');
assert.match(source, /S\.financialGoals = S\.financialGoals\.map\(item => item\.id === goal\.id \? updated : item\)/,
  'Goal contributions update the selected goal, not all goals');
assert.match(css, /\.goal-card/, 'Goal cards have dedicated responsive styling');



// Safe-to-spend forecast: use today's liquid balances, deduct unpaid obligations once, and reserve only goal balances.
const safetyState = makeState({
  accounts: [
    { code: 'CASH', name: 'النقدية', type: 'نقد', open: 10000, liq: 1 },
    { code: 'BANK', name: 'الحساب البنكي', type: 'بنك', open: 40000, liq: 1 },
    { code: 'THNDR', name: 'محفظة ثاندر', type: 'وسيط', open: 30000, liq: 0 }
  ],
  tx: [{
    id: 44, date: '2026-10-20', type: 'مصروف', amt: 4000, fee: 0,
    cat: 'الأساسيات', acc: 'CASH', cur: 'EGP', pay: 'نقدي',
    note: 'إيجار الشقة', name: 'إيجار الشقة'
  }],
  recurringSchedules: [
    { id: 'REC-RENT', name: 'إيجار الشقة', type: 'مصروف', cat: 'الأساسيات', amount: 4000, fee: 0, cur: 'EGP', acc: 'CASH', pay: 'نقدي', startDate: '2026-10-01', dueDay: 20, reminderDays: 3, note: 'إيجار الشقة', active: true, createdAt: '2026-10-01T00:00:00.000Z' },
    { id: 'REC-INTERNET', name: 'فاتورة النت', type: 'مصروف', cat: 'الأساسيات', amount: 1000, fee: 0, cur: 'EGP', acc: 'BANK', pay: 'تحويل بنكي', startDate: '2026-10-01', dueDay: 31, reminderDays: 3, note: '', active: true, createdAt: '2026-10-01T00:00:00.000Z' },
    { id: 'REC-OLD-SUB', name: 'اشتراك قديم غير مدفوع', type: 'مصروف', cat: 'الرغبات', amount: 2000, fee: 0, cur: 'EGP', acc: 'BANK', pay: 'نقدي', startDate: '2026-08-01', dueDay: 5, reminderDays: 3, note: '', active: true, createdAt: '2026-08-01T00:00:00.000Z' },
    { id: 'REC-SALARY', name: 'المرتب المتوقع', type: 'دخل', cat: 'دخل', amount: 100000, fee: 0, cur: 'EGP', acc: 'BANK', pay: 'تحويل بنكي', startDate: '2026-10-01', dueDay: 28, reminderDays: 3, note: '', active: true, createdAt: '2026-10-01T00:00:00.000Z' }
  ],
  financialGoals: [
    { id: 'GOAL-RESERVE', name: 'صندوق الطوارئ', category: 'احتياطي الطوارئ', target: 20000, current: 8000, cur: 'EGP', deadline: '2027-10-20', note: '', active: true, createdAt: '2026-10-01T00:00:00.000Z', history: [] }
  ]
});
api.setState(safetyState);
const safety = api.safeToSpendSnapshot('2026-10-28');
assert.equal(safety.available, 46000, 'Safe-to-spend starts from opening balances plus valid movements through today, excluding non-liquid assets');
assert.equal(safety.commitments, 13000, 'The forecast includes unpaid old months and upcoming bills but excludes the already-paid matching rent and expected income');
assert.equal(safety.reservedGoals, 8000, 'Only the current amount reserved in active goals is subtracted, not their unfilled target gaps');
assert.equal(safety.safe, 25000, 'Safe-to-spend applies available minus commitments minus reserved goals');
assert.equal(safety.overdueCount, 3, 'Every overdue unpaid month is included in the safety estimate');
assert.equal(safety.obligations.some(item => item.name === 'المرتب المتوقع'), false, 'Expected recurring income is not treated as confirmed cash');
assert.equal(safety.obligations.some(item => item.name === 'إيجار الشقة' && item.dueDate === '2026-10-20'), false,
  'A valid transaction matching the exact due-date signature is not deducted a second time');
assert.equal(safety.obligations.some(item => item.name === 'إيجار الشقة' && item.dueDate === '2026-11-20'), true,
  'The next unpaid occurrence of the same recurring rent is still reserved');

api.setState(makeState({
  accounts: [
    { code: 'CASH', name: 'النقدية', type: 'نقد', open: 1000, liq: 1 },
    { code: 'BANK', name: 'الحساب البنكي', type: 'بنك', open: 0, liq: 1 }
  ],
  recurringSchedules: [
    { id: 'REC-EXPENSIVE', name: 'قسط مستحق', type: 'مصروف', cat: 'الأساسيات', amount: 5000, fee: 0, cur: 'EGP', acc: 'CASH', pay: 'نقدي', startDate: '2026-10-01', dueDay: 30, reminderDays: 0, note: '', active: true, createdAt: '' }
  ],
  financialGoals: [
    { id: 'GOAL-TOO-MUCH', name: 'هدف محجوز', category: 'ادخار عام', target: 10000, current: 2000, cur: 'EGP', deadline: '2027-10-28', active: true, history: [] }
  ]
}));
const shortSafety = api.safeToSpendSnapshot('2026-10-28');
assert.equal(shortSafety.safe, -6000, 'The indicator can go negative when commitments and goal reserves exceed liquid funds');
assert.equal(shortSafety.shortfall, 6000, 'The forecast exposes the amount of the expected cash shortfall');
assert.ok(source.includes('safe-spend-panel') && source.includes('safe-spend-assumptions'),
  'Dashboard includes the indicator and an expandable assumptions note');
assert.match(source, /function safeToSpendSnapshot\(/, 'The safe-to-spend calculation is implemented in the financial core');
assert.match(source, /الالتزامات المحجوزة أكبر من السيولة المتاحة/, 'The dashboard warns when reserved commitments exceed available cash');
assert.match(css, /\.safe-spend-panel/, 'The safe-to-spend indicator has dedicated responsive styling');


console.log('Meyaar financial-core tests passed: dated FX, transfers, recurring dates, goal plans, safe-to-spend forecast, occurrence idempotency, and UI wiring.');
