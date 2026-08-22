import { el, showToast, fmtDateTime } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';

/**
 * پایش خودکار ماهانه‌ی تجاوز به حریم قانونی معدن (با تصاویر ماهواره‌ای Sentinel-2 و شاخص خاک
 * برهنه/BSI) در پس‌زمینه (cron ماهانه + Edge Function «boundary-monitor») اجرا می‌شود؛ این تب فقط
 * نمایشگر و ابزار بررسی/تایید-رد آن نتایج است.
 *
 * روش کار: میانگین BSI داخل محدوده‌ی قانونی و حلقه‌ی بیرونی مرز با یک خط‌مبنا مقایسه می‌شود. اگر
 * تغییر حلقه‌ی بیرونی به‌طور معنادار بیشتر از تغییر داخل محدوده باشد (یعنی گسترش غیرعادی نزدیک
 * مرز، نه یک تغییر یکسان در کل منطقه)، به‌عنوان «نیازمند بررسی» علامت می‌خورد.
 *
 * محدودیت صادقانه: دقت تصویر ماهواره‌ای Sentinel-2 حدود ۱۰ متر بر پیکسل است و بسیاری از معادن این
 * سامانه زیر یک هکتارند — این ابزار برای گسترش‌های قابل‌توجه طراحی شده، نه تشخیص قطعی هر تخلف جزئی.
 * همیشه پیش از هر اقدام اداری، بازدید میدانی لازم است.
 */
export async function renderBoundaryMonitor(container, state, appCtx) {
  container.innerHTML = '';

  const intro = el('div', { class: 'card', style: 'font-size:var(--text-xs);color:var(--stone-600)' },
    '🛰️ این فهرست از پایش خودکار ماهانه‌ی تصاویر ماهواره‌ای می‌آید. هر مورد را با تصویر قبل/بعد بررسی کنید — تایید یا رد به‌عنوان مورد غلط‌انداز (false positive)، بعد از بازدید میدانی توصیه می‌شود.');
  const listBox = el('div', { style: 'margin-top:14px;display:flex;flex-direction:column;gap:14px' });
  container.append(intro, listBox);

  async function load() {
    listBox.innerHTML = '⏳ در حال بارگذاری...';
    const { data, error } = await sb.from('mine_boundary_monitoring')
      .select('*')
      .order('last_run_at', { ascending: false });
    if (error) { listBox.textContent = `⚠️ خطا: ${error.message}`; return; }

    const pending = (data || []).filter((r) => r.status === 'pending_review');
    const resolved = (data || []).filter((r) => r.status === 'confirmed' || r.status === 'dismissed');
    const ok = (data || []).filter((r) => r.status === 'ok');

    listBox.innerHTML = '';
    listBox.append(el('h3', { style: 'margin:0' }, `⚠️ نیازمند بررسی (${pending.length})`));
    if (!pending.length) listBox.append(el('div', { style: 'color:var(--stone-500)' }, 'موردی در انتظار بررسی نیست.'));
    for (const row of pending) listBox.append(await renderRow(row, load));

    listBox.append(el('h3', { style: 'margin:20px 0 0' }, `📜 بررسی‌شده‌ها (${resolved.length})`));
    for (const row of resolved.slice(0, 10)) listBox.append(await renderRow(row, load, true));

    listBox.append(el('div', { style: 'margin-top:16px;font-size:var(--text-xs);color:var(--stone-500)' },
      `✅ ${ok.length} معدن دیگر در آخرین پایش وضعیت عادی داشتند.`));
  }

  async function renderRow(row, reload, collapsed) {
    const card = el('div', { class: 'card' });
    const statusBadge = { pending_review: '⚠️ نیازمند بررسی', confirmed: '✅ تخلف تاییدشده', dismissed: '❌ رد شده (غلط‌انداز)' }[row.status] || row.status;
    card.append(el('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [
      el('b', {}, `⛏️ ${row.mine_name}`),
      el('span', { style: 'font-size:var(--text-xs);color:var(--stone-600)' }, statusBadge),
    ]));
    card.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:4px' },
      `آخرین بررسی: ${fmtDateTime(row.last_run_at)} | تفاضل BSI: ${row.delta_differential != null ? (row.delta_differential * 100).toFixed(1) : '—'} واحد`));

    if (!collapsed && row.preview_before_path && row.preview_after_path) {
      const imgRow = el('div', { style: 'display:flex;gap:10px;margin-top:10px;flex-wrap:wrap' });
      for (const [label, path] of [['قبل (خط‌مبنا)', row.preview_before_path], ['اکنون', row.preview_after_path]]) {
        const { data: signed } = await sb.storage.from('boundary-monitoring').createSignedUrl(path, 3600);
        imgRow.append(el('div', {}, [
          el('div', { style: 'font-size:var(--text-xs);margin-bottom:4px' }, label),
          signed ? el('img', { src: signed.signedUrl, style: 'width:220px;height:220px;object-fit:cover;border-radius:8px;border:1px solid var(--stone-200)' }) : el('div', {}, '—'),
        ]));
      }
      card.append(imgRow);
    }

    if (row.status === 'pending_review') {
      const btnRow = el('div', { style: 'display:flex;gap:8px;margin-top:10px' }, [
        el('button', {
          class: 'btn btn-primary',
          onclick: async () => {
            await sb.from('mine_boundary_monitoring').update({ status: 'confirmed', reviewed_at: new Date().toISOString(), reviewed_by: appCtx?.myEmail || null }).eq('id', row.id);
            showToast('✅ به‌عنوان تخلف تاییدشده ثبت شد');
            reload();
          },
        }, '✅ تایید تخلف'),
        el('button', {
          class: 'btn btn-ghost',
          onclick: async () => {
            // رد کردن یعنی این یک هشدار غلط بود — خط‌مبنا را به وضعیت فعلی بازنشانی می‌کنیم تا
            // پایش‌های بعدی از همین‌جا دوباره مقایسه کنند (نه این‌که هر ماه دوباره alert بدهد).
            await sb.from('mine_boundary_monitoring').update({
              status: 'ok', reviewed_at: new Date().toISOString(), reviewed_by: appCtx?.myEmail || null,
              baseline_captured_at: row.current_captured_at,
              baseline_mean_bsi_inside: row.current_mean_bsi_inside,
              baseline_mean_bsi_buffer: row.current_mean_bsi_buffer,
              delta_differential: 0,
            }).eq('id', row.id);
            showToast('❌ به‌عنوان غلط‌انداز رد شد — خط‌مبنا به‌روزرسانی شد');
            reload();
          },
        }, '❌ رد (غلط‌انداز)'),
      ]);
      card.append(btnRow);
    }

    return card;
  }

  load();
}
