import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * خانة الكمية تفضل فاضية لحد ما حد يكتب فيها.
 *
 * A quantity box that opens at 1 turns «5» into «15» for anybody who types without clearing it
 * first — the caret sits after the 1 and the number they meant becomes a number ten times bigger.
 * The invoice is out by an order of magnitude and nothing on the screen looks wrong. It is the
 * single most expensive default in a data-entry system, because the mistake is invisible at the
 * moment it is made and expensive by the time it is found.
 *
 * So a line is created with `quantity: null` and the box renders empty with a placeholder. «Nobody
 * has typed one yet» is then a real state the save can catch, rather than a plausible-looking 1.
 */

const PAGES = __dirname;
const read = (f: string) => readFileSync(join(PAGES, f), 'utf8');

/** The screens where somebody types a quantity into a document line. */
const DOCUMENTS = ['Invoices.tsx', 'Purchases.tsx', 'Returns.tsx', 'Transfers.tsx',
  'PurchaseReturns.tsx', 'FreeProduction.tsx'];

describe('الكمية بتبدأ فاضية', () => {
  it.each(DOCUMENTS)('%s creates its lines with no quantity', (file) => {
    const src = read(file);
    // `quantity: 1` or `quantity: 0` in a line factory is the defect. Written as a regex over the
    // object literal rather than by reading, because this is exactly the thing that gets
    // reintroduced by somebody copying a neighbouring screen.
    const seeded = /quantity:\s*[01](?![.\d])/.exec(src);
    expect(
      seeded?.[0] ?? null,
      `«${file}» بيبدأ سطوره بكمية جاهزة — أول رقم يتكتب هيتلزق بيها`,
    ).toBeNull();
  });

  it('the sale, where it matters most, starts null and shows a placeholder', () => {
    const src = read('Invoices.tsx');
    expect(src).toMatch(/quantity:\s*null/);
    expect(src).toMatch(/placeholder="الكمية"/);
    // Clearing has to leave it empty rather than snapping back, or «type over it» means nothing.
    expect(src).toMatch(/'quantity',\s*val\s*\?\?\s*null/);
  });
});

describe('الكمية تقبل الكسور', () => {
  it('never floors a document quantity at 1', () => {
    // Quantities are stored to three decimals and items carry units with factors — نص متر, ٢٫٥
    // كيلو. The sale was capped at 1 while the return and the transfer allowed 0.001, so a thing
    // could be given back and moved between stores in a fraction and never sold in one.
    const offenders: string[] = [];
    readdirSync(PAGES).filter((f) => f.endsWith('.tsx')).forEach((f) => {
      const src = read(f);
      // Only quantity boxes: the ones carrying the grid marker that makes them document lines.
      const re = /<InputNumber[^>]*min=\{1\}[^>]*data-grid-col="qty"|min=\{1\}[^>]*data-qty-key/gs;
      if (re.test(src)) offenders.push(f);
    });
    expect(offenders, 'خانة كمية مش بتقبل أقل من ١').toEqual([]);
  });
});
