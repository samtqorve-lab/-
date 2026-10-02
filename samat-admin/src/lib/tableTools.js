import { el, showToast } from './dom.js';
import { exportXLSX } from './exporters.js';

/**
 * بهبود خودکار جدول‌های `.data-table`: فیلتر متنی (ذخیره‌شونده)، مرتب‌سازی با کلیک روی عنوان ستون،
 * و خروجی اکسل از ردیف‌های نمایش‌داده‌شده. shell.js با MutationObserver هر جدول تازه را به این
 * تابع می‌دهد، پس هیچ ماژولی نیاز به تغییر ندارد.
 */

function normDigits(s) {
  return String(s)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
}

const ZWNJ = String.fromCharCode(0x200c);

function normText(s) {
  return normDigits(s || '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .split(ZWNJ).join(' ')
    .toLowerCase();
}

function toNumber(s) {
  const t = normDigits(s).replace(/[ ,٬،]/g, '');
  if (!/^-?[0-9]+([.][0-9]+)?$/.test(t)) return null;
  return parseFloat(t);
}

function compareCells(a, b) {
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) return na - nb;
  return String(a).localeCompare(String(b), 'fa');
}

const textOf = (cell) => (cell ? (cell.textContent || '').trim() : '');

export function enhanceTable(table, storageKey) {
  if (table.dataset.enhanced) return;
  table.dataset.enhanced = '1';
  const tbody = table.tBodies[0];
  if (!tbody || !table.parentNode) return;

  const lsKey = `samat.tf.${storageKey}`;
  const filterInput = el('input', { type: 'search', placeholder: '🔎 فیلتر ردیف‌ها...', 'aria-label': 'فیلتر جدول' });
  const countLabel = el('span', { class: 'tt-count' });
  const exportBtn = el('button', {
    class: 'btn btn-ghost', type: 'button', title: 'خروجی اکسل از ردیف‌های نمایش‌داده‌شده', onclick: () => onExport(),
  }, '📊 اکسل');
  table.parentNode.insertBefore(el('div', { class: 'table-tools' }, [filterInput, countLabel, exportBtn]), table);

  function applyFilter() {
    const q = normText(filterInput.value.trim());
    let shown = 0;
    let total = 0;
    Array.from(tbody.rows).forEach((tr) => {
      total += 1;
      const ok = !q || normText(tr.textContent).includes(q);
      if (!ok) {
        tr.style.display = 'none';
        tr.dataset.ttHidden = '1';
      } else {
        if (tr.dataset.ttHidden) { tr.style.display = ''; delete tr.dataset.ttHidden; }
        shown += 1;
      }
    });
    countLabel.textContent = total ? (q ? `${shown} از ${total} ردیف` : `${total} ردیف`) : '';
  }

  try { filterInput.value = localStorage.getItem(lsKey) || ''; } catch { /* ignore */ }
  filterInput.addEventListener('input', () => {
    try { localStorage.setItem(lsKey, filterInput.value); } catch { /* ignore */ }
    applyFilter();
  });
  // اگر ماژول بعداً ردیف‌ها را دوباره می‌سازد (مثلاً بعد از بارگذاری داده)، فیلتر دوباره اعمال می‌شود
  new MutationObserver(applyFilter).observe(tbody, { childList: true });
  applyFilter();

  const ths = Array.from(table.querySelectorAll('thead th'));
  ths.forEach((th) => {
    // ستونی که ماژول خودش برایش مرتب‌سازی گذاشته (cursor:pointer اینلاین) دست نمی‌خورد
    if (th.style.cursor === 'pointer') return;
    th.classList.add('sortable');
    th.addEventListener('click', () => {
      const idx = th.cellIndex;
      const dir = th.dataset.sort === 'asc' ? 'desc' : 'asc';
      ths.forEach((o) => { delete o.dataset.sort; });
      th.dataset.sort = dir;
      const rows = Array.from(tbody.rows);
      rows.sort((ra, rb) => {
        const c = compareCells(textOf(ra.cells[idx]), textOf(rb.cells[idx]));
        return dir === 'asc' ? c : -c;
      });
      rows.forEach((r) => tbody.append(r));
    });
  });

  async function onExport() {
    const headers = ths.map((th) => textOf(th).replace(/[↕▲▼]/g, '').trim());
    const rows = Array.from(tbody.rows)
      .filter((tr) => tr.style.display !== 'none')
      .map((tr) => {
        const o = {};
        Array.from(tr.cells).forEach((td, i) => {
          const base = headers[i] || `ستون ${i + 1}`;
          let key = base;
          let n = 2;
          while (key in o) { key = `${base} (${n})`; n += 1; }
          o[key] = textOf(td);
        });
        return o;
      });
    if (!rows.length) { showToast('ردیفی برای خروجی وجود ندارد'); return; }
    try {
      await exportXLSX(rows, `samat-${storageKey.split(':').join('-')}`, 'گزارش');
    } catch (err) {
      showToast(`⚠️ خروجی اکسل ناموفق بود: ${err.message}`);
    }
  }
}
