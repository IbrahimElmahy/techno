import React from 'react';
import { Segmented, Space, Switch, Tag, Tooltip } from 'antd';

/**
 * خيارات التقارير المشتركة — زي شريط الخيارات في تقارير أودو.
 *
 * أودو مابيديش كل تقرير خياراته؛ فيه خيارات واحدة كل التقارير بتاخدها، عشان لما
 * تتعلّم «قارن بالسنة اللي فاتت» في قائمة الدخل تلاقيها في الميزانية بنفس المعنى
 * بالظبط. الشريط ده هو الاتنين اللي بيفرقوا عندنا:
 *
 * * **كل القيود / المرحّل بس** — الافتراضي المرحّل، عشان الرقم اللي بيتطبع يبقى
 *   الحقيقة. والمحاسب في آخر الشهر بيقلبها عشان يشوف أثر المسودات قبل ما يرحّلها.
 *   الملغي بره في الحالتين — «كل القيود» يعني كل اللي ممكن يبقى حقيقة.
 * * **المقارنة** — الرقم لوحده مابيقولش «كويس ولا وحش»؛ اللي بيقول هو اللي جنبه.
 *
 * الشريط بيقول الخيار المش-افتراضي بشريحة ملوّنة: تقرير بمسودات جوّاه لازم يبان
 * إنه كده، وإلا حد بيطبعه ويوقّع عليه وهو فاكره الأرقام المرحّلة.
 */

export type Comparison = 'none' | 'previous' | 'last_year';

export interface ReportOptions {
  postedOnly: boolean;
  comparison: Comparison;
}

export const DEFAULT_REPORT_OPTIONS: ReportOptions = {
  postedOnly: true,
  comparison: 'none',
};

/** الشكل اللي الـAPI بياخده. */
export const reportParams = (o: ReportOptions) => ({
  posted_only: o.postedOnly,
  comparison: o.comparison,
});

export default function ReportOptionsBar({
  value, onChange, showComparison = true,
}: {
  value: ReportOptions;
  onChange: (v: ReportOptions) => void;
  /** التقرير اللي مالوش معنى يتقارن (الأعمار مثلاً) بيخفيها. */
  showComparison?: boolean;
}) {
  return (
    <Space wrap size={12} align="center">
      <Tooltip title="المرحّل بس هو الافتراضي. «كل القيود» بتضم المسودات — والملغي بره في الحالتين.">
        <Space size={6}>
          <Switch
            size="small"
            checked={!value.postedOnly}
            onChange={(on) => onChange({ ...value, postedOnly: !on })}
          />
          <span>كل القيود</span>
          {!value.postedOnly && <Tag color="orange">شامل المسودات</Tag>}
        </Space>
      </Tooltip>

      {showComparison && (
        <Space size={6}>
          <span style={{ color: '#888' }}>مقارنة:</span>
          <Segmented
            size="small"
            value={value.comparison}
            onChange={(v) => onChange({ ...value, comparison: v as Comparison })}
            options={[
              { value: 'none', label: 'بدون' },
              { value: 'previous', label: 'الفترة السابقة' },
              { value: 'last_year', label: 'العام الماضي' },
            ]}
          />
        </Space>
      )}
    </Space>
  );
}

/** الفرق ونسبته — `null` لما اللي قبله صفر، لأن القسمة على صفر مش «زيادة ١٠٠٪». */
export function delta(now: string | number, before: string | number) {
  const a = Number(now || 0);
  const b = Number(before || 0);
  const diff = a - b;
  return { diff, pct: b ? (diff / b) * 100 : null };
}

/** خلية الفرق — لون بيقول اتجاهه، والنسبة جنبه لما يكون ليها معنى. */
export function DeltaCell({ now, before, goodWhenUp = true }: {
  now: string | number; before: string | number; goodWhenUp?: boolean;
}) {
  const { diff, pct } = delta(now, before);
  if (!diff) return <span style={{ color: '#bbb' }}>—</span>;
  const good = goodWhenUp ? diff > 0 : diff < 0;
  return (
    <span style={{ color: good ? '#2e9e6b' : '#d64545', whiteSpace: 'nowrap' }}>
      {diff > 0 ? '▲' : '▼'}{' '}
      {Math.abs(diff).toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      {pct !== null && <span style={{ fontSize: 12 }}> ({Math.abs(pct).toFixed(1)}%)</span>}
    </span>
  );
}
