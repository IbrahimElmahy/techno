import React, { useEffect, useState } from 'react';
import {
  BookOutlined, FileAddOutlined, BankOutlined, ProfileOutlined,
  SafetyCertificateOutlined, AuditOutlined,
} from '@ant-design/icons';
import { useQueryTab } from '../components/useQueryTab';
import ListPage from '../components/ListPage';
import ChartTab from './ledger/ChartTab';
import JournalTab from './ledger/JournalTab';
import TrialBalanceTab from './ledger/TrialBalanceTab';
import JournalsTab from './ledger/JournalsTab';
import IntegrityTab from './ledger/IntegrityTab';
import './GeneralLedger.css';

const TABS = [
  { key: 'chart', icon: <BookOutlined />, label: 'دليل الحسابات', render: () => <ChartTab /> },
  { key: 'journal', icon: <FileAddOutlined />, label: 'القيود اليومية', render: () => <JournalTab /> },
  { key: 'trial', icon: <BankOutlined />, label: 'ميزان المراجعة', render: () => <TrialBalanceTab /> },
  { key: 'journals', icon: <ProfileOutlined />, label: 'الدفاتر', render: () => <JournalsTab /> },
  { key: 'integrity', icon: <SafetyCertificateOutlined />, label: 'سلامة الدفاتر', render: () => <IntegrityTab /> },
];

export default function GeneralLedger() {
  const [activeTab, selectTab] = useQueryTab('chart');

  const [visited, setVisited] = useState<string[]>([activeTab]);
  useEffect(() => {
    setVisited((v) => (v.includes(activeTab) ? v : [...v, activeTab]));
  }, [activeTab]);

  return (
    <ListPage
      icon={<AuditOutlined />}
      title="الأستاذ العام"
      subtitle="دليل الحسابات والقيود وميزان المراجعة والدفاتر — كله في مكان واحد"
      tabs={TABS.map((t) => ({ key: t.key, label: <>{t.icon} {t.label}</> }))}
      activeTab={activeTab}
      onTabChange={selectTab}
    >
      {TABS.filter((t) => t.key === activeTab || visited.includes(t.key)).map((t) => (
        <div key={t.key} className="gl-tab" style={{ display: t.key === activeTab ? undefined : 'none' }}>
          {t.render()}
        </div>
      ))}
    </ListPage>
  );
}
