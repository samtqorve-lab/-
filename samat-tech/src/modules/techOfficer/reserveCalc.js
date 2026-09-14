import { el, openModal } from '../../lib/dom.js';
import { getMineCornersLabeled, polygonAreaM2 } from '../../lib/geo.js';

/**
 * محاسبه‌گر تخمینی ذخیره (روش حجمی ساده: سطح × ضخامت × چگالی × عیار) — مساحت محدوده به‌صورت
 * خودکار از روی چهارگوشه‌ی مجوز محاسبه می‌شود (قابل بازنویسی دستی). این فقط یک تخمین اولیه‌ی
 * صحرایی است، نه گزارش رسمی ذخیره برای سازمان صنعت‌ومعدن — هیچ‌جا ذخیره نمی‌شود.
 * @param {object} mine
 * @param {string} nameField
 */
export function openReserveCalcModal(mine, nameField) {
  const mineName = mine[nameField];
  const { body } = openModal({ title: `🧮 محاسبه‌گر تخمینی ذخیره — ${mineName}`, width: '400px' });

  const corners = getMineCornersLabeled(mine || {});
  const autoAreaM2 = corners.length >= 3 ? polygonAreaM2(corners) : 0;

  const areaInput = el('input', {
    type: 'number', min: '0', step: '1',
    value: autoAreaM2 ? Math.round(autoAreaM2) : '',
    placeholder: 'متر مربع',
  });
  const areaHint = el('div', { style: 'font-size:11px;color:var(--stone-500);margin-top:2px' },
    autoAreaM2
      ? `✅ خودکار از روی چهارگوشه‌ی مجوز محاسبه شد (≈ ${(autoAreaM2 / 10000).toFixed(2)} هکتار) — در صورت نیاز ویرایش کنید`
      : '⚠️ مختصات چهارگوشه‌ی این محدوده در دسترس نبود — مساحت را دستی وارد کنید');

  const thicknessInput = el('input', { type: 'number', min: '0', step: '0.1', placeholder: 'متر' });
  const sgInput = el('input', { type: 'number', min: '0', step: '0.01', value: '2.7' });
  const gradeUnitSelect = el('select', {}, [
    el('option', { value: 'percent' }, 'درصد (٪)'),
    el('option', { value: 'gpt' }, 'گرم در تن (g/t)'),
  ]);
  const gradeInput = el('input', { type: 'number', min: '0', step: '0.01' });

  const resultBox = el('div', {
    style: 'margin-top:14px;padding:12px;background:var(--patina-50);border-radius:10px;font-size:13px;line-height:2;display:none',
  });

  const calcBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:12px' }, '🧮 محاسبه');
  calcBtn.addEventListener('click', () => {
    const areaM2 = parseFloat(areaInput.value);
    const thickness = parseFloat(thicknessInput.value);
    const sg = parseFloat(sgInput.value);
    const grade = parseFloat(gradeInput.value);
    resultBox.style.display = '';
    if ([areaM2, thickness, sg].some((v) => Number.isNaN(v) || v <= 0)) {
      resultBox.innerHTML = '<span style="color:var(--rust-700)">⚠️ مساحت، ضخامت و چگالی ویژه را درست وارد کنید</span>';
      return;
    }
    const volumeM3 = areaM2 * thickness;
    const tonnage = volumeM3 * sg; // چگالی ویژه بر حسب تن بر متر مکعب
    let contentLine = '';
    if (!Number.isNaN(grade) && grade > 0) {
      if (gradeUnitSelect.value === 'percent') {
        const contentTonnes = tonnage * (grade / 100);
        contentLine = `<div>محتوای فلز/ماده مفید تخمینی: <b>${contentTonnes.toLocaleString('fa-IR', { maximumFractionDigits: 1 })} تن</b></div>`;
      } else {
        const contentKg = tonnage * (grade / 1_000_000) * 1000; // g/t → کیلوگرم کل
        contentLine = `<div>محتوای فلز تخمینی: <b>${contentKg.toLocaleString('fa-IR', { maximumFractionDigits: 1 })} کیلوگرم</b></div>`;
      }
    }
    resultBox.innerHTML = `
      <div>حجم برآوردی: <b>${volumeM3.toLocaleString('fa-IR', { maximumFractionDigits: 0 })} متر مکعب</b></div>
      <div>تناژ برآوردی ذخیره: <b>${tonnage.toLocaleString('fa-IR', { maximumFractionDigits: 0 })} تن</b></div>
      ${contentLine}
      <div style="font-size:11px;color:var(--stone-500);margin-top:6px">⚠️ این یک تخمین سریعِ حجمی صحرایی است (روش سطح×ضخامت×چگالی)، نه گزارش رسمی طبقه‌بندی ذخیره؛ برای گزارش رسمی به سازمان صنعت‌ومعدن باید طبق دستورالعمل کد گزارش‌دهی ذخایر توسط اکتشاف مسئول تهیه شود.</div>
    `;
  });

  body.append(
    el('label', {}, 'مساحت محدوده'), areaInput, areaHint,
    el('label', { style: 'margin-top:10px' }, 'ضخامت/عمق متوسط لایه معدنی'), thicknessInput,
    el('label', { style: 'margin-top:10px' }, 'چگالی ویژه (تن بر متر مکعب)'), sgInput,
    el('div', { style: 'display:flex;gap:6px;margin-top:10px' }, [
      el('div', { style: 'flex:2' }, [el('label', {}, 'عیار متوسط (اختیاری)'), gradeInput]),
      el('div', { style: 'flex:1.4' }, [el('label', {}, 'واحد عیار'), gradeUnitSelect]),
    ]),
    calcBtn,
    resultBox,
  );
}
