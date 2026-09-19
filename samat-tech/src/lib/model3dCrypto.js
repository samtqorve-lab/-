// رمزنگاری/رمزگشایی فرمت S3D1 (AES-256-GCM تکه‌تکه) — دقیقاً سازگار با scripts/s3d.py در ریپوی samat-3d.
//
// ساختار فایل:
//   ۴ بایت  "S3D1"
//   ۸ بایت  پیشوند تصادفی nonce
//   ۴ بایت  اندازه‌ی chunk متن ساده (big-endian)
//   chunkها: هرکدام = خروجی AES-GCM (متن رمزشده + ۱۶ بایت tag)
// nonce هر chunk = پیشوند + شماره‌ی chunk (uint32 big-endian)
// AAD هر chunk = شماره‌ی chunk (uint32) + پرچم «آخرین chunk» (۱ بایت) — برای تشخیص فایل ناقص

const MAGIC = [0x53, 0x33, 0x44, 0x31]; // "S3D1"
const CHUNK = 4 * 1024 * 1024;
const TAG_BYTES = 16;
const MAX_CHUNK = 64 * 1024 * 1024;

const subtle = () => globalThis.crypto.subtle;

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export async function importKey(keyB64) {
  const raw = b64ToBytes(keyB64);
  if (raw.length !== 32) throw new Error('کلید رمزنگاری نامعتبر است');
  return subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function nonceFor(prefix, index) {
  const nonce = new Uint8Array(12);
  nonce.set(prefix, 0);
  new DataView(nonce.buffer).setUint32(8, index, false);
  return nonce;
}

function aadFor(index, isFinal) {
  const aad = new Uint8Array(5);
  new DataView(aad.buffer).setUint32(0, index, false);
  aad[4] = isFinal ? 1 : 0;
  return aad;
}

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  parts.forEach((p) => { out.set(p, off); off += p.length; });
  return out;
}

/** @param {Uint8Array} bytes @param {CryptoKey} key @returns {Promise<Uint8Array>} */
export async function encryptBytes(bytes, key) {
  const prefix = globalThis.crypto.getRandomValues(new Uint8Array(8));
  const head = new Uint8Array(16);
  head.set(MAGIC, 0);
  head.set(prefix, 4);
  new DataView(head.buffer).setUint32(12, CHUNK, false);

  const parts = [head];
  const nChunks = Math.max(1, Math.ceil(bytes.length / CHUNK));
  for (let i = 0; i < nChunks; i += 1) {
    const plain = bytes.subarray(i * CHUNK, Math.min(bytes.length, (i + 1) * CHUNK));
    // eslint-disable-next-line no-await-in-loop
    const ct = await subtle().encrypt(
      { name: 'AES-GCM', iv: nonceFor(prefix, i), additionalData: aadFor(i, i === nChunks - 1), tagLength: 128 },
      key,
      plain,
    );
    parts.push(new Uint8Array(ct));
  }
  return concat(parts);
}

/** @param {Uint8Array} bytes @param {CryptoKey} key @returns {Promise<Uint8Array>} */
export async function decryptBytes(bytes, key) {
  if (bytes.length < 16 + TAG_BYTES || MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new Error('فایل رمزشده نامعتبر است');
  }
  const prefix = bytes.subarray(4, 12);
  const chunk = new DataView(bytes.buffer, bytes.byteOffset + 12, 4).getUint32(0, false);
  if (!chunk || chunk > MAX_CHUNK) throw new Error('فایل رمزشده نامعتبر است');

  const size = chunk + TAG_BYTES;
  const body = bytes.subarray(16);
  const nChunks = Math.ceil(body.length / size);
  const parts = [];
  try {
    for (let i = 0; i < nChunks; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const pt = await subtle().decrypt(
        { name: 'AES-GCM', iv: nonceFor(prefix, i), additionalData: aadFor(i, i === nChunks - 1), tagLength: 128 },
        key,
        body.subarray(i * size, Math.min(body.length, (i + 1) * size)),
      );
      parts.push(new Uint8Array(pt));
    }
  } catch {
    throw new Error('رمزگشایی ناموفق بود (کلید یا فایل نامعتبر/ناقص است)');
  }
  return concat(parts);
}

/**
 * چند فایل را در یک بسته‌ی ساده (قبل از رمزنگاری) کنار هم می‌گذارد تا تعداد آپلودها به GitHub کم شود.
 * ساختار: "S3DB" + تعداد(uint32) + برای هر فایل: طول نام(uint16) + نام(UTF-8) + طول داده(uint32) + داده
 * (scripts/s3d.py در ریپوی samat-3d همین را باز می‌کند.)
 * @param {{ name: string, bytes: Uint8Array }[]} items
 */
export function buildBundle(items) {
  const enc = new TextEncoder();
  const names = items.map((it) => enc.encode(it.name));
  let total = 8;
  items.forEach((it, i) => { total += 2 + names[i].length + 4 + it.bytes.length; });
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set([0x53, 0x33, 0x44, 0x42], 0); // "S3DB"
  dv.setUint32(4, items.length, false);
  let off = 8;
  items.forEach((it, i) => {
    dv.setUint16(off, names[i].length, false); off += 2;
    out.set(names[i], off); off += names[i].length;
    dv.setUint32(off, it.bytes.length, false); off += 4;
    out.set(it.bytes, off); off += it.bytes.length;
  });
  return out;
}
