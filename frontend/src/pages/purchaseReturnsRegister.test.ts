/**
 * سجل مردودات الشرا — نفس معاملة سجل الشرا.
 *
 * العميل طلب اللي اتعمل في صفحة الشرا يتعمل في المردود. اللي كان فيه: بحث والمورد وبس، وستة
 * أعمدة بلا فلتر ولا ترتيب، وفلتر التاريخ بيقيس يوم تسجيل الصف بدل يوم رجوع البضاعة.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'PurchaseReturns.tsx'), 'utf8');
const columnBlock = src.slice(src.indexOf('const columns = ['),
  src.indexOf("useHiddenColumns('purchase-returns-list'"));

describe('فلترة وترتيب على كل عمود', () => {
  it('كل عمود بيتفلتر ويتترتب', () => {
    const helpers = (columnBlock.match(/\.\.\.(textColumn|numberColumn|dateColumn)/g) || []).length;
    expect(helpers, 'فيه أعمدة من غير فلتر ولا ترتيب').toBeGreaterThanOrEqual(6);
  });

  it('القيمة بتتفلتر بمدى', () => {
    const at = columnBlock.indexOf("dataIndex: 'value'");
    expect(columnBlock.slice(at, at + 220)).toContain('numberColumn');
  });

  it('السجل بيفتح على الأحدث', () => {
    expect(columnBlock).toMatch(/return_date[\s\S]{0,300}defaultSortOrder: 'descend'/);
  });

  it('الفلتر بالتاريخ بيقيس يوم رجوع البضاعة', () => {
    expect(src).toMatch(/dateOf: \(r\) => r\.return_date \|\| r\.created_at/);
  });

  it('فيه عمود ملاحظات', () => {
    expect(columnBlock).toContain("dataIndex: 'notes'");
  });
});

describe('شريط الفلاتر', () => {
  it('اللي مابيتسألش كل يوم تحت طيّة', () => {
    const bar = src.slice(src.indexOf('<ListToolbar'), src.indexOf('<Table'));
    expect(bar).toMatch(/document_number'[\s\S]{0,140}advanced: true/);
    expect(bar).toMatch(/notes'[\s\S]{0,140}advanced: true/);
  });

  it('كل فلتر ليه منطق بيفلتر بيه', () => {
    const logic = src.slice(src.indexOf('const filter = useListFilter'), src.indexOf('dateOf:'));
    for (const key of ['supplier_id', 'document_number', 'purchase_document_number', 'notes']) {
      expect(logic, `«${key}» في الشريط ومالوش منطق`).toContain(`${key}:`);
    }
  });
});

describe('توزيع الصفحة', () => {
  it('الجدول مضغوط وبيتمرّر أفقياً', () => {
    expect(src).toMatch(/scroll=\{\{ x: 'max-content' \}\}/);
    expect(src).toContain('size="small"');
  });

  it('رقم السند مثبّت', () => {
    expect(columnBlock).toMatch(/document_number'[\s\S]{0,120}fixed: 'left'/);
  });

  it('فيه صف إجماليات على المعروض مش على السجل كله', () => {
    const summary = src.slice(src.indexOf('summary={(shown)'), src.indexOf('</Table.Summary>'));
    expect(summary).toContain('list.reduce');
    expect(summary, 'بيجمع من كل السجل').not.toContain('rows.reduce');
    // بيتبني من الأعمدة المعروضة عشان إخفاء عمود ما يزحّقش القيمة تحت عنوان تاني.
    expect(summary).toContain('cols.apply(columns)');
  });
});

describe('عرض وطباعة — زي سجل الشرا', () => {
  it('المستند بيتفتح في بوباب مش صفحة بتحل محل السجل', () => {
    expect(src).toMatch(/<TabModal\s+open=\{!!viewing\}/);
    expect(src, 'لسه بيحل محل السجل').not.toMatch(/\{viewing && \(\s*<Card/);
  });

  it('فيه عمود إجراءات فيه عرض وطباعة', () => {
    expect(columnBlock).toContain("title: 'الإجراءات'");
    expect(columnBlock).toContain('عرض');
    expect(columnBlock).toContain('طباعة');
  });

  it('المرتجع ليه ورقة مطبوعة بنفس قالب الفاتورة', () => {
    // القالب واحد للاتنين عشان الورقتين يطلعوا من نفس المطبعة.
    expect(src).toMatch(/const returnDoc = \(r: any\): InvoiceDoc \| null/);
    expect(src).toContain('<InvoiceDocument doc={returnDoc(viewing)!} />');
    expect(src).toContain('invoiceFooter(returnDoc(viewing)');
  });

  it('الورقة مافيهاش نقدي ولا آجل', () => {
    // المرتجع بيقلّل اللي على الشركة — مش بيتقبض ولا بيتصرف على الورقة دي.
    const doc = src.slice(src.indexOf('const returnDoc'), src.indexOf('const cols ='));
    expect(doc).toMatch(/cash: 0,\s*\n\s*credit: 0,/);
    // ومفيش خصم ولا ضرايب، فالإجمالي والصافي واحد.
    expect(doc).toMatch(/gross: r\.value,\s*\n\s*net: r\.value,/);
  });
});

describe('«عرض» بيفتح التعديل — زي الشرا', () => {
  it('الفتح مابيعكسش — بيملا الشاشة وبس', () => {
    // نفس العطل اللي وقع في فاتورة الشرا: العكس وقت الفتح بيخلّي المستند مش قابل للفتح
    // أصلاً لو الحركة اللي وراه مابقتش ممكنة.
    const edit = src.slice(src.indexOf('const editPosted'), src.indexOf('const openCreate'));
    expect(edit, 'الفتح لسه بيعكس').not.toContain('/reverse');
    expect(edit).toContain('setEditingId(row.id)');
    // الكميات اللي كانت مترجّعة بترجع للشاشة — من غيرها التعديل كتابة من أول وجديد.
    expect(edit).toContain('choosePurchase(doc.purchase_invoice_id)');
    expect(edit).toContain('setQty(filled)');
  });

  it('العكس بيحصل وقت الترحيل، ولو وقع مافيش مردود جديد بيتكتب', () => {
    const submit = src.slice(src.indexOf('const submit = async'), src.indexOf('const columns ='));
    expect(submit).toContain('if (editingId !== null)');
    expect(submit).toContain('/reverse');
    const at = submit.indexOf('تعذر عكس المردود القديم');
    expect(at).toBeGreaterThan(-1);
    expect(submit.slice(at, at + 200)).toContain('return;');
  });

  it('«عرض» بيروح للتعديل و«طباعة» للمعاينة', () => {
    expect(columnBlock).toContain('onClick={() => editPosted(record)}>عرض');
    expect(columnBlock).toContain('onClick={() => openReturn(record)}>طباعة');
  });

  it('مفيش تأكيد قبل العكس', () => {
    const edit = src.slice(src.indexOf('const editPosted'), src.indexOf('const openCreate'));
    expect(edit).not.toContain('Modal.confirm');
  });
});

describe('نفس باب الشرا', () => {
  it('بيفتح ببوباب «انشاء» — فرع وتاريخ وتصنيف وقايمة', () => {
    // كان بوباب بيسأل التاريخ وبس، وبعده الشاشة بتسيبك تدوّر في قايمة بكل فواتير الشركة.
    expect(src).toContain('<PartyPickerModal');
    expect(src).toMatch(/open=\{newStep === 'party'\}/);
    expect(src).toMatch(/kinds=\{\['supplier', 'customer'\]\}/);
    expect(src, 'لسه فيه خطوة تاريخ منفصلة').not.toContain("newStep === 'date'");
  });

  it('المورد اللي اتختار بيضيّق فواتير الخطوة اللي بعده', () => {
    // المردود بيبدأ من مورد قبل ما يبدأ من فاتورة.
    expect(src).toMatch(/!supplierFilter \|\| p\.supplier_id === supplierFilter/);
  });
});

describe('نفس كثافة الشرا', () => {
  it('الفورم مضغوط بنفس الكلاس', () => {
    expect(src).toContain('className="doc-form"');
    expect(src).toMatch(/<Form layout="vertical" size="small"/);
  });

  it('مفيش زراير كبيرة بتاكل ارتفاع', () => {
    // زرارين `large` في آخر الشاشة كانوا بياخدوا ارتفاع سطرين.
    expect(src, 'لسه فيه زرار كبير').not.toContain('size="large"');
  });
});
