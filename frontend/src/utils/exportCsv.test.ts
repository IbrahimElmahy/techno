/**
 * الحتة اللي كانت مكسورة في أربع شاشات من ست: علامة التنصيص جوه القيمة.
 *
 * Four of the six hand-rolled CSV exporters wrapped every value in quotes and never doubled the
 * quotes inside it. One `"` in a customer's name — «شركة "النور" للتجارة» is an ordinary way to
 * write a name — and the row silently gains a column: the file opens, reads plausibly, and every
 * figure after that cell is under the wrong heading. That is the worst kind of wrong, because
 * nobody checks a file that opened fine.
 */
import { describe, expect, it } from 'vitest';

import { buildCsv, columnsFromTable, type CsvColumn } from './exportCsv';

interface Row {
  name: string;
  qty: number;
  note?: string | null;
}

const cols: CsvColumn<Row>[] = [
  { title: 'الصنف', value: 'name' },
  { title: 'الكمية', value: 'qty' },
];

/** بيشيل الـBOM عشان المقارنة تبقى على المحتوى. */
const body = (text: string) => text.replace(/^﻿/, '');

describe('buildCsv', () => {
  it('بيهرب علامة التنصيص اللي جوه القيمة', () => {
    const csv = body(buildCsv(cols, [{ name: 'شركة "النور" للتجارة', qty: 3 }]));
    expect(csv).toBe('"الصنف","الكمية"\n"شركة ""النور"" للتجارة","3"');
  });

  it('بيبدأ بعلامة BOM — من غيرها إكسل بيفتح العربي طلاسم', () => {
    expect(buildCsv(cols, [])).toMatch(/^﻿/);
  });

  it('null و undefined بيبقوا خانة فاضية مش النص "null"', () => {
    const withNote: CsvColumn<Row>[] = [...cols, { title: 'ملاحظة', value: 'note' }];
    const csv = body(buildCsv(withNote, [
      { name: 'أ', qty: 1, note: null },
      { name: 'ب', qty: 2 },
    ]));
    expect(csv.split('\n')[1]).toBe('"أ","1",""');
    expect(csv.split('\n')[2]).toBe('"ب","2",""');
  });

  it('صفر بيتكتب صفر — مش خانة فاضية', () => {
    // `value ?? ''` is right; `value || ''` would silently blank every zero, and a stock report
    // full of blanks where the count is nil reads as «مش متعدّ» instead of «صفر».
    const csv = body(buildCsv(cols, [{ name: 'أ', qty: 0 }]));
    expect(csv.split('\n')[1]).toBe('"أ","0"');
  });

  it('بيقبل دالة للأعمدة المحسوبة', () => {
    const computed: CsvColumn<Row>[] = [
      { title: 'الصنف', value: 'name' },
      { title: 'المضاعف', value: (r) => r.qty * 2 },
    ];
    const csv = body(buildCsv(computed, [{ name: 'أ', qty: 5 }]));
    expect(csv.split('\n')[1]).toBe('"أ","10"');
  });

  it('من غير صفوف بيطلع سطر العناوين بس', () => {
    expect(body(buildCsv(cols, []))).toBe('"الصنف","الكمية"');
  });
});

describe('columnsFromTable', () => {
  it('بيستبعد أعمدة الأزرار — مالهاش داتا ورا فبتطلع عمود فاضي بعنوان', () => {
    const result = columnsFromTable([
      { title: 'الاسم', dataIndex: 'name' },
      { title: '', key: 'actions' },
      { title: 'الكمية', dataIndex: 'qty' },
    ]);
    expect(result.map((c) => c.value)).toEqual(['name', 'qty']);
  });
});
