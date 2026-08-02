import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One way to answer «مين».
 *
 * The party window is not decoration. It is the only control in the system that can reach a
 * customer who has never been entered — it creates one inline — and the only one that shows the
 * balance and the phone while you choose. A screen that asks the same question with a bare
 * dropdown is not merely inconsistent: it is a dead end for the case the window exists for.
 *
 * That is exactly how the vouchers ended up: four fields asking «اختر العميل» from a list, on
 * screens sitting one menu entry away from documents that asked it properly.
 *
 * This reads the source rather than rendering, because what is being checked is that no screen
 * quietly grows a second answer to a question that already has one.
 */

const PAGES = join(__dirname, '..', 'pages');
const pageFiles = readdirSync(PAGES).filter((f) => f.endsWith('.tsx'));

/** Screens allowed to name a party without the window, each with the reason. */
const EXEMPT: Record<string, string> = {
  // Filters and reports pick from parties that ALREADY have rows on screen. Offering «create a
  // customer» while filtering a list by customer would be answering a question nobody asked.
  'AccountStatement.tsx': 'filter — chooses among parties that already have movements',
  'RepReports.tsx': 'filter',
  'Loyalty.tsx': 'filter',
  'CustomerProfile.tsx': 'opens a file for a party that exists by definition',
  'SupplierProfile.tsx': 'opens a file for a party that exists by definition',
  'CouponReceipts.tsx': 'the customer is the one the coupons were issued to — a fixed set',
  'Customers.tsx': 'the register of parties itself',
  'Suppliers.tsx': 'the register of parties itself',
  'TradeReports.tsx': 'filter',
  'FinanceReports.tsx': 'filter',
  'Reports.tsx': 'filter',
  'Audit.tsx': 'filter',
};

describe('choosing a party', () => {
  /** Screens holding at least one `Select` fed from the customer or supplier list. Detected by
   *  what feeds the control rather than by its placeholder — a placeholder is a label somebody
   *  can reword, and the rule would then stop noticing. */
  const asksForAParty = (src: string) => [...src.matchAll(/<Select\b/g)]
    .some((m) => /\b(customers|suppliers|customerOptions|supplierOptions)\b/
      .test(src.slice(m.index ?? 0, (m.index ?? 0) + 420)));

  it('goes through the window on every screen that CREATES a document', () => {
    const bare: string[] = [];
    pageFiles.forEach((f) => {
      if (f in EXEMPT) return;
      const src = readFileSync(join(PAGES, f), 'utf8');
      if (!asksForAParty(src)) return;
      if (!/api\.post\(/.test(src)) return;    // a register, not a report
      const usesWindow = src.includes('PartyPickerModal') || src.includes('PartyField');
      if (!usesWindow) bare.push(f);
    });
    expect(bare, 'a document screen picking a party without the window').toEqual([]);
  });

  it('actually has screens under it', () => {
    // A rule that matches nothing passes forever and guards nothing. If a refactor renames the
    // party lists, this fails and says so rather than going quietly green.
    const covered = pageFiles.filter((f) => {
      const src = readFileSync(join(PAGES, f), 'utf8');
      return asksForAParty(src) && /api\.post\(/.test(src);
    });
    expect(covered.length, 'the party rule matched no screen at all').toBeGreaterThanOrEqual(4);
  });

  it('leaves the exemption list honest', () => {
    // An exemption for a file that no longer exists is a comment pretending to be a rule.
    const missing = Object.keys(EXEMPT).filter((f) => !pageFiles.includes(f));
    expect(missing, 'exempted screens that no longer exist').toEqual([]);
  });
});
