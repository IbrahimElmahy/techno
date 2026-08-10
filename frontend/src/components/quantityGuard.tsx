import { Modal } from 'antd';

/**
 * الكمية — مايتكتبش فيها سالب، ولا أكتر من اللي في المخزن.
 *
 * Two rules, one place, because they were neither.
 *
 * **الأكتر من المتاح** was handled by `max` on the InputNumber, which SILENTLY rewrites what was
 * typed: ask for 50 out of a store holding 8 and the box shows 8, with nothing said. The person
 * believes they sold 50. The invoice says 8. Nobody finds out until the customer does.
 *
 * **السالب** was handled by `min` on some boxes and not others, and a negative quantity is not a
 * small quantity — it is a sale that ADDS stock and a return that removes it, posted as an ordinary
 * document that reads normally in every list.
 *
 * So neither is clamped and neither is ignored: the value is refused, the box goes back to what it
 * held, and a dialog says which item, what was asked for, and what is actually there. A number that
 * cannot be honoured should never look like it was accepted.
 *
 * Checked on blur and on Enter rather than on every keystroke — typing «50» passes through «5»,
 * and a dialog that fires mid-number is a dialog people learn to dismiss without reading.
 */

const qty = (v: number) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

export interface QuantityCheck {
  /** ما اتكتب. */
  value: number | null | undefined;
  /**
   * المتاح في المكان اللي بيطلع منه.
   *
   * `undefined` means «not known», and that is NOT the same as zero — pass it when the document
   * brings goods in, and when no store has been picked yet so there is nothing to be available
   * FROM. Reporting an unknown as «المتاح ٠» refuses every quantity on a line whose warehouse has
   * simply not been chosen yet, which is the normal order of typing.
   */
  available?: number | null;
  itemName?: string | null;
  unit?: string | null;
}

/** ليه الكمية اترفضت — أو `null` لو مافيش سبب. */
export function quantityProblem(c: QuantityCheck): string | null {
  const v = Number(c.value ?? 0);
  if (c.value === null || c.value === undefined || Number.isNaN(v)) return null; // فاضية لسه
  if (v < 0) {
    return 'الكمية مايصحّش تكون بالسالب. لو الغرض ترجّع بضاعة، ده مرتجع بمستنده.';
  }
  if (v === 0) {
    return 'الكمية صفر مش كمية. امسح السطر لو مش عايزه.';
  }
  if (c.available !== undefined && c.available !== null && v > Number(c.available)) {
    const u = c.unit ? ` ${c.unit}` : '';
    return `المتاح ${qty(Number(c.available))}${u} بس، وإنت طالب ${qty(v)}${u}.`;
  }
  return null;
}

/**
 * بيرجّع الكمية المقبولة — واللي مش مقبولة بيطلّع تحذير ويرجّع اللي كانت.
 *
 * `previous` is what the box goes back to. Returning the capped maximum instead would be the same
 * silent rewrite in a louder coat: the person asked for a number, it cannot be honoured, and the
 * honest end is the box unchanged with an explanation on screen.
 */
export function guardQuantity(c: QuantityCheck, previous: number | null): number | null {
  const problem = quantityProblem(c);
  if (!problem) return c.value ?? null;
  Modal.warning({
    title: c.itemName ? `الكمية: ${c.itemName}` : 'الكمية مش مظبوطة',
    content: problem,
    okText: 'تمام',
    centered: true,
  });
  return previous;
}

export default guardQuantity;
