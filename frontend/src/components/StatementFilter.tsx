import React, { useEffect, useRef, useState } from 'react';
import { Input } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { textColumn } from './gridColumns';
import { normalizeAr } from '../utils/arabicSort';

export default function StatementFilter({
  value, onChange, style, placeholder = 'البيان يحتوي على…',
}: {
  value: string;
  onChange: (v: string) => void;
  style?: React.CSSProperties;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  const sent = useRef(value);

  useEffect(() => {
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
      prefix={<FileTextOutlined style={{ color: '#555b65' }} />}
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

export const statementMatches = (needle: string, ...texts: Array<string | null | undefined>) => {
  const n = normalizeAr(needle);
  if (!n) return true;
  return texts.some((t) => normalizeAr(t).includes(n));
};

export function statementColumn<T extends { statement?: string | null }>(rows: T[]) {
  return {
    title: 'البيان',
    dataIndex: 'statement',
    key: 'statement',
    width: 220,
    ellipsis: true,
    ...textColumn(rows, (r: T) => r.statement),
    render: (v: string | null) => v || <span style={{ color: '#555b65' }}>-</span>,
  };
}
