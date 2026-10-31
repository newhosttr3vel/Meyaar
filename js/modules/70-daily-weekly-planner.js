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