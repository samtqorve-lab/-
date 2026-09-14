/**
 * محاسبات فنی-اقتصادی معدنی (فاز دوم، سوم، چهارم و پنجم ابزارها): هزینه‌ی ساعتی ماشین‌آلات، تطبیق ناوگان بیل-کامیون،
 * نسبت باطله‌برداری اقتصادی، عیار حد، پایداری شیب (شیب بی‌نهایت)، حقوق دولتی/بهره‌مالکانه،
 * جریان نقدی/NPV/IRR طرح، حجم کپه، برآورد اولیه‌ی ظرفیت سنگ‌شکن، برآورد ذخیره از گمانه + عمر معدن،
 * هزینه‌ی حمل، جدول استهلاک تجهیزات، هزینه‌ی برنامه‌ی حفاری اکتشافی، آبکشی چاه/گودال، و جدول
 * اقساط وام خرید تجهیزات.
 * همه‌ی این‌ها برآورد مهندسی/مالی اولیه‌اند — برای تصمیم نهایی، مقادیر باید توسط مسئول فنی/کارشناس
 * مربوطه با شرایط واقعی سایت و آخرین تعرفه/آیین‌نامه تطبیق داده شوند.
 */

// ————————————————————————— هزینه‌ی ساعتی ماشین‌آلات (روش مالکیت + بهره‌برداری) —————————————————————————
export function calcEquipmentHourlyCost(p) {
  const depreciableValue = p.purchasePrice - p.salvageValue;
  if (depreciableValue <= 0) throw new Error('ارزش اسقاط باید کمتر از قیمت خرید باشد');
  const depreciationPerHour = depreciableValue / p.lifeHours;
  const avgInvestment = (p.purchasePrice + p.salvageValue) / 2;
  const interestInsuranceTaxPerHour = (avgInvestment * (p.interestInsuranceTaxRatePercent / 100)) / p.annualOperatingHours;
  const ownershipCostPerHour = depreciationPerHour + interestInsuranceTaxPerHour;

  const fuelCostPerHour = p.fuelConsumptionLPerHour * p.fuelPricePerLiter;
  const lubeCostPerHour = fuelCostPerHour * (p.lubeFactorPercent / 100);
  const tireCostPerHour = p.tireCost > 0 && p.tireLifeHours > 0 ? p.tireCost / p.tireLifeHours : 0;
  const repairCostPerHour = depreciationPerHour * (p.repairFactorPercent / 100);
  const operatingCostPerHour = fuelCostPerHour + lubeCostPerHour + tireCostPerHour + repairCostPerHour;

  const operatorCostPerHour = p.operatorWagePerHour || 0;
  const totalCostPerHour = ownershipCostPerHour + operatingCostPerHour + operatorCostPerHour;

  return {
    depreciationPerHour, interestInsuranceTaxPerHour, ownershipCostPerHour,
    fuelCostPerHour, lubeCostPerHour, tireCostPerHour, repairCostPerHour, operatingCostPerHour,
    operatorCostPerHour, totalCostPerHour,
  };
}

// ————————————————————————— تطبیق ناوگان بیل - کامیون (Match Factor) —————————————————————————
export function calcMatchFactor(p) {
  const passesPerTruck = Math.max(1, Math.ceil(p.truckCapacity / p.bucketCapacity));
  const loadTimePerTruckSec = passesPerTruck * p.shovelCycleTimeSec;
  const matchFactor = (p.numTrucks * loadTimePerTruckSec) / (p.numShovels * p.truckCycleTimeSec);
  const trucksToSaturateOneShovel = p.truckCycleTimeSec / loadTimePerTruckSec;
  const shovelLimitedTonPerHour = p.numShovels * (3600 / p.shovelCycleTimeSec) * (p.bucketCapacity * (p.fillFactorPercent / 100));
  const fleetLimitedTonPerHour = (p.numTrucks * p.truckCapacity * 3600) / p.truckCycleTimeSec;
  const effectiveTonPerHour = Math.min(shovelLimitedTonPerHour, fleetLimitedTonPerHour);
  return {
    passesPerTruck, loadTimePerTruckSec, matchFactor, trucksToSaturateOneShovel,
    shovelLimitedTonPerHour, fleetLimitedTonPerHour, effectiveTonPerHour,
  };
}

// ————————————————————————— نسبت باطله‌برداری اقتصادی —————————————————————————
export function calcBreakEvenStrippingRatio(p) {
  const netOreValuePerTon = p.oreValuePerTon - p.oreMiningCostPerTon - p.processingCostPerTon;
  if (p.wasteMiningCostPerTon <= 0) throw new Error('هزینه‌ی استخراج باطله باید بزرگ‌تر از صفر باشد');
  const breakEvenRatio = netOreValuePerTon / p.wasteMiningCostPerTon;
  return { netOreValuePerTon, breakEvenRatio };
}

// ————————————————————————— عیار حد (Cut-off Grade) —————————————————————————
export function calcCutoffGrade(p) {
  const totalCostPerTonOre = p.miningCostPerTon + p.processingCostPerTon + p.sellingCostPerTon;
  const recovery = p.recoveryPercent / 100;
  let cutoffGrade;
  if (p.gradeUnit === 'gpt') {
    // قیمت بر حسب واحد پول به‌ازای هر گرم فلز
    cutoffGrade = totalCostPerTonOre / (p.metalPricePerUnit * recovery);
  } else {
    // درصد — قیمت بر حسب واحد پول به‌ازای هر تن فلز خالص
    cutoffGrade = (totalCostPerTonOre / (p.metalPricePerUnit * recovery)) * 100;
  }
  return { totalCostPerTonOre, cutoffGrade };
}

// ————————————————————————— پایداری شیب — روش شیب بی‌نهایت (ساده‌شده) —————————————————————————
export function calcSlopeFactorOfSafety(p) {
  const betaRad = (p.slopeAngleDeg * Math.PI) / 180;
  const phiRad = (p.frictionAngleDeg * Math.PI) / 180;
  const normalStress = p.unitWeightKnM3 * p.heightM * Math.cos(betaRad) * Math.cos(betaRad) - (p.porePressureKpa || 0);
  const shearStress = p.unitWeightKnM3 * p.heightM * Math.sin(betaRad) * Math.cos(betaRad);
  if (shearStress <= 0) throw new Error('زاویه‌ی شیب باید بزرگ‌تر از صفر باشد');
  const fs = (p.cohesionKpa + normalStress * Math.tan(phiRad)) / shearStress;
  return { fs, normalStress, shearStress };
}

// ————————————————————————— حقوق دولتی / بهره‌مالکانه (عمومی — نرخ را طبق تعرفه‌ی رسمی سال جاری وارد کنید) —————————————————————————
export function calcRoyalty(p) {
  const grossValue = p.tonnage * p.unitPrice;
  const baseRoyalty = grossValue * (p.royaltyRatePercent / 100);
  const discountAmount = baseRoyalty * ((p.discountPercent || 0) / 100);
  const payableRoyalty = baseRoyalty - discountAmount;
  return { grossValue, baseRoyalty, discountAmount, payableRoyalty };
}

// ————————————————————————— جریان نقدی / NPV / IRR ساده —————————————————————————
export function calcNPV(cashflows, discountRatePercent) {
  const r = discountRatePercent / 100;
  return cashflows.reduce((sum, cf, year) => sum + cf / ((1 + r) ** year), 0);
}

/** یافتن IRR با روش دوبخشی (bisection) بین -99% و +1000%؛ اگر جواب همگرا نشود null برمی‌گرداند */
export function calcIRR(cashflows) {
  let lo = -0.99; let hi = 10;
  const npvAt = (r) => cashflows.reduce((sum, cf, year) => sum + cf / ((1 + r) ** year), 0);
  const nLo = npvAt(lo); const nHi = npvAt(hi);
  if (nLo * nHi > 0) return null; // علامت یکسان یعنی ریشه در این بازه نیست
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    const nMid = npvAt(mid);
    if (Math.abs(nMid) < 1e-6) return mid * 100;
    if ((nMid > 0) === (nLo > 0)) lo = mid; else hi = mid;
  }
  return ((lo + hi) / 2) * 100;
}

// ————————————————————————— حجم کپه (Stockpile) —————————————————————————
export function calcStockpileVolume(p) {
  const phiRad = (p.reposeAngleDeg * Math.PI) / 180;
  const radius = p.heightM / Math.tan(phiRad);
  let volumeM3; let shapeNote;
  if (p.shape === 'conical') {
    volumeM3 = (Math.PI * radius * radius * p.heightM) / 3;
    shapeNote = `شعاع پایه: ${radius.toFixed(2)} m — قطر پایه: ${(radius * 2).toFixed(2)} m`;
  } else {
    const ridgeLength = p.ridgeLengthM || 0;
    if (ridgeLength < 2 * radius) {
      volumeM3 = (Math.PI * radius * radius * p.heightM) / 3;
      shapeNote = `طول تاج (${ridgeLength} m) از ۲×شعاع (${(radius * 2).toFixed(2)} m) کمتر است — به‌صورت مخروطی ساده محاسبه شد`;
    } else {
      volumeM3 = (Math.PI * radius * radius * p.heightM) / 3 + (ridgeLength - 2 * radius) * radius * p.heightM;
      shapeNote = `شعاع سرها: ${radius.toFixed(2)} m`;
    }
  }
  const tonnage = volumeM3 * (p.bulkDensityTonM3 || 0);
  return { radius, volumeM3, tonnage, shapeNote };
}

// ————————————————————————— برآورد اولیه‌ی ظرفیت سنگ‌شکن —————————————————————————
/**
 * فرمول تقریبی درشتی (rule-of-thumb) برای برآورد اولیه — ظرفیت واقعی هر مدل سنگ‌شکن باید از
 * نمودار/جدول ظرفیت رسمی سازنده خوانده شود، نه از این فرمول عمومی.
 */
export function calcCrusherCapacity(p) {
  const capacityTonPerHour = 0.6 * p.widthM * p.openSideSettingM * p.speedRpm * p.bulkDensityTonM3 * (p.efficiencyFactor ?? 0.2) * 60;
  return { capacityTonPerHour };
}

// ————————————————————————— برآورد ذخیره از بلوک‌های تأثیر گمانه + عمر معدن —————————————————————————
/**
 * روش «منطقه‌ی تأثیر» (Area/Polygon of Influence) — ساده‌ترین و رایج‌ترین روش دستی برآورد ذخیره از
 * داده‌ی گمانه‌زنی: هر گمانه نماینده‌ی یک بلوک با مساحت تأثیر معین است. تناژ هر بلوک و میانگین
 * وزنی عیار کل ذخیره از مجموع بلوک‌ها به دست می‌آید.
 * ⚠️ این یک برآورد دستی اولیه است، نه یک بلوک‌مدل زمین‌آماری (Kriging/geostatistics) — برای طبقه‌بندی
 * رسمی ذخیره (اندازه‌شده/احتمالی/امکان‌پذیر طبق آیین‌نامه‌ی طبقه‌بندی ذخایر) باید توسط مهندس
 * اکتشاف/زمین‌شناسی و با نرم‌افزار تخصصی بررسی و تایید شود.
 */
export function calcReserveEstimate(boreholes) {
  const blocks = boreholes.map((b) => {
    const volumeM3 = b.influenceAreaM2 * b.thicknessM;
    const tonnage = volumeM3 * b.densityTonM3;
    return { ...b, volumeM3, tonnage };
  });
  const totalTonnage = blocks.reduce((sum, b) => sum + b.tonnage, 0);
  const weightedGrade = totalTonnage > 0
    ? blocks.reduce((sum, b) => sum + b.tonnage * b.grade, 0) / totalTonnage
    : 0;
  const totalVolumeM3 = blocks.reduce((sum, b) => sum + b.volumeM3, 0);
  return { blocks, totalVolumeM3, totalTonnage, weightedGrade };
}

export function calcMineLife(totalReserveTon, annualProductionTon) {
  if (!(annualProductionTon > 0)) throw new Error('نرخ تولید سالانه باید بزرگ‌تر از صفر باشد');
  return totalReserveTon / annualProductionTon;
}

// ————————————————————————— هزینه‌ی حمل (Haul Cost) —————————————————————————
export function calcHaulCost(p) {
  const oneWaySeconds = (p.oneWayDistanceKm / p.avgSpeedKmH) * 3600;
  const cycleTimeSec = oneWaySeconds * 2 + (p.fixedLoadDumpMinutes || 0) * 60;
  const tripsPerHour = 3600 / cycleTimeSec;
  const tonPerHour = tripsPerHour * p.truckCapacityTon;
  if (tonPerHour <= 0) throw new Error('پارامترها باید مثبت باشند');
  const costPerTon = p.truckHourlyCost / tonPerHour;
  const costPerTonKm = costPerTon / p.oneWayDistanceKm;
  return { cycleTimeSec, tripsPerHour, tonPerHour, costPerTon, costPerTonKm };
}

// ————————————————————————— جدول استهلاک تجهیزات —————————————————————————
/** روش خط مستقیم (Straight-line) و نزولی مضاعف (Double-declining Balance)، هرکدام محدود به سقف
 * ارزش اسقاط (استهلاک نزولی هیچ‌وقت کتاب را زیر ارزش اسقاط نمی‌برد). */
export function calcDepreciationSchedule(p) {
  const rows = [];
  let bookValue = p.purchasePrice;
  const straightAnnual = (p.purchasePrice - p.salvageValue) / p.lifeYears;
  const decliningRate = 2 / p.lifeYears;
  for (let year = 1; year <= p.lifeYears; year += 1) {
    let depreciation;
    if (p.method === 'declining') {
      depreciation = Math.min(bookValue * decliningRate, bookValue - p.salvageValue);
      depreciation = Math.max(depreciation, 0);
    } else {
      depreciation = straightAnnual;
    }
    bookValue -= depreciation;
    rows.push({ year, depreciation, accumulated: p.purchasePrice - bookValue, bookValue });
  }
  return rows;
}

// ————————————————————————— هزینه‌ی برنامه‌ی حفاری اکتشافی —————————————————————————
export function calcExplorationDrillingCost(p) {
  const totalDrillLengthM = p.numHoles * p.avgDepthM;
  const drillingCost = totalDrillLengthM * p.costPerMeterDrilling;
  const totalSamples = p.numHoles * p.samplesPerHole;
  const sampleCost = totalSamples * (p.sampleCostEach + p.assayCostEach);
  const totalCost = drillingCost + sampleCost + (p.mobilizationCost || 0);
  const result = { totalDrillLengthM, drillingCost, totalSamples, sampleCost, totalCost };
  if (p.minCommittedBudget > 0) {
    result.meetsCommitment = totalCost >= p.minCommittedBudget;
    result.shortfall = Math.max(0, p.minCommittedBudget - totalCost);
  }
  return result;
}

// ————————————————————————— آبکشی چاه/گودال (Dewatering) —————————————————————————
/**
 * برآورد بسیار ساده: ظرفیت پمپ لازم = دبی ورودی آب × ضریب اطمینان. اگر حجم آب راکد فعلی داده
 * شود، زمان لازم برای خشک‌کردن گودال هم محاسبه می‌شود.
 * ⚠️ دبی ورودی واقعی باید از آزمایش پمپاژ/مطالعه‌ی هیدروژئولوژی به دست بیاید، نه حدس.
 */
export function calcDewatering(p) {
  const requiredPumpCapacityM3PerHour = p.inflowM3PerHour * (1 + (p.safetyFactorPercent || 0) / 100);
  let timeToDewaterHours = null;
  if (p.standingWaterVolumeM3 > 0) {
    const netRemovalRate = requiredPumpCapacityM3PerHour - p.inflowM3PerHour;
    if (netRemovalRate <= 0) throw new Error('ظرفیت پمپ باید از دبی ورودی آب بیشتر باشد تا گودال خشک شود');
    timeToDewaterHours = p.standingWaterVolumeM3 / netRemovalRate;
  }
  return { requiredPumpCapacityM3PerHour, timeToDewaterHours };
}

// ————————————————————————— جدول اقساط وام خرید تجهیزات —————————————————————————
export function calcLoanAmortization(p) {
  const monthlyRate = p.annualRatePercent / 100 / 12;
  const n = p.months;
  const monthlyPayment = monthlyRate === 0
    ? p.principal / n
    : (p.principal * monthlyRate * (1 + monthlyRate) ** n) / ((1 + monthlyRate) ** n - 1);
  const rows = [];
  let balance = p.principal;
  for (let month = 1; month <= n; month += 1) {
    const interestPortion = balance * monthlyRate;
    const principalPortion = monthlyPayment - interestPortion;
    balance -= principalPortion;
    rows.push({ month, payment: monthlyPayment, interestPortion, principalPortion, balance: Math.max(0, balance) });
  }
  const totalPaid = monthlyPayment * n;
  const totalInterest = totalPaid - p.principal;
  return { monthlyPayment, rows, totalPaid, totalInterest };
}
