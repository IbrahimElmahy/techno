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

/**
 * The three stocktake screens are read side by side and their numbers get compared. A column on one
 * and not another makes the reader stop and check whether they are even looking at the same thing —
 * so they carry the same ones, and that is worth holding still rather than remembering.
 */
describe('شاشات الجرد التلاتة بنفس الأعمدة', () => {
  const SHEETS = ['StockSheet.tsx', 'Stocktake.tsx'];
  /** الفئة is the one that was missing from جرد حتى تاريخ entirely, and hidden on the other two. */
  const SHARED = ['الكود', 'الصنف', 'الفئة', 'الوحدة', 'الكمية', 'العدد الفعلي', 'الفرق'];

  it.each(SHEETS)('%s carries every shared column', (file) => {
    const src = read(file);
    const missing = SHARED.filter((t) => !src.includes(`title: '${t}'`));
    expect(missing, `أعمدة ناقصة في «${file}»`).toEqual([]);
  });

  it('shows الفئة rather than hiding it behind الأعمدة', () => {
    // It was defined-but-hidden, which reads as absent to everyone who never opens the column
    // picker — the same as not having it.
    const src = read('StockSheet.tsx');
    expect(src).not.toMatch(/useHiddenColumns\([^)]*\[[^\]]*'category'/);
  });

  it('exports الفئة too, since the export claims to follow the columns', () => {
    // A file whose headings do not match the screen is read once, believed, and filed.
    const src = read('Stocktake.tsx');
    const heads = src.slice(src.indexOf('const heads ='), src.indexOf('const heads =') + 260);
    expect(heads).toContain('الفئة');
  });

  it('always shows الفئة on the counting sheet, not only when it varies', () => {
    // A column that appears and disappears with the data cannot be learned: somebody who filtered
    // by فئة yesterday looks for it today and it is not there.
    const src = read('StockCounts.tsx');
    expect(src).not.toMatch(/categories\.length > 1 \? \[\{\s*\n\s*title: 'الفئة'/);
    expect(src).toContain("title: 'الفئة'");
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
