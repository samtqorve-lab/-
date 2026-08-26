import Delaunator from 'delaunator';

function buildTriIndex(coordsFlat, triangles, minX, minY, maxX, maxY) {
  const cells = 40;
  const cw = (maxX - minX) / cells || 1;
  const ch = (maxY - minY) / cells || 1;
  const grid = new Map();
  const triCount = triangles.length / 3;
  for (let t = 0; t < triCount; t += 1) {
    const i0 = triangles[t * 3]; const i1 = triangles[t * 3 + 1]; const i2 = triangles[t * 3 + 2];
    const x0 = coordsFlat[i0 * 2]; const y0 = coordsFlat[i0 * 2 + 1];
    const x1 = coordsFlat[i1 * 2]; const y1 = coordsFlat[i1 * 2 + 1];
    const x2 = coordsFlat[i2 * 2]; const y2 = coordsFlat[i2 * 2 + 1];
    const tminX = Math.min(x0, x1, x2); const tmaxX = Math.max(x0, x1, x2);
    const tminY = Math.min(y0, y1, y2); const tmaxY = Math.max(y0, y1, y2);
    const cx0 = Math.max(0, Math.min(cells - 1, Math.floor((tminX - minX) / cw)));
    const cx1 = Math.max(0, Math.min(cells - 1, Math.floor((tmaxX - minX) / cw)));
    const cy0 = Math.max(0, Math.min(cells - 1, Math.floor((tminY - minY) / ch)));
    const cy1 = Math.max(0, Math.min(cells - 1, Math.floor((tmaxY - minY) / ch)));
    for (let cy = cy0; cy <= cy1; cy += 1) {
      for (let cx = cx0; cx <= cx1; cx += 1) {
        const key = cy * cells + cx;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(t);
      }
    }
  }
  return {
    grid, cells, cw, ch, minX, minY,
  };
}

function baryCoords(px, py, x0, y0, x1, y1, x2, y2) {
  const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  if (Math.abs(d) < 1e-12) return null;
  const l0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / d;
  const l1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / d;
  const l2 = 1 - l0 - l1;
  return [l0, l1, l2];
}

function interpolateZ(idx, coordsFlat, triangles, zvals, px, py) {
  const cx = Math.min(idx.cells - 1, Math.max(0, Math.floor((px - idx.minX) / idx.cw)));
  const cy = Math.min(idx.cells - 1, Math.max(0, Math.floor((py - idx.minY) / idx.ch)));
  const cand = idx.grid.get(cy * idx.cells + cx);
  if (!cand) return NaN;
  const eps = -1e-7;
  for (const t of cand) {
    const i0 = triangles[t * 3]; const i1 = triangles[t * 3 + 1]; const i2 = triangles[t * 3 + 2];
    const x0 = coordsFlat[i0 * 2]; const y0 = coordsFlat[i0 * 2 + 1];
    const x1 = coordsFlat[i1 * 2]; const y1 = coordsFlat[i1 * 2 + 1];
    const x2 = coordsFlat[i2 * 2]; const y2 = coordsFlat[i2 * 2 + 1];
    const bc = baryCoords(px, py, x0, y0, x1, y1, x2, y2);
    if (!bc) continue;
    const [l0, l1, l2] = bc;
    if (l0 >= eps && l1 >= eps && l2 >= eps) return l0 * zvals[i0] + l1 * zvals[i1] + l2 * zvals[i2];
  }
  return NaN;
}

function triangleArea2D(x0, y0, x1, y1, x2, y2) {
  return Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) / 2;
}

/**
 * محاسبه حجم کات/فیل به روش مثلث‌بندی دلونی (TIN): هر دو سطح جداگانه مثلث‌بندی می‌شوند،
 * سپس روی یک شبکه محاسباتی مشترک (اجتماع نقاط XY هر دو سطح در محدوده‌ی هم‌پوشان) ارتفاع هر دو
 * سطح میان‌یابی و حجم منشوری هر مثلث مشترک جمع زده می‌شود — دقیق‌تر از میانگین‌گیری شبکه‌ای ساده.
 */
export async function computeTinVolume(ptsPrev, ptsCurr) {
  if (!ptsPrev.length || !ptsCurr.length) throw new Error('نقطه‌ای در یکی از فایل‌ها یافت نشد');

  function dedupe(pts) {
    const seen = new Set(); const out = [];
    pts.forEach((p) => {
      const key = `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
      if (!seen.has(key)) { seen.add(key); out.push(p); }
    });
    return out;
  }
  const ptsA = dedupe(ptsPrev); const ptsB = dedupe(ptsCurr);
  if (ptsA.length < 3 || ptsB.length < 3) throw new Error('برای مثلث‌بندی حداقل ۳ نقطه غیرهم‌خط در هر نقشه لازم است');

  const bboxOf = (pts) => {
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    pts.forEach(([x, y]) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    });
    return {
      minX, maxX, minY, maxY,
    };
  };
  const bA = bboxOf(ptsA); const bB = bboxOf(ptsB);
  const minX = Math.max(bA.minX, bB.minX); const maxX = Math.min(bA.maxX, bB.maxX);
  const minY = Math.max(bA.minY, bB.minY); const maxY = Math.min(bA.maxY, bB.maxY);
  if (!(maxX > minX) || !(maxY > minY)) throw new Error('محدوده مشترکی بین دو نقشه یافت نشد — مطمئن شوید هر دو فایل مختصات یکسانی دارند (مثلاً هر دو UTM)');

  const coordsA = new Float64Array(ptsA.length * 2);
  ptsA.forEach((p, i) => { coordsA[i * 2] = p[0]; coordsA[i * 2 + 1] = p[1]; });
  const zA = ptsA.map((p) => p[2]);
  const delA = new Delaunator(coordsA);
  const idxA = buildTriIndex(coordsA, delA.triangles, bA.minX, bA.minY, bA.maxX, bA.maxY);

  const coordsB = new Float64Array(ptsB.length * 2);
  ptsB.forEach((p, i) => { coordsB[i * 2] = p[0]; coordsB[i * 2 + 1] = p[1]; });
  const zB = ptsB.map((p) => p[2]);
  const delB = new Delaunator(coordsB);
  const idxB = buildTriIndex(coordsB, delB.triangles, bB.minX, bB.minY, bB.maxX, bB.maxY);

  const mergedMap = new Map();
  const addMerged = (x, y) => {
    const key = `${x.toFixed(4)},${y.toFixed(4)}`;
    if (!mergedMap.has(key)) mergedMap.set(key, [x, y]);
  };
  ptsA.forEach(([x, y]) => { if (x >= minX && x <= maxX && y >= minY && y <= maxY) addMerged(x, y); });
  ptsB.forEach(([x, y]) => { if (x >= minX && x <= maxX && y >= minY && y <= maxY) addMerged(x, y); });
  const merged = Array.from(mergedMap.values());
  if (merged.length < 3) throw new Error('تعداد نقاط مشترک برای مثلث‌بندی کافی نیست');

  const coordsM = new Float64Array(merged.length * 2);
  merged.forEach((p, i) => { coordsM[i * 2] = p[0]; coordsM[i * 2 + 1] = p[1]; });
  const delM = new Delaunator(coordsM);

  const zAatMerged = new Float64Array(merged.length).fill(NaN);
  const zBatMerged = new Float64Array(merged.length).fill(NaN);
  for (let i = 0; i < merged.length; i += 1) {
    const [x, y] = merged[i];
    zAatMerged[i] = interpolateZ(idxA, coordsA, delA.triangles, zA, x, y);
    zBatMerged[i] = interpolateZ(idxB, coordsB, delB.triangles, zB, x, y);
  }

  let cutVolume = 0; let fillVolume = 0; let cellCount = 0;
  const triangles = [];
  const triCount = delM.triangles.length / 3;
  for (let t = 0; t < triCount; t += 1) {
    const i0 = delM.triangles[t * 3]; const i1 = delM.triangles[t * 3 + 1]; const i2 = delM.triangles[t * 3 + 2];
    const zA0 = zAatMerged[i0]; const zA1 = zAatMerged[i1]; const zA2 = zAatMerged[i2];
    const zB0 = zBatMerged[i0]; const zB1 = zBatMerged[i1]; const zB2 = zBatMerged[i2];
    if ([zA0, zA1, zA2, zB0, zB1, zB2].some(Number.isNaN)) continue;
    const x0 = coordsM[i0 * 2]; const y0 = coordsM[i0 * 2 + 1];
    const x1 = coordsM[i1 * 2]; const y1 = coordsM[i1 * 2 + 1];
    const x2 = coordsM[i2 * 2]; const y2 = coordsM[i2 * 2 + 1];
    const area = triangleArea2D(x0, y0, x1, y1, x2, y2);
    if (area <= 0) continue;
    const dAvg = ((zB0 - zA0) + (zB1 - zA1) + (zB2 - zA2)) / 3;
    const vol = area * dAvg;
    if (vol < 0) cutVolume += Math.abs(vol); else fillVolume += vol;
    cellCount += 1;
    triangles.push({
      x0, y0, x1, y1, x2, y2, d: dAvg,
    });
  }
  if (cellCount === 0) throw new Error('هیچ مثلث مشترکی بین دو سطح یافت نشد — محدوده هم‌پوشانی را بررسی کنید');

  return {
    method: 'tin', minX, minY, maxX, maxY, triangles, cutVolume, fillVolume, netVolume: fillVolume - cutVolume, cellCount,
  };
}

export function renderVolumeHeatmap(canvas, grid) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width; const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#E4DFD2'; ctx.fillRect(0, 0, W, H);
  const {
    minX, minY, maxX, maxY, triangles,
  } = grid;
  const extentX = (maxX - minX) || 1; const extentY = (maxY - minY) || 1;
  let maxAbs = 0;
  triangles.forEach((tr) => { maxAbs = Math.max(maxAbs, Math.abs(tr.d)); });
  if (maxAbs === 0) maxAbs = 1;
  const toX = (x) => ((x - minX) / extentX) * W;
  const toY = (y) => H - ((y - minY) / extentY) * H;
  triangles.forEach((tr) => {
    const t = Math.min(1, Math.abs(tr.d) / maxAbs);
    let color;
    if (tr.d < -1e-6) color = `rgb(255,${Math.round(255 * (1 - t))},${Math.round(255 * (1 - t))})`;
    else if (tr.d > 1e-6) color = `rgb(${Math.round(255 * (1 - t))},${Math.round(255 * (1 - t))},255)`;
    else color = '#ffffff';
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(toX(tr.x0), toY(tr.y0));
    ctx.lineTo(toX(tr.x1), toY(tr.y1));
    ctx.lineTo(toX(tr.x2), toY(tr.y2));
    ctx.closePath();
    ctx.fill();
  });
}
