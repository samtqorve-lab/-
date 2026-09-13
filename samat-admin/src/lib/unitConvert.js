/**
 * تبدیل واحدهای رایج مهندسی/معدنی. هر دسته یک واحد پایه دارد و بقیه‌ی واحدها با یک ضریب به آن
 * واحد پایه تبدیل می‌شوند (value_in_base = value × factor). خود واحد پایه ضریب ۱ دارد.
 */
export const CONVERT_CATEGORIES = {
  power: {
    label: 'توان',
    units: {
      W: { label: 'وات (W)', factor: 1 },
      kW: { label: 'کیلووات (kW)', factor: 1000 },
      hp_metric: { label: 'اسب بخار متریک (hp)', factor: 735.49875 },
      hp_uk: { label: 'اسب بخار مکانیکی/انگلیسی (HP)', factor: 745.6998716 },
      'Btu/h': { label: 'بی‌تی‌یو بر ساعت (Btu/h)', factor: 0.29307107 },
      'kcal/h': { label: 'کیلوکالری بر ساعت', factor: 1.163 },
    },
  },
  pressure: {
    label: 'فشار',
    units: {
      Pa: { label: 'پاسکال (Pa)', factor: 1 },
      kPa: { label: 'کیلوپاسکال (kPa)', factor: 1000 },
      bar: { label: 'بار (bar)', factor: 100000 },
      psi: { label: 'پوند بر اینچ‌مربع (psi)', factor: 6894.757293168 },
      atm: { label: 'اتمسفر (atm)', factor: 101325 },
      kgf_cm2: { label: 'کیلوگرم‌نیرو بر سانتی‌متر‌مربع', factor: 98066.5 },
    },
  },
  length: {
    label: 'طول',
    units: {
      m: { label: 'متر', factor: 1 },
      cm: { label: 'سانتی‌متر', factor: 0.01 },
      mm: { label: 'میلی‌متر', factor: 0.001 },
      km: { label: 'کیلومتر', factor: 1000 },
      in: { label: 'اینچ', factor: 0.0254 },
      ft: { label: 'فوت', factor: 0.3048 },
      mile: { label: 'مایل', factor: 1609.344 },
    },
  },
  mass: {
    label: 'جرم',
    units: {
      kg: { label: 'کیلوگرم', factor: 1 },
      g: { label: 'گرم', factor: 0.001 },
      ton: { label: 'تن', factor: 1000 },
      lb: { label: 'پوند (lb)', factor: 0.45359237 },
    },
  },
  volume: {
    label: 'حجم',
    units: {
      m3: { label: 'متر مکعب', factor: 1 },
      L: { label: 'لیتر', factor: 0.001 },
      ft3: { label: 'فوت مکعب', factor: 0.0283168466 },
      gal_us: { label: 'گالن آمریکایی', factor: 0.00378541178 },
    },
  },
  density: {
    label: 'چگالی',
    units: {
      'kg/m3': { label: 'کیلوگرم بر متر مکعب', factor: 1 },
      'g/cm3': { label: 'گرم بر سانتی‌متر مکعب', factor: 1000 },
      'lb/ft3': { label: 'پوند بر فوت مکعب', factor: 16.01846337 },
      't/m3': { label: 'تن بر متر مکعب', factor: 1000 },
    },
  },
  energy: {
    label: 'انرژی',
    units: {
      J: { label: 'ژول', factor: 1 },
      kJ: { label: 'کیلوژول', factor: 1000 },
      kWh: { label: 'کیلووات‌ساعت', factor: 3600000 },
      cal: { label: 'کالری', factor: 4.184 },
      kcal: { label: 'کیلوکالری', factor: 4184 },
    },
  },
  speed: {
    label: 'سرعت',
    units: {
      'm/s': { label: 'متر بر ثانیه', factor: 1 },
      'km/h': { label: 'کیلومتر بر ساعت', factor: 0.2777778 },
      mph: { label: 'مایل بر ساعت', factor: 0.44704 },
    },
  },
  area: {
    label: 'مساحت',
    units: {
      m2: { label: 'متر مربع', factor: 1 },
      hectare: { label: 'هکتار', factor: 10000 },
      km2: { label: 'کیلومتر مربع', factor: 1000000 },
      acre: { label: 'ایکر (acre)', factor: 4046.8564224 },
    },
  },
  flow: {
    label: 'دبی (آب/باد)',
    units: {
      'm3/h': { label: 'متر مکعب بر ساعت', factor: 1 },
      'L/s': { label: 'لیتر بر ثانیه', factor: 3.6 },
      'm3/s': { label: 'متر مکعب بر ثانیه', factor: 3600 },
      cfm: { label: 'فوت مکعب بر دقیقه (CFM)', factor: 1.699010796 },
    },
  },
};

export function convertUnit(value, categoryKey, fromUnit, toUnit) {
  const cat = CONVERT_CATEGORIES[categoryKey];
  const from = cat.units[fromUnit];
  const to = cat.units[toUnit];
  return (value * from.factor) / to.factor;
}
