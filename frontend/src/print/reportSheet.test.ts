/**
 * A printed report is read on paper, months later, by somebody who cannot check it against the
 * screen. Two things have to hold: the markup must survive a customer whose name contains `<`,
 * and an empty result must SAY it is empty rather than print a blank page that reads as a
 * missing report.
 */
import { describe, expect, it } from 'vitest';

import { type PrintColumn, reportTableHtml } from './reportSheet';

interface Row {
  name: string;
  amount: number;
}

const cols: PrintColumn<Row>[] = [
  { title: 'الاسم', value: 'name' },
  { title: 'المبلغ', value: 'amount', numeric: true },
];

describe('reportTableHtml', () => {
  it('بيهرب رموز الـHTML — اسم فيه أقواس مايبقاش وسم', () => {
    const html = reportTableHtml(cols, [{ name: '<b>النور</b>', amount: 5 }]);
    expect(html).toContain('&lt;b&gt;النور&lt;/b&gt;');
    expect(html).not.toContain('<b>النور</b>');
  });

  it('تقرير فاضي بيقول إنه فاضي — مش صفحة بيضا', () => {
    const html = reportTableHtml(cols, []);
    expect(html).toContain('مفيش بيانات في المدى المحدد');
    expect(html).toContain(`colspan="2"`);
  });

  it('الأعمدة الرقمية بتتحاذي لليمين بالاتجاه الصح', () => {
    const html = reportTableHtml(cols, [{ name: 'أ', amount: 12 }]);
    expect(html).toContain('direction:ltr');
  });

  it('صفر بيتطبع صفر، وnull بيبقى خانة فاضية', () => {
    const withNull: PrintColumn<any>[] = [{ title: 'ق', value: 'v' }];
    const html = reportTableHtml(withNull, [{ v: 0 }, { v: null }]);
    expect(html).toContain('<td>0</td>');
    expect(html).toContain('<td></td>');
  });

  it('الإجماليات بتطلع في جدول لوحدها لما تتبعت', () => {
    const html = reportTableHtml(cols, [{ name: 'أ', amount: 1 }], [
      { label: 'الإجمالي', value: '1.00' },
    ]);
    expect(html).toContain('class="totals"');
    expect(html).toContain('الإجمالي');
  });

  it('من غير إجماليات مافيش جدول إجماليات', () => {
    expect(reportTableHtml(cols, [{ name: 'أ', amount: 1 }])).not.toContain('class="totals"');
  });

  it('بيقبل دالة للأعمدة المحسوبة', () => {
    const computed: PrintColumn<Row>[] = [{ title: 'المضاعف', value: (r) => r.amount * 2 }];
    expect(reportTableHtml(computed, [{ name: 'أ', amount: 6 }])).toContain('<td>12</td>');
  });
});
