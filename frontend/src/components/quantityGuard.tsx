import { Modal } from 'antd';
import { qty } from '../utils/money';

export interface QuantityCheck {
  value: number | null | undefined;
  available?: number | null;
  itemName?: string | null;
  unit?: string | null;
}

export function quantityProblem(c: QuantityCheck): string | null {
  const v = Number(c.value ?? 0);
  if (c.value === null || c.value === undefined || Number.isNaN(v)) return null;
  if (v < 0) {
    return 'لا يجوز أن تكون الكمية سالبة. لإرجاع بضاعة استخدم مستند المرتجع.';
  }
  if (v === 0) {
    return 'لا يجوز أن تكون الكمية صفراً. احذف السطر إن لم تكن بحاجة إليه.';
  }
  if (c.available !== undefined && c.available !== null && v > Number(c.available)) {
    const u = c.unit ? ` ${c.unit}` : '';
    return `المتاح ${qty(Number(c.available))}${u} فقط، والمطلوب ${qty(v)}${u}.`;
  }
  return null;
}

export function guardQuantity(c: QuantityCheck, previous: number | null): number | null {
  const problem = quantityProblem(c);
  if (!problem) return c.value ?? null;
  Modal.warning({
    title: c.itemName ? `الكمية: ${c.itemName}` : 'الكمية غير صحيحة',
    content: problem,
    okText: 'حسناً',
    centered: true,
  });
  return previous;
}

export default guardQuantity;
