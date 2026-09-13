/**
 * محاسبات زمین‌شناسی مهندسی: رده‌بندی توده‌سنگ (RMR بر پایه‌ی Bieniawski 1989)، محاسبه‌ی RQD از
 * روی مغزه‌ی حفاری، و تحلیل جنبشی ساده‌ی گسیختگی شیب (صفحه‌ای/گوه‌ای/واژگونی) بر پایه‌ی روش
 * کلاسیک Hoek & Bray. همه‌ی این‌ها ابزار غربالگری اولیه‌اند، نه جایگزین بررسی زمین‌شناس/مهندس
 * ژئوتکنیک با داده‌ی میدانی کامل (استریونت واقعی، آزمایش برشی مستقیم و...).
 */

// ————————————————————————— RQD از روی مغزه‌ی حفاری —————————————————————————
export function calcRQDFromCore(totalRunLengthM, sumIntactPiecesOver10cmM) {
  if (!(totalRunLengthM > 0)) throw new Error('طول کل مغزه باید بزرگ‌تر از صفر باشد');
  const rqd = Math.min(100, (sumIntactPiecesOver10cmM / totalRunLengthM) * 100);
  return { rqd };
}

// ————————————————————————— رده‌بندی توده‌سنگ RMR (Bieniawski 1989) —————————————————————————
function ratingUCS(mpa) {
  if (mpa > 250) return 15; if (mpa > 100) return 12; if (mpa > 50) return 7;
  if (mpa > 25) return 4; if (mpa > 5) return 2; if (mpa > 1) return 1; return 0;
}
function ratingRQD(rqd) {
  if (rqd >= 90) return 20; if (rqd >= 75) return 17; if (rqd >= 50) return 13;
  if (rqd >= 25) return 8; return 3;
}
function ratingSpacing(mm) {
  if (mm > 2000) return 20; if (mm > 600) return 15; if (mm > 200) return 10;
  if (mm > 60) return 8; return 5;
}
export const RMR_CONDITION_OPTIONS = {
  veryGood: { label: 'بسیار زبر، ناپیوسته، بدون فاصله، دیواره تازه (هوازده‌نشده)', score: 30 },
  good: { label: 'کمی زبر، فاصله زیر ۱ میلی‌متر، کمی هوازده', score: 25 },
  fair: { label: 'کمی زبر، فاصله زیر ۱ میلی‌متر، به‌شدت هوازده', score: 20 },
  poor: { label: 'سطح صیقلی (Slickensided) یا گوژ زیر ۵ میلی‌متر یا فاصله ۱ تا ۵ میلی‌متر', score: 10 },
  veryPoor: { label: 'گوژ نرم بیش از ۵ میلی‌متر یا فاصله بیش از ۵ میلی‌متر', score: 0 },
};
export const RMR_WATER_OPTIONS = {
  dry: { label: 'کاملاً خشک', score: 15 },
  damp: { label: 'مرطوب', score: 10 },
  wet: { label: 'خیس', score: 7 },
  dripping: { label: 'چکه‌کننده', score: 4 },
  flowing: { label: 'جاری', score: 0 },
};

/** برای هر رده، بازه‌ی معمول چسبندگی/زاویه‌ی اصطکاک توده‌سنگ (برای استفاده در ابزار پایداری شیب) */
const RMR_CLASS_TABLE = [
  { min: 81, label: 'رده I — سنگ بسیار خوب', cohesionKpa: '> ۴۰۰', frictionDeg: '> ۴۵' },
  { min: 61, label: 'رده II — سنگ خوب', cohesionKpa: '۳۰۰ تا ۴۰۰', frictionDeg: '۳۵ تا ۴۵' },
  { min: 41, label: 'رده III — سنگ متوسط', cohesionKpa: '۲۰۰ تا ۳۰۰', frictionDeg: '۲۵ تا ۳۵' },
  { min: 21, label: 'رده IV — سنگ ضعیف', cohesionKpa: '۱۰۰ تا ۲۰۰', frictionDeg: '۱۵ تا ۲۵' },
  { min: 0, label: 'رده V — سنگ بسیار ضعیف', cohesionKpa: '< ۱۰۰', frictionDeg: '< ۱۵' },
];

export function calcRMR(p) {
  const r1 = ratingUCS(p.ucsMpa);
  const r2 = ratingRQD(p.rqdPercent);
  const r3 = ratingSpacing(p.spacingMm);
  const r4 = RMR_CONDITION_OPTIONS[p.conditionKey].score;
  const r5 = RMR_WATER_OPTIONS[p.waterKey].score;
  const total = r1 + r2 + r3 + r4 + r5;
  const cls = RMR_CLASS_TABLE.find((c) => total >= c.min);
  return { r1, r2, r3, r4, r5, total, ...cls };
}

// ————————————————————————— تحلیل جنبشی ساده‌ی گسیختگی شیب —————————————————————————
function angleDiffCircular(a, b) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/**
 * بررسی گسیختگی صفحه‌ای و واژگونی برای یک درزه، و گسیختگی گوه‌ای برای هر جفت درزه — طبق معیارهای
 * کلاسیک Hoek & Bray (Rock Slope Engineering). این یک غربالگری سریع است؛ تحلیل قطعی نیازمند
 * استریونت کامل با چند خانواده‌ی درزه و داده‌ی میدانی است.
 */
export function checkKinematics(p) {
  const { slopeDipDir, slopeDipAngle, frictionDeg, joints } = p;
  const perJoint = joints.map((j, i) => {
    const dirDiff = angleDiffCircular(j.dipDir, slopeDipDir);
    const oppositeDirDiff = angleDiffCircular(j.dipDir, (slopeDipDir + 180) % 360);
    const planar = dirDiff <= 20 && j.dipAngle < slopeDipAngle && j.dipAngle > frictionDeg;
    const toppling = oppositeDirDiff <= 20 && j.dipAngle > (90 - slopeDipAngle + frictionDeg);
    return { index: i + 1, dirDiff, oppositeDirDiff, planar, toppling };
  });

  const wedges = [];
  for (let i = 0; i < joints.length; i += 1) {
    for (let k = i + 1; k < joints.length; k += 1) {
      const j1 = joints[i]; const j2 = joints[k];
      const toRad = (d) => (d * Math.PI) / 180;
      const normal = (j) => {
        const a = toRad(j.dipDir); const d = toRad(j.dipAngle);
        return [Math.sin(d) * Math.sin(a), Math.sin(d) * Math.cos(a), Math.cos(d)];
      };
      const n1 = normal(j1); const n2 = normal(j2);
      let v = [
        n1[1] * n2[2] - n1[2] * n2[1],
        n1[2] * n2[0] - n1[0] * n2[2],
        n1[0] * n2[1] - n1[1] * n2[0],
      ];
      const mag = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
      if (mag < 1e-9) continue; // درزه‌ها موازی‌اند، خط تقاطعی وجود ندارد
      v = v.map((c) => c / mag);
      if (v[2] > 0) v = v.map((c) => -c); // خط باید رو به پایین باشد (پلانژ مثبت)
      const plunge = (Math.asin(-v[2]) * 180) / Math.PI;
      let trend = (Math.atan2(v[0], v[1]) * 180) / Math.PI;
      if (trend < 0) trend += 360;
      const dirDiff = angleDiffCircular(trend, slopeDipDir);
      const wedgeFail = dirDiff <= 45 && plunge < slopeDipAngle && plunge > frictionDeg;
      wedges.push({ pair: `${i + 1}-${k + 1}`, plunge, trend, wedgeFail });
    }
  }

  return { perJoint, wedges };
}
