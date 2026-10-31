/* MEYAAR FIXED DAILY ROUTINES + EGYPT PRAYER TIMES
   Routine rules are shared through plannerSettings; daily prayer times are calculated
   for the selected date and fetched independently on every device. */
const PLANNER_PRAYER_CITY = 'Kafr El Sheikh';
const PLANNER_PRAYER_COUNTRY = 'Egypt';
const PLANNER_PRAYER_METHOD = 5; // Egyptian General Authority of Survey
const PLANNER_PRAYER_TIMEZONE = 'Africa/Cairo';
const PLANNER_PRAYER_NAMES = [
  ['Fajr', 'الفجر'], ['Dhuhr', 'الظهر'], ['Asr', 'العصر'],
  ['Maghrib', 'المغرب'], ['Isha', 'العشاء']
];
const plannerPrayerCache = new Map();
const plannerPrayerPending = new Set();
const plannerPrayerErrors = new Map();

function plannerEgyptISODate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PLANNER_PRAYER_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const part = type => parts.find(item => item.type === type)?.value || '';
  return part('year') + '-' + part('month') + '-' + part('day');
}

function plannerPrayerApiDate(date) {
  const [year, month, day] = String(date).split('-');
  return day + '-' + month + '-' + year;
}

function plannerCleanPrayerTime(value) {
  const match = String(value || '').match(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?:\s|$)/);
  return match ? String(match[1]).padStart(2, '0') + ':' + match[2] : '';
}

function plannerEnsurePrayerTimes(date, force = false) {
  if (!isValidISODate(date) || plannerPrayerPending.has(date)) return;
  if (!force && (plannerPrayerCache.has(date) || plannerPrayerErrors.has(date))) return;
  plannerPrayerPending.add(date);
  const url = 'https://api.aladhan.com/v1/timingsByCity/' + encodeURIComponent(plannerPrayerApiDate(date)) +
    '?city=' + encodeURIComponent(PLANNER_PRAYER_CITY) +
    '&country=' + encodeURIComponent(PLANNER_PRAYER_COUNTRY) +
    '&method=' + PLANNER_PRAYER_METHOD;
  fetch(url, { method: 'GET', cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error('Prayer API HTTP ' + response.status);
      return response.json();
    })
    .then(payload => {
      const raw = payload && payload.data && payload.data.timings;
      if (!raw) throw new Error('Prayer API returned no timings');
      const times = {};
      PLANNER_PRAYER_NAMES.forEach(([key]) => { times[key] = plannerCleanPrayerTime(raw[key]); });
      if (PLANNER_PRAYER_NAMES.some(([key]) => !times[key])) throw new Error('Incomplete prayer timings');
      plannerPrayerCache.set(date, times);
      plannerPrayerErrors.delete(date);
    })
    .catch(error => {
      plannerPrayerErrors.set(date, error && error.message ? error.message : 'تعذر تحميل مواقيت الصلاة');
      console.error('تعذر تحميل مواقيت الصلاة:', error);
    })
    .finally(() => {
      plannerPrayerPending.delete(date);
      if (S && S.ui && S.ui.tab === 'plan' && S.ui.plannerDate === date) render();
    });
}

function plannerPrayerTimesFor(date) {
  return plannerPrayerCache.get(date) || null;
}

function plannerAvailableWindows(date, area) {
  const settings = S.plannerSettings || (S.plannerSettings = {});
  const originalWorkEnd = settings.workEnd;
  const prayerTimes = plannerPrayerTimesFor(date);
  // Both work and personal availability must use the same dynamic work boundary.
  // Personal time starts only after the work block ends (Maghrib + 60 minutes).
  if (!prayerTimes || !prayerTimes.Maghrib) return [];
  const maghribMinutes = plannerTimeMinutes(prayerTimes.Maghrib);
  if (!Number.isFinite(maghribMinutes)) return [];
  settings.workEnd = plannerMinutesTime(Math.min(1439, maghribMinutes + 60));
  try {
    return plannerAvailableWindowsBase(date, area);
  } finally {
    settings.workEnd = originalWorkEnd;
  }
}

function plannerPrayerAndRoutinePanel(date) {
  const times = plannerPrayerTimesFor(date);
  const error = plannerPrayerErrors.get(date);
  const prayerRows = times
    ? PLANNER_PRAYER_NAMES.map(([key, label]) =>
        '<div class="pc-routine-prayer"><span>' + label + '</span><strong>' + esc(times[key]) + '</strong></div>'
      ).join('')
    : '<div class="pc-routine-loading">' +
        (error ? 'تعذر تحديث مواقيت الصلاة. <button type="button" class="btn btn-sm btn-outline-primary" id="btnPlannerPrayerRetry">إعادة المحاولة</button>'
          : 'جارٍ تحديث مواقيت الصلاة حسب التاريخ المحدد…') + '</div>';
  const maghribMinutes = times && times.Maghrib ? plannerTimeMinutes(times.Maghrib) : NaN;
  const workEnd = Number.isFinite(maghribMinutes) ? plannerMinutesTime(Math.min(1439, maghribMinutes + 60)) : 'يتحدد مع المغرب';
  return '<section class="pc-routine-panel">' +
    '<header><div><span class="pc-section-kicker">مواعيدك الثابتة</span><h4>روتين اليوم</h4></div>' +
    '<small>كفر الشيخ · توقيت مصر</small></header>' +
    '<div class="pc-routine-fixed">' +
      '<div><span>النوم</span><strong>10:00 م – 5:00 ص</strong><small>كل الأيام عدا الجمعة</small></div>' +
      '<div><span>الشغل</span><strong>10:00 ص – ' + esc(workEnd) + '</strong><small>يوميًا حتى أذان المغرب</small></div>' +
    '</div>' +
    '<div class="pc-routine-prayers">' + prayerRows + '</div>' +
    '<footer>مواقيت الصلاة تُحدّث تلقائيًا لكل يوم · طريقة الحساب: الهيئة المصرية العامة للمساحة</footer>' +
    '</section>';
}

function plannerRenderTimeline(date, tasks, canEdit) {
  return plannerPrayerAndRoutinePanel(date) + plannerRenderTimelineBase(date, tasks, canEdit);
}

document.addEventListener('click', event => {
  if (!event.target.closest('#btnPlannerPrayerRetry')) return;
  plannerEnsurePrayerTimes(S.ui.plannerDate || plannerEgyptISODate(), true);
  render();
}, true);
