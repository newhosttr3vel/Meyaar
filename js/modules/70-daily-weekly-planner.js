/* Daily and weekly planner. Tasks are shared settings, never financial transactions. */
let plannerSaveInFlight = false;
let plannerEditingTaskId = '';

function plannerWeekStart(value) {
  const date = new Date((isValidISODate(value) ? value : localISODate()) + 'T12:00:00');
  const day = date.getDay();
  date.setDate(date.getDate() - ((day + 1) % 7)); // Saturday is the first day of the week.
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

function plannerTaskMinutes(task) {
  const toMinutes = value => {
    const parts = String(value || '').split(':').map(Number);
    return parts.length === 2 ? parts[0] * 60 + parts[1] : 0;
  };
  return Math.max(0, toMinutes(task.endTime) - toMinutes(task.startTime));
}

function plannerDurationLabel(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return rest + ' دقيقة';
  return hours + ' س' + (rest ? ' و ' + rest + ' د' : '');
}

function plannerCanEdit() {
  return Boolean(cloudSettingsInitialized && cloudPlannerSupported && !plannerSaveInFlight);
}

function plannerStatusNotice() {
  if (!cloudSettingsInitialized) {
    return '<div class="planner-sync-notice is-warning"><i class="bi bi-cloud-exclamation"></i><div><strong>المزامنة غير مؤكدة</strong><p>لم يتم تحميل البيانات المشتركة من Google بعد. افتح الإعدادات وتأكد من اتصال الجهاز قبل إضافة مهام.</p></div></div>';
  }
  if (!cloudPlannerSupported) {
    return '<div class="planner-sync-notice is-warning"><i class="bi bi-cloud-slash"></i><div><strong>مطلوب تحديث خدمة المزامنة</strong><p>لا تضف مهامًا حتى يتم نشر إصدار Apps Script الذي يدعم plannerTasks. بياناتك المالية لن تتأثر، لكن التخزين القديم لا يعرف قائمة المهام.</p></div></div>';
  }
  return '<div class="planner-sync-notice"><i class="bi bi-cloud-check"></i><div><strong>قائمة مهام مشتركة بين الكمبيوتر والموبايل</strong><p>أي إضافة أو تعديل أو إنجاز يتزامن مع Google Sheets، ثم يظهر على أجهزتك الأخرى بعد المزامنة.</p></div><button class="btn btn-sm btn-outline-primary" type="button" id="btnPlannerSync">مزامنة الآن</button></div>';
}

function vPlanner() {
  const anchor = isValidISODate(S.ui.plannerDate) ? S.ui.plannerDate : localISODate();
  const weekStart = plannerWeekStart(anchor);
  const weekDates = Array.from({ length: 7 }, (_, index) => plannerShiftDate(weekStart, index));
  const tasks = (Array.isArray(S.plannerTasks) ? S.plannerTasks : []).filter(task => weekDates.includes(task.date));
  tasks.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title, 'ar'));
  const completed = tasks.filter(task => task.status === 'done').length;
  const plannedMinutes = tasks.reduce((sum, task) => sum + plannerTaskMinutes(task), 0);
  const activeDays = new Set(tasks.map(task => task.date)).size;
  const canEdit = plannerCanEdit();
  const editing = plannerEditingTaskId
    ? (S.plannerTasks || []).find(task => task.id === plannerEditingTaskId)
    : null;
  const weekLabel = plannerFormatDate(weekStart, { day: 'numeric', month: 'long' }) +
    ' — ' + plannerFormatDate(weekDates[6], { day: 'numeric', month: 'long', year: 'numeric' });
  const days = weekDates.map(date => {
    const dayTasks = tasks.filter(task => task.date === date);
    const isToday = date === localISODate();
    return '<section class="planner-day-card ' + (isToday ? 'is-today' : '') + '">' +
      '<header class="planner-day-header"><div><strong>' + esc(plannerFormatDate(date, { weekday: 'long' })) +
      '</strong><span>' + esc(plannerFormatDate(date, { day: 'numeric', month: 'short' })) + '</span></div>' +
      '<span class="planner-day-count">' + dayTasks.length + '</span></header>' +
      '<div class="planner-day-tasks">' + (dayTasks.length ? dayTasks.map(task =>
        '<article class="planner-task-card ' + (task.status === 'done' ? 'is-done' : '') + ' priority-' +
        (task.priority === 'عالية' ? 'high' : task.priority === 'منخفضة' ? 'low' : 'normal') + '">' +
        '<div class="planner-task-time">' + esc(task.startTime) + '<span>–</span>' + esc(task.endTime) + '</div>' +
        '<strong class="planner-task-title">' + esc(task.title) + '</strong>' +
        '<div class="planner-task-meta"><span>' + esc(task.category) + '</span><span>' + esc(task.priority) + '</span></div>' +
        (task.note ? '<p>' + esc(task.note) + '</p>' : '') +
        '<div class="planner-task-actions"><button type="button" class="btn btn-sm ' +
        (task.status === 'done' ? 'btn-outline-secondary' : 'btn-outline-success') +
        '" data-planner-toggle="' + esc(task.id) + '" ' + (!canEdit ? 'disabled' : '') + '><i class="bi ' +
        (task.status === 'done' ? 'bi-arrow-counterclockwise' : 'bi-check2-circle') + '"></i> ' +
        (task.status === 'done' ? 'إعادة فتح' : 'تمت') + '</button>' +
        '<button type="button" class="btn btn-sm btn-outline-primary" data-planner-edit="' + esc(task.id) +
        '" ' + (!canEdit ? 'disabled' : '') + ' aria-label="تعديل المهمة"><i class="bi bi-pencil"></i></button>' +
        '<button type="button" class="btn btn-sm btn-outline-danger" data-planner-delete="' + esc(task.id) +
        '" ' + (!canEdit ? 'disabled' : '') + ' aria-label="حذف المهمة"><i class="bi bi-trash"></i></button></div></article>'
      ).join('') : '<p class="planner-day-empty">مفيش مهام مجدولة</p>') + '</div></section>';
  }).join('');

  return '<section class="planner-page">' +
    '<div class="planner-hero"><div><span class="planner-eyebrow"><i class="bi bi-calendar2-check"></i> خطتك ليومك وأسبوعك</span>' +
    '<h2>إدارة المهام والوقت</h2><p>حوّل أهدافك لأنشطة واضحة، وحدد وقت كل مهمة، وتابع تقدمك يومًا بيوم.</p></div>' +
    '<div class="planner-week-nav"><button type="button" class="btn btn-light" id="btnPlannerPrev" aria-label="الأسبوع السابق"><i class="bi bi-chevron-right"></i></button>' +
    '<div><strong>' + esc(weekLabel) + '</strong><label for="plannerAnchorDate">اختار تاريخًا للانتقال لأسبوعه</label>' +
    '<input type="date" id="plannerAnchorDate" value="' + esc(anchor) + '" class="form-control form-control-sm"></div>' +
    '<button type="button" class="btn btn-light" id="btnPlannerNext" aria-label="الأسبوع التالي"><i class="bi bi-chevron-left"></i></button></div></div>' +
    plannerStatusNotice() +
    '<div class="planner-kpis"><article><span>مهام الأسبوع</span><strong>' + tasks.length + '</strong><small>إجمالي المهام المسجلة</small></article>' +
    '<article><span>تم إنجازها</span><strong>' + completed + '</strong><small>' + (tasks.length ? Math.round(completed / tasks.length * 100) : 0) + '% من المهام</small></article>' +
    '<article><span>وقت مخطط</span><strong>' + esc(plannerDurationLabel(plannedMinutes)) + '</strong><small>حسب مواعيد البداية والنهاية</small></article>' +
    '<article><span>أيام عليها أنشطة</span><strong>' + activeDays + ' / 7</strong><small>توزيع أنشطتك خلال الأسبوع</small></article></div>' +
    '<section class="planner-form-panel"><div class="planner-section-title"><div><h3><i class="bi bi-plus-circle"></i> ' +
    (editing ? 'تعديل المهمة' : 'إضافة مهمة جديدة') + '</h3><p>حدد المهمة والوقت واليوم والأولوية. المهام لا تنشئ معاملات مالية.</p></div>' +
    (editing ? '<button type="button" class="btn btn-sm btn-outline-secondary" id="btnPlannerCancelEdit">إلغاء التعديل</button>' : '') + '</div>' +
    '<form id="plannerTaskForm"><input type="hidden" name="id" value="' + esc(editing ? editing.id : '') + '">' +
    '<div class="row g-3"><div class="col-12 col-md-6 col-xl-4"><label class="form-label" for="plannerTitle">اسم المهمة</label>' +
    '<input class="form-control" id="plannerTitle" name="title" maxlength="120" required placeholder="مثال: ساعة تعلم أو إنجاز مشروع" value="' + esc(editing ? editing.title : '') + '" ' + (!canEdit ? 'disabled' : '') + '></div>' +
    '<div class="col-6 col-md-3 col-xl-2"><label class="form-label" for="plannerDate">اليوم</label><input class="form-control" id="plannerDate" name="date" type="date" required value="' + esc(editing ? editing.date : anchor) + '" ' + (!canEdit ? 'disabled' : '') + '></div>' +
    '<div class="col-6 col-md-3 col-xl-2"><label class="form-label" for="plannerCategory">نوع النشاط</label><select class="form-select" id="plannerCategory" name="category" ' + (!canEdit ? 'disabled' : '') + '>' +
    ['عمل','تعلم','صحة','شخصي','عائلة','راحة','أخرى'].map(v => '<option ' + ((editing ? editing.category : 'شخصي') === v ? 'selected' : '') + '>' + esc(v) + '</option>').join('') + '</select></div>' +
    '<div class="col-6 col-md-3 col-xl-2"><label class="form-label" for="plannerStart">من الساعة</label><input class="form-control" id="plannerStart" name="startTime" type="time" required value="' + esc(editing ? editing.startTime : '09:00') + '" ' + (!canEdit ? 'disabled' : '') + '></div>' +
    '<div class="col-6 col-md-3 col-xl-2"><label class="form-label" for="plannerEnd">إلى الساعة</label><input class="form-control" id="plannerEnd" name="endTime" type="time" required value="' + esc(editing ? editing.endTime : '10:00') + '" ' + (!canEdit ? 'disabled' : '') + '></div>' +
    '<div class="col-6 col-md-3 col-xl-2"><label class="form-label" for="plannerPriority">الأولوية</label><select class="form-select" id="plannerPriority" name="priority" ' + (!canEdit ? 'disabled' : '') + '>' +
    ['عالية','متوسطة','منخفضة'].map(v => '<option ' + ((editing ? editing.priority : 'متوسطة') === v ? 'selected' : '') + '>' + esc(v) + '</option>').join('') + '</select></div>' +
    '<div class="col-12 col-md-9"><label class="form-label" for="plannerNote">ملاحظات (اختياري)</label><input class="form-control" id="plannerNote" name="note" maxlength="500" placeholder="خطوات صغيرة أو تفاصيل تساعدك تبدأ" value="' + esc(editing ? editing.note : '') + '" ' + (!canEdit ? 'disabled' : '') + '></div>' +
    '<div class="col-12 col-md-3 d-flex align-items-end"><button class="btn btn-primary w-100" type="submit" ' + (!canEdit ? 'disabled' : '') + '><i class="bi bi-check2"></i> ' + (editing ? 'حفظ التعديل' : 'إضافة إلى الجدول') + '</button></div></div>' +
    '<p class="planner-form-error" id="plannerFormError" role="alert" hidden></p></form></section>' +
    '<div class="planner-section-title planner-week-heading"><div><h3><i class="bi bi-calendar-week"></i> جدول الأسبوع</h3><p>الجدول يبدأ من السبت، والمهام مرتبة حسب وقت بدايتها.</p></div><span class="planner-total-pill">' + tasks.length + ' مهمة</span></div>' +
    '<div class="planner-week-grid">' + days + '</div></section>';
}

async function persistPlannerTasks(nextTasks, successMessage) {
  if (!cloudSettingsInitialized || !cloudPlannerSupported) {
    showAppToast('المزامنة المشتركة غير جاهزة. لم يتم إرسال التغيير، ولن أسمح بحفظ مهام على جهاز واحد فقط.', 5500);
    return false;
  }
  if (plannerSaveInFlight) return false;
  plannerSaveInFlight = true;
  S.plannerTasks = normalizeState({ ...S, plannerTasks: nextTasks }).plannerTasks;
  save();
  render();
  const synced = await saveSharedSettingsToGoogle();
  plannerSaveInFlight = false;
  if (synced) {
    plannerEditingTaskId = '';
    showAppToast(successMessage + ' تمت المزامنة.', 3200);
  } else {
    showAppToast('احتفظت بالتغيير على هذا الجهاز مؤقتًا، لكن Google لم تؤكد المزامنة. لا تعتبره محفوظًا على بقية الأجهزة بعد.', 6500);
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

document.addEventListener('submit', async event => {
  const form = event.target.closest('#plannerTaskForm');
  if (!form) return;
  event.preventDefault();
  if (!plannerCanEdit()) {
    plannerFormError('تأكد أولًا من اكتمال المزامنة المشتركة وتحديث خدمة Google.');
    return;
  }
  const data = Object.fromEntries(new FormData(form));
  const title = String(data.title || '').trim();
  if (!title) return plannerFormError('اكتب اسم المهمة أولًا.');
  if (!isValidISODate(data.date)) return plannerFormError('اختار تاريخًا صحيحًا.');
  if (!data.startTime || !data.endTime || data.endTime <= data.startTime) {
    return plannerFormError('وقت النهاية لازم يكون بعد وقت البداية.');
  }
  const existing = (S.plannerTasks || []).find(task => task.id === String(data.id || ''));
  const now = new Date().toISOString();
  const task = {
    id: existing ? existing.id : (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : 'task-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)),
    title, date: data.date, startTime: data.startTime, endTime: data.endTime,
    category: data.category, priority: data.priority, status: existing ? existing.status : 'todo',
    note: data.note, createdAt: existing ? existing.createdAt : now, updatedAt: now
  };
  const next = existing
    ? (S.plannerTasks || []).map(item => item.id === existing.id ? task : item)
    : [...(S.plannerTasks || []), task];
  await persistPlannerTasks(next, existing ? 'تم تعديل المهمة.' : 'تمت إضافة المهمة.');
  if (S.ui.plannerDate !== task.date) {
    S.ui.plannerDate = task.date;
    save();
    render();
  }
});

document.addEventListener('change', event => {
  if (event.target.id === 'plannerAnchorDate') {
    if (isValidISODate(event.target.value)) {
      S.ui.plannerDate = event.target.value;
      plannerEditingTaskId = '';
      save();
      render();
    }
  }
});

document.addEventListener('click', async event => {
  if (event.target.closest('#btnPlannerPrev')) {
    S.ui.plannerDate = plannerShiftDate(plannerWeekStart(S.ui.plannerDate), -7);
    plannerEditingTaskId = '';
    save(); render(); return;
  }
  if (event.target.closest('#btnPlannerNext')) {
    S.ui.plannerDate = plannerShiftDate(plannerWeekStart(S.ui.plannerDate), 7);
    plannerEditingTaskId = '';
    save(); render(); return;
  }
  if (event.target.closest('#btnPlannerCancelEdit')) {
    plannerEditingTaskId = '';
    render(); return;
  }
  if (event.target.closest('#btnPlannerSync')) {
    if (!cloudSettingsInitialized || !cloudPlannerSupported) {
      showAppToast('خدمة Google الحالية لا تؤكد دعم مزامنة المهام. حدّث Apps Script وانشره أولًا.', 5000);
      return;
    }
    const synced = await saveSharedSettingsToGoogle({ manual: true });
    showAppToast(synced ? 'تمت مزامنة المهام.' : 'لم تؤكد Google المزامنة. احتفظ بالتغييرات محليًا وراجع الإعدادات.', 4500);
    render(); return;
  }
  const edit = event.target.closest('[data-planner-edit]');
  if (edit) {
    if (!plannerCanEdit()) return;
    plannerEditingTaskId = edit.dataset.plannerEdit;
    render(); return;
  }
  const toggle = event.target.closest('[data-planner-toggle]');
  if (toggle) {
    if (!plannerCanEdit()) return;
    const task = (S.plannerTasks || []).find(item => item.id === toggle.dataset.plannerToggle);
    if (!task) return;
    await persistPlannerTasks((S.plannerTasks || []).map(item =>
      item.id === task.id ? { ...item, status: item.status === 'done' ? 'todo' : 'done', updatedAt: new Date().toISOString() } : item
    ), task.status === 'done' ? 'تمت إعادة فتح المهمة.' : 'تم إنجاز المهمة.');
    return;
  }
  const remove = event.target.closest('[data-planner-delete]');
  if (remove) {
    if (!plannerCanEdit()) return;
    const task = (S.plannerTasks || []).find(item => item.id === remove.dataset.plannerDelete);
    if (!task || !confirm('حذف المهمة «' + task.title + '»؟ لن يتغير أي سجل مالي.')) return;
    await persistPlannerTasks((S.plannerTasks || []).filter(item => item.id !== task.id), 'تم حذف المهمة.');
  }
});
