let appToastTimer = null;
let appToastNode = null;

function dismissAppToast() {
  if (appToastTimer) {
    clearTimeout(appToastTimer);
    appToastTimer = null;
  }
  if (appToastNode) {
    appToastNode.remove();
    appToastNode = null;
  }
}

function showAppToast(message, duration = 15000) {
  if (!document.body) return;
  dismissAppToast();

  const toast = document.createElement('div');
  toast.className = 'app-toast app-toast-warning';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  const icon = document.createElement('i');
  icon.className = 'bi bi-cloud-exclamation-fill app-toast-icon';
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('div');
  text.className = 'app-toast-text';
  text.textContent = message;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'app-toast-close';
  close.setAttribute('aria-label', 'إغلاق التنبيه');
  close.innerHTML = '&times;';
  close.addEventListener('click', dismissAppToast);

  const progress = document.createElement('span');
  progress.className = 'app-toast-progress';
  progress.style.animationDuration = duration + 'ms';

  toast.append(icon, text, close, progress);
  document.body.appendChild(toast);
  appToastNode = toast;
  requestAnimationFrame(() => toast.classList.add('is-visible'));

  appToastTimer = window.setTimeout(() => {
    toast.classList.remove('is-visible');
    toast.classList.add('is-hiding');
    appToastTimer = window.setTimeout(() => {
      if (appToastNode === toast) appToastNode = null;
      toast.remove();
      appToastTimer = null;
    }, 220);
  }, duration);
}

function bd(s) {
  const cls = (s === 'سليم' || s === 'ضمن الخطة') ? 'tag-ok' : (s === 'تجاوز' || s === 'خطأ') ? 'tag-er' : 'tag-wn';
  return `<span class="tag ${cls}">${s}</span>`;
}
function st(s) { return s === 'سليم' ? bd(s) : `<span class="tag tag-er">${s}</span>`; }
function fillSelect(el, arr, val) { el.innerHTML = arr.map(x => `<option value="${esc(x)}" ${x === val ? 'selected' : ''}>${esc(x)}</option>`).join(''); }

