import React from 'react';
import { Button, message } from 'antd';
import { FileExcelOutlined } from '@ant-design/icons';
import { columnsFromTable, exportExcel, type ExcelColumn } from '../utils/exportExcel';

/**
 * زرار «تصدير Excel» — واحد لكل الجداول.
 *
 * The button is deliberately dumb: it is handed the columns the table is *currently* rendering
 * and the rows it is *currently* showing, and writes exactly those. That is the whole point —
 * somebody who filtered to «فواتير أكتوبر المؤجلة» and hid six columns wants the file to be that
 * view, not the register. Anything that reached back for the unfiltered payload would quietly
 * hand them a different report than the one on their screen.
 *
 * بيتركّب لوحده جوّه `useTableColumns`، فالشاشة اللي بتستعمل الهوك بتاخده من غير ما ترسمه —
 * وده اللي خلّى ستين شاشة تاخد التصدير من غير ستين تعديل في الرسم.
 */
export interface ExcelExport {
  /** اسم الملف من غير تاريخ ولا امتداد — «فواتير البيع»، والتاريخ بيتحط لوحده. */
  name: string;
  /** الصفوف زي ما هي معروضة: بعد البحث والفلاتر، مش اللي راجع من الـAPI. */
  rows: any[];
  /** اسم الورقة جوّه الملف. الافتراضي اسم الملف نفسه. */
  sheet?: string;
  /** أعمدة بديلة لما اللي في الجدول مش هي اللي تتصدّر (زراير، خلايا مركّبة). */
  columns?: ExcelColumn<any>[];
}

interface Props extends ExcelExport {
  /** أعمدة الجدول بعد الإخفاء والترتيب — مصدر الأعمدة الافتراضي. */
  tableColumns: { title?: unknown; dataIndex?: any; render?: any }[];
  disabled?: boolean;
  /**
   * المسافة الافتراضية بتناسب الشرايط اللي زراريها بتباعد نفسها بـ`marginInlineStart`، وهي
   * الأغلبية. الشاشة اللي حاطّاه جوّه `<Space>` بتبعت `marginInlineStart: 0` — الـ`Space`
   * بيباعد لوحده، والاتنين مع بعض بيبقوا ضِعف المسافة اللي جنبها.
   */
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
    // مايضيقش. بيقعد جنب زرار «الأعمدة» في ترويسة الكارت، واللي بيتضغط منهم بيضيّع كلمته
    // الأول وبعدين نفسه — نفس اللي حصل مع زرار الأعمدة قبل كده.
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
