import React from 'react';
import { Button, Space, Tooltip } from 'antd';
import { EditOutlined, ExportOutlined } from '@ant-design/icons';
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

export type DocKind = 'invoice' | 'return' | 'purchase' | 'purchase_return' | 'voucher';

const SCREEN: Record<DocKind, string> = {
  invoice: '/invoices',
  return: '/returns',
  purchase: '/purchases',
  purchase_return: '/purchases',
  voucher: '/vouchers',
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
    default: return null;
  }
}

interface Props {
  kind: DocKind;
  /** The document's own number, shown instead of the generic label when known. */
  label?: string;
  id: number;
  /** Show the edit button. Only the sales invoice screen implements editing today. */
  allowEdit?: boolean;
  size?: 'small' | 'middle';
  /** Called after navigating, so a modal the link sits inside can close itself. */
  onNavigate?: () => void;
}

export default function DocumentLink({
  kind, id, label, allowEdit = false, size = 'middle', onNavigate,
}: Props) {
  const navigate = useNavigate();

  const go = (intent: 'doc' | 'edit') => {
    // Navigate rather than openTab: openTab deliberately restores a section where the user left
    // it, which would drop the intent. The tab reconciler picks this URL up and focuses the tab.
    navigate(`${SCREEN[kind]}?${intent}=${id}`);
    onNavigate?.();
  };

  return (
    <Space size={4}>
      <Tooltip title="افتح المستند في شاشته">
        <Button size={size} icon={<ExportOutlined />} onClick={() => go('doc')}>
          {label || 'فتح المستند'}
        </Button>
      </Tooltip>
      {allowEdit && kind === 'invoice' && (
        <Tooltip title="هيتعمل مرتجع كامل وتتفتح الفاتورة من جديد للتعديل">
          <Button size={size} icon={<EditOutlined />} onClick={() => go('edit')}>
            تعديل
          </Button>
        </Tooltip>
      )}
    </Space>
  );
}
