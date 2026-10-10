import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import LoadPeriodModal from './LoadPeriodModal';

export type NavFamily = 'sales' | 'purchases';
export type NavKind = 'sale' | 'bonus' | 'return' | 'purchase' | 'purchase_return';
export type NavDoc = 'invoice' | 'return' | 'purchase' | 'purchase_return';

export interface NavRow {
  kind: NavKind;
  id: number;
  number: string;
  date: string | null;
  seq?: number;
}

interface NavStep {
  prev: NavRow | null;
  next: NavRow | null;
  position: number | null;
  total: number | null;
}

const KIND_TAG: Record<NavKind, { label: string; color: string }> = {
  sale: { label: 'فاتورة بيع', color: 'green' },
  bonus: { label: 'بونص', color: 'orange' },
  return: { label: 'مرتجع بيع', color: 'volcano' },
  purchase: { label: 'فاتورة شراء', color: 'blue' },
  purchase_return: { label: 'مرتجع شراء', color: 'magenta' },
};

const DOC_OF: Record<NavKind, NavDoc> = {
  sale: 'invoice',
  bonus: 'invoice',
  return: 'return',
  purchase: 'purchase',
  purchase_return: 'purchase_return',
};

const SCREEN: Record<NavDoc, string> = {
  invoice: '/invoices',
  return: '/returns',
  purchase: '/purchases',
  purchase_return: '/purchase-returns',
};

const ENDPOINT: Record<NavFamily, string> = {
  sales: '/api/v1/sales/nav-sequence',
  purchases: '/api/v1/purchases/nav-sequence',
};

const LOAD_TITLE: Record<NavFamily, string> = {
  sales: 'تحميل مستندات المبيعات لفترة',
  purchases: 'تحميل مستندات المشتريات لفترة',
};

const ranges: Record<NavFamily, NavRow[] | null> = { sales: null, purchases: null };
const listeners = new Set<() => void>();

function setRange(family: NavFamily, rows: NavRow[] | null) {
  ranges[family] = rows;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function NavKindTag({ kind }: { kind: NavKind }) {
  const t = KIND_TAG[kind];
  return <Tag color={t.color} style={{ marginInlineEnd: 0 }}>{t.label}</Tag>;
}

export function useDocNav(opts: {
  family: NavFamily;
  doc: NavDoc;
  kind: NavKind;
  id: number | null;
  active: boolean;
  open: (row: NavRow) => void;
}) {
  const { family, doc, kind, id, active } = opts;
  const navigate = useNavigate();
  const openRef = useRef(opts.open);
  openRef.current = opts.open;
  const rows = useSyncExternalStore(subscribe, () => ranges[family]);
  const [loadOpen, setLoadOpen] = useState(false);
  const [step, setStep] = useState<(NavStep & { key: string }) | null>(null);
  const seqRef = useRef(0);

  const at = rows && id != null
    ? rows.findIndex((r) => DOC_OF[r.kind] === doc && r.id === id) : -1;
  const inRange = at >= 0;
  const stepKey = `${family}:${doc}:${id ?? ''}`;
  const fresh = step && step.key === stepKey ? step : null;

  useEffect(() => {
    if (!active || inRange) { setStep(null); return; }
    const my = ++seqRef.current;
    api.get(ENDPOINT[family], { params: id != null ? { doc, id } : {} })
      .then((res) => {
        if (my === seqRef.current) setStep({ ...(res.data as NavStep), key: stepKey });
      })
      .catch(() => { if (my === seqRef.current) setStep(null); });
  }, [family, doc, id, active, inRange, stepKey]);

  let prev: NavRow | null;
  let next: NavRow | null;
  let position: number | null;
  let total: number | null;
  if (inRange && rows) {
    prev = rows[at - 1] ?? null;
    next = rows[at + 1] ?? null;
    position = at + 1;
    total = rows.length;
  } else if (id == null && rows?.length) {
    prev = rows[rows.length - 1];
    next = null;
    position = null;
    total = rows.length;
  } else {
    prev = fresh?.prev ?? null;
    next = fresh?.next ?? null;
    position = id != null ? (fresh?.position ?? null) : null;
    total = id != null ? (fresh?.total ?? null) : null;
  }

  const go = useCallback((row: NavRow | null) => {
    if (!row) return;
    const target = DOC_OF[row.kind];
    if (target === doc) { openRef.current(row); return; }
    navigate(`${SCREEN[target]}?doc=${row.id}`);
  }, [doc, navigate]);

  const loadModal = (
    <LoadPeriodModal
      open={loadOpen} onCancel={() => setLoadOpen(false)}
      title={LOAD_TITLE[family]} endpoint={ENDPOINT[family]}
      columns={[
        { title: 'المستند', key: 'number', width: 150 },
        { title: 'التاريخ', key: 'date', width: 120 },
      ]}
      sorter={(a: NavRow, b: NavRow) => Number(b.seq || 0) - Number(a.seq || 0)}
      onLoaded={(loaded) => setRange(family, [...(loaded as NavRow[])].reverse())}
      openNewest
      onPick={(r) => go(r as NavRow)} />
  );

  return {
    prev,
    next,
    position,
    total,
    goPrev: () => go(prev),
    goNext: () => go(next),
    tag: <NavKindTag kind={kind} />,
    openLoad: () => setLoadOpen(true),
    loadModal,
  };
}
