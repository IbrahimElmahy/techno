import { useEffect, useState } from 'react';
import { Select } from 'antd';
import { ApartmentOutlined } from '@ant-design/icons';
import { api, clearApiCache, getViewBranch, setViewBranch } from '../api/client';

export default function BranchFilter() {
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const current = getViewBranch();

  useEffect(() => {
    api.get('/api/v1/branches')
      .then((r) => setBranches((r.data || []).filter((b: any) => b.active !== false)))
      .catch(() => setBranches([]));
  }, []);

  if (branches.length < 2) return null;

  return (
    <Select
      size="small"
      value={current ?? 0}
      onChange={(v: number) => {
        setViewBranch(v || null);
        clearApiCache();
        window.location.reload();
      }}
      suffixIcon={<ApartmentOutlined />}
      style={{ minWidth: 130 }}
      className={current ? 'branch-filter is-on' : 'branch-filter'}
      options={[
        { value: 0, label: 'كل الفروع' },
        ...branches.map((b) => ({ value: b.id, label: b.name })),
      ]}
    />
  );
}

export function BranchBadge({ branchId }: { branchId?: number | null }) {
  const [name, setName] = useState<string>('');

  useEffect(() => {
    if (!branchId) return;
    api.get('/api/v1/branches')
      .then((r) => setName((r.data || []).find((b: any) => b.id === branchId)?.name || ''))
      .catch(() => setName(''));
  }, [branchId]);

  if (!name) return null;
  return (
    <span className="branch-badge" style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600,
      padding: '2px 10px', borderRadius: 6, border: '1px solid #d9d9d9', whiteSpace: 'nowrap',
    }}>
      <ApartmentOutlined />
      {name}
    </span>
  );
}
