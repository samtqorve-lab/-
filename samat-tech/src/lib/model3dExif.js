// حفظ EXIF/XMP هنگام کوچک‌کردن عکس پهباد.
// کوچک‌کردن با canvas همه‌ی متادیتا (GPS، فاصله‌ی کانونی، XMP دی‌جی‌آی) را حذف می‌کند، ولی ODM برای
// مقیاس و سرعت تطبیق عکس‌ها به آن‌ها نیاز دارد. این توابع بخش‌های APP1 عکس اصلی را جدا می‌کنند،
// ابعاد/جهت را در EXIF اصلاح می‌کنند و در عکس کوچک‌شده تزریق می‌کنند.

const EXIF_MAGIC = 'Exif\0\0';
const XMP_MAGIC = 'http://ns.adobe.com/xap/1.0/\0';

function startsWithAscii(bytes, text) {
  if (bytes.length < text.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * بخش‌های APP1 (EXIF و XMP) یک JPEG را برمی‌گرداند. هر بخش شامل هدر FFE1 و طول است.
 * @param {Uint8Array} jpeg
 * @returns {{ kind: 'exif' | 'xmp', bytes: Uint8Array }[]}
 */
export function extractApp1Segments(jpeg) {
  if (jpeg.length < 4 || jpeg[0] !== 0xFF || jpeg[1] !== 0xD8) return [];
  const out = [];
  let hasExif = false;
  let hasXmp = false;
  let p = 2;
  while (p + 4 <= jpeg.length) {
    if (jpeg[p] !== 0xFF) break;
    const marker = jpeg[p + 1];
    if (marker === 0xDA || marker === 0xD9) break; // شروع داده‌ی تصویر یا پایان فایل
    if (marker === 0xFF) { p += 1; continue; } // بایت‌های پرکننده
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { p += 2; continue; }
    const len = (jpeg[p + 2] << 8) | jpeg[p + 3];
    if (len < 2 || p + 2 + len > jpeg.length) break;
    if (marker === 0xE1) {
      const seg = jpeg.subarray(p, p + 2 + len);
      const payload = seg.subarray(4);
      if (!hasExif && startsWithAscii(payload, EXIF_MAGIC)) {
        out.push({ kind: 'exif', bytes: seg.slice() });
        hasExif = true;
      } else if (!hasXmp && startsWithAscii(payload, XMP_MAGIC)) {
        out.push({ kind: 'xmp', bytes: seg.slice() });
        hasXmp = true;
      }
    }
    p += 2 + len;
  }
  // بخش EXIF باید اول بیاید (بعضی کتابخانه‌ها، از جمله بخشی از ODM، فقط اولین APP1 را می‌خوانند)
  out.sort((a, b) => (a.kind === 'exif' ? 0 : 1) - (b.kind === 'exif' ? 0 : 1));
  return out;
}

/**
 * ابعاد و جهت را در بخش EXIF اصلاح می‌کند (روی همان آرایه، درجا):
 *  - Orientation ← ۱ (چون پیکسل‌ها هنگام کوچک‌کردن قبلاً چرخانده شده‌اند)
 *  - ImageWidth/Length و PixelXDimension/PixelYDimension ← ابعاد جدید
 *  - FocalPlaneX/YResolution ← ضرب در scale (تا اندازه‌ی سنسور محاسبه‌شده توسط ODM درست بماند)
 * @param {Uint8Array} seg بخش کامل APP1 EXIF (شامل FFE1 و طول)
 * @param {{ width: number, height: number, scale: number }} dims
 */
export function patchExifSegment(seg, { width, height, scale }) {
  const tiff = 10; // FFE1 (2) + طول (2) + "Exif\0\0" (6)
  if (seg.length < tiff + 8) return seg;
  const isLE = seg[tiff] === 0x49 && seg[tiff + 1] === 0x49;
  const isBE = seg[tiff] === 0x4D && seg[tiff + 1] === 0x4D;
  if (!isLE && !isBE) return seg;
  const dv = new DataView(seg.buffer, seg.byteOffset, seg.byteLength);
  if (dv.getUint16(tiff + 2, isLE) !== 42) return seg;

  const inBounds = (off, n) => off >= 0 && off + n <= seg.length;
  const setSmallInt = (type, count, valueOff, v) => {
    if (count !== 1) return;
    if (type === 3 && v <= 0xFFFF) dv.setUint16(valueOff, v, isLE);
    else if (type === 4) dv.setUint32(valueOff, v, isLE);
  };
  const scaleRational = (type, count, valueOff) => {
    if (type !== 5 || count !== 1) return; // RATIONAL: مقدار در آفست ذخیره می‌شود
    const at = tiff + dv.getUint32(valueOff, isLE);
    if (!inBounds(at, 8)) return;
    const num = dv.getUint32(at, isLE);
    const scaled = Math.round(num * scale);
    if (scaled > 0 && scaled <= 0xFFFFFFFF) dv.setUint32(at, scaled, isLE);
  };
  const walk = (ifdRel, handler) => {
    const ifd = tiff + ifdRel;
    if (!inBounds(ifd, 2)) return;
    const n = dv.getUint16(ifd, isLE);
    for (let i = 0; i < n; i += 1) {
      const e = ifd + 2 + i * 12;
      if (!inBounds(e, 12)) return;
      handler(dv.getUint16(e, isLE), dv.getUint16(e + 2, isLE), dv.getUint32(e + 4, isLE), e + 8);
    }
  };

  let exifIfdRel = null;
  walk(dv.getUint32(tiff + 4, isLE), (tag, type, count, valueOff) => {
    if (tag === 0x0112) setSmallInt(3, count, valueOff, 1);
    else if (tag === 0x0100) setSmallInt(type, count, valueOff, width);
    else if (tag === 0x0101) setSmallInt(type, count, valueOff, height);
    else if (tag === 0x8769 && type === 4) exifIfdRel = dv.getUint32(valueOff, isLE);
  });
  if (exifIfdRel !== null) {
    walk(exifIfdRel, (tag, type, count, valueOff) => {
      if (tag === 0xA002) setSmallInt(type, count, valueOff, width);
      else if (tag === 0xA003) setSmallInt(type, count, valueOff, height);
      else if (tag === 0xA20E || tag === 0xA20F) scaleRational(type, count, valueOff);
    });
  }
  return seg;
}

/**
 * بخش‌های APP1 را بلافاصله بعد از SOI در یک JPEG (بدون EXIF) درج می‌کند.
 * @param {Uint8Array} jpeg
 * @param {Uint8Array[]} segments
 */
export function injectApp1Segments(jpeg, segments) {
  if (!segments.length || jpeg.length < 2 || jpeg[0] !== 0xFF || jpeg[1] !== 0xD8) return jpeg;
  const extra = segments.reduce((n, s) => n + s.length, 0);
  const out = new Uint8Array(jpeg.length + extra);
  out.set(jpeg.subarray(0, 2), 0);
  let off = 2;
  segments.forEach((s) => { out.set(s, off); off += s.length; });
  out.set(jpeg.subarray(2), off);
  return out;
}
