/**
 * سجل فواتير الشرا — نفس فلاتر وأعمدة الشاشة اللي العميل شغّال عليها.
 *
 * صوّر الشاشة وطلب نفس الحاجات بالظبط. اللي كان عندنا: خانة بحث والمورد وبس، وستة أعمدة. يعني
 * «هات الفاتورة اللي رقمها عند المورد كذا» مكانش ليها طريق غير التقليب، والفاتورة اتخصم منها كام
 * مكانش يتشاف غير بفتحها.
 *
 * وأهم من الشكل: **الفلترة بتحصل وانت بتكتب** — مفيش زرار «عرض». الشاشة اللي عنده فيها زرار
 * عرض، وهو قال بالنص إن الفلتر لما يتغيّر البيانات تتعرض على طول. فالقايمة بتتحمّل مرة والفلترة
 * بتحصل في المتصفح، يعني بتتحرّك مع كل حرف من غير رحلة للسيرفر.
 *
 * أربع أعمدة في شاشته مالهاش داتا في النظام ده أصلاً — مصروفات، تسوية، مصروفات تشغيل، مراكز
 * التكلفة — لأن فاتورة الشرا عندنا مافيهاش الحقول دي. عمود بيعرض فراغ دايماً أوحش من عمود مش
 * موجود، فمااتحطّوش لغاية ما الحقول نفسها تتضاف.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'Purchases.tsx'), 'utf8');
const toolbar = readFileSync(join(__dirname, '..', 'components', 'ListToolbar.tsx'), 'utf8');

/** بلوك الفلاتر اللي بيتبعت لشريط الأدوات. */
const filterBlock = src.slice(src.indexOf('filters={['), src.indexOf(']}', src.indexOf('filters={[')));
/** بلوك أعمدة السجل. */
const columnBlock = src.slice(src.indexOf('const listColumns = ['),
  src.indexOf("useTableColumns('purchase-list'"));

describe('فلاتر السجل', () => {
  it.each([
    ['مستند رقم', 'document_number'],
    ['الفاتورة رقم', 'external_document_number'],
    ['الفرع', 'branch_id'],
    ['المورد', 'supplier_id'],
    ['ملاحظات', 'notes'],
  ])('فيه فلتر «%s»', (label, key) => {
    expect(filterBlock, `فلتر «${label}» ناقص`).toContain(`key: '${key}'`);
    expect(filterBlock).toContain(label);
  });

  it('فيه فلتر تاريخ', () => {
    expect(src).toContain('showDateRange');
  });

  it('كل فلتر ليه منطق بيفلتر بيه فعلاً', () => {
    // فلتر في الشريط من غير predicate بيبان شغّال ومابيعملش حاجة — أوحش من إنه مش موجود.
    const logic = src.slice(src.indexOf('const purchasesFilter'), src.indexOf('dateOf:'));
    for (const key of ['supplier_id', 'branch_id', 'document_number',
      'external_document_number', 'notes']) {
      expect(logic, `«${key}» في الشريط ومالوش منطق`).toContain(`${key}:`);
    }
  });

  it('الفلتر بالتاريخ بيقيس يوم وصول البضاعة مش يوم كتابة الصف', () => {
    // فاتورة أول الشهر اتسجّلت آخره بتقع برّه المدى، واللي بيدوّر عليها بيفتكرها مش موجودة.
    expect(src).toMatch(/dateOf: \(p\) => p\.purchase_date \|\| p\.created_at/);
  });

  it('مفيش زرار «عرض» على الفلاتر — بتشتغل وانت بتكتب', () => {
    // «عرض» الوحيد المسموح بيه هو اللي بيفتح فاتورة من سطر في السجل.
    const openRow = columnBlock.includes('onClick={() => openRow(record)}');
    expect(openRow, 'زرار فتح الفاتورة اتشال').toBe(true);
    const bar = src.slice(src.indexOf('<ListToolbar'), src.indexOf('</Card>', src.indexOf('<ListToolbar')));
    expect(bar, 'رجع زرار عرض على الفلاتر').not.toMatch(/>\s*(عرض|بحث|تطبيق)\s*</);
  });
});

describe('أعمدة السجل', () => {
  it.each([
    'مستند رقم', 'التاريخ', 'الفاتورة رقم', 'جهة التعامل', 'الفرع', 'الحساب الفرعي',
    'اجمالي قبل', 'خصم فاتورة', 'خصم فاتورة %', 'الضرائب', 'الضرائب %', 'الصافي',
    'الاجمالي', 'تم السداد', 'الباقي', 'ملاحظات',
  ])('فيه عمود «%s»', (title) => {
    expect(columnBlock, `عمود «${title}» ناقص`).toContain(`title: '${title}'`);
  });

  it('الأرقام اللي كانت بترجع أصفار بقى ليها أعمدة بتقراها', () => {
    // `gross` و`combined_pct` و`net` و`tax_amount` كانوا في عقد السيرفر وبيرجعوا صفر — الشاشة
    // مكانتش بتعرضهم، فالصفر مكانش بيبان لحد.
    for (const field of ['gross', 'combined_pct', 'net', 'tax_amount']) {
      expect(columnBlock, `«${field}» لسه مش معروض`).toContain(`dataIndex: '${field}'`);
    }
  });
});

describe('شريط الأدوات', () => {
  it('بيعرف الفلتر النصي مش القوايم بس', () => {
    // «مستند رقم» و«ملاحظات» نص مفتوح — قايمة بكل القيم بتكبر بلا حدود وبرضه مش هتجاوب
    // «اللي فيه كلمة كذا».
    expect(toolbar).toContain("kind?: 'select' | 'text'");
    expect(toolbar).toMatch(/f\.kind === 'text' \? \(/);
  });

  it('الفلتر النصي بيفلتر مع كل حرف', () => {
    const textBranch = toolbar.slice(toolbar.indexOf("f.kind === 'text'"));
    expect(textBranch.slice(0, 600)).toContain('onChange');
    expect(textBranch.slice(0, 600), 'محتاج Enter عشان يشتغل').not.toContain('onPressEnter');
  });
});

describe('فلترة وترتيب على كل عمود', () => {
  it('كل عمود بيانات بيتفلتر ويتترتب', () => {
    // شريط الفلاتر بيجاوب «هات فواتير المورد ده»، ومابيجاوبش «هات اللي الباقي عليها فوق
    // الألف» — ده سؤال بيتسأل على عمود، فالفلترة نزلت على الأعمدة.
    const helpers = (columnBlock.match(/\.\.\.(textColumn|numberColumn|dateColumn)/g) || []).length;
    expect(helpers, 'فيه أعمدة لسه من غير فلتر ولا ترتيب').toBeGreaterThanOrEqual(16);
  });

  it('الأرقام بتتفلتر بمدى مش بقايمة قيم', () => {
    // قايمة بكل مبلغ في الجدول مش فلتر — «من كذا لكذا» هو السؤال.
    for (const field of ['gross', 'total', 'credit_amount', 'net']) {
      const at = columnBlock.indexOf(`dataIndex: '${field}'`);
      expect(at, `«${field}» مش في الأعمدة`).toBeGreaterThan(-1);
      expect(columnBlock.slice(at, at + 220), `«${field}» مافيهوش فلتر مدى`)
        .toContain('numberColumn');
    }
  });

  it('السجل بيفتح على الأحدث', () => {
    // اللي بيفتح السجل عايز يشوف آخر اللي اتسجّل، مش أول فاتورة في النظام.
    expect(columnBlock).toMatch(/purchase_date[\s\S]{0,300}defaultSortOrder: 'descend'/);
  });

  it('خيارات الفلتر بتتبني من الكل مش من المعروض', () => {
    // لو اتبنت من المفلتر، القايمة بتضيق تحت إيد اللي بيفلتر ويفتكر إن القيمة مش موجودة.
    expect(columnBlock).toMatch(/textColumn\(purchases,/);
    expect(columnBlock).not.toMatch(/textColumn\(purchasesFilter/);
  });
});

describe('توزيع الصفحة', () => {
  it('الجدول بيتمرّر أفقياً وعمود الهوية مثبّت', () => {
    // سبعتاشر عمود في عرض الشاشة معناه أرقام متعصورة وملفوفة على سطرين.
    expect(src).toMatch(/scroll=\{\{ x: 'max-content' \}\}/);
    expect(columnBlock).toMatch(/document_number'[\s\S]{0,120}fixed: 'left'/);
  });

  it('فيه صف إجماليات على المعروض مش على السجل كله', () => {
    const summary = src.slice(src.indexOf('summary={(rows)'), src.indexOf('</Table.Summary>'));
    expect(summary).toContain('Table.Summary');
    // بيجمع من `rows` اللي الجدول مدّيهاله — يعني المفلتر.
    expect(summary).toContain('list.reduce');
    expect(summary, 'بيجمع من كل السجل').not.toContain('purchases.reduce');
  });

  it('صف الإجماليات بيتبني من الأعمدة المعروضة', () => {
    // مواضع محفوظة بتحط مجموع «الباقي» تحت «الضرائب» أول ما حد يخفي عمود.
    const summary = src.slice(src.indexOf('summary={(rows)'), src.indexOf('</Table.Summary>'));
    expect(summary).toContain('listCols.columns');
  });
});

describe('سجل لكل عمليات الشرا', () => {
  it('بيقرا الفواتير والمرتجعات مع بعض', () => {
    const fetch = src.slice(src.indexOf('const fetchPurchases'), src.indexOf('setListLoading(false)'));
    expect(fetch).toContain("api.get('/api/v1/purchases')");
    expect(fetch).toContain("api.get('/api/v1/purchases/returns')");
  });

  it('فيه عمود وفلتر للنوع', () => {
    expect(columnBlock).toContain("dataIndex: 'kind'");
    expect(columnBlock).toContain('مرتجع');
    expect(filterBlock).toContain("key: 'kind'");
  });

  it('أعمدة الفاتورة اللي مالهاش معنى على المرتجع بتفضل فاضية مش أصفار', () => {
    // صفر معناه «اتحسبت وطلعت صفر»؛ الفراغ معناه «السؤال ده مالوش لازمة على المستند ده».
    const fetch = src.slice(src.indexOf('const fetchPurchases'), src.indexOf('setListLoading(false)'));
    expect(fetch).toMatch(/gross: null, discount_amount: null/);
    for (const field of ['gross', 'net', 'cash_amount']) {
      const at = columnBlock.indexOf(`dataIndex: '${field}'`);
      expect(columnBlock.slice(at, at + 300), `«${field}» بيعرض صفر بدل فراغ`)
        .toContain("=== null ? '-'");
    }
  });

  it('مفتاح الصف بيفرّق بين فاتورة ومرتجع', () => {
    // الاتنين ممكن يكون ليهم نفس الـid، ومفتاح مكرر بيخلّي React تخلط السطور.
    expect(src).toMatch(/rowKey=\{\(r: PurchaseRecord\) => `\$\{r\.kind\}-\$\{r\.id\}`\}/);
  });

  it('المرتجع بيفتح الفاتورة اللي طالع منها', () => {
    const open = src.slice(src.indexOf('const openRow'), src.indexOf('const openRow') + 400);
    expect(open).toContain("row.kind === 'return'");
    expect(open).toContain('row.parent_id');
  });
});

describe('شريط الفلاتر صف واحد', () => {
  it('اللي مابيتسألش كل يوم تحت طيّة', () => {
    expect(filterBlock).toMatch(/document_number'[\s\S]{0,120}advanced: true/);
    expect(filterBlock).toMatch(/notes'[\s\S]{0,120}advanced: true/);
  });

  it('الشريط بيعرف الفلتر المطوي وبيفتحه لو ليه قيمة', () => {
    // فلتر بيضيّق النتايج وهو مش باين بيخلّي الواحد يبص على قايمة ناقصة ويفتكرها كاملة.
    expect(toolbar).toContain('advanced?: boolean');
    expect(toolbar).toContain('hiddenActive');
    expect(toolbar).toMatch(/const expanded = showMore \|\| hiddenActive/);
  });
});

describe('عرض وطباعة', () => {
  it('«عرض» بيروح للتعديل على طول مش لصفحة عرض', () => {
    // اللي بيضغط سطر في السجل تسعة من عشرة عايز يعدّل — الصفحة اللي في النص خطوة بتتعدّى.
    const open = src.slice(src.indexOf('const openRow'), src.indexOf('const openPrint'));
    expect(open).toContain('editPosted(doc)');
    expect(open, 'لسه بيفتح صفحة العرض').not.toContain('setDetail(');
  });

  it('التأكيد قبل العكس فاضل', () => {
    // الفاتورة المرحّلة ماتتعدلش في مكانها — بيتعمل لها عكس كامل. سطر اتضغط بالغلط في قايمة
    // مايعكسش مستند في صمت.
    const edit = src.slice(src.indexOf('const editPosted'), src.indexOf('const editPosted') + 900);
    expect(edit).toContain('Modal.confirm');
    expect(edit).toContain('/reverse');
  });

  it('«طباعة» بتفتح بوباب معاينة مش صفحة', () => {
    expect(src).toMatch(/const openPrint = async/);
    expect(src).toMatch(/open=\{!!preview\}/);
    expect(src).toContain('printInvoice(doc, printOpts)');
  });

  it('الكيبورد بيوصل لنفس مكان الزرار', () => {
    expect(src).toMatch(/onOpen: \(r\) => openRow\(r\)/);
  });
});
