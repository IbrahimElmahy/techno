import React from 'react';
import { Button, Tag, Tooltip } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

/**
 * The thread that ties a document to the screen that owns it.
 *
 * A sales invoice turns up in half a dozen places — the customer's file, the item's history, a
 * report, a statement — and in each of them it was previously a dead row: you could read it and
 * nothing else. To change it you had to remember its number, leave, find the invoices screen and
 * search for it again.
 *
 * These buttons carry the document's identity to its own screen, which is where editing and
 * reversing already live and where they are already guarded. Nothing is duplicated: the link
 * navigates, the owning screen acts. That is deliberate — a second place that can reverse an
 * invoice is a second place that can get reversal wrong.
 */

/**
 * (031) `voucher` is gone. It was in this map and no caller ever used it — and the vouchers screen
 * is a set of creation forms with no per-document view, so the link would have landed on a form.
 * A kind listed here is a promise that a screen can open one of these; keeping an unkept one
 * around is how the next person adds a link that quietly goes nowhere.
 */
export type DocKind = 'invoice' | 'return' | 'purchase' | 'purchase_return'
  | 'transfer' | 'stock_permit';

const SCREEN: Record<DocKind, string> = {
  invoice: '/invoices',
  return: '/returns',
  purchase: '/purchases',
  // (031) Purchase returns have a register of their own now; they used to land on the purchase
  // list, which is a different document from the one the link was named after.
  purchase_return: '/purchase-returns',
  // إذن التحويل وإذن الإضافة/الصرف — الاتنين بيحرّكوا مخزون، فبيظهروا في كارت الصنف
  // وكشفه. وكانوا بيتعرضوا كنص من غير رابط، فاللي بيدوّر على سبب حركة كان بيقف عند
  // رقم مستند مايقدرش يفتحه.
  transfer: '/transfers',
  stock_permit: '/stock-permits',
};

/**
 * A stock movement names its source in the stock module's own vocabulary («sale», «sale_return»);
 * the mapping lives here so every screen that shows movements agrees on it. Types absent from the
 * map (transfer, manufacturing, inspection) have no single-document screen to open yet, and
 * returning null lets the caller keep showing the plain tag instead of a link that goes nowhere.
 */
export function docKindOf(sourceDocType: string | null | undefined): DocKind | null {
  switch (sourceDocType) {
    case 'sale': return 'invoice';
    case 'sale_return': return 'return';
    case 'purchase': return 'purchase';
    case 'purchase_return': return 'purchase_return';
    case 'transfer': return 'transfer';
    case 'stock_permit': return 'stock_permit';
    default: return null;
  }
}

/**
 * الرابط بيفتح المستند **للعرض** — دايماً.
 *
 * كان بيفتح للتعديل على طول لو الشاشة بتعرف تعدّل. والنتيجة إن اللي بيدوس على رقم فاتورة
 * من كشف حساب عشان يشوفها، بيلاقي نفسه واقف في شاشة كتابة على مستند مرحّل — وأي ضغطة
 * غلط بتغيّره. اللي عايز يعدّل بيدوس «تعديل» من شريط الأدوات، وده قرار بياخده هو.
 *
 * وعشان كده مافيش قايمة «مستندات بتتعدّل» هنا: الرابط مابقاش بيفرّق بينهم، والشاشة نفسها
 * هي اللي بتعرف إذا كان عندها تعديل ولا لأ — وبتقوله بزرار موجود أو مطفي، مش برابط
 * بيوعد بحاجة من برّه.
 */

/**
 * «افتح المستند ده» — the single answer to where a document opens.
 *
 * The URL was built in two places in this file and was about to be built in six more: the reports
 * where a whole ROW now opens the document its numbers came from. Six copies of
 * `${SCREEN[kind]}?edit=${id}` are six chances for one of them to keep sending invoices to the
 * read-only view after the rest moved on.
 *
 * Navigate rather than openTab: openTab deliberately restores a section where the user left it,
 * which would drop the intent. The tab reconciler picks this URL up and focuses the tab.
 */
export function useOpenDocument() {
  const navigate = useNavigate();
  return (kind: DocKind, id: number | null | undefined, _opts?: { readOnly?: boolean }) => {
    if (!id) return;
    // Always open in view mode ('doc'). The user clicks 'تعديل' on the toolbar if they want to edit.
    navigate(`${SCREEN[kind]}?doc=${id}`);
  };
}

interface Props {
  kind: DocKind;
  /** The document's own number, shown instead of the generic label when known. */
  label?: string;
  id: number;
  /**
   * @deprecated الفتح بقى للعرض دايماً، فالخاصية دي مابقاش ليها أثر.
   *
   * سايبة عشان الشاشات الستة اللي بتبعتها ماتقعش؛ اللي بيمسّ واحدة منهم بيشيلها.
   */
  allowEdit?: boolean;
  size?: 'small' | 'middle';
  /** Called after navigating, so a modal the link sits inside can close itself. */
  onNavigate?: () => void;
}

/**
 * The same link, inline — for a table cell where a button would crowd the row.
 *
 * Same `?doc=` contract as the button, so a screen that learns to honour one honours both. Written
 * because the new registers show document numbers by the dozen and «افتح المستند» beside each of
 * them would be a column of buttons nobody reads.
 */
export function DocRef({ kind, id, label, onNavigate }: {
  kind: DocKind; id: number | null | undefined; label: string | null | undefined;
  onNavigate?: () => void;
}) {
  const open = useOpenDocument();
  if (!label) return <span style={{ color: '#8c8c8c' }}>-</span>;
  // Without an id there is nothing to open, so it stays plain text rather than a link that lands
  // on a list and leaves the reader to search for what they just clicked.
  if (!id) return <Tag>{label}</Tag>;
  return (
    <Tooltip title="افتح المستند في شاشته">
      <a onClick={(e) => {
        e.stopPropagation();
        open(kind, id);
        onNavigate?.();
      }}>
        <Tag color="blue" style={{ cursor: 'pointer' }}>{label}</Tag>
      </a>
    </Tooltip>
  );
}

export default function DocumentLink({
  kind, id, label, size = 'middle', onNavigate,
}: Props) {
  const open = useOpenDocument();

  // زرار واحد بيقول حاجة واحدة: بيفتح المستند. كان بيتحوّل لقلم مكتوب عليه «فتح للتعديل»
  // لما `allowEdit` تكون متبعوتة — وبعد ما الفتح بقى للعرض دايماً، الزرار فضل بيقول
  // «تعديل» وبيفتح عرض. زرار بيكذب أوحش من زرار عام.
  return (
    <Tooltip title="افتح المستند في شاشته">
      <Button size={size} icon={<ExportOutlined />}
        onClick={() => { open(kind, id); onNavigate?.(); }}>
        {label || 'فتح المستند'}
      </Button>
    </Tooltip>
  );
}
