import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Checkbox, Empty, Input, Space, Table, Tag, Tooltip, message } from 'antd';
import { ReloadOutlined, SaveOutlined, UndoOutlined, SearchOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';

/**
 * الصلاحيات — أنهي دور بيقدر يعمل إيه.
 *
 * جدول واحد: الصلاحية في السطر، والدور في العمود، والمربّع بينهم. الشكل ده مقصود — السؤال
 * اللي الشاشة موجودة عشانه هو «مين بيقدر يمسح فاتورة؟»، وده سطر واحد بتقراه بالعرض. شاشة
 * بتفتح دور وتوريك قايمته لوحدها بتخلّي نفس السؤال ثمانية فتحات ومقارنة في الدماغ.
 *
 * مدير النظام عمود مقفول: هو الوحيد اللي بيفتح الشاشة، وشيل صلاحية منه معناه احتمال قفل
 * الباب على نفسه — والشاشة اللي بترجّعها هي اللي اتقفلت.
 *
 * والحفظ لكل دور لوحده، مش زرار واحد للجدول: تغيير صلاحيات دور عملية قائمة بذاتها وليها
 * سطر في سجل العمليات باسم اللي عملها.
 */

interface Capability { key: string; label: string; group: string }
interface Role {
  role: string; label: string; capabilities: string[];
  is_default: boolean; editable: boolean;
}

export default function Permissions() {
  const [caps, setCaps] = useState<Capability[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/permissions');
      setCaps(res.data.capabilities || []);
      setRoles(res.data.roles || []);
      const d: Record<string, Set<string>> = {};
      (res.data.roles || []).forEach((r: Role) => { d[r.role] = new Set(r.capabilities); });
      setDraft(d);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  /** فيه تغيير مش متحفوظ على الدور ده؟ */
  const dirty = (role: Role) => {
    const now = draft[role.role];
    if (!now) return false;
    if (now.size !== role.capabilities.length) return true;
    return role.capabilities.some((c) => !now.has(c));
  };

  const toggle = (roleKey: string, capKey: string, on: boolean) => {
    setDraft((prev) => {
      const next = new Set(prev[roleKey] || []);
      if (on) next.add(capKey); else next.delete(capKey);
      return { ...prev, [roleKey]: next };
    });
  };

  /** كل صلاحيات القسم للدور ده — بضغطة واحدة على رأس المجموعة. */
  const toggleGroup = (roleKey: string, group: string, on: boolean) => {
    setDraft((prev) => {
      const next = new Set(prev[roleKey] || []);
      caps.filter((c) => c.group === group).forEach((c) => (on ? next.add(c.key) : next.delete(c.key)));
      return { ...prev, [roleKey]: next };
    });
  };

  const save = async (role: Role) => {
    setSaving(role.role);
    try {
      await api.put(`/api/v1/permissions/${role.role}`, {
        capabilities: [...(draft[role.role] || [])],
      });
      message.success(`تم حفظ صلاحيات «${role.label}»`);
      await load();
    } finally {
      setSaving(null);
    }
  };

  const reset = async (role: Role) => {
    setSaving(role.role);
    try {
      await api.delete(`/api/v1/permissions/${role.role}`);
      message.success(`أُعيدت صلاحيات «${role.label}» إلى الافتراضي`);
      await load();
    } finally {
      setSaving(null);
    }
  };

  const editable = roles.filter((r) => r.editable);

  // الصلاحيات مجمّعة بالقسم، والبحث بيقلّل السطور من غير ما يفكّ التجميع.
  const rows = useMemo(() => {
    const needle = query.trim();
    const shown = needle
      ? caps.filter((c) => c.label.includes(needle) || c.key.includes(needle) || c.group.includes(needle))
      : caps;
    const byGroup = new Map<string, Capability[]>();
    shown.forEach((c) => {
      if (!byGroup.has(c.group)) byGroup.set(c.group, []);
      byGroup.get(c.group)!.push(c);
    });
    const out: any[] = [];
    byGroup.forEach((items, group) => {
      out.push({ rowKey: `g:${group}`, isGroup: true, group });
      items.forEach((c) => out.push({ rowKey: c.key, isGroup: false, ...c }));
    });
    return out;
  }, [caps, query]);

  const columns = useMemo(() => ([
    {
      title: 'الصلاحية',
      dataIndex: 'label',
      key: 'label',
      width: 260,
      render: (_: any, r: any) => (r.isGroup
        ? <b style={{ fontSize: 13 }}>{r.group}</b>
        : (
          <Tooltip title={r.key} placement="right">
            <span style={{ paddingInlineStart: 14 }}>{r.label}</span>
          </Tooltip>
        )),
    },
    ...editable.map((role) => ({
      title: (
        <div style={{ textAlign: 'center' as const, lineHeight: 1.4 }}>
          <div>{role.label}</div>
          {role.is_default
            ? <Tag color="default" style={{ margin: 0, fontSize: 11 }}>افتراضي</Tag>
            : <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>مضبوط</Tag>}
        </div>
      ),
      key: role.role,
      width: 120,
      align: 'center' as const,
      render: (_: any, r: any) => {
        const set = draft[role.role] || new Set<string>();
        if (r.isGroup) {
          const items = caps.filter((c) => c.group === r.group);
          const on = items.filter((c) => set.has(c.key)).length;
          return (
            <Checkbox
              checked={on === items.length && items.length > 0}
              indeterminate={on > 0 && on < items.length}
              onChange={(e) => toggleGroup(role.role, r.group, e.target.checked)}
            />
          );
        }
        return (
          <Checkbox checked={set.has(r.key)}
            onChange={(e) => toggle(role.role, r.key, e.target.checked)} />
        );
      },
    })),
  ]), [editable, draft, caps]);

  const tableCols = useTableColumns('permissions', columns as any, {
    locked: ['label'],
    export: { name: 'الصلاحيات', rows },
  });

  return (
    <Card
      title="الصلاحيات — ما الذي يستطيع كل دور فعله"
      extra={
        <Space>
          {tableCols.control}
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="مدير النظام بصلاحياته كاملة دائماً وليس في الجدول — وإلا أمكن أن يُغلق الباب من الداخل فلا يستطيع أحد إعادته."
        description="الدور المكتوب عليه «افتراضي» لم يُعدَّل، فيأخذ أي صلاحيات جديدة تأتي مع التحديثات. وبمجرد الحفظ عليه يصبح «مضبوطاً» ويعمل بما حددته أنت فقط — و«رجوع للافتراضي» يعيده كما كان."
      />

      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="بحث في الصلاحيات"
          style={{ width: 280 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Space wrap>
          {editable.map((role) => (
            <Space key={role.role} size={4}>
              <Button
                type="primary"
                size="small"
                icon={<SaveOutlined />}
                disabled={!dirty(role)}
                loading={saving === role.role}
                onClick={() => save(role)}
              >
                حفظ {role.label}
              </Button>
              {!role.is_default && (
                <Tooltip title="يمسح الضبط ويرجّع الدور لافتراضي النظام">
                  <Button size="small" icon={<UndoOutlined />}
                    loading={saving === role.role}
                    onClick={() => reset(role)} />
                </Tooltip>
              )}
            </Space>
          ))}
        </Space>
      </Space>

      <Table
        rowKey="rowKey"
        size="small"
        loading={loading}
        dataSource={rows}
        columns={tableCols.columns}
        tableLayout="fixed"
        pagination={false}
        locale={{ emptyText: <Empty description="لا توجد صلاحية بهذا الاسم" /> }}
        rowClassName={(r: any) => (r.isGroup ? 'perm-group-row' : '')}
      />

      <style>{`.perm-group-row > td { background: #fafafa; }`}</style>
    </Card>
  );
}
