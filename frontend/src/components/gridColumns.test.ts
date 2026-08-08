import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * كل عمود في الجرد والتقارير بيتفلتر.
 *
 * A search box above a table answers one question: «فين السطر ده». It cannot answer «خامات مخزن
 * الفرع اللي فيها عجز», which is what a stocktake and a report are actually read for — three
 * conditions at once, each on a different column.
 *
 * So every data column carries its own filter, and they combine. The way that decays is ordinary:
 * somebody adds a column to an existing report, copies the shape of the line above it, and the
 * shape they copied happens to be the one column that never needed a filter. Nothing looks wrong.
 * Six months later half the columns filter and half do not, and people stop trying.
 *
 * The rule is therefore checked rather than remembered: on these screens, a column that shows data
 * must offer a way to narrow by it, or be listed below with the reason it cannot.
 */

const PAGES = join(__dirname, '..', 'pages');
const read = (f: string) => readFileSync(join(PAGES, f), 'utf8');

/** The screens the rule covers: everything somebody reads to answer a question. */
const REPORTS = [
  'StockSheet.tsx', 'Stocktake.tsx', 'StockCounts.tsx', 'ItemCard.tsx', 'AccountStatement.tsx',
  'TradeReports.tsx', 'RepReports.tsx', 'FinanceReports.tsx', 'GeneralLedger.tsx',
  'StockAlerts.tsx', 'Loyalty.tsx', 'Treasury.tsx', 'Audit.tsx', 'ItemProfile.tsx',
  'Reports.tsx', 'Serials.tsx',
];

/**
 * Columns that hold no data to narrow by, with the reason each is exempt.
 *
 * Keyed by title, because that is what a reader sees. Being here is a decision, not an oversight —
 * which is the whole point of writing it down.
 */
const NOT_DATA: Record<string, string> = {
  'الإجراءات': 'عمود أزرار — مفيش قيمة تتفلتر بيها',
  'التراجع': 'زرار عكس القيد، مش بيانات',
};

const HELPERS = /\.\.\.(?:textColumn|numberColumn|choiceColumn|dateColumn)/;

describe('كل عمود بيانات في التقارير بيتفلتر', () => {
  it.each(REPORTS)('%s', (file) => {
    const src = read(file);
    // A column definition here is `title: '…'` immediately followed by `dataIndex:` or `key:` —
    // which excludes modal and confirm-dialog titles, and columns with an empty title (the link
    // and action cells, which carry a button rather than a value).
    const columns = [...src.matchAll(/title: '([^']+)',\s*(?:dataIndex|key):/g)];
    const unfiltered = columns
      .filter(([, title]) => !NOT_DATA[title])
      // The window has to clear a doc comment sitting between the title and the spread; 400 is
      // comfortably past the longest one and still inside the same column.
      .filter((m) => !HELPERS.test(src.slice(m.index!, m.index! + 400)))
      .map(([, title]) => title);

    expect(
      unfiltered,
      `أعمدة من غير فلتر في «${file}». استعمل textColumn / numberColumn / dateColumn / `
      + 'choiceColumn، أو ضيف العمود لـ NOT_DATA بالسبب.',
    ).toEqual([]);
  });

  it('finds columns at all, so a rename cannot make this pass by checking nothing', () => {
    const total = REPORTS.reduce(
      (n, f) => n + [...read(f).matchAll(/title: '([^']+)',\s*(?:dataIndex|key):/g)].length, 0);
    expect(total).toBeGreaterThan(150);
  });
});

describe('مفيش فلتر متكرر على نفس العمود', () => {
  it('never spreads two helpers onto one column', () => {
    // Two spreads on one column is not a syntax error and not a visible fault — the second simply
    // wins. It is how a column ends up filtering by a field nobody meant, which is worse than no
    // filter because the answer looks right.
    const doubled: string[] = [];
    readdirSync(PAGES).filter((f) => f.endsWith('.tsx')).forEach((f) => {
      const src = read(f);
      const re = new RegExp(`${HELPERS.source}[^\\n]*?,\\s*${HELPERS.source}`, 'g');
      if (re.test(src)) doubled.push(f);
    });
    expect(doubled, 'عمود عليه أكتر من فلتر').toEqual([]);
  });
});
