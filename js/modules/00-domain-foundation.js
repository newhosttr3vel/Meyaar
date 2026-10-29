/* ========== Constants & Seed ========== */
const KEY = 'fin_dash_pro_v2';
const GOLD = 'ذهب_عيار_21';
const CATS = ['الأساسيات', 'الرغبات', 'الادخار', 'الاستثمارات', 'الصدقات', 'الطوارئ'];
const ALLC = [...CATS, 'دخل', 'تحويل داخلي', 'رسوم وضرائب', 'أخرى'];
const TYPES = ['دخل', 'مصروف', 'شراء ذهب', 'بيع ذهب', 'شراء أسهم', 'بيع أسهم', 'تحويل', 'تسوية'];
const LEGACY_ASSET_TYPES = ['شراء أصل', 'بيع أصل'];
const PURCHASE_TYPES = new Set(['شراء ذهب', 'شراء أسهم', 'شراء أصل']);
const SALE_TYPES = new Set(['بيع ذهب', 'بيع أسهم', 'بيع أصل']);
const ASSET_TYPES = new Set([...PURCHASE_TYPES, ...SALE_TYPES]);
const GOLD_TYPES = new Set(['شراء ذهب', 'بيع ذهب']);
function isAssetPurchase(type) { return PURCHASE_TYPES.has(type); }
function isAssetSale(type) { return SALE_TYPES.has(type); }
function isAssetTransaction(type) { return ASSET_TYPES.has(type); }
function defaultAssetCode(type) { return GOLD_TYPES.has(type) ? GOLD : ''; }
const PAY = ['نقدي', 'تحويل بنكي', 'بطاقة خصم', 'بطاقة ائتمان', 'ثاندر', 'محفظة إلكترونية', 'أخرى'];
const MON = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const COL = ['#0d9488', '#d97706', '#6366f1', '#dc2626', '#8b5cf6', '#16a34a', '#ea580c', '#64748b'];
const CURS = { EGP: 'ج.م', SAR: 'ر.س', USD: '$' };
const INCOME_SOURCE_KINDS = ['وظيفة ومرتب', 'عمل حر', 'مشروع أو تجارة', 'عمولات ومكافآت', 'استثمار', 'إيجار', 'مبيعات', 'أخرى'];
const INCOME_SOURCE_FREQUENCIES = ['شهري', 'أسبوعي', 'يومي', 'سنوي', 'غير منتظم'];
function incomeSourceId() {
  return 'INC-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

const API_URL = "https://script.google.com/macros/s/AKfycbwJI2_IFB0ukOs1Ufko0wuLob2eAEIFLaPwsglNAeWnMdCUB_7euqWGV4xGzVBH1SflzQ/exec";
const SHARED_SYNC_INTERVAL_MS = 45000;
let cloudSettingsInitialized = false;
let cloudSettingsStatus = 'لم يتم تحميل إعدادات المزامنة بعد';
let cloudSettingsLastUpdated = '';
let cloudSettingsSyncTimer = null;
let cloudSettingsSyncInFlight = false;
let googleTransactionsLoaded = false;
let googleRemoteTransactions = [];

// The Notes column is the shared display text because the sheet has no separate Name column.
function googleNotes(tx) {
  if (!tx) return '';
  return String(tx.googleNotes !== undefined ? tx.googleNotes : ((tx.note || tx.name) || '')).trim();
}


// Transfer reference is carried in the existing Notes column to remain compatible with the current A:L sheet schema.
function makeTransferCloudNote(id, fromCode, toCode, note = '') {
  const header = 'تحويل داخلي [مرجع:' + id + '] [من:' + fromCode + '] [إلى:' + toCode + ']';
  return header + (String(note || '').trim() ? '\n' + String(note).trim() : '');
}
function parseTransferCloudNote(notes) {
  const raw = String(notes || '');
  const match = raw.match(/^تحويل داخلي \[مرجع:([A-Za-z0-9_-]+)\] \[من:([A-Za-z0-9_]+)\] \[إلى:([A-Za-z0-9_]+)\](?:\r?\n([\s\S]*))?$/);
  if (!match) return null;
  return { id: match[1], from: match[2], to: match[3], note: match[4] || '' };
}
function transferMetadata(tx) {
  if (!tx) return null;
  const parsed = parseTransferCloudNote(googleNotes(tx));
  const id = String(tx.transferId || (parsed && parsed.id) || '');
  if (!id) return null;
  return {
    id,
    from: String(tx.transferFrom || (parsed && parsed.from) || ''),
    to: String(tx.transferTo || (parsed && parsed.to) || ''),
    note: String(tx.transferNote !== undefined ? tx.transferNote : ((parsed && parsed.note) || tx.note || ''))
  };
}
function accountDisplayName(code) {
  const account = S.accounts.find(item => item.code === code);
  return account ? account.name : String(code || 'حساب غير معروف');
}
function transferDisplayName(type, metadata) {
  return type === 'تحويل'
    ? 'تحويل إلى ' + accountDisplayName(metadata.to)
    : 'تحويل من ' + accountDisplayName(metadata.from);
}
function transferPairIssues(transactions = S.tx) {
  const groups = new Map();
  transactions.forEach(tx => {
    const meta = transferMetadata(tx);
    if (!meta) return;
    if (!groups.has(meta.id)) groups.set(meta.id, []);
    groups.get(meta.id).push({ tx, meta });
  });
  let issues = 0;
  groups.forEach(group => {
    const out = group.find(item => item.tx.type === 'تحويل');
    const incoming = group.find(item => item.tx.type === 'تسوية');
    const meta = group[0] && group[0].meta;
    const invalid = group.length !== 2 || !out || !incoming || !meta ||
      out.tx.acc !== meta.from || incoming.tx.acc !== meta.to ||
      meta.from === meta.to || String(out.tx.id) === String(incoming.tx.id) ||
      out.tx.date !== incoming.tx.date || out.tx.cur !== incoming.tx.cur ||
      !Number.isFinite(Number(out.tx.amt)) || !Number.isFinite(Number(incoming.tx.amt)) ||
      Math.abs(Number(out.tx.amt) - Number(incoming.tx.amt)) >= 0.005 ||
      (out.tx.st && out.tx.st !== 'سليم') || (incoming.tx.st && incoming.tx.st !== 'سليم');
    if (invalid) issues++;
  });
  return issues;
}


// Recurring obligations share their definition through the existing saved settings state.
// A stable marker in Notes makes each generated occurrence recognizable in Google Sheets too.
function makeRecurringCloudNote(id, dueDate, name, note = '') {
  const safeName = String(name || 'التزام دوري').replace(/[\[\]\r\n]/g, ' ').trim().slice(0, 100) || 'التزام دوري';
  const header = 'التزام متكرر [مرجع:' + id + '] [استحقاق:' + dueDate + '] [الاسم:' + safeName + ']';
  return header + (String(note || '').trim() ? '\n' + String(note).trim() : '');
}

function parseRecurringCloudNote(notes) {
  const raw = String(notes || '');
  const match = raw.match(/^التزام متكرر \[مرجع:([A-Za-z0-9_-]+)\] \[استحقاق:(\d{4}-\d{2}-\d{2})\] \[الاسم:([^\]]+)\](?:\r?\n([\s\S]*))?$/);
  if (!match || !isValidISODate(match[2])) return null;
  return { id: match[1], date: match[2], name: match[3].trim(), note: match[4] || '' };
}

function recurringOccurrenceKey(scheduleId, dueDate) {
  return String(scheduleId || '') + '|' + String(dueDate || '');
}

function recurringId() {
  return 'REC-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 9).toUpperCase();
}


const GOAL_CATEGORIES = ['احتياطي الطوارئ', 'شراء ذهب', 'شراء عربية', 'استثمار', 'ادخار عام', 'سفر', 'تعليم', 'منزل', 'أخرى'];

function financialGoalId() {
  return 'GOAL-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 9).toUpperCase();
}

function goalProgress(goal) {
  const target = Math.max(0, Number(goal && goal.target) || 0);
  const current = Math.max(0, Number(goal && goal.current) || 0);
  return target > 0 ? Math.max(0, Math.min(100, current / target * 100)) : 0;
}

function goalMonthsRemaining(deadline, todayDate = localISODate()) {
  const due = normalizeGoogleDate(deadline);
  const today = normalizeGoogleDate(todayDate);
  if (!isValidISODate(due) || !isValidISODate(today) || due < today) return 0;
  const dueY = Number(due.slice(0, 4));
  const dueM = Number(due.slice(5, 7));
  const todayY = Number(today.slice(0, 4));
  const todayM = Number(today.slice(5, 7));
  let months = (dueY - todayY) * 12 + dueM - todayM;
  if (Number(due.slice(8, 10)) < Number(today.slice(8, 10))) months -= 1;
  return Math.max(1, months);
}

function goalMonthlyRequired(goal, todayDate = localISODate()) {
  const target = Math.max(0, Number(goal && goal.target) || 0);
  const current = Math.max(0, Number(goal && goal.current) || 0);
  const remaining = Math.max(0, target - current);
  if (remaining <= 0) return 0;
  const months = goalMonthsRemaining(goal && goal.deadline, todayDate);
  if (months <= 0) return Math.round(remaining * 100) / 100;
  return Math.ceil((remaining / months) * 100) / 100;
}

function goalCurrencyLabel(cur) {
  return ({ EGP: 'ج.م.', SAR: 'ر.س.', USD: '$' })[cur] || String(cur || 'ج.م.');
}


function recurringOccurrenceAlreadyBooked(schedule, dueDate, todayDate, ids, validTransactions) {
  const due = normalizeGoogleDate(dueDate);
  const today = normalizeGoogleDate(todayDate);
  if (!schedule || !isValidISODate(due) || !isValidISODate(today)) return false;

  // Recurrence-linked transactions are authoritative even if their transaction date was adjusted.
  const linked = validTransactions.some(tx => {
    const txDate = normalizeGoogleDate(tx.date);
    const marker = parseRecurringCloudNote(googleNotes(tx));
    return isValidISODate(txDate) && txDate <= today && marker &&
      recurringOccurrenceKey(marker.id, marker.date) === recurringOccurrenceKey(schedule.id, due);
  });
  if (linked) return true;

  return validTransactions.some(tx => {
    const txDate = normalizeGoogleDate(tx.date);
    if (!isValidISODate(txDate) || txDate > today || tx.type !== 'مصروف' ||
        String(tx.acc || '') !== String(schedule.acc || '') ||
        String(tx.cat || '') !== String(schedule.cat || '') ||
        String(tx.cur || 'EGP') !== String(schedule.cur || 'EGP') ||
        Math.abs(Number(tx.amt) - Number(schedule.amount)) >= 0.005 ||
        Math.abs(Number(tx.fee || 0) - Number(schedule.fee || 0)) >= 0.005) return false;

    // Exact due-date signature is a strong enough match; for early payment also require a matching note.
    if (txDate === due) return true;
    if (txDate < addCalendarDays(due, -30) || txDate > due) return false;
    const note = googleNotes(tx).toLocaleLowerCase();
    const name = String(schedule.name || '').trim().toLocaleLowerCase();
    const extra = String(schedule.note || '').trim().toLocaleLowerCase();
    return (name.length >= 3 && note.includes(name)) || (extra.length >= 3 && note.includes(extra));
  });
}

function safeToSpendSnapshot(todayDate = localISODate()) {
  const today = isValidISODate(todayDate) ? todayDate : localISODate();
  const ids = {};
  S.tx.forEach(tx => { ids[tx.id] = (ids[tx.id] || 0) + 1; });
  const validTransactions = S.tx.filter(tx => status(tx, ids) === 'سليم');

  const available = S.accounts.filter(account => account.liq).reduce((total, account) => {
    const movements = validTransactions
      .filter(tx => tx.acc === account.code && tx.date <= today)
      .reduce((sum, tx) => sum + P(tx), 0);
    return total + Number(account.open || 0) + movements;
  }, 0);

  // Unlike the reminder agenda, the safety forecast counts every unpaid past-due month.
  // Future-dated entries are not in today's cash balance, so their commitment is still counted once.
  const endDate = addCalendarDays(today, 30);
  const endMonth = endDate.slice(0, 7);
  const obligations = [];
  (S.recurringSchedules || []).filter(schedule =>
    schedule.active !== false && schedule.type === 'مصروف' && isValidISODate(schedule.startDate)
  ).forEach(schedule => {
    let monthCursor = schedule.startDate.slice(0, 7);
    while (monthCursor <= endMonth) {
      const [year, month] = monthCursor.split('-').map(Number);
      const dueDate = monthDueDate(year, month - 1, schedule.dueDay);
      if (dueDate >= schedule.startDate && dueDate <= endDate) {
        // Once the due date has passed, a known recorded occurrence is already reflected in cash.
        if (!(dueDate <= today && occurrenceAlreadyGenerated(schedule.id, dueDate)) &&
            !recurringOccurrenceAlreadyBooked(schedule, dueDate, today, ids, validTransactions)) {
          obligations.push({
            key: recurringOccurrenceKey(schedule.id, dueDate),
            dueDate,
            scheduleId: schedule.id,
            name: schedule.name,
            cur: schedule.cur,
            amount: Number(schedule.amount || 0),
            fee: Number(schedule.fee || 0),
            amountEGP: toEGP(Number(schedule.amount || 0) + Number(schedule.fee || 0), schedule.cur, today),
            overdue: dueDate < today
          });
        }
      }
      const [cursorYear, cursorMonth] = monthCursor.split('-').map(Number);
      monthCursor = cursorMonth === 12
        ? String(cursorYear + 1) + '-01'
        : String(cursorYear) + '-' + String(cursorMonth + 1).padStart(2, '0');
    }
  });
  obligations.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));

  const commitments = obligations.reduce((sum, item) => sum + item.amountEGP, 0);
  // Goal.current is the amount declared as still set aside in liquid funds, not the unfunded target gap.
  const reservedGoals = (S.financialGoals || [])
    .filter(goal => goal && goal.active !== false)
    .reduce((sum, goal) => sum + toEGP(Math.max(0, Number(goal.current) || 0), goal.cur, today), 0);
  const safe = available - commitments - reservedGoals;

  return {
    date: today,
    horizonDays: 30,
    available,
    obligations,
    commitments,
    reservedGoals,
    safe,
    shortfall: Math.max(0, -safe),
    overdueCount: obligations.filter(item => item.overdue).length,
    upcomingCount: obligations.filter(item => !item.overdue).length,
    validTransactionCount: validTransactions.length
  };
}

function monthDueDate(year, monthIndex, dueDay) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const day = Math.max(1, Math.min(31, Number(dueDay) || 1));
  return String(year) + '-' + String(monthIndex + 1).padStart(2, '0') + '-' + String(Math.min(day, lastDay)).padStart(2, '0');
}

function addCalendarDays(isoDate, amount) {
  const date = new Date(String(isoDate) + 'T12:00:00');
  date.setDate(date.getDate() + Number(amount || 0));
  return localISODate(date);
}

function occurrenceAlreadyGenerated(scheduleId, dueDate) {
  const key = recurringOccurrenceKey(scheduleId, dueDate);
  if ((S.generatedOccurrences || []).some(item => item && item.key === key)) return true;
  if (S.tx.some(tx => {
    const meta = parseRecurringCloudNote(googleNotes(tx));
    return meta && recurringOccurrenceKey(meta.id, meta.date) === key;
  })) return true;
  return googleRemoteTransactions.some(tx => {
    const meta = parseRecurringCloudNote(tx.notes);
    return meta && recurringOccurrenceKey(meta.id, meta.date) === key;
  });
}

function markOccurrenceGenerated(scheduleId, dueDate, txId = '') {
  const key = recurringOccurrenceKey(scheduleId, dueDate);
  if (!Array.isArray(S.generatedOccurrences)) S.generatedOccurrences = [];
  const previous = S.generatedOccurrences.find(item => item && item.key === key);
  if (previous) {
    previous.transactionId = txId || previous.transactionId || '';
    previous.generatedAt = previous.generatedAt || new Date().toISOString();
  } else {
    S.generatedOccurrences.push({
      key, scheduleId: String(scheduleId), date: dueDate,
      transactionId: txId || '', generatedAt: new Date().toISOString()
    });
  }
}

function recurringOccurrences({ fromDate = localISODate(), daysAhead = 90, todayDate = localISODate() } = {}) {
  const today = isValidISODate(todayDate) ? todayDate : localISODate();
  const safeFromDate = isValidISODate(fromDate) ? fromDate : today;
  const endDate = addCalendarDays(safeFromDate, daysAhead);
  const rows = [];

  (S.recurringSchedules || []).filter(schedule => schedule.active !== false).forEach(schedule => {
    if (!isValidISODate(schedule.startDate)) return;
    let monthCursor = schedule.startDate.slice(0, 7);
    const endMonth = endDate.slice(0, 7);
    let latestOverdue = null;
    const upcoming = [];

    while (monthCursor <= endMonth) {
      const [year, month] = monthCursor.split('-').map(Number);
      const dueDate = monthDueDate(year, month - 1, schedule.dueDay);
      if (dueDate >= schedule.startDate && !occurrenceAlreadyGenerated(schedule.id, dueDate)) {
        const daysUntil = Math.round((new Date(dueDate + 'T12:00:00') - new Date(today + 'T12:00:00')) / 86400000);
        const entry = { schedule, scheduleId: schedule.id, dueDate, daysUntil, key: recurringOccurrenceKey(schedule.id, dueDate) };
        if (dueDate < today) latestOverdue = entry;
        else if (dueDate <= endDate) upcoming.push(entry);
      }
      const [cursorYear, cursorMonth] = monthCursor.split('-').map(Number);
      monthCursor = cursorMonth === 12
        ? String(cursorYear + 1) + '-01'
        : String(cursorYear) + '-' + String(cursorMonth + 1).padStart(2, '0');
    }

    // Show only the latest overdue occurrence per schedule, plus upcoming dates in the horizon.
    if (latestOverdue) rows.push(latestOverdue);
    rows.push(...upcoming);
  });

  return rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.schedule.name.localeCompare(b.schedule.name));
}

function checkRecurringReminders() {
  const today = localISODate();
  const seen = new Set(Array.isArray(S.ui.recurringReminderKeys) ? S.ui.recurringReminderKeys : []);
  const occurrences = recurringOccurrences({ daysAhead: 90 });
  const alerts = occurrences.filter(item => {
    const schedule = item.schedule;
    return !seen.has(item.key) &&
      ((item.daysUntil < 0 && item.daysUntil >= -7) ||
        (item.daysUntil >= 0 && item.daysUntil <= Math.max(0, Number(schedule.reminderDays) || 0))) &&
      item.dueDate <= addCalendarDays(today, Math.max(0, Number(schedule.reminderDays) || 0));
  });
  if (!alerts.length) return;
  alerts.forEach(item => seen.add(item.key));
  S.ui.recurringReminderKeys = [...seen].slice(-1000);
  save();
  const nearest = alerts.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const overdue = alerts.filter(item => item.daysUntil < 0).length;
  const msg = overdue
    ? 'لديك ' + overdue + ' التزام/التزامات متأخرة. أقربها: ' + nearest.schedule.name + ' (' + nearest.dueDate + '). افتح «الالتزامات» للمراجعة.'
    : 'لديك ' + alerts.length + ' التزام/التزامات قريبة الاستحقاق. أقربها: ' + nearest.schedule.name + ' (' + nearest.dueDate + ').';
  showAppToast(msg, 15000);
}

function numericCell(value, fallback = '') {
  if (value === '' || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sharedSettingsPayload() {
  return {
    rates: S.rates,
    baseRates: S.baseRates,
    rateHistory: S.rateHistory,
    recurringSchedules: S.recurringSchedules,
    generatedOccurrences: S.generatedOccurrences,
    financialGoals: S.financialGoals,
    incomeSources: S.incomeSources,
    budget: S.budget,
    warn: S.warn,
    accounts: S.accounts,
    prices: S.prices
  };
}

function localISODate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function isValidISODate(value) {
  const raw = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const date = new Date(raw + 'T00:00:00');
  return Number.isFinite(date.getTime()) && localISODate(date) === raw;
}

function normalizeGoogleDate(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const iso = raw.match(/^\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

