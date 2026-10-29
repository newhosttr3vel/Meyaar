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

