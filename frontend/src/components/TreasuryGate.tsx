import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { Select, message } from 'antd';
import { TabModal } from './TabModal';
import { api } from '../api/client';
import { money } from '../utils/money';

export type CashDirection = 'in' | 'out';

export interface TreasuryChoice {
  value: number;
  label: string;
  family: string | null;
}

const bare = (s: string) => (s || '')
  .replace(/[أإآ]/g, 'ا')
  .replace(/ة/g, 'ه')
  .replace(/ى/g, 'ي');

export function familyOfSafe(name: string): string | null {
  const k = bare(name);
  if (k.includes('ابيض')) return 'أبيض';
  if (k.includes('بولي') || k.includes('تكنو')) return 'بولي';
  return null;
}

export function useTreasurySafes(enabled = true): [TreasuryChoice[], boolean] {
  const [rows, setRows] = useState<TreasuryChoice[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) { setRows([]); setFailed(false); return; }
    setFailed(false);
    let alive = true;
    api.get('/api/v1/cash-accounts')
      .then((res) => {
        if (!alive) return;
        setRows((res.data || []).map((t: any) => ({
          value: t.account_id,
          label: t.rep_name ? `${t.name || `#${t.account_id}`} — ${t.rep_name}`
                            : (t.name || `خزينة #${t.account_id}`),
          family: t.family ?? familyOfSafe(t.name || ''),
        })));
      })
      .catch((e) => {
        if (!alive) return;
        setRows([]);
        setFailed(true);
        // eslint-disable-next-line no-console
        console.error('[TreasuryGate] قايمة الخزائن مانزلتش', e);
      });
    return () => { alive = false; };
  }, [enabled]);
  return [rows, failed];
}

export interface TreasuryGateProps {
  open: boolean;
  direction: CashDirection;
  amount: number;
  options: TreasuryChoice[];
  value: number | null;
  onChange: (v: number) => void;
  onOk: () => void;
  onCancel: () => void;
  docLabel?: string;
  okText?: string;
  cancelText?: string;
}

export default function TreasuryGate({
  open, direction, amount, options, value, onChange, onOk, onCancel,
  docLabel, okText = 'احفظ', cancelText = 'رجوع',
}: TreasuryGateProps) {
  const chosenRef = useRef<number | null>(value);
  chosenRef.current = value;

  const inbound = direction === 'in';
  const tone = inbound ? '#6AB42D' : '#cf1322';
  const wash = inbound ? '#f6faf3' : '#fff1f0';

  return (
    <TabModal
      open={open}
      title={inbound ? 'الفلوس هتنزل في أنهي خزنة؟' : 'الفلوس هتتصرف من أنهي خزنة؟'}
      okText={okText}
      cancelText={cancelText}
      okButtonProps={{ disabled: value === null || value === undefined }}
      onCancel={onCancel}
      onOk={onOk}
      destroyOnHidden
    >
      <div
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
          if (chosenRef.current === null || chosenRef.current === undefined) return;
          e.preventDefault();
          onOk();
        }}
      >
        <div style={{
          background: wash, border: `1px solid ${tone}33`, borderRadius: 6,
          padding: '10px 12px', marginBottom: 12, display: 'flex',
          justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontWeight: 600 }}>
            {docLabel ? `${docLabel} — ` : ''}
            {inbound ? 'إضافة للخزنة' : 'خصم من الخزنة'}
          </span>
          <span style={{ color: tone, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {Math.abs(amount) > 0.004
              ? `${inbound ? '+' : '−'} ${money(amount)}`
              : 'كله آجل — مافيش نقدي دلوقتي'}
          </span>
        </div>

        <Select
          autoFocus
          style={{ width: '100%' }}
          size="large"
          showSearch
          placeholder="اختر الخزنة"
          value={value ?? undefined}
          onChange={(v) => { chosenRef.current = v as number; onChange(v as number); }}
          options={options.map((o) => ({ value: o.value, label: o.label }))} filterOption={searchFilter} filterSort={searchRank}/>
        <div style={{ marginTop: 10, color: '#6b6b6b', fontSize: 15 }}>
          المقترح صندوق خط المستند — غيّره لو الفلوس اتحطّت في خزنة تانية.
        </div>
      </div>
    </TabModal>
  );
}

export interface TreasuryAsk {
  amount: number;
  direction: CashDirection;
  family?: string | null;
  docLabel?: string;
  preselect?: number | null;
}

export function useTreasuryGate(enabled = true) {
  const [options, failed] = useTreasurySafes(enabled);
  const [req, setReq] = useState<(TreasuryAsk & { run: (id: number | null) => void }) | null>(null);
  const [value, setValue] = useState<number | null>(null);

  const suggested = useMemo(() => {
    if (!req) return null;
    if (req.preselect != null && options.some((o) => o.value === req.preselect)) {
      return req.preselect;
    }
    if (req.family) {
      const hit = options.find((o) => o.family === req.family);
      return hit ? hit.value : null;
    }
    return options.length === 1 ? options[0].value : null;
  }, [req, options]);

  useEffect(() => {
    if (!req || suggested === null) return;
    setValue((prev) => prev ?? suggested);
  }, [req, suggested]);

  const ask = useCallback((o: TreasuryAsk, run: (id: number | null) => void) => {
    if (!enabled) {
      run(null);
      return;
    }
    if (Math.abs(Number(o.amount) || 0) <= 0.004) {
      run(null);
      return;
    }
    if (failed) {
      message.error('قايمة الخزائن مانزلتش — الخزنة هتتحدد من السيرفر. جرّب تحدّث الصفحة.');
      run(null);
      return;
    }
    if (options.length === 0) {
      run(null);
      return;
    }
    setValue(null);
    setReq({ ...o, run });
  }, [enabled, options, failed]);

  const close = useCallback(() => { setReq(null); setValue(null); }, []);

  const gateProps: TreasuryGateProps = {
    open: req !== null,
    direction: req?.direction ?? 'in',
    amount: req?.amount ?? 0,
    docLabel: req?.docLabel,
    options,
    value,
    onChange: setValue,
    onCancel: close,
    onOk: () => {
      const pending = req;
      const chosen = value;
      close();
      if (pending && chosen !== null) pending.run(chosen);
    },
  };

  return { ask, gateProps };
}
