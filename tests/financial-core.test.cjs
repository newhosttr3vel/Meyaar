'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appPath = path.join(__dirname, '..', 'Meyaar-main', 'Meyar', 'js', 'app.js');
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


const htmlPath = path.join(__dirname, '..', 'Meyaar-main', 'Meyar', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const cssPath = path.join(__dirname, '..', 'Meyaar-main', 'Meyar', 'css', 'style.css');
const css = fs.readFileSync(cssPath, 'utf8');
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
assert.match(html, /style\.css\?v=20261028-recurring1/, 'Updated CSS cache version is active');
assert.match(html, /app\.js\?v=20261028-recurring1/, 'Updated JS cache version is active');
assert.match(html, /data-tab="rec"/, 'The recurring obligations tab is present');
assert.match(html, /id="modalRecurring"/, 'The recurring obligation editor exists');
assert.match(html, /id="formRecurring"/, 'The recurring obligation form exists');
for (const id of ['recName', 'recType', 'recAmount', 'recCurrency', 'recCategory', 'recAccount', 'recStartDate', 'recDueDay', 'recReminderDays']) {
  assert.ok(html.includes('id="' + id + '"'), 'Recurring form field ' + id + ' exists');
}
assert.match(html, /style\.css\?v=20261028-recurring1/, 'Recurring CSS cache version is active');
assert.match(html, /app\.js\?v=20261028-recurring1/, 'Recurring JS cache version is active');
assert.match(css, /\.recurring-hero/, 'The recurring page has its own visual treatment');
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


console.log('Meyaar financial-core tests passed: dated FX, transfers, recurring dates, occurrence idempotency, and UI wiring.');
