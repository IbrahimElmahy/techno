import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Input, InputNumber, Modal, Select, Space, Spin, Switch, Table, Tabs, Tag, TreeSelect, Typography, message,
} from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { api } from '../../api/client';

interface PLine {
  key: string; name: string; categories: string[]; name_prefixes: string[];
  basis: 'cost' | 'list'; factor_pct: number; active: boolean;
}

let k = 0;
const key = () => `pl${(k += 1)}`;
const same = (a: number[] = [], b: number[] = []) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export default function ConfigModal({ open, branchId, onClose, onSaved, editable }: {
  open: boolean; branchId?: number; onClose: () => void; onSaved: () => void; editable: boolean;
}) {
  const [cfg, setCfg] = useState<any | null>(null);
  const [lines, setLines] = useState<PLine[]>([]);
  const [accounts, setAccounts] = useState<Record<string, number[]>>({});
  const [mains, setMains] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCfg(null);
    api.get('/api/v1/period-closing/config', { params: { branch_id: branchId } }).then((r) => {
      setCfg(r.data);
      setLines((r.data.product_lines || []).map((p: any) => ({
        key: key(), name: p.name, categories: p.categories, name_prefixes: p.name_prefixes,
        basis: p.basis, factor_pct: Number(p.factor_pct), active: p.active,
      })));
      setAccounts(r.data.accounts || {});
      setMains(r.data.main_warehouse_ids || []);
    }).catch(() => onClose());
  }, [open, branchId]);

  const tree = useMemo(() => {
    if (!cfg) return [];
    const byParent = new Map<number | null, any[]>();
    const ids = new Set(cfg.accounts_tree.map((a: any) => a.id));
    for (const a of cfg.accounts_tree) {
      const p = a.parent_id && ids.has(a.parent_id) ? a.parent_id : null;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p)!.push(a);
    }
    const build = (p: number | null): any[] => (byParent.get(p) || []).map((a) => ({
      value: a.id, title: `${a.name || ''} ${a.code ? `(${a.code})` : ''}`, children: build(a.id),
    }));
    return build(null);
  }, [cfg]);

  const patch = (kk: string, p: Partial<PLine>) => setLines(lines.map((l) => (l.key === kk ? { ...l, ...p } : l)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= lines.length) return;
    const n = [...lines];
    [n[i], n[j]] = [n[j], n[i]];
    setLines(n);
  };

  const fromCategories = () => {
    setLines((cfg?.categories || []).map((c: any) => ({
      key: key(), name: c.label, categories: [c.value], name_prefixes: [], basis: 'cost', factor_pct: 100, active: true,
    })));
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/v1/period-closing/product-lines', lines.map((l) => ({
        name: l.name, categories: l.categories, name_prefixes: l.name_prefixes, basis: l.basis,
        factor_pct: l.factor_pct, active: l.active,
      })), { params: { branch_id: branchId } });
      const acc: Record<string, number[]> = {};
      for (const kk of Object.keys(cfg.account_labels || {})) {
        acc[kk] = cfg.accounts_default?.[kk] && same(accounts[kk], cfg.accounts[kk]) ? [] : (accounts[kk] || []);
      }
      const wh = cfg.main_warehouse_default && same(mains, cfg.main_warehouse_ids) ? [] : mains;
      await api.put('/api/v1/period-closing/config', { accounts: acc, main_warehouse_ids: wh },
        { params: { branch_id: branchId } });
      message.success('تم حفظ الإعدادات');
      onSaved();
    } catch {
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  const catOptions = (cfg?.categories || []).map((c: any) => ({ value: c.value, label: c.label }));
  const used = new Set(lines.flatMap((l) => l.categories));
  const unused = catOptions.filter((c: any) => !used.has(c.value));

  const lineColumns: any[] = [
    {
      title: 'الترتيب', key: 'o', width: 70,
      render: (_: any, __: PLine, i: number) => (
        <Space size={0}>
          <Button size="small" type="text" icon={<ArrowUpOutlined />} onClick={() => move(i, -1)} disabled={!editable} />
          <Button size="small" type="text" icon={<ArrowDownOutlined />} onClick={() => move(i, 1)} disabled={!editable} />
        </Space>
      ),
    },
    {
      title: 'خط الإنتاج', dataIndex: 'name', key: 'n', width: 170,
      render: (v: string, r: PLine) => <Input size="small" value={v} disabled={!editable} onChange={(e) => patch(r.key, { name: e.target.value })} />,
    },
    {
      title: 'الفئات', dataIndex: 'categories', key: 'c',
      render: (v: string[], r: PLine) => (
        <Select size="small" mode="multiple" style={{ width: '100%' }} value={v} disabled={!editable}
          options={catOptions} optionFilterProp="label" onChange={(x) => patch(r.key, { categories: x })} />
      ),
    },
    {
      title: 'بداية اسم الصنف', dataIndex: 'name_prefixes', key: 'p', width: 150,
      render: (v: string[], r: PLine) => (
        <Select size="small" mode="tags" style={{ width: '100%' }} value={v} disabled={!editable}
          onChange={(x) => patch(r.key, { name_prefixes: x })} tokenSeparators={[',']} />
      ),
    },
    {
      title: 'أساس التقييم', dataIndex: 'basis', key: 'b', width: 140,
      render: (v: string, r: PLine) => (
        <Select size="small" value={v} style={{ width: '100%' }} disabled={!editable}
          onChange={(x) => patch(r.key, { basis: x as any })}
          options={[{ value: 'cost', label: 'متوسط التكلفة' }, { value: 'list', label: 'أصل السعر' }]} />
      ),
    },
    {
      title: 'النسبة ٪', dataIndex: 'factor_pct', key: 'f', width: 90,
      render: (v: number, r: PLine) => <InputNumber size="small" value={v} min={0} max={1000} disabled={!editable} onChange={(x) => patch(r.key, { factor_pct: Number(x ?? 100) })} />,
    },
    {
      title: 'مفعل', dataIndex: 'active', key: 'a', width: 60,
      render: (v: boolean, r: PLine) => <Switch size="small" checked={v} disabled={!editable} onChange={(x) => patch(r.key, { active: x })} />,
    },
    {
      title: '', key: 'x', width: 40,
      render: (_: any, r: PLine) => <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={!editable} onClick={() => setLines(lines.filter((l) => l.key !== r.key))} />,
    },
  ];

  return (
    <Modal open={open} onCancel={onClose} width={1100} title="إعدادات الإقفال"
      okText="حفظ" cancelText="إغلاق" onOk={save} confirmLoading={saving} okButtonProps={{ disabled: !editable || !cfg }}
      destroyOnHidden>
      {!cfg ? <Spin /> : (
        <Tabs items={[
          {
            key: 'lines', label: 'خطوط الإنتاج',
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Table size="small" rowKey="key" pagination={false} dataSource={lines} columns={lineColumns} />
                {editable && (
                  <Space>
                    <Button size="small" icon={<PlusOutlined />} onClick={() => setLines([...lines, { key: key(), name: '', categories: [], name_prefixes: [], basis: 'cost', factor_pct: 100, active: true }])}>إضافة خط</Button>
                    <Button size="small" onClick={fromCategories}>خط لكل فئة</Button>
                  </Space>
                )}
                {!!unused.length && (
                  <Typography.Text>
                    فئات غير مدرجة: {unused.map((c: any) => <Tag key={c.value}>{c.label}</Tag>)}
                  </Typography.Text>
                )}
              </Space>
            ),
          },
          {
            key: 'wh', label: 'المخزن الرئيسي',
            children: (
              <Select mode="multiple" style={{ width: '100%' }} value={mains} onChange={setMains} disabled={!editable}
                optionFilterProp="label"
                options={(cfg.warehouses || []).map((w: any) => ({ value: w.id, label: `${w.name}${w.active ? '' : ' (موقوف)'}` }))} />
            ),
          },
          {
            key: 'acc', label: 'مجموعات الحسابات',
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                {Object.entries(cfg.account_labels || {}).map(([kk, label]) => (
                  <div key={kk}>
                    <Space style={{ marginBottom: 4 }}>
                      <b>{label as string}</b>
                      {cfg.accounts_default?.[kk] && same(accounts[kk], cfg.accounts[kk]) && <Tag>تلقائي</Tag>}
                    </Space>
                    <TreeSelect treeData={tree} multiple showSearch treeNodeFilterProp="title" style={{ width: '100%' }}
                      value={accounts[kk] || []} disabled={!editable}
                      onChange={(v) => setAccounts({ ...accounts, [kk]: v as number[] })} />
                  </div>
                ))}
              </Space>
            ),
          },
        ]} />
      )}
    </Modal>
  );
}
