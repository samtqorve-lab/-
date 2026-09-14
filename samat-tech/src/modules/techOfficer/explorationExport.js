import { el, showToast, openModal } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';

const HEADERS = ['شماره گمانه/محل', 'تاریخ حفاری', 'عمق (متر)', 'عرض جغرافیایی', 'طول جغرافیایی', 'لیتولوژی', 'نتیجه نمونه', 'توضیحات', 'ثبت‌کننده', 'تاریخ ثبت'];

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function loadBoreholes(mineName) {
  const { data, error } = await sb.from('exploration_boreholes')
    .select('borehole_no,drill_date,depth_m,lat,lon,lithology,sample_results,notes,created_by,created_at')
    .eq('mine_name', mineName).order('created_at', { ascending: false }).limit(1000);
  if (error) return [];
  return data || [];
}

function toCsv(rows) {
  const lines = [HEADERS.map(csvEscape).join(',')];
  rows.forEach((r) => {
    lines.push([
      r.borehole_no, r.drill_date, r.depth_m, r.lat, r.lon, r.lithology, r.sample_results, r.notes, r.created_by,
      r.created_at ? new Date(r.created_at).toLocaleDateString('fa-IR') : '',
    ].map(csvEscape).join(','));
  });
  return lines.join('\r\n');
}

/**
 * خروجی گمانه‌ها برای گزارش رسمی به سازمان صنعت‌ومعدن — فایل CSV (نه .xlsx واقعی؛ این پروژه
 * کتابخانه‌ی اکسل ندارد، ولی CSV با اکسل/Google Sheets کاملاً سازگار است). چون در اپ موبایل
 * (به‌خصوص نسخه‌ی Capacitor روی اندروید) دانلود فایل همیشه قابل‌اعتماد نیست، اول متن آماده‌ی
 * «کپی و پیست در اکسل» نشان داده می‌شود؛ دکمه‌ی دانلود مستقیم فقط وقتی اپ در مرورگر معمولی
 * (نه اپ نصب‌شده) باز باشد اضافه می‌شود.
 * @param {object} mine
 * @param {string} nameField
 */
export async function openExplorationExportModal(mine, nameField) {
  const mineName = mine[nameField];
  const { body } = openModal({ title: `📤 خروجی گمانه‌ها — ${mineName}`, width: '440px' });
  body.append(el('div', { style: 'text-align:center;padding:20px;color:var(--stone-500)' }, '⏳ در حال آماده‌سازی...'));

  const rows = await loadBoreholes(mineName);
  body.innerHTML = '';

  if (!rows.length) {
    body.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-500)' }, 'هنوز گمانه/ترانشه‌ای برای این محدوده ثبت نشده.'));
    return;
  }

  const csv = toCsv(rows);
  const textarea = el('textarea', {
    readOnly: true, dir: 'ltr', style: 'width:100%;height:180px;font-family:monospace;font-size:11px;direction:ltr',
  }, csv);

  const copyBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:10px' }, '📋 کپی همه (برای Paste در اکسل/Google Sheets)');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(csv);
      showToast('✅ کپی شد — در اکسل یا Google Sheets پیست کنید');
    } catch {
      textarea.select();
      showToast('⚠️ کپی خودکار ممکن نشد — متن انتخاب شد، از دکمه‌ی کپی گوشی استفاده کنید');
    }
  });

  const isLikelyBrowser = !window.Capacitor?.isNativePlatform?.();
  let downloadBtn = null;
  if (isLikelyBrowser) {
    downloadBtn = el('a', {
      href: `data:text/csv;charset=utf-8,\uFEFF${encodeURIComponent(csv)}`,
      download: `گمانه‌های_${mineName}.csv`,
      class: 'btn-sm',
      style: 'display:block;text-align:center;width:100%;margin-top:8px;background:var(--patina-100);color:var(--patina-700);text-decoration:none',
    }, '⬇️ دانلود فایل CSV');
  }

  body.append(
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' },
      `${rows.length} ردیف گمانه/ترانشه — این خروجی CSV است (با اکسل و Google Sheets باز می‌شود).`),
    textarea,
    copyBtn,
    downloadBtn,
  );
}
