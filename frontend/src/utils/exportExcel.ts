/**
 * تصدير Excel — ملف `.xlsx` حقيقي، من غير مكتبة.
 *
 * جنب الملف ده `exportCsv.ts`، وهو شغّال وهيفضل شغّال. لكن الـCSV بيوصل لسقف بيوقّفه في تلات
 * حاجات المحاسب بيحتاجها كل يوم:
 *
 *   - **الأرقام بتنزل نصوص.** الملف بيتقرا صح، بس `SUM` على عمود المبالغ بيطلع صفر — لأن كل
 *     خانة متقوّسة، وExcel بيقراها كلمة مش رقم. اللي بيصدّر كشف حساب بيصدّره عشان يجمّعه.
 *   - **الورقة بتتفتح من الشمال.** برنامج كله عربي بيطلّع ملف أعمدته بالمقلوب.
 *   - **الـBOM ورطة دايمة.** ماشية معانا هنا، بس أي حد بيفتح الملف في محرر ويحفظه بيضيّعها
 *     والعربي بيتكسّر. في xlsx النص UTF-8 جوّه XML — مافيش ترميز محلي يغلط فيه أصلاً.
 *
 * **ليه من غير مكتبة؟** لأن اللي إحنا محتاجينه شبكة مربعات مسطّحة، و`xlsx` أو `exceljs` بيضيفوا
 * ميجا أو اتنين على حزمة Electron عشان قدرات (صيغ، رسوم، قراءة ملفات موجودة) مش هنلمسها. وملف
 * الـxlsx في الآخر ZIP جوّاه شوية XML — والجزء الوحيد اللي محتاج شغل فيه هو الـZIP، وهو تحت
 * مئة سطر لما تكتبه STORE من غير ضغط. فالثمن هنا أرخص من التبعية.
 */

/* ─── ZIP ────────────────────────────────────────────────────────────────── */

/**
 * جدول CRC32 — بيتحسب مرة واحدة أول ما يتطلب.
 *
 * كل مدخل في الـZIP لازم يشيل تجزئة محتواه؛ لو غلط Excel بيقول «الملف تالف» من غير ما يفتحه.
 */
let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry { name: string; data: Uint8Array }

/**
 * ZIP بطريقة STORE — من غير ضغط.
 *
 * الضغط كان هيحتاج deflate بالإيد أو مكتبة، والمكسب إن ملف الألف صف بيبقى نص ميجا بدل ميجا —
 * ملف بينزل على الجهاز ويتفتح على طول، مش حاجة بتتبعت على الشبكة. Excel بيفتح المدخل غير
 * المضغوط عادي، فالضغط تعقيد بيتدفع تمنه من غير مقابل.
 */
function zip(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);   // النسخة المطلوبة
    lv.setUint16(6, 0, true);    // أعلام
    lv.setUint16(8, 0, true);    // STORE
    lv.setUint16(10, 0, true);   // وقت التعديل — ثابت، عشان نفس الجدول يطلع نفس الملف
    lv.setUint16(12, 0x21, true); // تاريخ التعديل: 1980-01-01، أقدم تاريخ الصيغة بتشيله
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    locals.push(local, entry.data);
    centrals.push(central);
    offset += local.length + size;
  }

  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  // القطع بتتلزق في مخزن واحد بدل ما تتبعت لـ`Blob` كقايمة. `TextEncoder` بيرجّع مخزن نوعه
  // `ArrayBufferLike` — ممكن يبقى مشترك — و`Blob` مابيقبلش غير `ArrayBuffer` صريح، فالنسخ هنا
  // هو اللي بيحسم النوع، ومعاه بنبطّل نفرد مصفوفة كبيرة في نداء الدالة.
  const parts = [...locals, ...centrals, end];
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }

  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/* ─── قراءة القيم ────────────────────────────────────────────────────────── */

/** عمود في الملف: عنوانه، وإزاي بنطلع قيمته من الصف. */
export interface ExcelColumn<T = any> {
  title: string;
  value: keyof T | ((row: T) => unknown);
}

/**
 * نص رقمي بيتحوّل رقم — بس اللي يرجع زي ما هو.
 *
 * الـAPI بيرجّع المبالغ `DECIMAL` كنصوص («1234.50»)، ولو نزلت نصوص مايتجمعش عليها في Excel،
 * وده أول سبب حد بيصدّر كشف أصلاً.
 *
 * لكن مش كل اللي شكله رقم رقم: «0001» رقم مستند و«01001234567» تليفون، والاتنين لو اتحوّلوا
 * بيخسروا الصفر اللي قدّامهم ويبقوا غلط بصمت. فالصفر البادئ بيستني نص، والأرقام الطويلة (فوق
 * ١٥ خانة) كمان — لأن `Number` مابيشيلش دقتها وبيقرّبها.
 */
const NUMERIC = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** تاريخ ISO بالشكل اللي الـAPI بيرجّعه، بساعة أو من غيرها. */
const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

type Cell =
  | { kind: 'blank' }
  | { kind: 'number'; value: number }
  | { kind: 'date'; serial: number; withTime: boolean }
  | { kind: 'bool'; value: boolean }
  | { kind: 'text'; value: string };

/**
 * تسلسل تاريخ Excel: عدد الأيام من 1899-12-30.
 *
 * بنحسبه من أرقام النص نفسه مش من `Date` محلي — الجدول بيعرض «2026-09-02»، ولو عدّينا على
 * منطقة زمنية اليوم ممكن يزحف يوم قبل أو بعد، فيبقى الملف مش نفس اللي على الشاشة.
 */
function toSerial(y: number, m: number, d: number, hh: number, mm: number, ss: number): number {
  const days = Date.UTC(y, m - 1, d) / 86400000 - Date.UTC(1899, 11, 30) / 86400000;
  return days + (hh * 3600 + mm * 60 + ss) / 86400;
}

function classify(raw: unknown): Cell {
  if (raw === null || raw === undefined || raw === '') return { kind: 'blank' };
  if (typeof raw === 'boolean') return { kind: 'bool', value: raw };
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { kind: 'number', value: raw } : { kind: 'blank' };
  }
  if (raw instanceof Date) {
    return {
      kind: 'date',
      serial: toSerial(raw.getFullYear(), raw.getMonth() + 1, raw.getDate(),
        raw.getHours(), raw.getMinutes(), raw.getSeconds()),
      withTime: raw.getHours() !== 0 || raw.getMinutes() !== 0,
    };
  }

  const text = String(raw).trim();
  const iso = ISO_DATE.exec(text);
  if (iso) {
    const [, y, m, d, hh, mm, ss] = iso;
    return {
      kind: 'date',
      serial: toSerial(+y, +m, +d, +(hh ?? 0), +(mm ?? 0), +(ss ?? 0)),
      withTime: hh !== undefined,
    };
  }
  if (NUMERIC.test(text) && text.replace(/[-.]/g, '').length <= 15) {
    return { kind: 'number', value: Number(text) };
  }
  return { kind: 'text', value: String(raw) };
}

function valueOf<T>(row: T, column: ExcelColumn<T>): unknown {
  return typeof column.value === 'function'
    ? (column.value as (r: T) => unknown)(row)
    : (row as any)[column.value];
}

/* ─── بناء الملف ─────────────────────────────────────────────────────────── */

function esc(text: string): string {
  // بنشيل محارف التحكم اللي XML مابيسمحش بيها — بتيجي أحياناً في ملاحظات متلزّقة من مكان تاني،
  // وواحد منها بيخلّي Excel يرفض الملف كله.
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** رقم عمود → حرفه: 1→A، 27→AA. */
function colName(index: number): string {
  let n = index;
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - rem) / 26);
  }
  return name;
}

/** ورقة واحدة اسمها مقبول: Excel بيرفض `[]:*?/\` وبيقف عند ٣١ حرف. */
function sheetName(name: string): string {
  const clean = name.replace(/[[\]:*?/\\]/g, ' ').trim() || 'ورقة';
  return clean.slice(0, 31);
}

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/**
 * الأنماط: عنوان عريض، وتاريخ، وتاريخ بساعة، ومبلغ بمنزلتين.
 *
 * المبلغ بياخد `#,##0.00` بس لما يبقى فيه كسر — عدد الفواتير `12` يفضل `12`، والمبلغ `1234.5`
 * يبقى `1,234.50` زي ما هو مكتوب في الفاتورة. والاتنين لسه أرقام بيتجمع عليهم.
 */
const STYLES = `${HEAD}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3">
<numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/>
<numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/>
<numFmt numFmtId="166" formatCode="#,##0.00"/>
</numFmts>
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF1F1F1F"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF0F0F0"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cellXml(ref: string, cell: Cell): string {
  switch (cell.kind) {
    case 'blank':
      return '';
    case 'number':
      return Number.isInteger(cell.value)
        ? `<c r="${ref}"><v>${cell.value}</v></c>`
        : `<c r="${ref}" s="4"><v>${cell.value}</v></c>`;
    case 'date':
      return `<c r="${ref}" s="${cell.withTime ? 3 : 2}"><v>${cell.serial}</v></c>`;
    case 'bool':
      return `<c r="${ref}" t="b"><v>${cell.value ? 1 : 0}</v></c>`;
    default:
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(cell.value)}</t></is></c>`;
  }
}

/**
 * الورقة نفسها.
 *
 * `rightToLeft` هو كل الفرق بين ملف من برنامج عربي وملف مقلوب: أول عمود بيبقى على اليمين
 * وشريط التمرير من الشمال، زي الجدول اللي الواحد صدّر منه بالظبط.
 */
function sheetXml(columns: ExcelColumn[], cells: Cell[][], widths: number[]): string {
  const lastCol = colName(columns.length || 1);
  const lastRow = cells.length + 1;

  const head = columns
    .map((c, i) => `<c r="${colName(i + 1)}1" s="1" t="inlineStr"><is><t xml:space="preserve">${esc(c.title)}</t></is></c>`)
    .join('');

  const body = cells
    .map((row, r) => {
      const inner = row.map((cell, i) => cellXml(`${colName(i + 1)}${r + 2}`, cell)).join('');
      return `<row r="${r + 2}">${inner}</row>`;
    })
    .join('');

  const cols = widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('');

  return `${HEAD}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${lastCol}${lastRow}"/>
<sheetViews><sheetView rightToLeft="1" tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${cols ? `<cols>${cols}</cols>` : ''}
<sheetData><row r="1">${head}</row>${body}</sheetData>
<autoFilter ref="A1:${lastCol}${lastRow}"/>
</worksheet>`;
}

/**
 * عرض العمود بيتحسب من أطول محتوى فيه.
 *
 * الافتراضي بيقطع أي عنوان عربي بعد حرفين وبيملا العمود `####` لو رقم — يعني اللي بيفتح الملف
 * لازم يوسّع كل عمود بإيده قبل ما يقراه. بنقيس أول ٢٠٠ صف بس: الألف صف اللي بعدهم مش بيغيّروا
 * الأقصى غالباً، والقياس الكامل بيبوّظ سرعة التصدير على الكشوف الكبيرة.
 */
function widthOf(column: ExcelColumn, rows: any[], cells: Cell[][], index: number): number {
  let longest = String(column.title ?? '').length;
  const limit = Math.min(cells.length, 200);
  for (let r = 0; r < limit; r += 1) {
    const cell = cells[r][index];
    const len = cell.kind === 'text' ? cell.value.length
      : cell.kind === 'date' ? (cell.withTime ? 16 : 10)
      : cell.kind === 'number' ? String(cell.value).length + 2
      : 0;
    if (len > longest) longest = len;
  }
  return Math.min(50, Math.max(9, longest + 2));
}

/** بيبني الملف من غير ما ينزّله — عشان يتقرا ويتختبر. */
export function buildXlsx<T>(
  columns: ExcelColumn<T>[],
  rows: T[],
  sheet = 'البيانات',
): Blob {
  const cells = (rows || []).map((row) => columns.map((c) => classify(valueOf(row, c))));
  const widths = columns.map((c, i) => widthOf(c, rows, cells, i));
  const name = sheetName(sheet);
  const ref = `'${name.replace(/'/g, "''")}'!$A$1:$${colName(columns.length || 1)}$${cells.length + 1}`;

  const enc = new TextEncoder();
  const file = (path: string, xml: string): ZipEntry => ({ name: path, data: enc.encode(xml) });

  return zip([
    file('[Content_Types].xml', `${HEAD}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    file('_rels/.rels', `${HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    file('xl/workbook.xml', `${HEAD}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${esc(name)}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${esc(ref)}</definedName></definedNames>
</workbook>`),
    file('xl/_rels/workbook.xml.rels', `${HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    file('xl/styles.xml', STYLES),
    file('xl/worksheets/sheet1.xml', sheetXml(columns as ExcelColumn[], cells, widths)),
  ]);
}

/** اسم الملف: الاسم العربي زي ما هو + تاريخ اليوم. */
export function excelFilename(name: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  // الشرطة المائلة والنقطتين ممنوعين في أسماء ملفات ويندوز؛ العربي نفسه عادي.
  const clean = name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'تصدير';
  return `${clean}-${today}.xlsx`;
}

export function downloadXlsx(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  anchor.click();
  // نفس الغلطة اللي كانت في نسخ الـCSV: من غير السطر ده الـblob بيفضل في الذاكرة طول عمر التبويب.
  URL.revokeObjectURL(url);
}

/** التصدير كله في سطر واحد. */
export function exportExcel<T>(
  name: string,
  columns: ExcelColumn<T>[],
  rows: T[],
  sheet?: string,
): void {
  downloadXlsx(excelFilename(name), buildXlsx(columns, rows, sheet ?? name));
}

/**
 * أعمدة الجدول زي ما هي على الشاشة → أعمدة الملف.
 *
 * الملف لازم يبقى اللي الواحد شايفه: الأعمدة اللي مخفهاش وبالترتيب اللي رتّبه — عشان كده بيتبعت
 * `columns` بعد ما `useTableColumns` يعديها، مش قايمة الأعمدة الأصلية. أعمدة من غير `dataIndex`
 * هي زراير الإجراءات: تصديرها بيطلّع عمود فاضي ليه عنوان.
 *
 * القيمة بتتاخد خام من الصف مش من `render`، عشان المبلغ ينزل رقم يتجمع عليه بدل «١٬٢٣٤٫٥٠»
 * المنسّق. بس لما القيمة الخام مش نص ولا رقم — كائن متداخل، أو مش موجودة أصلاً والعمود بيتحسب
 * في `render` — ساعتها `render` هو المصدر الوحيد، وبناخد منه اللي يطلع نص أو رقم.
 */
export function columnsFromTable<T = any>(
  tableColumns: {
    title?: unknown;
    dataIndex?: any;
    render?: (value: any, row: any, index: number) => any;
  }[],
): ExcelColumn<T>[] {
  return tableColumns
    .filter((c) => c.dataIndex !== undefined && c.dataIndex !== null)
    .map((c) => ({
      title: typeof c.title === 'string' ? c.title : String(c.title ?? ''),
      value: (row: T) => {
        const path = Array.isArray(c.dataIndex) ? c.dataIndex : [c.dataIndex];
        let raw: any = row;
        for (const key of path) raw = raw === null || raw === undefined ? raw : raw[key];
        const usable = raw === null || raw === undefined || typeof raw === 'object';
        if (usable && c.render) {
          try {
            const shown = c.render(raw, row, 0);
            if (typeof shown === 'string' || typeof shown === 'number') return shown;
          } catch {
            /* عمود بيرسم حاجة محتاجة سياق الجدول — بنسيبه فاضي بدل ما التصدير كله يقع */
          }
        }
        return typeof raw === 'object' ? '' : raw;
      },
    }));
}
