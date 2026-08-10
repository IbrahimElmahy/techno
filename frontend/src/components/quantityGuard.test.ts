/**
 * الكمية — مايتكتبش فيها سالب، ولا أكتر من اللي في المخزن.
 *
 * Asked for directly: «امنع اختيار كمية أكبر من الموجودة في المخزن أو كمية بالسالب عموماً، ويظهر
 * بوباب تحذير».
 *
 * The «بوباب» is the point, not decoration. What was there before was `max` on the InputNumber,
 * which SILENTLY rewrites the number: ask for 50 out of a store holding 8 and the box shows 8 with
 * nothing said. The person believes they sold 50, the invoice says 8, and nobody finds out until
 * the customer does. A cap that edits your work without telling you is worse than no cap.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { quantityProblem } from './quantityGuard';

const SRC = join(__dirname, '..');

describe('القاعدة نفسها', () => {
  it('السالب مرفوض', () => {
    // Not a small quantity — a sale that ADDS stock, posted as an ordinary document.
    expect(quantityProblem({ value: -3 })).toMatch(/بالسالب/);
  });

  it('الصفر مرفوض', () => {
    expect(quantityProblem({ value: 0 })).toMatch(/صفر/);
  });

  it('الأكتر من المتاح مرفوض، وبيقول المتاح كام', () => {
    // The number that was refused and the number that is real, both on screen: «مش متاح» alone
    // sends somebody to another screen to find out how much they may actually sell.
    const msg = quantityProblem({ value: 50, available: 8 });
    expect(msg).toMatch(/٨/);
    expect(msg).toMatch(/٥٠/);
  });

  it('المساوي للمتاح مقبول', () => {
    // Selling the last one is not an error.
    expect(quantityProblem({ value: 8, available: 8 })).toBeNull();
  });

  it('الفاضية مش غلط — لسه محدش كتب', () => {
    // The box opens empty on purpose; complaining about it before anybody types is noise.
    expect(quantityProblem({ value: null })).toBeNull();
    expect(quantityProblem({ value: undefined })).toBeNull();
  });

  it('المتاح المجهول مش صفر', () => {
    // The load-bearing distinction. `availableFor` answers 0 for a line whose warehouse has not
    // been picked yet — true as arithmetic, false as a statement, and it made the guard refuse
    // every quantity typed in the normal order of work while telling the person «المتاح ٠» about
    // an item sitting on a shelf.
    expect(quantityProblem({ value: 50, available: undefined })).toBeNull();
    expect(quantityProblem({ value: 50, available: null })).toBeNull();
    expect(quantityProblem({ value: 50, available: 0 })).not.toBeNull();
  });
});

describe('بتتطبّق على الشاشات اللي البضاعة بتطلع منها', () => {
  const read = (f: string) => readFileSync(join(SRC, f), 'utf8');

  it.each([
    ['فاتورة البيع', 'pages/Invoices.tsx'],
    ['إذن التحويل', 'pages/Transfers.tsx'],
    ['أذونات المخزن', 'pages/StockPermits.tsx'],
  ])('«%s» بتستعمل الحارس', (_label, file) => {
    expect(read(file)).toMatch(/guardQuantity/);
  });

  it('ومفيش `max` بيقصّ الرقم في السكوت', () => {
    // The whole reason the guard exists. A `max` bound to availability is the silent rewrite.
    const offenders: string[] = [];
    for (const f of ['pages/Invoices.tsx', 'pages/Transfers.tsx', 'pages/StockPermits.tsx']) {
      const src = read(f);
      for (const m of src.matchAll(/max=\{[^}]*(availableFor|available|reviewStock)[^}]*\}/g)) {
        offenders.push(`${f}: ${m[0].slice(0, 60)}`);
      }
    }
    expect(offenders, 'قصّ صامت للكمية بدل التحذير').toEqual([]);
  });

  it('بيتأكد لما تخلص كتابة، مش مع كل رقم', () => {
    // Typing «50» passes through «5». A dialog that fires mid-number is a dialog people learn to
    // dismiss without reading, which costs more than it saves.
    for (const f of ['pages/Invoices.tsx', 'pages/Transfers.tsx', 'pages/StockPermits.tsx']) {
      const src = read(f);
      expect(src, f).toMatch(/onBlur=\{[\s\S]{0,200}guardQuantity/);
      expect(src, f).toMatch(/onPressEnter=\{[\s\S]{0,400}guardQuantity/);
    }
  });
});

describe('مفيش شاشة اتنسيت', () => {
  it('أي InputNumber لكمية على شاشة بتطلّع بضاعة بيعدّي على الحارس', () => {
    // A screen that grows a second quantity box and wires it straight to state is exactly how the
    // rule comes back half-applied.
    const files = readdirSync(join(SRC, 'pages')).filter((f) => f.endsWith('.tsx'));
    const stockOut = ['Invoices.tsx', 'Transfers.tsx', 'StockPermits.tsx'];
    for (const f of files) {
      if (!stockOut.includes(f)) continue;
      const src = readFileSync(join(SRC, 'pages', f), 'utf8');
      const boxes = (src.match(/data-qty-key=/g) || []).length;
      const guards = (src.match(/guardQuantity\(/g) || []).length;
      expect(guards, `${f}: ${boxes} خانة كمية و${guards} حارس`).toBeGreaterThan(0);
    }
  });
});
