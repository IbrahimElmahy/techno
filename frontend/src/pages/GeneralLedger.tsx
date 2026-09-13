/**
 * الأستاذ العام — القشرة بس: تبويبات وبتفتح أنهي شاشة.
 *
 * الملف ده كان ١٤٠٠ سطر وخمس تبويبات في بعض: دليل الحسابات والقيود وميزان
 * المراجعة والدفاتر وسلامتها. كل تبويب بقى ملف لوحده تحت `ledger/`،
 * **والمسار والتبويبات زي ما هما بالظبط** — `?tab=journal` لسه بيفتح نفس الشاشة،
 * والقايمة والروابط القديمة ماتلمستش.
 */
import React from 'react';
import { Tabs } from 'antd';
import {
  BookOutlined, FileAddOutlined, BankOutlined, ProfileOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useQueryTab } from '../components/useQueryTab';
import ChartTab from './ledger/ChartTab';
import JournalTab from './ledger/JournalTab';
import TrialBalanceTab from './ledger/TrialBalanceTab';
import JournalsTab from './ledger/JournalsTab';
import IntegrityTab from './ledger/IntegrityTab';

export default function GeneralLedger() {
  const [activeTab, selectTab] = useQueryTab('chart');
  return (
    <Tabs
      activeKey={activeTab} onChange={selectTab}
      items={[
        { key: 'chart', label: <span><BookOutlined /> دليل الحسابات</span>, children: <ChartTab /> },
        { key: 'journal', label: <span><FileAddOutlined /> القيود اليومية</span>, children: <JournalTab /> },
        { key: 'trial', label: <span><BankOutlined /> ميزان المراجعة</span>, children: <TrialBalanceTab /> },
        { key: 'journals', label: <span><ProfileOutlined /> الدفاتر</span>, children: <JournalsTab /> },
        { key: 'integrity', label: <span><SafetyCertificateOutlined /> سلامة الدفاتر</span>, children: <IntegrityTab /> },
      ]}
    />
  );
}
