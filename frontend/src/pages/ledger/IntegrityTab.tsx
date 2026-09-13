/**
 * جزء من شاشة الأستاذ العام — اتفصل عن `GeneralLedger.tsx` لما الملف وصل ١٤٠٠ سطر
 * وخمس تبويبات. الشاشة والمسار زي ما هما بالظبط؛ اللي اتغيّر هو إن كل تبويب بقى
 * ملف لوحده، فالتعديل في «الدفاتر» مابيفتحش «ميزان المراجعة» قدامك.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Col, DatePicker, Divider, Empty, Form, Input, Row, Select, Space, Statistic, Switch, Table, Tabs, Tag, Tooltip, message, Radio,
} from 'antd';
import { InputNumber } from '../../components/NumberInput';
import {
  PlusOutlined, RollbackOutlined, BookOutlined, FileAddOutlined, BankOutlined,
  ReloadOutlined, SearchOutlined, DownloadOutlined, PrinterOutlined,
  ProfileOutlined, CheckCircleOutlined, EditOutlined, StopOutlined, LinkOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import CostCenterSplit from '../../components/CostCenterSplit';
import { api } from '../../api/client';
import { useQueryTab } from '../../components/useQueryTab';
import {
  APPEARS_IN_LABEL, CostCenter, MAIN_LEVELS, NATURE_COLOR, NATURE_LABEL, egp,
} from '../../utils/accounts';
import { showReversalConfirm } from '../../components/ConfirmationDialog';
import ListToolbar, { useListFilter, normalizeAr } from '../../components/ListToolbar';
import { useTableKeyboard } from '../../components/keyboard';
import { textColumn, numberColumn, choiceColumn, dateColumn } from '../../components/gridColumns';
import { entryTypeLabel } from '../../components/labels';
import PartyField from '../../components/PartyField';
import { TabModal } from '../../components/TabModal';
import { useTableColumns } from '../../components/ColumnSettings';
import { exportCsv } from '../../utils/exportCsv';
import DateRangeFilter from '../../components/DateRangeFilter';
import { printReport } from '../../print/reportSheet';

interface JournalIntegrity {
  journal_id: number;
  journal_code: string;
  journal_name: string;
  restricted: boolean;
  entries: number;
  first_number: string | null;
  last_number: string | null;
  first_date: string | null;
  last_date: string | null;
  intact: boolean;
  broken_entry_id: number | null;
  broken_number: string | null;
  problems: string[];
}

/**
 * تبويب سلامة الدفاتر — بيعيد حساب سلسلة التجزئة من أولها وبيقارن.
 *
 * التقرير ده مالوش لازمة غير على الدفتر اللي السلسلة شغّالة عليه؛ الباقي بيتعرض
 * عشان اللي بيقرا يشوف إيه اللي متغطّى وإيه اللي لأ — «مافيش تقرير» مش نفس
 * «كله سليم».
 */
export default function IntegrityTab() {
  const [rows, setRows] = useState<JournalIntegrity[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/v1/accounting/integrity');
      setRows(data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const covered = rows.filter((r) => r.restricted);
  const broken = covered.filter((r) => !r.intact);

  return (
    <Card
      title="سلامة الدفاتر"
      extra={<Button icon={<ReloadOutlined />} onClick={load} loading={loading}>فحص</Button>}
    >
      <div style={{ marginBottom: 12, color: '#888', fontSize: 13 }}>
        كل قيد في دفتر عليه سلسلة بياخد بصمة محسوبة من محتواه ومن بصمة القيد اللي قبله.
        الفحص ده بيعيد حسابها من أول السلسلة — فأي تغيير حصل من ورا النظام بيوقف عليه
        بالظبط، هو وكل اللي بعده.
      </div>
      {covered.length === 0 ? (
        <Empty description="مافيش دفتر شغّالة عليه سلسلة التجزئة — شغّلها من تبويب «الدفاتر»." />
      ) : broken.length === 0 ? (
        <Tag color="green" style={{ marginBottom: 12, fontSize: 14, padding: '4px 10px' }}>
          كل الدفاتر المغطّاة سليمة
        </Tag>
      ) : (
        <Tag color="red" style={{ marginBottom: 12, fontSize: 14, padding: '4px 10px' }}>
          فيه {broken.length} دفتر سلسلته مكسورة
        </Tag>
      )}
      <Table<JournalIntegrity>
        rowKey="journal_id" size="small" pagination={false} loading={loading}
        dataSource={rows}
        columns={[
          { title: 'الدفتر', key: 'j', render: (_: any, r) => (
            <Space size={4}><Tag color="purple">{r.journal_code}</Tag>{r.journal_name}</Space>
          ) },
          { title: 'السلسلة', dataIndex: 'restricted', width: 110,
            render: (on: boolean) => (
              <Tag color={on ? 'blue' : 'default'}>{on ? 'شغّالة' : 'مقفولة'}</Tag>
            ) },
          { title: 'قيود متجزّأة', dataIndex: 'entries', width: 110 },
          { title: 'من', key: 'from', width: 190,
            render: (_: any, r) => (r.first_number
              ? `${r.first_number} · ${r.first_date || ''}` : '') },
          { title: 'إلى', key: 'to', width: 190,
            render: (_: any, r) => (r.last_number
              ? `${r.last_number} · ${r.last_date || ''}` : '') },
          { title: 'النتيجة', key: 'res', width: 240,
            render: (_: any, r) => {
              if (!r.restricted || r.entries === 0) return <span style={{ color: '#888' }}>—</span>;
              if (r.intact) return <Tag color="green">سليمة</Tag>;
              return (
                <Space size={4}>
                  <Tag color="red">مكسورة</Tag>
                  <Button type="link" size="small"
                    onClick={() => navigate(`/general-ledger?doc=${r.broken_entry_id}`)}>
                    {r.broken_number || `#${r.broken_entry_id}`}
                  </Button>
                </Space>
              );
            } },
          { title: 'ملاحظات', dataIndex: 'problems',
            render: (p: string[]) => (p?.length
              ? <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                  {p.map((t, i) => <li key={i} style={{ color: '#d64545' }}>{t}</li>)}
                </ul>
              : '') },
        ]}
      />
    </Card>
  );
}
