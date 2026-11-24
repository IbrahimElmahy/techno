import { Modal, message } from 'antd';

let sharing = false;

export function isSharing(): boolean {
  return sharing;
}

export async function shareVia(run?: () => unknown): Promise<void> {
  if (!run) return;
  sharing = true;
  try {
    await run();
  } finally {
    sharing = false;
  }
}

function waPhone(raw?: string | null): string {
  const d = (raw || '').replace(/[^\d]/g, '');
  if (!d) return '';
  if (d.startsWith('20')) return d;
  if (d.startsWith('0')) return `2${d}`;
  if (d.length === 10 && d.startsWith('1')) return `20${d}`;
  return d;
}

async function renderPdf(html: string, name: string): Promise<File> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'), import('jspdf')]);
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;';
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();
    await new Promise((r) => (doc.readyState === 'complete' ? r(null) : frame.addEventListener('load', r, { once: true })));
    await (doc as any).fonts?.ready;
    const canvas = await html2canvas(doc.body, {
      scale: 2, backgroundColor: '#ffffff', useCORS: true, windowWidth: 794,
    });
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const margin = 7;
    const width = 210 - margin * 2;
    const pageH = 297 - margin * 2;
    const slicePx = Math.floor((pageH * canvas.width) / width);
    for (let y = 0, page = 0; y < canvas.height; y += slicePx, page += 1) {
      const part = document.createElement('canvas');
      part.width = canvas.width;
      part.height = Math.min(slicePx, canvas.height - y);
      part.getContext('2d')!.drawImage(canvas, 0, -y);
      if (page) pdf.addPage();
      pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, width,
        (part.height * width) / canvas.width);
    }
    return new File([pdf.output('blob')], `${name}.pdf`, { type: 'application/pdf' });
  } finally {
    frame.remove();
  }
}

function fallback(file: File, phone: string, text: string): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
  message.info('تم تنزيل الملف، أرفقه في محادثة واتساب.', 6);
}

async function send(file: File, phone: string, text: string): Promise<void> {
  const nav = navigator as any;
  if (!nav.canShare?.({ files: [file] })) {
    fallback(file, phone, text);
    return;
  }
  try {
    await nav.share({ files: [file], title: text, text });
  } catch (err: any) {
    if (err?.name === 'AbortError') return;
    if (err?.name === 'NotAllowedError') {
      Modal.confirm({
        title: 'الملف جاهز للإرسال',
        content: file.name,
        okText: 'مشاركة',
        cancelText: 'إلغاء',
        onOk: () => nav.share({ files: [file], title: text, text }).catch((e: any) => {
          if (e?.name !== 'AbortError') fallback(file, phone, text);
        }),
      });
      return;
    }
    fallback(file, phone, text);
  }
}

export async function sharePdf(
  html: string, name: string, text: string, phone?: string | null,
): Promise<void> {
  const hide = message.loading('جاري تجهيز الملف…', 0);
  let file: File;
  try {
    file = await renderPdf(html, name.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'document');
  } catch {
    hide();
    message.error('تعذر تجهيز الملف.');
    return;
  }
  hide();
  await send(file, waPhone(phone), text);
}
