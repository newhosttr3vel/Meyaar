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
  const safetyStatus = safety.safe < 0 ? 'عجز متوقع' : safetyUncertain ? 'تقدير غير مكتمل' : 'تقدير مبدئي';
  const safetyAmount = (safety.safe < 0 ? '−' : '') + f(Math.abs(safety.safe));
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
    <section class="safe-spend-panel dashboard-safe-spend ${safety.safe < 0 ? 'is-deficit' : ''}" aria-labelledby="safeSpendTitle">
      <div class="safe-spend-header">
        <div class="safe-spend-title">
          <span class="safe-spend-eyebrow"><i class="bi bi-shield-check"></i> قرار مالي أوضح</span>
          <h3 id="safeSpendTitle">المتاح للصرف بأمان</h3>
          <p>المتبقي بعد خصم الالتزامات غير المسجلة ومخصصات الأهداف.</p>
        </div>
        <span class="safe-spend-status ${safety.safe < 0 ? 'is-deficit' : safetyUncertain ? 'is-uncertain' : ''}">${safetyStatus}</span>
      </div>

      <div class="dashboard-safe-main">
        <div class="safe-spend-result">
          <span>${safety.safe < 0 ? 'العجز المتوقع' : 'المتاح التقديري'}</span>
          <strong>${safetyAmount} <small>ج.م.</small></strong>
          <p>${safety.safe < 0 ? 'راجع الالتزامات قبل أي إنفاق إضافي.' : 'مؤشر للتخطيط، وليس ضمانًا لميزانية الإنفاق.'}</p>
        </div>
        <div class="dashboard-safe-metrics" aria-label="مكونات تقدير المتاح للصرف">
          <div class="dashboard-safe-metric"><span>السيولة</span><strong>${f(safety.available)}</strong><small>ج.م.</small></div>
          <div class="dashboard-safe-metric is-deduction"><span>الالتزامات</span><strong>− ${f(safety.commitments)}</strong><small>ج.م.</small></div>
          <div class="dashboard-safe-metric is-deduction"><span>الأهداف</span><strong>− ${f(safety.reservedGoals)}</strong><small>ج.م.</small></div>
        </div>
      </div>

      <div class="dashboard-safe-bottom">
        <div class="safe-spend-alert ${safety.safe < 0 ? 'is-deficit' : ''} dashboard-safe-note">
          <i class="bi ${safety.safe < 0 ? 'bi-exclamation-triangle-fill' : 'bi-info-circle'}"></i>
          <div><strong>${safety.safe < 0 ? 'الالتزامات المحجوزة أكبر من السيولة المتاحة.' : 'التقدير لا يشمل الطوارئ أو الفواتير غير المسجلة.'}</strong></div>
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
  const views = { dash: vDash, tx: vTx, income: vIncomeSources, acc: vAcc, ast: vAst, set: vSet, aud: vAud, rec: vRecurring, goal: vFinancialGoals };
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
