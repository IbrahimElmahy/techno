/**
 * فاتورة المرتجع نسخة طبق الأصل من فاتورة البيع.
 *
 * A return IS the sale read backwards, and the hand should not have to relearn the screen for it.
 * The two drifted anyway: everything added to the sale had to be added twice, and whatever was
 * added once became the difference nobody remembered.
 *
 * The one that mattered was نوع الفاتورة. A customer can hold one receivable account per product
 * line (031), the sale asks which one it posts to, and the return did not — so a standalone return
 * for such a customer was REFUSED outright, «العميل عنده أكتر من حساب (أبيض / بولي) — لازم تحدد
 * النوع», from a screen with no field to answer it.
 *
 * These are source-shape checks, not renders: they cost nothing and they fail the moment one
 * screen gains something the other did not.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');
const sale = read('Invoices.tsx');
const ret = read('Returns.tsx');

/** The pieces that make the two documents read alike at the counter. */
const SHARED: [string, RegExp][] = [
  ['منتقي الأطراف بنافذة وإنشاء من جوّها', /PartyPickerModal/],
  ['منتقي الأصناف', /ProductPickerModal/],
  ['شريط الأوامر بنفس الأفعال', /DocumentToolbar/],
  ['سلّم الإجماليات', /TotalsLadder/],
  ['إعدادات الأعمدة', /ColumnSettings/],
  ['خيارات الطباعة', /PrintOptionsMenu/],
  ['مستودع لكل سطر', /warehouse_id/],
  ['مندوب على المستند', /rep_id/],
  ['رقم مستند خارجي', /external_document_number/],
  ['بيانات ١ ٢ ٣', /statement1/],
  ['ملاحظات', /notes/],
  ['لوحة حساب العميل', /CustomerAccountPanel/],
];

describe('الاتنين فيهم نفس الحاجات', () => {
  it.each(SHARED)('«%s» في البيع وفي المرتجع', (_label, pattern) => {
    expect(sale).toMatch(pattern);
    expect(ret).toMatch(pattern);
  });
});

describe('نوع المستند — أبيض / بولي', () => {
  it('المرتجع بيسأل زي البيع', () => {
    // Without this the standalone return was refused for every merged customer.
    expect(ret).toMatch(/families\.length > 1/);
    expect(ret).toMatch(/<Segmented/);
    expect(ret).toMatch(/نوع المرتجع/);
  });

  it('وبيبعته للسيرفر', () => {
    // Asking and then not sending it is the same as not asking.
    expect(ret).toMatch(/family: returnFamily/);
  });

  it('مابيتسألش لما مفيش اختيار', () => {
    // One line means a question with a single possible answer. Both screens gate on the same rule
    // and pre-pick the same way.
    expect(ret).toMatch(/named\.length === 1 \? named\[0\]\.family : null/);
    expect(sale).toMatch(/named\.length === 1 \? named\[0\]\.family : null/);
  });

  it('ومابيتحطش اختيار افتراضي لما فيه اتنين', () => {
    // Choosing for him is choosing which balance moves, so both screens start empty. The red
    // line that used to say so was removed on request — the empty buttons say it.
    expect(ret).toMatch(/setReturnFamily\(named\.length === 1 \? named\[0\]\.family : null\)/);
    expect(sale).toMatch(/setInvoiceFamily\(named\.length === 1 \? named\[0\]\.family : null\)/);
  });

  it('المديونيتين والإجمالي على المستندين', () => {
    for (const src of [sale, ret]) {
      expect(src).toMatch(/label: `مديونية \$\{a\.family\}`/);
      expect(src).toMatch(/label: 'إجمالي المديونية'/);
      // The one this document moves is tinted — three similar numbers in a column with nothing
      // marking the relevant one is three numbers nobody reads.
      expect(src).toMatch(/highlight: a\.family === (invoice|return)Family/);
    }
  });

  it('وعمود «النوع» في القايمتين', () => {
    for (const src of [sale, ret]) {
      expect(src).toMatch(/title: 'النوع'/);
      expect(src).toMatch(/dataIndex: 'family'/);
    }
  });
});
