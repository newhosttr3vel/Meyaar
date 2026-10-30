/* Daily and weekly planner. Tasks are stored in the dedicated TASKS sheet, never as financial transactions. */

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
  return Boolean(plannerCloudInitialized && cloudPlannerSupported && !plannerSaveInFlight && !plannerLoadInFlight);
}

function plannerStatusNotice() {
  if (!cloudPlannerSupported) {
    return '<div class="planner-sync-notice is-warning"><i class="bi bi-cloud-slash"></i><div><strong>تحديث خدمة Google مطلوب</strong><p>' +
      esc(plannerCloudStatus || 'انشر إصدار Apps Script الداعم لورقة TASKS قبل إضافة أو تعديل أي مهمة.') +
      '</p></div><button class="btn btn-sm btn-outline-primary" type="button" id="btnPlannerSync">إعادة المحاولة</button></div>';
  }
  if (!plannerCloudInitialized) {
    return '<div class="planner-sync-notice is-warning"><i class="bi bi-cloud-arrow-down"></i><div><strong>جارٍ تحميل المهام</strong><p>' +
      esc(plannerCloudStatus || 'بيتم تحميل جدولك من ورقة TASKS.') +
      '</p></div><button class="btn btn-sm btn-outline-primary" type="button" id="btnPlannerSync">مزامنة الآن</button></div>';
  }
  return '<div class="planner-sync-notice"><i class="bi bi-cloud-check"></i><div><strong>المهام محفوظة في TASKS ومشتركة بين أجهزتك</strong><p>آخر تحديث: ' +
    esc(plannerCloudLastUpdated || 'تم الاتصال') +
    ' · التعديلات تتزامن من Google Sheets، بعيدًا عن بيانات المعاملات المالية.</p></div><button class="btn btn-sm btn-outline-primary" type="button" id="btnPlannerSync">مزامنة الآن</button></div>';
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
    '<div class="col-6 col-md-3 col-xl-2"><label class="form-label" for="plannerStart">من الساعة (24 ساعة)</label><input class="form-control" id="plannerStart" name="startTime" type="text" inputmode="numeric" maxlength="5" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" placeholder="09:00" title="اكتب الوقت بصيغة 24 ساعة مثل 09:00 أو 22:30" required value="' + esc(editing ? editing.startTime : '09:00') + '" ' + (!canEdit ? 'disabled' : '') + '></div>' +
    '<div class="col-6 col-md-3 col-xl-2"><label class="form-label" for="plannerEnd">إلى الساعة (24 ساعة)</label><input class="form-control" id="plannerEnd" name="endTime" type="text" inputmode="numeric" maxlength="5" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" placeholder="10:00" title="اكتب الوقت بصيغة 24 ساعة مثل 09:00 أو 23:00" required value="' + esc(editing ? editing.endTime : '10:00') + '" ' + (!canEdit ? 'disabled' : '') + '></div>' +
    '<div class="col-6 col-md-3 col-xl-2"><label class="form-label" for="plannerPriority">الأولوية</label><select class="form-select" id="plannerPriority" name="priority" ' + (!canEdit ? 'disabled' : '') + '>' +
    ['عالية','متوسطة','منخفضة'].map(v => '<option ' + ((editing ? editing.priority : 'متوسطة') === v ? 'selected' : '') + '>' + esc(v) + '</option>').join('') + '</select></div>' +
    '<div class="col-12 col-md-9"><label class="form-label" for="plannerNote">ملاحظات (اختياري)</label><input class="form-control" id="plannerNote" name="note" maxlength="500" placeholder="خطوات صغيرة أو تفاصيل تساعدك تبدأ" value="' + esc(editing ? editing.note : '') + '" ' + (!canEdit ? 'disabled' : '') + '></div>' +
    '<div class="col-12 col-md-3 d-flex align-items-end"><button class="btn btn-primary w-100" type="submit" ' + (!canEdit ? 'disabled' : '') + '><i class="bi bi-check2"></i> ' + (editing ? 'حفظ التعديل' : 'إضافة إلى الجدول') + '</button></div></div>' +
    '<p class="planner-form-error" id="plannerFormError" role="alert" hidden></p></form></section>' +
    '<div class="planner-section-title planner-week-heading"><div><h3><i class="bi bi-calendar-week"></i> جدول الأسبوع</h3><p>الجدول يبدأ من السبت، والمهام مرتبة حسب وقت بدايتها.</p></div><span class="planner-total-pill">' + tasks.length + ' مهمة</span></div>' +
    '<div class="planner-week-grid">' + days + '</div></section>';
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
        'إصدار Apps Script الحالي لا يدعم action=tasks. حدّث apps-script/Code.gs وانشر الإصدار الجديد؛ لم يتم تغيير المعاملات.'
      );
    }

    const remoteTasks = normalizeState({ ...S, plannerTasks: result.tasks }).plannerTasks;
    const remoteIds = new Set(remoteTasks.map(task => String(task.id)));
    const deletedIds = new Set(result.deletedIds.map(String));
    const priorBaselineIds = new Set(plannerLegacyBaselineTasks.map(task => String(task && task.id || '')));
    const localTasks = Array.isArray(S.plannerTasks) ? S.plannerTasks : [];

    // Preserve local-only tasks from the first release, but never resurrect a server
    // tombstone or re-upload an item that was already part of the prior cloud baseline.
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
    plannerCloudStatus = error && error.message
      ? error.message
      : 'تعذّر الاتصال بورقة TASKS.';
    console.error('تعذر تحميل المهام من TASKS:', error);
    if (manual) showAppToast(plannerCloudStatus, 6500);
    return false;
  } finally {
    plannerLoadInFlight = false;
    const plannerFormHasFocus = $('#plannerTaskForm') &&
      $('#plannerTaskForm').contains(document.activeElement);
    if (renderAfter && S.ui.tab === 'plan' && !plannerFormHasFocus) render();
  }
}

async function persistPlannerTask(task, expectedUpdatedAt, successMessage) {
  if (!plannerCloudInitialized || !cloudPlannerSupported) {
    showAppToast('المزامنة مع ورقة TASKS غير جاهزة. لم أعتبر المهمة محفوظة على الأجهزة الأخرى.', 5500);
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
    showAppToast('المزامنة مع ورقة TASKS غير جاهزة. لم أعتبر الحذف محفوظًا.', 5500);
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

    // The server has confirmed the tombstone. Apply it locally immediately so a temporary
    // follow-up read failure cannot make the deleted task appear active on this device.
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
  const time24 = /^([01]\\d|2[0-3]):[0-5]\\d$/;
  if (!time24.test(data.startTime || '') || !time24.test(data.endTime || '')) {
    return plannerFormError('اكتب الوقت بنظام 24 ساعة بصيغة HH:MM، مثل 09:00 أو 22:30.');
  }
  if (data.endTime <= data.startTime) {
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
    await loadPlannerTasksFromGoogle({ renderAfter: false, manual: true });
    render();
    return;
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
    await persistPlannerTask(
      { ...task, status: task.status === 'done' ? 'todo' : 'done', updatedAt: new Date().toISOString() },
      task.updatedAt,
      task.status === 'done' ? 'تمت إعادة فتح المهمة.' : 'تم إنجاز المهمة.'
    );
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
