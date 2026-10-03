import { el, showToast, fmtDate } from '../../lib/dom.js';
import { fetchNotices, createNotice, updateNotice, deleteNotice } from '../../lib/notices.js';
import { fetchMineSummary, exportMineWorkbook } from '../../lib/mineReport.js';

/**
 * کارت «پروفایل فعالیت» یک معدن/محدوده/واحد — داخل صفحه‌ی جزئیات همان رکورد:
 *  ۱) شاخص‌های سریع (فقط همین معدن)
 *  ۲) اطلاعیه‌های اختصاصی همین معدن (قاطی اطلاعیه‌ی بقیه‌ی معادن نمی‌شود) + انتشار اطلاعیه‌ی جدید فقط برای همین معدن
 *  ۳) گزارش‌گیری اکسلی فقط برای همین معدن، با بازه‌ی تاریخ اختیاری
 */
export function mountMineProfile(host, { department, mineName, isAdminRole }) {
  const card = el('div', { class: 'card' });
  host.append(card);
  card.append(el('h3', { style: 'font-size:var(--text-sm);margin-bottom:12px' }, `📊 پروفایل فعالیت — ${mineName}`));

  // ── ۱) شاخص‌ها ──
  const statsBox = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:16px' });
  card.append(statsBox);
  statsBox.append(el('div', { class: 'loading-state' }, 'در حال بارگذاری شاخص‌ها...'));

  function statTile(label, value, warnWhenPositive) {
    const bad = warnWhenPositive && typeof value === 'number' && value > 0;
    return el('div', {
      style: `border-radius:10px;padding:10px 12px;background:${bad ? 'var(--amber-50)' : 'var(--stone-50)'};border:1px solid var(--stone-200)`,
    }, [
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600)' }, label),
      el('div', { style: `font-size:var(--text-lg);font-weight:700;color:${bad ? 'var(--amber-700)' : 'var(--ink-700)'}` }, value === null ? '—' : String(value)),
    ]);
  }

  fetchMineSummary(department, mineName).then((s) => {
    statsBox.innerHTML = '';
    statsBox.append(
      statTile('🚨 حوادث ثبت‌شده', s.incidents),
      statTile('🛠️ اقدام اصلاحیِ باز', s.openCorrective, true),
      statTile('⚠️ چک‌لیست دارای ایراد', s.checklistIssues, true),
      statTile('⚙️ ماشین‌آلات منتظر تایید', s.pendingEquipment, true),
      statTile('🪪 احراز هویت منتظر بررسی', s.pendingIdentity, true),
      statTile('📢 اطلاعیه‌ی فعال', s.activeNotices),
    );
  }).catch(() => {
    statsBox.innerHTML = '';
    statsBox.append(el('div', { style: 'font-size:var(--text-xs);color:var(--rust-600)' }, 'خطا در بارگذاری شاخص‌ها'));
  });

  // ── ۲) اطلاعیه‌های همین معدن ──
  card.append(el('div', { style: 'font-weight:700;font-size:var(--text-sm);margin:4px 0 8px' }, '📢 اطلاعیه‌های اختصاصی این معدن'));
  const noticesBox = el('div');
  card.append(noticesBox);

  async function drawNotices() {
    noticesBox.innerHTML = '';
    noticesBox.append(el('div', { class: 'loading-state' }, 'در حال بارگذاری...'));
    let own;
    try {
      own = (await fetchNotices(department)).filter((n) => n.mine_name === mineName);
    } catch (err) {
      noticesBox.innerHTML = '';
      noticesBox.append(el('div', { style: 'font-size:var(--text-xs);color:var(--rust-600)' }, `خطا: ${err.message}`));
      return;
    }
    noticesBox.innerHTML = '';

    if (isAdminRole) {
      const titleInput = el('input', { type: 'text', placeholder: 'عنوان اطلاعیه برای این معدن...' });
      const bodyInput = el('textarea', { rows: '2', placeholder: 'متن اطلاعیه...' });
      const addBtn = el('button', { class: 'btn-sm', style: 'background:var(--patina-100);color:var(--patina-700);margin-top:6px' }, '➕ انتشار فقط برای این معدن');
      addBtn.addEventListener('click', async () => {
        const title = titleInput.value.trim();
        const body = bodyInput.value.trim();
        if (!title || !body) { showToast('⚠️ عنوان و متن اطلاعیه را وارد کنید'); return; }
        addBtn.disabled = true;
        try {
          await createNotice(department, title, body, mineName);
          showToast('✅ اطلاعیه برای این معدن منتشر شد');
          drawNotices();
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
          addBtn.disabled = false;
        }
      });
      noticesBox.append(el('div', { style: 'margin-bottom:12px' }, [titleInput, bodyInput, addBtn]));
    }

    if (!own.length) {
      noticesBox.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600)' }, 'هنوز اطلاعیه‌ی اختصاصی‌ای برای این معدن منتشر نشده. (اطلاعیه‌های عمومی در تب «اطلاعیه‌ها» مدیریت می‌شوند.)'));
      return;
    }
    own.forEach((n) => {
      const activeCb = el('input', { type: 'checkbox', style: 'width:auto' });
      activeCb.checked = n.active;
      if (isAdminRole) {
        activeCb.addEventListener('change', async () => {
          try { await updateNotice(n.id, { active: activeCb.checked }); showToast(activeCb.checked ? '✅ فعال شد' : '⏸ غیرفعال شد'); } catch (err) { showToast(`⚠️ ${err.message}`); activeCb.checked = !activeCb.checked; }
        });
      } else {
        activeCb.disabled = true;
      }
      const delBtn = isAdminRole
        ? el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)' }, '🗑')
        : null;
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (!confirm('این اطلاعیه برای همیشه حذف شود؟')) return;
          try { await deleteNotice(n.id); showToast('✅ حذف شد'); drawNotices(); } catch (err) { showToast(`⚠️ ${err.message}`); }
        });
      }
      noticesBox.append(el('div', { style: `border:1px solid var(--stone-200);border-radius:10px;padding:10px 12px;margin-bottom:8px;opacity:${n.active ? 1 : 0.55}` }, [
        el('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:8px' }, [
          el('div', {}, [
            el('div', { style: 'font-weight:700;font-size:var(--text-sm)' }, n.title),
            el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600)' }, fmtDate(n.created_at)),
          ]),
          el('div', { style: 'display:flex;align-items:center;gap:8px;flex-shrink:0' }, [
            el('label', { style: 'display:flex;align-items:center;gap:4px;font-size:11px' }, [activeCb, 'فعال']),
            delBtn,
          ]),
        ]),
        el('div', { style: 'font-size:var(--text-sm);margin-top:6px;white-space:pre-wrap' }, n.body),
      ]));
    });
  }
  drawNotices();

  // ── ۳) گزارش‌گیری فقط برای همین معدن ──
  card.append(el('div', { style: 'height:1px;background:var(--stone-200);margin:16px 0' }));
  card.append(el('div', { style: 'font-weight:700;font-size:var(--text-sm);margin-bottom:6px' }, '📥 گزارش کامل این معدن (اکسل)'));
  card.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' },
    'حوادث، اقدامات اصلاحی، چک‌لیست‌ها، ماشین‌آلات، پرسنل، آموزش‌ها، گزارش‌های دوره‌ای و… — فقط داده‌های همین معدن، هر بخش در یک برگه‌ی جدا. بازه‌ی تاریخ اختیاری است.'));

  const fromInput = el('input', { type: 'date', style: 'max-width:170px' });
  const toInput = el('input', { type: 'date', style: 'max-width:170px' });
  const exportBtn = el('button', { class: 'btn btn-primary btn-sm' }, '📥 دانلود گزارش اکسل');
  const statusLine = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' });

  exportBtn.addEventListener('click', async () => {
    if (fromInput.value && toInput.value && fromInput.value > toInput.value) {
      showToast('⚠️ تاریخ شروع نباید بعد از تاریخ پایان باشد');
      return;
    }
    exportBtn.disabled = true;
    const orig = exportBtn.textContent;
    exportBtn.textContent = '⏳ در حال تهیه...';
    statusLine.textContent = '';
    try {
      const { total, perTable } = await exportMineWorkbook({
        department,
        mineName,
        range: { from: fromInput.value || null, to: toInput.value || null },
        onProgress: (i, n, label) => { statusLine.textContent = `در حال خواندن «${label}» (${i} از ${n})...`; },
      });
      const failed = perTable.filter((p) => p.error).map((p) => p.label);
      statusLine.textContent = total
        ? `✅ گزارش آماده شد — ${total} ردیف${failed.length ? ` (بخش‌هایی که خوانده نشد: ${failed.join('، ')})` : ''}`
        : `برای این معدن در این بازه داده‌ای یافت نشد${failed.length ? ` (بخش‌هایی که خوانده نشد: ${failed.join('، ')})` : ''}`;
    } catch (err) {
      statusLine.textContent = `⚠️ خطا در تهیه‌ی گزارش: ${err.message}`;
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = orig;
    }
  });

  card.append(el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end' }, [
    el('div', {}, [el('label', {}, 'از تاریخ'), fromInput]),
    el('div', {}, [el('label', {}, 'تا تاریخ'), toInput]),
    exportBtn,
  ]));
  card.append(statusLine);
}
