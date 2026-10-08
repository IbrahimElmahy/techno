import React from 'react';
import { Button, Tag, Tooltip } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { withReturn } from './docReturn';

export type DocKind = 'invoice' | 'return' | 'purchase' | 'purchase_return'
  | 'transfer' | 'stock_permit' | 'stock_count' | 'production_order' | 'voucher';

const SCREEN: Record<DocKind, string> = {
  invoice: '/invoices',
  return: '/returns',
  purchase: '/purchases',
  purchase_return: '/purchase-returns',
  transfer: '/transfers',
  stock_permit: '/stock-permits',
  stock_count: '/stock-counts',
  production_order: '/manufacturing?tab=orders',
  voucher: '/vouchers?tab=log',
};

const OPEN_PARAM: Partial<Record<DocKind, 'doc' | 'edit'>> = {
  production_order: 'edit',
};

export function docKindOf(sourceDocType: string | null | undefined): DocKind | null {
  const t = (sourceDocType || '').replace(/^reverse_/, '');
  switch (t) {
    case 'sale':
    case 'sales_invoice': return 'invoice';
    case 'sale_return':
    case 'sales_return':
    case 'sale_return_reversal': return 'return';
    case 'purchase':
    case 'purchase_invoice': return 'purchase';
    case 'purchase_return':
    case 'purchase_return_reversal': return 'purchase_return';
    case 'transfer':
    case 'stock_transfer': return 'transfer';
    case 'permit':
    case 'stock_permit': return 'stock_permit';
    case 'stock_count': return 'stock_count';
    case 'production_order': return 'production_order';
    default: return null;
  }
}

export function useOpenDocument() {
  const navigate = useNavigate();
  const here = useLocation();
  return (kind: DocKind, id: number | null | undefined, _opts?: { readOnly?: boolean }) => {
    if (!id) return;
    const screen = SCREEN[kind];
    const param = OPEN_PARAM[kind] ?? 'doc';
    const target = `${screen}${screen.includes('?') ? '&' : '?'}${param}=${id}`;
    navigate(withReturn(target, here.pathname + here.search));
  };
}

interface Props {
  kind: DocKind;
  label?: string;
  id: number;
  allowEdit?: boolean;
  size?: 'small' | 'middle';
  onNavigate?: () => void;
}

export function DocRef({ kind, id, label, onNavigate }: {
  kind: DocKind; id: number | null | undefined; label: string | null | undefined;
  onNavigate?: () => void;
}) {
  const open = useOpenDocument();
  if (!label) return <span style={{ color: '#8c8c8c' }}>-</span>;
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

  return (
    <Tooltip title="افتح المستند في شاشته">
      <Button size={size} icon={<ExportOutlined />}
        onClick={() => { open(kind, id); onNavigate?.(); }}>
        {label || 'فتح المستند'}
      </Button>
    </Tooltip>
  );
}
