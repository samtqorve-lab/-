import {
  onQueueChange, trySyncQueuedItems, getQueuedSubmissions, retryFailedSubmission, discardQueuedSubmission,
} from '../../lib/offlineQueue.js';
import { el, showToast, openModal } from '../../lib/dom.js';

const TYPE_LABELS = {
  identityVerification: 'احراز هویت', safetyChecklist: 'چک‌لیست ایمنی', equipmentPhoto: 'عکس ماشین‌آلات',
  techReport: 'گزارش دوره‌ای', incident: 'اعلام حادثه', roleChecklist: 'چک‌لیست نقش‌محور',
};

async function openFailedItemsModal() {
  const { body } = openModal({ title: '⚠️ موارد ناموفق دائمی', width: '420px' });
  const listBox = el('div');
  body.append(
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
      'این موارد چندین بار ارسال آن‌ها ناموفق بود (نه به‌خاطر قطعی اینترنت) — می‌توانید دوباره امتحان کنید یا برای همیشه حذفشان کنید.'),
    listBox,
  );

  async function draw() {
    const items = (await getQueuedSubmissions()).filter((i) => i.failed);
    listBox.innerHTML = '';
    if (!items.length) { listBox.append(el('div', { class: 'empty-state' }, 'موردی نیست')); return; }
    items.forEach((item) => {
      const retryBtn = el('button', { class: 'btn-sm', style: 'background:var(--patina-100);color:var(--patina-700)' }, '🔄 امتحان مجدد');
      const discardBtn = el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)' }, '🗑 حذف برای همیشه');
      retryBtn.addEventListener('click', async () => {
        await retryFailedSubmission(item.id);
        showToast('🔄 دوباره در صف فعال قرار گرفت — در حال تلاش برای ارسال...');
        trySyncQueuedItems(false, showToast);
        draw();
      });
      discardBtn.addEventListener('click', async () => {
        // eslint-disable-next-line no-alert
        if (!window.confirm('این مورد برای همیشه حذف می‌شود و دیگر قابل بازیابی نیست. مطمئنید؟')) return;
        await discardQueuedSubmission(item.id);
        showToast('🗑 حذف شد');
        draw();
      });
      listBox.append(el('div', { style: 'background:var(--stone-50);border-radius:10px;padding:10px 12px;margin-bottom:8px;font-size:var(--text-xs)' }, [
        el('div', { style: 'font-weight:700' }, TYPE_LABELS[item.type] || item.type),
        el('div', { style: 'color:var(--stone-600);margin-top:2px' }, `${item.payload?.mineName || ''} — ثبت‌شده در ${new Date(item.queuedAt).toLocaleString('fa-IR')}`),
        item.lastError ? el('div', { style: 'color:var(--rust-600);margin-top:4px' }, `آخرین خطا: ${item.lastError}`) : null,
        el('div', { style: 'display:flex;gap:6px;margin-top:8px' }, [retryBtn, discardBtn]),
      ]));
    });
  }
  draw();
}

export function mountOfflineBadge() {
  const badge = document.createElement('div');
  badge.style.cssText = 'position:fixed;top:calc(8px + env(safe-area-inset-top));right:8px;z-index:1200;'
    + 'display:flex;flex-direction:column;gap:6px;align-items:flex-end';
  document.body.append(badge);

  const pendingChip = document.createElement('div');
  pendingChip.style.cssText = 'background:var(--amber-600);color:#fff;font-size:11px;font-weight:700;padding:6px 10px;'
    + 'border-radius:20px;cursor:pointer;box-shadow:var(--shadow-md);display:none';
  pendingChip.addEventListener('click', () => trySyncQueuedItems(true, showToast));

  const failedChip = document.createElement('div');
  failedChip.style.cssText = 'background:var(--rust-600);color:#fff;font-size:11px;font-weight:700;padding:6px 10px;'
    + 'border-radius:20px;cursor:pointer;box-shadow:var(--shadow-md);display:none';
  failedChip.addEventListener('click', () => openFailedItemsModal());

  badge.append(pendingChip, failedChip);

  onQueueChange(({ pending, failed }) => {
    pendingChip.style.display = pending > 0 ? 'block' : 'none';
    pendingChip.textContent = `📤 ${pending} مورد در انتظار ارسال — لمس کنید`;
    failedChip.style.display = failed > 0 ? 'block' : 'none';
    failedChip.textContent = `⚠️ ${failed} مورد ناموفق — لمس کنید`;
  });
}
