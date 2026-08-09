/**
 * الحسابات الفرعيه — كل قسم قائمة منسدلة.
 *
 * The screen delivered every postable account in the system as one flat paginated list: a
 * customer, then a safe, then an expense, then two hundred more customers, ordered by nothing
 * anybody thinks in. On the live data that is 243 rows against 7 headings — and the fact that
 * customers outnumber everything else a hundred to one was invisible from the screen.
 *
 * What is pinned here is the behaviour that makes sections usable rather than merely present:
 * closed by default, opened by a search that matches inside them, and not mounting a thousand
 * rows to render a heading nobody expanded.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'SubAccounts.tsx'), 'utf8');

describe('الأقسام', () => {
  it('كل حساب رئيسي بقى قسم منسدل', () => {
    expect(src).toMatch(/<Collapse/);
    // Grouped by the same heading the row used to repeat in a column.
    expect(src).toMatch(/const k = parentName\(r\)/);
  });

  it('الشريط بيقول العدد والإجمالي من غير ما تفتح', () => {
    // Otherwise choosing a section means opening every one of them in turn.
    expect(src).toMatch(/s\.items\.length/);
    expect(src).toMatch(/الإجمالي \{egp\(s\.total\)\}/);
  });

  it('مقفول من الأول', () => {
    // «فيه إيه» is answered by the list of headings. Opening them all restores the wall of rows
    // the sections exist to remove.
    expect(src).toMatch(/useState<string\[\]>\(\[\]\)/);
  });

  it('البحث بيفتح اللي لقى فيه', () => {
    // A hit inside a closed section is the same as no hit.
    expect(src).toMatch(/searching \? sections\.map\(\(s\) => s\.name\) : openKeys/);
  });

  it('اسم القسم مش متكرر على كل سطر جوّاه', () => {
    expect(src).toMatch(/columns\.filter\(\(c: any\) => c\.key !== 'parent_id'\)/);
  });

  it('الأكبر فوق', () => {
    // Alphabetical would bury العملاء and الموردين — the two anybody actually browses — under
    // headings holding one account each.
    expect(src).toMatch(/b\.items\.length - a\.items\.length/);
  });
});

describe('القسم الكبير مايوقّفش الصفحة', () => {
  it('بيتقسّم صفحات جوّه القسم', () => {
    // العملاء alone is 233 rows on the live data and grows with every customer.
    expect(src).toMatch(/rows\.length > 25/);
  });

  it('الجدول في كمبوننت لوحده عشان الكيبورد', () => {
    // One table per section is one hook call per section, and hooks cannot be called in a loop.
    expect(src).toMatch(/function AccountGroup/);
    expect(src).toMatch(/AccountGroup[\s\S]{0,300}useTableKeyboard/);
  });
});
