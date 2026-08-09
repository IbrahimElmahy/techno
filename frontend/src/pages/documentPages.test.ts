/**
 * كل مستند بيتعمل في النظام: العرض والتعديل من جوّه صفحة الإنشاء بتاعته.
 *
 * The user asked for this as a system-wide rule, not a per-screen fix: «عايز كل حاجة في النظام
 * بيتم إنشاءها، العرض بتاعها والتعديل يكون من داخل صفحة الإنشاء بتاعتها بحيث إني أقدر أعدل وأنا
 * شغال».
 *
 * The pattern it replaces is a document with two surfaces — a modal or a form to WRITE it and a
 * drawer or a sheet to LOOK at it. Two surfaces means two shapes for the same paper: opening
 * yesterday's permit lands somewhere that looks nothing like where it was typed, and correcting
 * something you can see requires closing what you are reading and finding the other screen.
 *
 * This file is the guard for the screens converted so far. It is deliberately about SHAPE — that
 * the second surface is gone and the row opens the document — because that is exactly what drifts
 * back the next time somebody adds a «عرض» button.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('إذن التحويل', () => {
  const src = read('Transfers.tsx');

  it('مفيش ورقة عرض منفصلة', () => {
    expect(src).not.toMatch(/setReviewing/);
  });

  it('السطر بيفتح المستند', () => {
    expect(src).toMatch(/onOpen: \(t\) => openTransfer\(t\)/);
  });

  it('والاعتماد على المستند نفسه', () => {
    expect(src).toMatch(/key: 'approve', label: 'اعتماد'/);
  });
});

describe('إذن الإضافة وإذن الصرف', () => {
  const src = read('StockPermits.tsx');

  it('الـ Drawer اتشال', () => {
    // It was a read-only side panel with «عكس الإذن» on it — a second shape for the same paper.
    expect(src).not.toMatch(/<Drawer/);
    expect(src).not.toMatch(/\bDrawer,/);
  });

  it('الإنشاء بقى صفحة مش نافذة', () => {
    // The create form used to be a Modal; the only modals left are the doors that ask which
    // store, before the document exists at all.
    expect(src).not.toMatch(/open=\{creating\}/);
    expect(src).toMatch(/if \(creating \|\| detail\)/);
  });

  it('السطر بيفتح نفس الصفحة', () => {
    expect(src).toMatch(/onClick: \(\) => openPermit\(r\)/);
  });

  it('الإذن المترحّل بيقول ليه مايتعدلش', () => {
    // Not silence, and not a disabled field: there is no edit endpoint on purpose, because the
    // goods already moved. Saying so is what stops somebody hunting for the edit button.
    expect(src).toMatch(/الإذن ده اتّرحّل خلاص/);
    expect(src).toMatch(/فالإذن مايتعدلش/);
  });

  it('والعكس من على المستند', () => {
    expect(src).toMatch(/onConfirm=\{\(\) => reverse\(detail\)\}/);
  });
});

describe('المستندات اللي أصلاً كده', () => {
  // The sale, the return and the transfer already open full-page for both writing and reading.
  // Listed here so a future edit that reintroduces a «عرض» modal fails loudly.
  it.each([
    ['فاتورة البيع', 'Invoices.tsx'],
    ['المرتجع', 'Returns.tsx'],
    ['إذن التحويل', 'Transfers.tsx'],
    ['أذونات المخزن', 'StockPermits.tsx'],
  ])('«%s» مالهاش نافذة عرض للمستند', (_label, file) => {
    const src = read(file);
    expect(src).not.toMatch(/title="عرض المستند"/);
    expect(src).not.toMatch(/عرض المستند</);
  });
});
