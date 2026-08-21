/**
 * صفحة طلبات البيع/الشراء — شيت تسعير، مش مستند حركة.
 *
 * The screen already moved no stock and touched no treasury — there is no order service posting
 * to the ledger, and no quantity was ever capped against what a warehouse holds. Confirmed with
 * the user before touching anything: the only real gap was that it still READ like formal order
 * paperwork, so this is a wording change, pinned so the language does not drift back toward
 * «طلب» — a document somebody expects to be actioned — the next time this screen is touched.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'Orders.tsx'), 'utf8');

describe('الصفحة بتقول هي شيت تسعير', () => {
  it('العنوان وتنبيه الشاشة بيسموها كده', () => {
    // العنوان بقى بنوع الشاشة — «شيت تسعير بيع» أو «شيت تسعير شرا» — لأن الشاشة بقت
    // مخصّصة لنوع واحد بيجي من المدخل اللي اتفتحت منه.
    expect(src).toMatch(/شيت تسعير \$\{kindLabel\}/);
    expect(src).toMatch(/شيت تسعير — مش بيحرّك مخزون ولا خزينة/);
  });

  it('وبتقول صراحة إن الكمية مش متأكّدة من المخزون', () => {
    expect(src).toMatch(/أي كمية، بغض النظر عن المتاح في المخزن/);
  });

  it('وزرار الإنشاء بقى «تسعيرة» مش «طلب»', () => {
    // زرار واحد بنوع الشاشة، مش زرارين. الاسم بيتركّب من `kindLabel` فبيتغيّر معاها.
    expect(src).toMatch(/const sheetName = `تسعيرة \$\{kindLabel\}`/);
    expect(src, 'رجع زرار النوع التاني').not.toMatch(/startNew\('purchase'\)/);
  });
});

describe('ومفيش حاجة اتحركت فعلياً — كانت أصلاً كده', () => {
  it('مفيش max بيربط الكمية بالمخزون', () => {
    expect(src).not.toMatch(/max=\{[^}]*(availableFor|available|on_hand)[^}]*\}/);
  });

  it('الإرسال بيعدّي على /orders بس — مفيش نداء مخزون ولا خزينة', () => {
    expect(src).toMatch(/api\.post\('\/api\/v1\/orders'/);
    expect(src).not.toMatch(/\/api\/v1\/stock\//);
    expect(src).not.toMatch(/\/api\/v1\/treasur/);
  });
});
