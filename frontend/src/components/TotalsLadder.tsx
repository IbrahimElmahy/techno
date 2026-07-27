import React from 'react';

/**
 * The totals block every document ends with, as one calculation read top to bottom.
 *
 * These strips all grew the same way and went wrong the same way: a figure gets shown once as
 * the gross, again as the net, again as "the total", the cash appears both as the field you type
 * in and as a read-out beside it — seven boxes for four real numbers, and the eye has to
 * cross-reference them to check anything.
 *
 * A ladder fixes that by construction. Every figure appears exactly once and every line is the
 * one above it plus or minus something, so it is checkable at a glance instead of by comparison.
 *
 * Two rules the callers rely on:
 *   • a row worth zero is not rendered — a discount nobody gave and an account nobody owes are
 *     padding, not information, and they were most of what made these strips unreadable;
 *   • anything true but not part of the money changing hands now (points, coupons, what the
 *     payment leaves behind) goes in `notes`, under a dashed rule, so it stops competing with
 *     the figure that IS changing hands.
 */

export interface LadderRow {
  label: React.ReactNode;
  /** The amount. Rendered as-is, so a caller can pass "− 50.00" for a subtraction. */
  value: string;
  /** Draw a rule above this row — used for the subtotal and the final figure. */
  rule?: boolean;
  /** The bottom line: bigger and heavier than the rest. */
  big?: boolean;
  strong?: boolean;
  color?: string;
  /** Set false to drop the row entirely. Zero rows are noise, not information. */
  show?: boolean;
}

interface Props {
  /** The fields the user actually types — rendered on the near side, above/beside the ladder. */
  inputs: React.ReactNode;
  rows: LadderRow[];
  /** True but not money changing hands now: points, coupons, what the payment leaves behind. */
  notes?: React.ReactNode[];
  /** Tint of the surrounding panel — green for a sale, warm for a return. */
  tone?: 'sale' | 'return';
  currency?: string;
}

const TONES = {
  sale: { bg: '#f6faf3', border: '#e6efe3', rule: '#d8e6d2' },
  return: { bg: '#fdf6f3', border: '#f3e2da', rule: '#f0d9cd' },
};

export default function TotalsLadder({
  inputs, rows, notes = [], tone = 'sale', currency = 'ج.م',
}: Props) {
  const t = TONES[tone];
  const visible = rows.filter((r) => r.show !== false);
  const shownNotes = notes.filter(Boolean);

  return (
    <div style={{
      background: t.bg, border: `1px solid ${t.border}`, borderRadius: 10, padding: 16,
    }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 260px', minWidth: 240, maxWidth: 340 }}>{inputs}</div>

        <div style={{ flex: '1 1 320px', minWidth: 280 }}>
          <div style={{ maxWidth: 460, marginInlineStart: 'auto' }}>
            {visible.map((r, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                padding: r.big ? '7px 0' : '5px 0',
                borderTop: r.rule ? `1px solid ${t.rule}` : undefined,
                marginTop: r.rule ? 4 : undefined,
              }}>
                <span style={{ fontSize: r.big ? 14 : 13, color: '#7a7a7a' }}>{r.label}</span>
                <span style={{
                  fontSize: r.big ? 24 : 15,
                  fontWeight: r.big || r.strong ? 800 : 600,
                  color: r.color,
                }}>
                  {r.value} {currency}
                </span>
              </div>
            ))}

            {shownNotes.length > 0 && (
              <div style={{
                display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, paddingTop: 8,
                borderTop: `1px dashed ${t.rule}`, fontSize: 12, color: '#8a8a8a',
              }}>
                {shownNotes.map((n, i) => <span key={i}>{n}</span>)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
