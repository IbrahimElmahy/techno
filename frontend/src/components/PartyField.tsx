import React, { useState } from 'react';
import { Select } from 'antd';
import PartyPickerModal, { PartyKind } from './PartyPickerModal';

/**
 * خانة «مين» — a form field that answers the party question through the party WINDOW.
 *
 * The documents ask who they are for in a window: a searchable list with the balance, the phone
 * and a way to create somebody who is not there yet. The vouchers asked the same question with a
 * bare dropdown — same question, two different answers depending on which screen you were on, and
 * only one of them could reach a customer who had never been entered.
 *
 * It takes the `value` / `onChange` pair antd's `Form.Item` supplies, so it drops into an existing
 * form without the form knowing anything changed. The visible control stays a `Select` — it shows
 * the chosen name and stays consistent with the fields beside it — but its own dropdown is held
 * shut (`open={false}`) so there is exactly one way in.
 */
export default function PartyField({
  kind, value, onChange, options, placeholder, style, disabled,
}: {
  kind: PartyKind;
  value?: number;
  onChange?: (id: number) => void;
  /** Names for the ids, so the chosen party reads as a name rather than a number. */
  options: { value: number; label: string }[];
  placeholder?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Select
        showSearch optionFilterProp="label"
        style={style ?? { width: 240 }}
        placeholder={placeholder ?? (kind === 'customer' ? 'اختر العميل' : 'اختر المورد')}
        value={value}
        disabled={disabled}
        // Held shut on purpose: the window is the way in, and a dropdown that also opened would be
        // a second answer to the same question that cannot create a party.
        open={false}
        onClick={() => { if (!disabled) setOpen(true); }}
        options={options}
      />
      <PartyPickerModal
        open={open}
        kind={kind}
        onPick={(party) => { setOpen(false); onChange?.(party.id); }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
