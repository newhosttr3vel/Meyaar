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

console.log('Meyaar financial-core tests passed: dated FX, baseline migration, transfer accounting, and incomplete-pair audit.');
