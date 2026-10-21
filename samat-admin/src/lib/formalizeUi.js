// پنجره‌ی «رسمی‌نویسی خودکار» ویرایشگر: ابتدا فهرست تغییرات پیشنهادی را نشان می‌دهد (روی متن انتخاب‌شده، یا کل متن
// اگر چیزی انتخاب نشده)، کاربر هر تغییر را رد/قبول می‌کند، و فقط موارد تأییدشده اعمال می‌شود.
// فرهنگ‌لغت شخصی هم از همین‌جا قابل ویرایش است.

import { el, showToast, openModal } from './dom.js';
import {
  analyzeText, composeText, loadCustomDict, saveCustomDict,
} from './formalizePlus.js';

function collectParts(area, range) {
  const parts = [];
  const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const val = node.nodeValue;
    if (!val.trim()) continue;
    let start = 0;
    let end = val.length;
    if (range) {
      if (!range.intersectsNode(node)) continue;
      if (node === range.startContainer) start = range.startOffset;
      if (node === range.endContainer) end = range.endOffset;
      if (start >= end) continue;
    }
    const text = val.slice(start, end);
    const core = text.trim();
    if (!core) continue;
    const lead = text.length - text.trimStart().length;
    parts.push({ node, from: start + lead, to: start + lead + core.length, core });
  }
  return parts;
}

/** جایگزینی یک بازه از یک نود متنی با execCommand (تا Ctrl+Z هم کار کند و قالب‌بندی اطراف حفظ شود) */
function replaceCore(node, from, to, text) {
  const r = document.createRange();
  r.setStart(node, from);
  r.setEnd(node, to);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  document.execCommand('insertText', false, text);
}

function openDictionaryManager(onDone) {
  const { body, close } = openModal({ title: '📖 فرهنگ‌لغت شخصی رسمی‌نویسی', width: '580px' });
  let pairs = loadCustomDict();
  const listBox = el('div', { style: 'max-height:36vh;overflow:auto;margin:8px 0;border:1px solid var(--stone-200);border-radius:8px' });
  const fromIn = el('input', { type: 'text', placeholder: 'عبارت محاوره‌ای (مثال: بزن بریم)' });
  const toIn = el('input', { type: 'text', placeholder: 'معادل رسمی (مثال: اقدام نماییم)' });
  const ioBox = el('textarea', { rows: '4', placeholder: 'برای خروجی گرفتن «نمایش خروجی» را بزنید؛ برای ورود، متن را اینجا بچسبانید (هر خط: عبارت => معادل، یا آرایه‌ی JSON)', style: 'width:100%;direction:ltr;font-size:12px' });

  function render() {
    listBox.innerHTML = '';
    if (!pairs.length) listBox.append(el('div', { style: 'padding:12px;text-align:center;color:var(--stone-600);font-size:var(--text-sm)' }, 'هنوز عبارتی اضافه نکرده‌اید'));
    pairs.forEach(([a, b], i) => {
      listBox.append(el('div', { style: 'display:flex;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--stone-200)' }, [
        el('span', { style: 'flex:1;color:var(--rust-700)' }, a),
        el('span', {}, '←'),
        el('span', { style: 'flex:1;color:var(--patina-700)' }, b),
        el('button', { type: 'button', class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)', onclick: () => { pairs.splice(i, 1); saveCustomDict(pairs); render(); } }, '🗑'),
      ]));
    });
  }
  render();

  const addBtn = el('button', {
    type: 'button',
    class: 'btn btn-primary',
    style: 'margin-top:8px',
    onclick: () => {
      const a = fromIn.value.trim();
      const b = toIn.value.trim();
      if (!a || !b) { showToast('⚠️ هر دو بخش را پر کنید'); return; }
      const i = pairs.findIndex((p) => p[0] === a);
      if (i >= 0) pairs[i] = [a, b]; else pairs.push([a, b]);
      saveCustomDict(pairs);
      fromIn.value = '';
      toIn.value = '';
      render();
    },
  }, '➕ افزودن');

  const parseIo = (txt) => {
    const t = txt.trim();
    if (!t) return [];
    try {
      const j = JSON.parse(t);
      if (Array.isArray(j)) return j.filter((p) => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string').map(([a, b]) => [a.trim(), b.trim()]);
    } catch { /* متن خطی است */ }
    return t.split('\n').map((l) => l.split(/=>|=|←|\t/)).filter((p) => p.length >= 2 && p[0].trim() && p[1].trim()).map((p) => [p[0].trim(), p[1].trim()]);
  };

  body.append(
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600)' }, 'عبارت‌های شما بر فرهنگ‌لغت داخلی اولویت دارند و فقط روی همین مرورگر/دستگاه ذخیره می‌شوند. برای انتقال به دستگاه دیگر از «خروجی/ورودی» پایین استفاده کنید.'),
    listBox,
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px' }, [el('div', {}, [el('label', {}, 'محاوره‌ای'), fromIn]), el('div', {}, [el('label', {}, 'رسمی'), toIn])]),
    addBtn,
    el('div', { style: 'margin-top:14px' }, [ioBox]),
    el('div', { style: 'display:flex;gap:6px;margin-top:6px;flex-wrap:wrap' }, [
      el('button', { type: 'button', class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700)', onclick: () => { ioBox.value = JSON.stringify(pairs); } }, '📤 نمایش خروجی'),
      el('button', {
        type: 'button',
        class: 'btn-sm',
        style: 'background:var(--stone-100);color:var(--ink-700)',
        onclick: () => {
          const add = parseIo(ioBox.value);
          if (!add.length) { showToast('⚠️ موردی برای ورود پیدا نشد'); return; }
          add.forEach(([a, b]) => { const i = pairs.findIndex((p) => p[0] === a); if (i >= 0) pairs[i] = [a, b]; else pairs.push([a, b]); });
          saveCustomDict(pairs);
          ioBox.value = '';
          render();
          showToast(`✅ ${add.length.toLocaleString('fa-IR')} عبارت وارد شد`);
        },
      }, '📥 ورود'),
      el('button', { type: 'button', class: 'btn btn-ghost', style: 'margin-inline-start:auto', onclick: () => { close(); onDone(); } }, 'بستن و تحلیل دوباره'),
    ]),
  );
}

/**
 * @param {{ area: HTMLElement, changed: () => void }} ctx
 * @param {Range|null|undefined} keepRange بازه‌ی انتخابِ قبلی (هنگام بازگشت از مدیریت فرهنگ‌لغت)
 */
export function openFormalizeDialog(ctx, keepRange) {
  const { area, changed } = ctx;
  const sel = window.getSelection();
  let range = keepRange || null;
  if (!range && sel && sel.rangeCount && !sel.isCollapsed && area.contains(sel.anchorNode) && area.contains(sel.focusNode)) {
    range = sel.getRangeAt(0).cloneRange();
  }
  const custom = loadCustomDict();
  const parts = collectParts(area, range).map((p) => ({ ...p, analysis: analyzeText(p.core, custom) }));
  if (!parts.length) { showToast('⚠️ متنی برای رسمی‌نویسی وجود ندارد'); return; }

  const agg = new Map();
  parts.forEach((p) => p.analysis.changes.forEach((c) => {
    const e = agg.get(c.key);
    if (e) e.count += c.count; else agg.set(c.key, { ...c });
  }));
  const rows = [...agg.values()].sort((a, b) => b.count - a.count);

  const { body, close } = openModal({ title: '✍️ رسمی‌نویسی خودکار — پیش‌نمایش تغییرات', width: '700px' });
  const dictBtn = el('button', {
    type: 'button',
    class: 'btn btn-ghost',
    onclick: () => { close(); openDictionaryManager(() => openFormalizeDialog(ctx, range)); },
  }, '📖 فرهنگ‌لغت شخصی');

  body.append(el('div', { style: 'font-size:var(--text-sm);margin-bottom:8px' },
    `${range ? 'فقط روی متن انتخاب‌شده' : 'روی کل متن'} — ${rows.length.toLocaleString('fa-IR')} نوع تغییر پیشنهاد شد. تیکِ مواردی را که نمی‌خواهید بردارید.`));

  if (!rows.length) {
    body.append(
      el('div', { style: 'padding:18px;text-align:center;color:var(--stone-600)' }, 'مورد محاوره‌ای برای تغییر پیدا نشد. اگر عبارتی هست که باید رسمی شود، آن را در فرهنگ‌لغت شخصی اضافه کنید.'),
      el('div', { style: 'display:flex;gap:6px' }, [dictBtn, el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, 'بستن')]),
    );
    return;
  }

  const checks = [];
  const listBox = el('div', { style: 'max-height:48vh;overflow:auto;border:1px solid var(--stone-200);border-radius:8px' });
  rows.forEach((r) => {
    const cb = el('input', { type: 'checkbox', checked: '' });
    checks.push({ key: r.key, cb });
    listBox.append(el('label', { style: 'display:flex;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--stone-200);cursor:pointer' }, [
      cb,
      el('span', { style: 'flex:1;color:var(--rust-700);text-decoration:line-through;word-break:break-word' }, r.from || '(حذف)'),
      el('span', {}, '←'),
      el('span', { style: 'flex:1;color:var(--patina-700);font-weight:600;word-break:break-word' }, r.to || '(حذف)'),
      r.count > 1 ? el('span', { style: 'font-size:11px;color:var(--stone-600)' }, `×${r.count.toLocaleString('fa-IR')}`) : null,
    ]));
  });

  const setAll = (v) => checks.forEach(({ cb }) => { cb.checked = v; });
  const applyBtn = el('button', {
    type: 'button',
    class: 'btn btn-primary',
    style: 'flex:1;justify-content:center',
    onclick: () => {
      const rejected = new Set(checks.filter(({ cb }) => !cb.checked).map(({ key }) => key));
      const accepted = rows.filter((r) => !rejected.has(r.key)).reduce((s, r) => s + r.count, 0);
      close();
      area.focus();
      // از آخر به اول، تا جابه‌جایی متن، آفست نودهای قبلی را به‌هم نریزد
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const p = parts[i];
        if (!p.node.isConnected) continue;
        const composed = composeText(p.analysis.segments, rejected);
        if (composed !== p.core) replaceCore(p.node, p.from, p.to, composed);
      }
      changed();
      showToast(accepted ? `✅ ${accepted.toLocaleString('fa-IR')} تغییر اعمال شد (با Ctrl+Z قابل بازگشت است)` : 'تغییری اعمال نشد');
    },
  }, '✅ اعمال تغییرات انتخاب‌شده');

  body.append(
    el('div', { style: 'display:flex;gap:6px;margin-bottom:6px' }, [
      el('button', { type: 'button', class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700)', onclick: () => setAll(true) }, 'انتخاب همه'),
      el('button', { type: 'button', class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700)', onclick: () => setAll(false) }, 'هیچ‌کدام'),
    ]),
    listBox,
    el('div', { style: 'display:flex;gap:6px;margin-top:12px;flex-wrap:wrap' }, [
      applyBtn,
      dictBtn,
      el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, 'انصراف'),
    ]),
  );
}
