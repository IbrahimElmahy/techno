import React, { useEffect, useState } from 'react';
import { Button, Select } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import { api, clearApiCache, getViewAs, setViewAs } from '../api/client';
import { useAuth } from './AuthProvider';
import { searchFilter, searchRank } from '../utils/arabicSort';

function go(id: number | null) {
  setViewAs(id);
  clearApiCache();
  window.location.reload();
}

export default function ViewAsSelect() {
  const { realUser, viewingAs } = useAuth();
  const [users, setUsers] = useState<{ id: number; label: string }[]>([]);
  const allowed = !!realUser?.capabilities?.includes('user.write');

  useEffect(() => {
    if (!allowed) return;
    api.get('/api/v1/users', { headers: { 'X-View-As': '' } })
      .then((r) => setUsers((r.data || [])
        .filter((u: any) => u.active !== false && u.username !== realUser?.username)
        .map((u: any) => ({ id: u.id, label: u.full_name || u.username }))))
      .catch(() => setUsers([]));
  }, [allowed]);

  if (!allowed) return null;
  return (
    <Select
      size="small" showSearch allowClear placeholder="عرض كمستخدم"
      suffixIcon={<EyeOutlined />} style={{ minWidth: 150 }}
      className={viewingAs ? 'branch-filter is-on' : 'branch-filter'}
      value={getViewAs() ?? undefined}
      onChange={(v?: number) => go(v ?? null)}
      options={users.map((u) => ({ value: u.id, label: u.label }))}
      filterOption={searchFilter} filterSort={searchRank}
    />
  );
}

export function ViewAsBanner() {
  const { user, viewingAs } = useAuth();
  if (!viewingAs) return null;
  return (
    <div style={{
      background: '#fff7e6', borderBottom: '1px solid #ffd591', padding: '6px 16px',
      display: 'flex', alignItems: 'center', gap: 12, fontWeight: 600,
    }}>
      <EyeOutlined style={{ color: '#d46b08' }} />
      <span>معاينة النظام كـ «{user?.name || user?.username}» — للعرض فقط</span>
      <Button size="small" onClick={() => go(null)}>إنهاء المعاينة</Button>
    </div>
  );
}
