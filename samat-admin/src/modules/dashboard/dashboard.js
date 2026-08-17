import { el } from '../../lib/dom.js';
import { fetchDeptRecords, applyGeoScope } from '../../lib/records.js';
import { DEPT_NAME_FIELD } from '../../lib/sections.js';
import { licenseExpiryInfo } from '../../lib/jalali.js';
import { setTab } from '../../router.js';
import { sb } from '../../lib/supabase.js';
import { fetchAllUsers } from '../../lib/users.js';

/**
 * قبلاً داشبورد فقط انقضای پروانه را نشان می‌داد؛ اقدامات اصلاحی باز، حوادث اخیر، ماشین‌آلات در
 * انتظار تایید، و کاربران در انتظار تایید هرکدام فقط در تب مخصوص خودشان دیده می‌شدند — یعنی ادمین
 * باید دستی همه‌ی تب‌ها را سر می‌زد تا بفهمد امروز چه چیزی نیاز به پیگیری دارد. این تابع همه‌ی
 * این‌ها را یک‌جا (فقط تعداد + چند مورد نمونه، نه جزئیات کامل) بالای داشبورد نشان می‌دهد.
 */
async function fetchAttentionSummary(department) {
  const [correctiveRes, incidentRes, equipRes, usersRes] = await Promise.all([
    sb.from('corrective_actions').select('id, description, mine_name, due_date, created_at').eq('department', department).eq('status', 'open').order('created_at', { ascending: false }),
    sb.from('incident_reports').select('id, incident_type, mine_name, created_at').eq('department', department).gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()).order('created_at', { ascending: false }),
    sb.from('mine_equipment').select('id, mine_name, machine_type').eq('department', department).eq('status', 'pending'),
    fetchAllUsers().catch(() => ({ pending: [] })),
  ]);
  return {
    corrective: correctiveRes.data || [],
    incidents: incidentRes.data || [],
    equipmentPending: equipRes.data || [],
    usersPending: usersRes.pending || [],
  };
}

function attentionCard({ icon, label, count, accent, onClick }) {
  return el('div', {
    class: 'kpi-card', style: `--kpi-accent:${accent};cursor:pointer`, onclick: onClick,
  }, [
    el('div', { class: 'kpi-n' }, String(count)),
    el('div', { class: 'kpi-l' }, `${icon} ${label}`),
  ]);
}

export async function renderDashboard(container, state, appCtx, opts = {}) {
  container.append(el('div', { class: 'loading-state' }, [
    el('div', { class: 'spinner' }),
    'در حال محاسبه‌ی شاخص‌ها...',
  ]));

  let list;
  try {
    list = await fetchDeptRecords(state.department, { force: opts.force });
    list = applyGeoScope(list, state.assignedProvince, state.assignedCounty);
  } catch (err) {
    container.innerHTML = '';
    container.append(el('div', { class: 'empty-state' }, `خطا در بارگذاری داده: ${err.message}`));
    return;
  }

  container.innerHTML = '';
  const nameField = DEPT_NAME_FIELD[state.department] || 'نام_معدن';

  const refreshBtn = el('button', {
    class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700);float:left',
    onclick: async () => { container.innerHTML = ''; await renderDashboard(container, state, appCtx, { force: true }); },
  }, '↻ به‌روزرسانی');
  container.append(refreshBtn);
  container.append(el('div', {
    style: 'font-size:var(--text-xs);color:var(--stone-500);margin-bottom:10px;clear:both',
  }, 'داده‌ها تا ۱ دقیقه کش می‌شوند — اگر همین الان جای دیگری تغییری داده‌اید، از دکمه‌ی بالا استفاده کنید.'));

  const attentionBox = el('div', { class: 'card', style: 'margin-bottom:20px' }, [
    el('div', { class: 'loading-state' }, 'در حال بررسی موارد نیازمند پیگیری...'),
  ]);
  container.append(attentionBox);
  fetchAttentionSummary(state.department).then((att) => {
    attentionBox.innerHTML = '';
    const total = att.corrective.length + att.incidents.length + att.equipmentPending.length + att.usersPending.length;
    const overdueCount = att.corrective.filter((c) => c.due_date && new Date(c.due_date).getTime() < Date.now()).length;
    attentionBox.append(el('h3', { style: 'margin-bottom:12px' }, `🔔 نیاز به پیگیری امروز ${total ? `(${total} مورد)` : ''}`));
    if (!total) {
      attentionBox.append(el('div', { style: 'color:var(--patina-700);font-size:var(--text-sm)' }, '✅ موردی برای پیگیری فوری نیست'));
      return;
    }
    const grid = el('div', { class: 'kpi-grid' });
    if (overdueCount) grid.append(attentionCard({ icon: '⏰', label: 'اقدام اصلاحی گذشته از موعد', count: overdueCount, accent: 'var(--rust-700)', onClick: () => setTab('checklist') }));
    if (att.corrective.length) grid.append(attentionCard({ icon: '🛠️', label: 'اقدام اصلاحی باز', count: att.corrective.length, accent: 'var(--amber-600)', onClick: () => setTab('checklist') }));
    if (att.incidents.length) grid.append(attentionCard({ icon: '🚨', label: 'حادثه (۷ روز اخیر)', count: att.incidents.length, accent: 'var(--rust-600)', onClick: () => setTab('checklist') }));
    if (att.equipmentPending.length) grid.append(attentionCard({ icon: '⚙️', label: 'ماشین‌آلات در انتظار تایید', count: att.equipmentPending.length, accent: 'var(--ochre-600)', onClick: () => setTab('checklist') }));
    if (att.usersPending.length) grid.append(attentionCard({ icon: '👤', label: 'کاربر در انتظار تایید', count: att.usersPending.length, accent: 'var(--schist-600)', onClick: () => setTab('users') }));
    attentionBox.append(grid);
  }).catch((err) => {
    attentionBox.innerHTML = '';
    attentionBox.append(el('div', { style: 'font-size:var(--text-xs);color:var(--rust-600)' }, `خطا در بارگذاری موارد نیازمند پیگیری: ${err.message}`));
  });

  // انقضای پروانه بر مبنای تاریخ شمسی + مدت اعتبار محاسبه می‌شود (نه یک فیلد «تاریخ انقضا» مجزا)
  const withExpiry = list.map((m) => ({ m, info: licenseExpiryInfo(m, state.department) })).filter((x) => x.info);
  const expired = withExpiry.filter((x) => x.info.expired);
  const soon = withExpiry.filter((x) => !x.info.expired && x.info.monthsLeft <= 3);
  const noCoords = list.filter((r) => !r['گوشه‌ها'] || !r['گوشه‌ها'].length);

  const kpis = [
    { n: list.length, l: 'تعداد کل پروانه‌ها', accent: 'var(--schist-600)' },
    { n: expired.length, l: 'پروانه منقضی‌شده', accent: 'var(--rust-600)' },
    { n: soon.length, l: 'نزدیک به انقضا (≤۳ ماه)', accent: 'var(--amber-600)' },
    { n: noCoords.length, l: 'بدون مختصات چهارگوش', accent: 'var(--ochre-600)' },
  ];

  const grid = el('div', { class: 'kpi-grid' });
  kpis.forEach((k) => {
    grid.append(el('div', { class: 'kpi-card', style: `--kpi-accent:${k.accent}` }, [
      el('div', { class: 'kpi-n' }, String(k.n)),
      el('div', { class: 'kpi-l' }, k.l),
    ]));
  });

  container.append(grid);

  if (expired.length || soon.length) {
    const section = el('div', { class: 'card', style: 'margin-top:24px' }, [
      el('h3', { style: 'margin-bottom:12px' }, '⏰ پروانه‌های نیازمند پیگیری'),
    ]);
    [...expired, ...soon].slice(0, 12).forEach(({ m, info }) => {
      section.append(el('div', {
        class: 'mine-row',
        style: `--row-accent:${info.expired ? 'var(--rust-600)' : 'var(--amber-600)'}`,
        onclick: () => setTab('mines'),
      }, [
        el('div', { style: 'flex:1' }, [
          el('div', { class: 'mine-name' }, m[nameField] || '—'),
          el('div', { class: 'mine-meta' }, `کد کاداستر: ${m['کد_کاداستر'] || '—'}`),
        ]),
        el('span', { class: `badge ${info.expired ? 'badge-rust' : 'badge-amber'}` },
          info.expired ? 'منقضی‌شده' : `${info.monthsLeft} ماه تا انقضا`),
      ]));
    });
    container.append(section);
  }

  if (!list.length) {
    container.append(el('div', { class: 'empty-state' }, 'رکوردی برای این بخش ثبت نشده'));
  }
}
