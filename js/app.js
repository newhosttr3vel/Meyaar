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
let cloudSettingsBaseline = null;
let cloudSettingsRevision = 0;
let googleTransactionsLoaded = false;
let googleRemoteTransactions = [];

// Planner tasks use the dedicated TASKS sheet, independent from financial transaction/settings sync.
let plannerSaveInFlight = false;
let plannerLoadInFlight = false;
let plannerEditingTaskId = '';
let cloudPlannerSupported = false;
let plannerCloudInitialized = false;
let plannerCloudStatus = 'لم يتم تحميل المهام من Google Sheets بعد';
let plannerCloudLastUpdated = '';
let plannerDeletedIds = new Set();
let plannerLegacyBaselineTasks = [];

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

const SHARED_SETTING_KEYS = [
  'rates', 'baseRates', 'rateHistory', 'recurringSchedules',
  'generatedOccurrences', 'financialGoals', 'incomeSources',
  'plannerRules', 'plannerActivities', 'budget', 'warn', 'accounts', 'prices'
];
const SHARED_SETTING_COLLECTION_KEYS = {
  rateHistory: item => String(item && item.cur || '') + '|' + String(item && item.date || ''),
  recurringSchedules: item => String(item && item.id || ''),
  generatedOccurrences: item => String(item && item.key || ''),
  financialGoals: item => String(item && item.id || ''),
  incomeSources: item => String(item && item.id || ''),
  plannerActivities: item => String(item && item.id || ''),
  accounts: item => String(item && item.code || ''),
  prices: item => String(item && item.code || '')
};
const SHARED_SETTING_OBJECT_KEYS = new Set(['rates', 'baseRates', 'plannerRules', 'budget']);

function sharedSettingsPayload(state = S) {
  const source = state && typeof state === 'object' ? state : {};
  return {
    rates: source.rates,
    baseRates: source.baseRates,
    rateHistory: source.rateHistory,
    recurringSchedules: source.recurringSchedules,
    generatedOccurrences: source.generatedOccurrences,
    financialGoals: source.financialGoals,
    incomeSources: source.incomeSources,
    plannerRules: source.plannerRules,
    plannerActivities: source.plannerActivities,
    budget: source.budget,
    warn: source.warn,
    accounts: source.accounts,
    prices: source.prices
  };
}

function sharedSettingsClone(value) {
  try { return JSON.parse(JSON.stringify(value)); }
  catch (error) { return value; }
}

function sharedSettingsEqual(left, right) {
  return JSON.stringify(left === undefined ? null : left) ===
    JSON.stringify(right === undefined ? null : right);
}

function normalizeSharedSettingsSnapshot(snapshot) {
  const defaults = seed();
  const incoming = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {};
  const normalized = normalizeState({ ...defaults, ...incoming, ui: defaults.ui, tx: [] });
  return sharedSettingsClone(sharedSettingsPayload(normalized));
}

function mergeSharedCollectionByKey(baseItems, localItems, remoteItems, keyForItem) {
  const toMap = items => {
    const result = new Map();
    (Array.isArray(items) ? items : []).forEach((item, index) => {
      const key = keyForItem(item);
      if (key) result.set(key, { item, index });
    });
    return result;
  };
  const baseMap = toMap(baseItems);
  const localMap = toMap(localItems);
  const resultMap = toMap(remoteItems);
  const changedKeys = new Set([...baseMap.keys(), ...localMap.keys()]);

  changedKeys.forEach(key => {
    const hadBase = baseMap.has(key);
    const hasLocal = localMap.has(key);
    const baseItem = hadBase ? baseMap.get(key).item : undefined;
    const localItem = hasLocal ? localMap.get(key).item : undefined;
    if (hadBase === hasLocal && sharedSettingsEqual(baseItem, localItem)) return;
    if (hasLocal) resultMap.set(key, { item: sharedSettingsClone(localItem), index: resultMap.size });
    else resultMap.delete(key);
  });

  return [...resultMap.values()].map(entry => entry.item);
}

/*
 * Three-way merge of shared settings:
 * - Remote changes are the starting point.
 * - Only local changes relative to the last server snapshot are applied.
 * - Collections merge by stable entity key, so concurrent additions in the same
 *   collection are preserved instead of replacing one device's whole array.
 * - Map-like fields merge by property, keeping unrelated currency/category edits.
 */
function mergeSharedSettingsSnapshots(baseSnapshot, localSnapshot, remoteSnapshot) {
  const remote = normalizeSharedSettingsSnapshot(remoteSnapshot);
  if (!baseSnapshot || typeof baseSnapshot !== 'object' || Array.isArray(baseSnapshot)) return remote;

  const base = normalizeSharedSettingsSnapshot(baseSnapshot);
  const local = normalizeSharedSettingsSnapshot(localSnapshot);
  const merged = sharedSettingsClone(remote);

  SHARED_SETTING_KEYS.forEach(key => {
    const baseValue = base[key];
    const localValue = local[key];
    const remoteValue = remote[key];

    if (Object.prototype.hasOwnProperty.call(SHARED_SETTING_COLLECTION_KEYS, key)) {
      merged[key] = mergeSharedCollectionByKey(
        baseValue, localValue, remoteValue, SHARED_SETTING_COLLECTION_KEYS[key]
      );
      return;
    }

    if (SHARED_SETTING_OBJECT_KEYS.has(key)) {
      const baseObject = baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue) ? baseValue : {};
      const localObject = localValue && typeof localValue === 'object' && !Array.isArray(localValue) ? localValue : {};
      const remoteObject = remoteValue && typeof remoteValue === 'object' && !Array.isArray(remoteValue) ? remoteValue : {};
      const nextObject = { ...remoteObject };
      const changedProperties = new Set([...Object.keys(baseObject), ...Object.keys(localObject)]);
      changedProperties.forEach(property => {
        const hasBase = Object.prototype.hasOwnProperty.call(baseObject, property);
        const hasLocal = Object.prototype.hasOwnProperty.call(localObject, property);
        if (hasBase === hasLocal && sharedSettingsEqual(baseObject[property], localObject[property])) return;
        if (hasLocal) nextObject[property] = sharedSettingsClone(localObject[property]);
        else delete nextObject[property];
      });
      merged[key] = nextObject;
      return;
    }

    if (!sharedSettingsEqual(baseValue, localValue)) merged[key] = sharedSettingsClone(localValue);
  });

  return normalizeSharedSettingsSnapshot(merged);
}

function mergeLegacySharedSettingsSnapshots(localSnapshot, remoteSnapshot) {
  // On the first release with baseline tracking there is no historical cloud snapshot
  // on existing browsers. Comparing against seed defaults prevents default values from
  // overriding cloud values, while retaining non-default local edits and additions.
  return mergeSharedSettingsSnapshots(
    normalizeSharedSettingsSnapshot(seed()),
    localSnapshot,
    remoteSnapshot
  );
}

function setCloudSettingsBaseline(snapshot, revision = 0) {
  cloudSettingsBaseline = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? normalizeSharedSettingsSnapshot(snapshot)
    : null;
  const parsedRevision = Number(revision);
  cloudSettingsRevision = Number.isFinite(parsedRevision) && parsedRevision >= 0
    ? Math.trunc(parsedRevision) : 0;
  if (typeof S !== 'undefined' && S && typeof S === 'object') {
    S.__cloudSettingsBaseline = sharedSettingsClone(cloudSettingsBaseline);
    S.__cloudSettingsRevision = cloudSettingsRevision;
  }
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


function sameRemoteCore(tx, remote) {
  return normalizeGoogleDate(tx.date) === normalizeGoogleDate(remote.date) &&
    String(tx.type || '').trim() === String(remote.type || '').trim() &&
    String(tx.cat || '').trim() === String(remote.cat || '').trim() &&
    Number.isFinite(Number(tx.amt)) &&
    Math.abs(Number(tx.amt) - Number(remote.amt)) < 0.005;
}

function pendingTransactionKey(tx) {
  return [
    String(tx.id ?? ''),
    normalizeGoogleDate(tx.date),
    String(tx.type || ''),
    String(Number(tx.amt) || 0),
    String(tx.cat || ''),
    googleNotes(tx)
  ].join('|');
}

function pendingTransactions() {
  return Array.isArray(S.pendingLocalTx) ? S.pendingLocalTx : [];
}

async function syncPendingTransactionsToGoogle() {
  if (!googleTransactionsLoaded) {
    alert('لا توجد قراءة مؤكدة من Google Sheets حتى الآن. أعد تحميل الصفحة ثم حاول مرة أخرى.');
    return;
  }

  const pending = pendingTransactions();
  if (!pending.length) {
    alert('لا توجد معاملات محلية معلقة خارج Google Sheets.');
    return;
  }

  const safeToUpload = pending.filter(tx =>
    !googleRemoteTransactions.some(remote => sameRemoteCore(tx, remote))
  );
  const ambiguous = pending.length - safeToUpload.length;

  const confirmed = confirm(
    'يوجد ' + pending.length + ' معاملة محلية لا تظهر في بيانات Google الحالية.\\n' +
    'سيتم رفع ' + safeToUpload.length + ' معاملة فقط إذا لم يوجد صف سحابي له نفس التاريخ والنوع والمبلغ والتصنيف.\\n' +
    'سيتم ترك ' + ambiguous + ' معاملة للمراجعة بدل إنشاء تكرار محتمل.\\n\\n' +
    'تأكد أنك على الجهاز الذي يحتوي على البيانات الصحيحة. متابعة؟'
  );
  if (!confirmed) return;

  let uploaded = 0;
  const failures = [];

  for (const tx of safeToUpload) {
    try {
      await saveTransactionToGoogle(tx);
      tx.googleSynced = true;
      S.tx.push(tx);
      S.pendingLocalTx = pendingTransactions().filter(
        item => pendingTransactionKey(item) !== pendingTransactionKey(tx)
      );
      googleRemoteTransactions.push({
        date: normalizeGoogleDate(tx.date),
        type: tx.type,
        amt: Number(tx.amt),
        cat: tx.cat,
        notes: googleNotes(tx)
      });
      save();
      uploaded++;
    } catch (error) {
      failures.push(
        (tx.name || tx.note || ('معاملة #' + tx.id)) + ': ' +
        (error && error.message ? error.message : String(error))
      );
    }
  }

  await loadDataFromGoogle({ renderAfter: false });
  render();

  const lines = [
    'انتهت محاولة توحيد المعاملات.',
    'تم رفع: ' + uploaded,
    'تحتاج مراجعة لأن لها معاملة مشابهة في Google: ' + ambiguous,
    'فشل رفع: ' + failures.length
  ];
  if (failures.length) lines.push('', 'الأخطاء:', ...failures.slice(0, 5));
  alert(lines.join('\\n'));
}

// Google currently stores only Date, Type, Amount, Category and Notes.
// Merge those rows into local records instead of replacing richer local records with partial data.
async function loadDataFromGoogle({ renderAfter = true } = {}) {
  try {
    const response = await fetch(API_URL, { method: 'GET', cache: 'no-store' });
    if (!response.ok) throw new Error('Google Sheets HTTP ' + response.status);
    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error(data && (data.message || data.error) || 'صيغة البيانات القادمة من Google Sheets غير صحيحة');
    }

    const firstRow = Array.isArray(data[0]) ? data[0].map(v => String(v || '').trim().toLowerCase()) : [];
    const hasHeaders = firstRow.includes('date') && firstRow.includes('type') &&
      firstRow.includes('amount') && firstRow.includes('category');
    const hasFullSchema = ['account', 'payment', 'currency', 'fee', 'assetcode', 'quantity', 'price']
      .every(header => firstRow.includes(header));
    const rows = data.slice(hasHeaders ? 1 : 0).filter(row =>
      Array.isArray(row) && row.some(cell => String(cell ?? '').trim() !== '')
    );
    const localPool = S.tx.map(tx => ({ tx, used: false }));
    const imported = [];
    const usedIds = new Set(S.tx.map(tx => String(tx.id)));
    let nextId = Math.max(0, ...S.tx.map(tx => Number(tx.id) || 0)) + 1;
    const allocateId = () => {
      while (usedIds.has(String(nextId))) nextId++;
      const id = nextId++;
      usedIds.add(String(id));
      return id;
    };

    rows.forEach(row => {
      const date = normalizeGoogleDate(row[0]);
      const type = String(row[1] || 'مصروف').trim();
      const amount = Number(row[2]);
      const cat = String(row[3] || 'أخرى').trim();
      const notes = String(row[4] || '').trim();
      if (!isValidISODate(date) || !Number.isFinite(amount) || amount <= 0) return;

      const transferMeta = parseTransferCloudNote(notes);
      const recurringMeta = parseRecurringCloudNote(notes);
      const remote = { date, type, amt: amount, cat, notes };
      let match = localPool.find(item => !item.used && sameRemoteCore(item.tx, remote) && googleNotes(item.tx) === notes);
      if (!match) {
        const candidates = localPool.filter(item => !item.used && sameRemoteCore(item.tx, remote));
        if (candidates.length === 1) match = candidates[0];
      }

      const remoteDetails = {
        // Blank cells in legacy rows must not erase richer details held on the primary device.
        acc: hasFullSchema ? String(row[5] || '') : '',
        pay: hasFullSchema ? String(row[6] || '') : '',
        cur: hasFullSchema ? String(row[7] || '') : '',
        fee: hasFullSchema ? numericCell(row[8], '') : '',
        code: hasFullSchema ? String(row[9] || '') : '',
        qty: hasFullSchema ? numericCell(row[10], '') : '',
        price: hasFullSchema ? numericCell(row[11], '') : ''
      };

      if (match) {
        match.used = true;
        const tx = { ...match.tx, date, type, amt: amount, cat, googleNotes: notes };
        const previousNotes = googleNotes(match.tx);
        if (previousNotes !== notes) {
          if (!match.tx.name || match.tx.name === previousNotes) tx.name = notes;
          if (!match.tx.note || match.tx.note === previousNotes) tx.note = notes;
        }
        if (hasFullSchema) {
          // Empty sheet cells may be legacy blanks; don't destroy richer local values during migration.
          tx.acc = remoteDetails.acc || match.tx.acc || 'CASH';
          tx.pay = remoteDetails.pay || match.tx.pay || 'نقدي';
          tx.cur = remoteDetails.cur || match.tx.cur || 'EGP';
          tx.fee = row[8] === '' || row[8] === null || row[8] === undefined ? fee(match.tx) : remoteDetails.fee;
          tx.code = remoteDetails.code || match.tx.code || '';
          tx.qty = remoteDetails.qty === '' ? (match.tx.qty ?? '') : remoteDetails.qty;
          tx.price = remoteDetails.price === '' ? (match.tx.price ?? '') : remoteDetails.price;
        } else {
          tx.acc = match.tx.acc || 'CASH';
          tx.pay = match.tx.pay || 'نقدي';
          tx.cur = match.tx.cur || 'EGP';
          tx.fee = fee(match.tx);
          tx.code = match.tx.code || '';
          tx.qty = match.tx.qty ?? '';
          tx.price = match.tx.price ?? '';
        }
        if (transferMeta) {
          tx.transferId = transferMeta.id;
          tx.transferFrom = transferMeta.from;
          tx.transferTo = transferMeta.to;
          tx.transferNote = transferMeta.note;
          tx.note = transferMeta.note;
          tx.name = transferDisplayName(type, transferMeta);
        }
        if (recurringMeta) {
          tx.recurringId = recurringMeta.id;
          tx.recurringDate = recurringMeta.date;
          tx.recurringNote = recurringMeta.note;
          tx.note = recurringMeta.note;
          tx.name = recurringMeta.name;
        }
        tx.googleSynced = true;
        imported.push(tx);
      } else {
        imported.push({
          id: allocateId(), date, type, amt: amount, cat,
          note: recurringMeta ? recurringMeta.note : (transferMeta ? transferMeta.note : notes),
          googleNotes: notes, googleSynced: true,
          name: recurringMeta ? recurringMeta.name : (transferMeta ? transferDisplayName(type, transferMeta) : (notes || 'معاملة من Google Sheets')),
          transferId: transferMeta ? transferMeta.id : '',
          transferFrom: transferMeta ? transferMeta.from : '',
          transferTo: transferMeta ? transferMeta.to : '',
          transferNote: transferMeta ? transferMeta.note : '',
          recurringId: recurringMeta ? recurringMeta.id : '',
          recurringDate: recurringMeta ? recurringMeta.date : '',
          recurringNote: recurringMeta ? recurringMeta.note : '',
          fee: hasFullSchema ? remoteDetails.fee : 0,
          pay: hasFullSchema ? remoteDetails.pay : 'نقدي',
          acc: hasFullSchema ? remoteDetails.acc : 'CASH',
          code: hasFullSchema ? remoteDetails.code : '',
          qty: hasFullSchema ? remoteDetails.qty : '',
          price: hasFullSchema ? remoteDetails.price : '',
          sub: '', cur: hasFullSchema ? remoteDetails.cur : 'EGP'
        });
      }
    });

    // Retain never-synced local transactions for safety. Previously synced rows missing from
    // Google are removed locally so deletions propagate to other devices.
    googleRemoteTransactions = rows
      .map(row => ({
        date: normalizeGoogleDate(row[0]),
        type: String(row[1] || 'مصروف').trim(),
        amt: Number(row[2]),
        cat: String(row[3] || 'أخرى').trim(),
        notes: String(row[4] || '').trim()
      }))
      .filter(row => isValidISODate(row.date) && Number.isFinite(row.amt) && row.amt > 0);
    googleTransactionsLoaded = true;

    // Make Google Sheets the canonical dataset for calculations on every device.
    // Keep unsynced local-only rows separately for explicit, duplicate-safe reconciliation.
    const localOnly = localPool
      .filter(item => !item.used && !item.tx.googleSynced)
      .map(item => ({ ...item.tx, googleSynced: false }));
    const existingPending = pendingTransactions();
    const pendingByKey = new Map();
    [...existingPending, ...localOnly].forEach(tx => {
      pendingByKey.set(pendingTransactionKey(tx), tx);
    });
    S.pendingLocalTx = [...pendingByKey.values()];
    S.tx = imported;
    // Rebuild the generation ledger from sheet markers if saving shared settings was interrupted.
    S.tx.forEach(tx => {
      const meta = parseRecurringCloudNote(googleNotes(tx));
      if (meta) markOccurrenceGenerated(meta.id, meta.date, String(tx.id));
    });
    save();
  } catch (error) {
    googleTransactionsLoaded = false;
    console.error('تعذر تحميل المعاملات من Google Sheets:', error);
  } finally {
    if (renderAfter && typeof render === 'function') render();
  }
}

async function postGooglePayload(payload) {
  const response = await fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }
  });
  if (!response.ok) throw new Error(`Google Sheets HTTP ${response.status}`);
  const raw = await response.text();
  let result;
  try {
    result = JSON.parse(raw);
  } catch (_) {
    const preview = String(raw || '').replace(/\s+/g, ' ').slice(0, 180);
    throw new Error('استجابة Google Sheets ليست JSON صالحة' + (preview ? ': ' + preview : ''));
  }
  if (result && (result.status === 'error' || result.success === false)) {
    throw new Error(result.message || result.error || 'رفض Google Sheets العملية');
  }
  return result;
}

async function loadSharedSettingsFromGoogle({ renderAfter = true } = {}) {
  try {
    const response = await fetch(API_URL + '?action=state&_=' + Date.now(), {
      method: 'GET',
      cache: 'no-store'
    });
    if (!response.ok) throw new Error('Google Sheets HTTP ' + response.status);
    const result = await response.json();

    // Older Apps Script deployments return the transaction array for every GET.
    if (!result || Array.isArray(result) || result.success === false ||
        !Object.prototype.hasOwnProperty.call(result, 'state')) {
      if (result && result.success === false) {
        throw new Error(result.message || result.error || 'تعذر قراءة الإعدادات المشتركة');
      }
      cloudSettingsStatus = 'خدمة Google تحتاج تحديثًا لدعم مزامنة الإعدادات';
      return false;
    }

    if (!result.state) {
      // Keep the local state intact. Seeding the first cloud snapshot must be explicit
      // so a new device's defaults can never replace the primary device's settings.
      cloudSettingsInitialized = false;
      cloudSettingsStatus = 'لم تُحفظ الإعدادات المشتركة بعد. افتح النظام على جهازك الأساسي واضغط «مزامنة إعدادات هذا الجهاز».';
      return true;
    }

    const previousBaseline = cloudSettingsBaseline ? sharedSettingsClone(cloudSettingsBaseline) : null;
    const localSnapshot = normalizeSharedSettingsSnapshot(sharedSettingsPayload());
    const remoteState = normalizeState({
      ...seed(),
      ...result.state,
      ui: S.ui,
      tx: S.tx
    });
    const remoteSnapshot = normalizeSharedSettingsSnapshot(sharedSettingsPayload(remoteState));
    let mergedSnapshot;

    if (previousBaseline) {
      // Preserve local edits made while offline or during another device's update.
      // Three-way merge only applies local deltas and preserves unrelated remote edits.
      mergedSnapshot = mergeSharedSettingsSnapshots(previousBaseline, localSnapshot, remoteSnapshot);
    } else {
      // Legacy devices may contain locally edited settings but no saved cloud baseline yet.
      // Use a known seed snapshot as the base: untouched defaults do not overwrite the
      // cloud, while non-default local edits and added records are preserved and merged.
      // Same-key conflicts cannot be reconstructed without a historical baseline, so the
      // local version of a non-default edited item wins during this one-time migration.
      mergedSnapshot = mergeLegacySharedSettingsSnapshots(localSnapshot, remoteSnapshot);
    }

    S = normalizeState({ ...S, ...mergedSnapshot, ui: S.ui, tx: S.tx });
    setCloudSettingsBaseline(remoteSnapshot, result.revision);
    cloudSettingsInitialized = true;
    cloudSettingsLastUpdated = result.updatedAt || '';
    cloudSettingsStatus = 'تم تحميل الإعدادات المشتركة من Google Sheets' +
      (cloudSettingsLastUpdated ? ' — ' + cloudSettingsLastUpdated : '');
    save();

    const localPending = !sharedSettingsEqual(sharedSettingsPayload(), remoteSnapshot) ||
      (S.pendingRecurringScheduleIds || []).length > 0 ||
      (S.pendingFinancialGoalIds || []).length > 0;
    if (localPending) scheduleSharedSettingsSync();

    if (renderAfter && S.ui.tab === 'set') render();
    return true;
  } catch (error) {
    cloudSettingsStatus = 'تعذرت مزامنة الإعدادات: ' +
      (error && error.message ? error.message : String(error));
    console.error('تعذر تحميل الإعدادات المشتركة من Google Sheets:', error);
    return false;
  }
}

async function saveSharedSettingsToGoogle({ manual = false } = {}) {
  if (cloudSettingsSyncInFlight) return false;
  cloudSettingsSyncInFlight = true;
  cloudSettingsStatus = 'جارٍ حفظ الإعدادات المشتركة…';
  if (S.ui.tab === 'set') render();

  const sentSnapshot = normalizeSharedSettingsSnapshot(sharedSettingsPayload());
  const baseSnapshot = cloudSettingsBaseline ? sharedSettingsClone(cloudSettingsBaseline) : null;
  const baseRevision = cloudSettingsRevision;
  let succeeded = false;
  let shouldFollowupSync = false;

  try {
    const result = await postGooglePayload({
      action: 'savestate',
      state: sentSnapshot,
      baseState: baseSnapshot,
      expectedRevision: baseRevision
    });
    if (!result || result.success === false || result.status === 'error' ||
        !result.state || typeof result.state !== 'object' || Array.isArray(result.state)) {
      throw new Error((result && (result.message || result.error)) ||
        'لم تؤكد Google حفظ الإعدادات المشتركة. حدّث كود Apps Script وانشر إصدارًا جديدًا.');
    }

    const serverSnapshot = normalizeSharedSettingsSnapshot(result.state);
    const localAtResponse = normalizeSharedSettingsSnapshot(sharedSettingsPayload());
    // Keep edits made while the request was in flight, while also incorporating
    // changes from other devices returned by the server.
    const reconciledSnapshot = mergeSharedSettingsSnapshots(sentSnapshot, localAtResponse, serverSnapshot);
    S = normalizeState({ ...S, ...reconciledSnapshot, ui: S.ui, tx: S.tx });
    setCloudSettingsBaseline(serverSnapshot, result.revision);
    cloudSettingsInitialized = true;
    cloudSettingsLastUpdated = result.updatedAt || new Date().toISOString();
    cloudSettingsStatus = 'تمت مزامنة الإعدادات مع Google Sheets';
    S.pendingRecurringScheduleIds = [];
    S.pendingFinancialGoalIds = [];
    save();
    succeeded = true;
    shouldFollowupSync = !sharedSettingsEqual(sharedSettingsPayload(), serverSnapshot);
    if (S.ui.tab === 'set') render();
    return true;
  } catch (error) {
    cloudSettingsStatus = 'فشلت مزامنة الإعدادات: ' +
      (error && error.message ? error.message : String(error));
    console.error('فشلت مزامنة الإعدادات المشتركة:', error);
    if (manual) {
      alert(cloudSettingsStatus +
        '\nتأكد من تحديث ونشر كود Google Apps Script الداعم لـ GET?action=state وPOST action=savestate.');
    }
    if (S.ui.tab === 'set') render();
    return false;
  } finally {
    cloudSettingsSyncInFlight = false;
    if (succeeded && shouldFollowupSync && cloudSettingsInitialized) scheduleSharedSettingsSync();
  }
}

function scheduleSharedSettingsSync() {
  // First cloud initialization must be explicit so a new device's defaults
  // cannot overwrite the settings that already exist on the primary device.
  if (!cloudSettingsInitialized) return;
  if (cloudSettingsSyncTimer) clearTimeout(cloudSettingsSyncTimer);
  cloudSettingsSyncTimer = setTimeout(() => {
    cloudSettingsSyncTimer = null;
    saveSharedSettingsToGoogle();
  }, 700);
}

async function saveTransactionToGoogle(tx) {
  const dataToSend = {
    Date: tx.date ? String(tx.date).substring(0, 10) : '',
    Type: tx.type,
    Amount: Number(tx.amt),
    Category: tx.cat,
    Notes: googleNotes(tx) || tx.name,
    Account: tx.acc || 'CASH',
    Payment: tx.pay || 'نقدي',
    Currency: tx.cur || 'EGP',
    Fee: fee(tx),
    AssetCode: tx.code || '',
    Quantity: tx.qty === '' || tx.qty === null || tx.qty === undefined ? '' : Number(tx.qty),
    Price: tx.price === '' || tx.price === null || tx.price === undefined ? '' : Number(tx.price)
  };
  const result = await postGooglePayload(dataToSend);
  if (result && (result.status === 'error' || result.success === false)) {
    throw new Error(result.message || result.error || 'لم يتم تأكيد الحفظ في Google Sheets');
  }
  tx.googleSynced = true;
  return result;
}

async function syncTransactionDetailsToGoogle(tx) {
  const notes = googleNotes(tx) || tx.name || '';
  const payload = {
    action: 'syncdetails',
    Date: tx.date, Type: tx.type, Amount: Number(tx.amt), Category: tx.cat, Notes: notes,
    Account: tx.acc || 'CASH', Payment: tx.pay || 'نقدي', Currency: tx.cur || 'EGP',
    Fee: fee(tx), AssetCode: tx.code || '',
    Quantity: tx.qty === '' || tx.qty === null || tx.qty === undefined ? '' : Number(tx.qty),
    Price: tx.price === '' || tx.price === null || tx.price === undefined ? '' : Number(tx.price)
  };
  const result = await postGooglePayload(payload);
  if (!result || result.success === false || result.status === 'error') {
    throw new Error(result && (result.message || result.error) || 'تعذر مزامنة تفاصيل المعاملة');
  }
  return result;
}

async function syncExistingTransactionDetailsToGoogle() {
  const candidates = S.tx.filter(tx => tx.googleSynced);
  if (!candidates.length) {
    alert('لم يتم تحميل معاملات من Google Sheets بعد. أعد تحميل الصفحة ثم حاول مرة أخرى.');
    return;
  }

  const confirmed = confirm(
    'سيتم تحديث تفاصيل المعاملات الموجودة بالفعل في Google Sheets من بيانات هذا الجهاز، ' +
    'بما في ذلك الحساب والعملة والرسوم ورمز الأصل والكمية والسعر. لن تتم إضافة صفوف جديدة.\n\n' +
    'نفّذ هذه الخطوة من الكمبيوتر الذي يحتوي على التفاصيل الصحيحة. هل تريد المتابعة؟'
  );
  if (!confirmed) return;

  let updated = 0;
  const failures = [];
  for (const tx of candidates) {
    try {
      await syncTransactionDetailsToGoogle(tx);
      updated++;
    } catch (error) {
      failures.push({
        id: tx.id,
        name: tx.name || tx.note || 'بدون اسم',
        message: error && error.message ? error.message : String(error)
      });
    }
  }

  const skippedLocal = S.tx.length - candidates.length;
  const summary = [
    'انتهت مزامنة التفاصيل.',
    'تم تحديث: ' + updated,
    'تعذر تحديث: ' + failures.length,
    'معاملات محلية غير موجودة/غير مؤكدة في Google وتم تخطيها: ' + skippedLocal
  ];
  if (failures.length) {
    summary.push('', 'أول الأخطاء:');
    failures.slice(0, 5).forEach(item =>
      summary.push('#' + item.id + ' — ' + item.name + ': ' + item.message)
    );
  }
  alert(summary.join('\n'));
  await loadDataFromGoogle();
}

async function deleteTransactionFromGoogle(tx) {
  const notes = googleNotes(tx);
  // Send the full row identity. Older Apps Script deployments may ignore extra fields,
  // while updated deployments can use Amount/Type/Category to avoid deleting the wrong same-date row.
  const result = await postGooglePayload({
    action: 'delete',
    Date: tx.date, Type: tx.type, Amount: Number(tx.amt), Category: tx.cat, Notes: notes,
    Account: tx.acc || 'CASH', Payment: tx.pay || 'نقدي', Currency: tx.cur || 'EGP',
    Fee: fee(tx), AssetCode: tx.code || '',
    Quantity: tx.qty === '' || tx.qty === null || tx.qty === undefined ? '' : Number(tx.qty),
    Price: tx.price === '' || tx.price === null || tx.price === undefined ? '' : Number(tx.price),
    date: tx.date, type: tx.type, amount: Number(tx.amt), category: tx.cat, notes,
    account: tx.acc || 'CASH', payment: tx.pay || 'نقدي', currency: tx.cur || 'EGP',
    fee: fee(tx), assetCode: tx.code || '',
    quantity: tx.qty === '' || tx.qty === null || tx.qty === undefined ? '' : Number(tx.qty),
    price: tx.price === '' || tx.price === null || tx.price === undefined ? '' : Number(tx.price)
  });
  if (result && (result.found === false || result.deleted === false || result.success === false || result.status === 'error')) {
    throw new Error(result.message || result.error || 'خدمة Google لم تؤكد حذف الصف. قد يكون التاريخ أو الملاحظات غير مطابقين للصف، أو قد لا تدعم الخدمة الحذف بالحقول الحالية.');
  }
  return result;
}


const T = (id, date, name, cat, sub, type, amt, acc, pay, code, qty, price, note, cur = 'EGP') =>
  ({ id, date, name, cat, sub: sub || '', type, amt, fee: 0, pay, acc, code: code || '', qty: qty || '', price: price || '', note: note || '', cur });

function seed() {
  return {
    ui: { y: 2026, m: 'all', tab: 'dash', q: '', theme: 'light', fxDate: localISODate() },
    rates: { EGP: 1, SAR: 12.9, USD: 48.5 },
    baseRates: { EGP: 1, SAR: 12.9, USD: 48.5 },
    rateHistory: [],
    recurringSchedules: [],
    generatedOccurrences: [],
    pendingRecurringScheduleIds: [],
    financialGoals: [],
    pendingFinancialGoalIds: [],
    incomeSources: [],
    plannerTasks: [],
    plannerRules: {
      sleepStart: '22:00',
      sleepEnd: '05:00',
      workStart: '10:00',
      workEnd: '19:00',
      workDays: [0, 1, 2, 3, 4, 6]
    },
    plannerActivities: [],
    budget: { الأساسيات: 0.5, الرغبات: 0.15, الادخار: 0.15, الاستثمارات: 0.1, الصدقات: 0.05, الطوارئ: 0.05 },
    warn: 0.9,
    accounts: [
      { code: 'CASH', name: 'النقدية', type: 'نقد', open: 0, liq: 1 },
      { code: 'BANK', name: 'الحساب البنكي', type: 'بنك', open: 0, liq: 1 },
      { code: 'VOD_CASH', name: 'فودافون كاش', type: 'محفظة إلكترونية', open: 0, liq: 1 },
      { code: 'THNDR', name: 'محفظة ثاندر', type: 'وسيط', open: 0, liq: 1 }
    ],
    prices: [],
    tx: []
  };
}

function normalizeState(input) {
  const base = seed();
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.tx)) return base;
  const obj = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const out = { ...base, ...input };
  out.ui = { ...base.ui, ...obj(input.ui) };
  if (!['dash', 'tx', 'income', 'acc', 'ast', 'set', 'aud', 'rec', 'goal', 'plan'].includes(out.ui.tab)) out.ui.tab = 'dash';
  out.ui.plannerDate = isValidISODate(out.ui.plannerDate) ? out.ui.plannerDate : localISODate();
  out.ui.y = Number.isInteger(Number(out.ui.y)) && Number(out.ui.y) >= 1900 && Number(out.ui.y) <= 2200 ? Number(out.ui.y) : base.ui.y;
  out.ui.m = out.ui.m === 'all' || /^(0[1-9]|1[0-2])$/.test(String(out.ui.m)) ? String(out.ui.m) : 'all';
  out.ui.q = String(out.ui.q || '');
  out.ui.theme = out.ui.theme === 'dark' ? 'dark' : 'light';
  out.ui.fxDate = isValidISODate(out.ui.fxDate) ? out.ui.fxDate : localISODate();
  out.ui.recurringReminderKeys = Array.isArray(out.ui.recurringReminderKeys)
    ? out.ui.recurringReminderKeys.map(String).slice(-1000)
    : [];

  out.rates = { ...base.rates, ...obj(input.rates) };
  Object.keys(out.rates).forEach(cur => {
    const n = Number(out.rates[cur]);
    out.rates[cur] = cur === 'EGP' ? 1 : (Number.isFinite(n) && n > 0 ? n : (base.rates[cur] || 1));
  });
  out.rates.EGP = 1;

  // Migration baseline for old transactions whose original FX rates were never stored.
  const baseRateSource = Object.keys(obj(input.baseRates)).length ? obj(input.baseRates) : out.rates;
  out.baseRates = { ...base.rates, ...baseRateSource };
  Object.keys(out.baseRates).forEach(cur => {
    const n = Number(out.baseRates[cur]);
    out.baseRates[cur] = cur === 'EGP' ? 1 : (Number.isFinite(n) && n > 0 ? n : (out.rates[cur] || 1));
  });
  out.baseRates.EGP = 1;

  const rateHistoryByKey = new Map();
  (Array.isArray(input.rateHistory) ? input.rateHistory : []).forEach(item => {
    if (!item || typeof item !== 'object') return;
    const date = normalizeGoogleDate(item.date);
    const cur = String(item.cur || '').trim().toUpperCase();
    const rate = Number(item.rate);
    if (!isValidISODate(date) || !cur || cur === 'EGP' || !Number.isFinite(rate) || rate <= 0) return;
    rateHistoryByKey.set(date + '|' + cur, { date, cur, rate });
  });
  out.rateHistory = [...rateHistoryByKey.values()].sort((a, b) =>
    a.date.localeCompare(b.date) || a.cur.localeCompare(b.cur)
  );

  const recurringIds = new Set();
  out.recurringSchedules = (Array.isArray(input.recurringSchedules) ? input.recurringSchedules : [])
    .filter(item => {
      if (!item || typeof item !== 'object' || !String(item.id || '').trim() || recurringIds.has(String(item.id))) return false;
      recurringIds.add(String(item.id));
      return true;
    })
    .map(item => {
      const type = item.type === 'دخل' ? 'دخل' : 'مصروف';
      const allowedCats = type === 'دخل' ? ['دخل'] : [...CATS.filter(cat => cat !== 'الاستثمارات'), 'رسوم وضرائب', 'أخرى'];
      const amount = Number(item.amount);
      const feeAmount = Number(item.fee || 0);
      const startDate = normalizeGoogleDate(item.startDate);
      return {
        id: String(item.id),
        name: String(item.name || 'التزام دوري').trim().slice(0, 100),
        type,
        cat: allowedCats.includes(item.cat) ? String(item.cat) : (type === 'دخل' ? 'دخل' : 'الأساسيات'),
        amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
        fee: Number.isFinite(feeAmount) && feeAmount >= 0 ? feeAmount : 0,
        cur: ['EGP', 'SAR', 'USD'].includes(item.cur) ? item.cur : 'EGP',
        acc: String(item.acc || 'CASH'),
        pay: PAY.includes(item.pay) ? item.pay : 'نقدي',
        startDate: isValidISODate(startDate) ? startDate : localISODate(),
        dueDay: Math.max(1, Math.min(31, Math.trunc(Number(item.dueDay) || 1))),
        reminderDays: Math.max(0, Math.min(30, Math.trunc(Number(item.reminderDays) || 0))),
        note: String(item.note || '').slice(0, 300),
        active: item.active !== false,
        createdAt: String(item.createdAt || '')
      };
    })
    .filter(item => item.name && item.amount > 0);
  const generatedByKey = new Map();
  (Array.isArray(input.generatedOccurrences) ? input.generatedOccurrences : []).forEach(item => {
    if (!item || typeof item !== 'object' || !String(item.key || '').trim()) return;
    const scheduleId = String(item.scheduleId || '');
    const date = normalizeGoogleDate(item.date);
    if (!scheduleId || !isValidISODate(date)) return;
    generatedByKey.set(String(item.key), { ...item, key: String(item.key), scheduleId, date });
  });
  out.generatedOccurrences = [...generatedByKey.values()];
  out.pendingRecurringScheduleIds = Array.isArray(input.pendingRecurringScheduleIds)
    ? [...new Set(input.pendingRecurringScheduleIds.map(String))]
    : [];

  const financialGoalIds = new Set();
  out.financialGoals = (Array.isArray(input.financialGoals) ? input.financialGoals : [])
    .filter(item => {
      if (!item || typeof item !== 'object' || !String(item.id || '').trim() || financialGoalIds.has(String(item.id))) return false;
      financialGoalIds.add(String(item.id));
      return true;
    })
    .map(item => {
      const target = Number(item.target);
      const current = Number(item.current || 0);
      const deadline = normalizeGoogleDate(item.deadline);
      const history = (Array.isArray(item.history) ? item.history : []).filter(entry =>
        entry && typeof entry === 'object' && isValidISODate(normalizeGoogleDate(entry.date)) &&
        Number.isFinite(Number(entry.amount)) && Number(entry.amount) > 0
      ).slice(0, 200).map(entry => ({
        id: String(entry.id || financialGoalId()),
        date: normalizeGoogleDate(entry.date),
        amount: Number(entry.amount),
        direction: entry.direction === 'withdraw' ? 'withdraw' : 'add',
        note: String(entry.note || '').slice(0, 200)
      }));
      return {
        id: String(item.id),
        name: String(item.name || '').trim().slice(0, 100),
        category: GOAL_CATEGORIES.includes(item.category) ? item.category : 'أخرى',
        target: Number.isFinite(target) && target > 0 ? target : 0,
        current: Number.isFinite(current) && current >= 0 ? current : 0,
        cur: ['EGP', 'SAR', 'USD'].includes(item.cur) ? item.cur : 'EGP',
        deadline: isValidISODate(deadline) ? deadline : '',
        note: String(item.note || '').slice(0, 300),
        active: item.active !== false,
        createdAt: String(item.createdAt || ''),
        history
      };
    })
    .filter(item => item.name && item.target > 0 && isValidISODate(item.deadline));
  out.pendingFinancialGoalIds = Array.isArray(input.pendingFinancialGoalIds)
    ? [...new Set(input.pendingFinancialGoalIds.map(String))]
    : [];

  const incomeSourceIds = new Set();
  out.incomeSources = (Array.isArray(input.incomeSources) ? input.incomeSources : [])
    .filter(item => {
      if (!item || typeof item !== 'object' || !String(item.id || '').trim() || incomeSourceIds.has(String(item.id))) return false;
      incomeSourceIds.add(String(item.id));
      return true;
    })
    .map(item => {
      const expected = item.expectedAmount === '' || item.expectedAmount === null || item.expectedAmount === undefined
        ? 0 : Number(item.expectedAmount);
      return {
        id: String(item.id),
        name: String(item.name || '').trim().slice(0, 100),
        kind: INCOME_SOURCE_KINDS.includes(item.kind) ? item.kind : 'أخرى',
        frequency: INCOME_SOURCE_FREQUENCIES.includes(item.frequency) ? item.frequency : 'غير منتظم',
        cur: ['EGP', 'SAR', 'USD'].includes(item.cur) ? item.cur : 'EGP',
        expectedAmount: Number.isFinite(expected) && expected > 0 ? expected : 0,
        note: String(item.note || '').trim().slice(0, 300),
        active: item.active !== false,
        createdAt: String(item.createdAt || '')
      };
    })
    .filter(item => item.name);

  const rawPlannerRules = obj(input.plannerRules);
  const validPlannerTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
  const sleepStart = validPlannerTime(rawPlannerRules.sleepStart) ? String(rawPlannerRules.sleepStart) : base.plannerRules.sleepStart;
  const sleepEnd = validPlannerTime(rawPlannerRules.sleepEnd) ? String(rawPlannerRules.sleepEnd) : base.plannerRules.sleepEnd;
  const workStart = validPlannerTime(rawPlannerRules.workStart) ? String(rawPlannerRules.workStart) : base.plannerRules.workStart;
  const workEnd = validPlannerTime(rawPlannerRules.workEnd) ? String(rawPlannerRules.workEnd) : base.plannerRules.workEnd;
  const timeMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const validSleepPair = timeMinutes(sleepStart) > timeMinutes(sleepEnd);
  const validWorkPair = timeMinutes(workStart) < timeMinutes(workEnd);
  const workDays = Array.isArray(rawPlannerRules.workDays)
    ? [...new Set(rawPlannerRules.workDays.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))]
    : base.plannerRules.workDays.slice();
  out.plannerRules = {
    sleepStart: validSleepPair ? sleepStart : base.plannerRules.sleepStart,
    sleepEnd: validSleepPair ? sleepEnd : base.plannerRules.sleepEnd,
    workStart: validWorkPair ? workStart : base.plannerRules.workStart,
    workEnd: validWorkPair ? workEnd : base.plannerRules.workEnd,
    workDays
  };

  const plannerActivityIds = new Set();
  out.plannerActivities = (Array.isArray(input.plannerActivities) ? input.plannerActivities : [])
    .filter(item => {
      if (!item || typeof item !== 'object') return false;
      const id = String(item.id || '').trim();
      if (!id || plannerActivityIds.has(id)) return false;
      plannerActivityIds.add(id);
      return true;
    })
    .map(item => ({
      id: String(item.id),
      title: String(item.title || '').trim().slice(0, 100),
      category: ['القرآن', 'القراءة', 'التعلم', 'الجيم', 'الصلاة', 'الأكل', 'الراحة', 'عمل', 'تعلم', 'صحة', 'شخصي', 'عائلة', 'راحة', 'أخرى'].includes(item.category) ? item.category : 'شخصي',
      durationMinutes: Math.max(15, Math.min(360, Math.round((Number(item.durationMinutes) || 45) / 15) * 15)),
      sessionsPerWeek: Math.max(1, Math.min(7, Math.trunc(Number(item.sessionsPerWeek) || 1))),
      preferredPeriod: ['morning', 'evening', 'any'].includes(item.preferredPeriod) ? item.preferredPeriod : 'any',
      priority: ['عالية', 'متوسطة', 'منخفضة'].includes(item.priority) ? item.priority : 'متوسطة',
      daysOfWeek: Array.isArray(item.daysOfWeek)
        ? [...new Set(item.daysOfWeek.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))]
        : [0, 1, 2, 3, 4, 5, 6],
      active: item.active !== false,
      createdAt: String(item.createdAt || '')
    }))
    .filter(item => item.title);

  const plannerTaskIds = new Set();
  out.plannerTasks = (Array.isArray(input.plannerTasks) ? input.plannerTasks : [])
    .filter(item => {
      if (!item || typeof item !== 'object') return false;
      const id = String(item.id || '').trim();
      if (!id || plannerTaskIds.has(id)) return false;
      plannerTaskIds.add(id);
      return true;
    })
    .map(item => ({
      id: String(item.id),
      title: String(item.title || '').trim().slice(0, 120),
      date: isValidISODate(item.date) ? item.date : localISODate(),
      startTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(item.startTime || '')) ? String(item.startTime) : '09:00',
      endTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(item.endTime || '')) ? String(item.endTime) : '10:00',
      category: ['القرآن', 'القراءة', 'التعلم', 'الجيم', 'الصلاة', 'الأكل', 'الراحة', 'عمل', 'تعلم', 'صحة', 'شخصي', 'عائلة', 'راحة', 'أخرى'].includes(item.category) ? item.category : 'شخصي',
      priority: ['عالية', 'متوسطة', 'منخفضة'].includes(item.priority) ? item.priority : 'متوسطة',
      status: ['todo', 'partial', 'done', 'postponed', 'missed'].includes(item.status) ? item.status : 'todo',
      note: String(item.note || '').trim().slice(0, 500),
      createdAt: String(item.createdAt || ''),
      updatedAt: String(item.updatedAt || '')
    }))
    .filter(item => item.title && item.startTime !== item.endTime);

  out.budget = { ...base.budget, ...obj(input.budget) };
  CATS.forEach(cat => {
    const n = Number(out.budget[cat]);
    out.budget[cat] = Number.isFinite(n) && n >= 0 && n <= 1 ? n : base.budget[cat];
  });
  const warn = Number(out.warn);
  out.warn = Number.isFinite(warn) && warn > 0 && warn <= 1 ? warn : base.warn;

  const accounts = Array.isArray(input.accounts) ? input.accounts.filter(a => a && typeof a === 'object' && String(a.code || '').trim()) : base.accounts;
  out.accounts = accounts.map(a => ({ ...a, code: String(a.code).trim(), name: String(a.name || a.code),
    type: String(a.type || 'نقد'), open: Number.isFinite(Number(a.open)) ? Number(a.open) : 0, liq: a.liq ? 1 : 0 }));
  if (!out.accounts.length) out.accounts = base.accounts;
  out.prices = (Array.isArray(input.prices) ? input.prices : []).filter(p => p && typeof p === 'object' && String(p.code || '').trim()).map(p => ({
    ...p, code: String(p.code).trim(), cat: String(p.cat || 'أخرى'),
    price: Number.isFinite(Number(p.price)) && Number(p.price) >= 0 ? Number(p.price) : 0,
    date: normalizeGoogleDate(p.date) || String(p.date || '')
  }));
  out.tx = input.tx.filter(t => t && typeof t === 'object' && !Array.isArray(t)).map((t, i) => {
    const amt = t.amt === '' || t.amt === null ? t.amt : (Number.isFinite(Number(t.amt)) ? Number(t.amt) : t.amt);
    const feeValue = t.fee === undefined || t.fee === null || t.fee === '' ? 0 : (Number.isFinite(Number(t.fee)) ? Number(t.fee) : t.fee);
    const transferMeta = parseTransferCloudNote(googleNotes(t));
    return { ...t, id: t.id === undefined || t.id === null ? i + 1 : t.id,
      date: normalizeGoogleDate(t.date) || String(t.date || ''), name: String(t.name || ''),
      type: String(t.type || ''), cat: String(t.cat || 'أخرى'), amt, fee: feeValue,
      acc: String(t.acc || 'CASH'), note: String(t.note || ''), cur: String(t.cur || 'EGP'),
      transferId: String(t.transferId || (transferMeta && transferMeta.id) || ''),
      transferFrom: String(t.transferFrom || (transferMeta && transferMeta.from) || ''),
      transferTo: String(t.transferTo || (transferMeta && transferMeta.to) || ''),
      transferNote: String(t.transferNote !== undefined ? t.transferNote : ((transferMeta && transferMeta.note) || '')) };
  });
  return out;
}

let S;
try { S = normalizeState(JSON.parse(localStorage.getItem(KEY))); }
catch (e) { S = seed(); }

try {
  plannerLegacyBaselineTasks = S.__cloudSettingsBaseline &&
    Array.isArray(S.__cloudSettingsBaseline.plannerTasks)
      ? sharedSettingsClone(S.__cloudSettingsBaseline.plannerTasks)
      : [];
  cloudSettingsBaseline = S.__cloudSettingsBaseline
    ? normalizeSharedSettingsSnapshot(S.__cloudSettingsBaseline)
    : null;
  cloudSettingsRevision = Number.isFinite(Number(S.__cloudSettingsRevision))
    ? Math.max(0, Math.trunc(Number(S.__cloudSettingsRevision)))
    : 0;
} catch (e) {
  cloudSettingsBaseline = null;
  cloudSettingsRevision = 0;
}

const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { console.error('تعذر حفظ البيانات محلياً:', e); } };
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const f = n => (+n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const pc = n => ((+n || 0) * 100).toFixed(1) + '%';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fee = t => +t.fee || 0;

function rateForDate(cur, date = localISODate()) {
  if (cur === 'EGP') return 1;
  const effectiveDate = isValidISODate(date) ? date : localISODate();
  const baseline = Number((S.baseRates || S.rates || {})[cur]) || Number(S.rates[cur]) || 1;
  const applicable = (S.rateHistory || [])
    .filter(item => item.cur === cur && item.date <= effectiveDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  return applicable.length ? Number(applicable[applicable.length - 1].rate) : baseline;
}

function recordHistoricalRate(cur, rate, effectiveDate) {
  if (!isValidISODate(effectiveDate) || cur === 'EGP' || !Number.isFinite(Number(rate)) || Number(rate) <= 0) {
    throw new Error('تاريخ أو سعر الصرف غير صالح');
  }
  const value = Number(rate);
  const existingIndex = S.rateHistory.findIndex(item => item.cur === cur && item.date === effectiveDate);
  const rateBeforeEdit = rateForDate(cur, effectiveDate);
  if (existingIndex < 0 && Math.abs(rateBeforeEdit - value) < 1e-9) return false;
  if (existingIndex >= 0 && Math.abs(Number(S.rateHistory[existingIndex].rate) - value) < 1e-9) return false;
  if (existingIndex >= 0) S.rateHistory[existingIndex] = { date: effectiveDate, cur, rate: value };
  else S.rateHistory.push({ date: effectiveDate, cur, rate: value });
  S.rateHistory.sort((a, b) => a.date.localeCompare(b.date) || a.cur.localeCompare(b.cur));
  S.rates[cur] = rateForDate(cur, localISODate());
  S.rates.EGP = 1;
  return true;
}

const toEGP = (amt, cur, date = localISODate()) => (+amt || 0) * rateForDate(cur, date);
function status(t, ids) {
  const asset = isAssetTransaction(t.type);
  if (ids[t.id] > 1) return 'رقم مكرر';
  if (!isValidISODate(t.date) || !Number.isFinite(Number(t.amt)) || !(Number(t.amt) > 0) || !t.type || !t.acc) return 'بيانات ناقصة';
  if (!Number.isFinite(Number(t.fee)) || Number(t.fee) < 0) return 'رسوم غير صحيحة';
  if (!S.accounts.some(a => a.code === t.acc)) return 'حساب غير معروف';
  // Asset metadata is optional; holdings are calculated only when code and quantity are usable.
  if (asset && t.qty !== '' && t.qty !== null && t.qty !== undefined && (!(Number(t.qty) > 0) || !Number.isFinite(Number(t.qty))))
    return 'الكمية يجب أن تكون رقمًا أكبر من صفر أو تُترك فارغة';
  if (asset && t.price !== '' && t.price !== null && t.price !== undefined && (!(Number(t.price) >= 0) || !Number.isFinite(Number(t.price))))
    return 'سعر الوحدة يجب أن يكون صفرًا أو أكبر أو يُترك فارغًا';
  const x = t.type;
  if ((x === 'دخل' && t.cat !== 'دخل') || (t.cat === 'دخل' && x !== 'دخل') ||
      ((x === 'تحويل' || x === 'تسوية') && t.cat !== 'تحويل داخلي') ||
      (t.cat === 'تحويل داخلي' && x !== 'تحويل' && x !== 'تسوية') ||
      (asset && t.cat !== 'الاستثمارات') ||
      (t.cat === 'الاستثمارات' && x === 'مصروف'))
    return 'تصنيف لا يطابق النوع';
  return 'سليم';
}

const P = t => {
  const a = toEGP(t.amt, t.cur, t.date), e = toEGP(fee(t), t.cur, t.date);
  if (t.type === 'دخل') return a - e;
  if (t.type === 'مصروف' || isAssetPurchase(t.type) || t.type === 'تحويل') return -(a + e);
  if (isAssetSale(t.type)) return a - e;
  if (t.type === 'تسوية') return a;
  return 0;
};

const Q = t => {
  const a = toEGP(t.amt, t.cur, t.date), e = toEGP(fee(t), t.cur, t.date);
  if (t.type === 'مصروف') return a + e;
  if (t.type === 'دخل' || t.type === 'تحويل') return e;
  return 0;
};

const priceOf = c => +((S.prices.find(p => p.code === c) || {}).price) || 0;

function summarizeAssetRows(rows, code) {
  let bq = 0, sq = 0, cost = 0, proc = 0, sf = 0, untrackedValue = 0;
  rows.forEach(t => {
    const qty = Number(t.qty);
    const hasQty = Number.isFinite(qty) && qty > 0;

    if (hasQty && isAssetPurchase(t.type)) {
      bq += qty;
      cost += toEGP(Number(t.amt) + fee(t), t.cur, t.date);
    } else if (hasQty && isAssetSale(t.type)) {
      sq += qty;
      proc += toEGP(Number(t.amt), t.cur, t.date);
      sf += toEGP(fee(t), t.cur, t.date);
    } else if (isAssetPurchase(t.type)) {
      untrackedValue += toEGP(Number(t.amt) + fee(t), t.cur, t.date);
    } else if (isAssetSale(t.type)) {
      untrackedValue -= toEGP(Math.max(0, Number(t.amt) - fee(t)), t.cur, t.date);
    }
  });

  const avg = bq > 0 ? cost / bq : 0;
  const rem = bq - sq;
  const marketPrice = priceOf(code);
  const trackedValue = rem * (marketPrice > 0 ? marketPrice : avg);
  const value = Math.max(0, trackedValue + untrackedValue);
  return {
    code, bq, sq, rem, cost, avg, pr: marketPrice || avg,
    val: value, rc: rem * avg,
    un: marketPrice > 0 ? rem * marketPrice - rem * avg : 0,
    re: proc - sq * avg - sf,
    usesCostFallback: marketPrice <= 0 || untrackedValue !== 0
  };
}

function hold(v, c) {
  const rows = v.filter(t =>
    t.code === c &&
    !GOLD_TYPES.has(t.type) &&
    isAssetTransaction(t.type)
  );
  return summarizeAssetRows(rows, c);
}

function holdGold(v) {
  const rows = v.filter(t =>
    GOLD_TYPES.has(t.type) ||
    (LEGACY_ASSET_TYPES.includes(t.type) && t.code === GOLD)
  );
  const codes = [...new Set(rows
    .filter(t => String(t.code || '').trim() && Number(t.qty) > 0)
    .map(t => String(t.code).trim()))];

  const grouped = codes.map(code =>
    summarizeAssetRows(rows.filter(t => String(t.code || '').trim() === code), code)
  );

  // Rows with no code or no code/quantity group can't be priced as units; keep their recorded cost.
  const fallbackRows = rows.filter(t => !String(t.code || '').trim() ||
    !codes.includes(String(t.code || '').trim()));
  const fallbackValue = fallbackRows.reduce((total, t) => {
    if (isAssetPurchase(t.type)) return total + toEGP(Number(t.amt) + fee(t), t.cur, t.date);
    if (isAssetSale(t.type)) return total - toEGP(Math.max(0, Number(t.amt) - fee(t)), t.cur, t.date);
    return total;
  }, 0);

  return {
    code: GOLD,
    bq: grouped.reduce((n, item) => n + item.bq, 0),
    sq: grouped.reduce((n, item) => n + item.sq, 0),
    rem: grouped.reduce((n, item) => n + item.rem, 0),
    cost: grouped.reduce((n, item) => n + item.cost, 0) + Math.max(fallbackValue, 0),
    avg: 0, pr: 0,
    val: Math.max(0, grouped.reduce((n, item) => n + item.val, 0) + fallbackValue),
    rc: grouped.reduce((n, item) => n + item.rc, 0),
    un: grouped.reduce((n, item) => n + item.un, 0),
    re: grouped.reduce((n, item) => n + item.re, 0),
    usesCostFallback: grouped.some(item => item.usesCostFallback) || fallbackRows.length > 0
  };
}

function calc() {
  const y = +S.ui.y, m = S.ui.m, all = m === 'all', mm = all ? 0 : +m;
  const from = all ? `${y}-01-01` : `${y}-${m}-01`;
  const to = all ? `${y}-12-31` : `${y}-${m}-${String(new Date(y, mm, 0).getDate()).padStart(2, '0')}`;
  const ids = {};
  S.tx.forEach(t => ids[t.id] = (ids[t.id] || 0) + 1);
  S.tx.forEach(t => t.st = status(t, ids));

  const v = S.tx.filter(t => t.st === 'سليم');
  const inP = t => t.date >= from && t.date <= to;
  const pv = v.filter(inP);

  const sum = (arr, fn) => arr.reduce((s, t) => s + fn(t), 0);

  const inc = sum(pv.filter(t => t.type === 'دخل'), t => toEGP(t.amt, t.cur, t.date));
  const exp = sum(pv, Q);

  let base = inc;
  if (!all && !inc) {
    const pm = mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, '0')}`;
    base = sum(v.filter(t => t.type === 'دخل' && t.date.startsWith(pm)), t => toEGP(t.amt, t.cur, t.date));
  }

  const bal = S.accounts.map(a => ({
    ...a,
    bal: +a.open + sum(v.filter(t => t.acc === a.code && t.date <= to), P)
  }));
  const liq = sum(bal.filter(a => a.liq), a => a.bal);

  const vt = v.filter(t => t.date <= to);
  const codes = [...new Set(vt.filter(t =>
    t.code && t.code !== GOLD && !GOLD_TYPES.has(t.type) && isAssetTransaction(t.type)
  ).map(t => t.code))];
  const inv = codes.map(c => hold(vt, c));

  // Stock purchases/sales without an asset code are still part of wealth at conservative book cost.
  const unclassifiedStockValue = sum(vt.filter(t =>
    (t.type === 'شراء أسهم' || t.type === 'بيع أسهم') && !String(t.code || '').trim()
  ), t => isAssetPurchase(t.type)
    ? toEGP(Number(t.amt) + fee(t), t.cur, t.date)
    : -toEGP(Math.max(0, Number(t.amt) - fee(t)), t.cur, t.date));
  const gold = holdGold(vt);
  const invVal = Math.max(0, sum(inv, h => h.val) + unclassifiedStockValue);
  const sav = sum(v.filter(t => (t.cat === 'الادخار' || t.cat === 'الطوارئ') && t.date <= to), Q);

  const bud = CATS.map(c => {
    let a = sum(pv.filter(t => t.cat === c), Q);
    if (c === 'الاستثمارات')
      a += sum(pv.filter(t => t.cat === c && isAssetPurchase(t.type) && !GOLD_TYPES.has(t.type)), t => toEGP(+t.amt + fee(t), t.cur, t.date));
    const b = base * (S.budget[c] || 0);
    const u = b ? a / b : 0;
    return { c, pct: S.budget[c], b, a, u, s: !b ? '—' : u >= 1 ? 'تجاوز' : u >= S.warn ? 'تحذير' : u >= 0.75 ? 'مراقبة' : 'ضمن الخطة' };
  });

  const months = MON.map((n, i) => {
    const k = `${y}-${String(i + 1).padStart(2, '0')}`;
    const x = v.filter(t => t.date.startsWith(k));
    return {
      n,
      i: sum(x.filter(t => t.type === 'دخل'), t => toEGP(t.amt, t.cur, t.date)),
      e: sum(x, Q)
    };
  });

  const monthlyBal = MON.map((n, i) => {
    const end = `${y}-${String(i + 1).padStart(2, '0')}-${String(new Date(y, i + 1, 0).getDate()).padStart(2, '0')}`;
    const liqM = S.accounts.filter(a => a.liq).reduce((s, a) => {
      return s + +a.open + sum(v.filter(t => t.acc === a.code && t.date <= end), P);
    }, 0);
    return { n, bal: liqM };
  });

  return {
    y, from, to, v, pv, inc, exp, base, bal, liq, inv, gold, invVal, sav, bud, months, monthlyBal,
    wealth: invVal + gold.val + liq + sav,
    char: sum(pv.filter(t => t.cat === 'الصدقات'), Q),
    sr: inc ? sum(pv.filter(t => t.cat === 'الادخار'), Q) / inc : 0
  };
}


const charts = {};
function destroyCharts() {
  Object.keys(charts).forEach(k => { if (charts[k]) { charts[k].destroy(); delete charts[k]; } });
}

function makeChart(id, cfg) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(canvas, cfg);
}

function chartColors() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    text: isDark ? '#94a3b8' : '#64748b',
    grid: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(100,116,139,0.15)',
    bg: isDark ? '#131c2e' : '#fff'
  };
}

function renderBudgetBars(c) {
  const col = chartColors();
  makeChart('chBudget', {
    type: 'bar',
    data: { labels: c.bud.map(b => b.c), datasets: [ { label: 'الميزانية', data: c.bud.map(b => b.b), backgroundColor: COL[0], borderRadius: 4 }, { label: 'الفعلي', data: c.bud.map(b => b.a), backgroundColor: COL[1], borderRadius: 4 } ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { color: col.text, font: { family: 'Cairo' } } } }, scales: { x: { ticks: { color: col.text, font: { family: 'Cairo', size: 11 } }, grid: { color: col.grid } }, y: { ticks: { color: col.text }, grid: { color: col.grid } } } }
  });
}

function renderExpenseDonut(c) {
  const col = chartColors();
  const items = c.bud.filter(b => b.a > 0);
  makeChart('chExp', {
    type: 'doughnut', data: { labels: items.map(b => b.c), datasets: [{ data: items.map(b => b.a), backgroundColor: COL.slice(0, items.length), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { color: col.text, font: { family: 'Cairo', size: 11 }, boxWidth: 12 } } } }
  });
}

function renderAssetDonut(c) {
  const col = chartColors();
  const items = [ { l: 'استثمارات', v: c.invVal, c: COL[2] }, { l: 'ذهب', v: c.gold.val, c: COL[1] }, { l: 'سيولة', v: c.liq, c: COL[0] }, { l: 'ادخار وطوارئ', v: c.sav, c: COL[4] } ].filter(x => x.v > 0);
  makeChart('chAst', {
    type: 'doughnut', data: { labels: items.map(x => x.l), datasets: [{ data: items.map(x => x.v), backgroundColor: items.map(x => x.c), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { color: col.text, font: { family: 'Cairo', size: 11 }, boxWidth: 12 } } } }
  });
}

function renderIncExp(c) {
  const col = chartColors();
  makeChart('chIncExp', {
    type: 'line', data: { labels: MON.map(m => m.slice(0, 3)), datasets: [ { label: 'الدخل', data: c.months.map(m => m.i), borderColor: COL[0], backgroundColor: 'rgba(13, 148, 136, 0.12)', fill: true, tension: 0.4, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: COL[0], borderWidth: 2.5 }, { label: 'المصروفات', data: c.months.map(m => m.e), borderColor: COL[3], backgroundColor: 'rgba(220, 38, 38, 0.10)', fill: true, tension: 0.4, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: COL[3], borderWidth: 2.5 } ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { color: col.text, font: { family: 'Cairo' }, usePointStyle: true, pointStyle: 'circle' } }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${f(ctx.raw)} ج.م` } } }, scales: { x: { ticks: { color: col.text, font: { size: 10 } }, grid: { color: col.grid } }, y: { beginAtZero: true, ticks: { color: col.text }, grid: { color: col.grid } } } }
  });
}

function renderBalanceLine(c) {
  const col = chartColors();
  makeChart('chBal', {
    type: 'line', data: { labels: MON.map(m => m.slice(0, 3)), datasets: [{ label: 'الرصيد المتاح (سيولة)', data: c.monthlyBal.map(m => m.bal), borderColor: COL[0], backgroundColor: 'rgba(13, 148, 136, 0.15)', fill: true, tension: 0.35, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: COL[0], borderWidth: 2.5 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, labels: { color: col.text, font: { family: 'Cairo' } } }, tooltip: { callbacks: { label: ctx => ` الرصيد: ${f(ctx.raw)} ج.م` } } }, scales: { x: { ticks: { color: col.text, font: { size: 10 } }, grid: { color: col.grid } }, y: { ticks: { color: col.text }, grid: { color: col.grid } } } }
  });
}


let appToastTimer = null;
let appToastNode = null;

function dismissAppToast() {
  if (appToastTimer) {
    clearTimeout(appToastTimer);
    appToastTimer = null;
  }
  if (appToastNode) {
    appToastNode.remove();
    appToastNode = null;
  }
}

function showAppToast(message, duration = 15000) {
  if (!document.body) return;
  dismissAppToast();

  const toast = document.createElement('div');
  toast.className = 'app-toast app-toast-warning';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  const icon = document.createElement('i');
  icon.className = 'bi bi-cloud-exclamation-fill app-toast-icon';
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('div');
  text.className = 'app-toast-text';
  text.textContent = message;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'app-toast-close';
  close.setAttribute('aria-label', 'إغلاق التنبيه');
  close.innerHTML = '&times;';
  close.addEventListener('click', dismissAppToast);

  const progress = document.createElement('span');
  progress.className = 'app-toast-progress';
  progress.style.animationDuration = duration + 'ms';

  toast.append(icon, text, close, progress);
  document.body.appendChild(toast);
  appToastNode = toast;
  requestAnimationFrame(() => toast.classList.add('is-visible'));

  appToastTimer = window.setTimeout(() => {
    toast.classList.remove('is-visible');
    toast.classList.add('is-hiding');
    appToastTimer = window.setTimeout(() => {
      if (appToastNode === toast) appToastNode = null;
      toast.remove();
      appToastTimer = null;
    }, 220);
  }, duration);
}

function bd(s) {
  const cls = (s === 'سليم' || s === 'ضمن الخطة') ? 'tag-ok' : (s === 'تجاوز' || s === 'خطأ') ? 'tag-er' : 'tag-wn';
  return `<span class="tag ${cls}">${s}</span>`;
}
function st(s) { return s === 'سليم' ? bd(s) : `<span class="tag tag-er">${s}</span>`; }
function fillSelect(el, arr, val) { el.innerHTML = arr.map(x => `<option value="${esc(x)}" ${x === val ? 'selected' : ''}>${esc(x)}</option>`).join(''); }


function vDash(c) {
  const ys = [];
  for (let y = 2024; y <= 2035; y++) ys.push(y);
  const comp = [
    ['استثمارات', c.invVal, COL[2]],
    ['ذهب', c.gold.val, COL[1]],
    ['سيولة', c.liq, COL[0]],
    ['ادخار وطوارئ', c.sav, COL[4]]
  ];
  const pendingCount = pendingTransactions().length;
  const syncWarnings = [];
  if (!googleTransactionsLoaded) {
    syncWarnings.push('لم تكتمل قراءة المعاملات من Google Sheets؛ قد لا تكون الأرقام محدثة.');
  } else if (pendingCount) {
    syncWarnings.push('يوجد ' + pendingCount + ' معاملة محلية معلقة تحتاج إلى المراجعة والمزامنة.');
  }
  if (!cloudSettingsInitialized) {
    syncWarnings.push('لم يتم تأكيد تحميل الأهداف والالتزامات المشتركة بعد.');
  }
  const cloudBanner = syncWarnings.length
    ? '<div class="dashboard-sync-banner" role="status"><span class="dashboard-sync-icon"><i class="bi bi-cloud-exclamation"></i></span><div><strong>راجع حالة المزامنة</strong><p>' + syncWarnings.map(esc).join(' ') + '</p></div></div>'
    : '';

  const safety = safeToSpendSnapshot(localISODate());
  const safetyUncertain = syncWarnings.length > 0;
  const safetyStatus = safetyUncertain ? 'مزامنة غير مكتملة' : 'حسب فترة التقرير';
  // Use the same calculated liquidity total as the account summary and monthly liquidity chart.
  const safetyAmount = f(c.liq);
  const safetyObligationRows = safety.obligations.slice()
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 4);
  const safetyObligationList = safetyObligationRows.length
    ? '<div class="safe-spend-obligation-list">' + safetyObligationRows.map(item =>
        '<div class="safe-spend-obligation"><div><strong>' + esc(item.name) + '</strong><span>' +
        esc(item.dueDate) + (item.overdue ? ' · متأخر' : ' · خلال 30 يومًا') +
        '</span></div><b>' + f(item.amountEGP) + ' ج.م.</b></div>'
      ).join('') + (safety.obligations.length > safetyObligationRows.length
        ? '<p class="note mb-0 mt-2">و' + (safety.obligations.length - safetyObligationRows.length) + ' استحقاق إضافي ضمن الحساب.</p>' : '') +
      '</div>'
    : '<p class="note mb-0 mt-2">لا توجد التزامات دورية غير مسجلة ضمن الفترة المحسوبة حسب البيانات المتاحة.</p>';

  const safeSpendPanel = `
    <section class="safe-spend-panel dashboard-safe-spend ${safety.available < 0 ? 'is-deficit' : ''}" aria-labelledby="safeSpendTitle">
      <div class="safe-spend-header">
        <div class="safe-spend-title">
          <span class="safe-spend-eyebrow"><i class="bi bi-wallet2"></i> وضعك المالي الحالي</span>
          <h3 id="safeSpendTitle">رصيد السيولة</h3>
          <p>إجمالي أرصدة حسابات السيولة حتى نهاية الفترة المحددة، بنفس طريقة احتساب رصيد السيولة في الرسم البياني.</p>
        </div>
        <span class="safe-spend-status ${safety.safe < 0 ? 'is-deficit' : safetyUncertain ? 'is-uncertain' : ''}">${safetyStatus}</span>
      </div>

      <div class="dashboard-safe-main">
        <div class="safe-spend-result">
          <span>إجمالي السيولة</span>
          <strong>${safetyAmount} <small>ج.م.</small></strong>
          <p>الرصيد الإجمالي في الحسابات المصنفة ضمن السيولة.</p>
        </div>
        <div class="dashboard-safe-metrics" aria-label="مكونات تقدير المتاح للصرف">
          <div class="dashboard-safe-metric"><span>إجمالي السيولة</span><strong>${f(c.liq)}</strong><small>ج.م.</small></div>
          <div class="dashboard-safe-metric is-deduction"><span>الالتزامات</span><strong>− ${f(safety.commitments)}</strong><small>ج.م.</small></div>
          <div class="dashboard-safe-metric is-deduction"><span>الأهداف</span><strong>− ${f(safety.reservedGoals)}</strong><small>ج.م.</small></div>
        </div>
      </div>

      <div class="dashboard-safe-bottom">
        <div class="safe-spend-alert ${safety.safe < 0 ? 'is-deficit' : safety.available < 0 ? 'is-deficit' : ''} dashboard-safe-note">
          <i class="bi ${safety.safe < 0 || safety.available < 0 ? 'bi-exclamation-triangle-fill' : 'bi-info-circle'}"></i>
          <div><strong>${safety.available < 0 ? 'إجمالي رصيد السيولة بالسالب؛ راجع الأرصدة والحركات المسجلة.' : safety.safe < 0 ? 'الالتزامات المحجوزة أكبر من السيولة المتاحة؛ راجع الالتزامات قبل الإنفاق.' : 'رصيد السيولة لا يخصم الالتزامات أو مخصصات الأهداف.'}</strong></div>
        </div>
        <div class="safe-spend-facts dashboard-safe-facts">
          <span><b>${safety.overdueCount}</b> متأخر</span>
          <span><b>${safety.upcomingCount}</b> خلال 30 يومًا</span>
          <span><b>${(S.financialGoals || []).filter(goal => goal && goal.active !== false).length}</b> أهداف نشطة</span>
        </div>
      </div>

      <details class="dashboard-safe-more">
        <summary>
          <span>تفاصيل الالتزامات وطريقة الحساب</span>
          <span class="dashboard-safe-count">${safety.obligations.length}</span>
          <i class="bi bi-chevron-down dashboard-safe-chevron" aria-hidden="true"></i>
        </summary>
        <div class="dashboard-safe-more-content">
          <div class="dashboard-safe-obligations">
            <strong class="dashboard-safe-subheading">الالتزامات المحجوزة</strong>
            ${safetyObligationList}
          </div>
          <details class="safe-spend-assumptions">
            <summary>الافتراضات التي يعتمد عليها التقدير</summary>
            <ul>
              <li>السيولة هي أرصدة الحسابات المعلّمة «ضمن السيولة»، محسوبة من الأرصدة الافتتاحية والمعاملات السليمة حتى اليوم، بغض النظر عن فترة التقرير.</li>
              <li>تُخصم الالتزامات المتكررة غير المسجلة خلال 30 يومًا، وجميع المتأخرات غير المسجلة منذ بداية الجدول. الدخل الدوري لا يُعتبر سيولة مضمونة.</li>
              <li>الاستحقاق المسجل فعلًا لا يُخصم ثانية إذا ارتبط بمرجع الالتزام أو طابق معاملة سليمة في تاريخ الاستحقاق بالحساب والتصنيف والعملة والمبلغ والرسوم نفسها. الدفع المبكر يحتاج ملاحظة تطابق الالتزام.</li>
              <li>مخصصات الأهداف هي الأرصدة الحالية للأهداف النشطة، وتُفترض أنها ما زالت موجودة ضمن السيولة. لا تحتسب مبلغًا صُرف أو استُثمر بالفعل، ولا تخصص نفس المال لأكثر من هدف.</li>
              <li>المبالغ بالجنيه المصري باستخدام أسعار مِعيار المتاحة؛ لا يشمل التقدير فواتير غير مسجلة أو مصروفات غير دورية أو تغيرات مستقبلية في الدخل والأسعار.</li>
            </ul>
          </details>
        </div>
      </details>
    </section>`;

  const net = c.inc - c.exp;
  const kpis = [
    { label: 'الدخل', value: f(c.inc), icon: 'bi-arrow-down-left-circle', tone: 'income' },
    { label: 'المصروفات', value: f(c.exp), icon: 'bi-arrow-up-right-circle', tone: 'expense' },
    { label: 'صافي الفترة', value: f(net), icon: 'bi-wallet2', tone: net < 0 ? 'negative' : 'net' },
    { label: 'معدل الادخار', value: pc(c.sr), icon: 'bi-piggy-bank', tone: 'savings' }
  ];

  return `
  <section class="dashboard-header" aria-labelledby="dashboardTitle">
    <div class="dashboard-intro">
      <span class="dashboard-eyebrow">نظرة مالية عامة</span>
      <h2 id="dashboardTitle">لوحة التحكم</h2>
      <p>ملخص وضعك المالي، وأهم مؤشرات الفترة، من غير تفاصيل تزاحم الصورة الأساسية.</p>
    </div>
    <div class="dashboard-filters" aria-label="فترة التقرير">
      <label><span>السنة</span><select class="form-select form-select-sm" id="fy">${ys.map(y => `<option ${y == S.ui.y ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
      <label><span>الشهر</span><select class="form-select form-select-sm" id="fm"><option value="all">السنة كاملة</option>${MON.map((n, i) => `<option value="${String(i + 1).padStart(2, '0')}" ${S.ui.m === String(i + 1).padStart(2, '0') ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <span class="dashboard-range">${c.from} ← ${c.to}</span>
    </div>
  </section>
  ${cloudBanner}

  <div class="dashboard-primary-grid" aria-label="الملخص المالي الأساسي">
    ${safeSpendPanel}
  <section class="hero-card dashboard-wealth-card" aria-label="ملخص الثروة">
    <div class="dashboard-wealth-main">
      <div class="dashboard-wealth-summary">
        <span class="dashboard-wealth-label"><i class="bi bi-gem"></i> إجمالي الثروة</span>
        <div class="hero-value">${f(c.wealth)} <small>جنيه مصري</small></div>
        <p class="dashboard-wealth-note mb-0">تقدير للأصول والسيولة، وقد يعتمد على التكلفة المسجلة عند غياب سعر السوق.</p>
      </div>
      <div class="dashboard-wealth-allocation">
        <span class="dashboard-allocation-label">توزيع الثروة</span>
        <div class="comp-bar" aria-label="توزيع تقريبي للثروة">${comp.map(x => `<i style="width:${c.wealth > 0 ? Math.max(x[1], 0) / c.wealth * 100 : 0}%;background:${x[2]}"></i>`).join('')}</div>
        <div class="dashboard-wealth-legend">${comp.map(x => `<span class="leg-item"><span class="leg-dot" style="background:${x[2]}"></span><span>${x[0]}</span><b>${f(x[1])}</b></span>`).join('')}</div>
      </div>
    </div>
  </section>
  </div>

  <section class="dashboard-kpis-section mb-4" aria-labelledby="dashboardKpiTitle">
    <div class="dashboard-section-heading">
      <div><h3 id="dashboardKpiTitle">ملخص الفترة</h3><p>أربعة أرقام أساسية تساعدك تقرأ وضعك بسرعة.</p></div>
      <span class="dashboard-section-period">${S.ui.m === 'all' ? 'السنة كاملة' : MON[Number(S.ui.m) - 1] + ' ' + S.ui.y}</span>
    </div>
    <div class="row g-3 dashboard-kpi-grid">
      ${kpis.map(k => `<div class="col-6 col-lg-3"><article class="dashboard-kpi-card ${k.tone}"><div class="dashboard-kpi-top"><span class="dashboard-kpi-icon"><i class="bi ${k.icon}"></i></span><span class="dashboard-kpi-label">${k.label}</span></div><strong class="dashboard-kpi-value">${k.value}</strong></article></div>`).join('')}
    </div>
  </section>

  <section class="dashboard-analytics mt-4" aria-labelledby="dashboardAnalyticsTitle">
    <div class="dashboard-section-heading">
      <div><h3 id="dashboardAnalyticsTitle">متابعة الأداء</h3><p>الرسوم الأهم في الواجهة، والتفاصيل الإضافية عند الحاجة.</p></div>
    </div>
    <div class="row g-3 dashboard-chart-grid">
      <div class="col-lg-7"><article class="box dashboard-chart-card"><h3><i class="bi bi-bar-chart"></i> الميزانية مقابل الفعلي</h3><div class="chart-wrap"><canvas id="chBudget"></canvas></div></article></div>
      <div class="col-lg-5"><article class="box dashboard-chart-card"><h3><i class="bi bi-graph-up"></i> الدخل والمصروفات · ${c.y}</h3><div class="chart-wrap"><canvas id="chIncExp"></canvas></div></article></div>
    </div>
    <details class="dashboard-more" id="dashboardMoreDetails">
      <summary><span class="dashboard-more-icon"><i class="bi bi-sliders"></i></span><span class="dashboard-more-label"><strong>تحليلات إضافية وتفاصيل الميزانية</strong><small>توزيع المصروفات والأصول والسيولة، مع الجدول الكامل</small></span><i class="bi bi-chevron-down dashboard-more-chevron"></i></summary>
      <div class="dashboard-more-content">
        <div class="row g-3">
          <div class="col-lg-6"><article class="box dashboard-chart-card"><h3><i class="bi bi-pie-chart"></i> توزيع المصروفات</h3><div class="chart-wrap sm"><canvas id="chExp"></canvas></div></article></div>
          <div class="col-lg-6"><article class="box dashboard-chart-card"><h3><i class="bi bi-pie-chart-fill"></i> توزيع الأصول</h3><div class="chart-wrap sm"><canvas id="chAst"></canvas></div></article></div>
          <div class="col-12"><article class="box dashboard-chart-card"><h3><i class="bi bi-activity"></i> الرصيد المتاح شهريًا · السيولة</h3><div class="chart-wrap"><canvas id="chBal"></canvas></div></article></div>
          <div class="col-12"><article class="box dashboard-budget-table"><h3><i class="bi bi-table"></i> تفاصيل الميزانية</h3><div class="table-responsive"><table class="table table-hover mb-0"><thead><tr><th>البند</th><th>النسبة</th><th>الميزانية</th><th>الفعلي</th><th>الاستخدام</th><th>الحالة</th></tr></thead><tbody>${c.bud.map(b => `<tr><td>${b.c}</td><td>${pc(b.pct)}</td><td>${f(b.b)}</td><td>${f(b.a)}</td><td><div class="d-flex align-items-center gap-2"><div class="progress-thin flex-grow-1" style="min-width:80px"><div class="bar" style="width:${Math.min(b.u, 1) * 100}%;background:${b.u >= 1 ? 'var(--red)' : 'var(--ac)'}"></div></div><span>${pc(b.u)}</span></div></td><td>${bd(b.s)}</td></tr>`).join('')}</tbody></table></div><p class="note mt-2 mb-0">أساس الميزانية: ${f(c.base)} ج.م. شراء الذهب غير محسوب في بند الاستثمارات.</p></article></div>
        </div>
      </div>
    </details>
  </section>`;
}
function vTx(c) {
  const q = (S.ui.q || '').trim().toLowerCase();
  const rows = [...S.tx].sort((a, b) => b.date.localeCompare(a.date)).filter(t => !q || JSON.stringify(t).toLowerCase().includes(q));
  return `
  <div class="filter-bar">
    <button class="btn btn-primary btn-sm" id="btnAddTx"><i class="bi bi-plus-lg"></i> معاملة جديدة</button>
    <button class="btn btn-outline-primary btn-sm" id="btnAddTransfer" ${S.accounts.length < 2 ? 'disabled title="أضف حسابًا ثانيًا أولًا"' : ''}><i class="bi bi-arrow-left-right"></i> تحويل بين الحسابات</button>
    <input type="search" class="form-control form-control-sm" id="q" placeholder="بحث..." value="${esc(S.ui.q || '')}" style="max-width:220px">
    <span class="note">${rows.length} معاملة — الصفوف غير السليمة مستبعدة من الحسابات</span>
  </div>
  <div class="box"><div class="table-responsive"><table class="table table-hover mb-0 tx-table"><thead><tr><th>#</th><th>التاريخ</th><th>الاسم</th><th>التصنيف</th><th>النوع</th><th>المبلغ</th><th>العملة</th><th>الحساب</th><th>الأصل</th><th>الحالة</th><th></th></tr></thead><tbody>${rows.map(t => `<tr><td>${t.id}</td><td>${t.date}</td><td>${esc(t.name)}</td><td>${esc(t.cat)}</td><td>${t.type}</td><td>${f(t.amt)}</td><td><span class="badge-currency">${t.cur || 'EGP'}</span></td><td>${esc(t.acc)}</td><td>${esc(t.code)}${t.qty ? ' ×' + t.qty : ''}</td><td>${st(t.st)}</td><td class="text-nowrap"><button class="btn btn-sm btn-outline-primary" data-edit="${t.id}"><i class="bi bi-pencil"></i></button><button class="btn btn-sm btn-outline-danger" data-del="${t.id}"><i class="bi bi-trash"></i></button></td></tr>`).join('')}</tbody></table></div></div>`;
}

function vAcc(c) {
  return `
  <div class="filter-bar"><button class="btn btn-primary btn-sm" id="btnAddAcc"><i class="bi bi-plus-lg"></i> حساب جديد</button><span class="note">الأرصدة حتى نهاية الفترة المختارة في لوحة التحكم (${c.to})</span></div>
  <div class="box"><div class="table-responsive"><table class="table table-hover mb-0"><thead><tr><th>الرمز</th><th>الاسم</th><th>النوع</th><th>رصيد افتتاحي</th><th>ضمن السيولة</th><th>الرصيد الحالي</th></tr></thead><tbody>${c.bal.map((a, i) => `<tr><td><code>${esc(a.code)}</code></td><td><input class="form-control form-control-sm" data-s="accounts" data-i="${i}" data-k="name" value="${esc(a.name)}"></td><td><input class="form-control form-control-sm" data-s="accounts" data-i="${i}" data-k="type" value="${esc(a.type)}"></td><td><input type="number" step="any" class="form-control form-control-sm" data-s="accounts" data-i="${i}" data-k="open" value="${a.open}" style="max-width:110px"></td><td><input type="checkbox" class="form-check-input" data-s="accounts" data-i="${i}" data-k="liq" ${a.liq ? 'checked' : ''}></td><td><strong>${f(a.bal)}</strong></td></tr>`).join('')}<tr class="table-light"><th colspan="5">إجمالي السيولة</th><th>${f(c.liq)}</th></tr></tbody></table></div></div>`;
}

function vAst(c) {
  const H = [...c.inv, c.gold].filter(h => h.bq || h.sq);
  return `
  <div class="box mb-3"><h3><i class="bi bi-briefcase"></i> المحفظة</h3><div class="table-responsive"><table class="table table-hover mb-0"><thead><tr><th>الرمز</th><th>الكمية</th><th>متوسط التكلفة</th><th>السعر</th><th>القيمة</th><th>ربح غير محقق</th><th>ربح محقق</th></tr></thead><tbody>${H.map(h => `<tr><td><code>${esc(h.code)}</code></td><td>${f(h.rem)}</td><td>${f(h.avg)}</td><td>${f(h.pr)}</td><td>${f(h.val)}</td><td style="color:var(--${h.un < 0 ? 'red' : 'ok'})">${f(h.un)}</td><td>${f(h.re)}</td></tr>`).join('')}<tr class="table-light"><th colspan="4">الإجمالي</th><th>${f(H.reduce((s, h) => s + h.val, 0))}</th><th>${f(H.reduce((s, h) => s + h.un, 0))}</th><th>${f(H.reduce((s, h) => s + h.re, 0))}</th></tr></tbody></table></div></div>
  <div class="filter-bar"><button class="btn btn-primary btn-sm" id="btnAddPrice"><i class="bi bi-plus-lg"></i> سعر أصل</button></div>
  <div class="box"><h3><i class="bi bi-currency-exchange"></i> أسعار الأصول</h3><div class="table-responsive"><table class="table table-hover mb-0"><thead><tr><th>الرمز</th><th>الفئة</th><th>السعر الحالي (ج.م)</th><th>تاريخ التحديث</th></tr></thead><tbody>${S.prices.map((p, i) => `<tr><td><code>${esc(p.code)}</code></td><td>${esc(p.cat)}</td><td><input type="number" step="any" class="form-control form-control-sm" data-s="prices" data-i="${i}" data-k="price" value="${+(+p.price).toFixed(4)}" style="max-width:120px"></td><td><input type="date" class="form-control form-control-sm" data-s="prices" data-i="${i}" data-k="date" value="${p.date || ''}" style="max-width:150px"></td></tr>`).join('')}</tbody></table></div><p class="note mt-2 mb-0">الأسعار المبدئية للأسهم = سعر الشراء. حدّثها من السوق.</p></div>`;
}


function recurringAmountLabel(schedule) {
  return f(schedule.amount) + ' ' + (CURS[schedule.cur] || schedule.cur || 'ج.م.');
}

function vRecurring() {
  const schedules = [...(S.recurringSchedules || [])].sort((a, b) => Number(b.active) - Number(a.active) || a.dueDay - b.dueDay || a.name.localeCompare(b.name));
  const active = schedules.filter(schedule => schedule.active !== false);
  const inactive = schedules.filter(schedule => schedule.active === false);
  const occurrences = recurringOccurrences({ daysAhead: 90 });
  const today = localISODate();
  const overdueCount = occurrences.filter(item => item.dueDate < today).length;
  const dueTodayCount = occurrences.filter(item => item.dueDate === today).length;
  const nextMonth = occurrences.filter(item => item.dueDate >= today && item.dueDate <= addCalendarDays(today, 30));
  const nextMonthTotal = nextMonth.reduce((sum, item) =>
    sum + toEGP(item.schedule.amount + item.schedule.fee, item.schedule.cur, item.dueDate), 0);
  const reminderInfo = cloudSettingsInitialized
    ? '<span class="rec-sync-pill"><i class="bi bi-cloud-check"></i> الالتزامات مشتركة بين أجهزتك</span>'
    : '<span class="rec-sync-pill is-warning"><i class="bi bi-cloud-exclamation"></i> مزامنة الإعدادات تحتاج تأكيدًا</span>';

  const occurrenceCards = occurrences.length ? occurrences.map(item => {
    const schedule = item.schedule;
    const isOverdue = item.dueDate < today;
    const isToday = item.dueDate === today;
    const statusLabel = isOverdue ? 'متأخر' : isToday ? 'مستحق اليوم' : 'بعد ' + item.daysUntil + ' يوم';
    const statusClass = isOverdue ? 'tag-er' : isToday ? 'tag-wn' : 'tag-ok';
    const action = item.dueDate <= today
      ? '<button class="btn btn-primary btn-sm" data-generate-occurrence="' + esc(schedule.id) + '" data-due-date="' + esc(item.dueDate) + '"><i class="bi bi-check2-circle"></i> مراجعة وتسجيل</button>'
      : '<span class="rec-upcoming-state"><i class="bi bi-calendar-event"></i> لم يحن موعد التسجيل</span>';
    return '<article class="rec-agenda-item ' + (isOverdue ? 'is-overdue' : isToday ? 'is-today' : '') + '">' +
      '<div class="rec-date-tile"><strong>' + esc(item.dueDate.slice(-2)) + '</strong><span>' + esc(MON[Number(item.dueDate.slice(5, 7)) - 1]) + '</span><small>' + esc(item.dueDate.slice(0, 4)) + '</small></div>' +
      '<div class="rec-agenda-content"><div class="rec-agenda-top"><strong>' + esc(schedule.name) + '</strong><span class="tag ' + statusClass + '">' + statusLabel + '</span></div>' +
      '<div class="rec-agenda-meta"><span><i class="bi ' + (schedule.type === 'دخل' ? 'bi-arrow-down-left-circle' : 'bi-arrow-up-right-circle') + '"></i> ' + esc(schedule.type) + ' · ' + esc(schedule.cat) + '</span><span><i class="bi bi-wallet2"></i> ' + esc(accountDisplayName(schedule.acc)) + '</span></div>' +
      '<div class="rec-agenda-bottom"><strong class="rec-amount ' + (schedule.type === 'دخل' ? 'is-income' : 'is-expense') + '">' + esc(recurringAmountLabel(schedule)) + (schedule.fee ? ' <small>+ رسوم ' + f(schedule.fee) + '</small>' : '') + '</strong>' + action + '</div></div></article>';
  }).join('') : '<div class="rec-empty"><span><i class="bi bi-calendar2-check"></i></span><strong>مفيش استحقاقات قادمة مسجلة</strong><p>ابدأ بإضافة الإيجار أو المرتب أو الاشتراكات الشهرية، ومِعيار هيرتب لك مواعيدها هنا.</p><button class="btn btn-primary" id="btnAddRecurringEmpty"><i class="bi bi-plus-lg"></i> إضافة أول التزام</button></div>';

  const scheduleCards = schedules.length ? schedules.map(schedule => {
    const next = occurrences.find(item => item.scheduleId === schedule.id) || null;
    const nextText = next ? next.dueDate + (next.dueDate < today ? ' · متأخر' : '') : 'لا يوجد موعد ظاهر خلال الفترة القادمة';
    const stateClass = schedule.active === false ? 'tag-wn' : 'tag-ok';
    const stateLabel = schedule.active === false ? 'متوقف' : 'نشط';
    return '<article class="rec-schedule-card ' + (schedule.active === false ? 'is-inactive' : '') + '">' +
      '<div class="rec-schedule-head"><div class="rec-schedule-icon"><i class="bi ' + (schedule.type === 'دخل' ? 'bi-cash-coin' : 'bi-receipt') + '"></i></div><div class="rec-schedule-title"><strong>' + esc(schedule.name) + '</strong><span>' + esc(schedule.type) + ' · ' + esc(schedule.cat) + '</span></div><span class="tag ' + stateClass + '">' + stateLabel + '</span></div>' +
      '<div class="rec-schedule-amount">' + esc(recurringAmountLabel(schedule)) + '<small> شهريًا</small></div>' +
      '<div class="rec-schedule-details"><span><i class="bi bi-calendar3"></i> يوم ' + schedule.dueDay + ' من كل شهر</span><span><i class="bi bi-bell"></i> التنبيه قبلها بـ ' + schedule.reminderDays + ' يوم</span><span><i class="bi bi-wallet2"></i> ' + esc(accountDisplayName(schedule.acc)) + '</span><span><i class="bi bi-calendar-check"></i> أقرب استحقاق: ' + esc(nextText) + '</span></div>' +
      '<div class="rec-schedule-actions"><button class="btn btn-sm btn-outline-primary" data-edit-recurring="' + esc(schedule.id) + '"><i class="bi bi-pencil"></i> تعديل</button><button class="btn btn-sm btn-outline-secondary" data-toggle-recurring="' + esc(schedule.id) + '" data-active="' + (schedule.active === false ? '0' : '1') + '"><i class="bi ' + (schedule.active === false ? 'bi-play-circle' : 'bi-pause-circle') + '"></i> ' + (schedule.active === false ? 'تفعيل' : 'إيقاف مؤقت') + '</button></div></article>';
  }).join('') : '<div class="rec-empty rec-empty-compact"><span><i class="bi bi-calendar2-plus"></i></span><strong>لسه مفيش التزامات متكررة</strong><p>سجل الالتزام مرة واحدة بدل ما تعيد إدخاله كل شهر.</p></div>';

  const inactiveNote = inactive.length
    ? '<p class="note mb-0 mt-3">يوجد ' + inactive.length + ' التزام/التزامات متوقفة؛ لن تظهر في التقويم أو ترسل تنبيهات حتى تعيد تفعيلها.</p>'
    : '';

  return '<section class="recurring-page">' +
    '<div class="recurring-hero mb-3"><div class="recurring-hero-copy"><span class="rec-eyebrow"><i class="bi bi-calendar2-week"></i> التنظيم المالي الشهري</span><h2>التزاماتك تحت السيطرة</h2><p>سجل الإيجار والمرتب والفواتير مرة واحدة. هتشوف المواعيد القادمة، وتراجع كل استحقاق قبل إضافته للمعاملات.</p><div class="mt-2">' + reminderInfo + '</div></div><button class="btn btn-light rec-primary-action" id="btnAddRecurring"><i class="bi bi-plus-lg"></i> التزام جديد</button></div>' +
    '<div class="row g-3 mb-3"><div class="col-6 col-lg-4"><div class="rec-kpi"><span>التزامات نشطة</span><strong>' + active.length + '</strong><small>تتكرر كل شهر</small></div></div><div class="col-6 col-lg-4"><div class="rec-kpi ' + (overdueCount ? 'has-warning' : '') + '"><span>استحقاقات متأخرة</span><strong>' + overdueCount + '</strong><small>' + dueTodayCount + ' مستحق اليوم</small></div></div><div class="col-12 col-lg-4"><div class="rec-kpi"><span>قيمة الالتزامات خلال 30 يومًا</span><strong>' + f(nextMonthTotal) + ' ج.م.</strong><small>تحويل تقديري باستخدام أسعار مِعيار الحالية</small></div></div></div>' +
    '<div class="box rec-agenda-box mb-3"><div class="rec-section-heading"><div><h3><i class="bi bi-calendar-week"></i> تقويم الاستحقاقات القادمة</h3><p>مواعيد اليوم والـ 90 يوم الجايين. التسجيل لا يتم تلقائيًا؛ لازم تراجع كل استحقاق وتؤكد بنفسك.</p></div><span class="rec-count">' + occurrences.length + ' استحقاق</span></div><div class="rec-agenda">' + occurrenceCards + '</div></div>' +
    '<div class="rec-section-heading rec-schedules-heading"><div><h3><i class="bi bi-arrow-repeat"></i> الالتزامات المتكررة</h3><p>تقدر تعدّل الموعد أو توقف الالتزام مؤقتًا من غير حذف معاملاته السابقة.</p></div></div>' +
    '<div class="rec-schedule-grid">' + scheduleCards + '</div>' + inactiveNote +
    '<div class="alert alert-info small mt-3 mb-0"><i class="bi bi-info-circle"></i> التنبيهات بتظهر أثناء فتح مِعيار على الجهاز. لو الموقع مقفول تمامًا، مش هيقدر يرسل إشعارًا في الخلفية. المعاملة بتتسجل فقط بعد تأكيدك، ومعرّف الاستحقاق بيتحفظ في ملاحظات صف Google عشان يمنع إعادة تسجيله عند المراجعة لاحقًا.</div>' +
  '</section>';
}


function financialGoalFor(id) {
  return (S.financialGoals || []).find(goal => String(goal.id) === String(id)) || null;
}

function goalDisplayAmount(amount, cur) {
  return f(amount) + ' ' + goalCurrencyLabel(cur);
}

function updateGoalPlanPreview() {
  const box = $('#goalPlanPreview');
  const form = $('#formGoal');
  if (!box || !form) return;
  const target = Number(form.elements.namedItem('target').value);
  const current = Number(form.elements.namedItem('current').value || 0);
  const deadline = form.elements.namedItem('deadline').value;
  const cur = form.elements.namedItem('cur').value || 'EGP';
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(current) || current < 0 || !isValidISODate(deadline)) {
    box.innerHTML = '<strong><i class="bi bi-calculator"></i> خطة الوصول للهدف</strong><p class="note mb-0 mt-1">اكتب المبلغ المستهدف والرصيد الحالي والموعد لعرض خطة ادخار تقريبية.</p>';
    return;
  }
  const goal = { target, current, deadline };
  const remaining = Math.max(0, target - current);
  const months = goalMonthsRemaining(deadline);
  const monthly = goalMonthlyRequired(goal);
  const status = current >= target ? 'وصلت للهدف بالفعل — أحسنت!' :
    deadline < localISODate() ? 'الموعد المحدد فات؛ المبلغ المتبقي مطلوب لتدارك الخطة.' :
    'الخطة لا تحتسب أي عائد استثماري أو أرباح مستقبلية.';
  box.innerHTML = '<strong><i class="bi bi-calculator"></i> خطة الوصول للهدف</strong>' +
    '<div class="goal-preview-metrics"><span>المتبقي <b>' + esc(goalDisplayAmount(remaining, cur)) + '</b></span><span>التوفير المطلوب <b>' + esc(goalDisplayAmount(monthly, cur)) + (deadline < localISODate() && remaining > 0 ? ' فورًا' : ' شهريًا') + '</b></span><span>المدة <b>' + (current >= target ? 'مكتمل' : deadline < localISODate() ? 'موعد متأخر' : months + ' شهر تقريبًا') + '</b></span></div>' +
    '<p class="note mb-0 mt-2">' + esc(status) + '</p>';
}

function openFinancialGoalModal(id = '') {
  if (goalSaveInFlight || goalContributionInFlight) {
    showAppToast('هناك عملية حفظ قيد التنفيذ. انتظر تأكيدها قبل بدء عملية أخرى.', 4000);
    return;
  }
  const goal = id ? financialGoalFor(id) : null;
  if (id && !goal) {
    showAppToast('لم أجد الهدف المطلوب. حدّث الصفحة وحاول مرة أخرى.', 4000);
    return;
  }
  const form = $('#formGoal');
  form.reset();
  form.elements.namedItem('id').value = goal ? goal.id : '';
  form.elements.namedItem('name').value = goal ? goal.name : '';
  form.elements.namedItem('category').value = goal ? goal.category : 'احتياطي الطوارئ';
  form.elements.namedItem('target').value = goal ? goal.target : '';
  form.elements.namedItem('current').value = goal ? goal.current : 0;
  form.elements.namedItem('cur').value = goal ? goal.cur : 'EGP';
  form.elements.namedItem('deadline').value = goal ? goal.deadline : addCalendarDays(localISODate(), 365);
  form.elements.namedItem('note').value = goal ? goal.note : '';
  $('#goalModalTitle').textContent = goal ? 'تعديل الهدف المالي' : 'هدف مالي جديد';
  $('#btnSaveGoal').innerHTML = '<i class="bi bi-check-lg"></i> ' + (goal ? 'حفظ التعديلات' : 'حفظ الهدف');
  updateGoalPlanPreview();
  new bootstrap.Modal($('#modalGoal')).show();
}

function openGoalContributionModal(id) {
  if (goalSaveInFlight || goalContributionInFlight) {
    showAppToast('هناك عملية حفظ قيد التنفيذ. انتظر تأكيدها قبل بدء عملية أخرى.', 4000);
    return;
  }
  const goal = financialGoalFor(id);
  if (!goal) {
    showAppToast('الهدف غير موجود. حدّث الصفحة وحاول مرة أخرى.', 4000);
    return;
  }
  const form = $('#formGoalContribution');
  form.reset();
  form.elements.namedItem('goalId').value = goal.id;
  form.elements.namedItem('date').value = localISODate();
  form.elements.namedItem('amount').value = '';
  $('#goalContributionTitle').textContent = 'تحديث رصيد: ' + goal.name;
  $('#goalContributionBalance').textContent = 'الرصيد الحالي: ' + goalDisplayAmount(goal.current, goal.cur) + ' — المستهدف: ' + goalDisplayAmount(goal.target, goal.cur);
  $('#goalContributionCurrency').textContent = 'جميع مبالغ هذه الحركة بعملة الهدف (' + goal.cur + ').';
  new bootstrap.Modal($('#modalGoalContribution')).show();
}

let goalSaveInFlight = false;
let goalContributionInFlight = false;

function vFinancialGoals() {
  const goals = [...(S.financialGoals || [])].filter(goal => goal.active !== false)
    .sort((a, b) => a.deadline.localeCompare(b.deadline) || a.name.localeCompare(b.name));
  const today = localISODate();
  const complete = goals.filter(goal => goal.current >= goal.target);
  const remainingEGP = goals.reduce((sum, goal) =>
    sum + toEGP(Math.max(0, goal.target - goal.current), goal.cur, today), 0);
  const monthlyEGP = goals.reduce((sum, goal) =>
    sum + toEGP(goalMonthlyRequired(goal, today), goal.cur, today), 0);
  const syncInfo = cloudSettingsInitialized
    ? '<span class="goal-sync-pill"><i class="bi bi-cloud-check"></i> الأهداف مشتركة بين أجهزتك</span>'
    : '<span class="goal-sync-pill is-warning"><i class="bi bi-cloud-exclamation"></i> يلزم تأكيد مزامنة الإعدادات</span>';

  const cards = goals.length ? goals.map(goal => {
    const progress = goalProgress(goal);
    const remaining = Math.max(0, goal.target - goal.current);
    const months = goalMonthsRemaining(goal.deadline, today);
    const done = remaining <= 0;
    const late = !done && goal.deadline < today;
    const deadlineLabel = done ? 'تم تحقيق الهدف' : late ? 'تجاوز الموعد المستهدف' : 'الموعد: ' + goal.deadline;
    const statusClass = done ? 'is-complete' : late ? 'is-late' : 'is-active';
    const monthly = goalMonthlyRequired(goal, today);
    const history = (goal.history || []).slice(0, 2);
    const historyHtml = history.length
      ? '<div class="goal-history">' + history.map(entry =>
          '<div><span>' + (entry.direction === 'withdraw' ? 'سحب من المخصص' : 'مساهمة') + ' · ' + esc(entry.date) + '</span><strong>' +
          (entry.direction === 'withdraw' ? '−' : '+') + esc(goalDisplayAmount(entry.amount, goal.cur)) +
          (entry.note ? '<small>' + esc(entry.note) + '</small>' : '') + '</strong></div>'
        ).join('') + '</div>'
      : '<p class="goal-no-history">لسه مفيش مساهمات مسجلة. تقدر تحدّث الرصيد كل ما تخصص مبلغًا للهدف.</p>';
    const icon = ({ 'احتياطي الطوارئ': 'bi-shield-check', 'شراء ذهب': 'bi-gem', 'شراء عربية': 'bi-car-front', 'استثمار': 'bi-graph-up-arrow', 'ادخار عام': 'bi-piggy-bank', 'سفر': 'bi-airplane', 'تعليم': 'bi-mortarboard', 'منزل': 'bi-house' })[goal.category] || 'bi-bullseye';
    return '<article class="goal-card ' + statusClass + '">' +
      '<div class="goal-card-header"><div class="goal-icon"><i class="bi ' + icon + '"></i></div><div class="goal-title"><strong>' + esc(goal.name) + '</strong><span>' + esc(goal.category) + ' · ' + esc(goal.cur) + '</span></div><span class="goal-deadline ' + (done ? 'is-complete' : late ? 'is-late' : '') + '">' + esc(deadlineLabel) + '</span></div>' +
      '<div class="goal-progress-top"><span>نسبة الإنجاز</span><strong>' + progress.toFixed(1) + '%</strong></div>' +
      '<div class="progress goal-progress" role="progressbar" aria-label="نسبة إنجاز ' + esc(goal.name) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + progress.toFixed(1) + '"><div class="progress-bar" style="width:' + progress.toFixed(2) + '%"></div></div>' +
      '<div class="goal-amount-grid"><div><span>الرصيد الحالي</span><strong>' + esc(goalDisplayAmount(goal.current, goal.cur)) + '</strong></div><div><span>المبلغ المستهدف</span><strong>' + esc(goalDisplayAmount(goal.target, goal.cur)) + '</strong></div><div><span>المتبقي</span><strong>' + esc(goalDisplayAmount(remaining, goal.cur)) + '</strong></div></div>' +
      '<div class="goal-monthly-box"><div><span>' + (done ? 'حالة الخطة' : late ? 'لتدارك الموعد' : 'التوفير المطلوب شهريًا') + '</span><strong>' + (done ? 'اكتمل الهدف 🎉' : esc(goalDisplayAmount(monthly, goal.cur)) + (late ? ' فورًا' : ' شهريًا')) + '</strong></div><small>' + (done ? 'تقدر تحتفظ بالهدف كسجل للإنجاز.' : late ? 'الموعد المحدد فات؛ راجع التاريخ المستهدف أو حدّث خطتك.' : months + ' شهرًا تقريبًا متبقية · بدون احتساب عائد أو أرباح.') + '</small></div>' +
      (goal.note ? '<p class="goal-note">' + esc(goal.note) + '</p>' : '') +
      historyHtml +
      '<div class="goal-card-actions"><button type="button" class="btn btn-primary btn-sm" data-goal-contribute="' + esc(goal.id) + '"><i class="bi bi-plus-circle"></i> تسجيل مساهمة</button><button type="button" class="btn btn-outline-secondary btn-sm" data-edit-goal="' + esc(goal.id) + '"><i class="bi bi-pencil"></i> تعديل الهدف</button></div>' +
      '</article>';
  }).join('') : '<div class="goal-empty"><span><i class="bi bi-bullseye"></i></span><strong>لسه مفيش أهداف مالية</strong><p>ابدأ بهدف واضح زي صندوق الطوارئ أو شراء ذهب أو عربية أو الوصول لمبلغ استثماري محدد.</p><button class="btn btn-primary" id="btnAddGoalEmpty"><i class="bi bi-plus-lg"></i> إنشاء أول هدف</button></div>';

  return '<section class="goal-page">' +
    '<div class="goal-hero mb-3"><div class="goal-hero-copy"><span class="goal-eyebrow"><i class="bi bi-bullseye"></i> من النية إلى خطة قابلة للقياس</span><h2>أهدافك المالية</h2><p>حدد أنت عايز توصل لإيه، ومِعيار يحسب لك المتبقي والتوفير الشهري المطلوب حسب الموعد والرصيد الحالي.</p><div class="mt-2">' + syncInfo + '</div></div><button class="btn btn-light goal-primary-action" id="btnAddGoal"><i class="bi bi-plus-lg"></i> هدف جديد</button></div>' +
    '<div class="row g-3 mb-3"><div class="col-6 col-lg-3"><div class="goal-kpi"><span>أهداف نشطة</span><strong>' + goals.length + '</strong><small>لها مبلغ وموعد محددان</small></div></div><div class="col-6 col-lg-3"><div class="goal-kpi"><span>أهداف مكتملة</span><strong>' + complete.length + '</strong><small>وصلت إلى المبلغ المستهدف</small></div></div><div class="col-6 col-lg-3"><div class="goal-kpi"><span>إجمالي المبالغ المتبقية</span><strong>' + f(remainingEGP) + ' ج.م.</strong><small>تقدير بالجنيه بأسعار مِعيار الحالية</small></div></div><div class="col-6 col-lg-3"><div class="goal-kpi"><span>خطة التوفير الشهرية</span><strong>' + f(monthlyEGP) + ' ج.م.</strong><small>تقدير بالجنيه ومن غير عوائد</small></div></div></div>' +
    '<div class="goal-section-heading"><div><h3><i class="bi bi-flag"></i> خططك الحالية</h3><p>تحديث الرصيد هنا للمتابعة فقط؛ لا ينشئ معاملة أو يغيّر أرصدة الحسابات تلقائيًا.</p></div><span class="goal-count">' + goals.length + ' هدف</span></div>' +
    '<div class="goal-grid">' + cards + '</div>' +
    '<div class="alert alert-info small mt-3 mb-0"><i class="bi bi-info-circle"></i> المساهمة أو السحب يحدّث رصيد الهدف فقط ولا ينشئ قيدًا ماليًا، حتى لا يتكرر احتساب المبلغ. سجّل المعاملة الفعلية في «المعاملات» بشكل منفصل لو كنت محتاجها تظهر في رصيد الحساب والتقارير.</div>' +
    '</section>';
}

function vIncomeSources() {
  const sources = [...(S.incomeSources || [])].sort((a, b) =>
    Number(b.active !== false) - Number(a.active !== false) || a.name.localeCompare(b.name, 'ar')
  );
  const activeCount = sources.filter(source => source.active !== false).length;
  const inactiveCount = sources.length - activeCount;
  const usedKinds = new Set(sources.filter(source => source.active !== false).map(source => source.kind));
  const kindIcons = {
    'وظيفة ومرتب': 'bi-briefcase',
    'عمل حر': 'bi-laptop',
    'مشروع أو تجارة': 'bi-shop',
    'عمولات ومكافآت': 'bi-award',
    'استثمار': 'bi-graph-up-arrow',
    'إيجار': 'bi-house-door',
    'مبيعات': 'bi-bag',
    'أخرى': 'bi-cash-coin'
  };
  const syncMessage = cloudSettingsInitialized
    ? '<span class="income-sync-pill"><i class="bi bi-cloud-check"></i> المصادر مشتركة بين أجهزتك</span>'
    : '<span class="income-sync-pill is-warning"><i class="bi bi-cloud-exclamation"></i> يلزم تأكيد مزامنة الإعدادات</span>';

  const cards = sources.length ? sources.map(source => {
    const isActive = source.active !== false;
    const amount = Number(source.expectedAmount) > 0
      ? '<div class="income-source-expected"><span>المبلغ المتوقع · ' + esc(source.frequency) + '</span><strong>' +
          esc(f(source.expectedAmount)) + ' <small>' + esc(CURS[source.cur] || source.cur) + '</small></strong></div>'
      : '<div class="income-source-expected is-unspecified"><span>المبلغ المتوقع</span><strong>غير محدد</strong></div>';
    return '<article class="income-source-card ' + (isActive ? 'is-active' : 'is-inactive') + '">' +
      '<div class="income-source-card-head">' +
        '<span class="income-source-icon"><i class="bi ' + (kindIcons[source.kind] || kindIcons['أخرى']) + '" aria-hidden="true"></i></span>' +
        '<div class="income-source-title"><strong>' + esc(source.name) + '</strong><span>' + esc(source.kind) + ' · ' + esc(source.cur) + '</span></div>' +
        '<span class="income-source-status ' + (isActive ? 'is-active' : 'is-inactive') + '">' + (isActive ? 'نشط' : 'متوقف') + '</span>' +
      '</div>' +
      amount +
      (source.note ? '<p class="income-source-note">' + esc(source.note) + '</p>' : '') +
      '<div class="income-source-actions">' +
        '<button type="button" class="btn btn-outline-primary btn-sm" data-edit-income-source="' + esc(source.id) + '"><i class="bi bi-pencil"></i> تعديل</button>' +
        '<button type="button" class="btn btn-outline-secondary btn-sm" data-toggle-income-source="' + esc(source.id) + '" data-active="' + (isActive ? '1' : '0') + '"><i class="bi ' + (isActive ? 'bi-pause-circle' : 'bi-play-circle') + '"></i> ' + (isActive ? 'إيقاف' : 'تفعيل') + '</button>' +
        '<button type="button" class="btn btn-outline-danger btn-sm" data-delete-income-source="' + esc(source.id) + '"><i class="bi bi-trash"></i> حذف</button>' +
      '</div>' +
    '</article>';
  }).join('') : '<div class="income-sources-empty"><span><i class="bi bi-cash-stack"></i></span><strong>لسه مفيش مصادر دخل مسجلة</strong><p>ابدأ بالمصادر الموجودة عندك، زي المرتب أو العمل الحر أو مشروع جانبي. تقدر تضيفها وتعدلها وتوقفها في أي وقت.</p><button type="button" class="btn btn-primary" id="btnAddIncomeSourceEmpty"><i class="bi bi-plus-lg"></i> إضافة أول مصدر</button></div>';

  return '<section class="income-sources-page">' +
    '<header class="income-sources-hero"><div class="income-sources-hero-copy">' +
      '<span class="income-sources-eyebrow"><i class="bi bi-cash-stack"></i> تنظيم وتنويع الدخل</span>' +
      '<h2>مصادر الدخل</h2><p>اجمع كل مصادر دخلك في مكان واحد، وحدد نوع كل مصدر ودوريته والمبلغ المتوقع لو متاح.</p>' +
      syncMessage +
    '</div><button type="button" class="btn btn-primary income-source-primary-action" id="btnAddIncomeSource"><i class="bi bi-plus-lg"></i> مصدر دخل جديد</button></header>' +
    (!cloudSettingsInitialized
      ? '<div class="income-sources-sync-warning"><i class="bi bi-info-circle"></i><div><strong>مزامنة الإعدادات غير مؤكدة</strong><p>قبل تعديل المصادر، افتح الإعدادات وتأكد من مزامنة هذا الجهاز حتى لا تضيع تغييراتك عند تحميل البيانات المشتركة.</p><button type="button" class="btn btn-outline-primary btn-sm" data-tab="set">فتح الإعدادات</button></div></div>'
      : '') +
    '<div class="income-source-kpis">' +
      '<article><span>مصادر نشطة</span><strong>' + activeCount + '</strong><small>المصادر المتاحة حاليًا</small></article>' +
      '<article><span>مصادر متوقفة</span><strong>' + inactiveCount + '</strong><small>محفوظة دون حذف بياناتها</small></article>' +
      '<article><span>أنواع دخل مختلفة</span><strong>' + usedKinds.size + '</strong><small>لتقييم تنويع دخلك</small></article>' +
    '</div>' +
    '<div class="income-sources-note"><i class="bi bi-info-circle"></i><p>هذا القسم ينظم <strong>تعريفات مصادر الدخل</strong> فقط. لا ينشئ معاملات ولا يغيّر أرصدة الحسابات أو إجمالي الثروة. تسجيل الدخل الفعلي ما زال من قسم «المعاملات» في هذه المرحلة.</p></div>' +
    '<div class="income-source-list-heading"><div><h3>مصادرك المسجلة</h3><p>تقدر تعدّل بيانات أي مصدر أو توقفه مؤقتًا بدل حذفه.</p></div><span>' + sources.length + ' مصدر</span></div>' +
    '<div class="income-source-grid">' + cards + '</div>' +
    '</section>';
}

function openIncomeSourceModal(id = '') {
  if (incomeSourceSaveInFlight || cloudSettingsSyncInFlight) {
    showAppToast('هناك عملية مزامنة جارية. جرّب مرة أخرى بعد انتهائها.', 4000);
    return;
  }
  const source = id ? (S.incomeSources || []).find(item => String(item.id) === String(id)) : null;
  if (id && !source) {
    showAppToast('لم أجد مصدر الدخل المطلوب. حدّث الصفحة وحاول مرة أخرى.', 4500);
    return;
  }
  const form = $('#formIncomeSource');
  form.reset();
  form.elements.namedItem('id').value = source ? source.id : '';
  form.elements.namedItem('name').value = source ? source.name : '';
  form.elements.namedItem('kind').value = source ? source.kind : 'وظيفة ومرتب';
  form.elements.namedItem('frequency').value = source ? source.frequency : 'شهري';
  form.elements.namedItem('cur').value = source ? source.cur : 'EGP';
  form.elements.namedItem('expectedAmount').value = source && source.expectedAmount > 0 ? source.expectedAmount : '';
  form.elements.namedItem('note').value = source ? source.note : '';
  $('#incomeSourceModalTitle').textContent = source ? 'تعديل مصدر الدخل' : 'مصدر دخل جديد';
  $('#btnSaveIncomeSource').innerHTML = source
    ? '<i class="bi bi-check-lg"></i> حفظ التعديلات'
    : '<i class="bi bi-check-lg"></i> حفظ المصدر';
  new bootstrap.Modal($('#modalIncomeSource')).show();
}

async function persistIncomeSources(nextSources, successMessage) {
  if (!cloudSettingsInitialized) {
    alert('قبل إدارة مصادر الدخل، افتح الإعدادات واضغط «مزامنة إعدادات هذا الجهاز» وتأكد من نجاح المزامنة.');
    return false;
  }
  if (incomeSourceSaveInFlight || cloudSettingsSyncInFlight) {
    showAppToast('هناك عملية حفظ أو مزامنة قيد التنفيذ. انتظر تأكيدها أولًا.', 4000);
    return false;
  }
  const previousSources = S.incomeSources;
  incomeSourceSaveInFlight = true;
  S.incomeSources = nextSources;
  save();
  render();
  try {
    const synced = await saveSharedSettingsToGoogle();
    if (!synced) {
      S.incomeSources = previousSources;
      save();
      render();
      showAppToast('لم يتم تأكيد حفظ مصدر الدخل في Google Sheets؛ لذلك رجّعت القائمة لحالتها السابقة لحماية بياناتك.', 6500);
      return false;
    }
    render();
    showAppToast(successMessage, 4500);
    return true;
  } finally {
    incomeSourceSaveInFlight = false;
  }
}

function vSet() {
  const t = CATS.reduce((s, c) => s + (+S.budget[c] || 0), 0);
  const rateHistory = [...(S.rateHistory || [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  return `
  <div class="row g-3"><div class="col-lg-6"><div class="box"><h3><i class="bi bi-sliders"></i> نسب الميزانية</h3><table class="table mb-0">${CATS.map(c => `<tr><td>${c}</td><td style="width:120px"><div class="input-group input-group-sm"><input type="number" class="form-control" data-b="${c}" min="0" max="100" step="1" value="${Math.round(S.budget[c] * 100)}"><span class="input-group-text">%</span></div></td></tr>`).join('')}<tr><th>المجموع</th><th style="color:var(--${Math.abs(t - 1) < 0.001 ? 'ok' : 'red'})">${pc(t)}</th></tr><tr><td>حد التحذير</td><td><div class="input-group input-group-sm"><input type="number" class="form-control" data-w="1" min="1" max="100" value="${Math.round(S.warn * 100)}"><span class="input-group-text">%</span></div></td></tr></table></div></div>
  <div class="col-lg-6"><div class="box"><h3><i class="bi bi-currency-exchange"></i> أسعار الصرف التاريخية</h3><div class="mb-3"><label class="form-label" for="fxEffectiveDate">تاريخ سريان الأسعار</label><input type="date" class="form-control" id="fxEffectiveDate" value="${S.ui.fxDate}"><p class="note mt-2 mb-0">اختار تاريخ تطبيق السعر، وبعدها عدّل الريال أو الدولار. التقارير ستستخدم السعر الساري في تاريخ كل معاملة.</p></div>
    <table class="table mb-0"><tr><td>ريال سعودي (SAR)</td><td style="width:140px"><input aria-label="سعر الريال مقابل الجنيه" type="number" min="0.000001" step="any" class="form-control form-control-sm" data-r="SAR" value="${rateForDate('SAR', S.ui.fxDate)}"></td></tr><tr><td>دولار أمريكي (USD)</td><td><input aria-label="سعر الدولار مقابل الجنيه" type="number" min="0.000001" step="any" class="form-control form-control-sm" data-r="USD" value="${rateForDate('USD', S.ui.fxDate)}"></td></tr><tr><td>جنيه مصري (EGP)</td><td><input type="number" class="form-control form-control-sm" value="1" disabled aria-label="الجنيه المصري يساوي جنيهًا واحدًا"></td></tr></table>
    <p class="note mt-2 mb-0">تعديل تاريخ سابق يعيد حساب المعاملات في ذلك التاريخ وما بعده حتى سجل السعر التالي. المعاملات التي تسبق أول سجل تاريخي ستستخدم سعر الأساس القديم المحفوظ؛ النسخة السابقة لم تكن تحتفظ بأسعار الصرف التاريخية.</p>
  </div></div>
  <div class="col-12"><div class="box"><h3><i class="bi bi-clock-history"></i> سجل تغييرات أسعار الصرف</h3><p class="note">آخر 8 تغييرات محفوظة ومشتركة بين أجهزتك.</p><div class="table-responsive"><table class="table table-hover mb-0"><thead><tr><th>تاريخ السريان</th><th>العملة</th><th>السعر مقابل الجنيه</th></tr></thead><tbody>${rateHistory.length ? rateHistory.map(item => '<tr><td>' + esc(item.date) + '</td><td>' + (item.cur === 'SAR' ? 'ريال سعودي (SAR)' : item.cur === 'USD' ? 'دولار أمريكي (USD)' : esc(item.cur)) + '</td><td>' + f(item.rate) + '</td></tr>').join('') : '<tr><td colspan="3" class="text-center note py-3">لا توجد تغييرات تاريخية مسجلة بعد.</td></tr>'}</tbody></table></div></div></div>
  <div class="col-12"><div class="box"><h3><i class="bi bi-cloud-arrow-up"></i> مزامنة الأجهزة</h3><p class="note">بيانات المعاملات في Google Sheets هي المصدر المشترك للأرقام. أي معاملات قديمة لا تطابق صفًا سحابيًا تُحفظ كمعاملات معلقة على هذا الجهاز ولا تدخل في الإجماليات المشتركة إلى أن ترفعها بعد مراجعتها.</p><p class="small mb-2" id="cloudSyncStatus">${esc(cloudSettingsStatus)}</p><p class="small mb-2">عدد المعاملات المحلية المعلقة: <strong>${pendingTransactions().length}</strong></p><div class="d-flex flex-wrap gap-2"><button class="btn btn-primary btn-sm" id="btnSyncSettings"><i class="bi bi-cloud-check"></i> مزامنة إعدادات هذا الجهاز</button><button class="btn btn-outline-secondary btn-sm" id="btnReloadCloud"><i class="bi bi-arrow-repeat"></i> تحميل الإعدادات من السحابة</button><button class="btn btn-outline-primary btn-sm" id="btnSyncTxDetails"><i class="bi bi-arrow-left-right"></i> ترحيل تفاصيل المعاملات القديمة</button><button class="btn btn-success btn-sm" id="btnSyncPendingTx"><i class="bi bi-cloud-upload"></i> مراجعة ورفع المعاملات المحلية</button></div><p class="note mt-2 mb-0">رفع المعاملات المعلقة يضيف فقط السجلات التي لا يوجد لها تطابق أساسي في Google. أي سجل متشابه يتم تخطيه لتجنب تكرار محتمل. نفّذ العملية من الجهاز الأساسي وبعد أخذ نسخة احتياطية.</p></div></div>
  <div class="col-12"><div class="box"><h3><i class="bi bi-database"></i> النسخ الاحتياطي</h3><p class="note">تقدر تصدّر نسخة JSON أو CSV، وتستخدمها لاسترجاع البيانات عند الحاجة.</p><div class="d-flex flex-wrap gap-2"><button class="btn btn-primary btn-sm" id="btnExp"><i class="bi bi-download"></i> تصدير JSON</button><button class="btn btn-outline-primary btn-sm" id="btnCsv"><i class="bi bi-filetype-csv"></i> تصدير CSV</button><button class="btn btn-outline-secondary btn-sm" id="btnImp"><i class="bi bi-upload"></i> استيراد</button><button class="btn btn-outline-danger btn-sm" id="btnReset"><i class="bi bi-arrow-counterclockwise"></i> استرجاع التجريبي</button></div></div></div>`;
}

function vAud(c) {
  const v = c.v;
  const n = fn => S.tx.filter(fn).length;
  const today = localISODate();
  const tr = v.filter(t => t.type === 'تحويل').reduce((s, t) => s + toEGP(t.amt, t.cur, t.date), 0) - v.filter(t => t.type === 'تسوية').reduce((s, t) => s + toEGP(t.amt, t.cur, t.date), 0);
  const brokenTransferPairs = transferPairIssues(S.tx);
  const codes = [...new Set(S.tx.filter(t => t.code && t.code !== GOLD).map(t => t.code))];
  const old = S.prices.filter(p => p.price > 0 && (!p.date || (Date.now() - new Date(p.date)) / 864e5 > 30)).length;
  const L = [
    ['صفوف غير سليمة (مستبعدة من الحسابات)', n(t => t.st !== 'سليم'), 'خطأ', 'افتح المعاملات وصلّح الصف'],
    ['الفرق بين التحويلات والتسويات', Math.round(tr * 100) / 100, 'خطأ', 'كل تحويل يحتاج تسوية بنفس المبلغ'],
    ['تحويلات مِعيار غير مكتملة', brokenTransferPairs, 'خطأ', 'راجع الطرفين أو احذف التحويل الناقص وأعد تسجيله'],
    ['مجموع نسب الميزانية − 100%', Math.round((CATS.reduce((s, k) => s + S.budget[k], 0) - 1) * 1e4) / 1e4, 'خطأ', 'عدّل النسب في الإعدادات'],
    ['أصول بدون سعر', codes.filter(k => !priceOf(k)).length + (c.gold.rem && !priceOf(GOLD) ? 1 : 0), 'خطأ', 'أضف السعر في الأصول'],
    ['أسعار قديمة (>30 يوم أو بلا تاريخ)', old, 'تنبيه', 'حدّث الأسعار'],
    ['كميات أصول سالبة', [...c.inv, c.gold].filter(h => h.rem < -1e-9).length, 'خطأ', 'راجع كميات البيع'],
    ['مبلغ ≠ الكمية × السعر (>3%)', n(t => t.code && Math.abs(t.amt - t.qty * t.price) > 0.03 * t.amt), 'تنبيه', 'راجع المبلغ أو الكمية أو السعر'],
    ['معاملات بتاريخ مستقبلي', n(t => t.date > today), 'تنبيه', 'تأكد من التاريخ'],
    ['حسابات رصيدها سالب', c.bal.filter(a => a.bal < 0).length, 'تنبيه', 'دخل ناقص أو رصيد افتتاحي غلط']
  ];
  const bad = L.filter(l => l[1] !== 0);
  const statusText = bad.some(l => l[2] === 'خطأ') ? 'يوجد أخطاء' : bad.length ? 'يوجد تنبيهات' : 'كل الفحوص سليمة';
  const statusCls = bad.some(l => l[2] === 'خطأ') ? 'tag-er' : bad.length ? 'tag-wn' : 'tag-ok';
  return `
  <div class="hero-card mb-3"><small class="opacity-75">الحالة العامة</small><div class="hero-value" style="font-size:1.8rem"><span class="tag ${statusCls}" style="font-size:1rem;padding:0.4rem 1rem">${statusText}</span></div></div>
  <div class="box"><div class="table-responsive"><table class="table table-hover mb-0"><thead><tr><th>الفحص</th><th>القيمة</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>${L.map(l => `<tr><td>${l[0]}</td><td>${l[1]}</td><td>${l[1] === 0 ? bd('سليم') : bd(l[2])}</td><td class="note">${l[1] === 0 ? '—' : l[3]}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function render() {
  destroyCharts();
  $$('#navTabs .nav-link').forEach(b => b.classList.toggle('active', b.dataset.tab === S.ui.tab));
  const c = calc();
  const views = { dash: vDash, tx: vTx, income: vIncomeSources, plan: vPlanner, acc: vAcc, ast: vAst, set: vSet, aud: vAud, rec: vRecurring, goal: vFinancialGoals };
  const appRoot = $('#app');
  const previousRenderedTab = appRoot.dataset.renderedTab || '';
  const shouldAnimateView = Boolean(previousRenderedTab && previousRenderedTab !== S.ui.tab);
  appRoot.dataset.renderedTab = S.ui.tab;
  appRoot.innerHTML = views[S.ui.tab](c);
  const dashboardMoreDetails = $('#dashboardMoreDetails');
  if (dashboardMoreDetails) {
    dashboardMoreDetails.addEventListener('toggle', () => {
      if (!dashboardMoreDetails.open) return;
      requestAnimationFrame(() => {
        Object.values(charts).forEach(chart => {
          if (chart && typeof chart.resize === 'function') chart.resize();
        });
      });
    });
  }
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (shouldAnimateView && !reducedMotion) {
    appRoot.classList.remove('view-transition');
    void appRoot.offsetWidth;
    appRoot.classList.add('view-transition');
    const finishViewTransition = event => {
      if (event.target !== appRoot) return;
      appRoot.classList.remove('view-transition');
      appRoot.removeEventListener('animationend', finishViewTransition);
    };
    appRoot.addEventListener('animationend', finishViewTransition);
  }
  if (S.ui.tab === 'dash') { requestAnimationFrame(() => { renderBudgetBars(c); renderExpenseDonut(c); renderAssetDonut(c); renderIncExp(c); renderBalanceLine(c); }); }
  const icon = $('#btnTheme i');
  if (icon) icon.className = document.documentElement.getAttribute('data-theme') === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars';
}

let editingTx = null;
let txSaveInFlight = false;
let incomeSourceSaveInFlight = false;

let recurringSaveInFlight = false;
const recurringGenerationInFlight = new Set();

function recurringCategoryList(type) {
  return type === 'دخل' ? ['دخل'] : [...CATS.filter(cat => cat !== 'الاستثمارات'), 'رسوم وضرائب', 'أخرى'];
}

function populateRecurringCategories(type, selected) {
  fillSelect($('#recCategory'), recurringCategoryList(type), selected || (type === 'دخل' ? 'دخل' : 'الأساسيات'));
}

function openRecurringModal(id = '') {
  if (txSaveInFlight || transferInFlight || recurringSaveInFlight || recurringGenerationInFlight.size) {
    showAppToast('هناك عملية حفظ قيد التنفيذ. انتظر تأكيدها قبل بدء عملية أخرى.', 4000);
    return;
  }
  const schedule = id ? recurringScheduleFor(id) : null;
  if (id && !schedule) {
    showAppToast('لم أجد الالتزام المطلوب. حدّث الصفحة وحاول مرة أخرى.', 4500);
    return;
  }

  const form = $('#formRecurring');
  form.reset();
  form.elements.namedItem('id').value = schedule ? schedule.id : '';
  form.elements.namedItem('name').value = schedule ? schedule.name : '';
  form.elements.namedItem('type').value = schedule ? schedule.type : 'مصروف';
  populateRecurringCategories(schedule ? schedule.type : 'مصروف', schedule ? schedule.cat : 'الأساسيات');
  const accountOptions = S.accounts.map(account =>
    '<option value="' + esc(account.code) + '">' + esc(account.name) + ' (' + esc(account.code) + ')</option>'
  ).join('');
  form.elements.namedItem('acc').innerHTML = accountOptions;
  form.elements.namedItem('acc').value = schedule ? schedule.acc : (S.accounts[0] ? S.accounts[0].code : '');
  fillSelect(form.elements.namedItem('pay'), PAY, schedule ? schedule.pay : 'نقدي');
  form.elements.namedItem('amount').value = schedule ? schedule.amount : '';
  form.elements.namedItem('fee').value = schedule ? schedule.fee : 0;
  form.elements.namedItem('cur').value = schedule ? schedule.cur : 'EGP';
  form.elements.namedItem('startDate').value = schedule ? schedule.startDate : localISODate();
  form.elements.namedItem('dueDay').value = schedule ? schedule.dueDay : Number(localISODate().slice(-2));
  form.elements.namedItem('reminderDays').value = schedule ? schedule.reminderDays : 3;
  form.elements.namedItem('note').value = schedule ? schedule.note : '';
  $('#modalRecurringTitle').textContent = schedule ? 'تعديل الالتزام المتكرر' : 'التزام متكرر جديد';
  $('#btnSaveRecurring').innerHTML = schedule
    ? '<i class="bi bi-check-lg"></i> حفظ التعديلات'
    : '<i class="bi bi-check-lg"></i> حفظ الالتزام';
  new bootstrap.Modal($('#modalRecurring')).show();
}

function sameRecurringDefinition(a, b) {
  return String(a.name || '').trim().toLocaleLowerCase() === String(b.name || '').trim().toLocaleLowerCase() &&
    a.type === b.type && a.cat === b.cat && a.acc === b.acc && a.cur === b.cur &&
    Math.abs(Number(a.amount) - Number(b.amount)) < 0.005 &&
    Math.abs(Number(a.fee || 0) - Number(b.fee || 0)) < 0.005 &&
    Number(a.dueDay) === Number(b.dueDay);
}


$('#formGoal').addEventListener('submit', async e => {
  e.preventDefault();
  if (goalSaveInFlight || goalContributionInFlight) return;
  if (!cloudSettingsInitialized) {
    alert('لا يمكن تأكيد مزامنة الأهداف بين الأجهزة بعد. افتح الإعدادات على الجهاز الأساسي واضغط «مزامنة إعدادات هذا الجهاز» أولًا.');
    return;
  }
  const d = Object.fromEntries(new FormData(e.target));
  const id = String(d.id || '');
  const name = String(d.name || '').trim();
  const target = Number(d.target);
  const current = Number(d.current || 0);
  const deadline = String(d.deadline || '');
  const cur = String(d.cur || 'EGP');
  if (!name) { alert('اكتب اسمًا واضحًا للهدف.'); return; }
  if (!Number.isFinite(target) || target <= 0) { alert('المبلغ المستهدف يجب أن يكون أكبر من صفر.'); return; }
  if (!Number.isFinite(current) || current < 0) { alert('الرصيد الحالي يجب أن يكون صفرًا أو أكبر.'); return; }
  if (!isValidISODate(deadline)) { alert('اختار موعدًا مستهدفًا صحيحًا.'); return; }
  if (!['EGP', 'SAR', 'USD'].includes(cur)) { alert('العملة المحددة غير مدعومة.'); return; }
  if (!GOAL_CATEGORIES.includes(d.category)) { alert('اختار تصنيفًا صحيحًا للهدف.'); return; }

  const previous = id ? financialGoalFor(id) : null;
  if (id && !previous) { alert('لم أجد الهدف المطلوب؛ حدّث الصفحة وحاول مرة أخرى.'); return; }
  const goal = {
    id: id || financialGoalId(), name: name.slice(0, 100), category: d.category,
    target, current, cur, deadline, note: String(d.note || '').trim().slice(0, 300),
    active: previous ? previous.active !== false : true,
    createdAt: previous ? (previous.createdAt || new Date().toISOString()) : new Date().toISOString(),
    history: previous ? (previous.history || []) : []
  };
  goalSaveInFlight = true;
  try {
    if (previous) S.financialGoals = S.financialGoals.map(item => item.id === previous.id ? goal : item);
    else S.financialGoals = [...(S.financialGoals || []), goal];
    S.pendingFinancialGoalIds = [...new Set([...(S.pendingFinancialGoalIds || []).map(String), goal.id])];
    save();
    bootstrap.Modal.getInstance($('#modalGoal')).hide();
    render();
    const synced = await saveSharedSettingsToGoogle();
    showAppToast(synced
      ? 'تم حفظ الهدف ومزامنته بين أجهزتك.'
      : 'تم حفظ الهدف على هذا الجهاز مؤقتًا؛ راجع الإعدادات لمزامنته مع Google Sheets.', 5500);
  } finally {
    goalSaveInFlight = false;
  }
});

$('#formGoalContribution').addEventListener('submit', async e => {
  e.preventDefault();
  if (goalSaveInFlight || goalContributionInFlight) return;
  if (!cloudSettingsInitialized) {
    alert('لا يمكن تأكيد مزامنة الأهداف بين الأجهزة بعد. افتح الإعدادات على الجهاز الأساسي واضغط «مزامنة إعدادات هذا الجهاز» أولًا.');
    return;
  }
  const d = Object.fromEntries(new FormData(e.target));
  const goal = financialGoalFor(String(d.goalId || ''));
  const amount = Number(d.amount);
  const date = String(d.date || '');
  const direction = d.direction === 'withdraw' ? 'withdraw' : 'add';
  if (!goal) { alert('الهدف غير موجود. حدّث الصفحة وحاول مرة أخرى.'); return; }
  if (!Number.isFinite(amount) || amount <= 0) { alert('المبلغ يجب أن يكون أكبر من صفر.'); return; }
  if (!isValidISODate(date)) { alert('اختار تاريخًا صحيحًا للمساهمة.'); return; }
  if (direction === 'withdraw' && amount > goal.current) { alert('المبلغ المسحوب أكبر من الرصيد الحالي المخصص لهذا الهدف.'); return; }
  goalContributionInFlight = true;
  try {
    const delta = direction === 'withdraw' ? -amount : amount;
    const updated = {
      ...goal,
      current: Math.max(0, Math.round((goal.current + delta) * 100) / 100),
      history: [{
        id: financialGoalId(), date, amount, direction,
        note: String(d.note || '').trim().slice(0, 200)
      }, ...(goal.history || [])].slice(0, 200)
    };
    S.financialGoals = S.financialGoals.map(item => item.id === goal.id ? updated : item);
    S.pendingFinancialGoalIds = [...new Set([...(S.pendingFinancialGoalIds || []).map(String), goal.id])];
    save();
    bootstrap.Modal.getInstance($('#modalGoalContribution')).hide();
    render();
    const synced = await saveSharedSettingsToGoogle();
    showAppToast(synced
      ? (direction === 'withdraw' ? 'تم تحديث رصيد الهدف بعد السحب.' : 'تم تسجيل المساهمة وتحديث تقدم الهدف.') + ' تمت المزامنة.'
      : 'تم تحديث الهدف محليًا؛ المزامنة مع Google Sheets لم تتأكد بعد.', 5500);
  } finally {
    goalContributionInFlight = false;
  }
});

$('#formRecurring').addEventListener('submit', async e => {
  e.preventDefault();
  if (recurringSaveInFlight) return;
  if (!cloudSettingsInitialized) {
    alert('لا يمكن تأكيد مزامنة الالتزامات بين الأجهزة بعد. افتح الإعدادات على الجهاز الأساسي واضغط «مزامنة إعدادات هذا الجهاز» أولًا.');
    return;
  }

  const d = Object.fromEntries(new FormData(e.target));
  const id = String(d.id || '');
  const type = d.type === 'دخل' ? 'دخل' : 'مصروف';
  const amount = Number(d.amount);
  const feeAmount = Number(d.fee || 0);
  const dueDay = Number(d.dueDay);
  const reminderDays = Number(d.reminderDays);
  const startDate = String(d.startDate || '');
  if (!String(d.name || '').trim()) { alert('اكتب اسمًا واضحًا للالتزام.'); return; }
  if (!Number.isFinite(amount) || amount <= 0) { alert('المبلغ يجب أن يكون أكبر من صفر.'); return; }
  if (!Number.isFinite(feeAmount) || feeAmount < 0) { alert('الرسوم يجب أن تكون صفرًا أو أكبر.'); return; }
  if (!isValidISODate(startDate)) { alert('اختار تاريخ بداية صحيحًا.'); return; }
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) { alert('يوم الاستحقاق لازم يكون من 1 إلى 31.'); return; }
  if (!Number.isInteger(reminderDays) || reminderDays < 0 || reminderDays > 30) { alert('اختار فترة تنبيه من 0 إلى 30 يومًا.'); return; }
  if (!S.accounts.some(account => account.code === d.acc)) { alert('اختار حسابًا موجودًا في النظام.'); return; }
  if (!['EGP', 'SAR', 'USD'].includes(d.cur)) { alert('العملة المحددة غير مدعومة.'); return; }

  const previousSchedule = id ? recurringScheduleFor(id) : null;
  const schedule = {
    id: id || recurringId(),
    name: String(d.name).trim().slice(0, 100),
    type,
    cat: type === 'دخل' ? 'دخل' : String(d.cat || 'الأساسيات'),
    amount,
    fee: feeAmount,
    cur: d.cur,
    acc: String(d.acc),
    pay: PAY.includes(d.pay) ? d.pay : 'نقدي',
    startDate,
    dueDay,
    reminderDays,
    note: String(d.note || '').trim().slice(0, 300),
    active: previousSchedule ? previousSchedule.active !== false : true,
    createdAt: previousSchedule ? (previousSchedule.createdAt || new Date().toISOString()) : new Date().toISOString()
  };

  if (!recurringCategoryList(type).includes(schedule.cat)) {
    alert('اختار تصنيفًا مناسبًا لنوع الحركة.');
    return;
  }
  const duplicate = (S.recurringSchedules || []).find(item =>
    String(item.id) !== String(schedule.id) && sameRecurringDefinition(item, schedule)
  );
  if (duplicate) {
    alert('يوجد التزام مسجل بنفس الاسم والحساب والمبلغ ويوم الاستحقاق (' + duplicate.name + '). افتح الالتزام الموجود وعدّله بدل إنشاء نسخة قد تسبب تكرارًا.');
    return;
  }

  S.recurringSchedules = id
    ? (S.recurringSchedules || []).map(item => String(item.id) === id ? schedule : item)
    : [...(S.recurringSchedules || []), schedule];
  S.pendingRecurringScheduleIds = [...new Set([...(S.pendingRecurringScheduleIds || []), String(schedule.id)])];
  save();

  recurringSaveInFlight = true;
  const button = $('#btnSaveRecurring'), oldHtml = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> جارٍ حفظ الالتزام…';
  try {
    if (cloudSettingsSyncTimer) {
      clearTimeout(cloudSettingsSyncTimer);
      cloudSettingsSyncTimer = null;
    }
    const synced = await saveSharedSettingsToGoogle();
    bootstrap.Modal.getInstance($('#modalRecurring')).hide();
    render();
    checkRecurringReminders();
    showAppToast(
      synced
        ? 'تم حفظ الالتزام ومزامنة مواعيده بين أجهزتك.'
        : 'تم حفظ الالتزام على هذا الجهاز، لكن لم يتم تأكيد رفعه للسحابة. افتح الإعدادات وراجع حالة المزامنة.',
      7000
    );
  } finally {
    recurringSaveInFlight = false;
    button.disabled = false;
    button.innerHTML = oldHtml;
  }
});

async function toggleRecurringSchedule(id, currentlyActive) {
  if (recurringSaveInFlight || recurringGenerationInFlight.size) {
    showAppToast('هناك عملية التزام قيد التنفيذ. انتظر اكتمالها.', 4000);
    return;
  }
  if (!cloudSettingsInitialized) {
    alert('افتح الإعدادات على الجهاز الأساسي وأكّد مزامنة الإعدادات قبل تعديل الالتزامات المشتركة.');
    return;
  }
  const schedule = recurringScheduleFor(id);
  if (!schedule) return;
  recurringSaveInFlight = true;
  try {
    schedule.active = !currentlyActive;
    S.pendingRecurringScheduleIds = [...new Set([...(S.pendingRecurringScheduleIds || []), String(schedule.id)])];
    save();
    render();
    const synced = await saveSharedSettingsToGoogle();
    showAppToast(synced
      ? (schedule.active ? 'تم تفعيل الالتزام من جديد.' : 'تم إيقاف الالتزام مؤقتًا.')
      : 'تم التغيير على هذا الجهاز لكن لم يتم تأكيد مزامنته بين الأجهزة.', 6000);
  } finally {
    recurringSaveInFlight = false;
  }
}

async function generateRecurringOccurrence(scheduleId, dueDate) {
  const key = recurringOccurrenceKey(scheduleId, dueDate);
  if (recurringGenerationInFlight.has(key)) return;
  if (!googleTransactionsLoaded || !cloudSettingsInitialized) {
    alert('يلزم اكتمال قراءة معاملات Google Sheets ومزامنة الإعدادات قبل تسجيل استحقاق، حتى نتحقق من عدم تكراره.');
    return;
  }
  const initialSchedule = recurringScheduleFor(scheduleId);
  if (!initialSchedule || initialSchedule.active === false) {
    showAppToast('هذا الالتزام متوقف أو غير موجود.', 4000);
    return;
  }
  if (!isValidISODate(dueDate) || dueDate > localISODate()) {
    showAppToast('لن يتم إنشاء معاملة قبل تاريخ الاستحقاق.', 4000);
    return;
  }
  const [dueYear, dueMonth] = dueDate.split('-').map(Number);
  if (monthDueDate(dueYear, dueMonth - 1, initialSchedule.dueDay) !== dueDate || dueDate < initialSchedule.startDate) {
    showAppToast('التاريخ المحدد لا يطابق استحقاق هذا الالتزام.', 4000);
    return;
  }
  recurringGenerationInFlight.add(key);
  if (!confirm(
    'تأكيد تسجيل الاستحقاق؟\n\n' + initialSchedule.name + '\n' +
    'التاريخ: ' + dueDate + '\n' +
    'المبلغ: ' + recurringAmountLabel(initialSchedule) + '\n' +
    'الحساب: ' + accountDisplayName(initialSchedule.acc) + '\n\n' +
    'سيتم إنشاء المعاملة مرة واحدة فقط إذا لم يكن لهذا الاستحقاق سجل في Google Sheets.'
  )) {
    recurringGenerationInFlight.delete(key);
    return;
  }

  try {
    // Refresh cloud settings and transactions immediately before creating an occurrence.
    await loadSharedSettingsFromGoogle({ renderAfter: false });
    await loadDataFromGoogle({ renderAfter: false });
    if (!googleTransactionsLoaded) throw new Error('تعذرت قراءة Google Sheets للتحقق من الاستحقاق.');

    const schedule = recurringScheduleFor(scheduleId);
    if (!schedule || schedule.active === false) {
      render();
      showAppToast('الالتزام لم يعد نشطًا بعد تحديث البيانات. لم يتم تسجيل شيء.', 5000);
      return;
    }

    if (occurrenceAlreadyGenerated(scheduleId, dueDate)) {
      markOccurrenceGenerated(scheduleId, dueDate);
      save();
      const ledgerSynced = await saveSharedSettingsToGoogle();
      render();
      showAppToast(
        ledgerSynced
          ? 'الاستحقاق مسجل بالفعل في البيانات المشتركة؛ لم يتم إنشاء معاملة مكررة.'
          : 'الاستحقاق موجود في Google Sheets؛ لم يتم إنشاء نسخة ثانية.',
        6500
      );
      return;
    }

    const tx = {
      id: Math.max(0, ...S.tx.map(item => Number(item.id) || 0)) + 1,
      date: dueDate,
      name: schedule.name,
      type: schedule.type,
      cat: schedule.cat,
      amt: Number(schedule.amount),
      fee: Number(schedule.fee || 0),
      acc: schedule.acc,
      pay: schedule.pay,
      code: '',
      qty: '',
      price: '',
      note: schedule.note || '',
      googleNotes: makeRecurringCloudNote(schedule.id, dueDate, schedule.name, schedule.note || ''),
      cur: schedule.cur,
      recurringId: schedule.id,
      recurringDate: dueDate,
      recurringNote: schedule.note || ''
    };
    const ids = {};
    S.tx.forEach(item => { ids[item.id] = (ids[item.id] || 0) + 1; });
    const validation = status(tx, ids);
    if (validation !== 'سليم') throw new Error('لا يمكن إنشاء المعاملة: ' + validation);

    // Do not mark the occurrence as generated until the transaction write is confirmed.
    await saveTransactionToGoogle(tx);
    tx.googleSynced = true;
    S.tx.push(tx);
    googleRemoteTransactions.push({
      date: normalizeGoogleDate(tx.date), type: tx.type, amt: tx.amt, cat: tx.cat,
      notes: googleNotes(tx)
    });
    markOccurrenceGenerated(schedule.id, dueDate, String(tx.id));
    save();

    const stateSynced = await saveSharedSettingsToGoogle();
    render();
    showAppToast(
      stateSynced
        ? 'تم تسجيل استحقاق «' + schedule.name + '» وتحديث مِعيار.'
        : 'تم تسجيل المعاملة في Google Sheets، لكن لم يتم تأكيد مزامنة سجل الالتزامات. المرجع المحفوظ سيمنع تكرارها عند المراجعة.',
      7000
    );
  } catch (error) {
    console.error('تعذر تسجيل الاستحقاق المتكرر:', error);
    await loadDataFromGoogle({ renderAfter: false });
    render();
    alert('لم أتمكن من تأكيد تسجيل الاستحقاق. لم تعاود الضغط مباشرة؛ حدّث بيانات Google Sheets أولًا، لأن المرجع الفريد سيُستخدم للتحقق مما إذا كان الصف قد وصل بالفعل.' +
      (error && error.message ? '\nالتفاصيل: ' + String(error.message).slice(0, 250) : ''));
  } finally {
    recurringGenerationInFlight.delete(key);
  }
}


let editingTransfer = null;
let transferInFlight = false;

function accountBalanceAt(code, date, excludeTransferId = '') {
  const account = S.accounts.find(item => item.code === code);
  if (!account) return 0;
  const ids = {};
  S.tx.forEach(tx => { ids[tx.id] = (ids[tx.id] || 0) + 1; });
  return Number(account.open || 0) + S.tx
    .filter(tx => {
      const meta = excludeTransferId ? transferMetadata(tx) : null;
      return tx.acc === code && tx.date <= date &&
        !(meta && meta.id === excludeTransferId) &&
        status(tx, ids) === 'سليم';
    })
    .reduce((sum, tx) => sum + P(tx), 0);
}

function getTransferPair(tx) {
  const meta = transferMetadata(tx);
  if (!meta) return null;
  const rows = S.tx.filter(item => {
    const itemMeta = transferMetadata(item);
    return itemMeta && itemMeta.id === meta.id;
  });
  return { meta, rows,
    outgoing: rows.find(item => item.type === 'تحويل') || null,
    incoming: rows.find(item => item.type === 'تسوية') || null };
}

function updateTxFxPreview() {
  const form = $('#formTx'), preview = $('#txFxPreview');
  if (!form || !preview) return;
  const date = form.elements.namedItem('date').value || localISODate();
  const cur = form.elements.namedItem('cur').value || 'EGP';
  const amount = Number(form.elements.namedItem('amt').value);
  const rate = rateForDate(cur, date);
  const summary = cur === 'EGP'
    ? 'الجنيه المصري هو العملة الأساسية للنظام.'
    : 'سعر ' + cur + ' في ' + date + ': 1 ' + cur + ' = ' + f(rate) + ' ج.م.';
  const value = Number.isFinite(amount) && amount > 0
    ? '<div class="mt-1"><strong>قيمة المعاملة بالجنيه:</strong> ' + f(amount * rate) + ' ج.م.</div>' : '';
  const baseline = cur !== 'EGP' && !(S.rateHistory || []).some(item => item.cur === cur && item.date <= date);
  preview.innerHTML = '<div>' + esc(summary) + '</div>' + value +
    (baseline ? '<div class="note mt-1">لا يوجد سجل تاريخي قبل هذا التاريخ؛ يُستخدم سعر الأساس المحفوظ.</div>' : '');
}

function updateTransferPreview() {
  const form = $('#formTransfer'), preview = $('#transferFxPreview');
  if (!form || !preview) return;
  const date = form.elements.namedItem('date').value || localISODate();
  const fromCode = form.elements.namedItem('from').value, toCode = form.elements.namedItem('to').value;
  const cur = form.elements.namedItem('cur').value || 'EGP';
  const amount = Number(form.elements.namedItem('amount').value);
  if (fromCode && toCode && fromCode === toCode) {
    preview.innerHTML = '<div class="transfer-preview-warning"><i class="bi bi-exclamation-triangle"></i> اختار حسابين مختلفين؛ لا يمكن التحويل من الحساب إلى نفسه.</div>';
    return;
  }
  const feeAmount = Number(form.elements.namedItem('fee').value) || 0;
  const rate = rateForDate(cur, date);
  const sent = Math.max(0, Number.isFinite(amount) ? amount : 0);
  const excludedTransferId = editingTransfer ? editingTransfer.meta.id : '';
  const fromBal = accountBalanceAt(fromCode, date, excludedTransferId);
  const toBal = accountBalanceAt(toCode, date, excludedTransferId);
  const debit = (sent + feeAmount) * rate, credit = sent * rate;
  const shortfall = sent > 0 && fromBal + 0.005 < debit;
  preview.innerHTML =
    '<div><strong>من ' + esc(accountDisplayName(fromCode)) + ' إلى ' + esc(accountDisplayName(toCode)) + '</strong></div>' +
    '<div class="transfer-preview-grid mt-2"><div><span>سيُخصم من المصدر</span><strong>' + f(sent + feeAmount) + ' ' + esc(cur) + '</strong><small>' + f(debit) + ' ج.م.</small></div>' +
    '<div><span>سيضاف للمستلم</span><strong>' + f(sent) + ' ' + esc(cur) + '</strong><small>' + f(credit) + ' ج.م.</small></div></div>' +
    '<div class="note mt-2">الرصيد المتوقع للمصدر: ' + f(fromBal - debit) + ' ج.م. · رصيد المستلم المتوقع: ' + f(toBal + credit) + ' ج.م.</div>' +
    (shortfall ? '<div class="transfer-preview-warning mt-2"><i class="bi bi-exclamation-triangle"></i> مبلغ التحويل والرسوم أكبر من رصيد المصدر في التاريخ المحدد.</div>' : '') +
    '<div class="note mt-1">الطرفان بنفس العملة؛ الرسوم تخصم من المصدر فقط.</div>';
}

function openTransfer(tx = null) {
  if (txSaveInFlight || transferInFlight) {
    showAppToast('هناك عملية حفظ قيد التنفيذ. انتظر تأكيدها قبل بدء عملية أخرى.', 4000);
    return;
  }
  if (S.accounts.length < 2) { alert('أضف حسابًا ثانيًا أولًا حتى تتمكن من التحويل بين الحسابات.'); return; }
  editingTransfer = null;
  if (tx) {
    const pair = getTransferPair(tx);
    if (!pair || !pair.outgoing || !pair.incoming || pair.rows.length !== 2 ||
        String(pair.outgoing.id) === String(pair.incoming.id)) {
      alert('هذا التحويل غير مكتمل الطرفين أو يحتوي على أرقام مكررة. احذف التحويل المرتبط من زر الحذف ثم سجّله من جديد حتى لا تتغير الأرصدة بالخطأ.');
      return;
    }
    editingTransfer = pair;
  }
  const form = $('#formTransfer');
  form.reset();
  const fromSelect = form.elements.namedItem('from'), toSelect = form.elements.namedItem('to');
  const options = S.accounts.map(account => '<option value="' + esc(account.code) + '">' + esc(account.name) + ' (' + esc(account.code) + ')</option>').join('');
  fromSelect.innerHTML = options; toSelect.innerHTML = options;
  const out = editingTransfer ? editingTransfer.outgoing : null;
  const inc = editingTransfer ? editingTransfer.incoming : null;
  form.elements.namedItem('date').value = out ? out.date : localISODate();
  fromSelect.value = out ? out.acc : S.accounts[0].code;
  toSelect.value = inc ? inc.acc : S.accounts.find(account => account.code !== fromSelect.value).code;
  form.elements.namedItem('amount').value = out ? out.amt : '';
  form.elements.namedItem('cur').value = out ? (out.cur || 'EGP') : 'EGP';
  form.elements.namedItem('fee').value = out ? (out.fee || 0) : 0;
  fillSelect(form.elements.namedItem('pay'), PAY, out ? out.pay : 'نقدي');
  form.elements.namedItem('note').value = editingTransfer ? editingTransfer.meta.note : '';
  $('#modalTransferTitle').textContent = editingTransfer ? 'تعديل التحويل بين الحسابات' : 'تحويل بين الحسابات';
  $('#btnSaveTransfer').innerHTML = editingTransfer ? '<i class="bi bi-check-lg"></i> حفظ تعديل التحويل' : '<i class="bi bi-arrow-left-right"></i> تنفيذ التحويل';
  updateTransferPreview();
  new bootstrap.Modal($('#modalTransfer')).show();
}

async function deleteLinkedTransfer(tx) {
  const meta = transferMetadata(tx);
  if (!meta) return;
  const pair = S.tx.filter(item => { const m = transferMetadata(item); return m && m.id === meta.id; });
  if (!pair.length) return;
  const complete = pair.length === 2 && pair.some(item => item.type === 'تحويل') && pair.some(item => item.type === 'تسوية');
  if (!confirm(complete
    ? 'حذف التحويل بالكامل؟ سيتم حذف حركتي الخصم والإضافة، وليس طرفًا واحدًا فقط.'
    : 'التحويل غير مكتمل. سيتم حذف الطرف المتبقي المرتبط به حتى لا يظل رصيد غير متوازن. متابعة؟')) return;
  const deleted = [];
  try {
    for (const item of pair) { await deleteTransactionFromGoogle(item); deleted.push(item); }
    S.tx = S.tx.filter(item => { const m = transferMetadata(item); return !m || m.id !== meta.id; });
    save(); render(); showAppToast('تم حذف التحويل المرتبط بطرفيه.', 5000);
  } catch (error) {
    const restoreErrors = [];
    for (const item of deleted) {
      try { await saveTransactionToGoogle(item); } catch (restoreError) { restoreErrors.push(restoreError); }
    }
    await loadDataFromGoogle({ renderAfter: false }); render();
    alert('لم يكتمل حذف التحويل. حاول النظام استرجاع أي طرف حُذف بالفعل.' +
      (restoreErrors.length ? ' تعذر تأكيد الاسترجاع الكامل؛ راجع التدقيق وGoogle Sheets.' : '') +
      (error && error.message ? '\nالتفاصيل: ' + String(error.message).slice(0, 220) : ''));
  }
}

$('#formTransfer').addEventListener('submit', async e => {
  e.preventDefault();
  if (transferInFlight) return;
  if (!googleTransactionsLoaded) {
    alert('لا أستطيع تأكيد قراءة Google Sheets الآن. أعد تحميل الصفحة وانتظر اكتمال المزامنة قبل تسجيل التحويل.');
    return;
  }
  const d = Object.fromEntries(new FormData(e.target));
  const date = String(d.date || ''), fromCode = String(d.from || ''), toCode = String(d.to || '');
  const amount = Number(d.amount), feeAmount = Number(d.fee || 0), cur = String(d.cur || 'EGP');
  const note = String(d.note || '').trim();
  if (!isValidISODate(date)) { alert('اختار تاريخًا صحيحًا للتحويل.'); return; }
  if (!fromCode || !toCode || !S.accounts.some(a => a.code === fromCode) || !S.accounts.some(a => a.code === toCode)) { alert('اختار حساب المصدر والحساب المستلم.'); return; }
  if (fromCode === toCode) { alert('حساب المصدر لازم يختلف عن حساب الاستلام.'); return; }
  if (!Number.isFinite(amount) || amount <= 0) { alert('اكتب مبلغ تحويل أكبر من صفر.'); return; }
  if (!Number.isFinite(feeAmount) || feeAmount < 0) { alert('الرسوم لازم تكون صفرًا أو أكبر.'); return; }

  const transferId = editingTransfer ? editingTransfer.meta.id : 'TRF-' + date.replace(/-/g, '') + '-' + Date.now().toString(36).toUpperCase();
  const oldOut = editingTransfer ? editingTransfer.outgoing : null, oldIn = editingTransfer ? editingTransfer.incoming : null;
  const outId = oldOut ? oldOut.id : Math.max(0, ...S.tx.map(item => Number(item.id) || 0)) + 1;
  const inId = oldIn ? oldIn.id : Math.max(outId, ...S.tx.map(item => Number(item.id) || 0)) + 1;
  const cloudNote = makeTransferCloudNote(transferId, fromCode, toCode, note);
  const meta = { id: transferId, from: fromCode, to: toCode, note };
  const outgoing = { id: outId, date, name: transferDisplayName('تحويل', meta), type: 'تحويل', cat: 'تحويل داخلي',
    amt: amount, fee: feeAmount, pay: d.pay || 'نقدي', acc: fromCode, code: '', qty: '', price: '', note,
    googleNotes: cloudNote, cur, transferId, transferFrom: fromCode, transferTo: toCode, transferNote: note };
  const incoming = { id: inId, date, name: transferDisplayName('تسوية', meta), type: 'تسوية', cat: 'تحويل داخلي',
    amt: amount, fee: 0, pay: d.pay || 'نقدي', acc: toCode, code: '', qty: '', price: '', note,
    googleNotes: cloudNote, cur, transferId, transferFrom: fromCode, transferTo: toCode, transferNote: note };

  const oldIds = new Set([oldOut, oldIn].filter(Boolean).map(item => String(item.id)));
  const ids = {};
  S.tx.filter(item => !oldIds.has(String(item.id))).forEach(item => { ids[item.id] = (ids[item.id] || 0) + 1; });
  if (!editingTransfer && ((ids[outgoing.id] || 0) || (ids[incoming.id] || 0))) {
    alert('تعذر إنشاء رقمين فريدين للتحويل. حدّث الصفحة وحاول مرة أخرى.'); return;
  }
  const outStatus = status(outgoing, ids), inStatus = status(incoming, ids);
  if (outStatus !== 'سليم' || inStatus !== 'سليم') { alert('تعذر إنشاء التحويل: ' + (outStatus !== 'سليم' ? outStatus : inStatus)); return; }
  const debit = toEGP(amount + feeAmount, cur, date);
  const sourceBalance = accountBalanceAt(fromCode, date, editingTransfer ? editingTransfer.meta.id : '');
  if (sourceBalance + 0.005 < debit && !confirm('رصيد حساب المصدر في التاريخ المحدد أقل من مبلغ التحويل والرسوم. هل تريد تسجيل الرصيد السالب؟')) return;

  transferInFlight = true;
  const submit = $('#btnSaveTransfer'), oldButtonHtml = submit.innerHTML;
  submit.disabled = true;
  submit.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> جارٍ حفظ التحويل…';
  const deletedOld = [], savedNew = [];
  try {
    if (editingTransfer) {
      await deleteTransactionFromGoogle(oldOut); deletedOld.push(oldOut);
      await deleteTransactionFromGoogle(oldIn); deletedOld.push(oldIn);
    }
    await saveTransactionToGoogle(outgoing); savedNew.push(outgoing);
    await saveTransactionToGoogle(incoming); savedNew.push(incoming);

    const stale = editingTransfer ? [oldOut, oldIn] : [];
    googleRemoteTransactions = googleRemoteTransactions.filter(remote =>
      !stale.some(old => sameRemoteCore(old, remote) && googleNotes(old) === String(remote.notes || '').trim())
    );
    S.tx = S.tx.filter(item => {
      const m = transferMetadata(item);
      return !oldIds.has(String(item.id)) && (!m || m.id !== transferId);
    });
    outgoing.googleSynced = true; incoming.googleSynced = true;
    S.tx.push(outgoing, incoming);
    googleRemoteTransactions.push(
      { date: normalizeGoogleDate(outgoing.date), type: outgoing.type, amt: outgoing.amt, cat: outgoing.cat, notes: cloudNote },
      { date: normalizeGoogleDate(incoming.date), type: incoming.type, amt: incoming.amt, cat: incoming.cat, notes: cloudNote }
    );
    save();
    bootstrap.Modal.getInstance($('#modalTransfer')).hide();
    editingTransfer = null; render();
    showAppToast('تم تسجيل طرفي التحويل وتحديث أرصدة الحسابين.', 5000);
  } catch (error) {
    const rollbackErrors = [];
    for (const item of savedNew.slice().reverse()) {
      try { await deleteTransactionFromGoogle(item); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    for (const item of deletedOld) {
      try { await saveTransactionToGoogle(item); } catch (restoreError) { rollbackErrors.push(restoreError); }
    }
    await loadDataFromGoogle({ renderAfter: false }); render();
    alert('لم يكتمل التحويل بالكامل. حاول النظام التراجع عن الخطوات السابقة، ثم أعاد قراءة بيانات Google Sheets.' +
      (rollbackErrors.length ? '\nتعذر تأكيد استرجاع كل الخطوات؛ راجع صفحة التدقيق وGoogle Sheets قبل إعادة المحاولة.' : '') +
      (error && error.message ? '\nالتفاصيل: ' + String(error.message).slice(0, 220) : ''));
  } finally {
    transferInFlight = false;
    submit.disabled = false;
    submit.innerHTML = editingTransfer ? '<i class="bi bi-check-lg"></i> حفظ تعديل التحويل' : oldButtonHtml;
  }
});

function openTx(t) {
  if (txSaveInFlight || transferInFlight) {
    showAppToast('هناك عملية حفظ قيد التنفيذ. انتظر تأكيدها قبل بدء عملية أخرى.', 4000);
    return;
  }
  editingTx = t || null;
  const isNew = !t;
  t = t || { id: Math.max(0, ...S.tx.map(x => +x.id)) + 1, date: localISODate(), name: '', cat: 'الأساسيات', type: 'مصروف', amt: '', fee: 0, pay: 'نقدي', acc: S.accounts[0]?.code || '', code: '', qty: '', price: '', note: '', cur: 'EGP' };
  $('#modalTxTitle').textContent = isNew ? 'معاملة جديدة' : 'تعديل معاملة رقم ' + t.id;
  const form = $('#formTx');
  form.date.value = t.date; form.elements.namedItem('name').value = t.name || ''; form.amt.value = t.amt ?? ''; form.fee.value = t.fee || 0; form.code.value = t.code || defaultAssetCode(t.type); form.qty.value = t.qty ?? ''; form.price.value = t.price ?? ''; form.note.value = t.note || ''; form.cur.value = t.cur || 'EGP';
  const typeSelect = form.elements.namedItem('type');
  // New transfers must use the paired workflow; retain these types only for legacy rows being edited.
  const selectableTypes = isNew ? TYPES.filter(type => type !== 'تحويل' && type !== 'تسوية') : TYPES;
  typeSelect.innerHTML = selectableTypes.map(type => '<option value="' + esc(type) + '">' + esc(type) + '</option>').join('');
  if (LEGACY_ASSET_TYPES.includes(t.type)) {
    typeSelect.insertAdjacentHTML('beforeend', '<option value="' + esc(t.type) + '">' + esc(t.type) + ' (معاملة قديمة)</option>');
  }
  typeSelect.value = t.type;
  fillSelect($('#txCat'), ALLC, t.cat); fillSelect($('#txAcc'), S.accounts.map(a => a.code), t.acc); fillSelect($('#txPay'), PAY, t.pay);
  updateTxFxPreview();
  new bootstrap.Modal($('#modalTx')).show();
}

$('#formIncomeSource').addEventListener('submit', async e => {
  e.preventDefault();
  if (incomeSourceSaveInFlight || cloudSettingsSyncInFlight) return;
  const d = Object.fromEntries(new FormData(e.target));
  const id = String(d.id || '').trim();
  const name = String(d.name || '').trim();
  const kind = String(d.kind || '');
  const frequency = String(d.frequency || '');
  const cur = String(d.cur || 'EGP');
  const rawExpected = String(d.expectedAmount ?? '').trim();
  const expectedAmount = rawExpected === '' ? 0 : Number(rawExpected);
  const note = String(d.note || '').trim().slice(0, 300);

  if (!name) { alert('اكتب اسمًا واضحًا لمصدر الدخل.'); return; }
  if (!INCOME_SOURCE_KINDS.includes(kind)) { alert('اختار نوعًا صحيحًا لمصدر الدخل.'); return; }
  if (!INCOME_SOURCE_FREQUENCIES.includes(frequency)) { alert('اختار دورية صحيحة للدخل.'); return; }
  if (!['EGP', 'SAR', 'USD'].includes(cur)) { alert('العملة المحددة غير مدعومة.'); return; }
  if (rawExpected !== '' && (!Number.isFinite(expectedAmount) || expectedAmount <= 0)) {
    alert('المبلغ المتوقع يجب أن يكون أكبر من صفر، أو اتركه فارغًا لو غير محدد.');
    return;
  }

  const previous = id ? (S.incomeSources || []).find(item => String(item.id) === id) : null;
  if (id && !previous) { alert('لم أجد مصدر الدخل المطلوب؛ حدّث الصفحة وحاول مرة أخرى.'); return; }
  const duplicateName = (S.incomeSources || []).some(item =>
    String(item.id) !== id && item.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
  );
  if (duplicateName) { alert('اسم مصدر الدخل موجود بالفعل؛ استخدم اسمًا مختلفًا لتمييز المصادر.'); return; }

  const source = {
    id: previous ? previous.id : incomeSourceId(),
    name: name.slice(0, 100), kind, frequency, cur,
    expectedAmount: rawExpected === '' ? 0 : expectedAmount,
    note,
    active: previous ? previous.active !== false : true,
    createdAt: previous ? (previous.createdAt || new Date().toISOString()) : new Date().toISOString()
  };
  const nextSources = previous
    ? S.incomeSources.map(item => String(item.id) === id ? source : item)
    : [...(S.incomeSources || []), source];

  const synced = await persistIncomeSources(nextSources, previous
    ? 'تم تحديث مصدر الدخل ومزامنته.'
    : 'تمت إضافة مصدر الدخل ومزامنته.');
  if (synced) bootstrap.Modal.getInstance($('#modalIncomeSource'))?.hide();
});

$('#formTx').addEventListener('submit', async e => {
  e.preventDefault();
  if (txSaveInFlight) return;
  const d = Object.fromEntries(new FormData(e.target));
  const wasEditing = Boolean(editingTx);
  const oldTx = wasEditing ? { ...editingTx } : null;
  const t = editingTx ? { ...editingTx } : { id: Math.max(0, ...S.tx.map(x => +x.id)) + 1 };
  const previousGoogleNotes = wasEditing ? googleNotes(oldTx) : '';
  const noteChanged = wasEditing && String(d.note || '') !== String(oldTx.note || '');
  const nameChanged = wasEditing && String(d.name || '') !== String(oldTx.name || '');
  let notesForGoogle = String(d.note || d.name || '').trim();
  if (wasEditing && !noteChanged && !nameChanged) notesForGoogle = previousGoogleNotes || notesForGoogle;
  else if (wasEditing && !noteChanged && nameChanged) notesForGoogle = String(d.name || d.note || '').trim();
  if (wasEditing && (oldTx.recurringId || oldTx.recurringDate || parseRecurringCloudNote(previousGoogleNotes))) {
    const recurringMeta = parseRecurringCloudNote(previousGoogleNotes);
    const recurringDate = oldTx.recurringDate || (recurringMeta && recurringMeta.date) || oldTx.date;
    const recurringRef = oldTx.recurringId || (recurringMeta && recurringMeta.id);
    notesForGoogle = makeRecurringCloudNote(
      recurringRef, recurringDate, String(d.name || oldTx.name || 'التزام دوري'),
      String(d.note !== undefined ? d.note : ((recurringMeta && recurringMeta.note) || oldTx.note || ''))
    );
  }
  const assetCode = String(d.code || defaultAssetCode(d.type) || '').trim();
  Object.assign(t, { date: d.date, name: d.name, type: d.type, cat: d.cat, amt: +d.amt, fee: +d.fee || 0, acc: d.acc, pay: d.pay, code: assetCode, qty: d.qty === '' ? '' : +d.qty, price: d.price === '' ? '' : +d.price, note: d.note || '', googleNotes: notesForGoogle, cur: d.cur || 'EGP', sub: t.sub || '' });
  const ids = {};
  S.tx.filter(x => !wasEditing || x.id !== oldTx.id).forEach(x => ids[x.id] = (ids[x.id] || 0) + 1);
  const validation = status(t, ids);
  if (validation !== 'سليم') { alert('لا يمكن حفظ المعاملة: ' + validation); return; }
  if (!googleTransactionsLoaded) {
    alert('لم تكتمل قراءة بيانات Google Sheets؛ لم أحفظ المعاملة حتى لا تختلف البيانات بين الأجهزة. أعد تحميل الصفحة وانتظر اكتمال المزامنة.');
    return;
  }

  txSaveInFlight = true;
  const submitButton = e.target.querySelector('button[type="submit"]');
  const previousSubmitHtml = submitButton ? submitButton.innerHTML : '';
  const dismissButtons = Array.from($('#modalTx').querySelectorAll('[data-bs-dismiss="modal"]'));
  const dismissStates = dismissButtons.map(button => ({ button, disabled: button.disabled }));
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> جارٍ حفظ المعاملة…';
  }
  dismissButtons.forEach(button => { button.disabled = true; });

  let oldGoogleRowDeleted = false;
  try {
    // The current Apps Script API shown in this project has no confirmed update-by-ID endpoint.
    // Use its existing delete action before re-adding, and try to restore the old row on failure.
    if (wasEditing) {
      // Google Apps Script compares the complete identity supplied by deleteTransactionFromGoogle
      // and refuses deletion when more than one sheet row matches.
      await deleteTransactionFromGoogle(oldTx);
      oldGoogleRowDeleted = true;
    }
    await saveTransactionToGoogle(t);
    if (wasEditing) S.tx = S.tx.filter(x => x.id !== oldTx.id);
    t.googleSynced = true;
    S.tx.push(t);
    if (t.code && !S.prices.some(p => p.code === t.code) && t.price) {
      S.prices.push({ code: t.code, cat: GOLD_TYPES.has(t.type) ? 'ذهب' : 'سهم', price: +t.price, date: '' });
      scheduleSharedSettingsSync();
    }
    save();
    bootstrap.Modal.getInstance($('#modalTx')).hide();
    editingTx = null;
    render();
  } catch (error) {
    if (wasEditing && oldGoogleRowDeleted) {
      try { await saveTransactionToGoogle(oldTx); }
      catch (restoreError) { console.error('تعذر استرجاع الصف السابق في Google Sheets:', restoreError); }
    }
    console.error('فشل حفظ المعاملة في Google Sheets:', error);
    alert('لم يتم تأكيد العملية في Google Sheets. لم أغيّر النسخة المحلية. ' + (error && error.message ? error.message : 'إذا كنت تعدّل معاملة، راجع ورقة Google Sheets للتأكد من بقاء الصف السابق.'));
  } finally {
    txSaveInFlight = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.innerHTML = previousSubmitHtml;
    }
    dismissStates.forEach(({ button, disabled }) => { button.disabled = disabled; });
  }
});

$('#formAcc').addEventListener('submit', e => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  if (S.accounts.some(a => a.code === d.code)) { alert('الرمز موجود مسبقاً'); return; }
  S.accounts.push({ code: d.code, name: d.name, type: d.type || 'نقد', open: +d.open || 0, liq: d.liq ? 1 : 0 });
  save(); scheduleSharedSettingsSync(); bootstrap.Modal.getInstance($('#modalAcc')).hide(); render();
});

$('#formPrice').addEventListener('submit', e => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  if (S.prices.some(p => p.code === d.code)) { alert('الرمز موجود مسبقاً'); return; }
  S.prices.push({ code: d.code, cat: d.cat, price: +d.price || 0, date: d.date || '' });
  save(); scheduleSharedSettingsSync(); bootstrap.Modal.getInstance($('#modalPrice')).hide(); render();
});

function setSidebarOpen(open) {
  const sidebar = $('#appSidebar');
  const backdrop = $('#sidebarBackdrop');
  const toggle = $('#btnSidebarToggle');
  if (!sidebar || !backdrop || !toggle) return;

  sidebar.classList.toggle('is-open', Boolean(open));
  backdrop.hidden = !open;
  document.body.classList.toggle('sidebar-open', Boolean(open));
  sidebar.setAttribute('aria-hidden', String(!open));
  toggle.setAttribute('aria-expanded', String(Boolean(open)));
  toggle.setAttribute('aria-label', open ? 'القائمة الرئيسية مفتوحة' : 'فتح القائمة الرئيسية');

  const focusTarget = open ? $('#btnSidebarClose') : toggle;
  if (focusTarget && typeof focusTarget.focus === 'function') {
    focusTarget.focus({ preventScroll: true });
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#appSidebar')?.classList.contains('is-open')) {
    setSidebarOpen(false);
  }
});

document.addEventListener('click', e => {
  if (e.target.closest('#btnSidebarToggle')) {
    setSidebarOpen(!$('#appSidebar')?.classList.contains('is-open'));
    return;
  }
  if (e.target.closest('#btnSidebarClose') || e.target.closest('#sidebarBackdrop')) {
    setSidebarOpen(false);
    return;
  }

  const tab = e.target.closest('[data-tab]');
  if (tab) {
    setSidebarOpen(false);
    S.ui.tab = tab.dataset.tab;
    save();
    render();
    if (S.ui.tab === 'plan') loadPlannerTasksFromGoogle({ renderAfter: false });
    return;
  }
  if (e.target.closest('#btnAddTx')) { openTx(); return; }
  if (e.target.closest('#btnAddTransfer')) { openTransfer(); return; }
  if (e.target.closest('#btnAddGoal') || e.target.closest('#btnAddGoalEmpty')) { openFinancialGoalModal(); return; }
  if (e.target.closest('#btnAddIncomeSource') || e.target.closest('#btnAddIncomeSourceEmpty')) { openIncomeSourceModal(); return; }
  const editIncomeSourceBtn = e.target.closest('[data-edit-income-source]');
  if (editIncomeSourceBtn) { openIncomeSourceModal(editIncomeSourceBtn.dataset.editIncomeSource); return; }
  const toggleIncomeSourceBtn = e.target.closest('[data-toggle-income-source]');
  if (toggleIncomeSourceBtn) {
    const source = (S.incomeSources || []).find(item => String(item.id) === String(toggleIncomeSourceBtn.dataset.toggleIncomeSource));
    if (!source) { showAppToast('لم أجد مصدر الدخل المطلوب.', 3500); return; }
    const nextSources = S.incomeSources.map(item => String(item.id) === String(source.id)
      ? { ...item, active: item.active === false }
      : item);
    persistIncomeSources(nextSources, source.active === false ? 'تم تفعيل مصدر الدخل.' : 'تم إيقاف مصدر الدخل مؤقتًا.');
    return;
  }
  const deleteIncomeSourceBtn = e.target.closest('[data-delete-income-source]');
  if (deleteIncomeSourceBtn) {
    const source = (S.incomeSources || []).find(item => String(item.id) === String(deleteIncomeSourceBtn.dataset.deleteIncomeSource));
    if (!source) { showAppToast('لم أجد مصدر الدخل المطلوب.', 3500); return; }
    if (!confirm('حذف مصدر الدخل «' + source.name + '»؟ لن تتغير أي معاملة مالية مسجلة.')) return;
    persistIncomeSources(S.incomeSources.filter(item => String(item.id) !== String(source.id)), 'تم حذف مصدر الدخل.');
    return;
  }
  const editGoalBtn = e.target.closest('[data-edit-goal]');
  if (editGoalBtn) { openFinancialGoalModal(editGoalBtn.dataset.editGoal); return; }
  const contributeGoalBtn = e.target.closest('[data-goal-contribute]');
  if (contributeGoalBtn) { openGoalContributionModal(contributeGoalBtn.dataset.goalContribute); return; }
  if (e.target.closest('#btnAddRecurring') || e.target.closest('#btnAddRecurringEmpty')) { openRecurringModal(); return; }
  const editRecurringBtn = e.target.closest('[data-edit-recurring]');
  if (editRecurringBtn) { openRecurringModal(editRecurringBtn.dataset.editRecurring); return; }
  const toggleRecurringBtn = e.target.closest('[data-toggle-recurring]');
  if (toggleRecurringBtn) {
    toggleRecurringSchedule(toggleRecurringBtn.dataset.toggleRecurring, toggleRecurringBtn.dataset.active === '1');
    return;
  }
  const generateRecurringBtn = e.target.closest('[data-generate-occurrence]');
  if (generateRecurringBtn) {
    generateRecurringOccurrence(generateRecurringBtn.dataset.generateOccurrence, generateRecurringBtn.dataset.dueDate);
    return;
  }
  if (e.target.closest('#btnSyncSettings')) { saveSharedSettingsToGoogle({ manual: true }); return; }
  if (e.target.closest('#btnReloadCloud')) { loadSharedSettingsFromGoogle().then(() => render()); return; }
  if (e.target.closest('#btnSyncTxDetails')) { syncExistingTransactionDetailsToGoogle(); return; }
  if (e.target.closest('#btnSyncPendingTx')) { syncPendingTransactionsToGoogle(); return; }
  if (e.target.closest('#btnAddAcc')) { $('#formAcc').reset(); new bootstrap.Modal($('#modalAcc')).show(); return; }
  if (e.target.closest('#btnAddPrice')) { $('#formPrice').reset(); $('#formPrice').date.value = localISODate(); new bootstrap.Modal($('#modalPrice')).show(); return; }
  const editBtn = e.target.closest('[data-edit]');
  if (editBtn) {
    const selectedTx = S.tx.find(t => String(t.id) === String(editBtn.dataset.edit));
    if (selectedTx && transferMetadata(selectedTx)) openTransfer(selectedTx);
    else if (selectedTx) openTx(selectedTx);
    return;
  }

  // A paired transfer is deleted as a unit to keep source and destination balances aligned.
  const delBtn = e.target.closest('[data-del]');
  if (delBtn) {
    const txToDelete = S.tx.find(t => String(t.id) === String(delBtn.dataset.del));
    if (txToDelete && transferMetadata(txToDelete)) {
      deleteLinkedTransfer(txToDelete);
      return;
    }
    if (txToDelete && confirm('حذف المعاملة رقم ' + delBtn.dataset.del + '؟')) {
      deleteTransactionFromGoogle(txToDelete).then(() => {
        S.tx = S.tx.filter(t => String(t.id) !== String(delBtn.dataset.del));
        save(); render();
      }).catch(err => {
        console.error('فشل حذف المعاملة من Google Sheets:', err);
        const detail = err && err.message ? '\nالتفاصيل: ' + String(err.message).slice(0, 350) : '';
        alert('لم يتم تأكيد الحذف من Google Sheets، لذلك احتفظت بالمعاملة محليًا.' + detail);
      });
    }
    return;
  }
  if (e.target.closest('#btnTheme')) { const cur = document.documentElement.getAttribute('data-theme'); const next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', next); S.ui.theme = next; save(); render(); return; }
  if (e.target.closest('#btnExp')) {
    const backup = {
      ...S,
      backupMeta: { application: 'Meyaar', schemaVersion: 2, exportedAt: new Date().toISOString(),
        transactionCount: S.tx.length, pendingTransactionCount: pendingTransactions().length }
    };
    const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = 'نسخة_احتياطية_مِعيار_' + localISODate() + '.json';
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    showAppToast('تم تجهيز النسخة الاحتياطية. احتفظ بها في مكان آمن.', 5000);
    return;
  }
  if (e.target.closest('#btnCsv')) { const h = ['id', 'date', 'name', 'cat', 'sub', 'type', 'amt', 'fee', 'cur', 'pay', 'acc', 'code', 'qty', 'price', 'note']; const rows = [h, ...S.tx.map(t => h.map(k => '"' + String(t[k] ?? '').replace(/"/g, '""') + '"'))]; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' })); a.download = 'المعاملات.csv'; a.click(); return; }
  if (e.target.closest('#btnImp')) { $('#fileImport').click(); return; }
  if (e.target.closest('#btnReset')) { if (confirm('سيتم تصفير البيانات المحلية فقط. لن يتم حذف أي شيء من Google Sheets. هل تريد المتابعة؟')) { S = seed(); save(); loadDataFromGoogle(); render(); } }
});

document.addEventListener('change', e => {
  const x = e.target;
  if (x.id === 'recType') {
    populateRecurringCategories(x.value, x.value === 'دخل' ? 'دخل' : 'الأساسيات');
    return;
  }
  if (x.id === 'fy') { S.ui.y = +x.value; save(); render(); return; }
  if (x.id === 'fm') { S.ui.m = x.value; save(); render(); return; }
  if (x.dataset.s) { const r = S[x.dataset.s][x.dataset.i]; const k = x.dataset.k; r[k] = x.type === 'checkbox' ? (x.checked ? 1 : 0) : x.type === 'number' ? +x.value : x.value; if (x.dataset.s === 'prices' && k === 'price' && !r.date) r.date = localISODate(); save(); if (x.dataset.s === 'accounts' || x.dataset.s === 'prices') scheduleSharedSettingsSync(); render(); return; }
  if (x.dataset.b) { S.budget[x.dataset.b] = (+x.value || 0) / 100; save(); scheduleSharedSettingsSync(); render(); return; }
  if (x.dataset.w) { S.warn = (+x.value || 90) / 100; save(); scheduleSharedSettingsSync(); render(); return; }
  if (x.id === 'fxEffectiveDate') {
    if (!isValidISODate(x.value)) { alert('اختار تاريخًا صحيحًا لتطبيق سعر الصرف.'); render(); return; }
    S.ui.fxDate = x.value;
    save();
    render();
    return;
  }
  if (x.dataset.r) {
    const rate = Number(x.value);
    const effectiveDate = isValidISODate(S.ui.fxDate) ? S.ui.fxDate : localISODate();
    if (!Number.isFinite(rate) || rate <= 0) { alert('سعر الصرف يجب أن يكون رقماً أكبر من صفر.'); render(); return; }
    if (effectiveDate < localISODate() && !confirm('أنت تعدّل سعر صرف بتاريخ سابق. سيتم إعادة حساب المعاملات من هذا التاريخ حتى سجل السعر التالي. هل تريد المتابعة؟')) { render(); return; }
    if (!recordHistoricalRate(x.dataset.r, rate, effectiveDate)) {
      showAppToast('السعر مطابق بالفعل للسعر المحفوظ في هذا التاريخ.', 4000);
      render();
      return;
    }
    const sharedSyncReady = cloudSettingsInitialized;
    save();
    scheduleSharedSettingsSync();
    render();
    showAppToast(
      sharedSyncReady
        ? 'تم حفظ سعر الصرف التاريخي. جارٍ مزامنة الإعدادات بين أجهزتك.'
        : 'تم حفظ سعر الصرف على هذا الجهاز. لم تُهيّأ مزامنة الإعدادات المشتركة بعد؛ افتح الإعدادات وارفعها من الجهاز الأساسي.',
      6500
    );
    return;
  }
  if (x.id === 'fileImport') {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d || typeof d !== 'object' || !Array.isArray(d.tx) || !Array.isArray(d.accounts)) throw new Error('بنية الملف غير صحيحة');
        const importedData = { ...d };
        delete importedData.backupMeta;
        S = normalizeState(importedData);
        save(); scheduleSharedSettingsSync(); render();
      } catch (_) { alert('الملف غير صالح'); }
    };
    r.readAsText(x.files[0]);
  }
  if (x.closest('#formTx')) updateTxFxPreview();
  if (x.closest('#formTransfer')) updateTransferPreview();
});

document.addEventListener('input', e => {
  if (e.target.id === 'q') {
    S.ui.q = e.target.value;
    const p = e.target.selectionStart;
    render();
    const q = $('#q');
    if (q) { q.focus(); q.setSelectionRange(p, p); }
  }
  if (e.target.closest('#formTx')) updateTxFxPreview();
  if (e.target.closest('#formTransfer')) updateTransferPreview();
  if (e.target.closest('#formGoal')) updateGoalPlanPreview();
});

if (S.ui.theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
else document.documentElement.setAttribute('data-theme', 'light');

render();

(async function initializeCloudData() {
  // Load settings before transactions, then load planner tasks from their dedicated sheet.
  await loadSharedSettingsFromGoogle({ renderAfter: false });
  await loadDataFromGoogle({ renderAfter: false });
  await loadPlannerTasksFromGoogle({ renderAfter: false });
  render();
  checkRecurringReminders();

  // A one-time, dismissible reminder. Detailed sync status remains in Settings.
  if (!cloudSettingsInitialized) {
    showAppToast(
      'إعدادات الحسابات وأسعار الصرف والميزانية لم يتم تأكيد مزامنتها بعد. افتح الإعدادات، ثم ارفعها من الجهاز الأساسي.',
      15000
    );
  }
})();

// Reload shared settings and transactions while the page stays open.
setInterval(async () => {
  if (document.visibilityState !== 'visible') return;
  await loadSharedSettingsFromGoogle({ renderAfter: false });
  await loadDataFromGoogle({ renderAfter: false });

  const plannerFormHasFocus = $('#plannerTaskForm') &&
    $('#plannerTaskForm').contains(document.activeElement);
  if (S.ui.tab === 'plan' && !plannerSaveInFlight && !plannerFormHasFocus) {
    await loadPlannerTasksFromGoogle({ renderAfter: false });
  }
  if (S.ui.tab !== 'plan' || !plannerFormHasFocus) render();
  checkRecurringReminders();
}, SHARED_SYNC_INTERVAL_MS);

// Refresh tasks every 15 seconds while the planner is open, without interrupting typing.
setInterval(() => {
  if (document.visibilityState !== 'visible' || S.ui.tab !== 'plan' ||
      plannerSaveInFlight || plannerLoadInFlight) return;
  const plannerFormHasFocus = $('#plannerTaskForm') &&
    $('#plannerTaskForm').contains(document.activeElement);
  if (!plannerFormHasFocus) loadPlannerTasksFromGoogle({ renderAfter: true });
}, 15000);

/* Smart personal planner: fixed commitments, recurring activities, conflict detection and week scheduling.
   Daily tasks remain isolated in the dedicated TASKS sheet; settings live in SYS_APP_SETTINGS. */

let plannerEditingActivityId = '';
let plannerGeneratedDraft = null;

const PLANNER_WEEK_DAYS = [
  { value: 6, label: 'السبت', short: 'سبت' },
  { value: 0, label: 'الأحد', short: 'أحد' },
  { value: 1, label: 'الإثنين', short: 'اثنين' },
  { value: 2, label: 'الثلاثاء', short: 'ثلاثاء' },
  { value: 3, label: 'الأربعاء', short: 'أربعاء' },
  { value: 4, label: 'الخميس', short: 'خميس' },
  { value: 5, label: 'الجمعة', short: 'جمعة' }
];
const PLANNER_CATEGORIES = ['القرآن', 'القراءة', 'التعلم', 'الجيم', 'الصلاة', 'الأكل', 'الراحة', 'صحة', 'شخصي', 'عائلة', 'عمل', 'أخرى'];
const PLANNER_PRIORITIES = ['عالية', 'متوسطة', 'منخفضة'];

function plannerWeekStart(value) {
  const date = new Date((isValidISODate(value) ? value : localISODate()) + 'T12:00:00');
  date.setDate(date.getDate() - ((date.getDay() + 1) % 7));
  return localISODate(date);
}

function plannerShiftDate(value, days) {
  const date = new Date((isValidISODate(value) ? value : localISODate()) + 'T12:00:00');
  date.setDate(date.getDate() + days);
  return localISODate(date);
}

function plannerFormatDate(value, options = { weekday: 'long', day: 'numeric', month: 'short' }) {
  if (!isValidISODate(value)) return value || '';
  return new Intl.DateTimeFormat('ar-EG', options).format(new Date(value + 'T12:00:00'));
}

function plannerDayOfWeek(value) {
  return new Date(value + 'T12:00:00').getDay();
}

function plannerRules() {
  const rules = S && S.plannerRules && typeof S.plannerRules === 'object' ? S.plannerRules : {};
  return {
    sleepStart: rules.sleepStart || '22:00',
    sleepEnd: rules.sleepEnd || '05:00',
    workStart: rules.workStart || '10:00',
    workEnd: rules.workEnd || '19:00',
    workDays: Array.isArray(rules.workDays) ? rules.workDays : [0, 1, 2, 3, 4, 6]
  };
}

function plannerTimeMinutes(value) {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

function plannerMinutesTime(value) {
  const minutes = Math.max(0, Math.min(1439, Math.round(value)));
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' +
    String(minutes % 60).padStart(2, '0');
}

function plannerTaskMinutes(task) {
  const start = plannerTimeMinutes(task.startTime);
  const end = plannerTimeMinutes(task.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return 0;
  return end > start ? end - start : (1440 - start) + end;
}

function plannerStatusLabel(status) {
  return ({
    todo: 'لم تبدأ',
    partial: 'قيد التنفيذ',
    done: 'مكتملة',
    postponed: 'مؤجلة',
    missed: 'لم تُنفذ'
  })[status] || 'لم تبدأ';
}

function plannerDurationLabel(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (!hours) return rest + ' دقيقة';
  return hours + ' ساعة' + (rest ? ' و ' + rest + ' دقيقة' : '');
}

function plannerNewId(prefix) {
  const random = globalThis.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11);
  return String(prefix || 'planner') + '-' + random;
}

function plannerTaskSegments(task) {
  const start = plannerTimeMinutes(task.startTime);
  const end = plannerTimeMinutes(task.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end || !isValidISODate(task.date)) return [];
  const absoluteEnd = end > start ? end : end + 1440;
  const result = [{
    date: task.date,
    start,
    end: Math.min(absoluteEnd, 1440),
    task
  }];
  if (absoluteEnd > 1440) {
    result.push({
      date: plannerShiftDate(task.date, 1),
      start: 0,
      end: absoluteEnd - 1440,
      task
    });
  }
  return result.filter(segment => segment.end > segment.start);
}

function plannerFixedBlocksForDate(date) {
  const rules = plannerRules();
  const sleepStart = plannerTimeMinutes(rules.sleepStart);
  const sleepEnd = plannerTimeMinutes(rules.sleepEnd);
  const blocks = [
    { id: 'sleep-before-dawn', title: 'النوم', type: 'sleep', start: 0, end: sleepEnd },
    { id: 'sleep-night', title: 'النوم', type: 'sleep', start: sleepStart, end: 1440 }
  ];
  if (rules.workDays.includes(plannerDayOfWeek(date))) {
    blocks.push({
      id: 'work',
      title: 'العمل',
      type: 'work',
      start: plannerTimeMinutes(rules.workStart),
      end: plannerTimeMinutes(rules.workEnd)
    });
  }
  return blocks.filter(block =>
    Number.isFinite(block.start) && Number.isFinite(block.end) && block.end > block.start
  );
}

function plannerFreeWindows(date) {
  const rules = plannerRules();
  const dayStart = plannerTimeMinutes(rules.sleepEnd);
  const dayEnd = plannerTimeMinutes(rules.sleepStart);
  if (!Number.isFinite(dayStart) || !Number.isFinite(dayEnd) || dayEnd <= dayStart) return [];
  const fixed = plannerFixedBlocksForDate(date)
    .filter(block => block.type !== 'sleep')
    .map(block => ({ start: Math.max(dayStart, block.start), end: Math.min(dayEnd, block.end) }))
    .filter(block => block.end > block.start)
    .sort((a, b) => a.start - b.start);
  const windows = [];
  let cursor = dayStart;
  fixed.forEach(block => {
    if (block.start > cursor) windows.push({ start: cursor, end: block.start });
    cursor = Math.max(cursor, block.end);
  });
  if (cursor < dayEnd) windows.push({ start: cursor, end: dayEnd });
  return windows.filter(window => window.end > window.start);
}

function plannerIntervalsOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function plannerTaskConflicts(task, ignoreId = '') {
  const conflicts = [];
  const segments = plannerTaskSegments(task);
  segments.forEach(segment => {
    plannerFixedBlocksForDate(segment.date).forEach(block => {
      if (plannerIntervalsOverlap(segment, block)) {
        conflicts.push({
          kind: 'fixed',
          date: segment.date,
          title: block.title,
          message: 'يتعارض مع ' + block.title + ' يوم ' + plannerFormatDate(segment.date, { weekday: 'long' })
        });
      }
    });
  });

  (Array.isArray(S.plannerTasks) ? S.plannerTasks : []).forEach(other => {
    if (!other || String(other.id) === String(ignoreId || task.id || '')) return;
    const otherSegments = plannerTaskSegments(other);
    segments.forEach(segment => otherSegments.forEach(otherSegment => {
      if (segment.date === otherSegment.date && plannerIntervalsOverlap(segment, otherSegment)) {
        conflicts.push({
          kind: 'task',
          date: segment.date,
          title: other.title,
          message: 'يتداخل مع مهمة «' + other.title + '»'
        });
      }
    }));
  });
  return conflicts;
}

function plannerTaskHasConflict(task) {
  return plannerTaskConflicts(task).length > 0;
}

function plannerCanEdit() {
  return Boolean(plannerCloudInitialized && cloudPlannerSupported && !plannerSaveInFlight && !plannerLoadInFlight);
}

function plannerStatusNotice() {
  if (!cloudPlannerSupported) {
    return '<div class="planner-sync-notice is-warning"><i class="bi bi-cloud-slash"></i><div><strong>مزامنة المهام غير جاهزة</strong><p>' +
      esc(plannerCloudStatus || 'انشر إصدار Apps Script الداعم لورقة TASKS قبل تعديل المهام.') +
      '</p></div><button class="btn btn-sm btn-outline-primary" type="button" id="btnPlannerSync">إعادة المحاولة</button></div>';
  }
  if (!plannerCloudInitialized) {
    return '<div class="planner-sync-notice is-warning"><i class="bi bi-cloud-arrow-down"></i><div><strong>جارٍ تحميل الجدول</strong><p>' +
      esc(plannerCloudStatus || 'بيتم تحميل مهامك من ورقة TASKS.') +
      '</p></div><button class="btn btn-sm btn-outline-primary" type="button" id="btnPlannerSync">مزامنة الآن</button></div>';
  }
  return '<div class="planner-sync-notice"><i class="bi bi-cloud-check"></i><div><strong>المهام متزامنة مع Google Sheets</strong><p>آخر تحديث: ' +
    esc(plannerCloudLastUpdated || 'تم الاتصال') +
    ' · المهام منفصلة تمامًا عن السجلات المالية.</p></div><button class="btn btn-sm btn-outline-primary" type="button" id="btnPlannerSync">مزامنة الآن</button></div>';
}

function plannerSettingsNotice() {
  if (!cloudSettingsInitialized) {
    return '<p class="planner-muted-note"><i class="bi bi-info-circle"></i> مزامنة قواعد الروتين والأنشطة المتكررة تحتاج تهيئة الإعدادات المشتركة من قسم الإعدادات أولًا.</p>';
  }
  return '';
}

function plannerWeekMetrics(weekDates, tasks) {
  const freeMinutes = weekDates.reduce((sum, date) =>
    sum + plannerFreeWindows(date).reduce((daySum, window) => daySum + window.end - window.start, 0), 0);
  const plannedMinutes = tasks.reduce((sum, task) => sum + plannerTaskMinutes(task), 0);
  const completed = tasks.filter(task => task.status === 'done').length;
  const inProgress = tasks.filter(task => task.status === 'partial').length;
  const postponed = tasks.filter(task => task.status === 'postponed').length;
  const missed = tasks.filter(task => task.status === 'missed').length;
  const conflicts = tasks.filter(task => plannerTaskHasConflict(task)).length;
  return {
    freeMinutes,
    plannedMinutes,
    remainingMinutes: Math.max(0, freeMinutes - plannedMinutes),
    completed,
    inProgress,
    postponed,
    missed,
    conflicts,
    completionRate: tasks.length ? Math.round(completed / tasks.length * 100) : 0
  };
}

function plannerTaskForDateSegments(date) {
  const previousDate = plannerShiftDate(date, -1);
  const all = Array.isArray(S.plannerTasks) ? S.plannerTasks : [];
  return all.filter(task => task.date === date || task.date === previousDate)
    .flatMap(task => plannerTaskSegments(task).filter(segment => segment.date === date));
}

function plannerRenderDayTimeline(date) {
  const rules = plannerRules();
  const start = plannerTimeMinutes(rules.sleepEnd);
  const end = plannerTimeMinutes(rules.sleepStart);
  const work = plannerFixedBlocksForDate(date).find(block => block.type === 'work');
  const taskSegments = plannerTaskForDateSegments(date);
  const points = new Set([start, end]);
  if (work) {
    points.add(Math.max(start, work.start));
    points.add(Math.min(end, work.end));
  }
  taskSegments.forEach(segment => {
    points.add(Math.max(start, segment.start));
    points.add(Math.min(end, segment.end));
  });
  const sorted = [...points].filter(point => point >= start && point <= end).sort((a, b) => a - b);
  const segments = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    if (to <= from) continue;
    const activeTasks = taskSegments.filter(segment => segment.start < to && segment.end > from);
    if (activeTasks.length) {
      activeTasks.forEach(segment => segments.push({
        type: plannerTaskHasConflict(segment.task) ? 'conflict' : 'task',
        start: from,
        end: to,
        title: segment.task.title,
        task: segment.task
      }));
    } else if (work && work.start < to && work.end > from) {
      segments.push({ type: 'work', start: from, end: to, title: 'العمل' });
    } else {
      segments.push({ type: 'free', start: from, end: to, title: 'وقت متاح' });
    }
  }
  if (!segments.length) {
    return '<div class="planner-empty-slot">لا توجد فترة إنتاجية متاحة وفق القواعد الحالية.</div>';
  }
  return segments.map(segment => {
    const duration = segment.end - segment.start;
    const task = segment.task;
    const time = plannerMinutesTime(segment.start) + ' – ' + plannerMinutesTime(segment.end);
    if (segment.type === 'task' || segment.type === 'conflict') {
      return '<div class="planner-timeline-segment is-task ' + (segment.type === 'conflict' ? 'has-conflict' : '') + '">' +
        '<span class="planner-timeline-time">' + esc(time) + '</span><div><strong>' + esc(segment.title) + '</strong>' +
        '<small>' + esc(task ? task.category : '') + ' · ' + esc(plannerDurationLabel(duration)) + '</small></div>' +
        (segment.type === 'conflict' ? '<span class="planner-conflict-mark"><i class="bi bi-exclamation-triangle"></i> تعارض</span>' : '') +
        '</div>';
    }
    if (segment.type === 'work') {
      return '<div class="planner-timeline-segment is-work"><span class="planner-timeline-time">' + esc(time) +
        '</span><div><strong>العمل</strong><small>' + esc(plannerDurationLabel(duration)) + ' · التزام ثابت</small></div></div>';
    }
    return '<div class="planner-timeline-segment is-free"><span class="planner-timeline-time">' + esc(time) +
      '</span><div><strong>وقت متاح</strong><small>' + esc(plannerDurationLabel(duration)) + ' · يمكن تخصيصه لنشاط</small></div></div>';
  }).join('');
}

function plannerRenderTaskCard(task, canEdit) {
  const conflicts = plannerTaskConflicts(task);
  const conflict = conflicts.length > 0;
  return '<article class="planner-task-row ' + (task.status === 'done' ? 'is-done' : '') + (conflict ? ' has-conflict' : '') + '">' +
    '<div class="planner-task-row-main"><span class="planner-task-row-time">' + esc(task.startTime) + ' – ' + esc(task.endTime) + '</span>' +
    '<strong>' + esc(task.title) + '</strong><small>' + esc(task.category) + ' · ' + esc(plannerDurationLabel(plannerTaskMinutes(task))) +
    ' · أولوية ' + esc(task.priority) + ' · الحالة: ' + esc(plannerStatusLabel(task.status)) + '</small>' +
    (conflict ? '<em><i class="bi bi-exclamation-triangle"></i> ' + esc(conflicts[0].message) + '</em>' : '') +
    '</div><div class="planner-task-row-actions">' +
    '<select class="form-select form-select-sm planner-task-status" aria-label="حالة تنفيذ المهمة" data-planner-status="' + esc(task.id) + '" ' + (!canEdit ? 'disabled' : '') + '>' +
    [['todo','لم تبدأ'],['partial','قيد التنفيذ'],['done','مكتملة'],['postponed','مؤجلة'],['missed','لم تُنفذ']].map(([value,label]) =>
      '<option value="' + value + '" ' + (task.status === value ? 'selected' : '') + '>' + label + '</option>'
    ).join('') + '</select>' +
    '<button class="btn btn-sm btn-outline-primary" type="button" data-planner-edit="' + esc(task.id) +
    '" ' + (!canEdit ? 'disabled' : '') + ' aria-label="تعديل المهمة"><i class="bi bi-pencil"></i></button>' +
    '<button class="btn btn-sm btn-outline-danger" type="button" data-planner-delete="' + esc(task.id) +
    '" ' + (!canEdit ? 'disabled' : '') + ' aria-label="حذف المهمة"><i class="bi bi-trash"></i></button></div></article>';
}

function plannerRenderActivityCard(activity, canManage) {
  const days = (activity.daysOfWeek || []).length
    ? PLANNER_WEEK_DAYS.filter(day => activity.daysOfWeek.includes(day.value)).map(day => day.short).join('، ')
    : 'كل أيام الأسبوع';
  const period = activity.preferredPeriod === 'morning' ? 'الصباح' :
    activity.preferredPeriod === 'evening' ? 'المساء' : 'مرن';
  return '<article class="planner-activity-card ' + (activity.active === false ? 'is-inactive' : '') + '">' +
    '<div class="planner-activity-card-main"><span class="planner-activity-icon"><i class="bi bi-repeat"></i></span>' +
    '<div><strong>' + esc(activity.title) + '</strong><small>' + esc(activity.category) + ' · ' +
    esc(plannerDurationLabel(activity.durationMinutes)) + ' · ' + Number(activity.sessionsPerWeek || 1) + ' مرة أسبوعيًا</small>' +
    '<small>' + esc(days) + ' · الفترة المفضلة: ' + esc(period) + '</small></div></div>' +
    '<div class="planner-activity-actions"><span class="planner-priority priority-' +
    (activity.priority === 'عالية' ? 'high' : activity.priority === 'منخفضة' ? 'low' : 'normal') + '">' + esc(activity.priority) + '</span>' +
    '<button type="button" class="btn btn-sm btn-outline-primary" data-planner-activity-edit="' + esc(activity.id) +
    '" ' + (!canManage ? 'disabled' : '') + '><i class="bi bi-pencil"></i></button>' +
    '<button type="button" class="btn btn-sm btn-outline-secondary" data-planner-activity-toggle="' + esc(activity.id) +
    '" ' + (!canManage ? 'disabled' : '') + '>' + (activity.active === false ? 'تفعيل' : 'إيقاف') + '</button>' +
    '<button type="button" class="btn btn-sm btn-outline-danger" data-planner-activity-delete="' + esc(activity.id) +
    '" ' + (!canManage ? 'disabled' : '') + ' aria-label="حذف النشاط"><i class="bi bi-trash"></i></button></div></article>';
}

function plannerRenderDraft() {
  if (!plannerGeneratedDraft) return '';
  const tasks = plannerGeneratedDraft.tasks || [];
  const missed = plannerGeneratedDraft.unplaced || [];
  return '<section class="planner-draft-panel"><div class="planner-draft-heading"><div><span class="planner-eyebrow-dark">اقتراح المحرك</span>' +
    '<h3>توزيع مقترح للأسبوع</h3><p>دي معاينة فقط. لن تُحفظ أي مهمة في Google Sheets إلا بعد اعتمادك.</p></div>' +
    '<div class="planner-draft-count"><strong>' + tasks.length + '</strong><span>موعد قابل للتوزيع</span></div></div>' +
    (tasks.length ? '<div class="planner-draft-list">' + tasks.map(task =>
      '<div><span>' + esc(plannerFormatDate(task.date, { weekday: 'long', day: 'numeric', month: 'short' })) + '</span>' +
      '<strong>' + esc(task.startTime + ' – ' + task.endTime) + '</strong><span>' + esc(task.title) + '</span></div>'
    ).join('') + '</div>' : '<p class="planner-muted-note">لم يجد المحرك موعدًا جديدًا قابلًا للتوزيع. راجع مدة الأنشطة أو أوقاتك المتاحة.</p>') +
    (missed.length ? '<div class="planner-unplaced"><strong>أنشطة لم تجد وقتًا مناسبًا (' + missed.length + ')</strong>' +
      missed.map(item => '<p>' + esc(item.title) + ': ' + esc(item.reason) + '</p>').join('') + '</div>' : '') +
    '<div class="planner-draft-actions"><button type="button" class="btn btn-primary" id="btnPlannerSaveDraft" ' +
    (!plannerCanEdit() || !tasks.length ? 'disabled' : '') + '><i class="bi bi-check2-circle"></i> اعتماد وحفظ التوزيع</button>' +
    '<button type="button" class="btn btn-outline-secondary" id="btnPlannerClearDraft">إلغاء المعاينة</button></div></section>';
}

function plannerDayCard(date, tasks, canEdit) {
  const dayTasks = tasks.filter(task => task.date === date);
  const dayMinutes = dayTasks.reduce((sum, task) => sum + plannerTaskMinutes(task), 0);
  const conflicts = dayTasks.filter(task => plannerTaskHasConflict(task)).length;
  const done = dayTasks.filter(task => task.status === 'done').length;
  const isToday = date === localISODate();
  return '<section class="planner-day-card ' + (isToday ? 'is-today' : '') + '">' +
    '<header class="planner-day-header"><div><strong>' + esc(plannerFormatDate(date, { weekday: 'long' })) +
    '</strong><span>' + esc(plannerFormatDate(date, { day: 'numeric', month: 'short' })) + '</span></div>' +
    '<div class="planner-day-summary"><strong>' + esc(plannerDurationLabel(dayMinutes)) + '</strong><small>' +
    done + '/' + dayTasks.length + ' منجز' + (conflicts ? ' · ' + conflicts + ' تعارض' : '') +
    '</small></div></header><div class="planner-day-timeline">' + plannerRenderDayTimeline(date) + '</div>' +
    '<div class="planner-day-task-list">' +
    (dayTasks.length ? dayTasks.map(task => plannerRenderTaskCard(task, canEdit)).join('') :
      '<p class="planner-day-empty">لا توجد مهام مسجلة في هذا اليوم.</p>') +
    '</div></section>';
}

function vPlanner() {
  const anchor = isValidISODate(S.ui.plannerDate) ? S.ui.plannerDate : localISODate();
  const weekStart = plannerWeekStart(anchor);
  const weekDates = Array.from({ length: 7 }, (_, index) => plannerShiftDate(weekStart, index));
  const weekTasks = (Array.isArray(S.plannerTasks) ? S.plannerTasks : [])
    .filter(task => weekDates.includes(task.date))
    .sort((a, b) => a.date.localeCompare(b.date) ||
      plannerTimeMinutes(a.startTime) - plannerTimeMinutes(b.startTime) ||
      a.title.localeCompare(b.title, 'ar'));
  const metrics = plannerWeekMetrics(weekDates, weekTasks);
  const canEdit = plannerCanEdit();
  const canManageSettings = Boolean(cloudSettingsInitialized && !cloudSettingsSyncInFlight);
  const editingTask = plannerEditingTaskId
    ? (S.plannerTasks || []).find(task => task.id === plannerEditingTaskId)
    : null;
  const editingActivity = plannerEditingActivityId
    ? (S.plannerActivities || []).find(item => item.id === plannerEditingActivityId)
    : null;
  const rules = plannerRules();
  const activities = Array.isArray(S.plannerActivities) ? S.plannerActivities : [];
  const weekLabel = plannerFormatDate(weekStart, { day: 'numeric', month: 'long' }) +
    ' — ' + plannerFormatDate(weekDates[6], { day: 'numeric', month: 'long', year: 'numeric' });
  const daysHtml = PLANNER_WEEK_DAYS.map(day =>
    '<label class="planner-day-check"><input type="checkbox" name="workDays" value="' + day.value + '" ' +
    (rules.workDays.includes(day.value) ? 'checked' : '') + ' ' + (!canManageSettings ? 'disabled' : '') +
    '><span>' + day.label + '</span></label>'
  ).join('');
  const activityDaysHtml = PLANNER_WEEK_DAYS.map(day =>
    '<label class="planner-day-check"><input type="checkbox" name="activityDays" value="' + day.value + '" ' +
    ((editingActivity ? editingActivity.daysOfWeek : [6, 0, 1, 2, 3, 4, 5]).includes(day.value) ? 'checked' : '') +
    ' ' + (!canManageSettings ? 'disabled' : '') + '><span>' + day.short + '</span></label>'
  ).join('');
  const taskCategories = PLANNER_CATEGORIES.map(value =>
    '<option value="' + esc(value) + '" ' + ((editingTask ? editingTask.category : 'شخصي') === value ? 'selected' : '') + '>' +
    esc(value) + '</option>'
  ).join('');
  const activityCategories = PLANNER_CATEGORIES.map(value =>
    '<option value="' + esc(value) + '" ' + ((editingActivity ? editingActivity.category : 'التعلم') === value ? 'selected' : '') + '>' +
    esc(value) + '</option>'
  ).join('');
  const activitiesHtml = activities.length
    ? activities.map(activity => plannerRenderActivityCard(activity, canManageSettings)).join('')
    : '<div class="planner-empty-state"><i class="bi bi-repeat"></i><strong>لسه مفيش أنشطة متكررة</strong><p>أضف العادات والأنشطة اللي عايز تلتزم بيها، ومحرك التخطيط هيوزعها على أوقاتك المتاحة.</p></div>';

  return '<section class="planner-page">' +
    '<div class="planner-hero"><div><span class="planner-eyebrow"><i class="bi bi-calendar2-check"></i> تنظيم الوقت والتنفيذ</span>' +
    '<h2>مخطط الحياة الشخصي</h2><p>قواعد ثابتة تحمي وقتك، وأنشطة متكررة تتوزع تلقائيًا، ومتابعة فعلية لمدى التزامك.</p></div>' +
    '<div class="planner-week-nav"><button type="button" class="btn btn-light" id="btnPlannerPrev" aria-label="الأسبوع السابق"><i class="bi bi-chevron-right"></i></button>' +
    '<div><strong>' + esc(weekLabel) + '</strong><label for="plannerAnchorDate">انتقل إلى أسبوع</label>' +
    '<input type="date" id="plannerAnchorDate" value="' + esc(anchor) + '" class="form-control form-control-sm"></div>' +
    '<button type="button" class="btn btn-light" id="btnPlannerNext" aria-label="الأسبوع التالي"><i class="bi bi-chevron-left"></i></button></div></div>' +
    plannerStatusNotice() +
    '<div class="planner-kpis planner-kpis-smart">' +
    '<article><span>الوقت المتاح</span><strong>' + esc(plannerDurationLabel(metrics.freeMinutes)) + '</strong><small>بعد خصم النوم والعمل</small></article>' +
    '<article><span>وقت مجدول</span><strong>' + esc(plannerDurationLabel(metrics.plannedMinutes)) + '</strong><small>' + weekTasks.length + ' نشاط أو مهمة</small></article>' +
    '<article><span>وقت غير مخصص</span><strong>' + esc(plannerDurationLabel(metrics.remainingMinutes)) + '</strong><small>مساحة للراحة والمرونة</small></article>' +
    '<article><span>معدل الإنجاز</span><strong>' + metrics.completionRate + '%</strong><small>' + metrics.completed + ' من ' + weekTasks.length + ' مهمة</small></article>' +
    '<article class="' + (metrics.conflicts ? 'has-warning' : '') + '"><span>تعارضات</span><strong>' + metrics.conflicts + '</strong><small>' +
    (metrics.conflicts ? 'تحتاج إلى مراجعة' : 'لا توجد تعارضات مكتشفة') + '</small></article></div>' +
    '<div class="planner-execution-summary"><span>مكتملة <strong>' + metrics.completed + '</strong></span>' +
    '<span>قيد التنفيذ <strong>' + metrics.inProgress + '</strong></span>' +
    '<span>مؤجلة <strong>' + metrics.postponed + '</strong></span>' +
    '<span>لم تُنفذ <strong>' + metrics.missed + '</strong></span></div>' +

    '<section class="planner-section-panel"><div class="planner-section-heading"><div><span class="planner-section-kicker">01 · القواعد الثابتة</span>' +
    '<h3>التزاماتك الأساسية</h3><p>المحرك يعتبر النوم والعمل وقتًا محجوزًا ولا يضع أي نشاط فوقهما.</p></div><span class="planner-section-icon"><i class="bi bi-shield-lock"></i></span></div>' +
    '<form id="plannerRulesForm" class="planner-rules-form"><div class="planner-rule-fields">' +
    '<label>بداية النوم<input class="form-control" name="sleepStart" type="time" required value="' + esc(rules.sleepStart) + '" ' + (!canManageSettings ? 'disabled' : '') + '></label>' +
    '<label>نهاية النوم<input class="form-control" name="sleepEnd" type="time" required value="' + esc(rules.sleepEnd) + '" ' + (!canManageSettings ? 'disabled' : '') + '></label>' +
    '<label>بداية العمل<input class="form-control" name="workStart" type="time" required value="' + esc(rules.workStart) + '" ' + (!canManageSettings ? 'disabled' : '') + '></label>' +
    '<label>نهاية العمل<input class="form-control" name="workEnd" type="time" required value="' + esc(rules.workEnd) + '" ' + (!canManageSettings ? 'disabled' : '') + '></label></div>' +
    '<div class="planner-days-field"><strong>أيام العمل</strong><div class="planner-day-checks">' + daysHtml + '</div></div>' +
    '<div class="planner-inline-actions"><button type="submit" class="btn btn-primary" ' + (!canManageSettings ? 'disabled' : '') + '>حفظ قواعد الوقت</button>' +
    '<span>يوم الجمعة متاح بالكامل افتراضيًا، مع استمرار حجز النوم.</span></div>' +
    plannerSettingsNotice() + '</form></section>' +

    '<section class="planner-section-panel"><div class="planner-section-heading"><div><span class="planner-section-kicker">02 · الأنشطة المتكررة</span>' +
    '<h3>العادات والأهداف الأسبوعية</h3><p>حدد مدة النشاط وعدد مرات تكراره والأيام والفترة المفضلة والأولوية.</p></div><span class="planner-section-icon"><i class="bi bi-repeat"></i></span></div>' +
    '<div class="planner-activity-list">' + activitiesHtml + '</div>' +
    '<form id="plannerActivityForm" class="planner-editor-form"><input type="hidden" name="id" value="' + esc(editingActivity ? editingActivity.id : '') + '">' +
    '<div class="planner-editor-title"><strong>' + (editingActivity ? 'تعديل النشاط المتكرر' : 'إضافة نشاط متكرر') + '</strong>' +
    (editingActivity ? '<button type="button" class="btn btn-sm btn-outline-secondary" id="btnPlannerCancelActivityEdit">إلغاء</button>' : '') + '</div>' +
    '<div class="planner-editor-grid"><label>اسم النشاط<input class="form-control" name="title" maxlength="100" required placeholder="مثال: قراءة كتاب" value="' + esc(editingActivity ? editingActivity.title : '') + '" ' + (!canManageSettings ? 'disabled' : '') + '></label>' +
    '<label>التصنيف<select class="form-select" name="category" ' + (!canManageSettings ? 'disabled' : '') + '>' + activityCategories + '</select></label>' +
    '<label>مدة الجلسة بالدقائق<input class="form-control" name="durationMinutes" type="number" min="15" max="360" step="15" required value="' + esc(editingActivity ? editingActivity.durationMinutes : 45) + '" ' + (!canManageSettings ? 'disabled' : '') + '></label>' +
    '<label>مرات أسبوعيًا<input class="form-control" name="sessionsPerWeek" type="number" min="1" max="7" step="1" required value="' + esc(editingActivity ? editingActivity.sessionsPerWeek : 3) + '" ' + (!canManageSettings ? 'disabled' : '') + '></label>' +
    '<label>الفترة المفضلة<select class="form-select" name="preferredPeriod" ' + (!canManageSettings ? 'disabled' : '') + '>' +
    '<option value="morning" ' + ((editingActivity ? editingActivity.preferredPeriod : 'morning') === 'morning' ? 'selected' : '') + '>الصباح</option>' +
    '<option value="evening" ' + ((editingActivity ? editingActivity.preferredPeriod : 'morning') === 'evening' ? 'selected' : '') + '>المساء</option>' +
    '<option value="any" ' + ((editingActivity ? editingActivity.preferredPeriod : 'morning') === 'any' ? 'selected' : '') + '>أي وقت مناسب</option></select></label>' +
    '<label>الأولوية<select class="form-select" name="priority" ' + (!canManageSettings ? 'disabled' : '') + '>' +
    PLANNER_PRIORITIES.map(value => '<option value="' + value + '" ' + ((editingActivity ? editingActivity.priority : 'متوسطة') === value ? 'selected' : '') + '>' + value + '</option>').join('') + '</select></label></div>' +
    '<div class="planner-days-field"><strong>الأيام المناسبة للنشاط</strong><div class="planner-day-checks">' + activityDaysHtml + '</div></div>' +
    '<div class="planner-inline-actions"><button type="submit" class="btn btn-primary" ' + (!canManageSettings ? 'disabled' : '') + '>' +
    (editingActivity ? 'حفظ التعديلات' : 'إضافة إلى الأنشطة') + '</button><span>المحرك يوزع الجلسات على أيام مختارة قدر الإمكان دون تداخل.</span></div></form></section>' +

    '<section class="planner-engine-panel"><div><span class="planner-section-kicker">03 · محرك الجدولة</span><h3>ابنِ جدول أسبوعك تلقائيًا</h3>' +
    '<p>المحرك يبدأ بالأعلى أولوية، يحسب الفترات الحرة فعليًا، يحترم مدة كل جلسة، ويتجنب المهام الموجودة بالفعل.</p></div>' +
    '<button type="button" class="btn btn-light" id="btnPlannerGenerate"><i class="bi bi-magic"></i> إنشاء اقتراح أسبوعي</button></section>' +
    plannerRenderDraft() +

    '<div class="planner-section-heading planner-week-title"><div><span class="planner-section-kicker">04 · الخطة والتنفيذ</span>' +
    '<h3>الجدول الأسبوعي</h3><p>الأشرطة الزمنية توضح وقت العمل والوقت المتاح والمهام المسجلة.</p></div>' +
    '<span class="planner-total-pill">' + weekTasks.length + ' مهمة مسجلة</span></div>' +
    '<div class="planner-week-grid planner-week-grid-smart">' + weekDates.map(date => plannerDayCard(date, weekTasks, canEdit)).join('') + '</div>' +

    '<section class="planner-section-panel planner-oneoff-panel"><div class="planner-section-heading"><div><span class="planner-section-kicker">05 · مهام استثنائية</span>' +
    '<h3>' + (editingTask ? 'تعديل مهمة لمرة واحدة' : 'إضافة مهمة لمرة واحدة') + '</h3><p>للمواعيد غير المتكررة. سيتم رفض الحفظ عند تداخل المهمة مع النوم أو العمل أو مهمة أخرى.</p></div>' +
    '<span class="planner-section-icon"><i class="bi bi-calendar-plus"></i></span></div>' +
    '<form id="plannerTaskForm"><input type="hidden" name="id" value="' + esc(editingTask ? editingTask.id : '') + '">' +
    '<div class="planner-editor-grid"><label>اسم المهمة<input class="form-control" name="title" maxlength="120" required placeholder="مثال: موعد طبي أو مشوار" value="' + esc(editingTask ? editingTask.title : '') + '" ' + (!canEdit ? 'disabled' : '') + '></label>' +
    '<label>التاريخ<input class="form-control" name="date" type="date" required value="' + esc(editingTask ? editingTask.date : anchor) + '" ' + (!canEdit ? 'disabled' : '') + '></label>' +
    '<label>التصنيف<select class="form-select" name="category" ' + (!canEdit ? 'disabled' : '') + '>' + taskCategories + '</select></label>' +
    '<label>من الساعة<input class="form-control" name="startTime" type="time" required value="' + esc(editingTask ? editingTask.startTime : '07:00') + '" ' + (!canEdit ? 'disabled' : '') + '></label>' +
    '<label>إلى الساعة<input class="form-control" name="endTime" type="time" required value="' + esc(editingTask ? editingTask.endTime : '08:00') + '" ' + (!canEdit ? 'disabled' : '') + '></label>' +
    '<label>الأولوية<select class="form-select" name="priority" ' + (!canEdit ? 'disabled' : '') + '>' +
    PLANNER_PRIORITIES.map(value => '<option value="' + value + '" ' + ((editingTask ? editingTask.priority : 'متوسطة') === value ? 'selected' : '') + '>' + value + '</option>').join('') + '</select></label>' +
    '<label class="planner-editor-wide">ملاحظات<input class="form-control" name="note" maxlength="500" placeholder="تفاصيل إضافية (اختياري)" value="' + esc(editingTask ? editingTask.note : '') + '" ' + (!canEdit ? 'disabled' : '') + '></label></div>' +
    '<p class="planner-form-error" id="plannerFormError" role="alert" hidden></p>' +
    '<div class="planner-inline-actions"><button class="btn btn-primary" type="submit" ' + (!canEdit ? 'disabled' : '') + '>' +
    (editingTask ? 'حفظ التعديل' : 'إضافة المهمة') + '</button>' +
    (editingTask ? '<button type="button" class="btn btn-outline-secondary" id="btnPlannerCancelEdit">إلغاء التعديل</button>' : '') +
    '<span>المهام لا تنشئ معاملات مالية ولا تؤثر على أرصدة الحسابات.</span></div></form></section></section>';
}

async function loadPlannerTasksFromGoogle({ renderAfter = true, manual = false } = {}) {
  if (plannerLoadInFlight) return false;
  plannerLoadInFlight = true;
  try {
    const response = await fetch(API_URL + '?action=tasks&_=' + Date.now(), {
      method: 'GET',
      cache: 'no-store'
    });
    if (!response.ok) throw new Error('Google Sheets HTTP ' + response.status);
    const result = await response.json();
    if (!result || result.success === false ||
        !Array.isArray(result.tasks) || !Array.isArray(result.deletedIds)) {
      throw new Error(
        'إصدار Apps Script الحالي لا يدعم action=tasks. حدّث apps-script/Code.gs وانشر إصدارًا جديدًا؛ لم يتم تغيير البيانات المالية.'
      );
    }

    const remoteTasks = normalizeState({ ...S, plannerTasks: result.tasks }).plannerTasks;
    const remoteIds = new Set(remoteTasks.map(task => String(task.id)));
    const deletedIds = new Set(result.deletedIds.map(String));
    const priorBaselineIds = new Set(plannerLegacyBaselineTasks.map(task => String(task && task.id || '')));
    const localTasks = Array.isArray(S.plannerTasks) ? S.plannerTasks : [];
    const localOnly = localTasks.filter(task =>
      task && task.id &&
      !remoteIds.has(String(task.id)) &&
      !deletedIds.has(String(task.id)) &&
      !priorBaselineIds.has(String(task.id))
    );

    const recoveredLocalTasks = [];
    for (const task of localOnly) {
      try {
        const saved = await postGooglePayload({
          action: 'savetask',
          task,
          expectedUpdatedAt: ''
        });
        if (saved && saved.task) {
          const normalized = normalizeState({ ...S, plannerTasks: [saved.task] }).plannerTasks[0];
          if (normalized) recoveredLocalTasks.push(normalized);
          remoteIds.add(String(saved.task.id));
        }
      } catch (migrationError) {
        console.warn('تعذر ترحيل مهمة محلية إلى TASKS:', migrationError);
      }
    }

    const mergedTasks = [...remoteTasks];
    recoveredLocalTasks.forEach(task => {
      if (!mergedTasks.some(item => item.id === task.id)) mergedTasks.push(task);
    });
    S.plannerTasks = normalizeState({ ...S, plannerTasks: mergedTasks }).plannerTasks;
    plannerDeletedIds = deletedIds;
    save();
    cloudPlannerSupported = true;
    plannerCloudInitialized = true;
    plannerCloudStatus = 'تم تحميل المهام من ورقة TASKS';
    plannerCloudLastUpdated = new Date().toLocaleTimeString('ar-EG', {
      hour: '2-digit',
      minute: '2-digit'
    });
    return true;
  } catch (error) {
    cloudPlannerSupported = false;
    plannerCloudInitialized = false;
    plannerCloudStatus = error && error.message ? error.message : 'تعذّر الاتصال بورقة TASKS.';
    console.error('تعذر تحميل المهام من TASKS:', error);
    if (manual) showAppToast(plannerCloudStatus, 6500);
    return false;
  } finally {
    plannerLoadInFlight = false;
    const plannerFormHasFocus = $('#plannerTaskForm') &&
      $('#plannerTaskForm').contains(document.activeElement);
    const activityFormHasFocus = $('#plannerActivityForm') &&
      $('#plannerActivityForm').contains(document.activeElement);
    if (renderAfter && S.ui.tab === 'plan' && !plannerFormHasFocus && !activityFormHasFocus) render();
  }
}

async function persistPlannerTask(task, expectedUpdatedAt, successMessage) {
  if (!plannerCloudInitialized || !cloudPlannerSupported) {
    showAppToast('مزامنة المهام غير جاهزة. لم أعتبر المهمة محفوظة على الأجهزة الأخرى.', 5500);
    return false;
  }
  if (plannerSaveInFlight || plannerLoadInFlight) return false;
  plannerSaveInFlight = true;
  render();
  try {
    const result = await postGooglePayload({
      action: 'savetask',
      task,
      expectedUpdatedAt: String(expectedUpdatedAt || '')
    });
    if (!result || result.success === false || !result.task) {
      throw new Error((result && (result.message || result.error)) || 'لم تؤكد Google حفظ المهمة.');
    }
    plannerCloudInitialized = false;
    await loadPlannerTasksFromGoogle({ renderAfter: false });
    if (!plannerCloudInitialized) {
      S.plannerTasks = normalizeState({
        ...S,
        plannerTasks: [...(S.plannerTasks || []).filter(item => item.id !== result.task.id), result.task]
      }).plannerTasks;
      save();
    }
    plannerEditingTaskId = '';
    showAppToast(successMessage + ' تمت مزامنة المهمة.', 3200);
    return true;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (message.includes('TASK_CONFLICT')) {
      await loadPlannerTasksFromGoogle({ renderAfter: false });
      showAppToast('المهمة اتعدّلت من جهاز آخر. حمّلت أحدث نسخة؛ راجعها قبل إعادة التعديل.', 6000);
    } else {
      showAppToast('لم يتم تأكيد حفظ المهمة في Google Sheets: ' + message, 6500);
    }
    return false;
  } finally {
    plannerSaveInFlight = false;
    render();
  }
}

async function persistPlannerTaskDeletion(task, successMessage) {
  if (!plannerCloudInitialized || !cloudPlannerSupported) {
    showAppToast('مزامنة المهام غير جاهزة. لم أعتبر الحذف محفوظًا.', 5500);
    return false;
  }
  if (plannerSaveInFlight || plannerLoadInFlight) return false;
  plannerSaveInFlight = true;
  render();
  try {
    const result = await postGooglePayload({
      action: 'deletetask',
      id: task.id,
      expectedUpdatedAt: String(task.updatedAt || '')
    });
    if (!result || result.success === false) {
      throw new Error((result && (result.message || result.error)) || 'لم تؤكد Google حذف المهمة.');
    }
    plannerDeletedIds.add(String(task.id));
    S.plannerTasks = (S.plannerTasks || []).filter(item => String(item.id) !== String(task.id));
    if (plannerEditingTaskId === task.id) plannerEditingTaskId = '';
    save();
    plannerCloudInitialized = false;
    await loadPlannerTasksFromGoogle({ renderAfter: false });
    showAppToast(successMessage + ' تمت المزامنة.', 3200);
    return true;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (message.includes('TASK_CONFLICT')) {
      await loadPlannerTasksFromGoogle({ renderAfter: false });
      showAppToast('المهمة اتعدّلت من جهاز آخر؛ حمّلت أحدث نسخة ولم أحذفها.', 6000);
    } else {
      showAppToast('لم يتم تأكيد حذف المهمة في Google Sheets: ' + message, 6500);
    }
    return false;
  } finally {
    plannerSaveInFlight = false;
    render();
  }
}

function plannerFindSlot(date, duration, preference, occupied) {
  const rules = plannerRules();
  const windows = plannerFreeWindows(date);
  const morningLimit = Math.min(720, plannerTimeMinutes(rules.sleepStart));
  const splitWindows = windows.flatMap(window => {
    const parts = [];
    if (window.start < morningLimit) {
      const end = Math.min(window.end, morningLimit);
      if (end > window.start) parts.push({ start: window.start, end });
    }
    if (window.end > morningLimit) {
      const start = Math.max(window.start, morningLimit);
      if (window.end > start) parts.push({ start, end: window.end });
    }
    return parts;
  });
  const isMorning = window => window.end <= morningLimit;
  const preferred = preference === 'morning'
    ? splitWindows.filter(isMorning)
    : preference === 'evening'
      ? splitWindows.filter(window => !isMorning(window))
      : splitWindows;
  const alternative = preference === 'morning'
    ? splitWindows.filter(window => !isMorning(window))
    : preference === 'evening'
      ? splitWindows.filter(isMorning)
      : [];
  const search = list => {
    for (const window of list) {
      let candidate = Math.ceil(window.start / 15) * 15;
      while (candidate + duration <= window.end) {
        const collision = occupied
          .filter(item => item.date === date && plannerIntervalsOverlap(
            { start: candidate, end: candidate + duration }, item
          ))
          .sort((a, b) => a.end - b.end)[0];
        if (!collision) return { start: candidate, end: candidate + duration };
        candidate = Math.ceil(collision.end / 15) * 15;
      }
    }
    return null;
  };
  return search(preferred) || search(alternative);
}

function plannerAutoTaskId(activityId, date) {
  return 'AUTO-' + String(activityId) + '-' + String(date);
}

function plannerGenerateWeek(weekDates) {
  const activities = (Array.isArray(S.plannerActivities) ? S.plannerActivities : [])
    .filter(activity => activity && activity.active !== false);
  const tasks = Array.isArray(S.plannerTasks) ? S.plannerTasks : [];
  const occupied = new Map();
  weekDates.forEach(date => {
    const list = [];
    plannerFixedBlocksForDate(date).forEach(block => list.push({ date, start: block.start, end: block.end }));
    tasks.forEach(task => plannerTaskSegments(task).forEach(segment => {
      if (segment.date === date) list.push({ date, start: segment.start, end: segment.end });
    }));
    occupied.set(date, list);
  });

  const requests = [];
  const unplaced = [];
  activities.forEach(activity => {
    const eligible = weekDates.filter(date =>
      !activity.daysOfWeek || !activity.daysOfWeek.length ||
      activity.daysOfWeek.includes(plannerDayOfWeek(date))
    );
    const count = Math.min(Number(activity.sessionsPerWeek) || 1, eligible.length);
    for (let index = 0; index < count; index++) {
      const selectedIndex = count === 1 ? Math.floor((eligible.length - 1) / 2) :
        Math.min(eligible.length - 1, Math.floor((index * (eligible.length - 1)) / (count - 1)));
      requests.push({
        activity,
        date: eligible[selectedIndex],
        id: plannerAutoTaskId(activity.id, eligible[selectedIndex])
      });
    }
  });

  requests.sort((a, b) => {
    const priority = { 'عالية': 3, 'متوسطة': 2, 'منخفضة': 1 };
    return (priority[b.activity.priority] || 2) - (priority[a.activity.priority] || 2) ||
      Number(b.activity.durationMinutes) - Number(a.activity.durationMinutes) ||
      a.date.localeCompare(b.date);
  });

  const suggestions = [];
  requests.forEach(request => {
    const activity = request.activity;
    if (tasks.some(task => String(task.id) === request.id) || plannerDeletedIds.has(request.id)) return;
    const duration = Number(activity.durationMinutes);
    const dayOccupied = occupied.get(request.date) || [];
    const slot = plannerFindSlot(request.date, duration, activity.preferredPeriod || 'any', dayOccupied);
    if (!slot) {
      unplaced.push({
        title: activity.title,
        reason: 'لا توجد فترة متصلة ' + plannerDurationLabel(duration) + ' في الأيام والفترة المحددة.'
      });
      return;
    }
    const now = new Date().toISOString();
    const task = {
      id: request.id,
      title: activity.title,
      date: request.date,
      startTime: plannerMinutesTime(slot.start),
      endTime: plannerMinutesTime(slot.end),
      category: activity.category,
      priority: activity.priority,
      status: 'todo',
      note: 'جلسة من نشاط متكرر: ' + activity.title,
      createdAt: now,
      updatedAt: now
    };
    suggestions.push(task);
    dayOccupied.push({ date: request.date, start: slot.start, end: slot.end });
    occupied.set(request.date, dayOccupied);
  });
  return { tasks: suggestions, unplaced, generatedAt: new Date().toISOString() };
}

async function plannerSaveDraft() {
  if (!plannerGeneratedDraft || !plannerGeneratedDraft.tasks.length) return;
  if (!plannerCanEdit()) {
    showAppToast('تأكد من اكتمال مزامنة المهام قبل اعتماد التوزيع.', 5000);
    return;
  }
  plannerSaveInFlight = true;
  render();
  let savedCount = 0;
  let failure = '';
  try {
    for (const task of plannerGeneratedDraft.tasks) {
      const result = await postGooglePayload({
        action: 'savetask',
        task,
        expectedUpdatedAt: ''
      });
      if (!result || result.success === false || !result.task) {
        failure = (result && (result.message || result.error)) || 'لم تؤكد Google حفظ إحدى الجلسات.';
        break;
      }
      savedCount++;
      S.plannerTasks = normalizeState({
        ...S,
        plannerTasks: [...(S.plannerTasks || []).filter(item => item.id !== result.task.id), result.task]
      }).plannerTasks;
      save();
    }
    if (savedCount) {
      plannerGeneratedDraft.tasks = plannerGeneratedDraft.tasks.slice(savedCount);
      plannerCloudInitialized = false;
      await loadPlannerTasksFromGoogle({ renderAfter: false });
    }
    if (!plannerGeneratedDraft.tasks.length) plannerGeneratedDraft = null;
    showAppToast(failure
      ? 'تم حفظ ' + savedCount + ' جلسة، وتعذر تأكيد الباقي: ' + failure
      : 'تم اعتماد وحفظ ' + savedCount + ' جلسة في جدول الأسبوع.', 6500);
  } catch (error) {
    showAppToast('توقف حفظ التوزيع بعد ' + savedCount + ' جلسة: ' +
      (error && error.message ? error.message : String(error)), 6500);
  } finally {
    plannerSaveInFlight = false;
    render();
  }
}

async function plannerSaveSharedSettings(nextState, successMessage) {
  if (!cloudSettingsInitialized) {
    showAppToast('افتح قسم الإعدادات وجهّز مزامنة هذا الجهاز أولًا؛ لم يتم اعتماد التغيير كإعداد مشترك.', 6500);
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(nextState, 'plannerRules')) S.plannerRules = nextState.plannerRules;
  if (Object.prototype.hasOwnProperty.call(nextState, 'plannerActivities')) S.plannerActivities = nextState.plannerActivities;
  S = normalizeState(S);
  save();
  const synced = await saveSharedSettingsToGoogle();
  if (synced) {
    showAppToast(successMessage + ' تمت المزامنة بين أجهزتك.', 4000);
  } else {
    showAppToast('تم حفظ التغيير على هذا الجهاز، لكن تعذر تأكيد مزامنته مع Google Sheets. راجع حالة المزامنة قبل الاعتماد عليه.', 6500);
  }
  render();
  return synced;
}

function plannerFormError(message) {
  const target = $('#plannerFormError');
  if (!target) return;
  target.textContent = message;
  target.hidden = false;
}

function plannerValidateRules(data) {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (![data.sleepStart, data.sleepEnd, data.workStart, data.workEnd].every(value => time.test(value || ''))) {
    return 'تأكد من كتابة جميع المواعيد بصيغة 24 ساعة.';
  }
  if (plannerTimeMinutes(data.sleepStart) <= plannerTimeMinutes(data.sleepEnd)) {
    return 'بداية النوم يجب أن تكون مساءً ونهايته في صباح اليوم التالي.';
  }
  if (plannerTimeMinutes(data.workStart) >= plannerTimeMinutes(data.workEnd)) {
    return 'بداية العمل يجب أن تسبق نهايته في نفس اليوم.';
  }
  if (!data.workDays.length) return 'حدد يوم عمل واحدًا على الأقل، أو اترك الجدول الحالي كما هو.';
  return '';
}

document.addEventListener('submit', async event => {
  const rulesForm = event.target.closest('#plannerRulesForm');
  if (rulesForm) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(rulesForm));
    data.workDays = [...rulesForm.querySelectorAll('input[name="workDays"]:checked')]
      .map(input => Number(input.value)).filter(value => Number.isInteger(value) && value >= 0 && value <= 6);
    const error = plannerValidateRules(data);
    if (error) {
      showAppToast(error, 5000);
      return;
    }
    plannerGeneratedDraft = null;
    await plannerSaveSharedSettings({
      plannerRules: {
        sleepStart: data.sleepStart,
        sleepEnd: data.sleepEnd,
        workStart: data.workStart,
        workEnd: data.workEnd,
        workDays: data.workDays
      }
    }, 'تم حفظ قواعد الوقت');
    return;
  }

  const activityForm = event.target.closest('#plannerActivityForm');
  if (activityForm) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(activityForm));
    const title = String(data.title || '').trim();
    const durationMinutes = Number(data.durationMinutes);
    const sessionsPerWeek = Number(data.sessionsPerWeek);
    const daysOfWeek = [...activityForm.querySelectorAll('input[name="activityDays"]:checked')]
      .map(input => Number(input.value)).filter(value => Number.isInteger(value) && value >= 0 && value <= 6);
    if (!title) return showAppToast('اكتب اسم النشاط أولًا.', 3500);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 360 || durationMinutes % 15) {
      return showAppToast('مدة الجلسة يجب أن تكون من 15 إلى 360 دقيقة وبمضاعفات 15 دقيقة.', 4500);
    }
    if (!Number.isInteger(sessionsPerWeek) || sessionsPerWeek < 1 || sessionsPerWeek > 7) {
      return showAppToast('عدد الجلسات الأسبوعية يجب أن يكون بين 1 و7.', 4000);
    }
    if (!daysOfWeek.length) return showAppToast('اختار يومًا واحدًا على الأقل للنشاط.', 3500);
    const existing = (S.plannerActivities || []).find(item => item.id === String(data.id || ''));
    const activity = {
      id: existing ? existing.id : plannerNewId('ACT'),
      title: title.slice(0, 100),
      category: PLANNER_CATEGORIES.includes(data.category) ? data.category : 'شخصي',
      durationMinutes,
      sessionsPerWeek,
      preferredPeriod: ['morning', 'evening', 'any'].includes(data.preferredPeriod) ? data.preferredPeriod : 'any',
      priority: PLANNER_PRIORITIES.includes(data.priority) ? data.priority : 'متوسطة',
      daysOfWeek,
      active: true,
      createdAt: existing ? existing.createdAt : new Date().toISOString()
    };
    const next = existing
      ? (S.plannerActivities || []).map(item => item.id === activity.id ? activity : item)
      : [...(S.plannerActivities || []), activity];
    plannerEditingActivityId = '';
    plannerGeneratedDraft = null;
    await plannerSaveSharedSettings({ plannerActivities: next }, existing ? 'تم تعديل النشاط' : 'تمت إضافة النشاط');
    return;
  }

  const taskForm = event.target.closest('#plannerTaskForm');
  if (!taskForm) return;
  event.preventDefault();
  if (!plannerCanEdit()) {
    plannerFormError('تأكد أولًا من اكتمال مزامنة المهام وتحديث خدمة Google.');
    return;
  }
  const data = Object.fromEntries(new FormData(taskForm));
  const title = String(data.title || '').trim();
  if (!title) return plannerFormError('اكتب اسم المهمة أولًا.');
  if (!isValidISODate(data.date)) return plannerFormError('اختار تاريخًا صحيحًا.');
  const time24 = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!time24.test(data.startTime || '') || !time24.test(data.endTime || '')) {
    return plannerFormError('اكتب الوقت بنظام 24 ساعة.');
  }
  if (data.endTime === data.startTime) {
    return plannerFormError('وقت النهاية لازم يختلف عن وقت البداية.');
  }
  const existing = (S.plannerTasks || []).find(task => task.id === String(data.id || ''));
  const task = {
    id: existing ? existing.id : plannerNewId('TASK'),
    title: title.slice(0, 120),
    date: data.date,
    startTime: data.startTime,
    endTime: data.endTime,
    category: PLANNER_CATEGORIES.includes(data.category) ? data.category : 'شخصي',
    priority: PLANNER_PRIORITIES.includes(data.priority) ? data.priority : 'متوسطة',
    status: existing ? existing.status : 'todo',
    note: String(data.note || '').trim().slice(0, 500),
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const conflicts = plannerTaskConflicts(task, existing ? existing.id : '');
  if (conflicts.length) {
    return plannerFormError('لا يمكن حفظ المهمة بسبب تعارض: ' +
      [...new Set(conflicts.map(item => item.message))].join('، ') + '.');
  }
  await persistPlannerTask(
    task,
    existing ? existing.updatedAt : '',
    existing ? 'تم تعديل المهمة.' : 'تمت إضافة المهمة.'
  );
  if (S.ui.plannerDate !== task.date) {
    S.ui.plannerDate = task.date;
    save();
    render();
  }
});

document.addEventListener('change', async event => {
  const statusControl = event.target.closest('[data-planner-status]');
  if (statusControl) {
    if (!plannerCanEdit()) return;
    const task = (S.plannerTasks || []).find(item => item.id === statusControl.dataset.plannerStatus);
    const nextStatus = ['todo', 'partial', 'done', 'postponed', 'missed'].includes(statusControl.value)
      ? statusControl.value : 'todo';
    if (!task || task.status === nextStatus) return;
    await persistPlannerTask(
      { ...task, status: nextStatus, updatedAt: new Date().toISOString() },
      task.updatedAt,
      'تم تحديث حالة المهمة إلى «' + plannerStatusLabel(nextStatus) + '».'
    );
    return;
  }
  if (event.target.id === 'plannerAnchorDate') {
    if (isValidISODate(event.target.value)) {
      S.ui.plannerDate = event.target.value;
      plannerEditingTaskId = '';
      plannerEditingActivityId = '';
      plannerGeneratedDraft = null;
      save();
      render();
    }
  }
});

document.addEventListener('click', async event => {
  if (event.target.closest('#btnPlannerPrev')) {
    S.ui.plannerDate = plannerShiftDate(plannerWeekStart(S.ui.plannerDate), -7);
    plannerEditingTaskId = '';
    plannerGeneratedDraft = null;
    save(); render(); return;
  }
  if (event.target.closest('#btnPlannerNext')) {
    S.ui.plannerDate = plannerShiftDate(plannerWeekStart(S.ui.plannerDate), 7);
    plannerEditingTaskId = '';
    plannerGeneratedDraft = null;
    save(); render(); return;
  }
  if (event.target.closest('#btnPlannerCancelEdit')) {
    plannerEditingTaskId = '';
    render(); return;
  }
  if (event.target.closest('#btnPlannerCancelActivityEdit')) {
    plannerEditingActivityId = '';
    render(); return;
  }
  if (event.target.closest('#btnPlannerSync')) {
    await loadPlannerTasksFromGoogle({ renderAfter: false, manual: true });
    render();
    return;
  }
  if (event.target.closest('#btnPlannerGenerate')) {
    const anchor = isValidISODate(S.ui.plannerDate) ? S.ui.plannerDate : localISODate();
    const dates = Array.from({ length: 7 }, (_, index) => plannerShiftDate(plannerWeekStart(anchor), index));
    if (!(S.plannerActivities || []).some(item => item.active !== false)) {
      showAppToast('أضف نشاطًا متكررًا واحدًا على الأقل قبل إنشاء التوزيع.', 4500);
      return;
    }
    plannerGeneratedDraft = plannerGenerateWeek(dates);
    render();
    return;
  }
  if (event.target.closest('#btnPlannerSaveDraft')) {
    await plannerSaveDraft();
    return;
  }
  if (event.target.closest('#btnPlannerClearDraft')) {
    plannerGeneratedDraft = null;
    render();
    return;
  }

  const activityEdit = event.target.closest('[data-planner-activity-edit]');
  if (activityEdit) {
    if (!cloudSettingsInitialized) return;
    plannerEditingActivityId = activityEdit.dataset.plannerActivityEdit;
    render();
    return;
  }
  const activityToggle = event.target.closest('[data-planner-activity-toggle]');
  if (activityToggle) {
    const activity = (S.plannerActivities || []).find(item => item.id === activityToggle.dataset.plannerActivityToggle);
    if (!activity) return;
    plannerGeneratedDraft = null;
    const next = S.plannerActivities.map(item => item.id === activity.id
      ? { ...item, active: item.active === false }
      : item);
    await plannerSaveSharedSettings({ plannerActivities: next }, activity.active === false ? 'تم تفعيل النشاط' : 'تم إيقاف النشاط');
    return;
  }
  const activityDelete = event.target.closest('[data-planner-activity-delete]');
  if (activityDelete) {
    const activity = (S.plannerActivities || []).find(item => item.id === activityDelete.dataset.plannerActivityDelete);
    if (!activity || !confirm('حذف تعريف النشاط «' + activity.title + '»؟ المهام التي تم إنشاؤها سابقًا ستظل محفوظة.')) return;
    plannerGeneratedDraft = null;
    plannerEditingActivityId = '';
    await plannerSaveSharedSettings({
      plannerActivities: S.plannerActivities.filter(item => item.id !== activity.id)
    }, 'تم حذف تعريف النشاط');
    return;
  }

  const edit = event.target.closest('[data-planner-edit]');
  if (edit) {
    if (!plannerCanEdit()) return;
    plannerEditingTaskId = edit.dataset.plannerEdit;
    plannerEditingActivityId = '';
    render(); return;
  }
  const toggle = event.target.closest('[data-planner-toggle]');
  if (toggle) {
    if (!plannerCanEdit()) return;
    const task = (S.plannerTasks || []).find(item => item.id === toggle.dataset.plannerToggle);
    if (!task) return;
    const updated = { ...task, status: task.status === 'done' ? 'todo' : 'done', updatedAt: new Date().toISOString() };
    await persistPlannerTask(updated, task.updatedAt,
      task.status === 'done' ? 'تمت إعادة فتح المهمة.' : 'تم إنجاز المهمة.');
    return;
  }
  const remove = event.target.closest('[data-planner-delete]');
  if (remove) {
    if (!plannerCanEdit()) return;
    const task = (S.plannerTasks || []).find(item => item.id === remove.dataset.plannerDelete);
    if (!task || !confirm('حذف المهمة «' + task.title + '»؟ لن يتغير أي سجل مالي.')) return;
    await persistPlannerTaskDeletion(task, 'تم حذف المهمة.');
  }
});