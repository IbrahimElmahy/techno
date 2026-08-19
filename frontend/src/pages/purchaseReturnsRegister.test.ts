/**
 * سجل مردودات الشرا — نفس معاملة سجل الشرا.
 *
 * العميل طلب اللي اتعمل في صفحة الشرا يتعمل في المردود. اللي كان فيه: بحث والمورد وبس، وستة
 * أعمدة بلا فلتر ولا ترتيب، وفلتر التاريخ بيقيس يوم تسجيل الصف بدل يوم رجوع البضاعة.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'PurchaseReturns.tsx'), 'utf8');
const columnBlock = src.slice(src.indexOf('const columns = ['),
  src.indexOf("useHiddenColumns('purchase-returns-list'"));

describe('فلترة وترتيب على كل عمود', () => {
  it('كل عمود بيتفلتر ويتترتب', () => {
    const helpers = (columnBlock.match(/\.\.\.(textColumn|numberColumn|dateColumn)/g) || []).length;
    expect(helpers, 'فيه أعمدة من غير فلتر ولا ترتيب').toBeGreaterThanOrEqual(6);
  });

  it('القيمة بتتفلتر بمدى', () => {
    const at = columnBlock.indexOf("dataIndex: 'value'");
    expect(columnBlock.slice(at, at + 220)).toContain('numberColumn');
  });

  it('السجل بيفتح على الأحدث', () => {
    expect(columnBlock).toMatch(/return_date[\s\S]{0,300}defaultSortOrder: 'descend'/);
  });

  it('الفلتر بالتاريخ بيقيس يوم رجوع البضاعة', () => {
    expect(src).toMatch(/dateOf: \(r\) => r\.return_date \|\| r\.created_at/);
  });

  it('فيه عمود ملاحظات', () => {
    expect(columnBlock).toContain("dataIndex: 'notes'");
  });
});

describe('شريط الفلاتر', () => {
  it('اللي مابيتسألش كل يوم تحت طيّة', () => {
    const bar = src.slice(src.indexOf('<ListToolbar'), src.indexOf('<Table'));
    expect(bar).toMatch(/document_number'[\s\S]{0,140}advanced: true/);
    expect(bar).toMatch(/notes'[\s\S]{0,140}advanced: true/);
  });

  it('كل فلتر ليه منطق بيفلتر بيه', () => {
    const logic = src.slice(src.indexOf('const filter = useListFilter'), src.indexOf('dateOf:'));
    for (const key of ['supplier_id', 'document_number', 'purchase_document_number', 'notes']) {
      expect(logic, `«${key}» في الشريط ومالوش منطق`).toContain(`${key}:`);
    }
  });
});

describe('توزيع الصفحة', () => {
  it('الجدول مضغوط وبيتمرّر أفقياً', () => {
    expect(src).toMatch(/scroll=\{\{ x: 'max-content' \}\}/);
    expect(src).toContain('size="small"');
  });

  it('رقم السند مثبّت', () => {
    expect(columnBlock).toMatch(/document_number'[\s\S]{0,120}fixed: 'left'/);
  });

  it('فيه صف إجماليات على المعروض مش على السجل كله', () => {
    const summary = src.slice(src.indexOf('summary={(shown)'), src.indexOf('</Table.Summary>'));
    expect(summary).toContain('list.reduce');
    expect(summary, 'بيجمع من كل السجل').not.toContain('rows.reduce');
    // بيتبني من الأعمدة المعروضة عشان إخفاء عمود ما يزحّقش القيمة تحت عنوان تاني.
    expect(summary).toContain('cols.apply(columns)');
  });
});
