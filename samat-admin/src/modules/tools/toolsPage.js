import { el, showToast } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { calcBlastDesign, ROCK_KB, EXPLOSIVE_TYPES } from '../../lib/blastCalc.js';
import { CONVERT_CATEGORIES, convertUnit } from '../../lib/unitConvert.js';
import { EQUIPMENT_CATEGORIES, EQUIPMENT_LIST } from '../../lib/equipmentSpecs.js';
import {
  calcEquipmentHourlyCost, calcMatchFactor, calcBreakEvenStrippingRatio, calcCutoffGrade,
  calcSlopeFactorOfSafety, calcRoyalty, calcNPV, calcIRR, calcStockpileVolume, calcCrusherCapacity,
  calcReserveEstimate, calcMineLife, calcHaulCost, calcDepreciationSchedule, calcExplorationDrillingCost,
  calcDewatering, calcLoanAmortization,
} from '../../lib/miningEconomics.js';
import {
  calcRQDFromCore, calcRMR, RMR_CONDITION_OPTIONS, RMR_WATER_OPTIONS, checkKinematics,
} from '../../lib/geologyCalc.js';
import { calcPPV, calcKuzRamFragmentation, KUZNETSOV_ROCK_FACTOR, RWS_BY_EXPLOSIVE } from '../../lib/blastAdvanced.js';
import {
  calcBondMillPower, calcThickenerSizing, calcPulpMassBalance, calcBlendForward, calcBlendTwoPileRatio, calcSieveAnalysis,
} from '../../lib/processingCalc.js';
import { calcSafetyIndices, calcReclamationGuarantee } from '../../lib/safetyEnvCalc.js';
import { printReportHTML } from '../../lib/printReport.js';

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

/** دکمه‌ی چاپ/PDF — محتوای فعلی resultBox را (هر زمان کلیک شود) در یک پنجره‌ی چاپ باز می‌کند.
 * قبل از اولین محاسبه، resultBox خالی است، پس فقط یک هشدار نشان می‌دهد. */
function printButton(title, resultBox) {
  return el('button', {
    class: 'btn-sm', style: 'background:var(--stone-100);margin-top:10px',
    onclick: () => {
      if (!resultBox.innerHTML.trim()) { showToast('⚠️ اول محاسبه را انجام دهید'); return; }
      try { printReportHTML(title, resultBox.innerHTML); } catch (err) { showToast(`⚠️ ${err.message}`); }
    },
  }, '🖨️ چاپ / PDF');
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
  reserve: '📦 برآورد ذخیره و عمر معدن',
  haul: '🚛 هزینه‌ی حمل',
  depreciation: '📉 جدول استهلاک تجهیزات',
  geology: '🪨 رده‌بندی توده‌سنگ و گسیختگی',
  explorationCost: '🎯 هزینه‌ی حفاری اکتشافی',
  ppv: '📳 لرزش انفجار (PPV)',
  kuzram: '💨 پیش‌بینی خردایش',
  processing2: '⚗️ آسیاب و تیکنر',
  safety: '🦺 شاخص‌های ایمنی',
  reclamation: '🌱 بازسازی و تضمین زیست‌محیطی',
  blending: '🔀 اختلاط باطله',
  sieve: '🕸️ آنالیز دانه‌بندی الک',
  dewatering: '💦 آبکشی چاه/گودال',
  loan: '🏦 اقساط وام ماشین‌آلات',
};

export async function renderTools(container, state) {
  container.innerHTML = '';
  const tabs = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px' });
  Object.entries(SUB_LABELS).forEach(([key, label]) => {
    tabs.append(el('button', {
      class: 'btn-sm',
      style: key === activeToolSub ? 'background:var(--ochre-600);color:#fff' : 'background:var(--stone-100);color:var(--ink-700)',
      onclick: () => { activeToolSub = key; renderTools(container, state); },
    }, label));
  });
  container.append(tabs);

  const body = el('div');
  container.append(body);
  const renderers = {
    blast: renderBlastTab, converter: renderConverterTab, equipment: renderEquipmentTab,
    fleet: renderFleetTab, stripping: renderStrippingTab, slope: renderSlopeTab,
    royalty: renderRoyaltyTab, npv: renderNpvTab, stockpile: renderStockpileTab,
    reserve: renderReserveTab, haul: renderHaulTab, depreciation: renderDepreciationTab,
    geology: renderGeologyTab, explorationCost: renderExplorationCostTab, ppv: renderPpvTab,
    kuzram: renderKuzRamTab, processing2: renderProcessing2Tab,
    safety: (b) => renderSafetyTab(b, state), reclamation: renderReclamationTab,
    blending: renderBlendingTab, sieve: renderSieveTab, dewatering: renderDewateringTab, loan: renderLoanTab,
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
    intro, grid1, grid2, runBtn, resultBox, printButton('طراحی الگوی آتش‌باری', resultBox),
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
    grid, runBtn, resultBox, printButton('هزینه‌ی ساعتی ماشین‌آلات', resultBox),
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
    grid2, runBtn2, resultBox2, printButton('تطبیق ناوگان بیل-کامیون', resultBox2),
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
    grid, runBtn, resultBox, printButton('نسبت باطله‌برداری اقتصادی', resultBox),
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
    grid2, runBtn2, resultBox2, printButton('عیار حد', resultBox2),
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
    intro, grid, runBtn, resultBox, printButton('پایداری شیب', resultBox),
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
    intro, grid, runBtn, resultBox, printButton('حقوق دولتی', resultBox),
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
    rowsBox, runBtn, resultBox, printButton('جریان نقدی و NPV/IRR', resultBox),
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
  const card1 = el('div', { class: 'card' }, [el('h3', { style: 'margin-top:0' }, '🗻 حجم و تناژ کپه‌ی مواد'), grid, runBtn, resultBox, printButton('حجم کپه', resultBox)]);

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
    introCrusher, grid2, runBtn2, resultBox2, printButton('ظرفیت سنگ‌شکن', resultBox2),
  ]);

  body.append(card1, card2);
}

// ————————————————————————————— برآورد ذخیره + عمر معدن —————————————————————————————
function renderReserveTab(body) {
  const intro = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, [
    'روش «منطقه‌ی تأثیر»: هر ردیف یک بلوک/گمانه است. ',
    el('b', {}, '⚠️ برآورد دستی اولیه است، نه بلوک‌مدل زمین‌آماری — '),
    'برای طبقه‌بندی رسمی ذخیره باید مهندس اکتشاف/زمین‌شناسی بررسی و تایید کند.',
  ]);
  const rowCount = numberField('تعداد بلوک/گمانه', 3, '1');
  const rowsBox = el('div', { style: 'margin-top:12px;overflow-x:auto' });
  let rowInputs = [];

  function buildRows() {
    const n = Math.max(1, Math.min(50, parseInt(rowCount.input.value, 10) || 1));
    rowInputs = Array.from({ length: n }, () => ({
      area: el('input', { type: 'number', value: '0', style: 'width:100px' }),
      thickness: el('input', { type: 'number', value: '0', style: 'width:90px' }),
      grade: el('input', { type: 'number', value: '0', style: 'width:90px' }),
      density: el('input', { type: 'number', value: '2.6', style: 'width:90px' }),
    }));
    rowsBox.innerHTML = '';
    const table = el('table', { class: 'data-table' });
    table.append(el('thead', {}, el('tr', {}, ['بلوک', 'مساحت تأثیر (m²)', 'ضخامت (m)', 'عیار', 'چگالی (تن/m³)'].map((h) => el('th', {}, h)))));
    const tbody = el('tbody');
    rowInputs.forEach((row, i) => {
      tbody.append(el('tr', {}, [
        el('td', {}, String(i + 1)), el('td', {}, row.area), el('td', {}, row.thickness), el('td', {}, row.grade), el('td', {}, row.density),
      ]));
    });
    table.append(tbody);
    rowsBox.append(table);
  }
  rowCount.input.addEventListener('change', buildRows);
  buildRows();

  const annualProd = numberField('نرخ تولید سالانه (تن) — برای محاسبه‌ی عمر معدن', 0);
  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '📦 محاسبه‌ی ذخیره و عمر معدن');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  runBtn.addEventListener('click', () => {
    try {
      const boreholes = rowInputs.map((row) => ({
        influenceAreaM2: parseFloat(row.area.value) || 0, thicknessM: parseFloat(row.thickness.value) || 0,
        grade: parseFloat(row.grade.value) || 0, densityTonM3: parseFloat(row.density.value) || 0,
      }));
      const r = calcReserveEstimate(boreholes);
      resultBox.innerHTML = ''; resultBox.style.display = 'block';
      const children = [el('div', { class: 'kpi-grid' }, [
        kpiCard(fmtNum(r.totalVolumeM3, 0), 'حجم کل (m³)'),
        kpiCard(fmtNum(r.totalTonnage, 0), 'تناژ کل ذخیره (تن)', 'var(--patina-600)'),
        kpiCard(fmtNum(r.weightedGrade, 3), 'میانگین وزنی عیار'),
      ])];
      const annual = parseFloat(annualProd.input.value) || 0;
      if (annual > 0) {
        const life = calcMineLife(r.totalTonnage, annual);
        children.push(el('div', { class: 'kpi-grid', style: 'margin-top:8px' }, [
          kpiCard(`${fmtNum(life, 1)} سال`, 'عمر تخمینی معدن', 'var(--ochre-700)'),
        ]));
      }
      resultBox.append(...children);
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });

  body.append(el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '📦 برآورد ذخیره (منطقه‌ی تأثیر) و عمر معدن'),
    intro,
    el('div', { style: 'max-width:220px' }, rowCount.wrap),
    rowsBox,
    el('div', { style: 'max-width:420px;margin-top:10px' }, annualProd.wrap),
    runBtn, resultBox, printButton('برآورد ذخیره و عمر معدن', resultBox),
  ]));
}

// ————————————————————————————— هزینه‌ی حمل —————————————————————————————
function renderHaulTab(body) {
  const distance = numberField('فاصله‌ی یک‌طرفه (کیلومتر)', 5);
  const speed = numberField('سرعت متوسط کامیون (کیلومتر بر ساعت)', 25);
  const fixedTime = numberField('زمان ثابت بارگیری+تخلیه (دقیقه)', 8);
  const truckHourly = numberField('هزینه‌ی ساعتی کامیون (تومان) — از ابزار «هزینه ماشین‌آلات» بگیرید', 0);
  const truckCap = numberField('ظرفیت کامیون (تن)', 30);
  const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [distance.wrap, speed.wrap, fixedTime.wrap, truckHourly.wrap, truckCap.wrap]);
  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '🚛 محاسبه‌ی هزینه‌ی حمل');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  runBtn.addEventListener('click', () => {
    try {
      const r = calcHaulCost({
        oneWayDistanceKm: parseFloat(distance.input.value), avgSpeedKmH: parseFloat(speed.input.value),
        fixedLoadDumpMinutes: parseFloat(fixedTime.input.value), truckHourlyCost: parseFloat(truckHourly.input.value),
        truckCapacityTon: parseFloat(truckCap.input.value),
      });
      resultBox.innerHTML = ''; resultBox.style.display = 'block';
      resultBox.append(el('div', { class: 'kpi-grid' }, [
        kpiCard(`${fmtNum(r.cycleTimeSec / 60, 1)} min`, 'زمان کل سیکل'),
        kpiCard(fmtNum(r.tripsPerHour, 2), 'تعداد سفر در ساعت'),
        kpiCard(fmtNum(r.tonPerHour, 1), 'تناژ حمل‌شده در ساعت'),
        kpiCard(fmtNum(r.costPerTon, 0), 'هزینه‌ی حمل هر تن (تومان)', 'var(--patina-600)'),
        kpiCard(fmtNum(r.costPerTonKm, 0), 'هزینه‌ی حمل هر تن-کیلومتر (تومان)'),
      ]));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  body.append(el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '🚛 هزینه‌ی حمل (Haul Cost)'),
    grid, runBtn, resultBox, printButton('هزینه‌ی حمل', resultBox),
  ]));
}

// ————————————————————————————— جدول استهلاک تجهیزات —————————————————————————————
function renderDepreciationTab(body) {
  const price = numberField('قیمت خرید (تومان)', 0);
  const salvage = numberField('ارزش اسقاط (تومان)', 0);
  const lifeYears = numberField('عمر مفید (سال)', 10, '1');
  const method = selectField('روش استهلاک', { straight: { label: 'خط مستقیم' }, declining: { label: 'نزولی مضاعف (Double-declining)' } }, 'straight');
  const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [price.wrap, salvage.wrap, lifeYears.wrap, method.wrap]);
  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '📉 محاسبه‌ی جدول استهلاک');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  runBtn.addEventListener('click', () => {
    try {
      const rows = calcDepreciationSchedule({
        purchasePrice: parseFloat(price.input.value), salvageValue: parseFloat(salvage.input.value),
        lifeYears: parseInt(lifeYears.input.value, 10), method: method.select.value,
      });
      resultBox.innerHTML = ''; resultBox.style.display = 'block';
      const table = el('table', { class: 'data-table' });
      table.append(el('thead', {}, el('tr', {}, ['سال', 'استهلاک سالانه', 'استهلاک انباشته', 'ارزش دفتری'].map((h) => el('th', {}, h)))));
      const tbody = el('tbody');
      rows.forEach((row) => {
        tbody.append(el('tr', {}, [
          el('td', {}, String(row.year)), el('td', {}, fmtNum(row.depreciation, 0)),
          el('td', {}, fmtNum(row.accumulated, 0)), el('td', {}, fmtNum(row.bookValue, 0)),
        ]));
      });
      table.append(tbody);
      resultBox.append(table);
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  body.append(el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '📉 جدول استهلاک تجهیزات'),
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, 'برای اظهارنامه‌ی مالیاتی یا حسابداری داخلی — روش و نرخ نهایی را با حسابدار/ممیز مالیاتی تطبیق دهید.'),
    grid, runBtn, resultBox, printButton('جدول استهلاک تجهیزات', resultBox),
  ]));
}

// ————————————————————————————— رده‌بندی توده‌سنگ (RMR) + گسیختگی شیب —————————————————————————————
function renderGeologyTab(body) {
  // کارت اول: RQD از مغزه (کمکی)
  const runLen = numberField('طول کل مغزه‌ی حفاری‌شده (m)', 1);
  const intactSum = numberField('مجموع طول قطعات سالم بزرگ‌تر از ۱۰ سانتی‌متر (m)', 0.8);
  const rqdResultBox = el('div', { style: 'margin-top:10px;display:none' });
  const rqdInputForRmr = numberField('RQD (٪) — برای رده‌بندی RMR زیر', 75);
  const rqdRunBtn = el('button', { class: 'btn-sm', style: 'background:var(--stone-100);margin-top:6px', onclick: () => {
    try {
      const { rqd } = calcRQDFromCore(parseFloat(runLen.input.value), parseFloat(intactSum.input.value));
      rqdResultBox.innerHTML = ''; rqdResultBox.style.display = 'block';
      rqdResultBox.append(el('div', { style: 'font-weight:800;color:var(--ochre-700)' }, `RQD = ${fmtNum(rqd, 1)}٪`));
      rqdInputForRmr.input.value = rqd.toFixed(1);
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  } }, '📏 محاسبه‌ی RQD از مغزه');
  const rqdCard = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '📏 RQD از روی مغزه‌ی حفاری (اختیاری)'),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, [runLen.wrap, intactSum.wrap]),
    rqdRunBtn, rqdResultBox,
  ]);

  // کارت دوم: RMR
  const ucs = numberField('مقاومت فشاری تک‌محوره UCS (مگاپاسکال)', 80);
  const spacing = numberField('فاصله‌ی درزه‌ها (میلی‌متر)', 400);
  const condition = selectField('وضعیت سطح درزه‌ها', RMR_CONDITION_OPTIONS, 'fair');
  const water = selectField('وضعیت آب زیرزمینی', RMR_WATER_OPTIONS, 'damp');
  const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [
    ucs.wrap, rqdInputForRmr.wrap, spacing.wrap, condition.wrap, water.wrap,
  ]);
  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '🪨 محاسبه‌ی RMR');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  runBtn.addEventListener('click', () => {
    try {
      const r = calcRMR({
        ucsMpa: parseFloat(ucs.input.value), rqdPercent: parseFloat(rqdInputForRmr.input.value),
        spacingMm: parseFloat(spacing.input.value), conditionKey: condition.select.value, waterKey: water.select.value,
      });
      resultBox.innerHTML = ''; resultBox.style.display = 'block';
      resultBox.append(
        el('div', { class: 'kpi-grid' }, [
          kpiCard(String(r.total), 'امتیاز کل RMR', 'var(--patina-600)'),
          kpiCard(r.label, 'رده‌ی توده‌سنگ'),
        ]),
        el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' },
          `ریز امتیاز: UCS=${r.r1} + RQD=${r.r2} + فاصله‌ی درزه=${r.r3} + وضعیت درزه=${r.r4} + آب=${r.r5}`),
        el('div', { style: 'font-size:var(--text-sm);margin-top:8px' },
          `چسبندگی توده‌سنگ معمول این رده: ${r.cohesionKpa} kPa — زاویه‌ی اصطکاک: ${r.frictionDeg} درجه (می‌توانید این دو را در ابزار «پایداری شیب» استفاده کنید)`),
      );
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  const rmrCard = el('div', { class: 'card', style: 'margin-top:14px' }, [
    el('h3', { style: 'margin-top:0' }, '🪨 رده‌بندی توده‌سنگ RMR (Bieniawski 1989)'),
    grid, runBtn, resultBox, printButton('رده‌بندی توده‌سنگ RMR', resultBox),
  ]);

  // کارت سوم: تحلیل جنبشی گسیختگی شیب
  const kIntro = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, [
    'غربالگری سریع نوع گسیختگی محتمل (صفحه‌ای/واژگونی/گوه‌ای) طبق معیارهای Hoek & Bray. ',
    el('b', {}, '⚠️ جایگزین استریونت کامل و بررسی میدانی نیست.'),
  ]);
  const slopeDipDir = numberField('جهت شیب دیواره — Dip Direction (درجه از شمال)', 90);
  const slopeDipAngle = numberField('زاویه‌ی شیب دیواره (درجه)', 60);
  const frictionK = numberField('زاویه‌ی اصطکاک داخلی (درجه)', 30);
  const j1Dir = numberField('درزه ۱ — جهت شیب (درجه)', 100);
  const j1Dip = numberField('درزه ۱ — زاویه‌ی شیب (درجه)', 40);
  const j2Dir = numberField('درزه ۲ — جهت شیب (درجه) — اگر ندارید صفر بگذارید', 0);
  const j2Dip = numberField('درزه ۲ — زاویه‌ی شیب (درجه)', 0);
  const kGrid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [
    slopeDipDir.wrap, slopeDipAngle.wrap, frictionK.wrap, j1Dir.wrap, j1Dip.wrap, j2Dir.wrap, j2Dip.wrap,
  ]);
  const kRunBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '🧭 تحلیل جنبشی گسیختگی');
  const kResultBox = el('div', { style: 'margin-top:14px;display:none' });
  kRunBtn.addEventListener('click', () => {
    try {
      const joints = [{ dipDir: parseFloat(j1Dir.input.value), dipAngle: parseFloat(j1Dip.input.value) }];
      if (parseFloat(j2Dip.input.value) > 0) joints.push({ dipDir: parseFloat(j2Dir.input.value), dipAngle: parseFloat(j2Dip.input.value) });
      const r = checkKinematics({
        slopeDipDir: parseFloat(slopeDipDir.input.value), slopeDipAngle: parseFloat(slopeDipAngle.input.value),
        frictionDeg: parseFloat(frictionK.input.value), joints,
      });
      kResultBox.innerHTML = ''; kResultBox.style.display = 'block';
      r.perJoint.forEach((j) => {
        const risk = j.planar || j.toppling;
        kResultBox.append(el('div', { style: `font-size:var(--text-sm);margin-bottom:4px;color:${risk ? 'var(--rust-600)' : 'var(--patina-700)'}` },
          `درزه ${j.index}: ${j.planar ? '⚠️ احتمال گسیختگی صفحه‌ای' : ''} ${j.toppling ? '⚠️ احتمال گسیختگی واژگونی' : ''} ${!j.planar && !j.toppling ? '✅ بدون خطر صفحه‌ای/واژگونی' : ''}`));
      });
      r.wedges.forEach((w) => {
        kResultBox.append(el('div', { style: `font-size:var(--text-sm);margin-bottom:4px;color:${w.wedgeFail ? 'var(--rust-600)' : 'var(--patina-700)'}` },
          `تقاطع درزه‌های ${w.pair}: پلانژ ${fmtNum(w.plunge, 1)}° / روند ${fmtNum(w.trend, 1)}° — ${w.wedgeFail ? '⚠️ احتمال گسیختگی گوه‌ای' : '✅ بدون خطر گوه‌ای'}`));
      });
      if (!r.wedges.length) kResultBox.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-500)' }, 'برای بررسی گسیختگی گوه‌ای، درزه‌ی دوم را هم وارد کنید.'));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  const kCard = el('div', { class: 'card', style: 'margin-top:14px' }, [
    el('h3', { style: 'margin-top:0' }, '🧭 تحلیل جنبشی گسیختگی شیب'),
    kIntro, kGrid, kRunBtn, kResultBox, printButton('تحلیل جنبشی گسیختگی شیب', kResultBox),
  ]);

  body.append(rqdCard, rmrCard, kCard);
}

// ————————————————————————————— هزینه‌ی برنامه‌ی حفاری اکتشافی —————————————————————————————
function renderExplorationCostTab(body) {
  const numHoles = numberField('تعداد گمانه', 10, '1');
  const avgDepth = numberField('میانگین عمق هر گمانه (m)', 80);
  const costPerMeter = numberField('هزینه‌ی هر متر حفاری (تومان)', 0);
  const samplesPerHole = numberField('تعداد نمونه به‌ازای هر گمانه', 20);
  const sampleCost = numberField('هزینه‌ی نمونه‌برداری هر نمونه (تومان)', 0);
  const assayCost = numberField('هزینه‌ی آزمایش/آنالیز هر نمونه (تومان)', 0);
  const mobilization = numberField('هزینه‌ی بسیج دستگاه/تجهیزات (تومان) — یک‌بار', 0);
  const minBudget = numberField('حداقل تعهد هزینه‌ی اکتشاف طبق پروانه (تومان) — اختیاری', 0);
  const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [
    numHoles.wrap, avgDepth.wrap, costPerMeter.wrap, samplesPerHole.wrap, sampleCost.wrap, assayCost.wrap, mobilization.wrap, minBudget.wrap,
  ]);
  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '🎯 محاسبه‌ی هزینه‌ی برنامه');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  runBtn.addEventListener('click', () => {
    try {
      const r = calcExplorationDrillingCost({
        numHoles: parseInt(numHoles.input.value, 10), avgDepthM: parseFloat(avgDepth.input.value),
        costPerMeterDrilling: parseFloat(costPerMeter.input.value), samplesPerHole: parseFloat(samplesPerHole.input.value),
        sampleCostEach: parseFloat(sampleCost.input.value), assayCostEach: parseFloat(assayCost.input.value),
        mobilizationCost: parseFloat(mobilization.input.value) || 0, minCommittedBudget: parseFloat(minBudget.input.value) || 0,
      });
      resultBox.innerHTML = ''; resultBox.style.display = 'block';
      const cards = [
        kpiCard(`${fmtNum(r.totalDrillLengthM, 0)} m`, 'مجموع طول حفاری'),
        kpiCard(fmtNum(r.drillingCost, 0), 'هزینه‌ی حفاری (تومان)'),
        kpiCard(String(r.totalSamples), 'مجموع تعداد نمونه'),
        kpiCard(fmtNum(r.sampleCost, 0), 'هزینه‌ی نمونه‌برداری+آنالیز (تومان)'),
        kpiCard(fmtNum(r.totalCost, 0), 'هزینه‌ی کل برنامه (تومان)', 'var(--patina-600)'),
      ];
      resultBox.append(el('div', { class: 'kpi-grid' }, cards));
      if (r.meetsCommitment !== undefined) {
        resultBox.append(el('div', {
          style: `margin-top:8px;font-weight:700;color:${r.meetsCommitment ? 'var(--patina-700)' : 'var(--rust-600)'}`,
        }, r.meetsCommitment ? '✅ این برنامه حداقل تعهد هزینه‌ی پروانه را پوشش می‌دهد' : `⚠️ این برنامه ${fmtNum(r.shortfall, 0)} تومان کمتر از حداقل تعهد پروانه است`));
      }
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  body.append(el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '🎯 هزینه‌ی برنامه‌ی حفاری اکتشافی'),
    grid, runBtn, resultBox, printButton('هزینه‌ی برنامه‌ی حفاری اکتشافی', resultBox),
  ]));
}

// ————————————————————————————— لرزش انفجار (PPV) —————————————————————————————
function renderPpvTab(body) {
  const intro = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, [
    'روش فاصله‌ی مقیاس‌شده‌ی USBM: PPV = K×(D/√W)^-B. ',
    el('b', {}, '⚠️ ثابت‌های K و B کاملاً وابسته به سایت‌اند — '),
    'مقادیر پیش‌فرض فقط نقطه‌ی شروع‌اند؛ برای هر معدن باید با پایش لرزش‌نگاری واقعی کالیبره شوند.',
  ]);
  const charge = numberField('حداکثر خرج مواد ناریه در هر تأخیر (kg) — از ابزار آتش‌باری بگیرید', 50);
  const distance = numberField('فاصله تا نزدیک‌ترین ساختمان/روستا (m)', 300);
  const siteK = numberField('ثابت سایت K (پیش‌فرض آموزشی)', 700);
  const siteB = numberField('توان کاهش B (پیش‌فرض آموزشی)', 1.6);
  const allowable = numberField('حد مجاز لرزش PPV طبق استاندارد/مصوبه (mm/s)', 12.5);
  const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [
    charge.wrap, distance.wrap, siteK.wrap, siteB.wrap, allowable.wrap,
  ]);
  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '📳 محاسبه‌ی لرزش و فاصله‌ی ایمن');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  runBtn.addEventListener('click', () => {
    try {
      const r = calcPPV({
        maxChargePerDelayKg: parseFloat(charge.input.value), distanceM: parseFloat(distance.input.value),
        siteK: parseFloat(siteK.input.value), siteB: parseFloat(siteB.input.value), allowablePpvMmS: parseFloat(allowable.input.value),
      });
      resultBox.innerHTML = ''; resultBox.style.display = 'block';
      resultBox.append(el('div', { class: 'kpi-grid' }, [
        kpiCard(fmtNum(r.predictedPpvMmS, 2), 'لرزش پیش‌بینی‌شده در این فاصله (mm/s)', r.withinLimit ? 'var(--patina-600)' : 'var(--rust-600)'),
        kpiCard(fmtNum(r.safeDistanceM, 0), 'حداقل فاصله‌ی ایمن برای حد مجاز (m)', 'var(--ochre-700)'),
        kpiCard(fmtNum(r.scaledDistance, 2), 'فاصله‌ی مقیاس‌شده'),
      ]), el('div', {
        style: `margin-top:8px;font-weight:700;color:${r.withinLimit ? 'var(--patina-700)' : 'var(--rust-600)'}`,
      }, r.withinLimit ? '✅ در فاصله‌ی فعلی، لرزش پیش‌بینی‌شده کمتر از حد مجاز است' : '🚨 لرزش پیش‌بینی‌شده بیشتر از حد مجاز است — خرج در هر تأخیر را کم کنید یا فاصله را بیشتر کنید'));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  body.append(el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '📳 لرزش انفجار (PPV) و فاصله‌ی ایمن'),
    intro, grid, runBtn, resultBox, printButton('لرزش انفجار PPV', resultBox),
  ]));
}

// ————————————————————————————— پیش‌بینی خردایش Kuz-Ram —————————————————————————————
function renderKuzRamTab(body) {
  const intro = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, [
    'مدل Kuznetsov برای اندازه‌ی متوسط قطعات + توزیع Rosin-Rammler (نسخه‌ی ساده‌شده‌ی ضریب یکنواختی Cunningham). ',
    el('b', {}, '⚠️ یک پیش‌بینی تجربی است، نه اندازه‌گیری واقعی — '),
    'برای کالیبراسیون دقیق، خردایش واقعی باید با عکس‌برداری/الک آزمایشی مقایسه شود.',
  ]);
  const rockFactor = selectField('ضریب سنگ (Kuznetsov)', KUZNETSOV_ROCK_FACTOR, 'soft');
  const volumePerHole = numberField('حجم سنگ هر چال — Burden×Spacing×ارتفاع پله (m³)', 250);
  const chargePerHole = numberField('خرج هر چال (kg) — از ابزار آتش‌باری بگیرید', 40);
  const explosiveKey = selectField('نوع ماده‌ی ناریه (برای RWS)', EXPLOSIVE_TYPES, 'anfo');
  const burden = numberField('برم (m)', 3);
  const spacing = numberField('فاصله‌داری (m)', 3.5);
  const diameter = numberField('قطر چال (mm)', 89);
  const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [
    rockFactor.wrap, volumePerHole.wrap, chargePerHole.wrap, explosiveKey.wrap, burden.wrap, spacing.wrap, diameter.wrap,
  ]);
  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '💨 پیش‌بینی خردایش');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  runBtn.addEventListener('click', () => {
    try {
      const r = calcKuzRamFragmentation({
        rockFactorKey: rockFactor.select.value, volumePerHoleM3: parseFloat(volumePerHole.input.value),
        chargePerHoleKg: parseFloat(chargePerHole.input.value), rws: RWS_BY_EXPLOSIVE[explosiveKey.select.value],
        burdenM: parseFloat(burden.input.value), spacingM: parseFloat(spacing.input.value), holeDiameterMm: parseFloat(diameter.input.value),
      });
      resultBox.innerHTML = ''; resultBox.style.display = 'block';
      resultBox.append(el('div', { class: 'kpi-grid' }, [
        kpiCard(`${fmtNum(r.x50Cm, 1)} cm`, 'اندازه‌ی متوسط قطعات (X50)', 'var(--patina-600)'),
        kpiCard(`${fmtNum(r.x20Cm, 1)} cm`, 'اندازه‌ی X20 (۲۰٪ عبوری)'),
        kpiCard(`${fmtNum(r.x80Cm, 1)} cm`, 'اندازه‌ی X80 (۸۰٪ عبوری)'),
        kpiCard(fmtNum(r.n, 2), 'ضریب یکنواختی (n)'),
      ]));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  body.append(el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '💨 پیش‌بینی خردایش (Kuz-Ram)'),
    intro, grid, runBtn, resultBox, printButton('پیش‌بینی خردایش Kuz-Ram', resultBox),
  ]));
}

// ————————————————————————————— آسیاب (Bond) + تیکنر —————————————————————————————
function renderProcessing2Tab(body) {
  const wi = numberField('اندیس کار باند — Wi (kWh/تن)', 14);
  const f80 = numberField('اندازه‌ی ۸۰٪ عبوری خوراک — F80 (میکرون)', 10000);
  const p80 = numberField('اندازه‌ی ۸۰٪ عبوری محصول — P80 (میکرون)', 150);
  const throughput = numberField('ظرفیت عبوری آسیاب (تن بر ساعت)', 50);
  const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [wi.wrap, f80.wrap, p80.wrap, throughput.wrap]);
  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '⚙️ محاسبه‌ی توان آسیاب');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  runBtn.addEventListener('click', () => {
    try {
      const r = calcBondMillPower({
        workIndexKwhPerTon: parseFloat(wi.input.value), feedF80Micron: parseFloat(f80.input.value),
        productP80Micron: parseFloat(p80.input.value), throughputTonPerHour: parseFloat(throughput.input.value),
      });
      resultBox.innerHTML = ''; resultBox.style.display = 'block';
      resultBox.append(el('div', { class: 'kpi-grid' }, [
        kpiCard(fmtNum(r.specificEnergyKwhPerTon, 2), 'انرژی ویژه (kWh/تن)'),
        kpiCard(fmtNum(r.requiredPowerKw, 0), 'توان لازم آسیاب (kW)', 'var(--patina-600)'),
      ]));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  const card1 = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '⚙️ توان آسیاب — قانون باند (Bond\'s Third Theory)'),
    grid, runBtn, resultBox, printButton('توان آسیاب Bond', resultBox),
  ]);

  const feedTon = numberField('تناژ خوراک تیکنر (تن خشک در روز)', 500);
  const unitArea = numberField('ضریب سطح واحد — از آزمایش ته‌نشینی آزمایشگاهی (m²·روز/تن)', 0.2);
  const grid2 = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [feedTon.wrap, unitArea.wrap]);
  const runBtn2 = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '🌀 محاسبه‌ی ابعاد تیکنر');
  const resultBox2 = el('div', { style: 'margin-top:14px;display:none' });
  runBtn2.addEventListener('click', () => {
    try {
      const r = calcThickenerSizing({ solidsFeedTonPerDay: parseFloat(feedTon.input.value), unitAreaM2DayPerTon: parseFloat(unitArea.input.value) });
      resultBox2.innerHTML = ''; resultBox2.style.display = 'block';
      resultBox2.append(el('div', { class: 'kpi-grid' }, [
        kpiCard(fmtNum(r.areaM2, 1), 'سطح لازم (m²)', 'var(--patina-600)'),
        kpiCard(fmtNum(r.diameterM, 1), 'قطر تیکنر (m)'),
      ]));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  const card2 = el('div', { class: 'card', style: 'margin-top:14px' }, [
    el('h3', { style: 'margin-top:0' }, '🌀 ابعاد تیکنر/غلیظ‌ساز — روش سطح واحد'),
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
      '⚠️ ضریب سطح واحد را نباید حدس زد — باید از آزمایش ته‌نشینی روی همان پالپ به‌دست بیاید.'),
    grid2, runBtn2, resultBox2, printButton('ابعاد تیکنر', resultBox2),
  ]);

  // موازنه‌ی جرمی پالپ
  const feedRate = numberField('نرخ خوراک ورودی (تن بر ساعت)', 50);
  const feedSolids = numberField('درصد جامد خوراک (٪)', 30);
  const underflowSolids = numberField('درصد جامد هدف زیرریز (٪)', 60);
  const grid3 = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [feedRate.wrap, feedSolids.wrap, underflowSolids.wrap]);
  const runBtn3 = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '💧 محاسبه‌ی موازنه‌ی جرمی');
  const resultBox3 = el('div', { style: 'margin-top:14px;display:none' });
  runBtn3.addEventListener('click', () => {
    try {
      const r = calcPulpMassBalance({
        feedTonPerHour: parseFloat(feedRate.input.value), feedSolidsPercent: parseFloat(feedSolids.input.value),
        underflowSolidsPercent: parseFloat(underflowSolids.input.value),
      });
      resultBox3.innerHTML = ''; resultBox3.style.display = 'block';
      resultBox3.append(el('div', { class: 'kpi-grid' }, [
        kpiCard(fmtNum(r.solidsTonPerHour, 1), 'جامد ورودی (تن/ساعت)'),
        kpiCard(fmtNum(r.underflowTotalTonPerHour, 1), 'کل زیرریز (تن/ساعت)', 'var(--patina-600)'),
        kpiCard(fmtNum(r.underflowWaterTonPerHour, 1), 'آب زیرریز (تن/ساعت)'),
        kpiCard(fmtNum(r.overflowWaterTonPerHour, 1), 'آب سرریز (تن/ساعت)'),
      ]));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  const card3 = el('div', { class: 'card', style: 'margin-top:14px' }, [
    el('h3', { style: 'margin-top:0' }, '💧 موازنه‌ی جرمی جامد/آب پالپ'),
    grid3, runBtn3, resultBox3, printButton('موازنه‌ی جرمی پالپ', resultBox3),
  ]);

  body.append(card1, card2, card3);
}

// ————————————————————————————— شاخص‌های ایمنی —————————————————————————————
function renderSafetyTab(body, state) {
  const intro = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
    'شاخص‌های استاندارد بین‌المللی (ILO) بر پایه‌ی هر یک‌میلیون نفر-ساعت کار.');
  const injuries = numberField('تعداد کل حوادث قابل‌ثبت در بازه', 0);
  const fatalities = numberField('تعداد فوتی (زیرمجموعه‌ی بالا)', 0);
  const lostDays = numberField('مجموع روزهای از دست‌رفته‌ی کاری', 0);
  const manHours = numberField('مجموع نفر-ساعت کارکرد در همین بازه', 0);

  const fetchBtn = el('button', { class: 'btn-sm', style: 'background:var(--stone-100);margin-bottom:10px', onclick: async () => {
    if (!state || !state.department) { showToast('⚠️ اطلاعات بخش در دسترس نیست'); return; }
    fetchBtn.disabled = true; const orig = fetchBtn.textContent; fetchBtn.textContent = '⏳ در حال دریافت...';
    try {
      const { data } = await sb.from('incident_reports').select('injured_count, fatality_count').eq('department', state.department);
      const rows = data || [];
      const totalInjuries = rows.reduce((s, r) => s + (r.injured_count || 0) + (r.fatality_count || 0), 0);
      const totalFatalities = rows.reduce((s, r) => s + (r.fatality_count || 0), 0);
      injuries.input.value = String(totalInjuries);
      fatalities.input.value = String(totalFatalities);
      showToast(`✅ ${rows.length} حادثه ثبت‌شده برای این بخش یافت شد (همه‌ی بازه‌ها)`);
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    } finally {
      fetchBtn.disabled = false; fetchBtn.textContent = orig;
    }
  } }, '📥 دریافت تعداد حوادث ثبت‌شده در سامانه (این بخش)');

  const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [injuries.wrap, fatalities.wrap, lostDays.wrap, manHours.wrap]);
  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '🦺 محاسبه‌ی شاخص‌ها');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  runBtn.addEventListener('click', () => {
    try {
      const r = calcSafetyIndices({
        recordableInjuries: parseFloat(injuries.input.value) || 0, fatalities: parseFloat(fatalities.input.value) || 0,
        lostDays: parseFloat(lostDays.input.value) || 0, manHours: parseFloat(manHours.input.value),
      });
      resultBox.innerHTML = ''; resultBox.style.display = 'block';
      resultBox.append(el('div', { class: 'kpi-grid' }, [
        kpiCard(fmtNum(r.ltifr, 2), 'LTIFR (به‌ازای هر ۱M نفر-ساعت)', r.ltifr === 0 ? 'var(--patina-600)' : 'var(--amber-600)'),
        kpiCard(fmtNum(r.fatalityRate, 3), 'نرخ فوت (به‌ازای هر ۱M نفر-ساعت)', r.fatalityRate === 0 ? 'var(--patina-600)' : 'var(--rust-600)'),
        kpiCard(fmtNum(r.severityRate, 1), 'نرخ شدت (روز از دست‌رفته به‌ازای هر ۱M نفر-ساعت)'),
      ]));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  body.append(el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '🦺 شاخص‌های ایمنی (LTIFR / نرخ فوت / نرخ شدت)'),
    intro, fetchBtn, grid, runBtn, resultBox, printButton('شاخص‌های ایمنی', resultBox),
  ]));
}

// ————————————————————————————— بازسازی و تضمین زیست‌محیطی —————————————————————————————
function renderReclamationTab(body) {
  const area = numberField('مساحت تخریب‌شده (هکتار)', 5);
  const costPerHa = numberField('هزینه‌ی بازسازی هر هکتار (تومان)', 0);
  const contingency = numberField('درصد پیش‌بینی‌نشده/احتیاط (٪)', 15);
  const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [area.wrap, costPerHa.wrap, contingency.wrap]);
  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '🌱 محاسبه‌ی تضمین زیست‌محیطی');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  runBtn.addEventListener('click', () => {
    try {
      const r = calcReclamationGuarantee({
        disturbedAreaHectares: parseFloat(area.input.value), costPerHectare: parseFloat(costPerHa.input.value),
        contingencyPercent: parseFloat(contingency.input.value) || 0,
      });
      resultBox.innerHTML = ''; resultBox.style.display = 'block';
      resultBox.append(el('div', { class: 'kpi-grid' }, [
        kpiCard(fmtNum(r.baseCost, 0), 'هزینه‌ی پایه‌ی بازسازی (تومان)'),
        kpiCard(fmtNum(r.contingencyAmount, 0), 'مبلغ احتیاط'),
        kpiCard(fmtNum(r.totalGuarantee, 0), 'مبلغ تضمین مالی زیست‌محیطی (تومان)', 'var(--patina-600)'),
      ]));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  body.append(el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '🌱 هزینه‌ی بازسازی و تضمین مالی زیست‌محیطی'),
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, 'این مبلغ معمولاً همان مبنای تضمینی است که باید از بهره‌بردار برای بازسازی محیط‌زیست پس از پایان کار اخذ شود.'),
    grid, runBtn, resultBox, printButton('تضمین زیست‌محیطی', resultBox),
  ]));
}

// ————————————————————————————— اختلاط باطله —————————————————————————————
function renderBlendingTab(body) {
  // کارت اول: محاسبه‌ی رفت (چند کپه -> عیار محصول)
  const rowCount = numberField('تعداد کپه', 2, '1');
  const rowsBox = el('div', { style: 'margin-top:12px;overflow-x:auto' });
  let rowInputs = [];
  function buildRows() {
    const n = Math.max(2, Math.min(20, parseInt(rowCount.input.value, 10) || 2));
    rowInputs = Array.from({ length: n }, () => ({
      tonnage: el('input', { type: 'number', value: '100', style: 'width:100px' }),
      grade: el('input', { type: 'number', value: '0', style: 'width:100px' }),
    }));
    rowsBox.innerHTML = '';
    const table = el('table', { class: 'data-table' });
    table.append(el('thead', {}, el('tr', {}, ['کپه', 'تناژ', 'عیار'].map((h) => el('th', {}, h)))));
    const tbody = el('tbody');
    rowInputs.forEach((row, i) => {
      tbody.append(el('tr', {}, [el('td', {}, String(i + 1)), el('td', {}, row.tonnage), el('td', {}, row.grade)]));
    });
    table.append(tbody);
    rowsBox.append(table);
  }
  rowCount.input.addEventListener('change', buildRows);
  buildRows();
  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '🔀 محاسبه‌ی عیار محصول اختلاط');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  runBtn.addEventListener('click', () => {
    try {
      const piles = rowInputs.map((row) => ({ tonnage: parseFloat(row.tonnage.value) || 0, grade: parseFloat(row.grade.value) || 0 }));
      const r = calcBlendForward(piles);
      resultBox.innerHTML = ''; resultBox.style.display = 'block';
      resultBox.append(el('div', { class: 'kpi-grid' }, [
        kpiCard(fmtNum(r.totalTonnage, 0), 'تناژ کل محصول'),
        kpiCard(fmtNum(r.blendedGrade, 3), 'عیار محصول اختلاط', 'var(--patina-600)'),
      ]));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  const card1 = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '🔀 محاسبه‌ی رفت — عیار حاصل از اختلاط چند کپه'),
    el('div', { style: 'max-width:200px' }, rowCount.wrap), rowsBox, runBtn, resultBox, printButton('عیار اختلاط', resultBox),
  ]);

  // کارت دوم: محاسبه‌ی برگشت (دو کپه -> نسبت لازم برای عیار هدف)
  const gradeA = numberField('عیار کپه‌ی A', 0.5);
  const gradeB = numberField('عیار کپه‌ی B', 2);
  const target = numberField('عیار هدف محصول', 1);
  const grid2 = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [gradeA.wrap, gradeB.wrap, target.wrap]);
  const runBtn2 = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '🎯 محاسبه‌ی نسبت اختلاط لازم');
  const resultBox2 = el('div', { style: 'margin-top:14px;display:none' });
  runBtn2.addEventListener('click', () => {
    try {
      const r = calcBlendTwoPileRatio({ gradeA: parseFloat(gradeA.input.value), gradeB: parseFloat(gradeB.input.value), targetGrade: parseFloat(target.input.value) });
      resultBox2.innerHTML = ''; resultBox2.style.display = 'block';
      resultBox2.append(el('div', { class: 'kpi-grid' }, [
        kpiCard(`${fmtNum(r.fractionA * 100, 1)}٪`, 'سهم کپه‌ی A', 'var(--patina-600)'),
        kpiCard(`${fmtNum(r.fractionB * 100, 1)}٪`, 'سهم کپه‌ی B'),
      ]));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  const card2 = el('div', { class: 'card', style: 'margin-top:14px' }, [
    el('h3', { style: 'margin-top:0' }, '🎯 محاسبه‌ی برگشت — نسبت اختلاط دو کپه برای عیار هدف'),
    grid2, runBtn2, resultBox2, printButton('نسبت اختلاط دو کپه', resultBox2),
  ]);

  body.append(card1, card2);
}

// ————————————————————————————— آنالیز دانه‌بندی الک —————————————————————————————
function renderSieveTab(body) {
  const intro = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
    'الک‌ها را از درشت به ریز وارد کنید. D50/D80 با درون‌یابی لگاریتمی از منحنی عبوری محاسبه می‌شود.');
  const rowCount = numberField('تعداد الک', 5, '1');
  const rowsBox = el('div', { style: 'margin-top:12px;overflow-x:auto' });
  let rowInputs = [];
  function buildRows() {
    const n = Math.max(2, Math.min(20, parseInt(rowCount.input.value, 10) || 2));
    rowInputs = Array.from({ length: n }, () => ({
      size: el('input', { type: 'number', value: '1', style: 'width:100px' }),
      mass: el('input', { type: 'number', value: '0', style: 'width:100px' }),
    }));
    rowsBox.innerHTML = '';
    const table = el('table', { class: 'data-table' });
    table.append(el('thead', {}, el('tr', {}, ['ردیف', 'اندازه‌ی الک (mm)', 'جرم مانده (g)'].map((h) => el('th', {}, h)))));
    const tbody = el('tbody');
    rowInputs.forEach((row, i) => {
      tbody.append(el('tr', {}, [el('td', {}, String(i + 1)), el('td', {}, row.size), el('td', {}, row.mass)]));
    });
    table.append(tbody);
    rowsBox.append(table);
  }
  rowCount.input.addEventListener('change', buildRows);
  buildRows();
  const panMass = numberField('جرم باقی‌مانده در ته (کوچک‌تر از ریزترین الک، g)', 0);
  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '🕸️ محاسبه‌ی دانه‌بندی');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  runBtn.addEventListener('click', () => {
    try {
      const rows = rowInputs.map((row) => ({ sizeMm: parseFloat(row.size.value) || 0, massRetainedG: parseFloat(row.mass.value) || 0 }));
      const r = calcSieveAnalysis(rows, parseFloat(panMass.input.value) || 0);
      resultBox.innerHTML = ''; resultBox.style.display = 'block';
      resultBox.append(el('div', { class: 'kpi-grid' }, [
        kpiCard(r.d50 === null ? '—' : `${fmtNum(r.d50, 3)} mm`, 'D50', 'var(--patina-600)'),
        kpiCard(r.d80 === null ? '—' : `${fmtNum(r.d80, 3)} mm`, 'D80'),
      ]));
      const table = el('table', { class: 'data-table', style: 'margin-top:10px' });
      table.append(el('thead', {}, el('tr', {}, ['اندازه (mm)', 'مانده (g)', '٪ مانده', '٪ تجمعی مانده', '٪ تجمعی عبوری'].map((h) => el('th', {}, h)))));
      const tbody = el('tbody');
      r.table.forEach((row) => {
        tbody.append(el('tr', {}, [
          el('td', {}, fmtNum(row.sizeMm, 3)), el('td', {}, fmtNum(row.massRetainedG, 1)),
          el('td', {}, fmtNum(row.percentRetained, 1)), el('td', {}, fmtNum(row.cumulativePercentRetained, 1)),
          el('td', {}, fmtNum(row.cumulativePercentPassing, 1)),
        ]));
      });
      table.append(tbody);
      resultBox.append(table);
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  body.append(el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '🕸️ آنالیز دانه‌بندی الک (Sieve Analysis)'),
    intro, el('div', { style: 'max-width:200px' }, rowCount.wrap), rowsBox,
    el('div', { style: 'max-width:420px;margin-top:10px' }, panMass.wrap),
    runBtn, resultBox, printButton('آنالیز دانه‌بندی الک', resultBox),
  ]));
}

// ————————————————————————————— آبکشی چاه/گودال —————————————————————————————
function renderDewateringTab(body) {
  const intro = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, [
    el('b', {}, '⚠️ دبی ورودی واقعی باید از آزمایش پمپاژ/مطالعه‌ی هیدروژئولوژی به دست بیاید، نه حدس — '),
    'این ابزار فقط ظرفیت پمپ لازم و زمان تخلیه را از روی همان عدد محاسبه می‌کند.',
  ]);
  const inflow = numberField('دبی ورودی آب برآوردی (متر مکعب بر ساعت)', 10);
  const safety = numberField('ضریب اطمینان (٪)', 25);
  const standing = numberField('حجم آب راکد فعلی (متر مکعب) — اختیاری', 0);
  const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [inflow.wrap, safety.wrap, standing.wrap]);
  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '💦 محاسبه‌ی ظرفیت پمپ');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  runBtn.addEventListener('click', () => {
    try {
      const r = calcDewatering({
        inflowM3PerHour: parseFloat(inflow.input.value), safetyFactorPercent: parseFloat(safety.input.value) || 0,
        standingWaterVolumeM3: parseFloat(standing.input.value) || 0,
      });
      resultBox.innerHTML = ''; resultBox.style.display = 'block';
      const cards = [kpiCard(fmtNum(r.requiredPumpCapacityM3PerHour, 1), 'ظرفیت پمپ لازم (m³/h)', 'var(--patina-600)')];
      if (r.timeToDewaterHours !== null) cards.push(kpiCard(fmtNum(r.timeToDewaterHours, 1), 'زمان لازم برای خشک‌کردن (ساعت)'));
      resultBox.append(el('div', { class: 'kpi-grid' }, cards));
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  body.append(el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '💦 آبکشی چاه/گودال (Dewatering)'),
    intro, grid, runBtn, resultBox, printButton('آبکشی چاه/گودال', resultBox),
  ]));
}

// ————————————————————————————— اقساط وام ماشین‌آلات —————————————————————————————
function renderLoanTab(body) {
  const principal = numberField('مبلغ اصل وام (تومان)', 0);
  const rate = numberField('نرخ سود سالانه (٪)', 18);
  const months = numberField('تعداد ماه بازپرداخت', 36, '1');
  const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [principal.wrap, rate.wrap, months.wrap]);
  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '🏦 محاسبه‌ی جدول اقساط');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  runBtn.addEventListener('click', () => {
    try {
      const r = calcLoanAmortization({
        principal: parseFloat(principal.input.value), annualRatePercent: parseFloat(rate.input.value), months: parseInt(months.input.value, 10),
      });
      resultBox.innerHTML = ''; resultBox.style.display = 'block';
      resultBox.append(el('div', { class: 'kpi-grid' }, [
        kpiCard(fmtNum(r.monthlyPayment, 0), 'قسط ماهانه (تومان)', 'var(--patina-600)'),
        kpiCard(fmtNum(r.totalInterest, 0), 'مجموع سود پرداختی'),
        kpiCard(fmtNum(r.totalPaid, 0), 'مجموع بازپرداخت'),
      ]));
      const table = el('table', { class: 'data-table', style: 'margin-top:10px;max-height:400px;overflow-y:auto;display:block' });
      table.append(el('thead', {}, el('tr', {}, ['ماه', 'قسط', 'سود', 'اصل', 'مانده'].map((h) => el('th', {}, h)))));
      const tbody = el('tbody');
      r.rows.forEach((row) => {
        tbody.append(el('tr', {}, [
          el('td', {}, String(row.month)), el('td', {}, fmtNum(row.payment, 0)),
          el('td', {}, fmtNum(row.interestPortion, 0)), el('td', {}, fmtNum(row.principalPortion, 0)), el('td', {}, fmtNum(row.balance, 0)),
        ]));
      });
      table.append(tbody);
      resultBox.append(table);
    } catch (err) { showToast(`⚠️ ${err.message}`); }
  });
  body.append(el('div', { class: 'card' }, [
    el('h3', { style: 'margin-top:0' }, '🏦 جدول اقساط وام خرید ماشین‌آلات'),
    grid, runBtn, resultBox, printButton('جدول اقساط وام', resultBox),
  ]));
}
