'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const plannerPath = path.join(__dirname, '..', 'js', 'modules', '70-daily-weekly-planner.js');
const source = fs.readFileSync(plannerPath, 'utf8');
const routinePath = path.join(__dirname, '..', 'js', 'modules', '75-routine-schedule.js');
const routineSource = fs.readFileSync(routinePath, 'utf8');
assert.doesNotThrow(() => new vm.Script(routineSource, { filename: routinePath }), 'Routine schedule module must parse');
assert.doesNotThrow(() => new vm.Script(source, { filename: plannerPath }),
  'Productivity planner module must parse');

function isoDate(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') +
    '-' + String(date.getDate()).padStart(2, '0');
}
function isValidISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(value + 'T12:00:00');
  return Number.isFinite(date.getTime()) && isoDate(date) === value;
}

let plannerRenderCount = 0;
const sandbox = {
  S: {
    plannerSettings: {
      dayStart: '05:00', dayEnd: '22:00',
      sleepStart: '22:00', sleepEnd: '05:00',
      workStart: '10:00', workEnd: '19:00',
      workDays: [0, 1, 2, 3, 4, 5, 6], breakMinutes: 10, targetLoad: 85
    },
    plannerTasks: [],
    ui: { tab: 'dash' }
  },
  document: { addEventListener() {} },
  isValidISODate,
  localISODate: date => isoDate(date || new Date()),
  plannerCloudInitialized: true,
  cloudPlannerSupported: true,
  plannerSaveInFlight: false,
  plannerLoadInFlight: false,
  plannerDeletedIds: new Set(),
  plannerLegacyBaselineTasks: [],
  plannerCloudStatus: '',
  plannerCloudLastUpdated: '',
  normalizeState: value => value,
  fetch: () => Promise.reject(new Error('fetch mock not configured')),
  esc: value => String(value ?? ''),
  console,
  showAppToast() {},
  save() {},
  render() { plannerRenderCount++; },
  $() { return null; },
  API_URL: 'https://example.invalid'
};
vm.createContext(sandbox);
vm.runInContext(source + '\n' + routineSource + '\nplannerPrayerCache.set("2026-10-31", {Fajr:"05:00",Dhuhr:"12:00",Asr:"15:30",Maghrib:"18:00",Isha:"19:30}); plannerPrayerCache.set("2026-11-06", {Fajr:"05:00",Dhuhr:"12:00",Asr:"15:30",Maghrib:"18:00",Isha:"19:30});\nglobalThis.__plannerTest = {' +
  'plannerAvailableWindows: plannerAvailableWindows,' +
  'plannerPrayerAndRoutinePanel: plannerPrayerAndRoutinePanel,' +
  'plannerCleanPrayerTime: plannerCleanPrayerTime,' +
  'plannerGenerateDay: plannerGenerateDay,' +
  'plannerTaskConflicts: plannerTaskConflicts,' +
  'plannerTaskSegments: plannerTaskSegments,' +
  'plannerTaskMinutes: plannerTaskMinutes,' +
  'plannerPriorityScore: plannerPriorityScore,' +
  'loadPlannerTasksFromGoogle: loadPlannerTasksFromGoogle' +
  '};', sandbox, { filename: 'productivity-planner.js' });
const api = sandbox.__plannerTest;
assert.equal(api.plannerCleanPrayerTime('18:04 (EET)'), '18:04', 'Prayer times are normalized from API timezone suffixes');
assert.ok(api.plannerPrayerAndRoutinePanel('2026-10-31').includes('10:00 ص – 18:00'), 'Work ends at the Maghrib time returned for the selected date');
assert.ok(api.plannerPrayerAndRoutinePanel('2026-10-31').includes('كل الأيام عدا الجمعة'), 'Sleep routine is marked off on Friday');
const S = sandbox.S;
const ranges = windows => windows.map(window => [window.start, window.end]);

assert.deepEqual(JSON.parse(JSON.stringify(ranges(api.plannerAvailableWindows('2026-10-31', 'personal')))),
  [[300, 600], [1140, 1320]],
  'Saturday personal availability is 05:00–10:00 and 19:00–22:00');
assert.deepEqual(JSON.parse(JSON.stringify(ranges(api.plannerAvailableWindows('2026-10-31', 'work')))),
  [[600, 1080]], 'Saturday work availability is 10:00 until Maghrib');
assert.deepEqual(JSON.parse(JSON.stringify(ranges(api.plannerAvailableWindows('2026-11-06', 'personal')))),
  [[300, 600], [1080, 1320]], 'Friday retains personal windows around daily work');
assert.deepEqual(JSON.parse(JSON.stringify(api.plannerAvailableWindows('2026-11-06', 'work'))), [[600, 1140]],
  'Friday also has a work window');

const urgent = { priority: 'عاجل', impact: 5, estimateMinutes: 45, dueDate: '2026-10-31', createdAt: '2026-10-30' };
const low = { priority: 'منخفضة', impact: 1, estimateMinutes: 60, dueDate: '2026-11-20', createdAt: '2026-10-30' };
assert.ok(api.plannerPriorityScore(urgent, '2026-10-31') > api.plannerPriorityScore(low, '2026-10-31'),
  'Urgency and impact raise task priority');

S.plannerTasks = [
  { id: 'P1', title: 'قراءة', area: 'personal', status: 'inbox', priority: 'عالية', impact: 4, estimateMinutes: 60, dueDate: '2026-10-31', date: '', startTime: '', endTime: '' },
  { id: 'W1', title: 'مهمة عمل', area: 'work', status: 'next', priority: 'عاجل', impact: 5, estimateMinutes: 90, dueDate: '2026-10-31', date: '', startTime: '', endTime: '' },
  { id: 'P2', title: 'رياضة', area: 'personal', status: 'next', priority: 'متوسطة', impact: 3, estimateMinutes: 45, dueDate: '', date: '', startTime: '', endTime: '' }
];
const draft = api.plannerGenerateDay('2026-10-31', S.plannerTasks);
assert.equal(draft.tasks.length, 3, 'All fixture tasks fit within the target load');
assert.equal(draft.unplaced.length, 0, 'No fixture task needs to be deferred');
const workTask = draft.tasks.find(task => task.id === 'W1');
assert.ok(workTask.startTime >= '10:00' && workTask.endTime <= '19:00',
  'Work tasks are scheduled only inside work hours');
assert.ok(draft.tasks.filter(task => task.area === 'personal').every(task =>
  task.endTime <= '10:00' || task.startTime >= '18:00'),
  'Personal tasks are scheduled outside fixed work hours');
for (let i = 0; i < draft.tasks.length; i++) {
  for (let j = i + 1; j < draft.tasks.length; j++) {
    const a = draft.tasks[i], b = draft.tasks[j];
    if (a.area !== b.area || a.date !== b.date) continue;
    assert.ok(!(a.startTime < b.endTime && b.startTime < a.endTime), 'Generated tasks do not overlap');
    if (a.endTime <= b.startTime) {
      const minutes = Number(b.startTime.slice(0, 2)) * 60 + Number(b.startTime.slice(3)) -
        (Number(a.endTime.slice(0, 2)) * 60 + Number(a.endTime.slice(3)));
      assert.ok(minutes >= 10, 'Generated tasks include a recovery buffer');
    }
  }
}
assert.ok(draft.tasks.every(task => task.status === 'scheduled'), 'Draft tasks are marked for scheduling');
assert.ok(S.plannerTasks.every(task => ['inbox', 'next'].includes(task.status)),
  'Preview generation does not mutate original tasks');

S.plannerTasks = [{
  id: 'EXISTING', title: 'existing', date: '2026-10-31', startTime: '06:00',
  endTime: '07:00', area: 'personal', status: 'scheduled'
}];
const overlap = api.plannerTaskConflicts({
  id: 'NEW', title: 'overlap', date: '2026-10-31',
  startTime: '06:30', endTime: '07:30', area: 'personal'
});
assert.ok(overlap.some(message => message.includes('existing')), 'Overlapping time blocks are detected');
const outside = api.plannerTaskConflicts({
  id: 'OUTSIDE', title: 'wrong window', date: '2026-10-31',
  startTime: '11:00', endTime: '12:00', area: 'personal'
});
assert.ok(outside.some(message => message.includes('خارج ساعات')), 'Personal tasks cannot overlap work hours');
const work = api.plannerTaskConflicts({
  id: 'WORK', title: 'valid work', date: '2026-10-31',
  startTime: '11:00', endTime: '12:00', area: 'work'
});
assert.equal(work.length, 0, 'Work tasks can be scheduled in the work block');

const overnight = { id: 'NIGHT', date: '2026-10-31', startTime: '22:00', endTime: '05:00' };
assert.equal(api.plannerTaskMinutes(overnight), 420, 'A 22:00–05:00 task spans seven hours');
assert.deepEqual(JSON.parse(JSON.stringify(api.plannerTaskSegments(overnight).map(item => ({
  date: item.date, start: item.start, end: item.end
})))),
[
  { date: '2026-10-31', start: 1320, end: 1440 },
  { date: '2026-11-01', start: 0, end: 300 }
], 'Overnight tasks split over the correct dates');

S.plannerSettings.sleepEnd = '06:00';
S.plannerSettings.sleepStart = '21:00';
assert.deepEqual(JSON.parse(JSON.stringify(ranges(api.plannerAvailableWindows('2026-10-31', 'personal')))),
  [[360, 600], [1080, 1260]], 'Custom sleep boundaries update personal availability');

(async function testQueuedRenderAfterInitialPlannerLoad() {
  let releaseFetch;
  sandbox.fetch = () => new Promise(resolve => { releaseFetch = resolve; });
  sandbox.S.ui.tab = 'dash';
  sandbox.plannerCloudInitialized = false;
  sandbox.cloudPlannerSupported = false;
  sandbox.plannerLoadInFlight = false;
  plannerRenderCount = 0;

  const initialLoad = api.loadPlannerTasksFromGoogle({ renderAfter: false });
  assert.equal(sandbox.plannerLoadInFlight, true, 'Initial planner request remains in flight');

  // Simulate opening the planner before the first task request has completed.
  sandbox.S.ui.tab = 'plan';
  await api.loadPlannerTasksFromGoogle({ renderAfter: true });
  releaseFetch({
    ok: true,
    json: async () => ({ success: true, tasks: [], deletedIds: [], updatedAt: 'test' })
  });
  await initialLoad;

  assert.equal(sandbox.plannerCloudInitialized, true, 'Successful task response initializes planner sync');
  assert.equal(sandbox.plannerLoadInFlight, false, 'Planner load lock is released');
  assert.equal(plannerRenderCount, 1, 'Planner re-renders after the initial request finishes');
})().then(() => {
  console.log('Productivity planner tests passed: task scoring, capacity, scheduling, conflicts and queued navigation rendering.');
}).catch(error => {
  console.error(error);
  throw error;
});
