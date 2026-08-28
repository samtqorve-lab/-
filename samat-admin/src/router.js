// روتر بسیار ساده: به‌جای وابستگی به یک فریم‌ورک کامل، فقط وضعیت «تب فعال» و «بخش فعال»
// را نگه می‌دارد و هر تغییر را به تابع render اطلاع می‌دهد. برای این مقیاس پروژه کافی است؛
// اگر بعداً چند صفحه‌ی مستقل با URL واقعی نیاز شد، می‌توان به‌سادگی جایگزین با یک روتر واقعی کرد.

const state = {
  department: 'معدن', // معدن | صنعت | اکتشاف | فرآوری
  tab: 'dashboard',
  mineId: null, // شناسه‌ی رکورد انتخاب‌شده برای صفحه‌ی جزئیات
  assignedProvince: '',
  assignedCounty: '',
};

const listeners = new Set();

export function getState() {
  return { ...state };
}

export function setTab(tab) {
  state.tab = tab;
  state.mineId = null;
  emit();
}

export function setDepartment(dept) {
  state.department = dept;
  state.tab = 'dashboard';
  state.mineId = null;
  emit();
}

export function setMine(id) {
  state.mineId = id;
  state.tab = 'mineDetail';
  emit();
}

/** برای پرش از جست‌وجوی سراسری، وقتی رکورد هدف در بخش دیگری غیر از بخش فعلی است */
export function setMineInDept(id, department) {
  state.department = department;
  state.mineId = id;
  state.tab = 'mineDetail';
  emit();
}

export function setGeoScope(province, county) {
  state.assignedProvince = province || '';
  state.assignedCounty = county || '';
  emit();
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((fn) => fn(getState()));
}
