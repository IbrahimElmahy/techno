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

  it('الإذن المترحّل بيقول إنه مايتغيّرش في مكانه — ويقول الطريق', () => {
    // Not silence, and not a disabled field. The goods already moved, so it cannot be rewritten
    // where it stands — but saying only that sends somebody hunting for a button that does not
    // exist. It names the way through instead.
    expect(src).toMatch(/الإذن ده اتّرحّل خلاص/);
    expect(src).toMatch(/فالإذن مايتغيّرش في مكانه/);
    expect(src).toMatch(/«تعديل الإذن» بيعكسه ويفتحه تاني/);
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

describe('المستند المترحّل ينفع يتعدّل', () => {
  // Asked for explicitly: «الإذن اللي أعرضه أو الفاتورة اللي أعرضها يكون برده متاح التعديل».
  //
  // A posted document cannot be rewritten in place — the movements are on the shelf and the entry
  // is in an append-only ledger — so «تعديل» is the same thing it has always meant on a posted
  // invoice here: reverse it in full, reopen the form on exactly what it held, post again. The
  // original, the reversal and the correction all stay in the record, which is the difference
  // between a correction and a quiet rewrite of a month somebody already reported on.
  it.each([
    ['فاتورة البيع', 'Invoices.tsx', /handleEditInvoice/],
    ['إذن التحويل', 'Transfers.tsx', /const editApproved/],
    ['أذونات المخزن', 'StockPermits.tsx', /const editPosted/],
  ])('«%s» فيها تعديل للمستند المترحّل', (_label, file, pattern) => {
    expect(read(file)).toMatch(pattern);
  });

  it.each([
    ['إذن التحويل', 'Transfers.tsx'],
    ['أذونات المخزن', 'StockPermits.tsx'],
  ])('«%s» بتسأل الأول — العكس ترحيل حقيقي', (_label, file) => {
    // The row itself leads to the document, so an unconfirmed reversal would be one mis-click
    // away from moving stock.
    const src = read(file);
    expect(src).toMatch(/Modal\.confirm/);
    expect(src).toMatch(/okText: 'اعكسه وافتحه'/);
  });

  it.each([
    ['إذن التحويل', 'Transfers.tsx'],
    ['أذونات المخزن', 'StockPermits.tsx'],
  ])('«%s» بتفتح الفورم بمحتوى المستند مش فاضية', (_label, file) => {
    // Reopening blank would make «تعديل» mean «retype it», which is how a correction becomes a
    // second, different document.
    expect(read(file)).toMatch(/setLines\(/);
  });

  it('التحويل بيقرا المتاح قبل ما يبني السطور', () => {
    // The quantity box is capped at what is available, so a line built against a stale zero would
    // refuse the very quantity being corrected. The reversal just put the goods back.
    expect(read('Transfers.tsx')).toMatch(/stock = \(await api\.get\('\/api\/v1\/stock\/by-location'/);
  });

  it('والمستند بيقول الطريق مش بيرفض وبس', () => {
    // «مايتعدلش» on its own sends somebody hunting for a button that does not exist.
    expect(read('StockPermits.tsx')).toMatch(/«تعديل الإذن» بيعكسه ويفتحه تاني/);
    expect(read('Transfers.tsx')).toMatch(/«تعديل الإذن» بيعكسه ويفتح طلب جديد/);
  });
});
