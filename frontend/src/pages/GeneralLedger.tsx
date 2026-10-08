import React from 'react';
import { AuditOutlined } from '@ant-design/icons';
import ListPage from '../components/ListPage';
import TrialBalanceTab from './ledger/TrialBalanceTab';
import './GeneralLedger.css';

export default function GeneralLedger() {
  return (
    <ListPage icon={<AuditOutlined />} title="ميزان المراجعة">
      <div className="gl-tab"><TrialBalanceTab /></div>
    </ListPage>
  );
}
