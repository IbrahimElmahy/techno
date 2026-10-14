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
  base: number;
}

const IMG_W = 993;
const IMG_H = 1184;
const PAGE_W_MM = 210;
const PAGE_H_MM = (PAGE_W_MM * IMG_H) / IMG_W;
const FONT_PX = 19;
const MIN_FONT_PX = 11;
const FONT_FAMILY = '"Cairo Variable", Cairo, "Segoe UI", Tahoma, sans-serif';

const FIELDS: FieldBox[] = [
  { key: 'certificateNumber', left: 470, right: 817, base: 407 },
  { key: 'date', left: 52, right: 280, base: 407 },
  { key: 'ownerName', left: 466, right: 830, base: 453 },
  { key: 'ownerPhone', left: 52, right: 349, base: 453 },
  { key: 'address', left: 52, right: 857, base: 498 },
  { key: 'technicianName', left: 467, right: 813, base: 544 },
  { key: 'technicianPhone', left: 52, right: 337, base: 544 },
  { key: 'trader', left: 465, right: 766, base: 590 },
  { key: 'rep', left: 52, right: 264, base: 590 },
  { key: 'description', left: 464, right: 789, base: 636 },
  { key: 'products', left: 52, right: 260, base: 636 },
];

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

export async function printWarrantyCertificate(d: WarrantyCertificateData, title: string): Promise<void> {
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) return;
  await ensureFont();
  const backgroundUrl = await background();
  const v = values(d);
  const mm = PAGE_W_MM / IMG_W;
  const fields = FIELDS.map((f) => {
    const text = v[f.key];
    if (!text) return '';
    const width = f.right - f.left;
    const size = fontPx(text, width);
    const top = f.base - size * 1.27;
    return `<div class="f" style="left:${(f.left * mm).toFixed(2)}mm;top:${(top * mm).toFixed(2)}mm;`
      + `width:${(width * mm).toFixed(2)}mm;font-size:${(size * mm).toFixed(2)}mm">${esc(text)}</div>`;
  }).join('');
  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #888; }
  body { font-family: ${FONT_FAMILY}; color: #000; }
  .page { position: relative; width: ${PAGE_W_MM}mm; height: ${PAGE_H_MM.toFixed(2)}mm; margin: 0 auto; background: #fff; overflow: hidden; }
  .bg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .f { position: absolute; font-weight: 700; line-height: 1.6; text-align: right; white-space: nowrap; overflow: hidden; unicode-bidi: plaintext; }
  @media print {
    html, body { background: #fff; }
    .page { margin: 0; }
    .bg { display: none; }
  }
</style></head>
<body><div class="page"><img class="bg" src="${backgroundUrl}" alt="">${fields}</div>
<script>
  window.onload = function () {
    var go = function () { window.print(); };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(go); else go();
  };
</script>
</body></html>`;
  win.document.write(html);
  win.document.close();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function renderCanvas(d: WarrantyCertificateData, scale: number): Promise<HTMLCanvasElement> {
  await ensureFont();
  const img = await loadImage(await background());
  const canvas = document.createElement('canvas');
  canvas.width = IMG_W * scale;
  canvas.height = IMG_H * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  const v = values(d);
  FIELDS.forEach((f) => {
    const text = v[f.key];
    if (!text) return;
    const size = fontPx(text, f.right - f.left);
    ctx.font = `700 ${size * scale}px ${FONT_FAMILY}`;
    ctx.fillText(text, f.right * scale, (f.base - size * 0.1) * scale, (f.right - f.left) * scale);
  });
  return canvas;
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
  const canvas = await renderCanvas(d, 2);
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
