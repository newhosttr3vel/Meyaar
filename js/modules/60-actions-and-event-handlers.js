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
    if (S.ui.tab === 'plan') loadPlannerTasksFromGoogle({ renderAfter: true });
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
