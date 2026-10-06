import { useMemo, useState } from 'react';
import { Button, Select } from 'antd';
import { AppstoreOutlined, PlusOutlined } from '@ant-design/icons';
import { searchByName } from '../utils/arabicSort';
import { normalizeAr } from './ListToolbar';
import { qty as fmtQty } from '../utils/money';

/**
 * **السطر الزيادة في آخر جدول الأصناف** (طلب العميل ٢٠٢٦-١٠-٠٥) — في كل مستند: البيع والشرا
 * والمرتجعات والتحويل والأذون.
 *
 * بيختار منه المخزن **الأول** (قبل ما يختار الصنف)، وبعدين الصنف بالبحث على طول — أو يفتح
 * شباك الأصناف على المخزن ده. الصنف بيتضاف سطر جديد على المخزن اللي في السطر ده، والتركيز
 * بيروح على كميته زي أي إضافة. المخزن اللي اتختار هنا بيبقى مخزن المستند للإضافات اللي بعده.
 *
 * الأصناف في البحث: لو `availableFor` متبعتة (بيع أو صرف من مخزن) ⇒ اللي ليه رصيد في المخزن
 * المختار بس — نفس قاعدة شباك الأصناف.
 */
export interface QuickAddItem { id: number; name: string; code?: string | null }

export default function QuickAddRow({
  colSpan, items, onPick, onOpenPicker, warehouses, warehouseId, onWarehouseChange,
  availableFor, disabled = false, placeholder = 'اكتب اسم الصنف وأضفه على طول…', asDiv = false,
}: {
  colSpan: number;
  items: QuickAddItem[];
  onPick: (itemId: number) => void;
  onOpenPicker: () => void;
  /** من غيرها مافيش خانة مخزن (المستند مخزنه واحد ومتحدد فوق). */
  warehouses?: { id: number; name: string }[];
  warehouseId?: number | null;
  onWarehouseChange?: (id: number) => void;
  availableFor?: (itemId: number) => number | null;
  disabled?: boolean;
  placeholder?: string;
  /** تحت جدول مش جوّاه (أذون المخزن جدولها antd) ⇒ `div` بدل سطر جدول. */
  asDiv?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [value, setValue] = useState<number | null>(null);

  const options = useMemo(() => {
    const needle = normalizeAr(search.trim());
    let list = items;
    if (availableFor) {
      list = list.filter((p) => {
        const av = availableFor(p.id);
        return av === null || av > 0;
      });
    }
    // الفلترة والترتيب بالقُرب **قبل** السقف: «ك» ⇒ اللي بيبدأ بالكاف فوق واللي الكاف في
    // نصّه تحت (`searchByName`). لو السقف قبل الترتيب، الستين اللي بيظهروا كانوا أول ستين
    // في ترتيب الشاشة — و«كوع» ممكن مايبقاش منهم خالص.
    if (needle) list = searchByName(list, needle, (p) => p.name, (p) => p.code);
    // سقف عشان القايمة تفتح على طول — اللي بيدوّر بيكمّل كتابة.
    return list.slice(0, 60).map((p) => {
      const av = availableFor ? availableFor(p.id) : null;
      return {
        value: p.id,
        label: (
          <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <span>{p.name}</span>
            {av !== null && <span style={{ color: '#16a34a', fontWeight: 800 }}>{fmtQty(av)}</span>}
          </span>
        ),
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, search, availableFor, warehouseId]);

  if (disabled) return null;
  const body = (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '4px 2px' }}>
          <PlusOutlined style={{ color: '#16a34a', fontSize: 16 }} />
          {warehouses && onWarehouseChange && (
            <Select
              size="middle" style={{ width: 220 }} placeholder="المخزن الأول"
              value={warehouseId ?? undefined}
              onChange={(v: number) => onWarehouseChange(v)}
              showSearch optionFilterProp="label"
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
            />
          )}
          <Select
            size="middle" style={{ flex: 1, minWidth: 260 }}
            showSearch filterOption={false} value={value ?? undefined}
            placeholder={placeholder} searchValue={search} onSearch={setSearch}
            onChange={(v: number) => {
              onPick(v);
              setValue(null);
              setSearch('');
            }}
            options={options}
            notFoundContent={search ? 'مافيش صنف بالاسم ده هنا' : null}
          />
          <Button icon={<AppstoreOutlined />} onClick={onOpenPicker}>قايمة الأصناف</Button>
        </div>
  );
  if (asDiv) return <div className="eg-quick-row eg-quick-div">{body}</div>;
  return (
    <tr className="eg-quick-row">
      <td colSpan={colSpan}>{body}</td>
    </tr>
  );
}
