import React from 'react';
import { Button, Select, Space, Tag, Tooltip } from 'antd';
import { DeleteOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons';
import { InputNumber } from '../../components/NumberInput';
import type { EntryColumn } from '../../components/EntryGrid';
import { money, numeralsLocale } from '../../utils/money';
import { QTY_DATA_ATTR } from '../../utils/duplicateItem';
import { applyPct } from '../../utils/discounts';
import { SaleLineItem, Warehouse } from './types';
import { activeOptions } from '../../utils/active';

export const afterFixedOf = (l: SaleLineItem) =>
  applyPct(Number(l.quantity || 0) * (l.unit_price || 0), l.fixed_discount);

export interface LineColumnsCtx {
  viewOnly: boolean;
  warehouses: Warehouse[];
  totalPoints: number;
  pointValues: Record<number, number>;
  productName: (id: number) => string;
  saleUnitOptions: (itemId: number | null) => any[];
  availabilityHint?: (l: SaleLineItem) => string | null;
  saleLineNet: (l: SaleLineItem) => number;
  linePoints: (l: SaleLineItem) => number;
  checkedQuantity: (l: SaleLineItem) => any;
  handleLineChange: (key: string, field: keyof SaleLineItem, value: any) => void;
  handleRemoveLine: (key: string) => void;
  advanceFrom: (key: string) => void;
  setDocWarehouseId: (id: number | null) => void;
  setPanelItemId: (id: number | null) => void;
  hidePoints?: boolean;
  isBonus?: boolean;
  productCode?: (id: number) => string | null | undefined;
  belowCost?: (l: SaleLineItem) => boolean;
  canSellBelowCost?: boolean;
}

const fmtQty = (n: number) => n.toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 });

export function buildLineColumns({
  viewOnly, warehouses, totalPoints, pointValues, productName, saleUnitOptions,
  availabilityHint, saleLineNet, linePoints, checkedQuantity, handleLineChange, handleRemoveLine,
  advanceFrom, setDocWarehouseId, setPanelItemId, hidePoints = false, isBonus = false,
  productCode, belowCost, canSellBelowCost = false,
}: LineColumnsCtx): EntryColumn<SaleLineItem>[] {
  return [
    { key: 'idx', title: '#', width: 32, locked: true,
      cellStyle: { color: '#5b6575', textAlign: 'center' }, cell: (_l, i) => i + 1 },
    { key: 'item', title: 'اسم الصنف والوصف', width: 210, minWidth: 120, locked: true,
      cell: (line) => {
        const name = line.item_id ? productName(line.item_id) : 'اختر الصنف';
        return (
          <div style={{ cursor: 'pointer', lineHeight: 1.25 }} onClick={() => setPanelItemId(line.item_id)}>
            <div className="eg-ellipsis" title={name} style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>
              {name}
            </div>
          </div>
        );
      } },
    { key: 'warehouse', title: 'المخزن', width: 120,
      cellStyle: { textAlign: 'center' },
      cell: (line) => (
        viewOnly ? (
          <span className="sale-wh-tag">{warehouses.find((w) => w.id === line.warehouse_id)?.name || '-'}</span>
        ) : (
          <Select size="small" className="sale-wh-select" style={{ width: '100%' }} placeholder="المخزن"
            value={line.warehouse_id ?? undefined}
            onChange={(v) => {
              handleLineChange(line.key, 'warehouse_id', v ?? null);
              if (v != null) setDocWarehouseId(v as number);
            }}
            options={activeOptions(warehouses, line.warehouse_id)} />
        )
      ) },
    { key: 'unit', title: 'الوحدة', width: 80,
      cell: (line) => {
        const hint = availabilityHint?.(line);
        return viewOnly ? (
          <span style={{ fontSize: 14 }}>{line.unit || saleUnitOptions(line.item_id)[0]?.label || 'أساسية'}</span>
        ) : (
          <>
            <Select size="small" style={{ width: '100%' }} placeholder="الوحدة"
              value={line.unit ?? '__base__'} popupMatchSelectWidth={false}
              onChange={(v) => handleLineChange(line.key, 'unit', v === '__base__' ? null : v)}
              options={saleUnitOptions(line.item_id)} />
            {hint ? (
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.3, marginTop: 2,
                whiteSpace: 'normal' }}>{hint}</div>
            ) : null}
          </>
        );
      } },
    { key: 'quantity', title: 'الكمية', width: 114, locked: true,
      cellStyle: { textAlign: 'center' },
      cellProps: (line) => (line.item_id != null
        ? { [QTY_DATA_ATTR]: line.item_id } as any : {}),
      cell: (line) => (
        viewOnly ? (
          <b>{fmtQty(Number(line.quantity || 0))}</b>
        ) : (
          <div className="qty-stepper">
            <button type="button" tabIndex={-1} className="qty-step" title="إنقاص واحد"
              disabled={Number(line.quantity || 0) <= 1}
              onClick={() => {
                const q = Number(line.quantity || 0);
                if (q > 1) handleLineChange(line.key, 'quantity', q - 1);
              }}><MinusOutlined /></button>
            <InputNumber size="small" style={{ width: 54 }} min={0.001}
              data-qty-key={line.key} data-grid-col="qty" keyboard={false} controls={false}
              placeholder="الكمية" value={line.quantity ?? undefined}
              onChange={(val) => handleLineChange(line.key, 'quantity', val ?? null)}
              onBlur={() => handleLineChange(line.key, 'quantity', checkedQuantity(line))}
              onPressEnter={(e) => {
                e.preventDefault();
                handleLineChange(line.key, 'quantity', checkedQuantity(line));
                advanceFrom(line.key);
              }} />
            <button type="button" tabIndex={-1} className="qty-step" title="زيادة واحد"
              onClick={() => handleLineChange(line.key, 'quantity',
                checkedQuantity({ ...line, quantity: Number(line.quantity || 0) + 1 }))}>
              <PlusOutlined /></button>
          </div>
        )
      ),
      footer: (rows) => fmtQty(rows.reduce((n, l) => n + Number(l.quantity || 0), 0)) },
    { key: 'unit_price', title: 'سعر الوحدة', width: 100,
      cell: (line) => {
        const under = !viewOnly && !!belowCost?.(line);
        return (
          <>
            {viewOnly ? (
              <span>{money(line.unit_price)}</span>
            ) : (
              <InputNumber size="small" min={0} step={0.01} style={{ width: '100%' }}
                status={under ? (canSellBelowCost ? 'warning' : 'error') : undefined}
                placeholder="السعر" value={line.unit_price}
                onChange={(v) => handleLineChange(line.key, 'unit_price', v || 0)}
                onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
            )}
            {under ? (
              <Tag color={canSellBelowCost ? 'gold' : 'red'}
                style={{ marginTop: 2, marginInlineEnd: 0, fontSize: 14, whiteSpace: 'normal', lineHeight: 1.3 }}>
                أقل من سعر الشراء
              </Tag>
            ) : null}
          </>
        );
      },
      footer: () => null },
    { key: 'gross', title: 'الإجمالي قبل', width: 95,
      cellStyle: { whiteSpace: 'nowrap', color: '#475569' },
      cell: (line) => money(Number(line.quantity || 0) * (line.unit_price || 0)),
      footer: (rows) => money(rows.reduce(
        (n, l) => n + Number(l.quantity || 0) * (l.unit_price || 0), 0)) },
    { key: 'variable_discount', title: 'خصم متغير %', width: 70,
      cellStyle: { textAlign: 'center' },
      cell: (line) => (
        isBonus ? <span style={{ color: '#555b65' }}>-</span> : viewOnly ? (
          <span className={line.variable_discount ? 'pct-pill' : 'pct-pill pct-pill-zero'}>
            {line.variable_discount ? `${line.variable_discount}%` : '0%'}
          </span>
        ) : (
          <InputNumber size="small" min={0} max={99.99} step={0.5} style={{ width: '100%', maxWidth: 64 }}
            className="pct-pill-input"
            placeholder="متغير" value={line.variable_discount ?? undefined}
            onChange={(v) => handleLineChange(line.key, 'variable_discount', (v as number) ?? null)}
            onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
        )
      ),
      footer: () => null },
    { key: 'fixed_discount', title: 'خصم ثابت %', width: 70,
      cellStyle: { textAlign: 'center' },
      cell: (line) => (
        viewOnly ? (
          <span>{line.fixed_discount ? `${line.fixed_discount}%` : '-'}</span>
        ) : (
          <InputNumber size="small" min={0} max={99.99} step={0.5} style={{ width: '100%', maxWidth: 64 }}
            placeholder="ثابت" value={line.fixed_discount ?? undefined}
            onChange={(v) => handleLineChange(line.key, 'fixed_discount', (v as number) ?? 0)}
            onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
        )
      ),
      footer: () => null },
    { key: 'after_fixed', title: 'بعد الثابت', label: 'الإجمالي بعد الخصم الثابت',
      tip: 'الإجمالي بعد الخصم الثابت', width: 100,
      cellStyle: { whiteSpace: 'nowrap', color: '#475569' },
      cell: (line) => money(afterFixedOf(line)),
      footer: (rows) => money(rows.reduce((n, l) => n + afterFixedOf(l), 0)) },
    { key: 'total', title: 'الإجمالي النهائي', width: 105, locked: true,
      cellStyle: { fontWeight: 700, whiteSpace: 'nowrap', color: '#15803d' },
      cell: (line) => (
        <>{money(saleLineNet(line))}</>
      ),
      footer: (rows) => (
        <span style={{ color: '#15803d' }}>{money(rows.reduce((n, l) => n + saleLineNet(l), 0))}</span>
      ) },
    ...(hidePoints ? [] : [{ key: 'points', title: 'النقاط', width: 64,
      cellStyle: { whiteSpace: 'nowrap', color: '#2563eb', textAlign: 'center' },
      cell: (line) => {
        const v = linePoints(line);
        if (v) return fmtQty(v);
        const per = line.item_id ? (pointValues[line.item_id] || 0) : 0;
        if (per > 0) {
          return (
            <span style={{ color: '#b0b0b0' }} title={`${per} نقطة للوحدة`}>
              × {fmtQty(per)}
            </span>
          );
        }
        return '-';
      },
      footer: () => (
        <span style={{ color: '#2563eb' }}>{fmtQty(totalPoints)}</span>
      ) }] as EntryColumn<SaleLineItem>[]),
    { key: 'actions', title: 'إجراء', label: 'حذف السطر', width: 50, minWidth: 40, locked: true,
      cellStyle: { textAlign: 'center' },
      cell: (line) => (
        viewOnly ? null : (
          <Button size="small" danger type="text" icon={<DeleteOutlined />} title="حذف السطر"
            onClick={() => handleRemoveLine(line.key)} />
        )
      ),
      footer: () => null },
  ];
}
