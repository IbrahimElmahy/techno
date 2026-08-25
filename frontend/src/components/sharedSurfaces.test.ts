import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * السطح المشترك يفضل مشترك.
 *
 * The instruction this work was built under: «نظام مترابط وشغال كله مع بعض ككتلة واحدة، مش شوية
 * اسكريبتات». Two surfaces carry that — the movement history and the document audit trail — and
 * both are one component reading one endpoint.
 *
 * The way that decays is ordinary and quiet: a screen needs «سجل بسيط» and fetches the card
 * endpoint itself rather than opening the shared one. Nothing breaks that day. Six months later
 * there are four movement logs, two of them showing the balance before a movement and two showing
 * it after, and nobody can say which is right.
 *
 * So the rule is written down: only the screen that OWNS a report may call its endpoint directly.
 * Everyone else opens the shared component.
 */

const PAGES = join(__dirname, '..', 'pages');
const pageFiles = readdirSync(PAGES).filter((f) => f.endsWith('.tsx'));
const read = (f: string) => readFileSync(join(PAGES, f), 'utf8');

describe('سجل عمليات الصنف', () => {
  /**
   * الشاشات اللي **بتملك** تقرير على المصدر ده — ومن حقها تنده عليه.
   *
   * `ItemCard` هي كارت الصنف نفسه. و`AccountStatement` بقت تعمل **كشف صنف**: مش سجل
   * حركات جوّه شاشة، ده نفس كشف الحساب بأعمدته وفلاتره وطباعته وروابطه، والصنف بقى
   * موضوع فيه زي الحساب. الشاشة اللي عايزة تعرض سجل جوّاها لسه بتفتح المشترك.
   *
   * والخطر اللي القاعدة دي بتحمي منه — نسختين بيقولوا أرقام مختلفة — مقفول هنا: الكشف
   * بيعرض `balance_before`/`balance_after` زي ما بيرجعوا من المصدر، مابيحسبش رصيد من عنده.
   * ولو ده اتغيّر يوم، الاختبار ده هو المكان اللي بيفكّر إن فيه قارئين مش واحد.
   */
  const OWNERS = ['ItemCard.tsx', 'AccountStatement.tsx'];

  it('is fetched by its own screens and by the shared log — nobody else', () => {
    const direct = pageFiles.filter((f) => !OWNERS.includes(f)
      && /items\/\$\{[^}]+\}\/card/.test(read(f)));
    expect(direct, 'شاشة بتعمل سجل حركات لنفسها بدل ما تستعمل المشترك').toEqual([]);
  });

  it('is actually reachable from the screens a difference is read on', () => {
    // A shared surface nobody opens is not shared, it is unused. These are the three screens where
    // a quantity raises «الرقم ده جه منين». It renders in place now rather than as a modal — the
    // difference being explained is on the row behind it, and a popup covered it.
    const users = pageFiles.filter((f) => read(f).includes('MovementHistoryLog'));
    expect(users).toEqual(
      expect.arrayContaining(['StockBalance.tsx', 'StockCounts.tsx', 'Stocktake.tsx']));
  });
});

describe('سجل عمليات المستند', () => {
  /** The audit screen shows the whole log; that is what it is for. */
  const OWNER = 'Audit.tsx';

  it('is fetched by its own screen and by the shared modal — nobody else', () => {
    const direct = pageFiles.filter((f) => f !== OWNER
      && /api\/v1\/audit/.test(read(f)));
    expect(direct, 'شاشة بتقرا سجل التدقيق بنفسها').toEqual([]);
  });

  it('is written against an entity type rather than against transfers', () => {
    // The whole reason it can be given to an invoice later without new code.
    const src = readFileSync(join(__dirname, 'DocumentAuditModal.tsx'), 'utf8');
    expect(src).toMatch(/entityType/);
    expect(src).not.toMatch(/['"]stock_transfer['"]/);
  });
});
