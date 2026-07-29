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

export type DocKind = 'invoice' | 'return' | 'purchase' | 'purchase_return';

const SCREEN: Record<DocKind, string> = {
  invoice: '/invoices',
  return: '/returns',
  purchase: '/purchases',
  purchase_return: '/purchases',
};

interface Props {
  kind: DocKind;
  id: number;
  /** Show the edit button. Only the sales invoice screen implements editing today. */
  allowEdit?: boolean;
  size?: 'small' | 'middle';
  /** Called after navigating, so a modal the link sits inside can close itself. */
  onNavigate?: () => void;
}

export default function DocumentLink({
  kind, id, allowEdit = false, size = 'middle', onNavigate,
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
          فتح المستند
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
