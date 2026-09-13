import { el, showToast } from '../../lib/dom.js';
import { calcBlastDesign, ROCK_KB, EXPLOSIVE_TYPES } from '../../lib/blastCalc.js';
import { CONVERT_CATEGORIES, convertUnit } from '../../lib/unitConvert.js';
import { EQUIPMENT_CATEGORIES, EQUIPMENT_LIST } from '../../lib/equipmentSpecs.js';

function fmtNum(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('fa-IR', { maximumFractionDigits: digits });
}

function numberField(label, value, step = 'any') {
  const input = el('input', { type: 'number', value: String(value), step, style: 'width:100%' });
  return { wrap: el('div', {}, [el('label', {}, label), input]), input };
}

function selectField(label, optionsMap, selected) {
  const select = el('select', { style: 'width:100%' }, Object.entries(optionsMap).map(([key, meta]) =>
    el('option', { value: key, selected: key === selected ? 'selected' : undefined }, meta.label || meta)));
  return { wrap: el('div', {}, [el('label', {}, label), select]), select };
}

let activeToolSub = 'blast';

export async function renderTools(container) {
  container.innerHTML = '';
  const tabs = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px' });
  const SUB = { blast: '💥 الگوی آتش‌باری و مواد ناریه', converter: '🔁 تبدیل واحد', equipment: '🚜 مشخصات ماشین‌آلات' };
  Object.entries(SUB).forEach(([key, label]) => {
    tabs.append(el('button', {
      class: 'btn-sm',
      style: key === activeToolSub ? 'background:var(--ochre-600);color:#fff' : 'background:var(--stone-100);color:var(--ink-700)',
      onclick: () => { activeToolSub = key; renderTools(container); },
    }, label));
  });
  container.append(tabs);

  const body = el('div');
  container.append(body);
  if (activeToolSub === 'blast') renderBlastTab(body);
  else if (activeToolSub === 'converter') renderConverterTab(body);
  else renderEquipmentTab(body);
}

// ————————————————————————————— الگوی آتش‌باری —————————————————————————————
function renderBlastTab(body) {
  const intro = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, [
    'برآورد مهندسی اولیه‌ی الگوی حفاری/آتش‌باری پله‌ای (روش Ash/Konya) به‌همراه برآورد مصرف مواد ناریه، ',
    'چاشنی/نانل و هزینه. ',
    el('b', {}, '⚠️ این یک برآورد اولیه است، نه طرح آتش‌باری نهایی — '),
    'اجرای عملیاتی باید توسط مسئول فنی/مهندس آتش‌باری مسئول معدن، متناسب با شرایط واقعی توده‌سنگ و بر اساس آیین‌نامه‌ی ایمنی معادن تأیید شود.',
  ]);

  const diam = numberField('قطر چال (mm)', 89);
  const bench = numberField('ارتفاع پله (m)', 10);
  const rock = selectField('سختی توده‌سنگ', ROCK_KB, 'medium');
  const kbOv = numberField('ضریب برم دستی Kb — خالی/صفر = خودکار از سختی سنگ', 0);
  const ksOv = numberField('ضریب فاصله‌داری Ks (پیش‌فرض ۱.۱۵)', 1.15);
  const subR = numberField('نسبت زیرحفاری (Subdrill/Burden)', 0.3);
  const stemR = numberField('نسبت استمینگ (Stemming/Burden)', 0.8);
  const explosive = selectField('نوع ماده‌ی ناریه', EXPLOSIVE_TYPES, 'anfo');
  const densOv = numberField('چگالی دستی ماده‌ی ناریه (kg/m³) — خالی/صفر = پیش‌فرض نوع انتخابی', 0);
  const face = numberField('طول کل جبهه‌کار (m)', 60);
  const rows = numberField('تعداد ردیف چال', 1, '1');
  const rockDens = numberField('چگالی سنگ درجا (تن/متر مکعب)', 2.6);
  const primersPerHole = numberField('تعداد پرایمر/بوستر به ازای هر چال', 1);
  const detonatorsPerHole = numberField('تعداد چاشنی (نانل) به ازای هر چال', 1);

  const priceExp = numberField('قیمت هر کیلوگرم ماده‌ی ناریه (تومان)', 0);
  const priceDet = numberField('قیمت هر چاشنی/نانل (تومان)', 0);
  const pricePrimer = numberField('قیمت هر پرایمر/بوستر (تومان)', 0);
  const priceDrill = numberField('هزینه‌ی حفاری هر متر چال (تومان)', 0);

  const grid1 = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [
    diam.wrap, bench.wrap, rock.wrap, kbOv.wrap, ksOv.wrap, subR.wrap, stemR.wrap,
    explosive.wrap, densOv.wrap, face.wrap, rows.wrap, rockDens.wrap, primersPerHole.wrap, detonatorsPerHole.wrap,
  ]);
  const grid2 = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;margin-top:10px' }, [
    priceExp.wrap, priceDet.wrap, pricePrimer.wrap, priceDrill.wrap,
  ]);

  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '💥 محاسبه‌ی الگوی آتش‌باری');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });

  runBtn.addEventListener('click', () => {
    try {
      const r = calcBlastDesign({
        holeDiameterMm: parseFloat(diam.input.value),
        benchHeightM: parseFloat(bench.input.value),
        rockHardness: rock.select.value,
        kbOverride: parseFloat(kbOv.input.value) || 0,
        ksOverride: parseFloat(ksOv.input.value) || 0,
        subdrillRatio: parseFloat(subR.input.value),
        stemmingRatio: parseFloat(stemR.input.value),
        explosiveType: explosive.select.value,
        explosiveDensityOverride: parseFloat(densOv.input.value) || 0,
        faceLengthM: parseFloat(face.input.value),
        rows: parseInt(rows.input.value, 10),
        rockDensityTonM3: parseFloat(rockDens.input.value),
        primersPerHole: parseFloat(primersPerHole.input.value),
        detonatorsPerHole: parseFloat(detonatorsPerHole.input.value),
        pricePerKgExplosive: parseFloat(priceExp.input.value),
        pricePerDetonator: parseFloat(priceDet.input.value),
        pricePerPrimer: parseFloat(pricePrimer.input.value),
        pricePerMeterDrilling: parseFloat(priceDrill.input.value),
      });

      resultBox.innerHTML = '';
      resultBox.style.display = 'block';
      resultBox.append(
        el('h4', { style: 'margin-top:0' }, '📐 هندسه‌ی الگو'),
        el('div', { class: 'kpi-grid' }, [
          el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, `${fmtNum(r.burden)} m`), el('div', { class: 'kpi-l' }, 'برم (Burden)')]),
          el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, `${fmtNum(r.spacing)} m`), el('div', { class: 'kpi-l' }, 'فاصله‌داری (Spacing)')]),
          el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, `${fmtNum(r.subdrill)} m`), el('div', { class: 'kpi-l' }, 'زیرحفاری (Subdrill)')]),
          el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, `${fmtNum(r.stemming)} m`), el('div', { class: 'kpi-l' }, 'استمینگ (Stemming)')]),
          el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, `${fmtNum(r.holeLength)} m`), el('div', { class: 'kpi-l' }, 'طول کل چال')]),
          el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, `${r.holesPerRow} × ${r.rows}`), el('div', { class: 'kpi-l' }, 'چال در هر ردیف × تعداد ردیف')]),
        ]),
        el('h4', {}, '🧨 مصرف مواد ناریه و وسایل انفجاری'),
        el('div', { class: 'kpi-grid' }, [
          el('div', { class: 'kpi-card', style: '--kpi-accent:var(--rust-600)' }, [el('div', { class: 'kpi-n' }, `${fmtNum(r.chargePerHoleKg)} kg`), el('div', { class: 'kpi-l' }, 'خرج هر چال')]),
          el('div', { class: 'kpi-card', style: '--kpi-accent:var(--rust-600)' }, [el('div', { class: 'kpi-n' }, `${fmtNum(r.totalExplosiveKg, 0)} kg`), el('div', { class: 'kpi-l' }, 'مجموع ماده‌ی ناریه')]),
          el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, String(r.primerCount)), el('div', { class: 'kpi-l' }, 'تعداد پرایمر/بوستر')]),
          el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, String(r.detonatorCount)), el('div', { class: 'kpi-l' }, 'تعداد چاشنی/نانل')]),
          el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, `${fmtNum(r.powderFactorKgM3, 3)} kg/m³`), el('div', { class: 'kpi-l' }, 'ضریب خرج (بر حجم)')]),
          el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, `${fmtNum(r.powderFactorKgTon, 3)} kg/ton`), el('div', { class: 'kpi-l' }, 'ضریب خرج (بر تناژ)')]),
        ]),
        el('h4', {}, '💰 برآورد فنی-اقتصادی'),
        el('div', { class: 'kpi-grid' }, [
          el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, `${fmtNum(r.volumeM3, 0)} m³`), el('div', { class: 'kpi-l' }, 'حجم سنگ خردشده (برآوردی)')]),
          el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, `${fmtNum(r.totalRockTon, 0)} تن`), el('div', { class: 'kpi-l' }, 'تناژ سنگ خردشده')]),
          el('div', { class: 'kpi-card', style: '--kpi-accent:var(--patina-600)' }, [el('div', { class: 'kpi-n' }, `${fmtNum(r.totalCost, 0)}`), el('div', { class: 'kpi-l' }, 'هزینه‌ی کل (تومان)')]),
          el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, fmtNum(r.costPerM3, 0)), el('div', { class: 'kpi-l' }, 'هزینه بر متر مکعب (تومان)')]),
          el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, fmtNum(r.costPerTon, 0)), el('div', { class: 'kpi-l' }, 'هزینه بر تن (تومان)')]),
          el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, `${fmtNum(r.totalDrillLengthM, 0)} m`), el('div', { class: 'kpi-l' }, 'مجموع طول حفاری')]),
        ]),
        el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:10px' },
          'ریز هزینه: حفاری ' + fmtNum(r.drillingCost, 0) + ' + ماده‌ی ناریه ' + fmtNum(r.explosiveCost, 0) + ' + پرایمر ' + fmtNum(r.primerCost, 0) + ' + چاشنی ' + fmtNum(r.detonatorCost, 0) + ' تومان'),
      );
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    }
  });

  body.append(el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '💥 طراحی الگوی آتش‌باری و محاسبه‌ی مواد ناریه'),
    intro, grid1, grid2, runBtn, resultBox,
  ]));
}

// ————————————————————————————— تبدیل واحد —————————————————————————————
function renderConverterTab(body) {
  const catKeys = Object.keys(CONVERT_CATEGORIES);
  let cat = 'power';

  const catSelect = el('select', { style: 'width:100%' }, catKeys.map((k) => el('option', { value: k }, CONVERT_CATEGORIES[k].label)));
  const valueInput = el('input', { type: 'number', value: '1', style: 'width:100%' });
  const fromSelect = el('select', { style: 'width:100%' });
  const toSelect = el('select', { style: 'width:100%' });
  const resultBox = el('div', { style: 'font-size:var(--text-xl);font-weight:800;color:var(--ochre-700);margin-top:14px' });

  function fillUnitSelects() {
    const units = Object.entries(CONVERT_CATEGORIES[cat].units);
    fromSelect.innerHTML = ''; toSelect.innerHTML = '';
    units.forEach(([key, meta], i) => {
      fromSelect.append(el('option', { value: key, selected: i === 0 ? 'selected' : undefined }, meta.label));
      toSelect.append(el('option', { value: key, selected: i === 1 ? 'selected' : undefined }, meta.label));
    });
    if (units.length < 2) toSelect.selectedIndex = 0;
    compute();
  }

  function compute() {
    const v = parseFloat(valueInput.value);
    if (Number.isNaN(v)) { resultBox.textContent = '—'; return; }
    const out = convertUnit(v, cat, fromSelect.value, toSelect.value);
    resultBox.textContent = `${fmtNum(v)} ${fromSelect.value} = ${fmtNum(out, 6)} ${toSelect.value}`;
  }

  catSelect.addEventListener('change', () => { cat = catSelect.value; fillUnitSelects(); });
  [valueInput, fromSelect, toSelect].forEach((elm) => elm.addEventListener('input', compute));
  fillUnitSelects();

  const swapBtn = el('button', { class: 'btn-sm', style: 'background:var(--stone-100)', onclick: () => {
    const f = fromSelect.value; fromSelect.value = toSelect.value; toSelect.value = f; compute();
  } }, '⇄ جابجایی مبدأ/مقصد');

  body.append(el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '🔁 تبدیل واحد مهندسی'),
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, 'شامل توان (وات↔اسب‌بخار)، فشار، طول، جرم، حجم، چگالی، انرژی، سرعت، مساحت و دبی.'),
    el('div', { style: 'display:grid;grid-template-columns:1fr;gap:10px;max-width:420px' }, [
      el('div', {}, [el('label', {}, 'دسته‌ی واحد'), catSelect]),
      el('div', {}, [el('label', {}, 'مقدار'), valueInput]),
      el('div', { style: 'display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:end' }, [
        el('div', {}, [el('label', {}, 'از واحد'), fromSelect]),
        swapBtn,
        el('div', {}, [el('label', {}, 'به واحد'), toSelect]),
      ]),
    ]),
    resultBox,
  ]));
}

// ————————————————————————————— مشخصات ماشین‌آلات —————————————————————————————
function renderEquipmentTab(body) {
  let filterCat = '';
  let filterText = '';

  const catSelect = el('select', { style: 'width:100%' }, [
    el('option', { value: '' }, 'همه‌ی دسته‌ها'),
    ...EQUIPMENT_CATEGORIES.map((c) => el('option', { value: c }, c)),
  ]);
  const textInput = el('input', { type: 'text', placeholder: 'جستجوی مدل...', style: 'width:100%' });
  const tableBox = el('div', { style: 'margin-top:12px' });

  function draw() {
    const rows = EQUIPMENT_LIST.filter((e) =>
      (!filterCat || e.category === filterCat)
      && (!filterText.trim() || e.model.toLowerCase().includes(filterText.trim().toLowerCase())));
    tableBox.innerHTML = '';
    if (!rows.length) { tableBox.append(el('div', { class: 'empty-state' }, 'موردی یافت نشد')); return; }
    const table = el('table', { class: 'data-table', style: 'width:100%;font-size:var(--text-sm)' });
    table.append(el('thead', {}, el('tr', {}, ['دسته', 'مدل', 'توان (kW)', 'وزن (تن)', 'ظرفیت', 'توضیح'].map((h) => el('th', {}, h)))));
    const tbody = el('tbody');
    rows.forEach((e) => {
      tbody.append(el('tr', {}, [
        el('td', {}, e.category), el('td', { style: 'font-weight:700' }, e.model),
        el('td', {}, fmtNum(e.powerKw, 0)), el('td', {}, fmtNum(e.weightTon, 0)),
        el('td', {}, e.capacity), el('td', { style: 'color:var(--stone-600);font-size:var(--text-xs)' }, e.note),
      ]));
    });
    table.append(tbody);
    tableBox.append(table);
  }

  catSelect.addEventListener('change', () => { filterCat = catSelect.value; draw(); });
  textInput.addEventListener('input', () => { filterText = textInput.value; draw(); });
  draw();

  body.append(el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '🚜 مشخصات مرجع ماشین‌آلات معدنی'),
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
      '⚠️ مقادیر نمونه/معمول هر مدل‌اند، نه مشخصات دقیق و به‌روز — برای خرید یا محاسبه‌ی دقیق به بروشور فنی رسمی سازنده مراجعه شود.'),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, [catSelect, textInput]),
    tableBox,
  ]));
}
