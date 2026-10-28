/* ========== Constants & Seed ========== */
const KEY = 'fin_dash_pro_v2';
const GOLD = 'ذهب_عيار_21';
const CATS = ['الأساسيات', 'الرغبات', 'الادخار', 'الاستثمارات', 'الصدقات', 'الطوارئ'];
const ALLC = [...CATS, 'دخل', 'تحويل داخلي', 'رسوم وضرائب', 'أخرى'];
const TYPES = ['دخل', 'مصروف', 'شراء أصل', 'بيع أصل', 'تحويل', 'تسوية'];
const PAY = ['نقدي', 'تحويل بنكي', 'بطاقة خصم', 'بطاقة ائتمان', 'ثاندر', 'محفظة إلكترونية', 'أخرى'];
const MON = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const COL = ['#0d9488', '#d97706', '#6366f1', '#dc2626', '#8b5cf6', '#16a34a', '#ea580c', '#64748b'];
const CURS = { EGP: 'ج.م', SAR: 'ر.س', USD: '$' };

const API_URL = "https://script.google.com/macros/s/AKfycbwJI2_IFB0ukOs1Ufko0wuLob2eAEIFLaPwsglNAeWnMdCUB_7euqWGV4xGzVBH1SflzQ/exec";

// Google Sheets currently contains only a partial transaction schema. Preserve richer local records during sync.
function googleNotes(tx) {
  if (!tx) return '';
  return String(tx.googleNotes !== undefined ? tx.googleNotes : ((tx.note || tx.name) || '')).trim();
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
  return String(tx.date || '') === remote.date && String(tx.type || '') === remote.type &&
    String(tx.cat || '') === remote.cat && Number.isFinite(Number(tx.amt)) &&
    Math.abs(Number(tx.amt) - remote.amt) < 0.005;
}

function hasAmbiguousGoogleDelete(tx) {
  return S.tx.some(other => String(other.id) !== String(tx.id) &&
    String(other.date || '') === String(tx.date || '') && googleNotes(other) === googleNotes(tx));
}

// Google currently stores only Date, Type, Amount, Category and Notes.
// Merge those rows into local records instead of replacing richer local records with partial data.
async function loadDataFromGoogle() {
  try {
    const response = await fetch(API_URL, { method: 'GET', cache: 'no-store' });
    if (!response.ok) throw new Error('Google Sheets HTTP ' + response.status);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('صيغة البيانات القادمة من Google Sheets غير صحيحة');

    const firstRow = Array.isArray(data[0]) ? data[0].map(v => String(v || '').trim().toLowerCase()) : [];
    const hasHeaders = firstRow.some(v => ['date', 'type', 'amount', 'category', 'notes'].includes(v));
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
      const remote = { date, type, amt: amount, cat, notes };
      let match = localPool.find(item => !item.used && sameRemoteCore(item.tx, remote) && googleNotes(item.tx) === notes);
      if (!match) {
        const candidates = localPool.filter(item => !item.used && sameRemoteCore(item.tx, remote));
        if (candidates.length === 1) match = candidates[0];
      }
      if (match) {
        match.used = true;
        const tx = { ...match.tx, date, type, amt: amount, cat, googleNotes: notes };
        const previousNotes = googleNotes(match.tx);
        if (previousNotes !== notes) {
          if (!match.tx.name || match.tx.name === previousNotes) tx.name = notes;
          if (!match.tx.note || match.tx.note === previousNotes) tx.note = notes;
        }
        imported.push(tx);
      } else {
        const id = allocateId();
        imported.push({ id, date, type, amt: amount, cat, note: notes, googleNotes: notes,
          name: notes || 'معاملة من Google Sheets', fee: 0, pay: 'نقدي', acc: 'CASH',
          code: '', qty: '', price: '', sub: '', cur: 'EGP' });
      }
    });

    // Keep local-only rows: a partial/empty remote response must never erase local financial details.
    const localOnly = localPool.filter(item => !item.used).map(item => item.tx);
    S.tx = [...localOnly, ...imported];
    save();
  } catch (error) {
    console.error('تعذر تحميل المعاملات من Google Sheets:', error);
    // Keep the last local snapshot if the network or Google service fails.
  } finally {
    if (typeof render === 'function') render();
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
  try { result = JSON.parse(raw); } catch (_) { throw new Error('استجابة Google Sheets غير مفهومة'); }
  if (result.status === 'error' || result.success === false) throw new Error(result.message || 'رفض Google Sheets العملية');
  return result;
}

async function saveTransactionToGoogle(tx) {
  const dataToSend = {
    Date: tx.date ? String(tx.date).substring(0, 10) : '',
    Type: tx.type, Amount: tx.amt, Category: tx.cat,
    Notes: googleNotes(tx) || tx.name
  };
  const result = await postGooglePayload(dataToSend);
  if (result.status && result.status !== 'success') throw new Error(result.message || 'لم يتم تأكيد الحفظ في Google Sheets');
  return result;
}

async function deleteTransactionFromGoogle(tx) {
  const result = await postGooglePayload({ action: 'delete', Date: tx.date, Notes: googleNotes(tx) });
  if (result.found === false || result.deleted === false || result.success === false || result.status === 'error') {
    throw new Error(result.message || 'لم يتم العثور على المعاملة في Google Sheets');
  }
  return result;
}

const T = (id, date, name, cat, sub, type, amt, acc, pay, code, qty, price, note, cur = 'EGP') =>
  ({ id, date, name, cat, sub: sub || '', type, amt, fee: 0, pay, acc, code: code || '', qty: qty || '', price: price || '', note: note || '', cur });

function seed() {
  return {
    ui: { y: 2026, m: 'all', tab: 'dash', q: '', theme: 'light' },
    rates: { EGP: 1, SAR: 12.9, USD: 48.5 },
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
  if (!['dash', 'tx', 'acc', 'ast', 'set', 'aud'].includes(out.ui.tab)) out.ui.tab = 'dash';
  out.ui.y = Number.isInteger(Number(out.ui.y)) && Number(out.ui.y) >= 1900 && Number(out.ui.y) <= 2200 ? Number(out.ui.y) : base.ui.y;
  out.ui.m = out.ui.m === 'all' || /^(0[1-9]|1[0-2])$/.test(String(out.ui.m)) ? String(out.ui.m) : 'all';
  out.ui.q = String(out.ui.q || '');
  out.ui.theme = out.ui.theme === 'dark' ? 'dark' : 'light';

  out.rates = { ...base.rates, ...obj(input.rates) };
  Object.keys(out.rates).forEach(cur => {
    const n = Number(out.rates[cur]);
    out.rates[cur] = cur === 'EGP' ? 1 : (Number.isFinite(n) && n > 0 ? n : (base.rates[cur] || 1));
  });
  out.rates.EGP = 1;

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
    return { ...t, id: t.id === undefined || t.id === null ? i + 1 : t.id,
      date: normalizeGoogleDate(t.date) || String(t.date || ''), name: String(t.name || ''),
      type: String(t.type || ''), cat: String(t.cat || 'أخرى'), amt, fee: feeValue,
      acc: String(t.acc || 'CASH'), note: String(t.note || ''), cur: String(t.cur || 'EGP') };
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
const toEGP = (amt, cur) => (+amt || 0) * (S.rates[cur] || 1);
function status(t, ids) {
  const ast = ['شراء أصل', 'بيع أصل'].includes(t.type);
  if (ids[t.id] > 1) return 'رقم مكرر';
  if (!isValidISODate(t.date) || !Number.isFinite(Number(t.amt)) || !(Number(t.amt) > 0) || !t.type || !t.acc) return 'بيانات ناقصة';
  if (!Number.isFinite(Number(t.fee)) || Number(t.fee) < 0) return 'رسوم غير صحيحة';
  if (!S.accounts.some(a => a.code === t.acc)) return 'حساب غير معروف';
  if ((ast || t.cat === 'الاستثمارات') && (!t.code || !(+t.qty > 0) || !(+t.price > 0))) return 'بيانات أصل ناقصة';
  const x = t.type;
  if ((x === 'دخل' && t.cat !== 'دخل') || (t.cat === 'دخل' && x !== 'دخل') ||
      ((x === 'تحويل' || x === 'تسوية') && t.cat !== 'تحويل داخلي') ||
      (t.cat === 'تحويل داخلي' && x !== 'تحويل' && x !== 'تسوية') ||
      (ast && t.cat !== 'الاستثمارات') || (t.cat === 'الاستثمارات' && x === 'مصروف'))
    return 'تصنيف لا يطابق النوع';
  return 'سليم';
}

const P = t => {
  const a = toEGP(t.amt, t.cur), e = toEGP(fee(t), t.cur);
  if (t.type === 'دخل') return a - e;
  if (t.type === 'مصروف' || t.type === 'شراء أصل' || t.type === 'تحويل') return -(a + e);
  if (t.type === 'بيع أصل') return a - e;
  if (t.type === 'تسوية') return a;
  return 0;
};

const Q = t => {
  const a = toEGP(t.amt, t.cur), e = toEGP(fee(t), t.cur);
  if (t.type === 'مصروف') return a + e;
  if (t.type === 'دخل' || t.type === 'تحويل') return e;
  return 0;
};

const priceOf = c => +((S.prices.find(p => p.code === c) || {}).price) || 0;

function hold(v, c) {
  let bq = 0, sq = 0, cost = 0, proc = 0, sf = 0;
  v.filter(t => t.code === c).forEach(t => {
    if (t.type === 'شراء أصل') {
      bq += +t.qty;
      cost += toEGP(+t.amt + fee(t), t.cur);
    } else if (t.type === 'بيع أصل') {
      sq += +t.qty;
      proc += toEGP(t.amt, t.cur);
      sf += toEGP(fee(t), t.cur);
    }
  });
  const avg = bq ? cost / bq : 0;
  const rem = bq - sq;
  const pr = priceOf(c);
  return { code: c, bq, sq, rem, cost, avg, pr, val: rem * pr, rc: rem * avg, un: rem * pr - rem * avg, re: proc - sq * avg - sf };
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

  const inc = sum(pv.filter(t => t.type === 'دخل'), t => toEGP(t.amt, t.cur));
  const exp = sum(pv, Q);

  let base = inc;
  if (!all && !inc) {
    const pm = mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, '0')}`;
    base = sum(v.filter(t => t.type === 'دخل' && t.date.startsWith(pm)), t => toEGP(t.amt, t.cur));
  }

  const bal = S.accounts.map(a => ({
    ...a,
    bal: +a.open + sum(v.filter(t => t.acc === a.code && t.date <= to), P)
  }));
  const liq = sum(bal.filter(a => a.liq), a => a.bal);

  const codes = [...new Set(v.filter(t => t.code && t.code !== GOLD).map(t => t.code))];
  const vt = v.filter(t => t.date <= to);
  const inv = codes.map(c => hold(vt, c));
  const gold = hold(vt, GOLD);
  const invVal = sum(inv, h => h.val);
  const sav = sum(v.filter(t => (t.cat === 'الادخار' || t.cat === 'الطوارئ') && t.date <= to), Q);

  const bud = CATS.map(c => {
    let a = sum(pv.filter(t => t.cat === c), Q);
    if (c === 'الاستثمارات')
      a += sum(pv.filter(t => t.cat === c && t.type === 'شراء أصل' && t.code !== GOLD), t => toEGP(+t.amt + fee(t), t.cur));
    const b = base * (S.budget[c] || 0);
    const u = b ? a / b : 0;
    return { c, pct: S.budget[c], b, a, u, s: !b ? '—' : u >= 1 ? 'تجاوز' : u >= S.warn ? 'تحذير' : u >= 0.75 ? 'مراقبة' : 'ضمن الخطة' };
  });

  const months = MON.map((n, i) => {
    const k = `${y}-${String(i + 1).padStart(2, '0')}`;
    const x = v.filter(t => t.date.startsWith(k));
    return {
      n,
      i: sum(x.filter(t => t.type === 'دخل'), t => toEGP(t.amt, t.cur)),
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

function bd(s) {
  const cls = (s === 'سليم' || s === 'ضمن الخطة') ? 'tag-ok' : (s === 'تجاوز' || s === 'خطأ') ? 'tag-er' : 'tag-wn';
  return `<span class="tag ${cls}">${s}</span>`;
}
function st(s) { return s === 'سليم' ? bd(s) : `<span class="tag tag-er">${s}</span>`; }
function fillSelect(el, arr, val) { el.innerHTML = arr.map(x => `<option value="${esc(x)}" ${x === val ? 'selected' : ''}>${esc(x)}</option>`).join(''); }

function vDash(c) {
  const ys = []; for (let y = 2024; y <= 2035; y++) ys.push(y);
  const comp = [ ['استثمارات', c.invVal, COL[2]], ['ذهب', c.gold.val, COL[1]], ['سيولة', c.liq, COL[0]], ['ادخار وطوارئ', c.sav, COL[4]] ];
  return `
  <div class="filter-bar">
    <select class="form-select form-select-sm" id="fy">${ys.map(y => `<option ${y == S.ui.y ? 'selected' : ''}>${y}</option>`).join('')}</select>
    <select class="form-select form-select-sm" id="fm"><option value="all">السنة كاملة</option>${MON.map((n, i) => `<option value="${String(i + 1).padStart(2, '0')}" ${S.ui.m === String(i + 1).padStart(2, '0') ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <span class="note">${c.from} ← ${c.to}</span>
  </div>
  <div class="hero-card mb-3">
    <small class="opacity-75">إجمالي الثروة</small>
    <div class="hero-value">${f(c.wealth)} <small style="font-size:0.4em;font-weight:600">جنيه</small></div>
    <div class="comp-bar">${comp.map(x => `<i style="width:${c.wealth ? Math.max(x[1], 0) / c.wealth * 100 : 0}%;background:${x[2]}"></i>`).join('')}</div>
    <div class="d-flex flex-wrap gap-3">${comp.map(x => `<span class="leg-item"><span class="leg-dot" style="background:${x[2]}"></span>${x[0]} ${f(x[1])}</span>`).join('')}</div>
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
    <input type="search" class="form-control form-control-sm" id="q" placeholder="بحث..." value="${esc(S.ui.q || '')}" style="max-width:220px">
    <span class="note">${rows.length} معاملة — الصفوف غير السليمة مستبعدة من الحسابات</span>
  </div>
  <div class="box"><div class="table-responsive"><table class="table table-hover mb-0"><thead><tr><th>#</th><th>التاريخ</th><th>الاسم</th><th>التصنيف</th><th>النوع</th><th>المبلغ</th><th>العملة</th><th>الحساب</th><th>الأصل</th><th>الحالة</th><th></th></tr></thead><tbody>${rows.map(t => `<tr><td>${t.id}</td><td>${t.date}</td><td>${esc(t.name)}</td><td>${esc(t.cat)}</td><td>${t.type}</td><td>${f(t.amt)}</td><td><span class="badge-currency">${t.cur || 'EGP'}</span></td><td>${esc(t.acc)}</td><td>${esc(t.code)}${t.qty ? ' ×' + t.qty : ''}</td><td>${st(t.st)}</td><td class="text-nowrap"><button class="btn btn-sm btn-outline-primary" data-edit="${t.id}"><i class="bi bi-pencil"></i></button><button class="btn btn-sm btn-outline-danger" data-del="${t.id}"><i class="bi bi-trash"></i></button></td></tr>`).join('')}</tbody></table></div></div>`;
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

function vSet() {
  const t = CATS.reduce((s, c) => s + (+S.budget[c] || 0), 0);
  return `
  <div class="row g-3"><div class="col-lg-6"><div class="box"><h3><i class="bi bi-sliders"></i> نسب الميزانية</h3><table class="table mb-0">${CATS.map(c => `<tr><td>${c}</td><td style="width:120px"><div class="input-group input-group-sm"><input type="number" class="form-control" data-b="${c}" min="0" max="100" step="1" value="${Math.round(S.budget[c] * 100)}"><span class="input-group-text">%</span></div></td></tr>`).join('')}<tr><th>المجموع</th><th style="color:var(--${Math.abs(t - 1) < 0.001 ? 'ok' : 'red'})">${pc(t)}</th></tr><tr><td>حد التحذير</td><td><div class="input-group input-group-sm"><input type="number" class="form-control" data-w="1" min="1" max="100" value="${Math.round(S.warn * 100)}"><span class="input-group-text">%</span></div></td></tr></table></div></div>
  <div class="col-lg-6"><div class="box"><h3><i class="bi bi-currency-exchange"></i> أسعار الصرف (إلى الجنيه)</h3><table class="table mb-0"><tr><td>ريال سعودي (SAR)</td><td style="width:140px"><input type="number" step="any" class="form-control form-control-sm" data-r="SAR" value="${S.rates.SAR}"></td></tr><tr><td>دولار أمريكي (USD)</td><td><input type="number" step="any" class="form-control form-control-sm" data-r="USD" value="${S.rates.USD}"></td></tr><tr><td>جنيه مصري (EGP)</td><td><input type="number" class="form-control form-control-sm" value="1" disabled></td></tr></table><p class="note mt-2 mb-0">كل المعاملات تُحوَّل إلى الجنيه حسب هذه الأسعار عند الحساب.</p></div></div>
  <div class="col-12"><div class="box"><h3><i class="bi bi-database"></i> البيانات</h3><p class="note">التفاصيل الكاملة (الحساب والعملة والرسوم والكمية والسعر) محفوظة محلياً في هذا المتصفح. مزامنة Google Sheets الحالية تحفظ التاريخ والنوع والمبلغ والتصنيف والملاحظات فقط؛ صدّر نسخة احتياطية دورياً.</p><div class="d-flex flex-wrap gap-2"><button class="btn btn-primary btn-sm" id="btnExp"><i class="bi bi-download"></i> تصدير JSON</button><button class="btn btn-outline-primary btn-sm" id="btnCsv"><i class="bi bi-filetype-csv"></i> تصدير CSV</button><button class="btn btn-outline-secondary btn-sm" id="btnImp"><i class="bi bi-upload"></i> استيراد</button><button class="btn btn-outline-danger btn-sm" id="btnReset"><i class="bi bi-arrow-counterclockwise"></i> استرجاع التجريبي</button></div></div></div></div>`;
}

function vAud(c) {
  const v = c.v;
  const n = fn => S.tx.filter(fn).length;
  const today = localISODate();
  const tr = v.filter(t => t.type === 'تحويل').reduce((s, t) => s + toEGP(t.amt, t.cur), 0) - v.filter(t => t.type === 'تسوية').reduce((s, t) => s + toEGP(t.amt, t.cur), 0);
  const codes = [...new Set(S.tx.filter(t => t.code && t.code !== GOLD).map(t => t.code))];
  const old = S.prices.filter(p => p.price > 0 && (!p.date || (Date.now() - new Date(p.date)) / 864e5 > 30)).length;
  const L = [
    ['صفوف غير سليمة (مستبعدة من الحسابات)', n(t => t.st !== 'سليم'), 'خطأ', 'افتح المعاملات وصلّح الصف'],
    ['الفرق بين التحويلات والتسويات', Math.round(tr * 100) / 100, 'خطأ', 'كل تحويل يحتاج تسوية بنفس المبلغ'],
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
  const views = { dash: vDash, tx: vTx, acc: vAcc, ast: vAst, set: vSet, aud: vAud };
  $('#app').innerHTML = views[S.ui.tab](c);
  if (S.ui.tab === 'dash') { requestAnimationFrame(() => { renderBudgetBars(c); renderExpenseDonut(c); renderAssetDonut(c); renderIncExp(c); renderBalanceLine(c); }); }
  const icon = $('#btnTheme i');
  if (icon) icon.className = document.documentElement.getAttribute('data-theme') === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars';
}
let editingTx = null;
function openTx(t) {
  editingTx = t || null;
  const isNew = !t;
  t = t || { id: Math.max(0, ...S.tx.map(x => +x.id)) + 1, date: localISODate(), name: '', cat: 'الأساسيات', type: 'مصروف', amt: '', fee: 0, pay: 'نقدي', acc: S.accounts[0]?.code || '', code: '', qty: '', price: '', note: '', cur: 'EGP' };
  $('#modalTxTitle').textContent = isNew ? 'معاملة جديدة' : 'تعديل معاملة رقم ' + t.id;
  const form = $('#formTx');
  form.date.value = t.date; form.elements.namedItem('name').value = t.name || ''; form.type.value = t.type; form.amt.value = t.amt || ''; form.fee.value = t.fee || 0; form.code.value = t.code || ''; form.qty.value = t.qty || ''; form.price.value = t.price || ''; form.note.value = t.note || ''; form.cur.value = t.cur || 'EGP';
  fillSelect($('#txCat'), ALLC, t.cat); fillSelect($('#txAcc'), S.accounts.map(a => a.code), t.acc); fillSelect($('#txPay'), PAY, t.pay);
  new bootstrap.Modal($('#modalTx')).show();
}

$('#formTx').addEventListener('submit', async e => {
  e.preventDefault();
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
  Object.assign(t, { date: d.date, name: d.name, type: d.type, cat: d.cat, amt: +d.amt, fee: +d.fee || 0, acc: d.acc, pay: d.pay, code: d.code || '', qty: d.qty === '' ? '' : +d.qty, price: d.price === '' ? '' : +d.price, note: d.note || '', googleNotes: notesForGoogle, cur: d.cur || 'EGP', sub: t.sub || '' });
  const ids = {};
  S.tx.filter(x => !wasEditing || x.id !== oldTx.id).forEach(x => ids[x.id] = (ids[x.id] || 0) + 1);
  const validation = status(t, ids);
  if (validation !== 'سليم') { alert('لا يمكن حفظ المعاملة: ' + validation); return; }

  let oldGoogleRowDeleted = false;
  try {
    // The current Apps Script API shown in this project has no confirmed update-by-ID endpoint.
    // Use its existing delete action before re-adding, and try to restore the old row on failure.
    if (wasEditing) {
      if (hasAmbiguousGoogleDelete(oldTx)) throw new Error('توجد معاملة أخرى بنفس التاريخ والملاحظات؛ لا يمكن التعديل بأمان عبر واجهة Google الحالية. غيّر الملاحظات أو حدّث واجهة Apps Script لمعرّف فريد.');
      await deleteTransactionFromGoogle(oldTx);
      oldGoogleRowDeleted = true;
    }
    await saveTransactionToGoogle(t);
    if (wasEditing) S.tx = S.tx.filter(x => x.id !== oldTx.id);
    S.tx.push(t);
    if (t.code && !S.prices.some(p => p.code === t.code) && t.price) S.prices.push({ code: t.code, cat: 'سهم', price: +t.price, date: '' });
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
  }
});

$('#formAcc').addEventListener('submit', e => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  if (S.accounts.some(a => a.code === d.code)) { alert('الرمز موجود مسبقاً'); return; }
  S.accounts.push({ code: d.code, name: d.name, type: d.type || 'نقد', open: +d.open || 0, liq: d.liq ? 1 : 0 });
  save(); bootstrap.Modal.getInstance($('#modalAcc')).hide(); render();
});

$('#formPrice').addEventListener('submit', e => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  if (S.prices.some(p => p.code === d.code)) { alert('الرمز موجود مسبقاً'); return; }
  S.prices.push({ code: d.code, cat: d.cat, price: +d.price || 0, date: d.date || '' });
  save(); bootstrap.Modal.getInstance($('#modalPrice')).hide(); render();
});

document.addEventListener('click', e => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { S.ui.tab = tab.dataset.tab; save(); render(); return; }
  if (e.target.closest('#btnAddTx')) { openTx(); return; }
  if (e.target.closest('#btnAddAcc')) { $('#formAcc').reset(); new bootstrap.Modal($('#modalAcc')).show(); return; }
  if (e.target.closest('#btnAddPrice')) { $('#formPrice').reset(); $('#formPrice').date.value = localISODate(); new bootstrap.Modal($('#modalPrice')).show(); return; }
  const editBtn = e.target.closest('[data-edit]');
  if (editBtn) { openTx(S.tx.find(t => t.id == editBtn.dataset.edit)); return; }
  
  // Delete in Google first; only remove locally after Google confirms the operation.
  const delBtn = e.target.closest('[data-del]');
  if (delBtn) {
    if (confirm('حذف المعاملة رقم ' + delBtn.dataset.del + '؟')) {
      const txToDelete = S.tx.find(t => String(t.id) === String(delBtn.dataset.del));
      if (txToDelete) {
        if (hasAmbiguousGoogleDelete(txToDelete)) {
          alert('لا يمكن حذف المعاملة بأمان لأن هناك معاملة أخرى لها التاريخ والملاحظات نفسيهما، وواجهة Google الحالية لا تملك معرّفاً فريداً للحذف. غيّر الملاحظات أو حدّث Apps Script أولاً.');
          return;
        }
        deleteTransactionFromGoogle(txToDelete).then(() => {
          S.tx = S.tx.filter(t => String(t.id) !== String(delBtn.dataset.del));
          save(); render();
        }).catch(err => {
          console.error('فشل حذف المعاملة من Google Sheets:', err);
          alert('لم يتم تأكيد الحذف من Google Sheets، لذلك احتفظت بالمعاملة محليًا.');
        });
      }
    }
    return;
  }
  if (e.target.closest('#btnTheme')) { const cur = document.documentElement.getAttribute('data-theme'); const next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', next); S.ui.theme = next; save(); render(); return; }
  if (e.target.closest('#btnExp')) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' })); a.download = 'نسخة_احتياطية_' + localISODate() + '.json'; a.click(); return; }
  if (e.target.closest('#btnCsv')) { const h = ['id', 'date', 'name', 'cat', 'sub', 'type', 'amt', 'fee', 'cur', 'pay', 'acc', 'code', 'qty', 'price', 'note']; const rows = [h, ...S.tx.map(t => h.map(k => '"' + String(t[k] ?? '').replace(/"/g, '""') + '"'))]; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' })); a.download = 'المعاملات.csv'; a.click(); return; }
  if (e.target.closest('#btnImp')) { $('#fileImport').click(); return; }
  if (e.target.closest('#btnReset')) { if (confirm('سيتم تصفير البيانات المحلية فقط. لن يتم حذف أي شيء من Google Sheets. هل تريد المتابعة؟')) { S = seed(); save(); loadDataFromGoogle(); render(); } }
});

document.addEventListener('change', e => {
  const x = e.target;
  if (x.id === 'fy') { S.ui.y = +x.value; save(); render(); return; }
  if (x.id === 'fm') { S.ui.m = x.value; save(); render(); return; }
  if (x.dataset.s) { const r = S[x.dataset.s][x.dataset.i]; const k = x.dataset.k; r[k] = x.type === 'checkbox' ? (x.checked ? 1 : 0) : x.type === 'number' ? +x.value : x.value; if (x.dataset.s === 'prices' && k === 'price' && !r.date) r.date = localISODate(); save(); render(); return; }
  if (x.dataset.b) { S.budget[x.dataset.b] = (+x.value || 0) / 100; save(); render(); return; }
  if (x.dataset.w) { S.warn = (+x.value || 90) / 100; save(); render(); return; }
  if (x.dataset.r) { const rate = Number(x.value); if (!Number.isFinite(rate) || rate <= 0) { alert('سعر الصرف يجب أن يكون رقماً أكبر من صفر.'); render(); return; } S.rates[x.dataset.r] = rate; save(); render(); return; }
  if (x.id === 'fileImport') {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d || typeof d !== 'object' || !Array.isArray(d.tx) || !Array.isArray(d.accounts)) throw new Error('بنية الملف غير صحيحة');
        S = normalizeState(d);
        save(); render();
      } catch (_) { alert('الملف غير صالح'); }
    };
    r.readAsText(x.files[0]);
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'q') {
    S.ui.q = e.target.value;
    const p = e.target.selectionStart;
    render();
    const q = $('#q');
    if (q) { q.focus(); q.setSelectionRange(p, p); }
  }
});

if (S.ui.theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
else document.documentElement.setAttribute('data-theme', 'light');

render();
loadDataFromGoogle();
