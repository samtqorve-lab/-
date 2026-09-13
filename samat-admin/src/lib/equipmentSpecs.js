/**
 * فهرست مرجع مشخصات فنی رایج‌ترین ماشین‌آلات معدنی — برای استفاده‌ی سریع هنگام برآورد اولیه
 * (مثلاً انتخاب نوع بیل متناسب با ظرفیت کامیون، یا تخمین توان مورد نیاز حفاری).
 * ⚠️ اعداد، مقادیر نمونه/معمول رده‌ی هر مدل هستند (گرد‌شده، بر مبنای اطلاعات عمومی منتشرشده)،
 * نه مشخصات دقیق و به‌روزِ هر پیکربندی خاص — برای مناقصه/خرید/محاسبه‌ی دقیق حتماً به بروشور فنی
 * رسمی سازنده (Spec Sheet) و سال ساخت واقعی دستگاه مراجعه شود.
 */
export const EQUIPMENT_CATEGORIES = [
  'بیل مکانیکی (اکسکاواتور)',
  'لودر چرخ‌لاستیکی',
  'کامیون معدنی (دامپتراک)',
  'دستگاه حفاری',
  'بولدوزر',
  'گریدر',
];

export const EQUIPMENT_LIST = [
  // بیل مکانیکی
  { category: 'بیل مکانیکی (اکسکاواتور)', model: 'Caterpillar 320', powerKw: 122, weightTon: 20, capacity: '1.0 m³ (باکت)', note: 'بیل متوسط، پرکاربرد در معادن کوچک/متوسط' },
  { category: 'بیل مکانیکی (اکسکاواتور)', model: 'Caterpillar 6015', powerKw: 400, weightTon: 150, capacity: '9 m³ (باکت)', note: 'بیل معدنی بزرگ، بارگیری کامیون‌های سنگین' },
  { category: 'بیل مکانیکی (اکسکاواتور)', model: 'Komatsu PC1250', powerKw: 505, weightTon: 113, capacity: '6.3 m³ (باکت)', note: 'بیل هیدرولیک سنگین معدنی' },
  { category: 'بیل مکانیکی (اکسکاواتور)', model: 'Hitachi EX1200', powerKw: 522, weightTon: 118, capacity: '6.5 m³ (باکت)', note: 'بیل هیدرولیک سنگین معدنی' },
  // لودر
  { category: 'لودر چرخ‌لاستیکی', model: 'Caterpillar 950', powerKw: 158, weightTon: 18, capacity: '2.7 m³ (باکت)', note: 'لودر متوسط، بارگیری و جابجایی مواد در کارخانه' },
  { category: 'لودر چرخ‌لاستیکی', model: 'Caterpillar 980', powerKw: 250, weightTon: 30, capacity: '5.0 m³ (باکت)', note: 'لودر سنگین معدنی' },
  { category: 'لودر چرخ‌لاستیکی', model: 'Komatsu WA500', powerKw: 260, weightTon: 32, capacity: '5.2 m³ (باکت)', note: 'لودر سنگین معدنی' },
  { category: 'لودر چرخ‌لاستیکی', model: 'Volvo L120', powerKw: 173, weightTon: 19, capacity: '2.9 m³ (باکت)', note: 'لودر متوسط چندمنظوره' },
  // کامیون معدنی
  { category: 'کامیون معدنی (دامپتراک)', model: 'Caterpillar 773', powerKw: 410, weightTon: 65, capacity: '40 تن (بار مفید)', note: 'دامپتراک صلب، معادن روباز متوسط' },
  { category: 'کامیون معدنی (دامپتراک)', model: 'Caterpillar 777', powerKw: 641, weightTon: 100, capacity: '91 تن (بار مفید)', note: 'دامپتراک معدنی سنگین رایج' },
  { category: 'کامیون معدنی (دامپتراک)', model: 'Caterpillar 793', powerKw: 1864, weightTon: 246, capacity: '227 تن (بار مفید)', note: 'دامپتراک فوق‌سنگین معادن بزرگ' },
  { category: 'کامیون معدنی (دامپتراک)', model: 'Komatsu HD785', powerKw: 706, weightTon: 101, capacity: '91 تن (بار مفید)', note: 'دامپتراک معدنی سنگین' },
  { category: 'کامیون معدنی (دامپتراک)', model: 'Volvo A40', powerKw: 331, weightTon: 30, capacity: '39 تن (بار مفید)', note: 'کامیون مفصلی (Articulated)، مناسب مسیرهای صعب' },
  // دستگاه حفاری
  { category: 'دستگاه حفاری', model: 'Atlas Copco ROC L8', powerKw: 250, weightTon: 30, capacity: 'قطر چال ۸۹–۱۶۵ mm', note: 'دستگاه حفاری چرخشی-ضربه‌ای سطحی' },
  { category: 'دستگاه حفاری', model: 'Sandvik DP1500i', powerKw: 261, weightTon: 32, capacity: 'قطر چال ۹۰–۱۵۲ mm', note: 'دستگاه حفاری هیدرولیک سطحی' },
  { category: 'دستگاه حفاری', model: 'Furukawa HCR1500', powerKw: 130, weightTon: 15, capacity: 'قطر چال ۷۶–۱۲۷ mm', note: 'دستگاه حفاری چرخ‌زنجیری سبک‌تر' },
  // بولدوزر
  { category: 'بولدوزر', model: 'Caterpillar D8', powerKw: 235, weightTon: 38, capacity: 'تیغه ۴.۵ m³', note: 'بولدوزر سنگین رایج معدنی' },
  { category: 'بولدوزر', model: 'Caterpillar D10', powerKw: 433, weightTon: 68, capacity: 'تیغه ۹.۵ m³', note: 'بولدوزر فوق‌سنگین' },
  { category: 'بولدوزر', model: 'Komatsu D155', powerKw: 279, weightTon: 39, capacity: 'تیغه ۵.۷ m³', note: 'بولدوزر سنگین معدنی' },
  // گریدر
  { category: 'گریدر', model: 'Caterpillar 140', powerKw: 130, weightTon: 14, capacity: 'تیغه ۳.۷ m طول', note: 'گریدر متوسط، تسطیح جاده‌های معدن' },
  { category: 'گریدر', model: 'Caterpillar 16', powerKw: 250, weightTon: 26, capacity: 'تیغه ۵.۴ m طول', note: 'گریدر سنگین معدنی' },
];
