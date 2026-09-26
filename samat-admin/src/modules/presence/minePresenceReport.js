import { el, showToast, fmtDateTime } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';

const ROLE_FA = { tech_officer: 'مسئول فنی', safety_officer: 'مسئول ایمنی', health_officer: 'مسئول بهداشت' };

function isoStartOfDay(dateStr) {
  return dateStr ? new Date(`${dateStr}T00:00:00`).toISOString() : null;
}
function isoEndOfDay(dateStr) {
  return dateStr ? new Date(`${dateStr}T23:59:59.999`).toISOString() : null;
}
function fmtHours(h) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh} ساعت و ${mm} دقیقه`;
}

/**
 * تب «ساعات حضور در معدن»: جدول mine_presence_sessions (نوبت‌های زوج‌شده‌ی enter/exit، سمت
 * دیتابیس) را برای بازه‌ی زمانی انتخابی می‌خواند، خلاصه‌ی مجموع ساعات هر مسئول فنی/معدن را نشان
 * می‌دهد و ریز نوبت‌ها را هم زیرش لیست می‌کند.
 *
 * محدودیت صادقانه: این گزارش فقط بر اساس بخش (state.department) محدود می‌شود، نه محدوده‌ی
 * جغرافیایی دقیق (استان/شهرستان) حساب ادمین — چون mine_presence_events فیلد استان/شهرستان
 * جداگانه ذخیره نمی‌کند. برای این سامانه که فقط برای شهرستان قروه است مشکلی ایجاد نمی‌کند، ولی
 * اگر بعداً به چند شهرستان/استان گسترش یابد باید یک join با رکورد معدن اضافه شود.
 */
export async function renderMinePresenceReport(container, state) {
  container.innerHTML = '';

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const fromInput = el('input', { type: 'date', value: monthAgo });
  const toInput = el('input', { type: 'date', value: today });
  const loadBtn = el('button', { class: 'btn btn-primary' }, '🔎 نمایش گزارش');
  const summaryBox = el('div', { style: 'margin-top:16px' });
  const detailBox = el('div', { style: 'margin-top:16px' });

  container.append(
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:14px' },
      'ساعات حضور مسئولین فنی/ایمنی/بهداشت در محدوده‌ی جغرافیایی معدن — بر اساس ورود/خروج خودکار GPS از اپ «ثبت گزارش میدانی».'),
    el('div', { class: 'card', style: 'display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap' }, [
      el('div', {}, [el('label', {}, 'از تاریخ'), fromInput]),
      el('div', {}, [el('label', {}, 'تا تاریخ'), toInput]),
      loadBtn,
    ]),
    summaryBox,
    detailBox,
  );

  async function load() {
    summaryBox.innerHTML = '<div class="loading-state"><div class="spinner"></div>در حال بارگذاری...</div>';
    detailBox.innerHTML = '';
    const from = isoStartOfDay(fromInput.value);
    const to = isoEndOfDay(toInput.value);

    let sessions;
    try {
      let q = sb.from('mine_presence_sessions').select('email, mine_name, department, enter_at, exit_at, hours')
        .eq('department', state.department).order('enter_at', { ascending: false }).limit(2000);
      if (from) q = q.gte('enter_at', from);
      if (to) q = q.lte('enter_at', to);
      const { data, error } = await q;
      if (error) throw error;
      sessions = data || [];
    } catch (err) {
      summaryBox.innerHTML = '';
      summaryBox.append(el('div', { class: 'empty-state' }, `خطا در بارگذاری: ${err.message}`));
      return;
    }

    if (!sessions.length) {
      summaryBox.innerHTML = '';
      summaryBox.append(el('div', { class: 'empty-state' }, 'در این بازه هیچ نوبت ورود/خروج کاملی ثبت نشده.'));
      return;
    }

    // نام کامل و نقش هر ایمیل — برای نمایش خواناتر به‌جای فقط ایمیل
    const emails = [...new Set(sessions.map((s) => s.email))];
    const { data: roleRows } = await sb.from('user_roles').select('email, full_name, role').in('email', emails);
    const roleMap = Object.fromEntries((roleRows || []).map((r) => [r.email, r]));

    // خلاصه: مجموع ساعات به تفکیک ایمیل + معدن
    const summary = {};
    sessions.forEach((s) => {
      const key = `${s.email}__${s.mine_name}`;
      if (!summary[key]) summary[key] = { email: s.email, mine_name: s.mine_name, totalHours: 0, count: 0 };
      summary[key].totalHours += s.hours || 0;
      summary[key].count += 1;
    });

    summaryBox.innerHTML = '';
    summaryBox.append(el('div', { class: 'card' }, [
      el('h3', { style: 'font-size:var(--text-sm);margin-bottom:10px' }, '📊 خلاصه‌ی مجموع ساعات'),
      el('table', { style: 'width:100%;border-collapse:collapse;font-size:var(--text-xs)' }, [
        el('thead', {}, el('tr', {}, [
          el('th', { style: 'text-align:right;padding:6px' }, 'مسئول'),
          el('th', { style: 'text-align:right;padding:6px' }, 'معدن'),
          el('th', { style: 'text-align:right;padding:6px' }, 'تعداد نوبت'),
          el('th', { style: 'text-align:right;padding:6px' }, 'مجموع ساعات'),
        ])),
        el('tbody', {}, Object.values(summary)
          .sort((a, b) => b.totalHours - a.totalHours)
          .map((row) => {
            const r = roleMap[row.email];
            return el('tr', { style: 'border-top:1px solid var(--stone-200)' }, [
              el('td', { style: 'padding:6px' }, `${r?.full_name || row.email}${r ? ` (${ROLE_FA[r.role] || r.role})` : ''}`),
              el('td', { style: 'padding:6px' }, row.mine_name),
              el('td', { style: 'padding:6px' }, String(row.count)),
              el('td', { style: 'padding:6px;font-weight:700' }, fmtHours(row.totalHours)),
            ]);
          })),
      ]),
    ]));

    detailBox.append(el('div', { class: 'card', style: 'margin-top:14px' }, [
      el('h3', { style: 'font-size:var(--text-sm);margin-bottom:10px' }, '🗂️ ریز نوبت‌های ورود/خروج'),
      el('table', { style: 'width:100%;border-collapse:collapse;font-size:var(--text-xs)' }, [
        el('thead', {}, el('tr', {}, [
          el('th', { style: 'text-align:right;padding:6px' }, 'مسئول'),
          el('th', { style: 'text-align:right;padding:6px' }, 'معدن'),
          el('th', { style: 'text-align:right;padding:6px' }, 'ورود'),
          el('th', { style: 'text-align:right;padding:6px' }, 'خروج'),
          el('th', { style: 'text-align:right;padding:6px' }, 'مدت'),
        ])),
        el('tbody', {}, sessions.map((s) => {
          const r = roleMap[s.email];
          return el('tr', { style: 'border-top:1px solid var(--stone-200)' }, [
            el('td', { style: 'padding:6px' }, r?.full_name || s.email),
            el('td', { style: 'padding:6px' }, s.mine_name),
            el('td', { style: 'padding:6px' }, fmtDateTime(s.enter_at)),
            el('td', { style: 'padding:6px' }, fmtDateTime(s.exit_at)),
            el('td', { style: 'padding:6px' }, fmtHours(s.hours || 0)),
          ]);
        })),
      ]),
    ]));
  }

  loadBtn.addEventListener('click', () => load().catch((err) => showToast(`⚠️ ${err.message}`)));
  load().catch((err) => showToast(`⚠️ ${err.message}`));
}
