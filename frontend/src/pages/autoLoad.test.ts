/**
 * أي فلتر بيتغيّر، الداتا بتتحمّل — من غير زرار تاني.
 *
 * These screens sent their filters to the SERVER and reloaded on `useEffect(…, [])` — once, on
 * open. Change the period, the warehouse, the branch, and nothing moved until a separate «تطبيق»
 * or «عرض» was pressed. That reads as broken rather than as a two-step flow: the person changes
 * the filter, sees the old numbers, and either believes them — the dangerous half — or presses the
 * button and wonders why it was needed.
 *
 * The refresh button stays, and still earns its place: re-reading the SAME filters after somebody
 * else has posted something is a real thing to want.
 *
 * Only server-side filters are covered here. A screen that loads everything and narrows in the
 * browser (جرد المخازن، سجل العمليات) is already instant, and adding it to this list would be
 * asserting something that cannot fail.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

/** كل `useEffect(() => { load(); }, [deps])` — بيرجّع اللي جوه القوسين. */
function loadEffectDeps(src: string): string[] {
  return [...src.matchAll(/useEffect\(\(\) => \{ ?(?:load|run)\(\); ?\}, \[([^\]]*)\]\)/g)]
    .map((m) => m[1].trim());
}

describe('التقارير بتحمّل مع الفلتر', () => {
  it('كل تبويبات «التقارير الشاملة» بتحمّل على تغيير الفلتر', () => {
    const deps = loadEffectDeps(read('Reports.tsx'));
    expect(deps.length, 'مالقاش أي useEffect للتحميل — الاختبار بيقرا حاجة اتغيّرت').toBe(5);
    const empty = deps.filter((d) => d === '');
    expect(empty, 'تبويب بيحمّل مرة واحدة بس — الفلتر مابيعملش حاجة').toEqual([]);
  });

  it('ميزان المراجعة بيحمّل على تغيير الفترة والفرع ومركز التكلفة', () => {
    const src = read('GeneralLedger.tsx');
    const deps = loadEffectDeps(src);
    const trial = deps.find((d) => d.includes('branchId'));
    expect(trial, 'ميزان المراجعة لسه بيحمّل مرة واحدة بس').toBeTruthy();
    for (const filter of ['range', 'branchId', 'costCenterId']) {
      expect(trial).toContain(filter);
    }
  });

  it.each([
    ['كارت الصنف', 'ItemCard.tsx', ['itemId', 'range']],
    ['جرد حتى تاريخ', 'Stocktake.tsx', ['asOf']],
    ['كشف الحساب', 'AccountStatement.tsx', ['accountId', 'range']],
  ])('%s بيحمّل مع فلاتره', (_name, file, filters) => {
    const deps = loadEffectDeps(read(file)).join(' ');
    for (const filter of filters) expect(deps).toContain(filter);
  });

  it('الفلاتر اللي في الاعتماديات كلها useState مش كائنات بتتعمل كل رسمة', () => {
    // A dependency rebuilt on every render turns «reload when it changes» into an endless loop —
    // load, setState, render, load. Every filter named in a dep array below is `useState`, so its
    // reference only moves when somebody actually changes it.
    for (const file of ['Reports.tsx', 'GeneralLedger.tsx']) {
      const src = read(file);
      for (const dep of loadEffectDeps(src).join(',').split(',').map((d) => d.trim())) {
        if (!dep) continue;
        expect(
          new RegExp(`(const \\[${dep},|${dep}[,}]\\s*)`).test(src),
          `«${dep}» في «${file}» مش حالة ولا خاصية — لو كائن بيتبني كل رسمة الصفحة هتلف`,
        ).toBe(true);
      }
    }
  });
});
