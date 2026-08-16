import { el, esc, fmtDate } from '../../lib/dom.js';
import { groupByMine } from '../../lib/supplementary.js';

function mineWrap(mineName, count, children) {
  return el('div', { style: 'margin-bottom:18px' }, [
    el('div', { style: 'font-size:var(--text-sm);font-weight:800;color:var(--patina-700);border-bottom:2px solid var(--patina-700);padding-bottom:5px;margin-bottom:8px' }, [
      `⛏️ ${mineName} `,
      el('span', { style: 'font-size:var(--text-xs);color:var(--stone-600);font-weight:400' }, `(${count} مورد)`),
    ]),
    ...children,
  ]);
}

function empty() {
  return el('div', { class: 'empty-state' }, 'موردی یافت نشد');
}

function eachMine(rows, itemsFn) {
  const g = groupByMine(rows);
  return Object.keys(g).sort().map((mine) => mineWrap(mine, g[mine].length, itemsFn(g[mine])));
}

const ROLE_META = {
  tech_officer: { l: '🦺 مسئول فنی', c: '#1565c0' },
  safety_officer: { l: '🦺 مسئول ایمنی', c: '#b71c1c' },
  health_officer: { l: '⚕️ بهداشت حرفه‌ای', c: '#2e7d32' },
};

export function renderChecklist(rows) {
  if (!rows.length) return [empty()];
  return eachMine(rows, (list) => list.map((c) => {
    const items = Array.isArray(c.items) ? c.items : [];
    const issues = items.filter((i) => i.status === 'issue');
    const rm = ROLE_META[c.submitter_role] || ROLE_META.tech_officer;
    const photos = items.filter((i) => i.photo_url);
    return el('div', { style: `background:${c.overall_status === 'issues' ? 'var(--amber-50)' : 'var(--patina-50)'};border-radius:8px;padding:10px 12px;margin-bottom:6px;font-size:var(--text-sm)` }, [
      el('div', { style: 'display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px' }, [
        el('b', {}, `نوبت ${c.shift_type} — ${fmtDate(c.shift_date)}`),
        el('span', { style: `color:${c.overall_status === 'issues' ? 'var(--amber-700)' : 'var(--patina-700)'};font-weight:700` },
          c.overall_status === 'issues' ? `⚠️ ${issues.length} مورد` : '✅ سالم'),
      ]),
      el('div', { style: 'display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;margin-top:2px;font-size:var(--text-xs)' }, [
        el('span', { style: 'color:var(--stone-600)' }, `ثبت‌کننده: ${c.submitted_by || '—'}`),
        el('span', { style: `color:${rm.c};font-weight:700` }, rm.l),
      ]),
      c.inside_boundary === false ? el('div', { style: 'color:var(--rust-600);font-size:var(--text-xs);font-weight:700;margin-top:2px' }, '⚠️ خارج از محدوده قانونی معدن ثبت شده')
        : c.inside_boundary === true ? el('div', { style: 'color:var(--patina-700);font-size:var(--text-xs);margin-top:2px' }, '✅ داخل محدوده معدن') : null,
      issues.length ? el('div', { style: 'margin-top:6px' }, issues.map((i) => el('div', { style: 'color:var(--rust-600);font-size:var(--text-xs)' }, `⚠️ ${i.item}${i.note ? ` — ${i.note}` : ''}`))) : null,
      photos.length ? el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px' }, photos.map((i) =>
        el('img', { src: i.photo_url, title: i.item, style: 'width:56px;height:56px;object-fit:cover;border-radius:6px;cursor:pointer', onclick: () => window.open(i.photo_url, '_blank') }))) : null,
      c.notes ? el('div', { style: 'color:var(--stone-600);font-size:var(--text-xs);margin-top:4px' }, esc(c.notes)) : null,
    ]);
  }));
}

export function renderTraining(rows) {
  if (!rows.length) return [empty()];
  return eachMine(rows, (list) => list.map((t) => el('div', { style: 'background:var(--stone-50);border-radius:8px;padding:10px 12px;margin-bottom:6px;font-size:var(--text-sm)' }, [
    el('b', {}, t.topic), el('span', { style: 'color:var(--stone-600)' }, ` — ${fmtDate(t.training_date)}`),
    t.trainer_name ? el('div', { style: 'color:var(--stone-600);font-size:var(--text-xs)' }, `مدرس: ${t.trainer_name}`) : null,
    el('div', { style: 'color:var(--stone-600);font-size:var(--text-xs)' }, `تعداد شرکت‌کننده: ${t.attendee_count || 0}`),
    t.attendee_names ? el('div', { style: 'color:var(--stone-600);font-size:var(--text-xs)' }, `شرکت‌کنندگان: ${t.attendee_names}`) : null,
    t.notes ? el('div', { style: 'color:var(--stone-600);font-size:var(--text-xs)' }, esc(t.notes)) : null,
    t.photo_url ? el('img', { src: t.photo_url, style: 'width:60px;height:60px;object-fit:cover;border-radius:6px;margin-top:6px;cursor:pointer', onclick: () => window.open(t.photo_url, '_blank') }) : null,
  ])));
}

export function renderProduction(rows) {
  if (!rows.length) return [empty()];
  return eachMine(rows, (list) => [
    el('table', { style: 'width:100%;border-collapse:collapse;font-size:var(--text-sm)' }, [
      el('tr', { style: 'color:var(--stone-600);text-align:right' }, [
        el('th', { style: 'padding:4px' }, 'دوره'), el('th', {}, 'ماده'), el('th', {}, 'تناژ (تن)'), el('th', {}, 'عیار٪'),
      ]),
      ...list.map((p) => el('tr', { style: 'border-top:1px solid var(--stone-200)' }, [
        el('td', { style: 'padding:4px' }, p.period || ''), el('td', {}, p.material || '—'),
        el('td', {}, String(p.tonnage ?? '—')), el('td', {}, String(p.grade_percent ?? '—')),
      ])),
    ]),
  ]);
}

export function renderPersonnel(rows) {
  if (!rows.length) return [empty()];
  return eachMine(rows, (list) => list.map((p) => el('div', { style: 'padding:6px 0;border-bottom:1px solid var(--stone-200);font-size:var(--text-sm)' }, [
    el('b', {}, p.full_name), p.role ? ` — ${p.role}` : '', p.phone ? ` | ${p.phone}` : '',
    el('div', { style: `font-size:var(--text-xs);color:${p.status === 'active' ? 'var(--patina-700)' : 'var(--stone-600)'}` }, p.status === 'active' ? '✅ فعال' : '⏸️ غیرفعال'),
  ])));
}

const SRC_LABEL = { equipment: '⚙️ ماشین‌آلات', incident: '🚨 حادثه', report: '📋 گزارش دوره‌ای', other: '❓ سایر' };

export function renderCorrective(rows, { onClose }) {
  if (!rows.length) return [empty()];
  const now = Date.now();
  return eachMine(rows, (list) => list.map((a) => {
    const overdue = a.status === 'open' && a.due_date && new Date(a.due_date).getTime() < now;
    const closeBtn = a.status === 'open'
      ? el('button', { class: 'btn-sm', style: 'background:var(--patina-100);color:var(--patina-700);margin-top:6px', onclick: () => onClose(a.id) }, '✅ بستن این مورد')
      : null;
    return el('div', { style: `background:${overdue ? 'var(--rust-50)' : a.status === 'open' ? 'var(--amber-50)' : 'var(--patina-50)'};border-radius:8px;padding:10px 12px;margin-bottom:6px;font-size:var(--text-sm)${overdue ? ';border-right:4px solid var(--rust-600)' : ''}` }, [
      el('div', { style: 'display:flex;justify-content:space-between' }, [
        el('b', {}, SRC_LABEL[a.source_type] || a.source_type),
        el('span', { style: `color:${overdue ? 'var(--rust-700)' : a.status === 'open' ? 'var(--amber-700)' : 'var(--patina-700)'};font-weight:700` },
          overdue ? '⏰ گذشته از موعد' : a.status === 'open' ? '⏳ باز' : '✅ بسته‌شده'),
      ]),
      el('div', { style: 'margin-top:4px' }, esc(a.description)),
      el('div', { style: 'color:var(--stone-600);font-size:var(--text-xs);margin-top:2px' }, `${fmtDate(a.created_at)}${a.due_date ? ` | مهلت: ${a.due_date}` : ''}`),
      a.closed_note ? el('div', { style: 'color:var(--patina-700);font-size:var(--text-xs);margin-top:2px' }, `یادداشت بسته‌شدن: ${esc(a.closed_note)}`) : null,
      closeBtn,
    ]);
  }));
}

export function renderQuarterlyMaps(rows) {
  if (!rows.length) return [empty()];
  return eachMine(rows, (list) => list.map((m) => el('div', {
    style: 'background:var(--stone-50);border-radius:8px;padding:10px 12px;margin-bottom:6px;font-size:var(--text-sm);display:flex;justify-content:space-between;align-items:center',
  }, [
    el('div', {}, [
      el('b', {}, m.period),
      el('div', { style: 'color:var(--stone-600);font-size:var(--text-xs)' }, fmtDate(m.created_at)),
      m.notes ? el('div', { style: 'color:var(--stone-600);font-size:var(--text-xs)' }, esc(m.notes)) : null,
    ]),
    el('a', { href: m.file_url, target: '_blank', style: 'color:var(--ochre-600)' }, '📄 مشاهده فایل'),
  ])));
}

const INCIDENT_ICON = { 'ریزش': '🪨', 'سقوط': '⬇️', 'برخورد با ماشین‌آلات': '🚜', 'برق‌گرفتگی': '⚡', 'انفجار/آتش‌سوزی': '🔥', 'خفگی/گاز': '💨' };

export function renderIncidents(rows) {
  if (!rows.length) return [empty()];
  return eachMine(rows, (list) => list.map((r) => {
    const photos = (r.file_urls && r.file_urls.photos) || [];
    const voice = (r.file_urls && r.file_urls.voice) || [];
    const severe = r.fatality_count > 0 ? 'var(--rust-50)' : r.injured_count > 0 ? 'var(--amber-50)' : 'var(--stone-50)';
    const borderColor = r.fatality_count > 0 ? 'var(--rust-600)' : r.injured_count > 0 ? 'var(--amber-600)' : 'var(--stone-300)';
    return el('div', { style: `background:${severe};border-right:4px solid ${borderColor};border-radius:8px;padding:10px 12px;margin-bottom:6px;font-size:var(--text-sm)` }, [
      el('div', { style: 'display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px' }, [
        el('b', {}, `${INCIDENT_ICON[r.incident_type] || '🚨'} ${r.incident_type || 'حادثه'}`),
        el('span', { style: 'color:var(--stone-500);font-size:var(--text-xs)' }, fmtDate(r.created_at)),
      ]),
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:4px' }, `زمان وقوع: ${r.occurred_at ? new Date(r.occurred_at).toLocaleString('fa-IR') : '—'} | محل: ${esc(r.location_detail || '—')}`),
      el('div', { style: 'font-size:var(--text-xs);font-weight:700;margin-top:4px;color:var(--ink-700)' }, `🤕 مصدوم: ${r.injured_count || 0}   ⚰️ فوتی: ${r.fatality_count || 0}`),
      r.description ? el('div', { style: 'margin-top:6px' }, esc(r.description)) : null,
      r.immediate_actions ? el('div', { style: 'color:var(--stone-600);font-size:var(--text-xs);margin-top:4px' }, `🛠️ اقدامات فوری: ${esc(r.immediate_actions)}`) : null,
      el('div', { style: 'color:var(--stone-500);font-size:var(--text-xs);margin-top:4px' }, `ثبت‌کننده: ${r.submitted_by || '—'}`),
      r.notify_failed ? el('div', { style: 'color:var(--rust-600);font-size:var(--text-xs);margin-top:4px' }, '⚠️ اطلاع‌رسانی فوری به مسئولین ناموفق بود') : null,
      photos.length ? el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px' }, photos.map((u, i) =>
        el('img', { src: u, title: `عکس ${i + 1}`, style: 'width:64px;height:64px;object-fit:cover;border-radius:6px;cursor:pointer', onclick: () => window.open(u, '_blank') }))) : null,
      voice.length ? el('audio', { controls: true, src: voice[0], style: 'width:100%;height:32px;margin-top:8px' }) : null,
    ]);
  }));
}

const EQUIP_STATUS_META = {
  pending: { l: '⏳ در انتظار بررسی', c: 'var(--amber-700)', bg: 'var(--amber-50)' },
  approved: { l: '✅ تایید‌شده', c: 'var(--patina-700)', bg: 'var(--patina-50)' },
  rejected: { l: '❌ رد‌شده', c: 'var(--rust-700)', bg: 'var(--rust-50)' },
};

/** ردیف‌های خام mine_equipment را بر اساس device_key (هر دستگاه) گروه‌بندی می‌کند تا عکس نمای‌دور و سریال یک دستگاه کنار هم دیده شوند */
function groupByDevice(rows) {
  const g = {};
  rows.forEach((r) => { const k = r.device_key || `row_${r.id}`; (g[k] = g[k] || []).push(r); });
  return g;
}

export function renderEquipment(rows, { onApprove, onReject }) {
  if (!rows.length) return [empty()];
  return eachMine(rows, (list) => {
    const byDevice = groupByDevice(list);
    return Object.values(byDevice).map((deviceRows) => {
      const first = deviceRows[0];
      const status = deviceRows.some((r) => r.status === 'pending') ? 'pending' : first.status;
      const meta = EQUIP_STATUS_META[status] || EQUIP_STATUS_META.pending;
      const actions = status === 'pending' ? el('div', { style: 'display:flex;gap:6px;margin-top:8px' }, [
        el('button', { class: 'btn-sm', style: 'background:var(--patina-600);color:#fff', onclick: () => onApprove(deviceRows.map((r) => r.id)) }, '✅ تایید'),
        el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)', onclick: () => onReject(deviceRows.map((r) => r.id)) }, '❌ رد'),
      ]) : null;
      return el('div', { style: `background:${meta.bg};border-radius:8px;padding:10px 12px;margin-bottom:6px;font-size:var(--text-sm)` }, [
        el('div', { style: 'display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px' }, [
          el('b', {}, `${first.machine_type || 'دستگاه نامشخص'}${first.plate_no ? ` — ${first.plate_no}` : ''}`),
          el('span', { style: `color:${meta.c};font-weight:700;font-size:var(--text-xs)` }, meta.l),
        ]),
        el('div', { style: 'color:var(--stone-600);font-size:var(--text-xs);margin-top:2px' },
          `ثبت‌کننده: ${first.submitted_by || '—'} — ${fmtDate(first.created_at)}${first.inside_boundary === false ? ' — ⚠️ خارج از محدوده' : ''}`),
        first.reject_reason ? el('div', { style: 'color:var(--rust-600);font-size:var(--text-xs);margin-top:2px' }, `دلیل رد: ${esc(first.reject_reason)}`) : null,
        el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px' }, deviceRows.filter((r) => r.photo_url).map((r) =>
          el('div', { style: 'text-align:center' }, [
            el('img', { src: r.photo_url, style: 'width:64px;height:64px;object-fit:cover;border-radius:6px;cursor:pointer', onclick: () => window.open(r.photo_url, '_blank') }),
            el('div', { style: 'font-size:10px;color:var(--stone-500)' }, r.photo_type === 'overview' ? 'نمای دور' : r.photo_type === 'serial' ? 'سریال' : 'سایر'),
          ]))),
        actions,
      ]);
    });
  });
}
