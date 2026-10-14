import React from 'react';
import { FileAddOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import ListPage from '../components/ListPage';
import TrialBalanceTab from './ledger/TrialBalanceTab';
import JournalTab from './ledger/JournalTab';
import './GeneralLedger.css';

export default function GeneralLedger() {
  const [params] = useSearchParams();
  const journal = params.get('tab') === 'journal' || !!params.get('doc') || !!params.get('entry');
  if (!journal) return <TrialBalanceTab />;
  return (
    <ListPage icon={<FileAddOutlined />} title="القيود اليدوية">
      <div className="gl-tab"><JournalTab /></div>
    </ListPage>
  );
}
