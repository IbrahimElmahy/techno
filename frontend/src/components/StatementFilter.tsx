import React, { useEffect, useRef, useState } from 'react';
import { Input } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { textColumn } from './gridColumns';
import { normalizeAr } from '../utils/arabicSort';

/**
 * خانة «البيان» في شريط فلاتر التقارير — واحدة لكل التقارير.
 *
 * «البيان» هو الكلام الحر اللي المستخدم بيكتبه على المستند («توريد مشروع التجمع»،
 * «بضاعة معرض»). العميل عايز يفلتر بيه في أي تقرير، فالخانة دي بتتحط جنب الفترة والعميل
 * في كل شاشة تقارير بنفس الشكل ونفس السلوك:
 *
 * * **بتستنى لحد ما يخلص كتابة.** التقارير دي بتتحسب في السيرفر، وطلب مع كل حرف معناه
 *   عشر طلبات لكلمة واحدة والنتيجة بتترعش. ٤٠٠ مللي من آخر حرف، أو Enter على طول.
 * * **جزء من الكلام، بتوحيد الهمزات والتاء المربوطة** — نفس قاعدة مربع البحث
 *   (`normalizeAr` هنا و`lib/report_statement.py` في السيرفر). «فاتوره» بتلاقي «فاتورة».
 * * **المسح بيرجّع التقرير كله** — زرار × في الخانة نفسها.
 */
export default function StatementFilter({
  value, onChange, style, placeholder = 'البيان يحتوي على…',
}: {
  value: string;
  onChange: (v: string) => void;
  style?: React.CSSProperties;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  // آخر قيمة اتبعتت للأب — عشان لما الأب يرجّعها لنا مانمسحش المسافة اللي في آخر
  // الكلام وهو لسه بيكتب الكلمة التانية.
  const sent = useRef(value);

  useEffect(() => {
    // الأب مسح الفلتر (تقرير تاني اتفتح، أو «مسح الفلاتر») — الخانة تتمسح معاه.
    if (value !== sent.current) { sent.current = value; setText(value); }
  }, [value]);

  const push = (v: string) => {
    const t = v.trim();
    if (t === sent.current) return;
    sent.current = t;
    onChange(t);
  };

  useEffect(() => {
    const id = setTimeout(() => push(text), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <Input
      allowClear
      prefix={<FileTextOutlined style={{ color: '#8c8c8c' }} />}
      placeholder={placeholder}
      aria-label="البيان"
      title="البيان — جزء من الكلام المكتوب على المستند"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onPressEnter={() => push(text)}
      style={{ width: '100%', ...style }}
    />
  );
}

/** نفس المطابقة للتقارير اللي بتتفلتر في الشاشة (كشف الحساب، دفتر الشريك). */
export const statementMatches = (needle: string, ...texts: Array<string | null | undefined>) => {
  const n = normalizeAr(needle);
  if (!n) return true;
  return texts.some((t) => normalizeAr(t).includes(n));
};

/** عمود «البيان» في جداول التقارير — `statement` جاي من السيرفر جاهز في سطر واحد. */
export function statementColumn<T extends { statement?: string | null }>(rows: T[]) {
  return {
    title: 'البيان',
    dataIndex: 'statement',
    key: 'statement',
    width: 220,
    ellipsis: true,
    ...textColumn(rows, (r: T) => r.statement),
    render: (v: string | null) => v || <span style={{ color: '#8c8c8c' }}>-</span>,
  };
}
