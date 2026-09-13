import { el, showToast } from '../../lib/dom.js';
import { calcBlastDesign, ROCK_KB, EXPLOSIVE_TYPES } from '../../lib/blastCalc.js';
import { CONVERT_CATEGORIES, convertUnit } from '../../lib/unitConvert.js';
import { EQUIPMENT_CATEGORIES, EQUIPMENT_LIST } from '../../lib/equipmentSpecs.js';
import {
  calcEquipmentHourlyCost, calcMatchFactor, calcBreakEvenStrippingRatio, calcCutoffGrade,
  calcSlopeFactorOfSafety, calcRoyalty, calcNPV, calcIRR, calcStockpileVolume, calcCrusherCapacity,
} from '../../lib/miningEconomics.js';

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

function kpiCard(value, labelText, accent) {
  return el('div', { class: 'kpi-card', style: accent ? `--kpi-accent:${accent}` : '' }, [
    el('div', { class: 'kpi-n' }, value), el('div', { class: 'kpi-l' }, labelText),
  ]);
}

let activeToolSub = 'blast';

const SUB_LABELS = {
  blast: '💥 الگوی آتش‌باری و مواد ناریه',
  converter: '🔁 تبدیل واحد',
  equipment: '🚜 مشخصات ماشین‌آلات',
  fleet: '🚚 هزینه ماشین‌آلات و تطبیق ناوگان',
  stripping: '⛏️ باطله اقتصادی و عیار حد',
  slope: '🏔️ پایداری شیب',
  royalty: '🏛️ حقوق دولتی',
  npv: '📈 جریان نقدی و NPV',
  stockpile: '🗻 حجم کپه و سنگ‌شکن',
};

export async function renderTools(container) {
  container.innerHTML = '';
  const tabs = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px' });
  Object.entries(SUB_LABELS).forEach(([key, label]) => {
    tabs.append(el('button', {
      class: 'btn-sm',
      style: key === activeToolSub ? 'background:var(--ochre-600);color:#fff' : 'background:var(--stone-100);color:var(--ink-700)',
      onclick: () => { activeToolSub = key; renderTools(container); },
    }, label));
  });
  container.append(tabs);

  const body = el('div');
  container.append(body);
  const renderers = {
    blast: renderBlastTab, converter: renderConverterTab, equipment: renderEquipmentTab,
    fleet: renderFleetTab, stripping: renderStrippingTab, slope: renderSlopeTab,
    royalty: renderRoyaltyTab, npv: renderNpvTab, stockpile: renderStockpileTab,
  };
  renderers[activeToolSub](body);
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
          kpiCard(`${fmtNum(r.burden)} m`, 'برم (Burden)'),
          kpiCard(`${fmtNum(r.spacing)} m`, 'فاصله‌داری (Spacing)'),
          kpiCard(`${fmtNum(r.subdrill)} m`, 'زیرحفاری (Subdrill)'),
          kpiCard(`${fmtNum(r.stemming)} m`, 'استمینگ (Stemming)'),
          kpiCard(`${fmtNum(r.holeLength)} m`, 'طول کل چال'),
          kpiCard(`${r.holesPerRow} × ${r.rows}`, 'چال در هر ردیف × تعداد ردیف'),
        ]),
        el('h4', {}, '🧨 مصرف مواد ناریه و وسایل انفجاری'),
        el('div', { class: 'kpi-grid' }, [
          kpiCard(`${fmtNum(r.chargePerHoleKg)} kg`, 'خرج هر چال', 'var(--rust-600)'),
          kpiCard(`${fmtNum(r.totalExplosiveKg, 0)} kg`, 'مجموع ماده‌ی ناریه', 'var(--rust-600)'),
          kpiCard(String(r.primerCount), 'تعداد پرایمر/بوستر'),
          kpiCard(String(r.detonatorCount), 'تعداد چاشنی/نانل'),
          kpiCard(`${fmtNum(r.powderFactorKgM3, 3)} kg/m³`, 'ضریب خرج (بر حجم)'),
          kpiCard(`${fmtNum(r.powderFactorKgTon, 3)} kg/ton`, 'ضریب خرج (بر تناژ)'),
        ]),
        el('h4', {}, '💰 برآورد فنی-اقتصادی'),
        el('div', { class: 'kpi-grid' }, [
          kpiCard(`${fmtNum(r.volumeM3, 0)} m³`, 'حجم سنگ خردشده (برآوردی)'),
          kpiCard(`${fmtNum(r.totalRockTon, 0)} تن`, 'تناژ سنگ خردشده'),
          kpiCard(fmtNum(r.totalCost, 0), 'هزینه‌ی کل (تومان)', 'var(--patina-600)'),
          kpiCard(fmtNum(r.costPerM3, 0), 'هزینه بر متر مکعب (تومان)'),
          kpiCard(fmtNum(r.costPerTon, 0), 'هزینه بر تن (تومان)'),
          kpiCard(`${fmtNum(r.totalDrillLengthM, 0)} m`, 'مجموع طول حفاری'),
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

// ————————————————————————————— هزینه ماشین‌آلات + تطبیق ناوگان —————————————————————————————
function renderFleetTab(body) {
  // کارت اول: هزینه‌ی ساعتی ماشین‌آلات
  const price = numberField('قیمت خرید (تومان)', 0);
  const salvage = numberField('ارزش اسقاط (تومان)', 0);
  const life = numberField('عمر مفید (ساعت کارکرد)', 15000);
  const annualHours = numberField('ساعت کارکرد سالانه', 2000);
  const iitRate = numberField('نرخ سالانه‌ی بهره+بیمه+مالیات (٪ از میانگین سرمایه)', 8);
  const fuelL = numberField('مصرف سوخت (لیتر بر ساعت)', 15);
  const fuelPrice = numberField('قیمت هر لیتر سوخت (تومان)', 0);
  const lubeFactor = numberField('ضریب روغن/گریس (٪ از هزینه‌ی سوخت)', 30);
  const tireCost = numberField('هزینه‌ی خرید لاستیک/زنجیر (تومان)', 0);
  const tireLife = numberField('عمر لاستیک/زنجیر (ساعت)', 4000);
  const repairFactor = numberField('ضریب تعمیر و نگهداری (٪ از استهلاک ساعتی)', 60);
  const operatorWage = numberField('دستمزد اپراتور در ساعت (تومان) — اختیاری', 0);

  const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [
    price.wrap, salvage.wrap, life.wrap, annualHours.wrap, iitRate.wrap,
    fuelL.wrap, fuelPrice.wrap, lubeFactor.wrap, tireCost.wrap, tireLife.wrap, repairFactor.wrap, operatorWage.wrap,
  ]);
  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '🚚 محاسبه‌ی هزینه‌ی ساعتی');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });

  runBtn.addEventListener('click', () => {
    try {
      const r = calcEquipmentHourlyCost({
        purchasePrice: parseFloat(price.input.value), salvageValue: parseFloat(salvage.input.value),
        lifeHours: parseFloat(life.input.value), annualOperatingHours: parseFloat(annualHours.input.value),
        interestInsuranceTaxRatePercent: parseFloat(iitRate.input.value),
        fuelConsumptionLPerHour: parseFloat(fuelL.input.value), fuelPricePerLiter: parseFloat(fuelPrice.input.value),
        lubeFactorPercent: parseFloat(lubeFactor.input.value), tireCost: parseFloat(tireCost.input.value),
        tireLifeHours: parseFloat(tireLife.input.value), repairFactorPercent: parseFloat(repairFactor.input.value),
        operatorWagePerHour: parseFloat(operatorWage.input.value) || 0,
      });
      resultBox.innerHTML = ''; resultBox.style.display = 'block';
      resultBox.append(el('div', { class: 'kpi-grid' }, [
        kpiCard(fmtNum(r.ownershipCostPerHour, 0), 'هزینه‌ی مالکیت/ساعت'),
        kpiCard(fmtNum(r.operatingCostPerHour, 0), 'هزینه‌ی بهره‌برداری/ساعت'),
        kpiCard(fmtNum(r.operatorCostPerHour, 0), 'دستمزد اپراتور/ساعت'),
        kpiCard(fmtNum(r.totalCostPerHour, 0), 'هزینه‌ی کل هر ساعت (تومان)', 'var(--patina-600)'),
      ]), el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' },
        `استهلاک: ${fmtNum(r.depreciationPerHour, 0)} — بهره/بیمه/مالیات: ${fmtNum(r.interestInsuranceTaxPerHour, 0)} — سوخت: ${fmtNum(r.fuelCostPerHour, 0)} — روغن: ${fmtNum(r.lubeCostPerHour, 0)} — لاستیک: ${fmtNum(r.tireCostPerHour, 0)} — تعمیرات: ${fmtNum(r.repairCostPerHour, 0)} تومان`));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });

  const card1 = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '🚚 هزینه‌ی ساعتی ماشین‌آلات (مالکیت + بهره‌برداری)'),
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, 'روش رایج «نرخ ماشین» (Machine Rate) — برای برآورد هزینه‌ی واقعی هر ساعت کارکرد یک دستگاه.'),
    grid, runBtn, resultBox,
  ]);

  // کارت دوم: تطبیق ناوگان بیل-کامیون
  const bucketCap = numberField('ظرفیت باکت بیل (m³ یا تن)', 3);
  const truckCap = numberField('ظرفیت کامیون (همان واحد باکت)', 40);
  const shovelCycle = numberField('زمان سیکل بیل — هر پاس (ثانیه)', 25);
  const truckCycle = numberField('زمان کل سیکل کامیون (بارگیری+حمل+تخلیه+برگشت، ثانیه)', 900);
  const numShovels = numberField('تعداد بیل', 1, '1');
  const numTrucks = numberField('تعداد کامیون', 5, '1');
  const fillFactor = numberField('ضریب پرشدگی باکت (٪)', 90);

  const grid2 = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [
    bucketCap.wrap, truckCap.wrap, shovelCycle.wrap, truckCycle.wrap, numShovels.wrap, numTrucks.wrap, fillFactor.wrap,
  ]);
  const runBtn2 = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '🔁 محاسبه‌ی تطبیق ناوگان');
  const resultBox2 = el('div', { style: 'margin-top:14px;display:none' });

  runBtn2.addEventListener('click', () => {
    try {
      const r = calcMatchFactor({
        bucketCapacity: parseFloat(bucketCap.input.value), truckCapacity: parseFloat(truckCap.input.value),
        shovelCycleTimeSec: parseFloat(shovelCycle.input.value), truckCycleTimeSec: parseFloat(truckCycle.input.value),
        numShovels: parseInt(numShovels.input.value, 10), numTrucks: parseInt(numTrucks.input.value, 10),
        fillFactorPercent: parseFloat(fillFactor.input.value),
      });
      resultBox2.innerHTML = ''; resultBox2.style.display = 'block';
      const mfNote = r.matchFactor > 1.1 ? '⚠️ کامیون‌ها منتظر بیل می‌مانند (صف پشت بیل) — بیل گلوگاه است'
        : r.matchFactor < 0.9 ? '⚠️ بیل بیکار می‌ماند — کامیون کم است' : '✅ تعادل نسبتاً خوب بین بیل و کامیون';
      resultBox2.append(el('div', { class: 'kpi-grid' }, [
        kpiCard(fmtNum(r.matchFactor, 2), 'ضریب تطبیق (Match Factor)', 'var(--patina-600)'),
        kpiCard(String(r.passesPerTruck), 'تعداد پاس بیل برای پرکردن هر کامیون'),
        kpiCard(fmtNum(r.trucksToSaturateOneShovel, 1), 'کامیون لازم برای اشباع یک بیل'),
        kpiCard(fmtNum(r.effectiveTonPerHour, 0), 'تولید مؤثر (تن بر ساعت)'),
      ]), el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' }, mfNote));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });

  const card2 = el('div', { class: 'card', style: 'margin-top:14px' }, [
    el('h3', { style: 'margin-top:0' }, '🔁 تطبیق ناوگان بیل - کامیون (Match Factor)'),
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
      'Match Factor ≈ 1 یعنی تعادل خوب؛ بزرگ‌تر از ۱ یعنی کامیون اضافه (صف پشت بیل)، کوچک‌تر از ۱ یعنی بیل بیکار می‌ماند.'),
    grid2, runBtn2, resultBox2,
  ]);

  body.append(card1, card2);
}

// ————————————————————————————— باطله اقتصادی + عیار حد —————————————————————————————
function renderStrippingTab(body) {
  const oreValue = numberField('ارزش هر تن ماده‌ی معدنی پس از فروش (تومان)', 0);
  const oreMineCost = numberField('هزینه‌ی استخراج هر تن ماده‌ی معدنی (تومان)', 0);
  const processCost = numberField('هزینه‌ی فرآوری هر تن ماده‌ی معدنی (تومان)', 0);
  const wasteCost = numberField('هزینه‌ی استخراج هر تن باطله (تومان)', 0);
  const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [oreValue.wrap, oreMineCost.wrap, processCost.wrap, wasteCost.wrap]);
  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '⛏️ محاسبه‌ی نسبت باطله‌ی اقتصادی');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  runBtn.addEventListener('click', () => {
    try {
      const r = calcBreakEvenStrippingRatio({
        oreValuePerTon: parseFloat(oreValue.input.value), oreMiningCostPerTon: parseFloat(oreMineCost.input.value),
        processingCostPerTon: parseFloat(processCost.input.value), wasteMiningCostPerTon: parseFloat(wasteCost.input.value),
      });
      resultBox.innerHTML = ''; resultBox.style.display = 'block';
      resultBox.append(el('div', { class: 'kpi-grid' }, [
        kpiCard(fmtNum(r.netOreValuePerTon, 0), 'ارزش خالص هر تن ماده‌ی معدنی'),
        kpiCard(fmtNum(r.breakEvenRatio, 2), 'نسبت باطله‌ی اقتصادی (تن باطله به تن ماده)', 'var(--patina-600)'),
      ]), el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' },
        'یعنی تا این نسبت، برداشتن باطله برای رسیدن به همین ماده‌ی معدنی هنوز به‌صرفه است.'));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  const card1 = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '⛏️ نسبت باطله‌برداری اقتصادی (Break-even Stripping Ratio)'),
    grid, runBtn, resultBox,
  ]);

  const gradeUnit = selectField('واحد عیار', { gpt: { label: 'گرم بر تن (مثل طلا)' }, percent: { label: 'درصد (مثل مس/آهن)' } }, 'gpt');
  const metalPrice = numberField('قیمت فلز — تومان به‌ازای هر گرم (یا هر تن اگر واحد درصد است)', 0);
  const recovery = numberField('بازیابی فرآوری (٪)', 85);
  const miningCost = numberField('هزینه‌ی استخراج هر تن سنگ (تومان)', 0);
  const processCost2 = numberField('هزینه‌ی فرآوری هر تن سنگ (تومان)', 0);
  const sellCost = numberField('هزینه‌ی فروش/حمل هر تن سنگ (تومان)', 0);
  const grid2 = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [
    gradeUnit.wrap, metalPrice.wrap, recovery.wrap, miningCost.wrap, processCost2.wrap, sellCost.wrap,
  ]);
  const runBtn2 = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '📊 محاسبه‌ی عیار حد');
  const resultBox2 = el('div', { style: 'margin-top:14px;display:none' });
  runBtn2.addEventListener('click', () => {
    try {
      const r = calcCutoffGrade({
        gradeUnit: gradeUnit.select.value, metalPricePerUnit: parseFloat(metalPrice.input.value),
        recoveryPercent: parseFloat(recovery.input.value), miningCostPerTon: parseFloat(miningCost.input.value),
        processingCostPerTon: parseFloat(processCost2.input.value), sellingCostPerTon: parseFloat(sellCost.input.value),
      });
      resultBox2.innerHTML = ''; resultBox2.style.display = 'block';
      resultBox2.append(el('div', { class: 'kpi-grid' }, [
        kpiCard(fmtNum(r.totalCostPerTonOre, 0), 'مجموع هزینه‌ی هر تن سنگ'),
        kpiCard(`${fmtNum(r.cutoffGrade, gradeUnit.select.value === 'gpt' ? 3 : 4)} ${gradeUnit.select.value === 'gpt' ? 'g/t' : '٪'}`, 'عیار حد', 'var(--patina-600)'),
      ]), el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' },
        'یعنی سنگ با عیار بالاتر از این مقدار، استخراج/فرآوری‌اش سودده است.'));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  const card2 = el('div', { class: 'card', style: 'margin-top:14px' }, [
    el('h3', { style: 'margin-top:0' }, '📊 عیار حد (Cut-off Grade)'),
    grid2, runBtn2, resultBox2,
  ]);

  body.append(card1, card2);
}

// ————————————————————————————— پایداری شیب —————————————————————————————
function renderSlopeTab(body) {
  const intro = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, [
    'محاسبه‌ی ضریب اطمینان به روش ساده‌شده‌ی «شیب بی‌نهایت» (Infinite Slope) — مناسب غربالگری اولیه‌ی شیب‌های طولانی و صفحه‌ای. ',
    el('b', {}, '⚠️ برای شیب‌های پیچیده یا گسیختگی دایره‌ای، این روش کافی نیست — '),
    'باید توسط مهندس ژئوتکنیک با نرم‌افزار تخصصی (مثل Slide/GeoStudio) و پارامترهای برشی واقعی توده‌سنگ/خاک بررسی شود.',
  ]);
  const height = numberField('ارتفاع شیب (m)', 20);
  const angle = numberField('زاویه‌ی شیب (درجه)', 45);
  const unitWeight = numberField('وزن مخصوص توده (کیلونیوتن بر متر مکعب)', 22);
  const cohesion = numberField('چسبندگی c (کیلوپاسکال)', 20);
  const friction = numberField('زاویه‌ی اصطکاک داخلی φ (درجه)', 30);
  const porePressure = numberField('فشار آب منفذی (کیلوپاسکال) — اگر خشک است صفر', 0);
  const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [
    height.wrap, angle.wrap, unitWeight.wrap, cohesion.wrap, friction.wrap, porePressure.wrap,
  ]);
  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '🏔️ محاسبه‌ی ضریب اطمینان');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  runBtn.addEventListener('click', () => {
    try {
      const r = calcSlopeFactorOfSafety({
        heightM: parseFloat(height.input.value), slopeAngleDeg: parseFloat(angle.input.value),
        unitWeightKnM3: parseFloat(unitWeight.input.value), cohesionKpa: parseFloat(cohesion.input.value),
        frictionAngleDeg: parseFloat(friction.input.value), porePressureKpa: parseFloat(porePressure.input.value) || 0,
      });
      resultBox.innerHTML = ''; resultBox.style.display = 'block';
      const accent = r.fs >= 1.5 ? 'var(--patina-600)' : r.fs >= 1.0 ? 'var(--amber-600)' : 'var(--rust-600)';
      const note = r.fs >= 1.5 ? '✅ پایدار (حاشیه‌ی اطمینان مناسب)' : r.fs >= 1.0 ? '⚠️ حاشیه‌ی اطمینان کم — پایش/بررسی دقیق‌تر لازم است' : '🚨 ناپایدار — خطر ریزش/لغزش';
      resultBox.append(el('div', { class: 'kpi-grid' }, [
        kpiCard(fmtNum(r.fs, 2), 'ضریب اطمینان (FS)', accent),
        kpiCard(fmtNum(r.normalStress, 1), 'تنش نرمال مؤثر (kPa)'),
        kpiCard(fmtNum(r.shearStress, 1), 'تنش برشی (kPa)'),
      ]), el('div', { style: `font-size:var(--text-sm);font-weight:700;margin-top:8px;color:${accent}` }, note));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  body.append(el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '🏔️ پایداری شیب — روش شیب بی‌نهایت (ساده‌شده)'),
    intro, grid, runBtn, resultBox,
  ]));
}

// ————————————————————————————— حقوق دولتی —————————————————————————————
function renderRoyaltyTab(body) {
  const intro = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, [
    'نرخ حقوق دولتی/بهره‌مالکانه را طبق آخرین تعرفه‌ی مصوب برای گروه ماده‌ی معدنی مربوطه (که هر سال توسط وزارت صنعت، معدن و تجارت ابلاغ می‌شود) وارد کنید — این ابزار فقط محاسبه‌گر است، نرخ را در خودش ذخیره نمی‌کند.',
  ]);
  const tonnage = numberField('تناژ تولید/فروش (تن)', 0);
  const unitPrice = numberField('قیمت پایه/فروش هر تن (تومان)', 0);
  const rate = numberField('نرخ حقوق دولتی (٪ طبق تعرفه‌ی رسمی)', 0);
  const discount = numberField('درصد تخفیف/معافیت (اگر شامل می‌شود)', 0);
  const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [tonnage.wrap, unitPrice.wrap, rate.wrap, discount.wrap]);
  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '🏛️ محاسبه‌ی حقوق دولتی');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  runBtn.addEventListener('click', () => {
    try {
      const r = calcRoyalty({
        tonnage: parseFloat(tonnage.input.value), unitPrice: parseFloat(unitPrice.input.value),
        royaltyRatePercent: parseFloat(rate.input.value), discountPercent: parseFloat(discount.input.value) || 0,
      });
      resultBox.innerHTML = ''; resultBox.style.display = 'block';
      resultBox.append(el('div', { class: 'kpi-grid' }, [
        kpiCard(fmtNum(r.grossValue, 0), 'ارزش ناخالص تولید (تومان)'),
        kpiCard(fmtNum(r.baseRoyalty, 0), 'حقوق دولتی قبل از تخفیف'),
        kpiCard(fmtNum(r.discountAmount, 0), 'مبلغ تخفیف/معافیت'),
        kpiCard(fmtNum(r.payableRoyalty, 0), 'حقوق دولتی قابل‌پرداخت (تومان)', 'var(--patina-600)'),
      ]));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  body.append(el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '🏛️ حقوق دولتی / بهره‌مالکانه'),
    intro, grid, runBtn, resultBox,
  ]));
}

// ————————————————————————————— جریان نقدی / NPV —————————————————————————————
function renderNpvTab(body) {
  const intro = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
    'برآورد ساده‌ی ارزش فعلی خالص (NPV) و نرخ بازده داخلی (IRR) طرح، بر اساس برنامه‌ی تولید سالانه.');
  const years = numberField('تعداد سال طرح', 5, '1');
  const discountRate = numberField('نرخ تنزیل (٪)', 25);
  const rowsBox = el('div', { style: 'margin-top:12px;overflow-x:auto' });
  let rowInputs = [];

  function buildRows() {
    const n = Math.max(1, Math.min(30, parseInt(years.input.value, 10) || 1));
    rowInputs = Array.from({ length: n }, () => ({
      production: el('input', { type: 'number', value: '0', style: 'width:100px' }),
      price: el('input', { type: 'number', value: '0', style: 'width:100px' }),
      opex: el('input', { type: 'number', value: '0', style: 'width:100px' }),
      capex: el('input', { type: 'number', value: '0', style: 'width:100px' }),
    }));
    rowsBox.innerHTML = '';
    const table = el('table', { class: 'data-table' });
    table.append(el('thead', {}, el('tr', {}, ['سال', 'تولید (تن)', 'قیمت هر تن', 'هزینه‌ی عملیاتی هر تن', 'سرمایه‌گذاری (CAPEX)'].map((h) => el('th', {}, h)))));
    const tbody = el('tbody');
    rowInputs.forEach((row, i) => {
      tbody.append(el('tr', {}, [
        el('td', {}, String(i)), el('td', {}, row.production), el('td', {}, row.price), el('td', {}, row.opex), el('td', {}, row.capex),
      ]));
    });
    table.append(tbody);
    rowsBox.append(table);
  }
  years.input.addEventListener('change', buildRows);
  buildRows();

  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '📈 محاسبه‌ی NPV و IRR');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  runBtn.addEventListener('click', () => {
    try {
      const cashflows = rowInputs.map((row) => {
        const production = parseFloat(row.production.value) || 0;
        const price = parseFloat(row.price.value) || 0;
        const opex = parseFloat(row.opex.value) || 0;
        const capex = parseFloat(row.capex.value) || 0;
        return production * price - production * opex - capex;
      });
      const npv = calcNPV(cashflows, parseFloat(discountRate.input.value));
      const irr = calcIRR(cashflows);
      resultBox.innerHTML = ''; resultBox.style.display = 'block';
      resultBox.append(el('div', { class: 'kpi-grid' }, [
        kpiCard(fmtNum(npv, 0), 'ارزش فعلی خالص NPV (تومان)', npv >= 0 ? 'var(--patina-600)' : 'var(--rust-600)'),
        kpiCard(irr === null ? '—' : `${fmtNum(irr, 1)}٪`, 'نرخ بازده داخلی IRR'),
      ]), el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' },
        `جریان نقدی سالانه: ${cashflows.map((c) => fmtNum(c, 0)).join(' | ')}`));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });

  body.append(el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '📈 جریان نقدی و NPV/IRR طرح معدنی'),
    intro,
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;max-width:420px' }, [years.wrap, discountRate.wrap]),
    rowsBox, runBtn, resultBox,
  ]));
}

// ————————————————————————————— حجم کپه + ظرفیت سنگ‌شکن —————————————————————————————
function renderStockpileTab(body) {
  const shape = selectField('شکل کپه', { conical: { label: 'مخروطی (ریختن نقطه‌ای)' }, ridge: { label: 'کشیده/تاجی (استکر نواری)' } }, 'conical');
  const height = numberField('ارتفاع کپه (m)', 8);
  const repose = numberField('زاویه‌ی طبیعی مواد (درجه) — معمولاً ۳۰-۴۵', 35);
  const ridgeLength = numberField('طول تاج کپه (m) — فقط برای شکل کشیده', 30);
  const bulkDensity = numberField('چگالی توده‌ی مواد (تن بر متر مکعب)', 1.8);
  const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [shape.wrap, height.wrap, repose.wrap, ridgeLength.wrap, bulkDensity.wrap]);
  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '🗻 محاسبه‌ی حجم کپه');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  runBtn.addEventListener('click', () => {
    try {
      const r = calcStockpileVolume({
        shape: shape.select.value, heightM: parseFloat(height.input.value), reposeAngleDeg: parseFloat(repose.input.value),
        ridgeLengthM: parseFloat(ridgeLength.input.value), bulkDensityTonM3: parseFloat(bulkDensity.input.value),
      });
      resultBox.innerHTML = ''; resultBox.style.display = 'block';
      resultBox.append(el('div', { class: 'kpi-grid' }, [
        kpiCard(fmtNum(r.volumeM3, 0), 'حجم (m³)', 'var(--patina-600)'),
        kpiCard(fmtNum(r.tonnage, 0), 'تناژ (تن)'),
      ]), el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' }, r.shapeNote));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  const card1 = el('div', { class: 'card' }, [el('h3', { style: 'margin-top:0' }, '🗻 حجم و تناژ کپه‌ی مواد'), grid, runBtn, resultBox]);

  const introCrusher = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, [
    'برآورد بسیار تقریبی (rule-of-thumb) برای برآورد اولیه‌ی ظرفیت. ',
    el('b', {}, '⚠️ ظرفیت واقعی هر مدل سنگ‌شکن باید از نمودار/جدول ظرفیت رسمی سازنده خوانده شود — '),
    'این فرمول عمومی جایگزین آن نیست.',
  ]);
  const width = numberField('عرض دهانه‌ی ورودی سنگ‌شکن (m)', 1.0);
  const oss = numberField('تنظیم دهانه‌ی خروجی — OSS (m)', 0.1);
  const speed = numberField('سرعت اکسنتریک (دور بر دقیقه)', 250);
  const bulkDensity2 = numberField('چگالی توده‌ی خوراک (تن بر متر مکعب)', 1.6);
  const effFactor = numberField('ضریب تجربی کارایی (پیش‌فرض ۰.۲)', 0.2);
  const grid2 = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [width.wrap, oss.wrap, speed.wrap, bulkDensity2.wrap, effFactor.wrap]);
  const runBtn2 = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '⚙️ برآورد ظرفیت سنگ‌شکن');
  const resultBox2 = el('div', { style: 'margin-top:14px;display:none' });
  runBtn2.addEventListener('click', () => {
    try {
      const r = calcCrusherCapacity({
        widthM: parseFloat(width.input.value), openSideSettingM: parseFloat(oss.input.value),
        speedRpm: parseFloat(speed.input.value), bulkDensityTonM3: parseFloat(bulkDensity2.input.value),
        efficiencyFactor: parseFloat(effFactor.input.value),
      });
      resultBox2.innerHTML = ''; resultBox2.style.display = 'block';
      resultBox2.append(el('div', { class: 'kpi-grid' }, [kpiCard(fmtNum(r.capacityTonPerHour, 1), 'ظرفیت برآوردی (تن بر ساعت)', 'var(--patina-600)')]));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  const card2 = el('div', { class: 'card', style: 'margin-top:14px' }, [
    el('h3', { style: 'margin-top:0' }, '⚙️ برآورد اولیه‌ی ظرفیت سنگ‌شکن'),
    introCrusher, grid2, runBtn2, resultBox2,
  ]);

  body.append(card1, card2);
}
