/**
 * الخط في النظام كله لازم يفضل مقروء.
 *
 * الكلام كان باهت لتلات أسباب مجتمعة: Cairo عند وزن ٤٠٠ خط عربي رفيع، والنص كان `#333`
 * على خلفية `#f5f5f5`، ومفيش تنعيم فالحروف بتطلع مهرّشة على ويندوز. وفوق ده، ٧٤ مكان في
 * الكود بيستعملوا `#8a8a8a` للنص الثانوي — تباينه ٣٫٤:١، تحت الحد المقروء.
 *
 * الاختبارات دي بتقفل القرارات دي. مش زينة: عمود من غير عنوان مقروء رقم مجهول، ورقم كمية
 * بيتقرا غلط بيتكلّف.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname);
const css = readFileSync(join(SRC, 'index.css'), 'utf8');
const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe('الأساس', () => {
  it('الوزن ٥٠٠ مش ٤٠٠', () => {
    // Cairo عند ٤٠٠ أرفع من اللاتيني على نفس الرقم.
    const base = css.slice(css.indexOf('html,\nbody,\n#root {'));
    expect(base.slice(0, 500)).toContain('font-weight: 600');
  });

  it('لون النص أغمق من #333', () => {
    const base = css.slice(css.indexOf('html,\nbody,\n#root {'));
    expect(base.slice(0, 500)).toContain('color: #141414');
  });

  it('التنعيم مفعّل', () => {
    // من غيره الحروف العربية بتطلع مهرّشة على ويندوز — وده بيتقري «مش واضح» حتى لما
    // الحجم كفاية.
    expect(css).toContain('-webkit-font-smoothing: antialiased');
  });

  it('التوكنز بتاعت antd متظبطة كمان مش الـCSS بس', () => {
    // antd بتحقن ألوانها في مكوّنات مالهاش كلاس ينفع يتمسك من `index.css`.
    expect(app).toContain('fontSize: 15');
    expect(app).toContain("colorText: '#141414'");
    expect(app).toContain("colorTextSecondary: '#303030'");
  });
});

describe('مفيش رمادي تحت حد القراءة', () => {
  it('#8a8a8a اتشال من كل الكود', () => {
    // تباينه على أبيض ٣٫٤:١ — تحت ٤٫٥:١، الحد اللي النص بيبقى مقروء عنده.
    const guilty = walk(SRC)
      .filter((f) => readFileSync(f, 'utf8').includes('#8a8a8a'))
      .map((f) => f.replace(SRC, ''));
    expect(guilty, `لسه فيه رمادي باهت في: ${guilty.join('، ')}`).toEqual([]);
  });

  it('عناوين الأعمدة وأسماء الحقول مغمّقة', () => {
    const block = css.slice(css.indexOf('.ant-table-thead > tr > th,'));
    expect(block.slice(0, 300)).toContain('#303030');
    expect(block.slice(0, 300)).toContain('font-weight: 700');
  });
});

describe('الخط متحزّم مش متحمّل', () => {
  it('مفيش أي طلب خط من الإنترنت في الواجهة', () => {
    /*
     * ده على الأرجح كان السبب الحقيقي في «مش واضح».
     *
     * الخط كان بيتحمّل من Google Fonts بـ`@import`. تطبيق الديسكتوب من غير نت — أو أول رسمة
     * قبل ما الطلب يرجع — بيقع على خط بديل، والعربي في الخط البديل بيبان رفيع ومشوّه.
     * وزيادة الوزن مابتصلّحش ده، لأن الوزن اللي بتطلبه أصلاً مش موجود.
     */
    expect(css, 'الخط لسه بيتحمّل من الإنترنت').not.toContain('fonts.googleapis.com');
    expect(css).toContain("@import '@fontsource-variable/cairo'");

    const html = readFileSync(join(SRC, '..', 'index.html'), 'utf8');
    expect(html, 'لسه فيه رابط خط في الـHTML').not.toContain('fonts.googleapis.com');
  });

  it('ارتفاع السطر مريح — العربي فيه نقط وذيول', () => {
    expect(css.slice(0, 2000)).toContain('line-height: 1.6');
  });
});
