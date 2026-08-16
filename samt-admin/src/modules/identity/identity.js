import { el, esc, fmtDate, showToast } from '../../lib/dom.js';
import { fetchDeptRecords } from '../../lib/records.js';
import { DEPT_NAME_FIELD } from '../../lib/sections.js';
import {
  fetchIdentityVerifications, fetchSignedPhotoUrls, fetchMinesMissingBoundary,
  approveIdentity, rejectIdentity, resetTrustedDevice,
} from '../../lib/identity.js';

const STATUS_META = {
  pending: { label: '⏳ در انتظار بررسی', color: 'var(--amber-700)', bg: 'var(--amber-50)' },
  approved: { label: '✅ تایید‌شده', color: 'var(--patina-700)', bg: 'var(--patina-50)' },
  rejected: { label: '❌ رد‌شده', color: 'var(--rust-700)', bg: 'var(--rust-50)' },
};
const KIND_META = { initial: '🪪 احراز هویت اولیه', monthly: '📅 تمدید ماهانه' };

export async function renderIdentity(container, state) {
  container.append(el('div', { class: 'loading-state' }, [
    el('div', { class: 'spinner' }),
    'در حال بارگذاری...',
  ]));

  if (state.department === 'صنعت') {
    container.innerHTML = '';
    container.append(el('div', { class: 'empty-state' }, 'این بخش نقش مسئول فنی ندارد — احراز هویت فقط برای معدن/اکتشاف/فرآوری فعال است.'));
    return;
  }

  let rows;
  try {
    rows = await fetchIdentityVerifications(state.department);
  } catch (err) {
    container.innerHTML = '';
    container.append(el('div', { class: 'empty-state' }, `خطا در بارگذاری: ${err.message}`));
    return;
  }

  container.innerHTML = '';

  // هشدار معادن بدون مختصات چهارگوش کامل (بررسی این‌ها فقط با شعاع ۳۰۰ متری انجام می‌شود)
  fetchDeptRecords(state.department).then(async (records) => {
    const missing = await fetchMinesMissingBoundary(records, DEPT_NAME_FIELD[state.department]);
    if (missing.length) {
      warnBox.style.display = 'block';
      warnBox.innerHTML = '';
      warnBox.append(`⚠️ ${missing.length} مورد در این بخش مختصات دقیق چهارگوش محدوده را ندارند و برای آن‌ها احراز هویت فقط با شعاع ۳۰۰ متری از یک نقطه مرکزی بررسی می‌شود (نه محدوده دقیق): ${missing.join('، ')}. برای دقت بیشتر، مختصات گوشه‌های این موارد را در فرم جزئیات آن‌ها تکمیل کنید.`);
    }
  });
  const warnBox = el('div', { style: 'display:none;background:var(--amber-50);color:var(--amber-700);border-radius:8px;padding:10px 12px;font-size:var(--text-xs);margin-bottom:14px' });
  container.append(warnBox);

  const toolbar = el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px' });
  const mineInput = el('input', { type: 'text', placeholder: 'فیلتر بر اساس نام معدن...', style: 'flex:1;min-width:180px' });
  const statusSelect = el('select', { style: 'max-width:180px' }, [
    el('option', { value: '' }, 'همه وضعیت‌ها'),
    el('option', { value: 'pending' }, 'در انتظار بررسی'),
    el('option', { value: 'approved' }, 'تایید‌شده'),
    el('option', { value: 'rejected' }, 'رد‌شده'),
  ]);
  const kindSelect = el('select', { style: 'max-width:180px' }, [
    el('option', { value: '' }, 'اولیه و تمدید ماهانه'),
    el('option', { value: 'initial' }, 'فقط احراز هویت اولیه'),
    el('option', { value: 'monthly' }, 'فقط تمدید ماهانه'),
  ]);
  toolbar.append(mineInput, statusSelect, kindSelect);
  container.append(toolbar);

  const listBox = el('div');
  container.append(listBox);

  async function draw() {
    const mineQ = mineInput.value.trim();
    const filtered = rows.filter((r) =>
      (!mineQ || (r.mine_name || '').includes(mineQ))
      && (!statusSelect.value || r.status === statusSelect.value)
      && (!kindSelect.value || r.kind === kindSelect.value));

    listBox.innerHTML = '';
    if (!filtered.length) {
      listBox.append(el('div', { class: 'empty-state' }, 'موردی یافت نشد'));
      return;
    }

    const signedMap = await fetchSignedPhotoUrls(filtered.map((r) => r.photo_url).filter(Boolean));

    filtered.forEach((r) => {
      const sm = STATUS_META[r.status] || STATUS_META.pending;
      const imgUrl = signedMap[r.photo_url] || '';

      const approveBtn = (r.status === 'pending' || r.status === 'rejected')
        ? el('button', { class: 'btn-sm', style: 'background:var(--patina-100);color:var(--patina-700);margin-top:8px' }, '✅ تایید هویت') : null;
      if (approveBtn) approveBtn.addEventListener('click', async () => {
        try {
          await approveIdentity(state.department, r);
          showToast('✅ احراز هویت تایید شد — همان گوشی به‌عنوان گوشی مورد اعتماد ثبت شد');
          renderIdentity(container, state);
        } catch (err) { showToast(`⚠️ خطا در تایید: ${err.message}`); }
      });

      const rejectBtn = r.status !== 'rejected'
        ? el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700);margin-top:8px;margin-right:6px' }, '❌ رد') : null;
      if (rejectBtn) rejectBtn.addEventListener('click', async () => {
        const reason = window.prompt('دلیل رد این عکس احراز هویت را بنویسید (برای اطلاع‌رسانی به مسئول فنی):', 'عکس داخل محدوده ثبت‌شده معدن نیست یا چهره واضح نیست');
        if (reason === null) return;
        try {
          await rejectIdentity(state.department, r, reason);
          showToast('❌ رد شد — مسئول فنی باید عکس جدید ارسال کند');
          renderIdentity(container, state);
        } catch (err) { showToast(`⚠️ خطا در رد کردن: ${err.message}`); }
      });

      const resetBtn = el('button', { class: 'btn-sm', style: 'background:var(--amber-100);color:var(--amber-700);margin-top:8px;margin-right:6px' }, '📵 ریست گوشی مورد اعتماد');
      resetBtn.addEventListener('click', async () => {
        if (!r.email) return;
        if (!confirm(`گوشی مورد اعتماد «${r.email}» ریست شود؟ دفعه بعد باید دوباره وارد رمز شود و در محدوده معدن یک عکس جدید بگیرد.`)) return;
        try {
          await resetTrustedDevice(state.department, r.email);
          showToast('✅ گوشی مورد اعتماد ریست شد');
        } catch (err) { showToast(`⚠️ خطا: ${err.message}`); }
      });

      const mapLink = (r.lat && r.lon)
        ? el('a', { href: '#', style: 'color:var(--ochre-600);font-size:var(--text-xs)', onclick: (e) => { e.preventDefault(); window.open(`https://www.google.com/maps?q=${r.lat},${r.lon}`, '_blank'); } }, '📍 مشاهده لوکیشن عکس روی نقشه')
        : null;

      listBox.append(el('div', { style: `display:flex;gap:12px;flex-wrap:wrap;padding:12px 14px;margin-bottom:8px;border-radius:10px;background:${sm.bg}` }, [
        el('img', {
          src: imgUrl, style: 'width:90px;height:90px;object-fit:cover;border-radius:8px;cursor:pointer;flex-shrink:0;background:var(--stone-200)',
          onclick: () => { if (imgUrl) window.open(imgUrl, '_blank'); },
        }),
        el('div', { style: 'flex:1;min-width:200px;font-size:var(--text-sm)' }, [
          el('div', { style: 'display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px' }, [
            el('b', {}, `🦺 ${esc(r.full_name || r.email)} — ${esc(r.mine_name)}`),
            el('span', { style: `color:${sm.color};font-weight:700` }, sm.label),
          ]),
          el('div', { style: 'color:var(--stone-600);margin-top:2px;font-size:var(--text-xs)' },
            `${KIND_META[r.kind] || r.kind} | ${r.email || '—'}${r.membership_no ? ` | عضویت: ${r.membership_no}` : ''} | ${fmtDate(r.created_at)}`),
          el('div', { style: 'margin-top:4px;color:var(--patina-700);font-size:var(--text-xs)' }, '✅ داخل محدوده معدن (بررسی مستقل سرور)'),
          mapLink ? el('div', { style: 'margin-top:4px' }, mapLink) : null,
          r.reject_reason ? el('div', { style: 'margin-top:4px;color:var(--rust-600);font-size:var(--text-xs)' }, `دلیل رد: ${esc(r.reject_reason)}`) : null,
          el('div', {}, [approveBtn, rejectBtn, resetBtn]),
        ]),
      ]));
    });
  }

  mineInput.addEventListener('input', draw);
  statusSelect.addEventListener('change', draw);
  kindSelect.addEventListener('change', draw);
  draw();
}
