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
      startTime: /^([01]\\d|2[0-3]):[0-5]\\d$/.test(String(item.startTime || '')) ? String(item.startTime) : '09:00',
      endTime: /^([01]\\d|2[0-3]):[0-5]\\d$/.test(String(item.endTime || '')) ? String(item.endTime) : '10:00',
      category: ['عمل', 'تعلم', 'صحة', 'شخصي', 'عائلة', 'راحة', 'أخرى'].includes(item.category) ? item.category : 'شخصي',
      priority: ['عالية', 'متوسطة', 'منخفضة'].includes(item.priority) ? item.priority : 'متوسطة',
      status: ['todo', 'done'].includes(item.status) ? item.status : 'todo',
      note: String(item.note || '').trim().slice(0, 500),
      createdAt: String(item.createdAt || ''),
      updatedAt: String(item.updatedAt || '')
    }))
    .filter(item => item.title && item.endTime > item.startTime);

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

