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
      cloudSettingsInitialized = false;
      cloudSettingsStatus = 'لم تُحفظ الإعدادات المشتركة بعد. افتح النظام على جهازك الأساسي واضغط «مزامنة إعدادات هذا الجهاز».';
      return true;
    }

    const remote = result.state;
    const localRateHistory = Array.isArray(S.rateHistory) ? S.rateHistory : [];
    const mergedSharedState = { ...S, ...remote, ui: S.ui, tx: S.tx };
    if (!Object.prototype.hasOwnProperty.call(remote, 'baseRates')) {
      mergedSharedState.baseRates = localRateHistory.length ? (S.baseRates || S.rates) : (remote.rates || S.rates);
    }
    if (!Array.isArray(remote.rateHistory)) mergedSharedState.rateHistory = localRateHistory;
    S = normalizeState(mergedSharedState);
    cloudSettingsInitialized = true;
    cloudSettingsLastUpdated = result.updatedAt || remote.updatedAt || '';
    cloudSettingsStatus = 'تم تحميل الإعدادات المشتركة من Google Sheets' +
      (cloudSettingsLastUpdated ? ' — ' + cloudSettingsLastUpdated : '');
    save();
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

  try {
    const result = await postGooglePayload({
      action: 'savestate',
      state: sharedSettingsPayload()
    });
    if (!result || result.success === false || result.status === 'error') {
      throw new Error((result && (result.message || result.error)) || 'لم تؤكد Google حفظ الإعدادات');
    }
    cloudSettingsInitialized = true;
    cloudSettingsLastUpdated = result.updatedAt || new Date().toISOString();
    cloudSettingsStatus = 'تمت مزامنة الإعدادات مع Google Sheets';
    save();
    if (S.ui.tab === 'set') render();
    return true;
  } catch (error) {
    cloudSettingsStatus = 'فشلت مزامنة الإعدادات: ' +
      (error && error.message ? error.message : String(error));
    console.error('فشلت مزامنة الإعدادات المشتركة:', error);
    if (manual) {
      alert(cloudSettingsStatus +
        '\nتأكد من تحديث ونشر كود Google Apps Script الداعم لـ savestate.');
    }
    if (S.ui.tab === 'set') render();
    return false;
  } finally {
    cloudSettingsSyncInFlight = false;
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
  if (!['dash', 'tx', 'acc', 'ast', 'set', 'aud', 'rec'].includes(out.ui.tab)) out.ui.tab = 'dash';
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
  const ys = []; for (let y = 2024; y <= 2035; y++) ys.push(y);
  const comp = [ ['استثمارات', c.invVal, COL[2]], ['ذهب', c.gold.val, COL[1]], ['سيولة', c.liq, COL[0]], ['ادخار وطوارئ', c.sav, COL[4]] ];
  const pendingCount = pendingTransactions().length;
  const cloudWarnings = [];
  if (!googleTransactionsLoaded) {
    cloudWarnings.push('لم تكتمل قراءة المعاملات من Google Sheets؛ الأرقام المعروضة قد تكون من ذاكرة هذا الجهاز.');
  } else if (pendingCount) {
    cloudWarnings.push('تم توحيد الحسابات على بيانات Google Sheets. يوجد ' + pendingCount + ' معاملة محلية معلقة لا تدخل في الأرقام المشتركة حتى تراجعها وترفعها من الإعدادات.');
  }
  const cloudBanner = cloudWarnings.length
    ? '<div class="alert alert-warning small">' + cloudWarnings.join('<br>') + '</div>'
    : '';
  return `
  ${cloudBanner}
  <div class="filter-bar">
    <select class="form-select form-select-sm" id="fy">${ys.map(y => `<option ${y == S.ui.y ? 'selected' : ''}>${y}</option>`).join('')}</select>
    <select class="form-select form-select-sm" id="fm"><option value="all">السنة كاملة</option>${MON.map((n, i) => `<option value="${String(i + 1).padStart(2, '0')}" ${S.ui.m === String(i + 1).padStart(2, '0') ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <span class="note">${c.from} ← ${c.to}</span>
  </div>
  <div class="hero-card mb-3">
    <small class="opacity-75">إجمالي الثروة <span class="badge bg-light text-dark">تقديري عند غياب سعر السوق</span></small>
    <div class="hero-value">${f(c.wealth)} <small style="font-size:0.4em;font-weight:600">جنيه</small></div>
    <div class="comp-bar">${comp.map(x => `<i style="width:${c.wealth ? Math.max(x[1], 0) / c.wealth * 100 : 0}%;background:${x[2]}"></i>`).join('')}</div>
    <div class="d-flex flex-wrap gap-3">${comp.map(x => `<span class="leg-item"><span class="leg-dot" style="background:${x[2]}"></span>${x[0]} ${f(x[1])}</span>`).join('')}</div>
    <p class="note mt-2 mb-0">الأصول التي لا تتوفر لها كمية أو سعر سوق تظهر بالتكلفة المسجلة كتقدير، وليست تقييمًا سوقيًا حيًا.</p>
  </div>
  <div class="row g-3 mb-3">
    ${[ ['الدخل', c.inc], ['المصروفات', c.exp], ['الرصيد (دخل − مصروف)', c.inc - c.exp], ['معدل الادخار', null, pc(c.sr)], ['الصدقات', c.char], ['قيمة الذهب', c.gold.val], ['قيمة الاستثمار', c.invVal] ].map(([l, v, x]) => `<div class="col-6 col-md-4 col-lg"><div class="kpi-card"><div class="kpi-label">${l}</div><div class="kpi-value">${x || f(v)}</div></div></div>`).join('')}
  </div>
  <div class="row g-3">
    <div class="col-lg-6"><div class="box"><h3><i class="bi bi-bar-chart"></i> الميزانية مقابل الفعلي</h3><div class="chart-wrap"><canvas id="chBudget"></canvas></div></div></div>
    <div class="col-lg-3 col-md-6"><div class="box"><h3><i class="bi bi-pie-chart"></i> توزيع المصروفات</h3><div class="chart-wrap sm"><canvas id="chExp"></canvas></div></div></div>
    <div class="col-lg-3 col-md-6"><div class="box"><h3><i class="bi bi-pie-chart-fill"></i> توزيع الأصول</h3><div class="chart-wrap sm"><canvas id="chAst"></canvas></div></div></div>
    <div class="col-lg-6"><div class="box"><h3><i class="bi bi-graph-up"></i> الدخل والمصروفات — ${c.y}</h3><div class="chart-wrap"><canvas id="chIncExp"></canvas></div></div></div>
    <div class="col-lg-6"><div class="box"><h3><i class="bi bi-activity"></i> الرصيد المتاح شهرياً (سيولة)</h3><div class="chart-wrap"><canvas id="chBal"></canvas></div></div></div>
    <div class="col-12"><div class="box"><h3><i class="bi bi-table"></i> تفاصيل الميزانية</h3><div class="table-responsive"><table class="table table-hover mb-0"><thead><tr><th>البند</th><th>النسبة</th><th>الميزانية</th><th>الفعلي</th><th>الاستخدام</th><th>الحالة</th></tr></thead><tbody>${c.bud.map(b => `<tr><td>${b.c}</td><td>${pc(b.pct)}</td><td>${f(b.b)}</td><td>${f(b.a)}</td><td><div class="d-flex align-items-center gap-2"><div class="progress-thin flex-grow-1" style="min-width:80px"><div class="bar" style="width:${Math.min(b.u, 1) * 100}%;background:${b.u >= 1 ? 'var(--red)' : 'var(--ac)'}"></div></div><span>${pc(b.u)}</span></div></td><td>${bd(b.s)}</td></tr>`).join('')}</tbody></table></div><p class="note mt-2 mb-0">أساس الميزانية: ${f(c.base)} ج.م. شراء الذهب غير محسوب في بند الاستثمارات.</p></div></div>
  </div>`;
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
  const views = { dash: vDash, tx: vTx, acc: vAcc, ast: vAst, set: vSet, aud: vAud, rec: vRecurring };
  $('#app').innerHTML = views[S.ui.tab](c);
  if (S.ui.tab === 'dash') { requestAnimationFrame(() => { renderBudgetBars(c); renderExpenseDonut(c); renderAssetDonut(c); renderIncExp(c); renderBalanceLine(c); }); }
  const icon = $('#btnTheme i');
  if (icon) icon.className = document.documentElement.getAttribute('data-theme') === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars';
}
let editingTx = null;
let txSaveInFlight = false;

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
    a.type === b.type && a.acc === b.acc &&
    Math.abs(Number(a.amount) - Number(b.amount)) < 0.005 &&
    Number(a.dueDay) === Number(b.dueDay);
}

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
  schedule.active = !currentlyActive;
  save();
  render();
  const synced = await saveSharedSettingsToGoogle();
  showAppToast(synced
    ? (schedule.active ? 'تم تفعيل الالتزام من جديد.' : 'تم إيقاف الالتزام مؤقتًا.')
    : 'تم التغيير على هذا الجهاز لكن لم يتم تأكيد مزامنته بين الأجهزة.', 6000);
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
  if (!confirm(
    'تأكيد تسجيل الاستحقاق؟\n\n' + initialSchedule.name + '\n' +
    'التاريخ: ' + dueDate + '\n' +
    'المبلغ: ' + recurringAmountLabel(initialSchedule) + '\n' +
    'الحساب: ' + accountDisplayName(initialSchedule.acc) + '\n\n' +
    'سيتم إنشاء المعاملة مرة واحدة فقط إذا لم يكن لهذا الاستحقاق سجل في Google Sheets.'
  )) return;

  recurringGenerationInFlight.add(key);
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

document.addEventListener('click', e => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { S.ui.tab = tab.dataset.tab; save(); render(); return; }
  if (e.target.closest('#btnAddTx')) { openTx(); return; }
  if (e.target.closest('#btnAddTransfer')) { openTransfer(); return; }
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
});

if (S.ui.theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
else document.documentElement.setAttribute('data-theme', 'light');

render();

(async function initializeCloudData() {
  // Load the shared settings first so custom account codes exist before auditing transactions.
  await loadSharedSettingsFromGoogle({ renderAfter: false });
  await loadDataFromGoogle({ renderAfter: false });
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
  render();
  checkRecurringReminders();
}, SHARED_SYNC_INTERVAL_MS);
