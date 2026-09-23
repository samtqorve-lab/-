// سازندهٔ اشیاء Three.js برای نمایش سه‌بعدی طراحی پله + رمپ + زمین طبیعی.
//
// عمداً بدون هیچ وابستگی به DOM یا import مستقیم 'three' نوشته شده — نمونهٔ THREE از بیرون
// (توسط pitDesign3DViewer.js، پس از dynamic import) تزریق می‌شود، دقیقاً مثل الگوی موجود در
// model3dViewer.js، تا کتابخانهٔ سنگین Three.js فقط هنگام باز شدن نمایشگر لود شود.
//
// دستگاه مختصات صحنه: X به سمت شرق، Z به سمت بالا (ارتفاع)، Y رو به شمالِ منفی — یعنی
// (x_utm, y_utm, z_utm) → (x_utm - ox, z_utm - oz, -(y_utm - oy))، با origin=(ox,oy,oz) از
// computeOrigin. همهٔ سازنده‌های این فایل از همین تبدیل استفاده می‌کنند تا زمین/پله/رمپ دقیقاً
// هم‌مقیاس و هم‌مبدأ بمانند (چون هر سه از همان مختصات UTM طراحی پله می‌آیند، بر‌خلاف مدل GLB
// پهباد که افست واقعی‌اش در پایپ‌لاین فعلی ذخیره نمی‌شود — به همین دلیل این یک صحنهٔ مجزاست،
// نه overlay روی مدل GLB؛ به README مربوطه مراجعه کنید).

export function computeOrigin(surface) {
  return [
    (surface.bbox.minX + surface.bbox.maxX) / 2,
    (surface.bbox.minY + surface.bbox.maxY) / 2,
    surface.bbox.minZ,
  ];
}

function toScene(origin, x, y, z) {
  return [x - origin[0], z - origin[2], -(y - origin[1])];
}

function ringObject(THREE, poly, z, origin, color, linewidth = 1) {
  const pts = poly.map(([x, y]) => new THREE.Vector3(...toScene(origin, x, y, z)));
  pts.push(pts[0].clone());
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  // توجه: THREE.LineBasicMaterial روی اکثر مرورگرها linewidth را نادیده می‌گیرد (محدودیت
  // شناخته‌شدهٔ WebGL)؛ اینجا فقط برای مستندسازی نیت نگه داشته شده، تفکیک بصری اصلی از رنگ می‌آید.
  return new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color, linewidth }));
}

/**
 * نوار مثلثی بین دو حلقهٔ هم‌تعداد-رأس با تناظر یک‌به‌یک (خروجی offsetPolygonOutward این تناظر را
 * حفظ می‌کند — نگاه کنید به توضیح بالای آن تابع در pitDesign.js).
 */
function quadStrip(THREE, ringA, zA, ringB, zB, origin, color, opacity = 1) {
  if (ringA.length !== ringB.length) return null;
  const n = ringA.length;
  const positions = [];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const pa0 = toScene(origin, ringA[i][0], ringA[i][1], zA);
    const pa1 = toScene(origin, ringA[j][0], ringA[j][1], zA);
    const pb0 = toScene(origin, ringB[i][0], ringB[i][1], zB);
    const pb1 = toScene(origin, ringB[j][0], ringB[j][1], zB);
    positions.push(...pa0, ...pb0, ...pb1, ...pa0, ...pb1, ...pa1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.MeshBasicMaterial({
    color, side: THREE.DoubleSide, transparent: opacity < 1, opacity,
  });
  return new THREE.Mesh(geo, mat);
}

/**
 * گروه سه‌بعدی کل پله‌بندی: برای هر پله سینهٔ شیب‌دار (قهوه‌ای) + خط لبهٔ هر تراز؛ برمِ تخت
 * (زرد/خاکی) فقط روی ترازهایی که واقعاً کاچ‌بنچ هستند (isCatchBench) کشیده می‌شود — در کاچ‌بنچ
 * چندتایی، پله‌های میانی بدون برم مستقیم روی هم می‌نشینند (تمایز شیب بین‌رمپی/IRA از شیب کلی/OSA
 * که در pitDesign.js توضیح داده شده). لبهٔ کاچ‌بنچ‌ها با رنگ متفاوت از پله‌های میانی مشخص می‌شود،
 * و لبهٔ نهایی (برون‌زد به سطح) رنگ جداگانه دارد.
 */
export function buildBenchesGroup(THREE, designResult, origin) {
  const group = new THREE.Group();
  const benches = designResult.benches;
  for (let i = 1; i < benches.length; i += 1) {
    const lower = benches[i - 1];
    const upper = benches[i];
    if (upper.faceTopPolygon) {
      const face = quadStrip(THREE, lower.polygon, lower.elevation, upper.faceTopPolygon, upper.elevation, origin, 0x8a5a3c);
      if (face) group.add(face); // سینهٔ پله (ریزر)
      if (upper.isCatchBench) {
        const berm = quadStrip(THREE, upper.faceTopPolygon, upper.elevation, upper.polygon, upper.elevation, origin, 0xb7a66e, 0.92);
        if (berm) group.add(berm); // برم (تِرد) — فقط روی کاچ‌بنچ واقعی
      }
    }
    let color = 0x555349; // پلهٔ میانی (بدون برم)، خاکستری کم‌رنگ
    if (upper.outcropped) color = 0xffcf5c; // برون‌زد نهایی به سطح
    else if (upper.isCatchBench) color = 0x2b2a24; // لبهٔ کاچ‌بنچ، تیره و پررنگ
    group.add(ringObject(THREE, upper.polygon, upper.elevation, origin, color, upper.isCatchBench ? 2 : 1));
  }
  group.add(ringObject(THREE, benches[0].polygon, benches[0].elevation, origin, 0x2b2a24, 2));
  return group;
}

/** گروه سه‌بعدی رمپ/جاده: یک نوار (ribbon) بین لبهٔ چپ/راست + خط محور مرکزی به‌عنوان راهنما. */
export function buildRampGroup(THREE, rampResult, origin, color = 0x6f7686) {
  const group = new THREE.Group();
  const { leftEdge, rightEdge, centerline } = rampResult;
  const positions = [];
  for (let i = 0; i < leftEdge.length - 1; i += 1) {
    const l0 = toScene(origin, leftEdge[i].x, leftEdge[i].y, leftEdge[i].z);
    const l1 = toScene(origin, leftEdge[i + 1].x, leftEdge[i + 1].y, leftEdge[i + 1].z);
    const r0 = toScene(origin, rightEdge[i].x, rightEdge[i].y, rightEdge[i].z);
    const r1 = toScene(origin, rightEdge[i + 1].x, rightEdge[i + 1].y, rightEdge[i + 1].z);
    positions.push(...l0, ...r0, ...r1, ...l0, ...r1, ...l1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })));

  const centerPts = centerline.map((p) => {
    const [x, y, z] = toScene(origin, p.x, p.y, p.z);
    return new THREE.Vector3(x, y + 0.2, z); // کمی بالاتر از رویهٔ جاده تا زیر آن دفن نشود
  });
  const centerLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(centerPts),
    new THREE.LineBasicMaterial({ color: 0xffe08a }),
  );
  group.add(centerLine);
  return group;
}

/** مشِ زمین طبیعی، مستقیماً از همان مثلث‌بندی TIN که pitDesign.js برای محاسبه استفاده می‌کند. */
export function buildTerrainMesh(THREE, surface, origin, opts = {}) {
  const { color = 0x6f7d5a, opacity = 0.55 } = opts;
  const count = surface.zvals.length;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const [x, y, z] = toScene(origin, surface.coordsFlat[i * 2], surface.coordsFlat[i * 2 + 1], surface.zvals[i]);
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(Array.from(surface.triangles));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, side: THREE.DoubleSide, transparent: opacity < 1, opacity,
  }));
}
