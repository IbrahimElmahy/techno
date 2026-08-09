/**
 * الخزنة وحساب المصروف — القوايم اللي بيتقرر منها الفلوس تتحرك منين وعلى إيه.
 *
 * These two dropdowns decide where money moves on a screen whose only job is moving money, and
 * both used to show a bare name while the API returned everything needed to choose properly. The
 * checks here are about what a person can SEE and CHANGE, not about rendering.
 *
 * The last one is the one that was really missing: `active` was displayed as a «مخفي» tag and set
 * from nowhere, so a chart of accounts only ever grew and an account opened once by mistake stayed
 * in every voucher's list forever.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const fields = read('components/VoucherFields.tsx');
const vouchers = read('pages/Vouchers.tsx');
const subAccounts = read('pages/SubAccounts.tsx');

describe('الخزنة', () => {
  it('لازم تتختار — مفيش «سيبها والسيرفر يقرر»', () => {
    // A blank box labelled «الافتراضية» meant the money left a safe nobody named.
    expect(fields).toMatch(/name="treasury_id"[\s\S]{0,400}required: true/);
    expect(fields).not.toMatch(/name="treasury_id"[\s\S]{0,300}allowClear/);
  });

  it('بتفتح على الافتراضية مختارة، مش فاضية', () => {
    expect(fields).toMatch(/export function defaultTreasuryId/);
    // …and every form that has the field actually seats it.
    expect(vouchers).toMatch(/setFieldsValue\(\{ treasury_id: id \}\)/);
    const opens = vouchers.match(/openVoucher\((receipt|payment|expense)Form/g) || [];
    expect(new Set(opens).size).toBe(3);
  });

  it('بتعرض الرصيد والنوع — دي أصلاً راجعة من الـ API', () => {
    expect(fields).toMatch(/o\.balance/);
    expect(fields).toMatch(/kind === 'bank'/);
    expect(fields).toMatch(/isDefault/);
  });

  it('بتنبّه لو الرصيد أقل من المبلغ', () => {
    // Flagged while choosing, rather than refused at save.
    expect(fields).toMatch(/Number\(o\.balance\) < Number\(amount \|\| 0\)/);
  });
});

describe('حساب المصروف', () => {
  it('بيعرض الكود والاسم مع بعض', () => {
    // `name || code` showed one or the other, so two «مصروفات إدارية» under different codes were
    // the same line twice.
    expect(fields).toMatch(/\$\{a\.code \? `\$\{a\.code\} — ` : ''\}\$\{a\.name/);
    expect(fields).not.toMatch(/a\.name \|\| a\.code/);
  });

  it('بيعرض اللي اتصرف على الحساب', () => {
    expect(fields).toMatch(/spent/);
  });

  it('الحساب الجديد بيتحط تحت حساب رئيسي، مش سايب', () => {
    // A postable account with no parent belongs to no group: it disappears from دليل الحسابات and
    // from every report that walks the tree.
    expect(fields).toMatch(/name="parent_id"[\s\S]{0,200}required: true/);
    expect(fields).toMatch(/parent_id: v\.parent_id/);
  });

  it('القايمة بتستبعد المخفي', () => {
    expect(vouchers).toMatch(/is_postable && a\.active !== false/);
  });
});

describe('التحكم في القايمة نفسها', () => {
  it('ينفع تخفي حساب من قوايم الاختيار من الحسابات الفرعيه', () => {
    // The answer to «أعدّل الاختيارات دي منين». Renaming was the only thing possible before, so
    // the list could grow and never shrink.
    expect(subAccounts).toMatch(/active: !record\.active/);
    expect(subAccounts).toMatch(/toggleActive/);
  });

  it('الإخفاء مش حذف — القيود المترحّلة لسه بتلاقي اسم', () => {
    expect(subAccounts).not.toMatch(/api\.delete\(`\/api\/v1\/accounts/);
  });

  it('حسابات النظام محميّة من الإخفاء', () => {
    expect(subAccounts).toMatch(/onClick=\{\(\) => toggleActive\(record\)\}/);
    expect(subAccounts).toMatch(/<Button type="text" disabled=\{record\.is_system\}/);
  });
});
