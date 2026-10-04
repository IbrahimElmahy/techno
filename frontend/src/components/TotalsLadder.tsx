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
  /**
   * The row the document is ABOUT — tinted, so the eye lands on it among its siblings.
   *
   * An invoice on «بولي» shows both lines' debts and the total; without a mark, three similar
   * numbers sit in a column and the reader has to remember which one the invoice they are typing
   * will move. The other rows stay plain rather than being greyed: they are true, they are simply
   * not the one in play.
   */
  highlight?: boolean;
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
        {/*
          * خانات السُلّم — أسماؤها فوقها، مش جنبها.
          *
          * باقي المستند اسم الحقل جنب الخانة عشان يوفّر سطور، وده صح هناك: الصف عرضه عرض
          * الصفحة. هنا العمود ضيق (٢٤٠–٣٤٠ بكسل)، واسم زي «المبلغ المدفوع نقداً» مع الخانة
          * على سطر واحد مابيوسعش — فكان بينزل تحت الخانة ويلتزق بسطر الشرح، ويطلعوا جملة
          * واحدة مالهاش معنى: «المبلغ المدفوع نقداً ممكن يزيد عن الفاتورة».
          */}
        <div className="ladder-inputs"
          style={{ flex: '1 1 260px', minWidth: 240, maxWidth: 340 }}>{inputs}</div>

        {/*
          * **الأرقام جنب بعض، مش تحت بعض** (طلب العميل ٢٠٢٦-٠٩-٣٠ — «زي الطباعة»).
          *
          * السُلّم كان عمود واحد: سبع سطور تحت بعض بتاخد نص الشاشة، والأصناف فوقها بتضطر
          * تتسكرل. دلوقتي كل رقم كارت صغير (الاسم فوقه والرقم تحته) في شبكة تلات أعمدة،
          * والرقم الأخير (`big`) شريط بعرض الشبكة كلها تحتها — هو اللي العين بتدوّر عليه.
          * الترتيب هو هو، فالحسبة لسه بتتقري بالترتيب: من أول كارت لآخر كارت.
          */}
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
