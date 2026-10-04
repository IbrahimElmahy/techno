import { useEffect, useState } from 'react';
import { Select } from 'antd';
import { ApartmentOutlined } from '@ant-design/icons';
import { api, clearApiCache, getViewBranch, setViewBranch } from '../api/client';

/**
 * فلتر الفرع — للمالك والأدمن بس (٢٠٢٦-١٠-٠٤).
 *
 * الافتراضي «كل الفروع». اختيار فرع بيخلّي كل القوايم والتقارير والسجلات تعرض الفرع ده بس
 * (السيرفر بيفلتر — `X-View-Branch`)، والصفحة بتتحمّل من جديد عشان كل شاشة مفتوحة تجيب
 * داتا الفرع من الأول بدل ما تفضل على اللي كانت جايباه.
 */
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
