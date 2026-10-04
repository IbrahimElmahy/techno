import React, { useEffect, useMemo, useState } from 'react';
import { Dropdown, Input, Modal, message } from 'antd';
import type { MenuProps } from 'antd';
import { CloseOutlined, LinkOutlined, PlusOutlined, StarFilled } from '@ant-design/icons';

/**
 * **الاختصارات — زرار «+» تحت على الشمال، لإنشاء المستندات.** (طلب العميل ٢٠٢٦-٠٩-٣٠)
 *
 * مش صفحات — التنقّل بين الصفحات من القايمة. الاختصار هنا **إنشاء**: «تسجيل طلب بيع»،
 * «فاتورة شراء»، «مرتجع»، «سند قبض»… الماوس على «+» بيفتح اختصاراتك، والضغط على واحد
 * بيفتح شاشته ويدوس زرار الإنشاء بتاعها. و«إضافة اختصار» (بالماوس برضو) بتفتح قايمة
 * الإنشاءات متقسّمة بالأقسام، والضغط على واحد بيضيفه. والـ× جنب الاختصار بيشيله.
 *
 * **الإنشاء بيدوس الزرار نفسه اللي في الشاشة** — مش نسخة تانية من فتح النموذج. فأي حاجة
 * الشاشة بتعملها قبل الفتح (سؤال العميل، المخزن، المسودّة) بتحصل زي ما هي.
 *
 * الإنشاء اللي شاشته مش مسموح له بيها مابيظهرش في القايمة أصلاً. والاختصارات بتتحفظ في
 * المتصفح لكل مستخدم لوحده (`create-shortcuts.<id>`).
 */
type Action = { id: string; group: string; label: string; route: string; button: string };

/** الإنشاءات — الشاشة، ونص زرار الإنشاء فيها بالظبط. */
export const CREATE_ACTIONS: Action[] = [
  { id: 'sale', group: 'المبيعات', label: 'تسجيل طلب بيع', route: '/invoices', button: 'تسجيل طلب بيع' },
  { id: 'sale-return', group: 'المبيعات', label: 'مرتجع بيع', route: '/returns', button: 'تسجيل مرتجع بيع' },
  { id: 'customer', group: 'المبيعات', label: 'عميل جديد', route: '/customers', button: 'إضافة عميل' },
  { id: 'purchase', group: 'المشتريات', label: 'تسجيل فاتورة شراء', route: '/purchases', button: 'تسجيل فاتورة شراء' },
  { id: 'purchase-return', group: 'المشتريات', label: 'مردود شراء', route: '/purchase-returns', button: 'تسجيل مردود شراء' },
  { id: 'supplier', group: 'المشتريات', label: 'مورد جديد', route: '/suppliers', button: 'إضافة مورد' },
  // كل أنواع السندات (طلب العميل ٢٠٢٦-٠٩-٣٠).
  { id: 'receipt', group: 'السندات', label: 'سند قبض', route: '/vouchers?tab=receipt', button: 'سند قبض جديد' },
  { id: 'payment', group: 'السندات', label: 'سند صرف', route: '/vouchers?tab=payment', button: 'سند صرف جديد' },
  { id: 'handover', group: 'السندات', label: 'توريد مندوب', route: '/vouchers?tab=handover', button: 'توريد جديد' },
  { id: 'expense', group: 'السندات', label: 'سند مصروف', route: '/vouchers?tab=expense', button: 'مصروف جديد' },
  { id: 'treasury-transfer', group: 'السندات', label: 'تحويل بين الخزن', route: '/vouchers?tab=transfer', button: 'تحويل جديد' },
  { id: 'cheque-in', group: 'السندات', label: 'ورقة قبض', route: '/vouchers?tab=cheques&direction=incoming', button: 'ورقة جديدة' },
  { id: 'cheque-out', group: 'السندات', label: 'ورقة دفع', route: '/vouchers?tab=cheques&direction=outgoing', button: 'ورقة جديدة' },
  { id: 'transfer', group: 'المخازن', label: 'طلب تحويل مخزني', route: '/transfers', button: 'طلب تحويل مخزني' },
  // شاشة مش إنشاء (طلب العميل ٢٠٢٦-١٠-٠٢) — `button` فاضي = بيفتح الشاشة بس.
  { id: 'account-statement', group: 'الحسابات', label: 'كشف حساب', route: '/account-statement', button: '' },
];

interface Props {
  userId: number | string | null | undefined;
  /** شجرة القايمة بعد فلترة الصلاحيات — الإنشاء اللي شاشته مش فيها مابيظهرش. */
  tree: any[];
  openTab: (key: string) => void;
}

const storeKey = (id: Props['userId']) => `create-shortcuts.${id ?? 'anon'}`;

function load(id: Props['userId']): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(id)) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** بيستنى زرار الإنشاء يظهر في الشاشة اللي اتفتحت ويدوسه. */
function pressWhenReady(text: string, onMissing: () => void) {
  const started = Date.now();
  const tick = () => {
    const btn = [...document.querySelectorAll<HTMLElement>('button')].find((b) =>
      b.offsetParent !== null && !b.hasAttribute('disabled')
      // بيبدأ بالاسم، مش بيساويه: الزرار ممكن يكون «تسجيل طلب بيع جديد» أو عليه اختصار.
      && (b.textContent || '').replace(/\s+/g, ' ').trim().startsWith(text));
    if (btn) { btn.click(); return; }
    if (Date.now() - started > 6000) { onMissing(); return; }
    window.setTimeout(tick, 150);
  };
  window.setTimeout(tick, 100);
}

/**
 * **اختصار بلينك** — اسم بيكتبه المستخدم ولينك بيلزقه (طلب العميل ٢٠٢٦-٠٩-٣٠).
 * لينك جوّه النظام بيتفتح في تبويب زي أي شاشة؛ لينك برّه النظام بيتفتح في تبويب متصفح جديد.
 */
type LinkShortcut = { id: string; label: string; url: string };
const linksKey = (id: Props['userId']) => `create-shortcut-links.${id ?? 'anon'}`;
function loadLinks(id: Props['userId']): LinkShortcut[] {
  try {
    const v = JSON.parse(localStorage.getItem(linksKey(id)) || '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.url === 'string') : [];
  } catch {
    return [];
  }
}
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
/** اللينك ده صفحة في النظام؟ ⇐ مسارها من غير البادئة (`/staging`)، وإلا `null`. */
function internalRoute(url: string): string | null {
  try {
    const u = new URL(url.trim(), window.location.origin);
    if (u.origin !== window.location.origin) return null;
    let path = u.pathname;
    if (BASE && path.startsWith(BASE)) path = path.slice(BASE.length) || '/';
    return path + u.search;
  } catch {
    return null;
  }
}

export default function ShortcutsDock({ userId, tree, openTab }: Props) {
  const [ids, setIds] = useState<string[]>(() => load(userId));
  const [links, setLinks] = useState<LinkShortcut[]>(() => loadLinks(userId));
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  useEffect(() => { setIds(load(userId)); setLinks(loadLinks(userId)); }, [userId]);
  const save = (next: string[]) => {
    setIds(next);
    try { localStorage.setItem(storeKey(userId), JSON.stringify(next)); } catch { /* متصفح مقفول */ }
  };
  const saveLinks = (next: LinkShortcut[]) => {
    setLinks(next);
    try { localStorage.setItem(linksKey(userId), JSON.stringify(next)); } catch { /* متصفح مقفول */ }
  };

  // الشاشات المسموحة — نفس اللي القايمة بترسمه.
  const allowed = useMemo(() => {
    const out = new Set<string>();
    const walk = (nodes: any[]) => nodes.forEach((n) => {
      if (n.children) walk(n.children); else out.add(String(n.key));
    });
    walk(tree);
    return out;
  }, [tree]);
  const available = CREATE_ACTIONS.filter((a) => allowed.has(a.route));
  const mine = ids.map((id) => available.find((a) => a.id === id)).filter(Boolean) as Action[];
  const have = new Set(mine.map((a) => a.id));

  const row = (text: string) => (
    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 16, minWidth: 180 }}>
      <span>{text}</span>
      <CloseOutlined data-del="1" title="شيل الاختصار"
        style={{ fontSize: 14, color: '#555b65', padding: 2 }} />
    </span>
  );

  const groups = [...new Set(available.map((a) => a.group))];
  const menu: MenuProps['items'] = [
    ...mine.map((a) => ({
      key: `go:${a.id}`, icon: <StarFilled style={{ color: '#F5A11D' }} />, label: row(a.label),
    })),
    ...links.map((l) => ({
      key: `link:${l.id}`, icon: <LinkOutlined style={{ color: '#1677ff' }} />, label: row(l.label),
    })),
    ...(mine.length || links.length
      ? [] : [{ key: 'empty', label: 'مافيش اختصارات لسه — ضيف من تحت', disabled: true }]),
    { type: 'divider' as const },
    {
      key: 'grp:add', icon: <PlusOutlined />, label: 'إضافة اختصار',
      // مستويين بس: «+» ← «إضافة اختصار» ← الإنشاءات تحت عناوين الأقسام. تلات مستويات
      // بالماوس بتقفل من أقل ميلة وهو ماشي من قايمة للي جنبها.
      children: [
        ...groups.map((g) => ({
          key: `grp:${g}`, type: 'group' as const, label: g,
          children: available.filter((a) => a.group === g).map((a) => ({
            key: `add:${a.id}`,
            label: have.has(a.id) ? `✓ ${a.label}` : a.label,
            disabled: have.has(a.id),
          })),
        })),
        { type: 'divider' as const },
        { key: 'add-link', icon: <LinkOutlined />, label: 'اختصار باسم ولينك…' },
      ],
    },
  ];

  const onClick: MenuProps['onClick'] = ({ key, domEvent }) => {
    const del = Boolean((domEvent.target as HTMLElement)?.closest?.('[data-del]'));
    if (key.startsWith('go:')) {
      const id = key.slice(3);
      if (del) { save(ids.filter((x) => x !== id)); return; }
      const a = available.find((x) => x.id === id);
      if (!a) return;
      openTab(a.route);
      if (!a.button) return;
      pressWhenReady(a.button, () => message.info(
        `«${a.label}» — اقفل المستند المفتوح في الشاشة دي الأول، وبعدين دوس الاختصار تاني`));
      return;
    }
    if (key.startsWith('link:')) {
      const id = key.slice(5);
      if (del) { saveLinks(links.filter((x) => x.id !== id)); return; }
      const l = links.find((x) => x.id === id);
      if (!l) return;
      const route = internalRoute(l.url);
      if (route) openTab(route);
      else window.open(l.url, '_blank', 'noopener');
      return;
    }
    if (key === 'add-link') { setLinkName(''); setLinkUrl(''); setLinkOpen(true); return; }
    if (key.startsWith('add:')) {
      const id = key.slice(4);
      if (!have.has(id)) save([...ids, id]);
    }
  };

  const addLink = () => {
    const label = linkName.trim();
    let url = linkUrl.trim();
    if (!label || !url) { message.warning('اكتب اسم الاختصار واللينك'); return; }
    // «app.technothermeg.com/...» من غير http — بيتكمّل بدل ما يترفض.
    if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) url = `https://${url}`;
    saveLinks([...links, { id: String(Date.now()), label, url }]);
    setLinkOpen(false);
    message.success(`اتضاف «${label}»`);
  };

  return (
    <div style={{ position: 'fixed', left: 20, bottom: 20, zIndex: 1000 }}>
      <Dropdown menu={{ items: menu, onClick }} trigger={['hover']} placement="topLeft"
        mouseLeaveDelay={0.3}>
        <button type="button" aria-label="اختصارات الإنشاء" title="اختصارات الإنشاء" style={{
          width: 48, height: 48, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: '#6AB42D', color: '#fff', fontSize: 22, display: 'flex',
          alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 10px rgba(0,0,0,.25)',
        }}>
          <PlusOutlined />
        </button>
      </Dropdown>
      <Modal open={linkOpen} title="اختصار باسم ولينك" okText="إضافة" cancelText="إلغاء"
        onOk={addLink} onCancel={() => setLinkOpen(false)} destroyOnHidden>
        <div style={{ marginBottom: 6 }}>اسم الاختصار</div>
        <Input autoFocus value={linkName} onChange={(e) => setLinkName(e.target.value)}
          placeholder="مثلاً: كشف حساب محمد" onPressEnter={addLink} />
        <div style={{ margin: '12px 0 6px' }}>اللينك</div>
        <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} dir="ltr"
          placeholder="https://app.technothermeg.com/..." onPressEnter={addLink} />
        <div style={{ marginTop: 8, fontSize: 14, color: '#6b6b6b' }}>
          لينك صفحة في النظام بيتفتح في تبويب جوّه النظام، وأي لينك تاني بيتفتح في المتصفح.
        </div>
      </Modal>
    </div>
  );
}
