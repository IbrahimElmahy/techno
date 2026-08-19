/**
 * مفيش بوباب «متأكد؟» في النظام — بطلب صاحبه.
 *
 * كان كل فعل بيغيّر حاجة بيسأل الأول: الحذف، الإقفال، العكس، التعديل على مستند مرحّل. اتنين
 * وتسعين موضع. صاحب النظام شافهم وقال يشيلهم كلهم.
 *
 * **اللي اتشال هو السؤال مش الحارس.** حمايات السيرفر كلها مكانها: الحذف بيقفل مش بيمسح،
 * والقيد مابيتعدلش في مكانه والتصحيح عكس، والفترة المقفولة بترفض، والسيرفر بيرفض حذف صنف عليه
 * حركة. الاختبار ده بيمسك الفرق: لو حد شال الحارس وهو فاكر إنه بيشيل السؤال، بيحمّر.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');
const read = (p: string) => readFileSync(p, 'utf8');

/** كل ملف بالاسم والمسار — الاسم متخزّن عشان استخراجه من المسار بيختلف بين ويندوز ولينكس. */
function tsxFiles(dir: string): { name: string; path: string }[] {
  return readdirSync(join(SRC, dir))
    .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
    .map((f) => ({ name: f, path: join(SRC, dir, f) }));
}

const files = [...tsxFiles('pages'), ...tsxFiles('components')];

/**
 * الاستثناءان الوحيدان، وكل واحد ليه سبب:
 *
 * - `AppLayout` بيعرض إن فيه نسخة أحدث للتحميل. ده عرض مش تحذير، ومابيغيّرش حاجة في الداتا.
 * - `TabModal` بيذكر `Modal.confirm` في تعليق بيشرح ليه مش بيتأثر بالتبويبات — نص مش نداء.
 *
 * سؤال «سايب فاتورة لسه ماتحفظتش» اتشال هو كمان: صاحب النظام قال يشيل الكل، والنوع ده منهم.
 */
const ALLOWED = ['AppLayout.tsx', 'TabModal.tsx'];
const UNSAVED_WORK: string[] = [];

describe('مفيش تأكيدات', () => {
  it('مفيش Modal.confirm على فعل بيغيّر داتا', () => {
    const offenders = files
      .filter((f) => read(f.path).includes('Modal.confirm'))
      .map((f) => f.name)
      .filter((f) => !ALLOWED.includes(f) && !UNSAVED_WORK.includes(f));
    expect(offenders, `رجع بوباب تأكيد في: ${offenders.join('، ')}`).toEqual([]);
  });

  it('Popconfirm بيتستورد من الشيم مش من antd', () => {
    for (const f of files) {
      const src = read(f.path);
      if (!src.includes('<Popconfirm')) continue;
      expect(src, `«${f.name}» لسه بياخد Popconfirm من antd`)
        .toMatch(/import \{ Popconfirm \} from '\.\.?\/(components\/)?noConfirm'/);
    }
  });

  it('الشيم بينفّذ على طول', () => {
    const shim = read(join(SRC, 'components', 'noConfirm.tsx'));
    expect(shim).toContain('onConfirm?.(e)');
    // الوقفة دي لازمة: السطر بيفتح المستند لما يتضغط، وزرار الحذف جوّاه.
    expect(shim).toContain('e.stopPropagation()');
  });

  it('المساعدان المشتركان بينفّذوا من غير ما يسألوا', () => {
    const helper = read(join(SRC, 'components', 'ConfirmationDialog.tsx'));
    expect(helper).not.toContain('Modal.confirm');
    expect(helper).toContain('export function showReversalConfirm');
    expect(helper).toContain('export function showDeactivationConfirm');
  });
});

describe('الحراس مكانهم', () => {
  it('سيبان مستند نص كتابته بيمشي على طول', () => {
    for (const file of ['Invoices.tsx', 'Returns.tsx']) {
      const src = read(join(SRC, 'pages', file));
      expect(src, `«${file}» لسه بيسأل قبل ما يسيب`).not.toContain('Modal.confirm');
    }
  });

  it('الحذف النهائي لسه بينادي السيرفر اللي بيرفضه لو عليه حركة', () => {
    for (const [file, path] of [['Catalog.tsx', '/api/v1/items/'],
      ['Customers.tsx', '/api/v1/customers/'], ['Suppliers.tsx', '/api/v1/suppliers/']] as const) {
      const src = read(join(SRC, 'pages', file));
      expect(src, `«${file}» الحذف اتشال مش التأكيد`).toContain(`${path}`);
      expect(src).toContain('hard=true');
    }
  });
});
