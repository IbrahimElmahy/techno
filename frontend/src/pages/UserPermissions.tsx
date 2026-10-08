import { useEffect, useMemo, useState } from 'react';
import {
  Badge, Button, Checkbox, Empty, Input, Space, Spin, Tabs, Tag, Tooltip, message,
} from 'antd';
import {
  SafetyCertificateOutlined, SaveOutlined, SearchOutlined, UndoOutlined, UserOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useAuth, roleForAccess } from '../components/AuthProvider';
import ListPage from '../components/ListPage';
import {
  EXTRA_SECTIONS, HOME_SCREEN, NAVIGATION, isGroup, type NavGroup, type NavScreen,
} from '../components/navigation';

interface UserRow {
  id: number; username: string; full_name: string | null; role: string; role_label: string;
  branch_id: number | null; branch_name: string | null; active: boolean; overrides: number;
}
interface Cap { key: string; label: string; group: string }
interface Perms {
  user: UserRow;
  role_capabilities: string[];
  grants: string[];
  denies: string[];
  assignable: string[];
  manager_hidden_pages: string[];
  capabilities: Cap[];
}

const PAGE = 'page:';

type Tri = { def: boolean; on: boolean };

export default function UserPermissions() {
  const { user: me } = useAuth();
  const meRole = me ? roleForAccess(me.role) : 'viewer';
  const isAdmin = me?.role === 'owner' || me?.role === 'system_admin';

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [perms, setPerms] = useState<Perms | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [diff, setDiff] = useState<Record<string, boolean>>({});

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      setUsers((await api.get('/api/v1/permissions/users', { headers: { 'Cache-Control': 'no-cache' } })).data || []);
    } catch (e: any) {
      message.error(e?.response?.data?.detail?.message || 'تعذر تحميل المستخدمين');
    } finally { setLoadingUsers(false); }
  };
  useEffect(() => { loadUsers(); }, []);

  const loadPerms = async (id: number) => {
    setLoading(true);
    try {
      const d: Perms = (await api.get(`/api/v1/permissions/users/${id}`)).data;
      setPerms(d);
      const next: Record<string, boolean> = {};
      d.grants.forEach((c) => { next[c] = true; });
      d.denies.forEach((c) => { next[c] = false; });
      setDiff(next);
    } catch (e: any) {
      message.error(e?.response?.data?.detail?.message || 'تعذر تحميل الصلاحيات');
      setPerms(null);
    } finally { setLoading(false); }
  };
  useEffect(() => { if (selected) loadPerms(selected); }, [selected]);

  const shownUsers = useMemo(() => {
    const t = q.trim();
    if (!t) return users;
    return users.filter((u) => `${u.full_name || ''} ${u.username} ${u.role_label} ${u.branch_name || ''}`.includes(t));
  }, [users, q]);

  const targetRole = perms ? (perms.user.role === 'owner' ? 'system_admin' : perms.user.role) : '';
  const roleCaps = useMemo(() => new Set(perms?.role_capabilities || []), [perms]);
  const assignable = useMemo(() => new Set(perms?.assignable || []), [perms]);

  const state = (key: string, def: boolean): Tri => ({
    def, on: key in diff ? diff[key] : def,
  });
  const toggle = (key: string, def: boolean, value: boolean) => {
    setDiff((d) => {
      const n = { ...d };
      if (value === def) delete n[key]; else n[key] = value;
      return n;
    });
  };

  const managerSeesPage = (s: NavScreen) => isAdmin || (
    !perms?.manager_hidden_pages.includes(s.key)
    && (s.roles.includes(meRole) || !!me?.pages_shown?.includes(s.key)));

  const save = async () => {
    if (!perms) return;
    setSaving(true);
    try {
      const grants = Object.entries(diff).filter(([, v]) => v).map(([k]) => k);
      const denies = Object.entries(diff).filter(([, v]) => !v).map(([k]) => k);
      const d: Perms = (await api.put(`/api/v1/permissions/users/${perms.user.id}`, { grants, denies })).data;
      setPerms(d);
      message.success('تم حفظ صلاحيات المستخدم، وستُطبَّق من الطلب التالي');
      loadUsers();
    } catch (e: any) {
      message.error(e?.response?.data?.detail?.message || 'تعذر الحفظ');
    } finally { setSaving(false); }
  };

  const changed = perms && JSON.stringify(Object.keys(diff).sort().map((k) => [k, diff[k]]))
    !== JSON.stringify([...perms.grants.map((c) => [c, true]), ...perms.denies.map((c) => [c, false])]
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

  const mark = (t: Tri) => (t.on !== t.def
    ? <Tag color={t.on ? 'green' : 'red'} style={{ marginInlineStart: 6 }}>{t.on ? 'ممنوحة له' : 'محجوبة عنه'}</Tag>
    : null);

  const pageRow = (s: NavScreen) => {
    const key = PAGE + s.key;
    const t = state(key, s.roles.includes(targetRole));
    const canTurnOn = managerSeesPage(s);
    return (
      <div key={s.key} className="up-row">
        <Checkbox checked={t.on} disabled={!t.on && !canTurnOn}
          onChange={(e) => toggle(key, t.def, e.target.checked)}>
          {s.label}
        </Checkbox>
        {mark(t)}
      </div>
    );
  };

  const pageGroup = (g: NavGroup | NavScreen, depth = 0): JSX.Element | null => {
    if (!isGroup(g)) return pageRow(g);
    const kids = g.children.map((c) => pageGroup(c, depth + 1)).filter(Boolean);
    if (!kids.length) return null;
    return (
      <div key={g.key} className={depth === 0 ? 'up-section' : 'up-sub'}>
        <div className={depth === 0 ? 'up-section-title' : 'up-sub-title'}>{g.label}</div>
        <div className="up-grid">{kids}</div>
      </div>
    );
  };

  const capList = (filter: (c: Cap) => boolean) => {
    const caps = (perms?.capabilities || []).filter(filter);
    const groups = new Map<string, Cap[]>();
    caps.forEach((c) => groups.set(c.group, [...(groups.get(c.group) || []), c]));
    return [...groups.entries()].map(([title, list]) => (
      <div key={title} className="up-section">
        <div className="up-section-title">{title}</div>
        <div className="up-grid">
          {list.map((c) => {
            const t = state(c.key, roleCaps.has(c.key));
            const canTurnOn = assignable.has(c.key);
            return (
              <div key={c.key} className="up-row">
                <Tooltip title={!t.on && !canTurnOn ? 'لا تملك هذه الصلاحية، فلا يمكنك منحها' : c.key}>
                  <Checkbox checked={t.on} disabled={!t.on && !canTurnOn}
                    onChange={(e) => toggle(c.key, t.def, e.target.checked)}>
                    {c.label}
                  </Checkbox>
                </Tooltip>
                {mark(t)}
              </div>
            );
          })}
        </div>
      </div>
    ));
  };

  const count = (pred: (k: string) => boolean) => Object.keys(diff).filter(pred).length;

  return (
    <ListPage
      icon={<SafetyCertificateOutlined />}
      title="صلاحيات المستخدمين"
      muted={isAdmin ? '(كل الفروع)' : '(مستخدمو فرعك)'}
    >
      <div className="up-layout">
        <aside className="up-users">
          <Input allowClear prefix={<SearchOutlined />} placeholder="بحث بالاسم أو الدور أو الفرع"
            value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="up-users-list">
            {loadingUsers ? <Spin style={{ margin: 24 }} /> : shownUsers.length === 0 ? (
              <Empty description="لا يوجد مستخدمون" />
            ) : shownUsers.map((u) => (
              <button type="button" key={u.id}
                className={`up-user${selected === u.id ? ' is-on' : ''}${u.active ? '' : ' is-off'}`}
                onClick={() => setSelected(u.id)}>
                <span className="up-user-name"><UserOutlined /> {u.full_name || u.username}</span>
                <span className="up-user-meta">
                  {u.role_label}{u.branch_name ? ` · ${u.branch_name}` : ''}
                  {u.overrides > 0 && <Badge count={u.overrides} style={{ background: '#fa8c16', marginInlineStart: 6 }} />}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="up-detail">
          {!selected ? (
            <Empty style={{ marginTop: 80 }} description="اختر مستخدماً من القائمة" />
          ) : loading || !perms ? (
            <Spin style={{ margin: 80 }} />
          ) : (
            <>
              <div className="up-head">
                <div>
                  <div className="up-head-name">{perms.user.full_name || perms.user.username}</div>
                  <div className="up-head-meta">
                    <Tag>{perms.user.role_label}</Tag>
                    {perms.user.branch_name && <Tag color="blue">{perms.user.branch_name}</Tag>}
                    <span dir="ltr">{perms.user.username}</span>
                  </div>
                </div>
                <Space>
                  <Button icon={<UndoOutlined />} disabled={Object.keys(diff).length === 0}
                    onClick={() => setDiff({})}>الرجوع إلى صلاحيات الدور</Button>
                  <Button type="primary" icon={<SaveOutlined />} loading={saving}
                    disabled={!changed} onClick={save}>حفظ</Button>
                </Space>
              </div>
              <Tabs
                items={[
                  {
                    key: 'pages',
                    label: <>صفحات النظام {count((k) => k.startsWith(PAGE)) > 0 && <Badge count={count((k) => k.startsWith(PAGE))} />}</>,
                    children: (
                      <div className="up-body">
                        {pageRow(HOME_SCREEN)}
                        {[...NAVIGATION, ...EXTRA_SECTIONS].map((n) => pageGroup(n))}
                      </div>
                    ),
                  },
                  {
                    key: 'caps',
                    label: <>العمليات {count((k) => !k.startsWith(PAGE) && !k.startsWith('app.')) > 0 && <Badge count={count((k) => !k.startsWith(PAGE) && !k.startsWith('app.'))} />}</>,
                    children: <div className="up-body">{capList((c) => !c.key.startsWith('app.'))}</div>,
                  },
                  {
                    key: 'app',
                    label: <>التطبيق {count((k) => k.startsWith('app.')) > 0 && <Badge count={count((k) => k.startsWith('app.'))} />}</>,
                    children: <div className="up-body">{capList((c) => c.key.startsWith('app.'))}</div>,
                  },
                ]}
              />
            </>
          )}
        </section>
      </div>
    </ListPage>
  );
}
