export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (e) => resolve(e.target.result);
    r.onerror = reject;
    r.readAsText(file);
  });
}

export function getFileExt(name) {
  const m = String(name || '').match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}

export function parseXYZText(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const points = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/[,;\t ]+/).filter((s) => s.length);
    if (parts.length < 3) continue;
    const x = parseFloat(parts[0]); const y = parseFloat(parts[1]); const z = parseFloat(parts[2]);
    if (!Number.isNaN(x) && !Number.isNaN(y) && !Number.isNaN(z)) points.push([x, y, z]);
  }
  return points;
}

export function parseKMLPoints(text) {
  const dom = new DOMParser().parseFromString(text, 'text/xml');
  const coordNodes = dom.getElementsByTagName('coordinates');
  const points = [];
  for (let i = 0; i < coordNodes.length; i += 1) {
    const raw = (coordNodes[i].textContent || '').trim();
    raw.split(/\s+/).forEach((t) => {
      const parts = t.split(',');
      if (parts.length >= 2) {
        const lon = parseFloat(parts[0]); const lat = parseFloat(parts[1]);
        const alt = parts.length >= 3 ? parseFloat(parts[2]) : 0;
        if (!Number.isNaN(lon) && !Number.isNaN(lat)) points.push([lon, lat, Number.isNaN(alt) ? 0 : alt]);
      }
    });
  }
  return points;
}

export function parseLandXMLPoints(text) {
  const dom = new DOMParser().parseFromString(text, 'text/xml');
  const pElems = dom.getElementsByTagName('P');
  const idToPoint = {};
  const points = [];
  for (let i = 0; i < pElems.length; i += 1) {
    const node = pElems[i];
    const id = node.getAttribute('id') || node.getAttribute('name') || `_${i}`;
    const parts = (node.textContent || '').trim().split(/\s+/).map(Number);
    if (parts.length >= 3 && parts.every((n) => !Number.isNaN(n))) {
      const pt = [parts[1], parts[0], parts[2]]; // قرارداد LandXML: Northing Easting Elevation
      idToPoint[id] = pt;
      points.push(pt);
    }
  }
  const fElems = dom.getElementsByTagName('F');
  for (let i = 0; i < fElems.length; i += 1) {
    const ids = (fElems[i].textContent || '').trim().split(/\s+/);
    if (ids.length >= 3) {
      const A = idToPoint[ids[0]]; const B = idToPoint[ids[1]]; const C = idToPoint[ids[2]];
      if (A && B && C) {
        const N = 4;
        for (let ii = 1; ii < N; ii += 1) {
          for (let jj = 1; jj < N - ii; jj += 1) {
            const u = ii / N; const v = jj / N; const w = 1 - u - v;
            points.push([A[0] * w + B[0] * u + C[0] * v, A[1] * w + B[1] * u + C[1] * v, A[2] * w + B[2] * u + C[2] * v]);
          }
        }
      }
    }
  }
  return points;
}

function parseDXFPoints(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const points = [];
  let currentEntity = null;
  let cur = {};

  function flushEntity() {
    if (!currentEntity) return;
    if (currentEntity === 'POINT') {
      if (cur['10'] != null && cur['20'] != null) points.push([parseFloat(cur['10']), parseFloat(cur['20']), parseFloat(cur['30'] || 0)]);
    } else if (currentEntity === '3DFACE' || currentEntity === 'FACE3D') {
      const vkeys = [['10', '20', '30'], ['11', '21', '31'], ['12', '22', '32'], ['13', '23', '33']];
      const verts = [];
      const seen = new Set();
      vkeys.forEach(([xk, yk, zk]) => {
        if (cur[xk] != null && cur[yk] != null) {
          const p = [parseFloat(cur[xk]), parseFloat(cur[yk]), parseFloat(cur[zk] || 0)];
          const key = `${p[0]},${p[1]},${p[2]}`;
          if (!seen.has(key)) { seen.add(key); verts.push(p); points.push(p); }
        }
      });
      if (verts.length >= 3) {
        const [A, B, C] = verts;
        const N = 4;
        for (let i = 1; i < N; i += 1) {
          for (let j = 1; j < N - i; j += 1) {
            const u = i / N; const v = j / N; const w = 1 - u - v;
            points.push([A[0] * w + B[0] * u + C[0] * v, A[1] * w + B[1] * u + C[1] * v, A[2] * w + B[2] * u + C[2] * v]);
          }
        }
      }
    }
  }

  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = lines[i].trim();
    const value = lines[i + 1] != null ? lines[i + 1].trim() : '';
    if (code === '0') { flushEntity(); currentEntity = value; cur = {}; } else { cur[code] = value; }
  }
  flushEntity();
  return points.filter((p) => !Number.isNaN(p[0]) && !Number.isNaN(p[1]) && !Number.isNaN(p[2]));
}

/**
 * توجه: فرمت باینری SHP در این نسخه پشتیبانی نمی‌شود (فقط txt/csv/xyz/asc، dxf، kml، xml/landxml).
 * اگر فایل SHP دارید، آن را در نرم‌افزار GIS خود به یکی از این فرمت‌ها خروجی بگیرید.
 */
export async function extractPointsFromFile(file) {
  const ext = getFileExt(file.name);
  if (ext === 'shp') throw new Error('فرمت SHP در این نسخه پشتیبانی نمی‌شود — فایل را به DXF یا KML یا LandXML خروجی بگیرید');
  const text = await readFileAsText(file);
  if (ext === 'dxf') return parseDXFPoints(text);
  if (ext === 'kml') return parseKMLPoints(text);
  if (ext === 'xml' || ext === 'landxml') return parseLandXMLPoints(text);
  if (ext === 'txt' || ext === 'csv' || ext === 'xyz' || ext === 'asc') return parseXYZText(text);
  const head = text.slice(0, 500);
  if (head.includes('<LandXML') || head.includes('<Pnts')) return parseLandXMLPoints(text);
  if (head.includes('<kml')) return parseKMLPoints(text);
  if (/^\s*0\s*[\r\n]+SECTION/.test(text)) return parseDXFPoints(text);
  return parseXYZText(text);
}
