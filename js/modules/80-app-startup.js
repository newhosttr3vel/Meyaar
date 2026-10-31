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
