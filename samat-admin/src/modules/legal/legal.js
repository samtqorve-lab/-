import { el, esc, showToast } from '../../lib/dom.js';
import { fetchDeptRecords, applyGeoScope } from '../../lib/records.js';
import { DEPT_NAME_FIELD } from '../../lib/sections.js';
import { LEGAL_TABLES, LEGAL_TITLES, fetchAllLegalRecords, deleteLegalRecord, sendLegalComplianceDigest } from '../../lib/legal.js';
import { LEGAL_SCHEMAS, legalRowBadges } from './legalSchemas.js';
import { openLegalRecordModal } from './legalRecordModal.js';

const SUB_TABS = Object.keys(LEGAL_TABLES);
let activeSub = 'royalty';

export async function renderLegal(container, state) {
  container.append(el('div', { class: 'loading-state' }, [
    el('div', { class: 'spinner' }),
    'در حال بارگذاری الزامات قانونی...',
  ]));

  if (state.department !== 'معدن') {
    container.innerHTML = '';
    container.append(el('div', { class: 'empty-state' }, 'این ماژول فعلاً فقط برای بخش «معدن» فعال است (همان دامنه‌ی نسخه‌ی قبلی).'));
    return;
  }

  let mines;
  let cache;
  try {
    mines = applyGeoScope(await fetchDeptRecords('معدن'), state.assignedProvince, state.assignedCounty);
    const scopedNames = new Set(mines.map((m) => m[DEPT_NAME_FIELD['معدن']]));
    cache = await fetchAllLegalRecords('معدن', scopedNames);
  } catch (err) {
    container.innerHTML = '';
    container.append(el('div', { class: 'empty-state' }, `خطا در بارگذاری: ${err.message}`));
    return;
  }

  container.innerHTML = '';
  const mineNames = mines.map((m) => m[DEPT_NAME_FIELD['معدن']]).filter(Boolean);

  const tabs = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px' });
  SUB_TABS.forEach((sub) => {
    const btn = el('button', {
      class: `btn-sm${sub === activeSub ? '' : ''}`,
      style: sub === activeSub
        ? 'background:var(--ochre-600);color:#fff'
        : 'background:var(--stone-100);color:var(--ink-700)',
      onclick: () => { activeSub = sub; renderLegal(container, state); },
    }, LEGAL_TITLES[sub]);
    tabs.append(btn);
  });
  container.append(tabs);

  const addBtn = el('button', {
    class: 'btn btn-primary',
    style: 'margin-bottom:16px',
    onclick: () => openLegalRecordModal({
      sub: activeSub, mineNames, legalCache: cache,
      onSaved: () => renderLegal(container, state),
    }),
  }, `➕ ثبت مورد جدید — ${LEGAL_TITLES[activeSub]}`);
  const digestBtn = el('button', {
    class: 'btn btn-ghost',
    style: 'margin-bottom:16px;margin-inline-start:8px',
    onclick: () => sendLegalComplianceDigest(cache, showToast),
  }, '🔔 ارسال هشدار به تلگرام/روبیکا');
  container.append(addBtn, digestBtn);

  const rows = cache[activeSub] || [];
  if (!rows.length) {
    container.append(el('div', { class: 'empty-state' }, 'موردی برای این بخش ثبت نشده'));
    return;
  }

  const grouped = groupByMine(rows);
  Object.keys(grouped).sort().forEach((mineName) => {
    const section = el('div', { class: 'card', style: 'margin-bottom:14px' }, [
      el('h3', { style: 'font-size:var(--text-sm);margin-bottom:10px' }, `⛏️ ${mineName} (${grouped[mineName].length})`),
    ]);
    grouped[mineName].forEach((r) => section.append(renderRow(r, { sub: activeSub, mineNames, cache, container, state })));
    container.append(section);
  });
}

function groupByMine(rows) {
  const g = {};
  rows.forEach((r) => {
    const key = r.mine_name || '—';
    (g[key] = g[key] || []).push(r);
  });
  return g;
}

function renderRow(r, { sub, mineNames, cache, container, state }) {
  const schema = LEGAL_SCHEMAS[sub];
  const summaryLines = schema.summary(r);
  const badges = legalRowBadges(sub, r);

  const editBtn = el('button', { class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700)' }, '✏️');
  editBtn.addEventListener('click', () => openLegalRecordModal({
    sub, existing: r, mineNames, legalCache: cache, onSaved: () => renderLegal(container, state),
  }));

  const delBtn = el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)' }, '🗑');
  delBtn.addEventListener('click', async () => {
    if (!confirm('این مورد حذف شود؟')) return;
    try {
      await deleteLegalRecord(sub, r.id);
      showToast('🗑 حذف شد');
      renderLegal(container, state);
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    }
  });

  const docKey = schema.docUrlKey;
  const docLink = docKey && r[docKey]
    ? el('a', { href: r[docKey], target: '_blank', style: 'color:var(--ochre-600);font-size:var(--text-xs)' }, '📎 مستندات')
    : null;

  const row = el('div', { style: 'padding:8px 0;border-bottom:1px solid var(--stone-200);font-size:var(--text-sm)' }, [
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap' }, [
      el('b', {}, summaryLines[0]),
      el('div', { style: 'display:flex;gap:4px;align-items:center' }, [
        ...badges.map((b) => el('span', { class: 'badge', style: `color:${b.c};background:${b.bg}` }, b.l)),
        editBtn, delBtn,
      ]),
    ]),
    ...summaryLines.slice(1).map((line) => el('div', { style: 'color:var(--stone-600);font-size:var(--text-xs);margin-top:2px' }, line)),
    docLink ? el('div', { style: 'margin-top:2px' }, docLink) : null,
    r.notes ? el('div', { style: 'color:var(--stone-600);font-size:var(--text-xs);margin-top:2px' }, esc(r.notes)) : null,
  ]);
  return row;
}
