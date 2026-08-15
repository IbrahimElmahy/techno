/**
 * قراية ملف البصمة على الجهاز — الفاصل والـBOM.
 *
 * The file is parsed in the browser and posted as a table, so no upload endpoint, no encoding
 * negotiation and no `xlsx` dependency on either side. Which puts two things on this function that
 * will bite if they are wrong, and neither of them throws:
 *
 * - **Excel on an Arabic Windows writes `;`, not `,`.** Split on the comma and every row is one
 *   cell wide, so every row is «ناقص أعمدة» and the import reports a file of rubbish — from a file
 *   that is perfectly fine. Guessing from the header beats asking somebody which Excel wrote it.
 * - **The BOM.** `﻿` glued to the first heading makes column zero unrecognisable, and only
 *   column zero — which reads as "the employee column mapping is wrong" rather than as an encoding
 *   problem.
 */
import { describe, expect, it } from 'vitest';

import { minutesLabel, parseCsv } from './Attendance';

describe('parseCsv', () => {
  it('بيقرا ملف بفاصلة عادية', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('بيقرا ملف إكسل العربي بالفاصلة المنقوطة', () => {
    expect(parseCsv('الموظف;التاريخ;الوقت\nEMP-1;2026-08-17;09:00')).toEqual([
      ['الموظف', 'التاريخ', 'الوقت'],
      ['EMP-1', '2026-08-17', '09:00'],
    ]);
  });

  it('بيشيل الـBOM من أول عمود', () => {
    // من غير ده «الموظف» بيبقى «﻿الموظف» وعمود صفر لوحده بيبوظ.
    const [head] = parseCsv('﻿الموظف,التاريخ\nEMP-1,2026-08-17');
    expect(head[0]).toBe('الموظف');
  });

  it('بيشيل علامات التنصيص اللي حوالين الخانة', () => {
    expect(parseCsv('"a","b"')).toEqual([['a', 'b']]);
  });

  it('بيتجاهل السطور الفاضية', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('بيقرا نهايات أسطر ويندوز', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('ملف فاضي بيرجع مفيش', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n\n')).toEqual([]);
  });
});

describe('minutesLabel', () => {
  it('بيحوّل الدقايق لساعات ودقايق', () => {
    expect(minutesLabel(90)).toBe('1:30');
    expect(minutesLabel(120)).toBe('2:00');
  });

  it('أقل من ساعة بتفضل دقايق', () => {
    expect(minutesLabel(15)).toBe('15 د');
  });

  it('صفر بيبقى شرطة مش «٠ د»', () => {
    // عمود مليان أصفار بيخفي التأخيرات الحقيقية.
    expect(minutesLabel(0)).toBe('—');
  });
});
