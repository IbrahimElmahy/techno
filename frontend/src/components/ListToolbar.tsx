import React, { useMemo, useRef, useState } from 'react';
import { Button, Col, DatePicker, Input, Row, Select, Tag } from 'antd';
import { SearchOutlined, ClearOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useScreenShortcuts } from './keyboard';

/**
 * One search-and-filter bar for every list in the system.
 *
 * Typing is matched against a normalised form of the text, so Arabic searches are forgiving:
 * "مؤسسه" finds "مؤسسة", "احمد" finds "أحمد", and ٢٠٢٦ finds 2026. Without that, a user who
 * spells a hamza differently to whoever entered the record simply gets no results.
 */

/** Fold the spelling variants Arabic users type interchangeably into one comparable form. */
export function normalizeAr(value: any): string {
  return String(value ?? '')
    .replace(/[ً-ْٰ]/g, '')          // tashkeel
    .replace(/[أإآٱ]/g, 'ا') // أ إ آ ٱ → ا
    .replace(/ى/g, 'ي')                    // ى → ي
    .replace(/ة/g, 'ه')                    // ة → ه
    .replace(/ؤ/g, 'و')                    // ؤ → و
    .replace(/ئ/g, 'ي')                    // ئ → ي
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)) // ٠-٩ → 0-9
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export interface FilterDef {
  key: string;
  placeholder: string;
  /** Choices for a `select` filter. Ignored — and unnecessary — when `kind` is `text`. */
  options?: { value: any; label: string }[];
  /**
   * `select` (الافتراضي) بيدّي قايمة، و`text` بيدّي خانة كتابة.
   *
   * A register is filtered by two different kinds of thing. «الفرع» and «المورد» are a closed set
   * somebody picks from. «مستند رقم» and «رقم الفاتورة» and «ملاحظات» are open text nobody can
   * enumerate — the document numbers are unbounded and the notes are free prose. Forcing those
   * into a dropdown would mean building a list of every value in the table, which grows without
   * limit and still cannot answer «اللي فيه كلمة كذا».
   */
  kind?: 'select' | 'text';
  /**
   * فلتر بيتخبى تحت «المزيد من الفلاتر».
   *
   * الشريط بيتحمّل بسرعة: بحث وتاريخ وتلات قوايم وزرار مسح وعدّاد بيبقوا تمن عناصر، وتمنية
   * مايركبوش صف واحد على شاشة عادية من غير ما الواحد منهم يبقى ضيّق لدرجة إنه مايتقريش.
   *
   * فاللي بيتسأل كل يوم بيفضل بارز، واللي بيتسأل كل شوية بينزل تحت طيّة — نفس اللي في الشاشة
   * اللي العميل شغّال عليها. الفلتر المخبي لسه شغّال: لو ليه قيمة، الطيّة بتفتح لوحدها عشان
   * مايبقاش فيه فلتر بيضيّق النتايج وهو مش باين.
   */
  advanced?: boolean;
  /** Bootstrap-style column span out of 24 (defaults to 5). */
  span?: number;
}

export interface UseListFilterOptions<T> {
  /** Values each row is searched by — anything falsy is skipped. */
  search?: (row: T) => any[];
  /** Named predicates; each runs only when its filter has a value. */
  filters?: Record<string, (row: T, value: any) => boolean>;
  /** Row date used by the date-range filter. */
  dateOf?: (row: T) => string | null | undefined;
  /**
   * Filter values the list opens with. A menu entry naming one slice of a list — «أوراق قبض» is
   * the incoming half of الشيكات — has to arrive with that slice chosen, not with the whole list
   * and a hint. The person can still clear it; it is a starting point, not a lock.
   */
  initialValues?: Record<string, any>;
}

/** Client-side search + filtering for a loaded list. */
export function useListFilter<T>(rows: T[], options: UseListFilterOptions<T> = {}) {
  const [query, setQuery] = useState('');
  const [values, setValues] = useState<Record<string, any>>(options.initialValues ?? {});
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);

  const setValue = (key: string, value: any) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const reset = () => { setQuery(''); setValues(options.initialValues ?? {}); setRange(null); };

  const filtered = useMemo(() => {
    const needle = normalizeAr(query);
    return (rows || []).filter((row) => {
      if (needle) {
        const hay = (options.search ? options.search(row) : Object.values(row as any))
          .filter((v) => v !== null && v !== undefined && typeof v !== 'object')
          .map(normalizeAr);
        if (!hay.some((h) => h.includes(needle))) return false;
      }
      for (const [key, predicate] of Object.entries(options.filters || {})) {
        const v = values[key];
        if (v === undefined || v === null || v === '') continue;
        if (!predicate(row, v)) return false;
      }
      if (range && options.dateOf) {
        const raw = options.dateOf(row);
        if (!raw) return false;
        const d = dayjs(String(raw).slice(0, 10));
        if (d.isBefore(range[0], 'day') || d.isAfter(range[1], 'day')) return false;
      }
      return true;
    });
  }, [rows, query, values, range, options]);

  const active = !!query || Object.values(values).some((v) => v !== undefined && v !== null && v !== '')
    || !!range;

  return { query, setQuery, values, setValue, range, setRange, reset, filtered, active };
}

export default function ListToolbar({
  query, onQueryChange, searchPlaceholder = 'بحث...', filters = [], values = {}, onValueChange,
  showDateRange = false, range, onRangeChange, onReset, total, shown, searchSpan = 6,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  searchPlaceholder?: string;
  filters?: FilterDef[];
  values?: Record<string, any>;
  onValueChange?: (key: string, value: any) => void;
  showDateRange?: boolean;
  range?: [Dayjs, Dayjs] | null;
  onRangeChange?: (v: [Dayjs, Dayjs] | null) => void;
  onReset?: () => void;
  /** Row counts — shown as "المعروض من الإجمالي" so a filtered view is never mistaken for all. */
  total?: number;
  shown?: number;
  searchSpan?: number;
}) {
  const searchRef = useRef<any>(null);
  // F3 belongs to the search box, and the search box lives here — so declaring it once here gives
  // every list in the system the key, instead of thirty screens each remembering to ask for it.
  // It costs nothing where a screen has its own idea of F3: the stack hands the key to whoever
  // registered nearer the top, and this bar is always underneath the screen it sits in.
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } });

  /**
   * الشريط صف واحد، واللي مابيتسألش كل يوم تحت طيّة.
   *
   * بحث + تاريخ + تلات قوايم + مسح + عدّاد = تمن عناصر، وتمنية مايركبوش صف واحد من غير ما كل
   * واحد فيهم يبقى ضيّق لدرجة إنه مايتقريش — خصوصاً مدى التواريخ، اللي محتاج ضعف عرض القايمة.
   *
   * فاللي بيتفلتر بيه كل يوم فاضل بارز، والباقي تحت «المزيد من الفلاتر». والفلتر المخبي لو ليه
   * قيمة الطيّة بتفتح لوحدها: فلتر بيضيّق النتايج وهو مش باين بيخلّي الواحد يبص على قايمة ناقصة
   * ويفتكرها كاملة.
   */
  const primary = filters.filter((f) => !f.advanced);
  const advanced = filters.filter((f) => f.advanced);
  const [showMore, setShowMore] = useState(false);
  const hiddenActive = advanced.some((f) => values[f.key] !== undefined
    && values[f.key] !== null && values[f.key] !== '');
  const expanded = showMore || hiddenActive;

  const control = (f: FilterDef) => (f.kind === 'text' ? (
    /* خانة كتابة — بتفلتر وانت بتكتب، من غير Enter ولا زرار.
       `undefined` مش `''` عشان antd تعرض الـplaceholder بدل خانة فاضية بلا اسم. */
    <Input
      allowClear
      style={{ width: '100%' }}
      placeholder={f.placeholder}
      value={values[f.key] ?? undefined}
      onChange={(e) => onValueChange?.(f.key, e.target.value || undefined)}
    />
  ) : (
    <Select
      allowClear
      showSearch
      style={{ width: '100%' }}
      placeholder={f.placeholder}
      value={values[f.key] ?? undefined}
      optionFilterProp="label"
      onChange={(v) => onValueChange?.(f.key, v)}
      options={f.options}
    />
  ));

  return (
    <>
      <Row gutter={[8, 8]} style={{ marginBottom: expanded ? 8 : 12 }} align="middle">
        <Col xs={24} md={searchSpan}>
          <Input
            allowClear
            ref={searchRef}
            value={query}
            placeholder={searchPlaceholder}
            prefix={<SearchOutlined />}
            onChange={(e) => onQueryChange(e.target.value)}
          />
        </Col>

        {primary.map((f) => (
          <Col xs={12} md={f.span ?? 5} key={f.key}>{control(f)}</Col>
        ))}

        {showDateRange && (
          <Col xs={24} md={6}>
            <DatePicker.RangePicker
              style={{ width: '100%' }}
              value={range ?? null}
              onChange={(v) => onRangeChange?.(v as [Dayjs, Dayjs] | null)}
            />
          </Col>
        )}

        {advanced.length > 0 && (
          <Col xs={12} md={3}>
            <Button type="link" style={{ padding: 0 }}
              icon={expanded ? <UpOutlined /> : <DownOutlined />}
              onClick={() => setShowMore((v) => !v)}>
              فلاتر أكثر
            </Button>
          </Col>
        )}

        <Col xs={12} md={2}>
          <Button icon={<ClearOutlined />} onClick={onReset} block />
        </Col>

        {total !== undefined && (
          <Col xs={12} md={2} style={{ textAlign: 'center' }}>
            <Tag color={shown !== undefined && shown < total ? 'orange' : 'default'}>
              {shown !== undefined && shown < total ? `${shown}/${total}` : `${total}`}
            </Tag>
          </Col>
        )}
      </Row>

      {expanded && advanced.length > 0 && (
        <Row gutter={[8, 8]} style={{ marginBottom: 12 }} align="middle">
          {advanced.map((f) => (
            <Col xs={12} md={f.span ?? 5} key={f.key}>{control(f)}</Col>
          ))}
        </Row>
      )}
    </>
  );
}
