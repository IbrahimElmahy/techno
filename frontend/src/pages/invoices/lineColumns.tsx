/**
 * أعمدة شبكة سطور الفاتورة — اتفصلت عن `Invoices.tsx`.
 *
 * الشاشة ٣١٢٠ سطر، والأعمدة دي ١٣٧ منهم. مافيش فيها حالة: كل اللي محتاجاه بيتبعتلها
 * كمدخلات، فهي دالة بتاخد وبترجّع — واللي بيدوّر على «عمود الكمية بيحسب إزاي» بيلاقيه
 * في ملف اسمه كده بدل ما يعدّي على سبع مية سطر منطق.
 */
import React from 'react';
import { Button, Select, Space, Tag, Tooltip } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { InputNumber } from '../../components/NumberInput';
import type { EntryColumn } from '../../components/EntryGrid';
import { money, numeralsLocale } from '../../utils/money';
import { QTY_DATA_ATTR } from '../../utils/duplicateItem';
import { SaleLineItem, Warehouse } from './types';

export interface LineColumnsCtx {
  viewOnly: boolean;
  warehouses: Warehouse[];
  totalPoints: number;
  pointValues: Record<number, number>;
  productName: (id: number) => string;
  saleUnitOptions: (itemId: number | null) => any[];
  saleLineNet: (l: SaleLineItem) => number;
  linePoints: (l: SaleLineItem) => number;
  checkedQuantity: (l: SaleLineItem) => any;
  handleLineChange: (key: string, field: keyof SaleLineItem, value: any) => void;
  handleRemoveLine: (key: string) => void;
  advanceFrom: (key: string) => void;
  setDocWarehouseId: (id: number | null) => void;
  setPanelItemId: (id: number | null) => void;
}

export function buildLineColumns({
  viewOnly, warehouses, totalPoints, pointValues, productName, saleUnitOptions,
  saleLineNet, linePoints, checkedQuantity, handleLineChange, handleRemoveLine,
  advanceFrom, setDocWarehouseId, setPanelItemId,
}: LineColumnsCtx): EntryColumn<SaleLineItem>[] {
  return [
    { key: 'idx', title: '#', width: 28, locked: true,
      cellStyle: { color: '#6b6b6b', textAlign: 'center' }, cell: (_l, i) => i + 1 },
    // المخزن بيتغيّر من السطر — بالإيد، ولوحده أبداً.
    //
    // تغييره هنا بيغيّر مخزن الفاتورة كمان، فالأصناف اللي بتتضاف بعده بتنزل على نفس
    // المخزن من غير ما تتقال تاني. السطور اللي اتكتبت قبل كده بتفضل مكانها: اللي اتقال
    // مرة مايتغيّرش من ورا اللي كتبه.
    { key: 'warehouse', title: 'المخزن', minWidth: 120,
      cell: (line) => (
        viewOnly ? (
          <span style={{ fontSize: 12 }}>{warehouses.find((w) => w.id === line.warehouse_id)?.name || '-'}</span>
        ) : (
          <Select size="small" style={{ width: '100%' }} placeholder="المخزن"
            value={line.warehouse_id ?? undefined}
            onChange={(v) => {
              handleLineChange(line.key, 'warehouse_id', v ?? null);
              if (v != null) setDocWarehouseId(v as number);
            }}
            options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
        )
      ) },
    { key: 'item', title: 'الصنف', minWidth: 170, locked: true,
      cell: (line) => (
        <b style={{ cursor: 'pointer', fontSize: 13 }} onClick={() => setPanelItemId(line.item_id)}>
          {line.item_id ? productName(line.item_id) : 'اختر الصنف'}
        </b>
      ) },
    { key: 'unit', title: 'الوحدة', minWidth: 80,
      cell: (line) => (
        viewOnly ? (
          <span style={{ fontSize: 12 }}>{line.unit || 'أساسية'}</span>
        ) : (
          <Select size="small" style={{ width: '100%' }} placeholder="الوحدة"
            value={line.unit ?? '__base__'}
            onChange={(v) => handleLineChange(line.key, 'unit', v === '__base__' ? null : v)}
            options={saleUnitOptions(line.item_id)} />
        )
      ) },
    { key: 'quantity', title: 'الكمية', minWidth: 70, locked: true,
      cellProps: (line) => (line.item_id != null
        ? { [QTY_DATA_ATTR]: line.item_id } as any : {}),
      cell: (line) => (
        viewOnly ? (
          <b>{Number(line.quantity || 0).toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 })}</b>
        ) : (
          <InputNumber size="small" style={{ width: '100%' }} min={0.001}
            data-qty-key={line.key} data-grid-col="qty" keyboard={false}
            placeholder="الكمية" value={line.quantity ?? undefined}
            onChange={(val) => handleLineChange(line.key, 'quantity', val ?? null)}
            onBlur={() => handleLineChange(line.key, 'quantity', checkedQuantity(line))}
            onPressEnter={(e) => {
              e.preventDefault();
              handleLineChange(line.key, 'quantity', checkedQuantity(line));
              advanceFrom(line.key);
            }} />
        )
      ),
      footer: (rows) => rows.reduce((n, l) => n + Number(l.quantity || 0), 0)
        .toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 }) },
    { key: 'unit_price', title: 'سعر الوحدة', minWidth: 80,
      cell: (line) => (
        viewOnly ? (
          <span>{money(line.unit_price)} ج.م</span>
        ) : (
          <InputNumber size="small" min={0} step={0.01} style={{ width: '100%' }}
            placeholder="السعر" value={line.unit_price}
            onChange={(v) => handleLineChange(line.key, 'unit_price', v || 0)}
            onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
        )
      ),
      footer: () => null },
    { key: 'gross', title: 'اجمالي قبل', minWidth: 85,
      cellStyle: { whiteSpace: 'nowrap' },
      cell: (line) => money(Number(line.quantity || 0) * (line.unit_price || 0)),
      footer: (rows) => money(rows.reduce(
        (n, l) => n + Number(l.quantity || 0) * (l.unit_price || 0), 0)) },
    { key: 'variable_discount', title: 'خصم متغير %', minWidth: 75,
      cell: (line) => (
        viewOnly ? (
          <span>{line.variable_discount != null ? `${line.variable_discount}%` : '-'}</span>
        ) : (
          <InputNumber size="small" min={0} max={99.99} step={0.5} style={{ width: '100%' }}
            placeholder="متغير" value={line.variable_discount ?? undefined}
            onChange={(v) => handleLineChange(line.key, 'variable_discount', (v as number) ?? null)}
            onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
        )
      ),
      footer: () => null },
    { key: 'fixed_discount', title: 'خصم ثابت %', minWidth: 75,
      cell: (line) => (
        viewOnly ? (
          <span>{line.fixed_discount ? `${line.fixed_discount}%` : '-'}</span>
        ) : (
          <InputNumber size="small" min={0} max={99.99} step={0.5} style={{ width: '100%' }}
            placeholder="ثابت" value={line.fixed_discount ?? undefined}
            onChange={(v) => handleLineChange(line.key, 'fixed_discount', (v as number) ?? 0)}
            onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
        )
      ),
      footer: () => null },
    { key: 'total', title: 'الإجمالي', minWidth: 90, locked: true,
      cellStyle: { fontWeight: 700, whiteSpace: 'nowrap' },
      cell: (line) => money(saleLineNet(line)),
      footer: (rows) => money(rows.reduce((n, l) => n + saleLineNet(l), 0)) },
    { key: 'points', title: 'النقاط', minWidth: 65,
      cellStyle: { whiteSpace: 'nowrap', color: '#b26a00' },
      // «مالوش نقط» و«لسه ماكتبتش الكمية» كانوا شكلهم واحد: شرطة. النقط = نقطة الصنف
      // × الكمية، فسطر لسه كميته فاضية بيطلع صفر — واللي بيبص بيفتكر إن الصنف مالوش
      // نقط أصلاً ويسأل ليه.
      cell: (line) => {
        const v = linePoints(line);
        if (v) return v.toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 });
        const per = line.item_id ? (pointValues[line.item_id] || 0) : 0;
        if (per > 0) {
          return (
            <span style={{ color: '#b0b0b0' }} title={`${per} نقطة للوحدة`}>
              × {per.toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 })}
            </span>
          );
        }
        return '-';
      },
      footer: () => (
        <span style={{ color: '#b26a00' }}>
          {totalPoints.toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 })}
        </span>
      ) },
    { key: 'actions', title: '', label: 'حذف السطر', width: 32, locked: true,
      cell: (line) => (
        viewOnly ? null : (
          <Button size="small" danger type="text" icon={<DeleteOutlined />}
            onClick={() => handleRemoveLine(line.key)} />
        )
      ),
      footer: () => null },
  ];
}
