import React from 'react';

export interface LadderRow {
  label: React.ReactNode;
  value: string;
  rule?: boolean;
  big?: boolean;
  strong?: boolean;
  color?: string;
  show?: boolean;
  highlight?: boolean;
}

interface Props {
  inputs: React.ReactNode;
  rows: LadderRow[];
  notes?: React.ReactNode[];
  tone?: 'sale' | 'return';
  currency?: string;
}

const TONES = {
  sale: { bg: '#f6faf3', border: '#e6efe3', rule: '#d8e6d2' },
  return: { bg: '#fdf6f3', border: '#f3e2da', rule: '#f0d9cd' },
};

export default function TotalsLadder({
  inputs, rows, notes = [], tone = 'sale', currency = '',
}: Props) {
  const t = TONES[tone];
  const visible = rows.filter((r) => r.show !== false);
  const shownNotes = notes.filter(Boolean);

  return (
    <div style={{
      background: t.bg, border: `1px solid ${t.border}`, borderRadius: 10, padding: 10,
    }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div className="ladder-inputs"
          style={{ flex: '1 1 260px', minWidth: 240, maxWidth: 340 }}>{inputs}</div>

        <div style={{ flex: '3 1 480px', minWidth: 280 }}>
          <div style={{
            display: 'grid', gap: 6,
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          }}>
            {visible.filter((r) => !r.big).map((r, i) => (
              <div key={i} style={{
                background: r.highlight ? '#f2fbee' : '#fff',
                border: `1px solid ${r.highlight ? '#b9dca5' : t.border}`,
                borderInlineStart: r.highlight ? '3px solid #6AB42D' : `1px solid ${t.border}`,
                borderRadius: 8, padding: '5px 10px',
              }}>
                <div style={{
                  fontSize: 14,
                  color: r.highlight ? '#3f6b26' : '#6b6b6b',
                  fontWeight: r.highlight ? 700 : 500,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{r.label}</div>
                <div style={{
                  fontSize: 15, fontWeight: r.strong ? 800 : 700, color: r.color,
                  whiteSpace: 'nowrap',
                }}>
                  {r.value}{currency ? ` ${currency}` : ''}
                </div>
              </div>
            ))}
          </div>
          {visible.filter((r) => r.big).map((r, i) => (
            <div key={`big-${i}`} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginTop: 6, padding: '6px 12px', borderRadius: 8,
              background: '#fff', border: `1px solid ${t.rule}`,
            }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#4a4a4a' }}>{r.label}</span>
              <span style={{ fontSize: 22, fontWeight: 800, color: r.color }}>
                {r.value}{currency ? ` ${currency}` : ''}
              </span>
            </div>
          ))}

          {shownNotes.length > 0 && (
            <div style={{
              display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 6, paddingTop: 6,
              borderTop: `1px dashed ${t.rule}`, fontSize: 14, color: '#6b6b6b',
            }}>
              {shownNotes.map((n, i) => <span key={i}>{n}</span>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
