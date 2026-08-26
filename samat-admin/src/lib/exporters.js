import { getMineCorners } from './geo.js';
import { ensureXLSX } from './xlsxLoader.js';

export function exportCSV(rows, filename) {
  const keys = [...new Set(rows.flatMap((m) => Object.keys(m)))].filter((k) => k !== '_rowId');
  const csvRows = [keys.join(','), ...rows.map((m) => keys.map((k) => `"${String(m[k] || '').replace(/"/g, '""')}"`).join(','))];
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function hexToKmlColor(hex, alpha) {
  const h = (hex || '#999999').replace('#', '');
  return `${alpha || 'ff'}${h.substring(4, 6)}${h.substring(2, 4)}${h.substring(0, 2)}`; // KML = aabbggrr
}

export function exportAllKML(rows, nameField, catColors, filename, descBuilder) {
  let placemarks = '';
  let count = 0;
  rows.forEach((m) => {
    const name = (m[nameField] || 'بدون نام').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const cat = m['دسته'] || 'غیره';
    const color = (catColors[cat] || catColors['غیره'] || { badge: '#6B6250' }).badge;
    const desc = descBuilder(m).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const points = getMineCorners(m);
    if (points.length >= 3) {
      const ring = points.concat([points[0]]);
      const coordsStr = ring.map((p) => `${p[1]},${p[0]},0`).join(' ');
      placemarks += `<Placemark><name>${name}</name><description>${desc}</description>`
        + `<Style><LineStyle><color>${hexToKmlColor(color, 'ff')}</color><width>2</width></LineStyle>`
        + `<PolyStyle><color>${hexToKmlColor(color, '4d')}</color></PolyStyle></Style>`
        + `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordsStr}</coordinates></LinearRing></outerBoundaryIs></Polygon>`
        + '</Placemark>';
      count++;
    }
  });
  if (!count) return 0;
  const kml = '<?xml version="1.0" encoding="UTF-8"?>'
    + `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${filename}</name>${placemarks}</Document></kml>`;
  const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}.kml`;
  a.click();
  return count;
}

/**
 * برخلاف exportCSV (که متن فارسی داخل اکسل به‌خوبی باز نمی‌شود و ستون‌بندی/راست‌به‌چپ ندارد)،
 * این خروجی واقعی .xlsx می‌سازد — با همان کتابخانه‌ی SheetJS که برای ایمپورت هم استفاده می‌شود
 * (از CDN رسمی لود می‌شود، نه npm — دلیلش در xlsxLoader.js توضیح داده شده).
 */
export async function exportXLSX(rows, filename, sheetName = 'Sheet1') {
  const XLSX = await ensureXLSX();
  const keys = [...new Set(rows.flatMap((m) => Object.keys(m)))].filter((k) => k !== '_rowId');
  const plainRows = rows.map((r) => {
    const o = {};
    keys.forEach((k) => { o[k] = r[k] ?? ''; });
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(plainRows, { header: keys });
  ws['!cols'] = keys.map((k) => ({ wch: Math.min(40, Math.max(10, k.length + 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
