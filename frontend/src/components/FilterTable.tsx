import React, { useMemo } from 'react';
import { Table as AntTable } from 'antd';
import type { TableProps } from 'antd';
import { autoColumnFilters } from './gridColumns';

/**
 * جدول antd **بفلتر على كل عمود** (طلب العميل ٢٠٢٦-٠٩-٣٠ — صفحات إدارة المخازن).
 *
 * نفس `Table` بالظبط، والفرق إن كل عمود مالوش فلتر بياخد واحد على حسب داتاه — شوف
 * `autoColumnFilters`. الشاشات بتستورده بدل antd ومش محتاجة تغيّر حاجة في أعمدتها.
 *
 * جدول بيتكتب فيه (سطور إذن بتتعدّل) بيبعت `autoFilters={false}`: فلتر على خانات لسه
 * بتتكتب بيخفي سطر من تحت إيد اللي بيكتبه.
 */
function FilterTableInner<T extends object>(
  { autoFilters = true, columns, dataSource, ...rest }: TableProps<T> & { autoFilters?: boolean },
) {
  const cols = useMemo(
    () => (autoFilters ? autoColumnFilters(columns as any[], dataSource as T[]) : columns),
    [autoFilters, columns, dataSource],
  );
  return <AntTable<T> columns={cols as any} dataSource={dataSource} {...rest} />;
}

type FilterTableType = typeof FilterTableInner & {
  Summary: typeof AntTable.Summary;
  Column: typeof AntTable.Column;
  ColumnGroup: typeof AntTable.ColumnGroup;
  SELECTION_ALL: typeof AntTable.SELECTION_ALL;
  EXPAND_COLUMN: typeof AntTable.EXPAND_COLUMN;
};

export const FilterTable = FilterTableInner as FilterTableType;
FilterTable.Summary = AntTable.Summary;
FilterTable.Column = AntTable.Column;
FilterTable.ColumnGroup = AntTable.ColumnGroup;
FilterTable.SELECTION_ALL = AntTable.SELECTION_ALL;
FilterTable.EXPAND_COLUMN = AntTable.EXPAND_COLUMN;

export default FilterTable;
