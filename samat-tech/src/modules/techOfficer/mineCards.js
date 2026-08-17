import { el, esc } from '../../lib/dom.js';
import { fetchAppLinks, appLinkHint } from '../../lib/appLinks.js';
import { openIncidentModal } from './incidentModal.js';

function mineSubLine(m, nameField) {
  if (nameField === 'نام_معدن') {
    return [
      `دارنده: ${m['نام_دارنده'] || '-'} | ماده معدنی: ${m['نام_ماده'] || '-'}`,
      `شماره پروانه: ${m['شماره_پروانه'] || '-'} | تاریخ پروانه: ${m['تاریخ_پروانه'] || '-'}`,
      `مساحت: ${m['مساحت'] || '-'} هکتار | ذخیره قطعی: ${m['ذخیره_قطعی'] || '-'} ${m['واحد'] || ''}`,
    ];
  }
  if (nameField === 'نام_متقاضی') return [`شماره پروانه اکتشاف: ${m['شماره_پروانه_اکتشاف'] || '-'}`];
  return [`محصول نهایی: ${m['محصول_نهایی'] || '-'}`];
}

/** کارت هر معدن/پرونده/واحد اختصاص‌یافته، با دکمه‌ی اعلام حادثه؛ به‌همراه بخش لینک سامانه‌های دولتی */
export function mountMineCards(container, mines, nameField, department, profileCtx) {
  container.innerHTML = '';
  if (!mines.length) {
    container.append(el('div', { class: 'banner banner-amber' }, 'هنوز هیچ موردی به شما اختصاص داده نشده — با مدیر سامانه تماس بگیرید.'));
    return;
  }
  mines.forEach((m) => {
    const lines = mineSubLine(m, nameField);
    container.append(el('div', { style: 'background:var(--stone-50);border:1px solid var(--stone-200);border-radius:var(--radius-md);padding:12px 14px;margin-bottom:10px' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:8px' }, [
        el('div', { style: 'font-weight:800;color:var(--ink-700)' }, esc(m[nameField] || '')),
        el('button', {
          class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700);flex-shrink:0',
          onclick: () => openIncidentModal(m, nameField, department, profileCtx),
        }, '🚨 اعلام حادثه'),
      ]),
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:6px;line-height:1.9' },
        lines.map((line) => el('div', {}, esc(line)))),
    ]));
  });
}

/** پنل لینک سامانه‌های دولتی خارج از اپ (سنم، کاداستر، سدف) — با راهنمای ورود اختصاصی هر سامانه */
export async function mountGovLinks(container, membershipNo, nationalCode) {
  container.innerHTML = '';
  const links = await fetchAppLinks();
  if (!links.length) return;
  const membership = membershipNo || '—';
  const national = nationalCode || '—';
  container.append(el('div', { class: 'card' }, [
    el('h3', {}, '🔑 سامانه‌های مورد نیاز'),
    ...links.map((l) => {
      const hint = appLinkHint(l.key, membership, national);
      return el('div', { style: 'display:flex;justify-content:space-between;align-items:center;background:var(--stone-100);border-radius:8px;padding:8px 10px;margin-bottom:6px;gap:8px' }, [
        el('div', {}, [
          el('div', { style: 'font-weight:700;font-size:var(--text-sm);color:var(--ink-700)' }, esc(l.label)),
          hint ? el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:2px' }, hint) : null,
        ]),
        el('a', { href: l.url, target: '_blank', rel: 'noopener', style: 'background:var(--patina-700);color:#fff;border-radius:6px;padding:6px 12px;font-size:var(--text-xs);text-decoration:none;white-space:nowrap;flex-shrink:0' }, `${l.icon} ورود ↗`),
      ]);
    }),
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:6px' }, '⚠️ این‌ها سامانه‌های رسمی خارج از این اپ‌اند؛ آمار باید جداگانه و طبق مهلت قانونی (معمولاً تا دهم هر ماه) در آن‌ها هم ثبت شود.'),
  ]));
}
