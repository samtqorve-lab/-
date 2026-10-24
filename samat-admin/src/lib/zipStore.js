// نویسنده‌ی ساده‌ی ZIP بدون فشرده‌سازی (store) — فقط توابع خالص، بدون DOM و بدون وابستگی.
// برای بسته‌بندی خروجی OBJ (obj + mtl + بافت) در یک فایل؛ JPEG خودش فشرده است و متن OBJ هم با
// فشرده‌سازی کمی کوچک می‌شود، ولی ساده‌بودن و پشتیبانی همه‌ی ابزارها مهم‌تر است.
// محدودیت: ZIP64 پشتیبانی نمی‌شود (هر فایل و کل بسته باید زیر ۴ گیگابایت باشد).

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    CRC_TABLE[n] = c >>> 0;
  }
  return CRC_TABLE;
}

/** CRC-32 تدریجی: crc32Update(0, bytes) سپس با خروجی قبلی ادامه دهید. */
export function crc32Update(crc, bytes) {
  const t = crcTable();
  let c = (crc ^ 0xFFFFFFFF) >>> 0;
  for (let i = 0; i < bytes.length; i += 1) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export const crc32 = (bytes) => crc32Update(0, bytes);

function dosDateTime(date) {
  const d = date instanceof Date ? date : new Date();
  const year = Math.max(1980, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const day = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xFFFF, day: day & 0xFFFF };
}

/**
 * @param {Array<{ name: string, chunks: Uint8Array[] }>} entries نام فایل (ASCII/UTF-8) و تکه‌های بایتیِ محتوا
 * @param {{ date?: Date }} [opts]
 * @returns {Blob} فایل ZIP (type: application/zip)
 */
export function buildZip(entries, { date = new Date() } = {}) {
  const enc = new TextEncoder();
  const { time, day } = dosDateTime(date);
  const parts = [];
  const central = [];
  let offset = 0;

  entries.forEach((entry) => {
    const nameBytes = enc.encode(entry.name);
    let size = 0;
    let crc = 0;
    entry.chunks.forEach((c) => { size += c.length; crc = crc32Update(crc, c); });
    if (size >= 0xFFFFFFFF || offset >= 0xFFFFFFFF) throw new Error('حجم فایل برای ZIP بیش از حد بزرگ است');

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034B50, true);
    local.setUint16(4, 20, true); // نسخه‌ی لازم
    local.setUint16(6, 0x0800, true); // نام UTF-8
    local.setUint16(8, 0, true); // store
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, ...entry.chunks);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014B50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, day, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, 0, true);
    cd.setUint16(32, 0, true);
    cd.setUint16(34, 0, true);
    cd.setUint16(36, 0, true);
    cd.setUint32(38, 0, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);

    offset += 30 + nameBytes.length + size;
  });

  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054B50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
