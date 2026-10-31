/* MEYAAR PRODUCTIVITY COMMAND CENTER
   Tasks are independent of financial transactions and stored in the dedicated TASKS sheet.
   The planner separates capture, priority, time-blocking, focus tracking and daily review. */

let plannerScheduleDraft = null;
let plannerCurrentSearch = '';
let plannerCurrentProjectFilter = 'all';
let plannerCurrentAreaFilter = 'all';

const PLANNER_STATUSES = ['inbox', 'next', 'scheduled', 'doing', 'done', 'postponed', 'archived'];
const PLANNER_STATUS_LABELS = {
  inbox: 'صندوق الوارد',
  next: 'التالية',
  scheduled: 'مجدولة',
  doing: 'قيد التنفيذ',
  done: 'مكتملة',
  postponed: 'مؤجلة',
  archived: 'مؤرشفة'
};
const PLANNER_PRIORITIES = ['عاجل', 'عالية', 'متوسطة', 'منخفضة'];
const PLANNER_AREAS = ['personal', 'work'];
const PLANNER_CATEGORIES = ['عمل', 'التعلم', 'القراءة', 'القرآن', 'الصلاة', 'الصحة', 'الجيم', 'الأسرة', 'المنزل', 'الإدارة', 'مشروع جانبي', 'أخرى'];

function plannerRules() {
  const raw = S && S.plannerSettings && typeof S.plannerSettings === 'object' ? S.plannerSettings : {};
  return {
    sleepStart: raw.sleepStart || '22:00',
    sleepEnd: raw.sleepEnd || '05:00',
    workStart: raw.workStart || '10:00',
    workEnd: raw.workEnd || '19:00',
    workDays: Array.isArray(raw.workDays) ? raw.workDays : [0, 1, 2, 3, 4, 6],
    breakMinutes: Math.max(5, Math.min(30, Number(raw.breakMinutes) || 10)),
    targetLoad: Math.max(60, Math.min(95, Number(raw.targetLoad) || 85)),
    dayStart: raw.dayStart || '05:00',
    dayEnd: raw.dayEnd || '22:00'
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

function plannerDateShift(value, days) {
  const date = new Date((isValidISODate(value) ? value : localISODate()) + 'T12:00:00');
  date.setDate(date.getDate() + days);
  return localISODate(date);
}

function plannerWeekStart(value) {
  const date = new Date((isValidISODate(value) ? value : localISODate()) + 'T12:00:00');
  date.setDate(date.getDate() - ((date.getDay() + 1) % 7));
  return localISODate(date);
}

function plannerDateLabel(value, options = { weekday: 'long', day: 'numeric', month: 'long' }) {
  if (!isValidISODate(value)) return 'غير محدد';
  return new Intl.DateTimeFormat('ar-EG', options).format(new Date(value + 'T12:00:00'));
}

function plannerDurationLabel(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return rest + ' دقيقة';
  return hours + ' ساعة' + (rest ? ' و ' + rest + ' دقيقة' : '');
}

function plannerTaskMinutes(task) {
  const start = plannerTimeMinutes(task.startTime);
  const end = plannerTimeMinutes(task.endTime);
  if (Number.isFinite(start) && Number.isFinite(end) && start !== end) {
    return end > start ? end - start : 1440 - start + end;
  }
  return Math.max(0, Number(task.estimateMinutes) || 0);
}

function plannerTaskHasSlot(task) {
  return isValidISODate(task.date) &&
    Number.isFinite(plannerTimeMinutes(task.startTime)) &&
    Number.isFinite(plannerTimeMinutes(task.endTime)) &&
    task.startTime !== task.endTime;
}

function plannerTaskSegments(task) {
  if (!plannerTaskHasSlot(task)) return [];
  const start = plannerTimeMinutes(task.startTime);
  const end = plannerTimeMinutes(task.endTime);
  const absoluteEnd = end > start ? end : end + 1440;
  const segments = [{
    date: task.date,
    start,
    end: Math.min(1440, absoluteEnd)
  }];
  if (absoluteEnd > 1440) {
    segments.push({
      date: plannerDateShift(task.date, 1),
      start: 0,
      end: absoluteEnd - 1440
    });
  }
  return segments.filter(segment => segment.end > segment.start);
}

function plannerPriorityScore(task, date = localISODate()) {
  const priorityPoints = { 'عاجل': 48, 'عالية': 36, 'متوسطة': 22, 'منخفضة': 10 };
  const impact = Math.max(1, Math.min(5, Number(task.impact) || 3));
  let urgency = 0;
  if (isValidISODate(task.dueDate)) {
    const today = new Date(date + 'T12:00:00');
    const due = new Date(task.dueDate + 'T12:00:00');
    const days = Math.round((due - today) / 86400000);
    urgency = days < 0 ? 45 : days === 0 ? 38 : days <= 2 ? 30 : days <= 7 ? 20 : days <= 14 ? 10 : 0;
  }
  const effort = Math.max(15, Number(task.estimateMinutes) || 45);
  const ageDays = isValidISODate(String(task.createdAt || '').slice(0, 10))
    ? Math.max(0, Math.min(14, Math.floor((new Date(date + 'T12:00:00') -
        new Date(String(task.createdAt).slice(0, 10) + 'T12:00:00')) / 86400000)))
    : 0;
  return (priorityPoints[task.priority] || 22) + impact * 8 + urgency + Math.min(10, ageDays) - effort / 45;
}

function plannerTaskSort(a, b, date = localISODate()) {
  const scoreDiff = plannerPriorityScore(b, date) - plannerPriorityScore(a, date);
  if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
  const dueA = isValidISODate(a.dueDate) ? a.dueDate : '9999-12-31';
  const dueB = isValidISODate(b.dueDate) ? b.dueDate : '9999-12-31';
  return dueA.localeCompare(dueB) || (Number(a.estimateMinutes) || 0) - (Number(b.estimateMinutes) || 0);
}

function plannerDayOfWeek(date) {
  return new Date(date + 'T12:00:00').getDay();
}

function plannerAvailableWindows(date, area) {
  const rules = plannerRules();
  const configuredStart = plannerTimeMinutes(rules.dayStart);
  const configuredEnd = plannerTimeMinutes(rules.dayEnd);
  const sleepStart = plannerTimeMinutes(rules.sleepStart);
  const sleepEnd = plannerTimeMinutes(rules.sleepEnd);
  if (!Number.isFinite(configuredStart) || !Number.isFinite(configuredEnd) ||
      !Number.isFinite(sleepStart) || !Number.isFinite(sleepEnd)) return [];
  const dayStart = Math.max(configuredStart, sleepEnd);
  const dayEnd = Math.min(configuredEnd, sleepStart);
  if (dayEnd <= dayStart) return [];
  const workDay = rules.workDays.includes(plannerDayOfWeek(date));
  const workStart = plannerTimeMinutes(rules.workStart);
  const workEnd = plannerTimeMinutes(rules.workEnd);

  if (area === 'work') {
    if (!workDay || !Number.isFinite(workStart) || !Number.isFinite(workEnd) || workEnd <= workStart) return [];
    return [{ start: Math.max(dayStart, workStart), end: Math.min(dayEnd, workEnd) }]
      .filter(window => window.end > window.start);
  }

  const windows = [{ start: dayStart, end: dayEnd }];
  if (workDay && workEnd > workStart) {
    const before = { start: dayStart, end: Math.min(dayEnd, workStart) };
    const after = { start: Math.max(dayStart, workEnd), end: dayEnd };
    return [before, after].filter(window => window.end > window.start);
  }
  return windows.filter(window => window.end > window.start);
}

function plannerOccupiedSegments(date, area, ignoreId = '') {
  const segments = [];
  (Array.isArray(S.plannerTasks) ? S.plannerTasks : []).forEach(task => {
    if (!task || task.id === ignoreId || task.status === 'done' || task.status === 'archived') return;
    if (String(task.area || 'personal') !== area) return;
    plannerTaskSegments(task).forEach(segment => {
      if (segment.date === date) segments.push({
        start: segment.start,
        end: segment.end,
        taskId: task.id,
        title: task.title
      });
    });
  });
  return segments.sort((a, b) => a.start - b.start);
}

function plannerFindSlot(date, area, duration, occupied, breakMinutes = 0) {
  const windows = plannerAvailableWindows(date, area);
  const allOccupied = occupied.slice().sort((a, b) => a.start - b.start);
  for (const window of windows) {
    let cursor = Math.ceil(window.start / 5) * 5;
    for (const block of allOccupied) {
      if (block.end <= cursor || block.start >= window.end) continue;
      if (block.start - cursor >= duration) {
        return { start: cursor, end: cursor + duration };
      }
      cursor = Math.max(cursor, block.end + breakMinutes);
      cursor = Math.ceil(cursor / 5) * 5;
      if (cursor + duration > window.end) break;
    }
    if (cursor + duration <= window.end) return { start: cursor, end: cursor + duration };
  }
  return null;
}

function plannerTaskConflicts(task, ignoreId = '') {
  const conflicts = [];
  const segments = plannerTaskSegments(task);
  segments.forEach(segment => {
    const blocks = plannerOccupiedSegments(segment.date, String(task.area || 'personal'), ignoreId || task.id);
    blocks.forEach(block => {
      if (segment.start < block.end && block.start < segment.end) {
        conflicts.push('يتداخل مع «' + block.title + '»');
      }
    });
    const windows = plannerAvailableWindows(segment.date, String(task.area || 'personal'));
    const covered = windows.some(window => segment.start >= window.start && segment.end <= window.end);
    if (!covered) conflicts.push('خارج ساعات ' + (task.area === 'work' ? 'العمل المتاحة' : 'الوقت الشخصي المتاح'));
  });
  return [...new Set(conflicts)];
}

function plannerCanEdit() {
  return Boolean(plannerCloudInitialized && cloudPlannerSupported && !plannerSaveInFlight && !plannerLoadInFlight);
}

function plannerTaskIsOpen(task) {
  return task && !['done', 'archived'].includes(task.status);
}

function plannerTaskDueToday(task, date) {
  return task.dueDate === date || task.date === date;
}

function plannerTaskOverdue(task, date) {
  return isValidISODate(task.dueDate) && task.dueDate < date && plannerTaskIsOpen(task);
}

function plannerTaskStatusSelect(task, canEdit) {
  return '<select class="form-select form-select-sm planner-status-select" data-planner-status="' + esc(task.id) +
    '" aria-label="حالة المهمة" ' + (!canEdit ? 'disabled' : '') + '>' +
    Object.keys(PLANNER_STATUS_LABELS)
      .map(status => '<option value="' + status + '" ' + (task.status === status ? 'selected' : '') + '>' +
        PLANNER_STATUS_LABELS[status] + '</option>').join('') +
    '</select>';
}

function plannerTaskCard(task, canEdit, compact = false) {
  const overdue = plannerTaskOverdue(task, localISODate());
  const isRunning = task.status === 'doing' && task.startedAt;
  const duration = Number(task.actualMinutes) || 0;
  const planned = Number(task.estimateMinutes) || 0;
  const score = Math.round(plannerPriorityScore(task));
  const dueText = task.dueDate ? plannerDateLabel(task.dueDate, { day: 'numeric', month: 'short' }) : 'بدون موعد نهائي';
  return '<article class="pc-task-card ' + (task.status === 'done' ? 'is-done' : '') +
    (overdue ? ' is-overdue' : '') + (isRunning ? ' is-running' : '') + '">' +
    '<div class="pc-task-main">' +
    '<div class="pc-task-flags"><span class="pc-task-area">' + (task.area === 'work' ? 'عمل' : 'شخصي') + '</span>' +
    '<span class="pc-priority priority-' + (task.priority === 'عاجل' ? 'urgent' : task.priority === 'عالية' ? 'high' : task.priority === 'منخفضة' ? 'low' : 'normal') + '">' + esc(task.priority) + '</span>' +
    (overdue ? '<span class="pc-overdue-label">متأخرة</span>' : '') +
    (task.project ? '<span class="pc-project-label">' + esc(task.project) + '</span>' : '') + '</div>' +
    '<strong class="pc-task-title">' + esc(task.title) + '</strong>' +
    '<div class="pc-task-meta"><span>' + esc(task.category) + '</span><span>الأثر ' + esc(task.impact || 3) + '/5</span>' +
    '<span>الأولوية ' + score + '</span><span>' + esc(plannerDurationLabel(planned)) + ' مقدّر</span>' +
    (duration ? '<span>' + esc(plannerDurationLabel(duration)) + ' فعلي</span>' : '') +
    '<span>الاستحقاق: ' + esc(dueText) + '</span></div>' +
    (task.note && !compact ? '<p class="pc-task-note">' + esc(task.note) + '</p>' : '') +
    (isRunning ? '<div class="pc-running-strip"><i class="bi bi-record-circle"></i> جلسة تركيز بدأت ' +
      esc(new Date(task.startedAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })) +
      ' · الوقت الجاري لا يُضاف إلا عند إنهاء الجلسة</div>' : '') +
    '</div><div class="pc-task-controls">' +
    plannerTaskStatusSelect(task, canEdit) +
    (canEdit && !['done','archived'].includes(task.status) ? (isRunning
      ? '<button type="button" class="btn btn-sm btn-warning" data-planner-focus-stop="' + esc(task.id) + '"><i class="bi bi-pause-fill"></i> إيقاف التركيز</button>'
      : '<button type="button" class="btn btn-sm btn-outline-success" data-planner-focus-start="' + esc(task.id) + '"><i class="bi bi-play-fill"></i> ابدأ التركيز</button>') : '') +
    '<button type="button" class="btn btn-sm btn-outline-primary" data-planner-edit="' + esc(task.id) + '" ' + (!canEdit ? 'disabled' : '') + '><i class="bi bi-pencil"></i></button>' +
    '<button type="button" class="btn btn-sm btn-outline-danger" data-planner-delete="' + esc(task.id) + '" ' + (!canEdit ? 'disabled' : '') + '><i class="bi bi-trash"></i></button>' +
    '</div></article>';
}

function plannerTodaySummary(date, tasks) {
  const dayTasks = tasks.filter(task => task.date === date && plannerTaskHasSlot(task));
  const dueTasks = tasks.filter(task => plannerTaskDueToday(task, date) && plannerTaskIsOpen(task));
  const done = tasks.filter(task => task.status === 'done' && (task.date === date || task.dueDate === date));
  const overdue = tasks.filter(task => plannerTaskOverdue(task, date));
  const plannedMinutes = dayTasks.reduce((sum, task) => sum + plannerTaskMinutes(task), 0);
  const actualMinutes = tasks.filter(task => task.date === date).reduce((sum, task) => sum + (Number(task.actualMinutes) || 0), 0);
  const totalCapacity = ['personal', 'work'].reduce((sum, area) =>
    sum + plannerAvailableWindows(date, area).reduce((n, w) => n + w.end - w.start, 0), 0);
  const targetCapacity = Math.floor(totalCapacity * plannerRules().targetLoad / 100);
  return {
    dayTasks, dueTasks, done, overdue, plannedMinutes, actualMinutes,
    totalCapacity, targetCapacity,
    freeMinutes: Math.max(0, targetCapacity - plannedMinutes),
    completionRate: dueTasks.length + done.length
      ? Math.round(done.length / (dueTasks.length + done.length) * 100) : 0
  };
}

function plannerTaskMatchesSearch(task) {
  const query = String(plannerCurrentSearch || '').trim().toLowerCase();
  if (!query) return true;
  return [task.title, task.project, task.category, task.note].join(' ').toLowerCase().includes(query);
}

function plannerFilteredTasks(tasks) {
  return tasks.filter(task => {
    if (!plannerTaskMatchesSearch(task)) return false;
    if (plannerCurrentAreaFilter !== 'all' && task.area !== plannerCurrentAreaFilter) return false;
    if (plannerCurrentProjectFilter !== 'all' && (task.project || 'بدون مشروع') !== plannerCurrentProjectFilter) return false;
    return true;
  });
}

function plannerRenderTimeline(date, tasks, canEdit) {
  const scheduled = tasks.filter(task => task.date === date && plannerTaskHasSlot(task) && task.status !== 'archived')
    .sort((a, b) => plannerTimeMinutes(a.startTime) - plannerTimeMinutes(b.startTime));
  const blocks = ['personal', 'work'].map(area => {
    const windows = plannerAvailableWindows(date, area);
    if (!windows.length) return '';
    const label = area === 'work' ? 'ساعات العمل' : 'الوقت الشخصي';
    const inside = scheduled.filter(task => task.area === area);
    return '<section class="pc-timeline-lane"><header><strong>' + label + '</strong><span>' +
      windows.map(window => plannerMinutesTime(window.start) + '–' + plannerMinutesTime(window.end)).join(' · ') +
      '</span></header>' +
      (inside.length ? inside.map(task => '<div class="pc-time-item ' + (task.status === 'done' ? 'is-done' : task.status === 'doing' ? 'is-running' : '') + '">' +
        '<time>' + esc(task.startTime) + ' – ' + esc(task.endTime) + '</time><div><strong>' + esc(task.title) +
        '</strong><small>' + esc(task.project || task.category) + ' · ' + esc(PLANNER_STATUS_LABELS[task.status] || 'مفتوحة') +
        '</small></div></div>').join('') :
        '<p class="pc-timeline-empty">لا توجد مهام محجوزة في هذه الفترة.</p>') + '</section>';
  }).join('');
  return blocks || '<p class="pc-timeline-empty">لا توجد فترات متاحة وفق إعدادات اليوم.</p>';
}

function plannerViewTabs(current) {
  const tabs = [
    ['today', 'يومي', 'bi-sun'],
    ['inbox', 'الوارد', 'bi-inbox'],
    ['backlog', 'كل المهام', 'bi-list-task'],
    ['week', 'الأسبوع', 'bi-calendar-week'],
    ['projects', 'المشروعات', 'bi-kanban'],
    ['review', 'تحليل الأداء', 'bi-graph-up-arrow']
  ];
  return tabs.map(([id, label, icon]) =>
    '<button type="button" class="pc-view-tab ' + (current === id ? 'active' : '') +
    '" data-planner-view="' + id + '"><i class="bi ' + icon + '"></i><span>' + label + '</span></button>'
  ).join('');
}

function plannerTaskForm(editing, canEdit, defaultDate) {
  const task = editing || {};
  const categories = PLANNER_CATEGORIES.map(value =>
    '<option value="' + esc(value) + '" ' + ((task.category || 'أخرى') === value ? 'selected' : '') + '>' + esc(value) + '</option>'
  ).join('');
  const priorities = PLANNER_PRIORITIES.map(value =>
    '<option value="' + value + '" ' + ((task.priority || 'متوسطة') === value ? 'selected' : '') + '>' + value + '</option>'
  ).join('');
  return '<form id="plannerTaskForm" class="pc-task-form">' +
    '<input type="hidden" name="id" value="' + esc(task.id || '') + '">' +
    '<div class="pc-form-heading"><div><span class="pc-section-kicker">' + (editing ? 'تعديل بيانات' : 'التقاط مهمة جديدة') + '</span>' +
    '<h3>' + (editing ? 'تحديث المهمة' : 'أخرجها من دماغك وسجلها') + '</h3></div>' +
    (editing ? '<button type="button" id="btnPlannerCancelEdit" class="btn btn-sm btn-outline-secondary">إلغاء</button>' : '') + '</div>' +
    '<label class="pc-field pc-field-full"><span>اسم المهمة أو النتيجة المطلوبة *</span>' +
    '<input name="title" class="form-control" maxlength="120" placeholder="مثال: إنهاء عرض سعر عميل / مذاكرة درس JavaScript" required value="' + esc(task.title || '') + '" ' + (!canEdit ? 'disabled' : '') + '></label>' +
    '<div class="pc-form-grid">' +
    '<label class="pc-field"><span>مجال المهمة</span><select class="form-select" name="area" ' + (!canEdit ? 'disabled' : '') + '>' +
    '<option value="personal" ' + ((task.area || 'personal') === 'personal' ? 'selected' : '') + '>شخصي</option>' +
    '<option value="work" ' + (task.area === 'work' ? 'selected' : '') + '>عمل / وظيفة</option></select></label>' +
    '<label class="pc-field"><span>المشروع</span><input class="form-control" name="project" maxlength="80" placeholder="مثال: تطوير مهاراتي" value="' + esc(task.project || '') + '" ' + (!canEdit ? 'disabled' : '') + '></label>' +
    '<label class="pc-field"><span>التصنيف</span><select class="form-select" name="category" ' + (!canEdit ? 'disabled' : '') + '>' + categories + '</select></label>' +
    '<label class="pc-field"><span>الأولوية</span><select class="form-select" name="priority" ' + (!canEdit ? 'disabled' : '') + '>' + priorities + '</select></label>' +
    '<label class="pc-field"><span>الأثر المتوقع (1–5)</span><select class="form-select" name="impact" ' + (!canEdit ? 'disabled' : '') + '>' +
    [1,2,3,4,5].map(n => '<option value="' + n + '" ' + (Number(task.impact || 3) === n ? 'selected' : '') + '>' + n + ' / 5</option>').join('') + '</select></label>' +
    '<label class="pc-field"><span>الوقت المتوقع (دقيقة)</span><input class="form-control" name="estimateMinutes" type="number" min="5" max="600" step="5" required value="' + esc(task.estimateMinutes || 45) + '" ' + (!canEdit ? 'disabled' : '') + '></label>' +
    '<label class="pc-field"><span>الموعد النهائي</span><input class="form-control" name="dueDate" type="date" value="' + esc(task.dueDate || '') + '" ' + (!canEdit ? 'disabled' : '') + '></label>' +
    '<label class="pc-field"><span>تاريخ التنفيذ المحجوز</span><input class="form-control" name="date" type="date" value="' + esc(task.date || '') + '" ' + (!canEdit ? 'disabled' : '') + '></label>' +
    '<label class="pc-field"><span>من الساعة</span><input class="form-control" name="startTime" type="time" value="' + esc(task.startTime || '') + '" ' + (!canEdit ? 'disabled' : '') + '></label>' +
    '<label class="pc-field"><span>إلى الساعة</span><input class="form-control" name="endTime" type="time" value="' + esc(task.endTime || '') + '" ' + (!canEdit ? 'disabled' : '') + '></label>' +
    '<label class="pc-field"><span>الحالة</span><select class="form-select" name="status" ' + (!canEdit ? 'disabled' : '') + '>' +
    Object.keys(PLANNER_STATUS_LABELS).map(status =>
      '<option value="' + status + '" ' + ((task.status || 'inbox') === status ? 'selected' : '') + '>' + PLANNER_STATUS_LABELS[status] + '</option>'
    ).join('') + '</select></label></div>' +
    '<label class="pc-field pc-field-full"><span>ملاحظات أو خطوات التنفيذ</span><textarea name="note" class="form-control" rows="2" maxlength="500" placeholder="اكتب الخطوة التالية أو أي تفاصيل مهمة" ' + (!canEdit ? 'disabled' : '') + '>' + esc(task.note || '') + '</textarea></label>' +
    '<p class="pc-form-error" id="plannerFormError" hidden role="alert"></p>' +
    '<div class="pc-form-footer"><button type="submit" class="btn btn-primary" ' + (!canEdit ? 'disabled' : '') + '>' +
    '<i class="bi bi-check-lg"></i> ' + (editing ? 'حفظ التعديلات' : 'إضافة إلى قائمة المهام') + '</button>' +
    '<span>المهام محفوظة في ورقة TASKS، ولا تؤثر على السجلات المالية.</span></div></form>';
}

function plannerSettingsCard(canEdit) {
  const rules = plannerRules();
  const dayNames = [{v:6,t:'سبت'},{v:0,t:'أحد'},{v:1,t:'اثنين'},{v:2,t:'ثلاثاء'},{v:3,t:'أربعاء'},{v:4,t:'خميس'},{v:5,t:'جمعة'}];
  return '<details class="pc-settings"><summary><i class="bi bi-sliders"></i> ضبط ساعات اليوم وقواعد التخطيط</summary>' +
    '<form id="plannerSettingsForm"><div class="pc-settings-grid">' +
    '<label>بداية اليوم<input type="time" name="dayStart" class="form-control" value="' + esc(rules.dayStart) + '" ' + (!cloudSettingsInitialized ? 'disabled' : '') + '></label>' +
    '<label>نهاية اليوم<input type="time" name="dayEnd" class="form-control" value="' + esc(rules.dayEnd) + '" ' + (!cloudSettingsInitialized ? 'disabled' : '') + '></label>' +
    '<label>بداية النوم<input type="time" name="sleepStart" class="form-control" value="' + esc(rules.sleepStart) + '" ' + (!cloudSettingsInitialized ? 'disabled' : '') + '></label>' +
    '<label>نهاية النوم<input type="time" name="sleepEnd" class="form-control" value="' + esc(rules.sleepEnd) + '" ' + (!cloudSettingsInitialized ? 'disabled' : '') + '></label>' +
    '<label>بداية العمل<input type="time" name="workStart" class="form-control" value="' + esc(rules.workStart) + '" ' + (!cloudSettingsInitialized ? 'disabled' : '') + '></label>' +
    '<label>نهاية العمل<input type="time" name="workEnd" class="form-control" value="' + esc(rules.workEnd) + '" ' + (!cloudSettingsInitialized ? 'disabled' : '') + '></label>' +
    '<label>فاصل بين المهام (دقيقة)<input type="number" min="5" max="30" step="5" name="breakMinutes" class="form-control" value="' + rules.breakMinutes + '" ' + (!cloudSettingsInitialized ? 'disabled' : '') + '></label>' +
    '<label>نسبة استغلال الوقت المستهدف<input type="number" min="60" max="95" step="5" name="targetLoad" class="form-control" value="' + rules.targetLoad + '" ' + (!cloudSettingsInitialized ? 'disabled' : '') + '></label></div>' +
    '<div class="pc-settings-days"><strong>أيام العمل</strong>' + dayNames.map(day =>
      '<label><input type="checkbox" name="workDays" value="' + day.v + '" ' + (rules.workDays.includes(day.v) ? 'checked' : '') +
      ' ' + (!cloudSettingsInitialized ? 'disabled' : '') + '><span>' + day.t + '</span></label>'
    ).join('') + '</div>' +
    '<button class="btn btn-sm btn-primary" type="submit" ' + (!cloudSettingsInitialized ? 'disabled' : '') + '>حفظ قواعد اليوم</button>' +
    (!cloudSettingsInitialized ? '<small>افتح الإعدادات وجهّز المزامنة أولًا لحفظ القواعد بين الأجهزة.</small>' : '') +
    '</form></details>';
}

function plannerDailyView(date, tasks, canEdit) {
  const summary = plannerTodaySummary(date, tasks);
  const focus = tasks.filter(task => plannerTaskIsOpen(task) &&
    (task.status === 'next' || task.status === 'inbox' || task.date === date || task.dueDate === date))
    .sort((a, b) => plannerTaskSort(a, b, date)).slice(0, 3);
  const scheduled = tasks.filter(task => task.date === date && plannerTaskHasSlot(task) && task.status !== 'archived')
    .sort((a, b) => plannerTimeMinutes(a.startTime) - plannerTimeMinutes(b.startTime));
  const runningTasks=tasks.filter(task=>task.status==='doing'&&task.startedAt);
  return '<div class="pc-daily-layout"><div class="pc-daily-main">' +
    (runningTasks.length ? '<section class="pc-running-panel"><strong><i class="bi bi-record-circle"></i> جلسة تركيز نشطة</strong>' +
      runningTasks.map(task=>'<div><span>'+esc(task.title)+'</span><small>بدأت '+esc(new Date(task.startedAt).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'}))+'</small></div>').join('') +
      '</section>' : '') +
    '<section class="pc-focus-panel"><header><div><span class="pc-section-kicker">أهم نتائج اليوم</span><h3>الثلاثة الأهم اليوم</h3>' +
    '<p>رتّبناها حسب الأولوية والأثر والموعد النهائي، وتقدر تغيّر ترتيبها بتعديل بيانات المهمة.</p></div><span class="pc-focus-icon"><i class="bi bi-bullseye"></i></span></header>' +
    (focus.length ? focus.map((task,index) =>
      '<div class="pc-focus-item"><span class="pc-focus-rank">' + (index+1) + '</span><div><strong>' + esc(task.title) +
      '</strong><small>' + esc(task.project || task.category) + ' · ' + esc(task.priority) + ' · ' + esc(plannerDurationLabel(task.estimateMinutes)) + '</small></div>' +
      '<span class="pc-focus-score">' + Math.round(plannerPriorityScore(task,date)) + '</span></div>'
    ).join('') : '<p class="pc-empty-inline">أضف مهامًا إلى صندوق الوارد لتحديد أهم 3 نتائج ليومك.</p>') +
    '</section><section class="pc-timeline-panel"><header><div><span class="pc-section-kicker">خطة الوقت</span><h3>الجدول الزمني</h3></div>' +
    '<span class="pc-small-count">' + scheduled.length + ' مهام مجدولة</span></header>' +
    plannerRenderTimeline(date, tasks, canEdit) + '</section>' +
    '<section class="pc-task-list-panel"><header><div><span class="pc-section-kicker">التنفيذ</span><h3>مهام اليوم</h3></div>' +
    '<span class="pc-small-count">' + summary.dueTasks.length + ' مستحقة · ' + summary.done.length + ' مكتملة</span></header>' +
    (summary.dueTasks.length ? summary.dueTasks.sort((a,b)=>plannerTaskSort(a,b,date)).map(task=>plannerTaskCard(task,canEdit,true)).join('') :
      '<p class="pc-empty-inline">مفيش مهام مستحقة اليوم. أضف مهمة أو استورد مهامك من صندوق الوارد.</p>') + '</section></div>' +
    '<aside class="pc-daily-aside"><section class="pc-metric-panel"><span>الوقت المحجوز</span><strong>' + esc(plannerDurationLabel(summary.plannedMinutes)) + '</strong>' +
    '<small>من ' + esc(plannerDurationLabel(summary.targetCapacity)) + ' مستهدف</small><div class="pc-progress-track"><span style="width:' +
    Math.min(100, summary.targetCapacity ? summary.plannedMinutes / summary.targetCapacity * 100 : 0) + '%"></span></div></section>' +
    '<section class="pc-metric-panel"><span>التركيز الفعلي المسجل</span><strong>' + esc(plannerDurationLabel(summary.actualMinutes)) + '</strong><small>وقت جلسات التركيز المنتهية</small></section>' +
    '<section class="pc-metric-panel"><span>الوقت غير المخصص</span><strong>' + esc(plannerDurationLabel(summary.freeMinutes)) + '</strong><small>مساحة للطوارئ والراحة</small></section>' +
    '<section class="pc-metric-panel ' + (summary.overdue.length ? 'has-alert' : '') + '"><span>مهام متأخرة</span><strong>' + summary.overdue.length + '</strong><small>' +
    (summary.overdue.length ? 'راجع المواعيد وأعد ترتيبها' : 'لا توجد مهام متأخرة') + '</small></section>' +
    '<button type="button" class="btn btn-primary w-100" id="btnPlannerAutoPlan" ' + (!canEdit ? 'disabled' : '') + '><i class="bi bi-magic"></i> خطّط يومي تلقائيًا</button>' +
    '<button type="button" class="btn btn-outline-primary w-100" id="btnPlannerNewTask" ' + (!canEdit ? 'disabled' : '') + '><i class="bi bi-plus-lg"></i> مهمة جديدة</button>' +
    '</aside></div>';
}

function plannerInboxView(tasks, canEdit) {
  const inbox = plannerFilteredTasks(tasks.filter(task => ['inbox','next'].includes(task.status)))
    .sort((a,b)=>plannerTaskSort(a,b,localISODate()));
  return '<section class="pc-content-panel"><header><div><span class="pc-section-kicker">التقاط سريع بدون ضغط</span><h3>صندوق الوارد</h3>' +
    '<p>أي فكرة أو التزام يظهر في دماغك سجله هنا أولًا. بعد كده حدّد أثره وموعده ووقت تنفيذه.</p></div><span class="pc-small-count">' + inbox.length + ' مهمة غير مجدولة</span></header>' +
    (inbox.length ? inbox.map(task=>plannerTaskCard(task,canEdit)).join('') : '<p class="pc-empty-inline">صندوق الوارد فارغ. ممتاز، أو سجّل أي التزام جديد فور ظهوره بدل ما تنساه.</p>') +
    '</section>';
}

function plannerBacklogView(tasks, canEdit) {
  const backlog = plannerFilteredTasks(tasks)
    .sort((a,b)=>plannerTaskSort(a,b,localISODate()));
  const groups = ['doing','scheduled','next','inbox','postponed','done','archived'];
  return '<section class="pc-content-panel"><header><div><span class="pc-section-kicker">قاعدة المهام الكاملة</span><h3>كل المهام</h3>' +
    '<p>ابحث وصنّف مهامك، وغيّر حالتها أو موعدها أو المشروع المرتبط بها.</p></div><span class="pc-small-count">' + backlog.length + ' مهمة</span></header>' +
    '<div class="pc-filter-row"><input class="form-control" id="plannerSearch" placeholder="ابحث باسم المهمة أو المشروع..." value="' + esc(plannerCurrentSearch) + '">' +
    '<select class="form-select" id="plannerAreaFilter"><option value="all">كل المجالات</option><option value="personal" ' + (plannerCurrentAreaFilter==='personal'?'selected':'') + '>شخصي</option><option value="work" ' + (plannerCurrentAreaFilter==='work'?'selected':'') + '>عمل</option></select>' +
    '<select class="form-select" id="plannerProjectFilter"><option value="all">كل المشروعات</option>' +
    [...new Set(tasks.map(task=>task.project).filter(Boolean))].sort().map(name=>'<option value="' + esc(name) + '" ' + (plannerCurrentProjectFilter===name?'selected':'') + '>' + esc(name) + '</option>').join('') +
    '</select></div>' +
    groups.map(status=>{
      const items=backlog.filter(task=>task.status===status);
      if(!items.length)return '';
      return '<section class="pc-status-group"><header><strong>' + PLANNER_STATUS_LABELS[status] + '</strong><span>' + items.length + '</span></header>' +
        items.map(task=>plannerTaskCard(task,canEdit)).join('') + '</section>';
    }).join('') + '</section>';
}

function plannerWeekView(date,tasks,canEdit) {
  const start=plannerWeekStart(date);
  const dates=Array.from({length:7},(_,i)=>plannerDateShift(start,i));
  const days=dates.map(day=>{
    const items=tasks.filter(task=>task.date===day&&plannerTaskHasSlot(task)).sort((a,b)=>plannerTimeMinutes(a.startTime)-plannerTimeMinutes(b.startTime));
    const completed=tasks.filter(task=>task.date===day&&task.status==='done').length;
    return '<section class="pc-week-day ' + (day===localISODate()?'is-today':'') + '"><header><strong>' +
      esc(plannerDateLabel(day,{weekday:'long'})) + '</strong><span>' + esc(plannerDateLabel(day,{day:'numeric',month:'short'})) +
      '</span><small>' + completed + ' / ' + items.length + ' مكتملة</small></header>' +
      (items.length?items.map(task=>'<div class="pc-week-item"><time>' + esc(task.startTime) + '</time><span>' + esc(task.title) + '</span></div>').join('') :
      '<p>لا توجد مهام مجدولة</p>') + '</section>';
  }).join('');
  return '<section class="pc-content-panel"><header><div><span class="pc-section-kicker">خريطة الأسبوع</span><h3>منظور أسبوعي</h3><p>' +
    esc(plannerDateLabel(start,{day:'numeric',month:'long'})) + ' — ' + esc(plannerDateLabel(dates[6],{day:'numeric',month:'long',year:'numeric'})) +
    '</p></div><div class="pc-week-nav"><button class="btn btn-sm btn-outline-secondary" id="btnPlannerPrevWeek">السابق</button>' +
    '<button class="btn btn-sm btn-outline-secondary" id="btnPlannerNextWeek">التالي</button></div></header>' +
    '<div class="pc-week-grid">' + days + '</div></section>';
}

function plannerProjectsView(tasks,canEdit) {
  const projects=new Map();
  tasks.filter(task=>task.status!=='archived').forEach(task=>{
    const key=task.project||'بدون مشروع';
    if(!projects.has(key))projects.set(key,[]);
    projects.get(key).push(task);
  });
  const cards=[...projects.entries()].sort((a,b)=>a[0].localeCompare(b[0],'ar')).map(([name,items])=>{
    const done=items.filter(task=>task.status==='done').length;
    const open=items.filter(plannerTaskIsOpen).length;
    const estimate=items.reduce((sum,task)=>sum+(Number(task.estimateMinutes)||0),0);
    const actual=items.reduce((sum,task)=>sum+(Number(task.actualMinutes)||0),0);
    const progress=items.length?Math.round(done/items.length*100):0;
    return '<article class="pc-project-card"><header><div><span class="pc-section-kicker">مشروع</span><h4>' + esc(name) +
      '</h4></div><strong>' + progress + '%</strong></header><div class="pc-progress-track"><span style="width:' + progress + '%"></span></div>' +
      '<div class="pc-project-metrics"><span>' + open + ' مفتوحة</span><span>' + done + ' مكتملة</span><span>' + esc(plannerDurationLabel(estimate)) + ' مقدر</span><span>' +
      esc(plannerDurationLabel(actual)) + ' فعلي</span></div>' + items.sort((a,b)=>plannerTaskSort(a,b)).slice(0,4).map(task=>plannerTaskCard(task,canEdit,true)).join('') +
      '</article>';
  }).join('');
  return '<section class="pc-content-panel"><header><div><span class="pc-section-kicker">إدارة النتائج على مستوى المشروع</span><h3>المشروعات ومجالات الإنجاز</h3>' +
    '<p>كل مهمة يمكن ربطها بمشروع، وبكده تقدر تشوف تقدم كل مشروع بدل قائمة مهام غير مترابطة.</p></div><span class="pc-small-count">' + projects.size + ' مشروعات</span></header>' +
    (cards?'<div class="pc-project-grid">'+cards+'</div>':'<p class="pc-empty-inline">أضف اسم مشروع عند إنشاء المهمة لتجميع المهام ومتابعة تقدمه.</p>') +
    '</section>';
}

function plannerReviewView(tasks,date) {
  const weekStart=plannerWeekStart(date);
  const weekDates=Array.from({length:7},(_,i)=>plannerDateShift(weekStart,i));
  const weekTasks=tasks.filter(task=>weekDates.includes(task.date)||weekDates.includes(task.dueDate));
  const completed=weekTasks.filter(task=>task.status==='done');
  const open=weekTasks.filter(plannerTaskIsOpen);
  const overdue=weekTasks.filter(task=>plannerTaskOverdue(task,date));
  const estimated=completed.reduce((sum,task)=>sum+(Number(task.estimateMinutes)||0),0);
  const actual=completed.reduce((sum,task)=>sum+(Number(task.actualMinutes)||0),0);
  const delta=actual-estimated;
  const areas=['personal','work'].map(area=>{
    const subset=weekTasks.filter(task=>task.area===area);
    const mins=subset.reduce((sum,task)=>sum+(Number(task.actualMinutes)||0),0);
    return '<div class="pc-review-area"><span>' + (area==='work'?'العمل':'الشخصي') + '</span><strong>' +
      esc(plannerDurationLabel(mins)) + '</strong><small>' + subset.length + ' مهام · ' + subset.filter(task=>task.status==='done').length + ' مكتملة</small></div>';
  }).join('');
  const days=weekDates.map(day=>{
    const due=weekTasks.filter(task=>task.date===day||task.dueDate===day);
    const done=due.filter(task=>task.status==='done').length;
    return '<div class="pc-review-day"><span>'+esc(plannerDateLabel(day,{weekday:'short'}))+'</span><strong>'+done+'/'+due.length+'</strong></div>';
  }).join('');
  return '<section class="pc-content-panel"><header><div><span class="pc-section-kicker">مراجعة أسبوعية بالأرقام</span><h3>هل وقتك بيقربك من أهدافك؟</h3>' +
    '<p>قارن الوقت المخطط بالفعلي، واكتشف الفرق بين العمل والتطوير الشخصي.</p></div></header>' +
    '<div class="pc-review-kpis"><article><span>المهام المكتملة</span><strong>' + completed.length + '</strong></article>' +
    '<article><span>المهام المفتوحة</span><strong>' + open.length + '</strong></article>' +
    '<article><span>المهام المتأخرة</span><strong>' + overdue.length + '</strong></article>' +
    '<article><span>الوقت الفعلي</span><strong>' + esc(plannerDurationLabel(actual)) + '</strong></article></div>' +
    '<div class="pc-review-columns"><section><h4>توزيع الوقت المسجل</h4><div class="pc-review-areas">' + areas + '</div></section>' +
    '<section><h4>دقة التقدير للمهام المكتملة</h4><strong class="pc-review-delta">' + (delta>0?'+':'') + esc(plannerDurationLabel(Math.abs(delta))) +
    '</strong><p>' + (delta>0?'استهلكت وقتًا أكثر من تقديرك. راجع تقديرات المهام المشابهة.':delta<0?'أنجزت أسرع من التقدير. استمر في معايرة توقعاتك.':'تقديرك قريب من الوقت الفعلي.') +
    '</p><small>المقدّر: ' + esc(plannerDurationLabel(estimated)) + ' · الفعلي: ' + esc(plannerDurationLabel(actual)) + '</small></section></div>' +
    '<h4>إنجاز كل يوم</h4><div class="pc-review-days">' + days + '</div></section>';
}

function plannerDraftPanel() {
  if(!plannerScheduleDraft)return '';
  const tasks=plannerScheduleDraft.tasks||[];
  const missed=plannerScheduleDraft.unplaced||[];
  return '<section class="pc-draft-panel"><header><div><span class="pc-section-kicker">اقتراح غير محفوظ</span><h3>خطة اليوم المقترحة</h3>' +
    '<p>راجع الفترات ثم اعتمدها. لن يتم إرسال أي تغيير قبل موافقتك.</p></div><strong>' + tasks.length + ' اقتراح</strong></header>' +
    (tasks.length?tasks.map(task=>'<div class="pc-draft-item"><time>' + esc(task.startTime) + '–' + esc(task.endTime) +
      '</time><strong>' + esc(task.title) + '</strong><span>' + (task.area==='work'?'عمل':'شخصي') + '</span></div>').join('') :
      '<p>لا توجد مهام جديدة قابلة للجدولة اليوم.</p>') +
    (missed.length?'<div class="pc-unplaced"><strong>مهام لم تتسع لها ساعات اليوم</strong>' + missed.map(task=>'<p>'+esc(task.title)+' — '+esc(task.reason)+'</p>').join('')+'</div>':'') +
    '<footer><button type="button" class="btn btn-primary" id="btnPlannerApplyDraft" ' + (!plannerCanEdit()||!tasks.length?'disabled':'') + '>اعتماد الجدول وحفظه</button>' +
    '<button type="button" class="btn btn-outline-secondary" id="btnPlannerDiscardDraft">إلغاء</button></footer></section>';
}

function vPlanner() {
  const date=isValidISODate(S.ui.plannerDate)?S.ui.plannerDate:localISODate();
  const view=['today','inbox','backlog','week','projects','review'].includes(S.ui.plannerView)?S.ui.plannerView:'today';
  const tasks=Array.isArray(S.plannerTasks)?S.plannerTasks:[];
  const canEdit=plannerCanEdit();
  const editing=plannerEditingTaskId?tasks.find(task=>task.id===plannerEditingTaskId):null;
  const summary=plannerTodaySummary(date,tasks);
  const taskCount=tasks.filter(plannerTaskIsOpen).length;
  const viewBody=view==='today'?plannerDailyView(date,tasks,canEdit):
    view==='inbox'?plannerInboxView(tasks,canEdit):
    view==='backlog'?plannerBacklogView(tasks,canEdit):
    view==='week'?plannerWeekView(date,tasks,canEdit):
    view==='projects'?plannerProjectsView(tasks,canEdit):plannerReviewView(tasks,date);
  const syncNotice=!cloudPlannerSupported||!plannerCloudInitialized
    ?'<div class="pc-sync-warning"><i class="bi bi-cloud-exclamation"></i><div><strong>مزامنة المهام غير مؤكدة</strong><span>'+esc(plannerCloudStatus||'جارٍ الاتصال بورقة TASKS')+'</span></div><button class="btn btn-sm btn-outline-primary" id="btnPlannerSync" type="button">إعادة المحاولة</button></div>'
    :'<div class="pc-sync-ok"><i class="bi bi-cloud-check"></i><span>متصل بورقة TASKS · آخر تحديث '+esc(plannerCloudLastUpdated||'الآن')+'</span><button class="btn btn-sm btn-outline-secondary" id="btnPlannerSync" type="button">مزامنة</button></div>';
  return '<section class="productivity-command-center">' +
    '<header class="pc-hero"><div><span class="pc-hero-eyebrow"><i class="bi bi-compass"></i> MEYAAR · PRODUCTIVITY OS</span>' +
    '<h2>مركز قيادة يومك</h2><p>اجمع كل مهامك، اختار الأهم، خصص لها وقتًا واقعيًا، وسجّل التنفيذ الفعلي.</p>' +
    '<div class="pc-date-control"><button class="btn btn-sm btn-light" id="btnPlannerDatePrev"><i class="bi bi-chevron-right"></i></button>' +
    '<input type="date" id="plannerAnchorDate" value="' + esc(date) + '">' +
    '<button class="btn btn-sm btn-light" id="btnPlannerDateNext"><i class="bi bi-chevron-left"></i></button>' +
    '<button class="btn btn-sm btn-outline-light" id="btnPlannerToday">اليوم</button></div></div>' +
    '<div class="pc-hero-score"><span>إنجاز اليوم</span><strong>' + summary.completionRate + '%</strong><small>' + summary.done.length + ' مكتملة من ' + (summary.done.length+summary.dueTasks.length) + ' مهمة</small></div></header>' +
    syncNotice +
    '<nav class="pc-view-tabs">' + plannerViewTabs(view) + '</nav>' +
    viewBody +
    plannerDraftPanel() +
    '<section class="pc-capture-area">' + plannerTaskForm(editing,canEdit,date) + '</section>' +
    plannerSettingsCard(cloudSettingsInitialized&&!cloudSettingsSyncInFlight) +
    '</section>';
}

async function loadPlannerTasksFromGoogle({renderAfter=true,manual=false}={}) {
  if(plannerLoadInFlight)return false;
  plannerLoadInFlight=true;
  try {
    const response=await fetch(API_URL+'?action=tasks&_='+Date.now(),{method:'GET',cache:'no-store'});
    if(!response.ok)throw new Error('Google Sheets HTTP '+response.status);
    const result=await response.json();
    if(!result||result.success===false||!Array.isArray(result.tasks)||!Array.isArray(result.deletedIds)) {
      throw new Error('تحديث Code.gs مطلوب لدعم قاعدة المهام المطورة. لم يتم تغيير أي سجل مالي.');
    }
    const remote=normalizeState({...S,plannerTasks:result.tasks}).plannerTasks;
    const deleted=new Set(result.deletedIds.map(String));
    const remoteIds=new Set(remote.map(task=>String(task.id)));
    const baselineIds=new Set((plannerLegacyBaselineTasks||[]).map(task=>String(task&&task.id||'')));
    const localOnly=(S.plannerTasks||[]).filter(task=>task&&task.id&&!remoteIds.has(String(task.id))&&!deleted.has(String(task.id))&&!baselineIds.has(String(task.id)));
    for(const task of localOnly) {
      try {
        const saved=await postGooglePayload({action:'savetask',task,expectedUpdatedAt:''});
        if(saved&&saved.task)remote.push(saved.task);
      } catch(error) {
        console.warn('تعذر نقل مهمة محلية إلى TASKS:',error);
      }
    }
    S.plannerTasks=normalizeState({...S,plannerTasks:remote}).plannerTasks;
    plannerDeletedIds=deleted;
    save();
    cloudPlannerSupported=true;
    plannerCloudInitialized=true;
    plannerCloudStatus='تم تحميل المهام';
    plannerCloudLastUpdated=new Date().toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
    return true;
  } catch(error) {
    cloudPlannerSupported=false;
    plannerCloudInitialized=false;
    plannerCloudStatus=error&&error.message?error.message:'تعذر الاتصال بورقة TASKS';
    console.error('تعذر تحميل المهام:',error);
    if(manual)showAppToast(plannerCloudStatus,6500);
    return false;
  } finally {
    plannerLoadInFlight=false;
    if(renderAfter&&S.ui.tab==='plan')render();
  }
}

async function persistPlannerTask(task,expectedUpdatedAt='',successMessage='تم حفظ المهمة') {
  if(!plannerCloudInitialized||!cloudPlannerSupported) {
    showAppToast('المزامنة غير جاهزة؛ لم أعتبر المهمة محفوظة على Google Sheets.',5500);
    return false;
  }
  if(plannerSaveInFlight||plannerLoadInFlight)return false;
  plannerSaveInFlight=true;
  render();
  try {
    const result=await postGooglePayload({action:'savetask',task,expectedUpdatedAt:String(expectedUpdatedAt||'')});
    if(!result||result.success===false||!result.task)throw new Error((result&&(result.message||result.error))||'لم تؤكد Google حفظ المهمة');
    const normalized=normalizeState({...S,plannerTasks:[...(S.plannerTasks||[]).filter(item=>item.id!==result.task.id),result.task]}).plannerTasks;
    S.plannerTasks=normalized;
    plannerEditingTaskId='';
    save();
    showAppToast(successMessage,3000);
    return true;
  } catch(error) {
    const message=error&&error.message?error.message:String(error);
    if(message.includes('TASK_CONFLICT')) {
      await loadPlannerTasksFromGoogle({renderAfter:false});
      showAppToast('المهمة اتعدّلت من جهاز آخر. حمّلت أحدث نسخة؛ راجعها قبل إعادة المحاولة.',6000);
    } else showAppToast('فشل حفظ المهمة: '+message,6500);
    return false;
  } finally {
    plannerSaveInFlight=false;
    render();
  }
}

async function persistPlannerTaskDeletion(task) {
  if(!plannerCanEdit())return false;
  if(!confirm('حذف المهمة «'+task.title+'» نهائيًا من قائمة المهام؟'))return false;
  plannerSaveInFlight=true;
  render();
  try {
    const result=await postGooglePayload({action:'deletetask',id:task.id,expectedUpdatedAt:String(task.updatedAt||'')});
    if(!result||result.success===false)throw new Error((result&&(result.message||result.error))||'لم تؤكد Google الحذف');
    S.plannerTasks=(S.plannerTasks||[]).filter(item=>item.id!==task.id);
    plannerDeletedIds.add(String(task.id));
    save();
    showAppToast('تم حذف المهمة من TASKS.',3000);
    return true;
  } catch(error) {
    const message=error&&error.message?error.message:String(error);
    if(message.includes('TASK_CONFLICT'))await loadPlannerTasksFromGoogle({renderAfter:false});
    showAppToast('لم يتم تأكيد حذف المهمة: '+message,6000);
    return false;
  } finally {
    plannerSaveInFlight=false;
    render();
  }
}

function plannerGenerateDay(date,tasks) {
  const candidates=tasks.filter(task=>['inbox','next'].includes(task.status))
    .sort((a,b)=>plannerTaskSort(a,b,date));
  const occupied={
    personal:plannerOccupiedSegments(date,'personal'),
    work:plannerOccupiedSegments(date,'work')
  };
  const additions=[];
  const unplaced=[];
  const availableMinutes=['personal','work'].reduce((sum,area)=>
    sum+plannerAvailableWindows(date,area).reduce((n,w)=>n+w.end-w.start,0),0);
  const targetLimit=Math.floor(availableMinutes*plannerRules().targetLoad/100);
  let addedMinutes=tasks.filter(task=>task.date===date&&plannerTaskHasSlot(task))
    .reduce((sum,task)=>sum+plannerTaskMinutes(task),0);
  for(const task of candidates) {
    const area=task.area==='work'?'work':'personal';
    const duration=Math.max(5,Number(task.estimateMinutes)||45);
    if(addedMinutes+duration>targetLimit) {
      unplaced.push({id:task.id,title:task.title,reason:'تم الوصول إلى حد استغلال الوقت المستهدف ('+plannerRules().targetLoad+'%).'});
      continue;
    }
    const slot=plannerFindSlot(date,area,duration,occupied[area],plannerRules().breakMinutes);
    if(!slot) {
      unplaced.push({id:task.id,title:task.title,reason:'لا توجد فترة متصلة كافية داخل ساعات '+(area==='work'?'العمل':'الوقت الشخصي')+'.'});
      continue;
    }
    const updated={
      ...task,
      updatedAtBefore:String(task.updatedAt || ''),
      date,
      startTime:plannerMinutesTime(slot.start),
      endTime:plannerMinutesTime(slot.end),
      status:'scheduled',
      updatedAt:new Date().toISOString()
    };
    additions.push(updated);
    occupied[area].push({start:slot.start,end:slot.end,taskId:task.id,title:task.title});
    // Break time is added to the occupied area only for finding the next task.
    occupied[area].push({start:slot.end,end:Math.min(slot.end+plannerRules().breakMinutes,1439),taskId:'break-'+task.id,title:'فاصل استراحة'});
    addedMinutes+=duration;
  }
  return {tasks:additions,unplaced,targetMinutes:targetLimit,plannedMinutes:addedMinutes};
}

async function plannerApplyScheduleDraft() {
  if(!plannerScheduleDraft||!plannerScheduleDraft.tasks.length||!plannerCanEdit())return;
  const plan=plannerScheduleDraft.tasks.slice();
  plannerSaveInFlight=true;
  render();
  let saved=0;
  const failures=[];
  try {
    for(const task of plan) {
      const payloadTask={...task};
      delete payloadTask.updatedAtBefore;
      const result=await postGooglePayload({
        action:'savetask',
        task:payloadTask,
        expectedUpdatedAt:String(task.updatedAtBefore||'')
      });
      if(!result||result.success===false||!result.task) {
        failures.push((result&&(result.error||result.message))||('تعذر حفظ '+task.title));
        break;
      }
      S.plannerTasks=normalizeState({...S,plannerTasks:[...(S.plannerTasks||[]).filter(item=>item.id!==result.task.id),result.task]}).plannerTasks;
      save();
      saved++;
    }
    plannerScheduleDraft.tasks=plan.slice(saved);
    if(!plannerScheduleDraft.tasks.length)plannerScheduleDraft=null;
    showAppToast(failures.length?'تم حفظ '+saved+' مهمة وتعذر تأكيد الباقي: '+failures[0]:'تم حفظ '+saved+' مهام في الجدول اليومي.',6000);
  } catch(error) {
    showAppToast('توقف اعتماد الخطة بعد '+saved+' مهمة: '+(error&&error.message?error.message:String(error)),6500);
  } finally {
    plannerSaveInFlight=false;
    render();
  }
}

async function plannerSaveSettings(form) {
  if(!cloudSettingsInitialized)return showAppToast('جهّز مزامنة الإعدادات أولًا حتى تُحفظ قواعد التخطيط على كل أجهزتك.',5000);
  const data=Object.fromEntries(new FormData(form));
  const days=[...form.querySelectorAll('input[name="workDays"]:checked')].map(input=>Number(input.value));
  const timePattern=/^([01]\d|2[0-3]):[0-5]\d$/;
  if(![data.dayStart,data.dayEnd,data.sleepStart,data.sleepEnd,data.workStart,data.workEnd].every(value=>timePattern.test(value||''))) {
    return showAppToast('راجع صيغة ساعات اليوم؛ استخدم نظام 24 ساعة.',4500);
  }
  const start=plannerTimeMinutes(data.dayStart),end=plannerTimeMinutes(data.dayEnd);
  const sleepStart=plannerTimeMinutes(data.sleepStart),sleepEnd=plannerTimeMinutes(data.sleepEnd);
  const workStart=plannerTimeMinutes(data.workStart),workEnd=plannerTimeMinutes(data.workEnd);
  if(end<=start||sleepStart<=sleepEnd||workEnd<=workStart||workStart<start||workEnd>end) {
    return showAppToast('ترتيب ساعات اليوم أو النوم أو العمل غير صحيح.',5000);
  }
  if(!days.length)return showAppToast('حدد يوم عمل واحدًا على الأقل.',4000);
  const breakMinutes=Math.max(5,Math.min(30,Number(data.breakMinutes)||10));
  const targetLoad=Math.max(60,Math.min(95,Number(data.targetLoad)||85));
  const previous=S.plannerSettings;
  S.plannerSettings={dayStart:data.dayStart,dayEnd:data.dayEnd,sleepStart:data.sleepStart,sleepEnd:data.sleepEnd,
    workStart:data.workStart,workEnd:data.workEnd,workDays:days,breakMinutes,targetLoad};
  S=normalizeState(S);
  save();
  const ok=await saveSharedSettingsToGoogle();
  if(!ok) {
    S.plannerSettings=previous;
    S=normalizeState(S);
    save();
    showAppToast('تعذر تأكيد حفظ قواعد الوقت. أعد المحاولة؛ لم يتم اعتماد التغيير على السحابة.',6000);
    return;
  }
  showAppToast('تم حفظ قواعد التخطيط ومزامنتها.',3500);
  render();
}

document.addEventListener('submit',async event=>{
  const taskForm=event.target.closest('#plannerTaskForm');
  if(taskForm) {
    event.preventDefault();
    if(!plannerCanEdit())return showAppToast('انتظر اكتمال اتصال المهام قبل الحفظ.',4500);
    const data=Object.fromEntries(new FormData(taskForm));
    const title=String(data.title||'').trim();
    const estimate=Number(data.estimateMinutes);
    if(!title)return showAppToast('اكتب اسم المهمة أو النتيجة المطلوبة.',3500);
    if(!Number.isInteger(estimate)||estimate<5||estimate>600)return showAppToast('الوقت المتوقع يجب أن يكون بين 5 و600 دقيقة.',4500);
    if((data.date||'')&& !isValidISODate(data.date))return showAppToast('تاريخ التنفيذ غير صحيح.',3500);
    if((data.dueDate||'')&&!isValidISODate(data.dueDate))return showAppToast('الموعد النهائي غير صحيح.',3500);
    if(Boolean(data.startTime)!==Boolean(data.endTime))return showAppToast('اكتب وقت البداية والنهاية معًا أو اتركهما فارغين.',4500);
    if(data.startTime&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.startTime)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.endTime)||data.startTime===data.endTime)) {
      return showAppToast('أوقات التنفيذ غير صحيحة.',4000);
    }
    if(data.startTime&&!data.date)return showAppToast('حدد تاريخ التنفيذ قبل كتابة وقت البداية والنهاية.',4000);
    const existing=(S.plannerTasks||[]).find(task=>task.id===String(data.id||''));
    const now=new Date().toISOString();
    const task={
      id:existing?existing.id:(globalThis.crypto&&crypto.randomUUID?crypto.randomUUID():'task-'+Date.now()+'-'+Math.random().toString(36).slice(2,8)),
      title:title.slice(0,120),
      date:data.date||'',
      startTime:data.startTime||'',
      endTime:data.endTime||'',
      category:PLANNER_CATEGORIES.includes(data.category)?data.category:'أخرى',
      priority:PLANNER_PRIORITIES.includes(data.priority)?data.priority:'متوسطة',
      status:(data.date&&data.startTime&&data.endTime&&['inbox','next'].includes(data.status))?'scheduled':(PLANNER_STATUSES.includes(data.status)?data.status:'inbox'),
      area:PLANNER_AREAS.includes(data.area)?data.area:'personal',
      project:String(data.project||'').trim().slice(0,80),
      dueDate:data.dueDate||'',
      estimateMinutes:estimate,
      actualMinutes:existing?Number(existing.actualMinutes)||0:0,
      impact:Math.max(1,Math.min(5,Number(data.impact)||3)),
      energy:existing?existing.energy||'medium':'medium',
      recurrence:existing?existing.recurrence||'none':'none',
      parentId:existing?existing.parentId||'':'',
      startedAt:existing?existing.startedAt||'':'',
      completedAt:data.status==='done'?(existing&&existing.completedAt||now):'',
      note:String(data.note||'').trim().slice(0,500),
      createdAt:existing?existing.createdAt:now,
      updatedAt:now
    };
    if(task.status==='scheduled'&&!plannerTaskHasSlot(task)) {
      return showAppToast('الحالة مجدولة، لذلك لازم تحدد التاريخ والوقت.',4500);
    }
    const conflicts=plannerTaskConflicts(task,existing?existing.id:'');
    if(conflicts.length)return showAppToast('لا يمكن حفظ الجدولة: '+conflicts.join('، '),6000);
    const saved=await persistPlannerTask(task,existing?existing.updatedAt:'',existing?'تم تحديث المهمة.':'تمت إضافة المهمة إلى قائمة مهامك.');
    if(saved&&task.date){S.ui.plannerDate=task.date;S.ui.plannerView='today';save();render();}
    return;
  }
  const settings=event.target.closest('#plannerSettingsForm');
  if(settings) {
    event.preventDefault();
    await plannerSaveSettings(settings);
  }
});

document.addEventListener('change',async event=>{
  if(event.target.id==='plannerAnchorDate'&&isValidISODate(event.target.value)) {
    S.ui.plannerDate=event.target.value;plannerScheduleDraft=null;save();render();return;
  }
  if(event.target.matches('[data-planner-status]')) {
    if(!plannerCanEdit())return;
    const task=(S.plannerTasks||[]).find(item=>item.id===event.target.dataset.plannerStatus);
    if(!task)return;
    const status=PLANNER_STATUSES.includes(event.target.value)?event.target.value:'inbox';
    const now=new Date().toISOString();
    const updated={...task,status,updatedAt:now,completedAt:status==='done'?now:''};
    if(status!=='doing')updated.startedAt='';
    await persistPlannerTask(updated,task.updatedAt,'تم تحديث حالة المهمة.');
    return;
  }
  if(event.target.id==='plannerSearch')plannerCurrentSearch=event.target.value;
  if(event.target.id==='plannerAreaFilter')plannerCurrentAreaFilter=event.target.value;
  if(event.target.id==='plannerProjectFilter')plannerCurrentProjectFilter=event.target.value;
  if(['plannerSearch','plannerAreaFilter','plannerProjectFilter'].includes(event.target.id))render();
});

document.addEventListener('click',async event=>{
  const view=event.target.closest('[data-planner-view]');
  if(view) {S.ui.plannerView=view.dataset.plannerView;plannerScheduleDraft=null;save();render();return;}
  if(event.target.closest('#btnPlannerDatePrev')) {S.ui.plannerDate=plannerDateShift(S.ui.plannerDate,-1);plannerScheduleDraft=null;save();render();return;}
  if(event.target.closest('#btnPlannerDateNext')) {S.ui.plannerDate=plannerDateShift(S.ui.plannerDate,1);plannerScheduleDraft=null;save();render();return;}
  if(event.target.closest('#btnPlannerToday')) {S.ui.plannerDate=localISODate();plannerScheduleDraft=null;save();render();return;}
  if(event.target.closest('#btnPlannerPrevWeek')) {S.ui.plannerDate=plannerDateShift(S.ui.plannerDate,-7);save();render();return;}
  if(event.target.closest('#btnPlannerNextWeek')) {S.ui.plannerDate=plannerDateShift(S.ui.plannerDate,7);save();render();return;}
  if(event.target.closest('#btnPlannerCancelEdit')) {plannerEditingTaskId='';render();return;}
  if(event.target.closest('#btnPlannerNewTask')) {
    plannerEditingTaskId='';
    const form=$('#plannerTaskForm');
    if(form)form.scrollIntoView({behavior:'smooth',block:'center'});
    else window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});
    return;
  }
  if(event.target.closest('#btnPlannerSync')) {await loadPlannerTasksFromGoogle({renderAfter:false,manual:true});render();return;}
  if(event.target.closest('#btnPlannerAutoPlan')) {
    const date=isValidISODate(S.ui.plannerDate)?S.ui.plannerDate:localISODate();
    plannerScheduleDraft=plannerGenerateDay(date,S.plannerTasks||[]);
    if(!plannerScheduleDraft.tasks.length)showAppToast('لا توجد مهام قابلة للجدولة في الوارد أو قائمة التالية.',4000);
    render();return;
  }
  if(event.target.closest('#btnPlannerApplyDraft')) {await plannerApplyScheduleDraft();return;}
  if(event.target.closest('#btnPlannerDiscardDraft')) {plannerScheduleDraft=null;render();return;}

  const edit=event.target.closest('[data-planner-edit]');
  if(edit) {if(!plannerCanEdit())return;plannerEditingTaskId=edit.dataset.plannerEdit;render();$('#plannerTaskForm')?.scrollIntoView({behavior:'smooth',block:'center'});return;}
  const remove=event.target.closest('[data-planner-delete]');
  if(remove) {const task=(S.plannerTasks||[]).find(item=>item.id===remove.dataset.plannerDelete);if(task)await persistPlannerTaskDeletion(task);return;}
  const start=event.target.closest('[data-planner-focus-start]');
  if(start) {
    if(!plannerCanEdit())return;
    const running=(S.plannerTasks||[]).find(task=>task.status==='doing'&&task.startedAt&&task.id!==start.dataset.plannerFocusStart);
    if(running)return showAppToast('أنهِ جلسة «'+running.title+'» أولًا قبل بدء مهمة أخرى.',5000);
    const task=(S.plannerTasks||[]).find(item=>item.id===start.dataset.plannerFocusStart);
    if(!task)return;
    const now=new Date().toISOString();
    await persistPlannerTask({...task,status:'doing',startedAt:now,updatedAt:now},task.updatedAt,'بدأت جلسة التركيز.');
    return;
  }
  const stop=event.target.closest('[data-planner-focus-stop]');
  if(stop) {
    if(!plannerCanEdit())return;
    const task=(S.plannerTasks||[]).find(item=>item.id===stop.dataset.plannerFocusStop);
    if(!task||!task.startedAt)return;
    const elapsed=Math.max(1,Math.ceil((Date.now()-new Date(task.startedAt).getTime())/60000));
    const now=new Date().toISOString();
    const updated={
      ...task,
      status:plannerTaskHasSlot(task)?'scheduled':'next',
      startedAt:'',
      actualMinutes:(Number(task.actualMinutes)||0)+elapsed,
      updatedAt:now
    };
    await persistPlannerTask(updated,task.updatedAt,'تم تسجيل '+plannerDurationLabel(elapsed)+' كوقت تركيز فعلي.');
    return;
  }
});
