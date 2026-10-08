import React, { useState } from 'react';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { Select } from 'antd';
import PartyPickerModal, { Party, PartyKind } from './PartyPickerModal';

export default function PartyField({
  kind, value, onChange, onPicked, options, placeholder, style, disabled,
}: {
  kind: PartyKind;
  value?: number;
  onChange?: (id: number) => void;
  onPicked?: (party: Party) => void;
  options: { value: number; label: string }[];
  placeholder?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Select
        showSearch
        style={style ?? { width: 240 }}
        placeholder={placeholder ?? (kind === 'customer' ? 'اختر العميل' : 'اختر المورد')}
        value={value}
        disabled={disabled}
        open={false}
        onClick={() => { if (!disabled) setOpen(true); }}
        options={options} filterOption={searchFilter} filterSort={searchRank}/>
      <PartyPickerModal
        open={open}
        kind={kind}
        onPick={(party) => { setOpen(false); onChange?.(party.id); onPicked?.(party); }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
