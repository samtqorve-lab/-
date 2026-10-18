// ویرایشگر متن غنی (Rich Text) سبک و بدون وابستگی — برای گزارش‌نویسی.
// مبتنی بر contenteditable؛ خروجی HTML همیشه از sanitizeHtml می‌گذرد (فقط تگ/استایل‌های مجاز) تا
// متنی که کاربر می‌نویسد یا از Word/وب کپی می‌کند هیچ‌وقت اسکریپت یا ظاهر مخرب وارد رکورد نکند.

import { el, esc, showToast, openModal } from './dom.js';
import { todayJalali, formatJalali } from './jalaliCalendar.js';
import { formalizeKeepingEdges } from './formalize.js';

/* ───────────── پاک‌سازی HTML ───────────── */

const ALLOWED_TAGS = new Set([
  'P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SPAN', 'FONT', 'H1', 'H2', 'H3', 'H4',
  'UL', 'OL', 'LI', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'HR', 'A', 'SUB', 'SUP', 'CAPTION',
]);
// این تگ‌ها همراه با محتوایشان حذف می‌شوند (بقیه‌ی تگ‌های غیرمجاز فقط باز می‌شوند و متنشان می‌ماند)
const DROP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT',
  'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'HEAD', 'TITLE',
]);
const STYLE_OK = /^(font-family|font-size|font-weight|font-style|color|background-color|text-align|text-indent|direction|unicode-bidi|line-height|vertical-align|width|border-collapse|list-style-type|text-decoration(-line|-style|-color|-thickness)?|(margin|padding)(-(top|right|bottom|left))?|border(-(top|right|bottom|left))?(-(width|style|color))?)$/;
const BAD_VALUE = /url\s*\(|expression\s*\(|javascript:|@import|behavior|[<>\\]/i;

export function sanitizeHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  const out = document.createElement('div');
  const walk = (src, dst) => {
    src.childNodes.forEach((node) => {
      if (node.nodeType === 3) { dst.append(document.createTextNode(node.nodeValue)); return; }
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toUpperCase();
      if (DROP_TAGS.has(tag)) return;
      if (!ALLOWED_TAGS.has(tag)) { walk(node, dst); return; }
      const isFont = tag === 'FONT';
      const clean = document.createElement(isFont ? 'span' : tag.toLowerCase());
      let style = '';
      if (isFont) {
        const face = node.getAttribute('face');
        const color = node.getAttribute('color');
        if (face && !BAD_VALUE.test(face)) style += `font-family:${face};`;
        if (color && /^#?[0-9a-z]{3,20}$/i.test(color)) style += `color:${color};`;
      }
      const raw = node.style;
      if (raw) {
        for (let i = 0; i < raw.length; i += 1) {
          const name = raw[i];
          if (!STYLE_OK.test(name)) continue;
          const v = raw.getPropertyValue(name);
          if (!v || BAD_VALUE.test(v)) continue;
          style += `${name}:${v};`;
        }
      }
      if (style) clean.setAttribute('style', style);
      const dir = node.getAttribute('dir');
      if (dir === 'rtl' || dir === 'ltr') clean.setAttribute('dir', dir);
      if (tag === 'TD' || tag === 'TH') {
        ['colspan', 'rowspan'].forEach((a) => {
          const n = parseInt(node.getAttribute(a), 10);
          if (n > 1 && n < 50) clean.setAttribute(a, String(n));
        });
      }
      if (tag === 'A') {
        const href = (node.getAttribute('href') || '').trim();
        if (/^(https?:|mailto:|tel:)/i.test(href)) {
          clean.setAttribute('href', href);
          clean.setAttribute('target', '_blank');
          clean.setAttribute('rel', 'noopener noreferrer');
        }
      }
      walk(node, clean);
      dst.append(clean);
    });
  };
  walk(doc.body, out);
  return out.innerHTML;
}

/** HTML (پاک‌سازی‌شده) → متن ساده با خط‌شکستن‌های منطقی — برای فیلد narrative که با نسخه‌های قبلی سازگار می‌ماند */
export function htmlToText(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = sanitizeHtml(html);
  tmp.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
  tmp.querySelectorAll('p,div,li,h1,h2,h3,h4,blockquote,tr,hr,caption').forEach((b) => b.append('\n'));
  tmp.querySelectorAll('td,th').forEach((c) => c.append('\t'));
  return tmp.textContent.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** متن ساده → HTML پاراگرافی (برای باز کردن گزارش‌های قدیمی که فقط متن ساده داشتند) */
export function textToHtml(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('');
}

/* ───────────── استایل ویرایشگر ───────────── */

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement('style');
  s.id = 'rte-style';
  s.textContent = `
.rte{border:1.5px solid var(--stone-300);border-radius:8px;background:var(--surface);overflow:hidden}
.rte--full{position:fixed;inset:0;z-index:1700;border-radius:0;display:flex;flex-direction:column}
.rte-toolbar{display:flex;flex-wrap:wrap;gap:4px;padding:6px;background:var(--stone-50);border-bottom:1px solid var(--stone-200);align-items:center}
.rte-group{display:flex;gap:2px;align-items:center;padding:0 4px;border-inline-end:1px solid var(--stone-200)}
.rte-group:last-child{border-inline-end:none}
.rte-btn{min-width:28px;height:28px;padding:0 6px;border:1px solid transparent;background:transparent;border-radius:5px;cursor:pointer;font-size:13px;color:var(--ink-900);font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:3px}
.rte-btn:hover{background:var(--stone-100)}
.rte-btn.on{background:var(--ochre-100,#f6ead2);border-color:var(--ochre-500,#c8923a)}
.rte-sel{height:28px;font-size:12px;padding:0 4px;border:1px solid var(--stone-300);border-radius:5px;background:var(--surface);color:var(--ink-900);max-width:130px}
.rte-color{width:22px;height:22px;padding:0;border:none;background:none;cursor:pointer}
.rte-sub{display:none;flex-wrap:wrap;gap:6px;align-items:center;padding:6px;background:var(--stone-50);border-bottom:1px solid var(--stone-200);font-size:12px}
.rte-sub input{height:28px;font-size:12px;padding:0 6px;border:1px solid var(--stone-300);border-radius:5px;background:var(--surface);color:var(--ink-900);width:140px}
.rte-area{min-height:var(--rte-min,280px);padding:14px 16px;outline:none;font-family:'B Nazanin','BNazanin','Nazanin','Vazirmatn',serif;font-size:16px;line-height:2.1;direction:rtl;text-align:right;overflow-y:auto;color:var(--ink-900)}
.rte--full .rte-area{flex:1;max-width:900px;width:100%;margin:0 auto}
.rte-area:empty:before{content:attr(data-placeholder);color:var(--stone-500)}
.rte-area table{border-collapse:collapse;width:100%;margin:8px 0}
.rte-area td,.rte-area th{border:1px solid var(--stone-400,#999);padding:4px 8px;min-width:30px;vertical-align:top}
.rte-area hr{border:0;border-top:1px solid var(--stone-400,#999);margin:12px 0}
.rte-area h2{font-size:1.35em;font-weight:700}.rte-area h3{font-size:1.2em;font-weight:700}.rte-area h4{font-size:1.05em;font-weight:700}
.rte-area blockquote{border-inline-start:3px solid var(--stone-300);padding-inline-start:10px;margin:6px 0;color:var(--ink-700)}
.rte-area a{color:var(--patina-700,#1d6f8a);text-decoration:underline}
.rte-status{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--stone-600);padding:4px 10px;border-top:1px solid var(--stone-200);background:var(--stone-50)}
`;
  document.head.append(s);
}

const DEFAULT_SNIPPETS = [
  'احتراماً به استحضار می‌رساند،',
  'پیرو مأموریت محوله، بازدید به عمل آمد.',
  'در بازدید به عمل آمده، موارد زیر مشاهده شد:',
  'موضوع در حال پیگیری است.',
  'مراتب جهت استحضار و صدور دستور مقتضی تقدیم می‌گردد.',
  'خواهشمند است دستور فرمایید اقدام لازم معمول گردد.',
  'با تشکر',
];

const FONT_FAMILIES = [
  ['فونت', ''], ['وزیرمتن', 'Vazirmatn'], ['بی‌نازنین', 'B Nazanin'], ['بی‌تیتر', 'B Titr'],
  ['Tahoma', 'Tahoma'], ['Arial', 'Arial'], ['Times New Roman', 'Times New Roman'],
];
const FONT_SIZES = [['اندازه', ''], ['11', '11'], ['12', '12'], ['13', '13'], ['14', '14'], ['16', '16'], ['18', '18'], ['20', '20'], ['24', '24'], ['28', '28'], ['32', '32']];
const BLOCK_FORMATS = [['سبک پاراگراف', ''], ['متن عادی', '<p>'], ['عنوان بزرگ', '<h2>'], ['عنوان میانی', '<h3>'], ['عنوان کوچک', '<h4>'], ['نقل‌قول', '<blockquote>']];
const STATE_CMDS = ['bold', 'italic', 'underline', 'strikeThrough', 'subscript', 'superscript', 'insertUnorderedList', 'insertOrderedList', 'justifyRight', 'justifyCenter', 'justifyLeft', 'justifyFull'];

function tableHtml(rows, cols, header) {
  const cell = (tag) => `<${tag} style="border:1px solid #666;padding:4px 8px;${tag === 'th' ? 'background-color:#e9e5da;font-weight:bold;' : ''}">&nbsp;</${tag}>`;
  let html = '<table style="border-collapse:collapse;width:100%"><tbody>';
  for (let r = 0; r < rows; r += 1) {
    html += '<tr>';
    for (let c = 0; c < cols; c += 1) html += cell(header && r === 0 ? 'th' : 'td');
    html += '</tr>';
  }
  return `${html}</tbody></table><p><br></p>`;
}

/**
 * @param {{ html?: string, placeholder?: string, minHeight?: number, snippets?: string[], onChange?: () => void }} [opts]
 */
export function createRichEditor(opts = {}) {
  const {
    html = '', placeholder = 'متن را اینجا بنویسید…', minHeight = 280, snippets = DEFAULT_SNIPPETS, onChange = () => {},
  } = opts;
  injectStyle();

  const area = el('div', {
    class: 'rte-area', contenteditable: 'true', dir: 'rtl', 'data-placeholder': placeholder, role: 'textbox', 'aria-multiline': 'true',
  });
  area.style.setProperty('--rte-min', `${minHeight}px`);
  area.innerHTML = sanitizeHtml(html);

  const counter = el('span');
  const hint = el('span', {}, '');
  const stateBtns = [];
  let saved = null;
  let initDone = false;

  const restore = () => {
    if (!saved) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(saved);
  };
  const normalizeEmpty = () => {
    if (!area.textContent.trim() && !area.querySelector('table,hr,ul,ol') && area.innerHTML !== '') area.innerHTML = '';
  };
  const updateCounter = () => {
    const text = area.innerText || area.textContent || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    counter.textContent = `${words.toLocaleString('fa-IR')} کلمه — ${text.replace(/\s/g, '').length.toLocaleString('fa-IR')} نویسه`;
  };
  const changed = () => { normalizeEmpty(); updateCounter(); onChange(); };
  const init = () => {
    if (initDone) return;
    initDone = true;
    try {
      document.execCommand('defaultParagraphSeparator', false, 'p');
      document.execCommand('styleWithCSS', false, true);
    } catch { /* مرورگرهایی که این دستورها را ندارند — بی‌اثر */ }
  };
  const prepare = () => { init(); area.focus(); restore(); };
  const exec = (cmd, val = null) => {
    prepare();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd, false, val);
    changed();
    refreshState();
  };
  const insertHtml = (h) => { prepare(); document.execCommand('insertHTML', false, h); changed(); };
  const insertPlain = (t) => { prepare(); document.execCommand('insertText', false, t); changed(); };

  /** بازنویسی متنِ همه‌ی نودهای متنی (با حفظ undo) — برای رسمی‌نویسی و جایگزینی */
  function rewriteText(fn) {
    const tmp = document.createElement('div');
    tmp.innerHTML = area.innerHTML;
    const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let count = 0;
    nodes.forEach((n) => {
      const nv = fn(n.nodeValue);
      if (nv !== n.nodeValue) { n.nodeValue = nv; count += 1; }
    });
    if (!count) return 0;
    area.focus();
    document.execCommand('selectAll');
    document.execCommand('insertHTML', false, tmp.innerHTML);
    changed();
    return count;
  }

  /* ── ساخت نوار ابزار ── */
  const mkBtn = (label, title, fn, { cmd, style } = {}) => {
    const b = el('button', { type: 'button', class: 'rte-btn', title }, label);
    if (style) b.style.cssText = style;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', fn);
    if (cmd && STATE_CMDS.includes(cmd)) stateBtns.push({ b, cmd });
    return b;
  };
  const cmdBtn = (label, title, cmd, val, style) => mkBtn(label, title, () => exec(cmd, val), { cmd, style });
  const mkSelect = (title, options, onPick) => {
    const s = el('select', { class: 'rte-sel', title }, options.map(([t, v]) => el('option', { value: v }, t)));
    s.addEventListener('change', () => {
      const v = s.value;
      s.selectedIndex = 0;
      if (v === '') return;
      prepare();
      onPick(v);
      changed();
    });
    return s;
  };
  const mkColor = (label, title, cmd, initial) => {
    const input = el('input', { type: 'color', value: initial, class: 'rte-color', title });
    input.addEventListener('input', () => {
      prepare();
      document.execCommand('styleWithCSS', false, true);
      document.execCommand(cmd, false, input.value);
      changed();
    });
    return el('label', { class: 'rte-btn', title }, [label, input]);
  };
  const group = (...items) => el('div', { class: 'rte-group' }, items);

  function currentBlock() {
    const sel = window.getSelection();
    let n = sel && sel.anchorNode;
    while (n && n !== area) {
      if (n.nodeType === 1 && /^(P|DIV|H[1-4]|LI|BLOCKQUOTE|TD|TH)$/.test(n.tagName)) return n;
      n = n.parentNode;
    }
    return null;
  }
  function setBlockDir(dir) {
    prepare();
    let block = currentBlock();
    if (!block) { document.execCommand('formatBlock', false, '<p>'); block = currentBlock(); }
    if (!block) return;
    block.setAttribute('dir', dir);
    block.style.textAlign = dir === 'rtl' ? 'right' : 'left';
    changed();
  }
  function setFontSize(px) {
    document.execCommand('styleWithCSS', false, false);
    document.execCommand('fontSize', false, '7');
    area.querySelectorAll('font[size="7"]').forEach((f) => {
      const span = document.createElement('span');
      span.style.fontSize = `${px}px`;
      while (f.firstChild) span.append(f.firstChild);
      f.replaceWith(span);
    });
    document.execCommand('styleWithCSS', false, true);
  }

  function openTableDialog() {
    const { body, close } = openModal({ title: '➕ درج جدول', width: '320px' });
    const rowsIn = el('input', { type: 'number', min: '1', max: '30', value: '3' });
    const colsIn = el('input', { type: 'number', min: '1', max: '10', value: '3' });
    const headIn = el('input', { type: 'checkbox', checked: '' });
    const ok = el('button', {
      class: 'btn btn-primary',
      style: 'width:100%;justify-content:center;margin-top:12px',
      onclick: () => {
        const r = Math.min(30, Math.max(1, parseInt(rowsIn.value, 10) || 1));
        const c = Math.min(10, Math.max(1, parseInt(colsIn.value, 10) || 1));
        close();
        insertHtml(tableHtml(r, c, headIn.checked));
      },
    }, 'درج');
    body.append(
      el('div', {}, [el('label', {}, 'تعداد سطر'), rowsIn]),
      el('div', {}, [el('label', {}, 'تعداد ستون'), colsIn]),
      el('label', { style: 'display:flex;gap:6px;align-items:center;margin-top:8px' }, [headIn, 'سطر اول به‌صورت سرستون']),
      ok,
    );
  }
  function insertLink() {
    const url = (window.prompt('آدرس لینک (با https:// شروع شود):') || '').trim();
    if (!url) return;
    if (!/^(https?:|mailto:|tel:)/i.test(url)) { showToast('⚠️ آدرس باید با https:// ، mailto: یا tel: شروع شود'); return; }
    exec('createLink', url);
  }

  /* ── ابزار جدول (فقط وقتی نشانگر داخل جدول است دیده می‌شود) ── */
  function curCell() {
    const sel = window.getSelection();
    let n = sel && sel.anchorNode;
    while (n && n !== area) {
      if (n.nodeType === 1 && (n.tagName === 'TD' || n.tagName === 'TH')) return n;
      n = n.parentNode;
    }
    return null;
  }
  function tableOp(op) {
    restore();
    const cell = curCell();
    if (!cell) return;
    const row = cell.parentElement;
    const table = cell.closest('table');
    const idx = cell.cellIndex;
    const blankLike = (ref, tag) => {
      const c = document.createElement(tag || (ref && ref.tagName === 'TH' ? 'th' : 'td'));
      if (ref && ref.getAttribute('style')) c.setAttribute('style', ref.getAttribute('style'));
      c.innerHTML = '<br>';
      return c;
    };
    if (op === 'addRow') {
      const nr = row.cloneNode(false);
      Array.from(row.cells).forEach((c) => nr.append(blankLike(c, 'td')));
      row.after(nr);
    } else if (op === 'addCol') {
      Array.from(table.rows).forEach((r) => {
        const ref = r.cells[idx];
        const nc = blankLike(ref);
        if (ref) ref.after(nc); else r.append(nc);
      });
    } else if (op === 'delRow') {
      if (table.rows.length <= 1) table.remove(); else row.remove();
    } else if (op === 'delCol') {
      if (row.cells.length <= 1) table.remove();
      else Array.from(table.rows).forEach((r) => { if (r.cells[idx]) r.cells[idx].remove(); });
    } else if (op === 'delTable') {
      table.remove();
    }
    changed();
  }
  const tblBar = el('div', { class: 'rte-sub' }, [
    el('span', { style: 'color:var(--stone-600)' }, 'ابزار جدول:'),
    ...[['addRow', '＋ سطر'], ['addCol', '＋ ستون'], ['delRow', '− سطر'], ['delCol', '− ستون'], ['delTable', '🗑 حذف جدول']]
      .map(([op, label]) => mkBtn(label, label, () => tableOp(op), { style: 'border-color:var(--stone-300)' })),
  ]);

  /* ── جستجو و جایگزینی ── */
  const findIn = el('input', { placeholder: 'عبارت مورد جستجو' });
  const replIn = el('input', { placeholder: 'جایگزین' });
  const findPanel = el('div', { class: 'rte-sub' }, [
    findIn, replIn,
    mkBtn('جایگزینی همه', 'جایگزینی همه‌ی موارد', () => {
      const f = findIn.value;
      if (!f) { showToast('⚠️ عبارت جستجو را وارد کنید'); return; }
      let total = 0;
      const n = rewriteText((s) => {
        const parts = s.split(f);
        if (parts.length > 1) total += parts.length - 1;
        return parts.join(replIn.value);
      });
      showToast(n ? `✅ ${total.toLocaleString('fa-IR')} مورد جایگزین شد` : 'موردی پیدا نشد');
    }, { style: 'border-color:var(--stone-300)' }),
  ]);

  /* ── ورودی صوتی ── */
  let rec = null;
  let listening = false;
  let manualStop = false;
  const voiceBtn = mkBtn('🎙️', 'تبدیل صوت به متن (فقط Chrome)', () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { showToast('⚠️ مرورگر شما از تبدیل صوت به متن پشتیبانی نمی‌کند — از Chrome استفاده کنید'); return; }
    if (listening) { manualStop = true; rec.stop(); return; }
    rec = new SR();
    rec.lang = 'fa-IR';
    rec.continuous = true;
    rec.interimResults = false;
    manualStop = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        if (e.results[i].isFinal) insertPlain(`${e.results[i][0].transcript} `);
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { showToast('⚠️ اجازه‌ی دسترسی به میکروفون داده نشده'); manualStop = true; }
      else if (e.error === 'audio-capture') { showToast('⚠️ میکروفونی پیدا نشد'); manualStop = true; }
    };
    rec.onend = () => {
      if (manualStop) { listening = false; voiceBtn.classList.remove('on'); hint.textContent = ''; return; }
      setTimeout(() => { if (manualStop) return; try { rec.start(); } catch { listening = false; voiceBtn.classList.remove('on'); } }, 150);
    };
    try {
      rec.start();
      listening = true;
      voiceBtn.classList.add('on');
      hint.textContent = '🔴 در حال ضبط… (برای توقف دوباره دکمه‌ی 🎙️ را بزنید)';
    } catch { showToast('⚠️ خطا در شروع ضبط صدا'); }
  });

  const fullBtn = mkBtn('⛶', 'تمام‌صفحه', () => {
    root.classList.toggle('rte--full');
    fullBtn.classList.toggle('on', root.classList.contains('rte--full'));
  });
  const toggleFind = mkBtn('🔍', 'جستجو و جایگزینی', () => {
    findPanel.style.display = findPanel.style.display === 'flex' ? 'none' : 'flex';
  });

  const snippetSel = mkSelect('عبارت‌های آماده', [['عبارت آماده', ''], ...snippets.map((t) => [t.length > 30 ? `${t.slice(0, 30)}…` : t, t])], (v) => insertPlain(`${v} `));

  const toolbar = el('div', { class: 'rte-toolbar' }, [
    group(
      mkBtn('↶', 'بازگردانی (Ctrl+Z)', () => exec('undo')),
      mkBtn('↷', 'ازنو (Ctrl+Y)', () => exec('redo')),
    ),
    group(
      mkSelect('سبک پاراگراف', BLOCK_FORMATS, (v) => document.execCommand('formatBlock', false, v)),
      mkSelect('فونت', FONT_FAMILIES, (v) => document.execCommand('fontName', false, v)),
      mkSelect('اندازه‌ی قلم (px)', FONT_SIZES, (v) => setFontSize(v)),
    ),
    group(
      cmdBtn('B', 'پررنگ (Ctrl+B)', 'bold', null, 'font-weight:700'),
      cmdBtn('I', 'کج (Ctrl+I)', 'italic', null, 'font-style:italic'),
      cmdBtn('U', 'زیرخط (Ctrl+U)', 'underline', null, 'text-decoration:underline'),
      cmdBtn('S', 'خط‌خورده', 'strikeThrough', null, 'text-decoration:line-through'),
      cmdBtn('x₂', 'زیرنویس', 'subscript'),
      cmdBtn('x²', 'بالانویس', 'superscript'),
    ),
    group(
      mkColor('A', 'رنگ متن', 'foreColor', '#c0392b'),
      mkColor('🖍', 'رنگ پس‌زمینه‌ی متن (هایلایت)', 'hiliteColor', '#fff176'),
      mkBtn('✖︎A', 'حذف قالب‌بندی', () => exec('removeFormat')),
    ),
    group(
      cmdBtn('⇥', 'راست‌چین', 'justifyRight'),
      cmdBtn('≡', 'وسط‌چین', 'justifyCenter'),
      cmdBtn('⇤', 'چپ‌چین', 'justifyLeft'),
      cmdBtn('☰', 'تراز دوطرفه', 'justifyFull'),
      mkBtn('RTL', 'جهت پاراگراف: راست‌به‌چپ', () => setBlockDir('rtl'), { style: 'font-size:10px' }),
      mkBtn('LTR', 'جهت پاراگراف: چپ‌به‌راست', () => setBlockDir('ltr'), { style: 'font-size:10px' }),
    ),
    group(
      cmdBtn('• ≣', 'فهرست نقطه‌ای', 'insertUnorderedList'),
      cmdBtn('۱. ≣', 'فهرست شماره‌دار', 'insertOrderedList'),
      mkBtn('⇠', 'افزایش تورفتگی', () => exec('indent')),
      mkBtn('⇢', 'کاهش تورفتگی', () => exec('outdent')),
    ),
    group(
      mkBtn('▦', 'درج جدول', () => { prepare(); openTableDialog(); }),
      mkBtn('―', 'خط جداکننده', () => exec('insertHorizontalRule')),
      mkBtn('🔗', 'درج لینک', () => { prepare(); insertLink(); }),
      mkBtn('⛓︎‍💥', 'حذف لینک', () => exec('unlink')),
    ),
    group(
      mkBtn('📅', 'درج تاریخ امروز (شمسی)', () => { const t = todayJalali(); insertPlain(formatJalali(t.jy, t.jm, t.jd)); }),
      mkBtn('‌⎵', 'درج نیم‌فاصله', () => insertPlain('\u200c')),
      snippetSel,
    ),
    group(
      toggleFind,
      mkBtn('✍️', 'رسمی‌نویسی خودکار (تبدیل محاوره به رسمی)', () => {
        const n = rewriteText((s) => formalizeKeepingEdges(s));
        showToast(n ? '✅ متن رسمی‌نویسی شد (با Ctrl+Z قابل بازگشت است)' : 'مورد محاوره‌ای برای تغییر پیدا نشد');
      }),
      voiceBtn,
      fullBtn,
    ),
  ]);

  const status = el('div', { class: 'rte-status' }, [hint, counter]);
  const root = el('div', { class: 'rte' }, [toolbar, tblBar, findPanel, area, status]);

  function refreshState() {
    stateBtns.forEach(({ b, cmd }) => {
      let on = false;
      try { on = document.queryCommandState(cmd); } catch { /* بعضی دستورها در برخی مرورگرها پشتیبانی نمی‌شوند */ }
      b.classList.toggle('on', on);
    });
    tblBar.style.display = curCell() ? 'flex' : 'none';
  }

  let wasConnected = false;
  const onSel = () => {
    if (root.isConnected) wasConnected = true;
    else { if (wasConnected) document.removeEventListener('selectionchange', onSel); return; }
    const sel = window.getSelection();
    if (sel && sel.rangeCount && area.contains(sel.anchorNode)) {
      saved = sel.getRangeAt(0).cloneRange();
      refreshState();
    }
  };
  document.addEventListener('selectionchange', onSel);

  area.addEventListener('focus', init);
  area.addEventListener('input', changed);
  area.addEventListener('paste', (e) => {
    e.preventDefault();
    const cd = e.clipboardData;
    const h = cd && cd.getData('text/html');
    const t = cd && cd.getData('text/plain');
    if (h) document.execCommand('insertHTML', false, sanitizeHtml(h));
    else if (t) document.execCommand('insertText', false, t);
    changed();
  });
  updateCounter();

  return {
    root,
    area,
    getHTML: () => sanitizeHtml(area.innerHTML),
    getText: () => htmlToText(area.innerHTML),
    setHTML: (h) => { area.innerHTML = sanitizeHtml(h); changed(); },
    insertHTML: insertHtml,
    isEmpty: () => !area.textContent.trim() && !area.querySelector('table,hr'),
    focus: () => area.focus(),
    setHint: (t) => { if (!listening) hint.textContent = t; },
  };
}
