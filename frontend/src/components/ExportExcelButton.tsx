import React from 'react';
import { Button, message } from 'antd';
import { FileExcelOutlined } from '@ant-design/icons';
import { columnsFromTable, exportExcel, type ExcelColumn } from '../utils/exportExcel';

export interface ExcelExport {
  name: string;
  rows: any[];
  sheet?: string;
  columns?: ExcelColumn<any>[];
}

interface Props extends ExcelExport {
  tableColumns: { title?: unknown; dataIndex?: any; render?: any }[];
  disabled?: boolean;
  style?: React.CSSProperties;
}

export default function ExportExcelButton({
  name, rows, sheet, columns, tableColumns, disabled, style,
}: Props) {
  const run = () => {
    const cols = columns ?? columnsFromTable(tableColumns);
    if (!cols.length) { message.info('لا توجد أعمدة للتصدير'); return; }
    if (!rows?.length) { message.info('لا توجد بيانات للتصدير'); return; }
    exportExcel(name, cols, rows, sheet);
  };

  return (
    <Button
      icon={<FileExcelOutlined />}
      onClick={run}
      disabled={disabled}
      style={{ marginInlineStart: 8, flexShrink: 0, ...style }}
    >
      تصدير Excel
    </Button>
  );
}
