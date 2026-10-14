import backgroundAsset from '../assets/warranty-certificate.jpg';
import { latinDigits } from './brand';

export interface WarrantyCertificateData {
  certificateNumber: string;
  date: string;
  ownerName: string;
  ownerPhone: string;
  address: string;
  technicianName: string;
  technicianPhone: string;
  trader: string;
  rep: string;
  description: string;
  products: string;
}

type FieldKey = keyof WarrantyCertificateData;

interface FieldBox {
  key: FieldKey;
  left: number;
  right: number;
  dots: number;
}

const IMG_W = 993;
const IMG_H = 1184;
const PAGE_W_MM = 210;
const PAGE_H_MM = (PAGE_W_MM * IMG_H) / IMG_W;
const FONT_PX = 19;
const MIN_FONT_PX = 10;
const LIFT_PX = 3;
const PRINT_SCALE = 4;
const FONT_FAMILY = '"Cairo Variable", Cairo, "Segoe UI", Tahoma, sans-serif';

const FIELDS: FieldBox[] = [
  { key: 'certificateNumber', left: 470, right: 824, dots: 405 },
  { key: 'date', left: 52, right: 298, dots: 405 },
  { key: 'ownerName', left: 466, right: 826, dots: 450 },
  { key: 'ownerPhone', left: 50, right: 352, dots: 450 },
  { key: 'address', left: 54, right: 866, dots: 497 },
  { key: 'technicianName', left: 468, right: 828, dots: 543 },
  { key: 'technicianPhone', left: 50, right: 338, dots: 543 },
  { key: 'trader', left: 466, right: 766, dots: 589 },
  { key: 'rep', left: 50, right: 278, dots: 589 },
  { key: 'description', left: 464, right: 806, dots: 635 },
  { key: 'products', left: 53, right: 276, dots: 635 },
];

const PAPER_SHIFT: Partial<Record<FieldKey, { dx?: number; dy?: number }>> = {
  certificateNumber: { dx: -22 },
  ownerName: { dx: -22 },
  address: { dx: -22 },
  technicianName: { dy: -4 },
  technicianPhone: { dy: -4 },
  trader: { dy: -10 },
  rep: { dy: -10 },
  description: { dy: -12 },
  products: { dy: -12 },
};

const MM = IMG_W / PAGE_W_MM;
const A4_H_MM = 297;
const STUB_TOP_MM = 232;

const STUB_FIELDS: FieldBox[] = [
  { key: 'certificateNumber', left: 110 * MM, right: 172 * MM, dots: (237.6 - STUB_TOP_MM) * MM },
  { key: 'ownerName', left: 110 * MM, right: 170 * MM, dots: (246.4 - STUB_TOP_MM) * MM },
  { key: 'address', left: 12 * MM, right: 182 * MM, dots: (254.8 - STUB_TOP_MM) * MM },
  { key: 'technicianName', left: 110 * MM, right: 173 * MM, dots: (263.3 - STUB_TOP_MM) * MM },
  { key: 'trader', left: 110 * MM, right: 159 * MM, dots: (275.1 - STUB_TOP_MM) * MM },
  { key: 'description', left: 110 * MM, right: 168 * MM, dots: (283.6 - STUB_TOP_MM) * MM },
  { key: 'date', left: 10 * MM, right: 62 * MM, dots: (242.3 - STUB_TOP_MM) * MM },
  { key: 'ownerPhone', left: 10 * MM, right: 73 * MM, dots: (250.75 - STUB_TOP_MM) * MM },
  { key: 'technicianPhone', left: 10 * MM, right: 73 * MM, dots: (268.9 - STUB_TOP_MM) * MM },
  { key: 'rep', left: 10 * MM, right: 62 * MM, dots: (278.25 - STUB_TOP_MM) * MM },
  { key: 'products', left: 10 * MM, right: 62 * MM, dots: (286.7 - STUB_TOP_MM) * MM },
];

const CALIBRATION_KEY = 'warrantyCertificate.calibration';

interface Calibration { x: number; y: number; scale: number; stubX: number; stubY: number }

function loadCalibration(): Calibration {
  const base = { x: 0, y: 0, scale: 100, stubX: 0, stubY: 0 };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(CALIBRATION_KEY) || '{}') };
  } catch {
    return base;
  }
}

let measureCtx: CanvasRenderingContext2D | null = null;

function fontPx(text: string, width: number): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return FONT_PX;
  let size = FONT_PX;
  while (size > MIN_FONT_PX) {
    measureCtx.font = `700 ${size}px ${FONT_FAMILY}`;
    if (measureCtx.measureText(text).width <= width) break;
    size -= 1;
  }
  return size;
}

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function values(d: WarrantyCertificateData): Record<FieldKey, string> {
  const out = {} as Record<FieldKey, string>;
  (Object.keys(d) as FieldKey[]).forEach((k) => {
    out[k] = latinDigits(String(d[k] ?? '').trim());
  });
  return out;
}

let backgroundData: string | null = null;

async function background(): Promise<string> {
  if (backgroundData) return backgroundData;
  const blob = await (await fetch(backgroundAsset)).blob();
  backgroundData = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return backgroundData;
}

async function ensureFont(): Promise<void> {
  try {
    await document.fonts.load(`700 ${FONT_PX}px "Cairo Variable"`, 'شهادة 0123');
    await document.fonts.ready;
  } catch {
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function renderCanvas(
  d: WarrantyCertificateData, scale: number, withBackground: boolean,
  fields: FieldBox[] = FIELDS, heightPx: number = IMG_H,
): Promise<HTMLCanvasElement> {
  await ensureFont();
  const canvas = document.createElement('canvas');
  canvas.width = IMG_W * scale;
  canvas.height = heightPx * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  if (withBackground) {
    const img = await loadImage(await background());
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
  ctx.fillStyle = '#000';
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  const v = values(d);
  fields.forEach((field) => {
    const text = v[field.key];
    if (!text) return;
    const shift = withBackground || fields !== FIELDS ? {} : (PAPER_SHIFT[field.key] || {});
    const f = { ...field, left: field.left + (shift.dx || 0), right: field.right + (shift.dx || 0),
      dots: field.dots + (shift.dy || 0) };
    const width = f.right - f.left;
    const size = fontPx(text, width);
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.left * scale, (f.dots - 40) * scale, width * scale, 44 * scale);
    ctx.clip();
    ctx.font = `700 ${size * scale}px ${FONT_FAMILY}`;
    ctx.fillText(text, f.right * scale, (f.dots - LIFT_PX) * scale, width * scale);
    ctx.restore();
  });
  return canvas;
}

export async function printWarrantyCertificate(d: WarrantyCertificateData, title: string): Promise<void> {
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) return;
  const backgroundUrl = await background();
  const layer = (await renderCanvas(d, PRINT_SCALE, false)).toDataURL('image/png');
  const stubHeightMm = A4_H_MM - STUB_TOP_MM;
  const stub = (await renderCanvas(d, PRINT_SCALE, false, STUB_FIELDS, stubHeightMm * MM))
    .toDataURL('image/png');
  const cal = loadCalibration();
  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #888; font-family: Tahoma, sans-serif; }
  .sheet { position: relative; width: ${PAGE_W_MM}mm; height: ${A4_H_MM}mm; margin: 0 auto; background: #fff; overflow: hidden; }
  .cert { position: absolute; top: 0; right: 0; width: ${PAGE_W_MM}mm; height: ${PAGE_H_MM.toFixed(2)}mm; transform-origin: top right; }
  .cert img { position: absolute; inset: 0; width: 100%; height: 100%; }
  .stub { position: absolute; top: ${STUB_TOP_MM}mm; right: 0; width: ${PAGE_W_MM}mm; height: ${stubHeightMm}mm; }
  .stub img { width: 100%; height: 100%; }
  .bar { position: sticky; top: 0; z-index: 2; background: #fff; border-bottom: 1px solid #ccc; padding: 6px 10px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; font-size: 13px; }
  .bar label { display: inline-flex; gap: 4px; align-items: center; }
  .bar input { width: 64px; }
  .bar button { padding: 4px 14px; }
  @media print {
    html, body { background: #fff; }
    .sheet { margin: 0; }
    .bg, .bar { display: none; }
  }
</style></head>
<body>
<div class="bar">
  <b>ضبط الطباعة على الورق (مم)</b>
  <label>أفقي <input id="x" type="number" step="0.5" value="${cal.x}"></label>
  <label>رأسي <input id="y" type="number" step="0.5" value="${cal.y}"></label>
  <label>الحجم % <input id="scale" type="number" step="0.5" value="${cal.scale}"></label>
  <label>كعب الشهادة أفقي <input id="stubX" type="number" step="0.5" value="${cal.stubX}"></label>
  <label>كعب الشهادة رأسي <input id="stubY" type="number" step="0.5" value="${cal.stubY}"></label>
  <button id="go">طباعة</button>
</div>
<div class="sheet">
  <div class="cert" id="cert"><img class="bg" src="${backgroundUrl}" alt=""><img src="${layer}" alt=""></div>
  <div class="stub" id="stub"><img src="${stub}" alt=""></div>
</div>
<script>
  var KEY = ${JSON.stringify(CALIBRATION_KEY)};
  function num(id) { var v = parseFloat(document.getElementById(id).value); return isNaN(v) ? 0 : v; }
  function apply() {
    var c = { x: num('x'), y: num('y'), scale: num('scale') || 100, stubX: num('stubX'), stubY: num('stubY') };
    document.getElementById('cert').style.transform =
      'translate(' + (-c.x) + 'mm,' + c.y + 'mm) scale(' + (c.scale / 100) + ')';
    document.getElementById('stub').style.transform = 'translate(' + (-c.stubX) + 'mm,' + c.stubY + 'mm)';
    try { window.opener && window.opener.localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {}
  }
  ['x', 'y', 'scale', 'stubX', 'stubY'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', apply);
  });
  document.getElementById('go').addEventListener('click', function () { window.print(); });
  apply();
</script>
</body></html>`;
  win.document.write(html);
  win.document.close();
}

function dataUrlBytes(url: string): Uint8Array {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function buildPdf(jpeg: Uint8Array, pxW: number, pxH: number): Blob {
  const enc = new TextEncoder();
  const ptW = (PAGE_W_MM / 25.4) * 72;
  const ptH = (PAGE_H_MM / 25.4) * 72;
  const draw = `q ${ptW.toFixed(2)} 0 0 ${ptH.toFixed(2)} 0 0 cm /Im0 Do Q`;
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const obj = (body: string) => {
    offsets.push(length);
    push(`${offsets.length} 0 obj\n${body}\nendobj\n`);
  };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj('<< /Type /Catalog /Pages 2 0 R >>');
  obj('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW.toFixed(2)} ${ptH.toFixed(2)}] `
    + '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
  offsets.push(length);
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB `
    + `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push('\nendstream\nendobj\n');
  obj(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  const xref = length;
  push(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`);
  offsets.forEach((o) => push(`${String(o).padStart(10, '0')} 00000 n \n`));
  push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  parts.forEach((p) => { out.set(p, at); at += p.length; });
  return new Blob([out], { type: 'application/pdf' });
}

export async function exportWarrantyCertificatePdf(d: WarrantyCertificateData, fileName: string): Promise<void> {
  const canvas = await renderCanvas(d, 2, true);
  const jpeg = dataUrlBytes(canvas.toDataURL('image/jpeg', 0.9));
  const blob = buildPdf(jpeg, canvas.width, canvas.height);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.replace(/[\\/:*?"<>|]/g, '-');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
