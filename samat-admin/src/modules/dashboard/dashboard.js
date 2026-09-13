import { el, showToast } from '../../lib/dom.js';
import { fetchDeptRecords, applyGeoScope, DEPT_TABLES } from '../../lib/records.js';
import { DEPT_NAME_FIELD } from '../../lib/sections.js';
import { licenseExpiryInfo } from '../../lib/jalali.js';
import { setTab, setDepartment } from '../../router.js';
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

/**
 * برخلاف بقیه‌ی این فایل که همیشه محدود به state.department است، این تابع هر ۵ بخش را یک‌جا
 * می‌خواند — برای دیدن وضعیت کل شهرستان (نه فقط بخشی که الان انتخاب شده) بدون سر زدن دستی به
 * هر بخش. اقدام اصلاحی باز/ماشین‌آلات در انتظار هم بدون فیلتر دپارتمان جمع زده می‌شوند.
 */
async function fetchCountyWideSummary(assignedProvince, assignedCounty) {
  const depts = Object.keys(DEPT_TABLES);
  const perDept = await Promise.all(depts.map(async (dept) => {
    const nameField = DEPT_NAME_FIELD[dept];
    let list = await fetchDeptRecords(dept).catch(() => []);
    list = applyGeoScope(list, assignedProvince, assignedCounty);
    const withExpiry = list.map((m) => licenseExpiryInfo(m, dept)).filter(Boolean);
    const expired = withExpiry.filter((i) => i.expired).length;
    const soon = withExpiry.filter((i) => !i.expired && i.monthsLeft <= 3).length;
    return { dept, nameField, total: list.length, expired, soon };
  }));

  const [correctiveRes, equipRes] = await Promise.all([
    sb.from('corrective_actions').select('id').eq('status', 'open'),
    sb.from('mine_equipment').select('id').eq('status', 'pending'),
  ]);

  return {
    perDept,
    totalRecords: perDept.reduce((s, d) => s + d.total, 0),
    totalExpired: perDept.reduce((s, d) => s + d.expired, 0),
    totalSoon: perDept.reduce((s, d) => s + d.soon, 0),
    openCorrective: (correctiveRes.data || []).length,
    pendingEquipment: (equipRes.data || []).length,
  };
}

function renderCountyWideSection(container) {
  const section = el('div', { class: 'card', style: 'margin-bottom:20px' });
  const toggleBtn = el('button', {
    class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700)',
    onclick: async () => {
      toggleBtn.disabled = true; toggleBtn.textContent = '⏳ در حال بارگذاری...';
      try {
        const summary = await fetchCountyWideSummary(undefined, undefined);
        body.innerHTML = '';
        body.append(el('div', { class: 'kpi-grid' }, [
          el('div', { class: 'kpi-card', style: '--kpi-accent:var(--schist-600)' }, [el('div', { class: 'kpi-n' }, String(summary.totalRecords)), el('div', { class: 'kpi-l' }, 'کل پروانه‌ها (همه‌ی بخش‌ها)')]),
          el('div', { class: 'kpi-card', style: '--kpi-accent:var(--rust-600)' }, [el('div', { class: 'kpi-n' }, String(summary.totalExpired)), el('div', { class: 'kpi-l' }, 'منقضی‌شده (کل)')]),
          el('div', { class: 'kpi-card', style: '--kpi-accent:var(--amber-600)' }, [el('div', { class: 'kpi-n' }, String(summary.totalSoon)), el('div', { class: 'kpi-l' }, 'نزدیک به انقضا (کل)')]),
          el('div', { class: 'kpi-card', style: '--kpi-accent:var(--ochre-600)', onclick: () => setTab('checklist') }, [el('div', { class: 'kpi-n' }, String(summary.openCorrective)), el('div', { class: 'kpi-l' }, 'اقدام اصلاحی باز (کل)')]),
          el('div', { class: 'kpi-card', style: '--kpi-accent:var(--clay-600)', onclick: () => setTab('checklist') }, [el('div', { class: 'kpi-n' }, String(summary.pendingEquipment)), el('div', { class: 'kpi-l' }, 'ماشین‌آلات در انتظار تایید (کل)')]),
        ]));
        const table = el('table', { class: 'data-table', style: 'width:100%;margin-top:14px;font-size:var(--text-sm)' });
        table.append(el('thead', {}, el('tr', {}, ['بخش', 'تعداد', 'منقضی', 'نزدیک به انقضا'].map((h) => el('th', {}, h)))));
        const tbody = el('tbody');
        summary.perDept.forEach((d) => {
          tbody.append(el('tr', { style: 'cursor:pointer', onclick: () => setDepartment(d.dept) }, [
            el('td', { style: 'font-weight:700' }, d.dept), el('td', {}, String(d.total)),
            el('td', { style: d.expired ? 'color:var(--rust-600);font-weight:700' : '' }, String(d.expired)),
            el('td', { style: d.soon ? 'color:var(--amber-600);font-weight:700' : '' }, String(d.soon)),
          ]));
        });
        table.append(tbody);
        body.append(table);
        toggleBtn.remove();
      } catch (err) {
        showToast(`⚠️ خطا: ${err.message}`);
        toggleBtn.disabled = false; toggleBtn.textContent = '🏛️ نمایش نمای کلی شهرستان (همه‌ی بخش‌ها)';
      }
    },
  }, '🏛️ نمایش نمای کلی شهرستان (همه‌ی بخش‌ها)');
  const body = el('div', { style: 'margin-top:10px' });
  section.append(el('h3', { style: 'margin-top:0' }, '🏛️ نمای کلی شهرستان'), toggleBtn, body);
  container.append(section);
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
  const reportBtn = el('button', {
    class: 'btn-sm', style: 'background:var(--ochre-100);color:var(--ochre-700);float:left;margin-inline-end:8px',
    onclick: async () => {
      reportBtn.disabled = true; reportBtn.textContent = '⏳ در حال آماده‌سازی...';
      try {
        const { generatePeriodicReport } = await import('../../lib/periodicReportGenerator.js');
        const blob = await generatePeriodicReport({ assignedProvince: state.assignedProvince, assignedCounty: state.assignedCounty });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `گزارش-دوره‌ای-سامت-${new Date().toISOString().slice(0, 10)}.docx`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        showToast(`❌ خطا در تولید گزارش: ${err.message}`);
      } finally {
        reportBtn.disabled = false; reportBtn.textContent = '📄 گزارش دوره‌ای Word';
      }
    },
  }, '📄 گزارش دوره‌ای Word');
  container.append(reportBtn, refreshBtn);
  container.append(el('div', {
    style: 'font-size:var(--text-xs);color:var(--stone-500);margin-bottom:10px;clear:both',
  }, 'داده‌ها تا ۱ دقیقه کش می‌شوند — اگر همین الان جای دیگری تغییری داده‌اید، از دکمه‌ی بالا استفاده کنید.'));

  renderCountyWideSection(container);

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
