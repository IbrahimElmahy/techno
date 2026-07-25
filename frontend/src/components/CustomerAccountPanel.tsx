import React, { useEffect, useState } from 'react';
import { Spin } from 'antd';
import { api } from '../api/client';

/**
 * The customer's overall outstanding balance — just the ONE total of what he owes. The figure is
 * the authoritative receivable from the ledger, so it already nets out every payment and return
 * (any amount paid is deducted from the total automatically). Shown below a sale/return document
 * and inside the create forms once a customer is picked.
 */

const money = (v: any) =>
  Number(v || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CustomerAccountPanel({
  customerId, variant = 'block',
}: {
  customerId: number;
  variant?: 'block' | 'inline';
}) {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get(`/api/v1/customers/${customerId}/account`)
      .then((res) => { if (alive) setBalance(Number(res.data.balance || 0)); })
      .catch((err) => console.error(err))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [customerId]);

  if (loading || balance === null) {
    return variant === 'inline'
      ? <Spin size="small" />
      : <div style={{ textAlign: 'center', padding: 12 }}><Spin size="small" /></div>;
  }

  const owes = balance > 0;
  const credit = balance < 0;
  const label = owes ? 'إجمالي المستحق على العميل' : credit ? 'رصيد دائن للعميل' : 'رصيد العميل';
  const color = owes ? '#cf1322' : credit ? '#6AB42D' : '#555';
  const value = `${money(Math.abs(balance))} ج.م`;

  if (variant === 'inline') {
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 12px',
        borderRadius: 8, background: owes ? '#fff1f0' : credit ? '#f6ffed' : '#fafafa',
        border: `1px solid ${owes ? '#ffccc7' : credit ? '#b7eb8f' : '#eee'}`,
      }}>
        <span style={{ fontSize: 13, color: '#555' }}>{label}:</span>
        <b style={{ fontSize: 16, color }}>{value}</b>
      </div>
    );
  }

  return (
    <div style={{
      marginTop: 16, padding: '14px 18px', borderRadius: 10,
      background: owes ? '#fff1f0' : credit ? '#f6ffed' : '#fafafa',
      border: `1px solid ${owes ? '#ffccc7' : credit ? '#b7eb8f' : '#eee'}`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    }}>
      <span style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>{label}</span>
      <b style={{ fontSize: 22, color }}>{value}</b>
    </div>
  );
}
