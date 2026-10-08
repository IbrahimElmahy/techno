import { useState } from 'react';
import { Form, message } from 'antd';
import dayjs from 'dayjs';
import { api } from '../../api/client';
import { defaultTreasuryId } from '../../components/VoucherFields';
import { useLookup } from '../../hooks/useLookup';

export interface EditableVoucher {
  id: number;
  document_number: string;
  amount: string | number;
  customer_id: number | null;
  supplier_id: number | null;
  rep_user_id: number | null;
  treasury_id?: number | null;
  voucher_date: string;
  payment_method: string | null;
  reference: string | null;
  description: string | null;
  statement1?: string | null;
  external_document_number?: string | null;
  cost_center_id?: number | null;
  family?: string | null;
}

export async function fetchVoucher(id: number): Promise<EditableVoucher> {
  return (await api.get<EditableVoucher>(`/api/v1/vouchers/${id}`)).data;
}

export async function deleteVoucher(id: number): Promise<void> {
  await api.delete(`/api/v1/vouchers/${id}`);
}

export function useQuickVoucher(onSaved: () => void) {
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [treasuries, setTreasuries] = useState<any[]>([]);
  const [editing, setEditing] = useState<EditableVoucher | null>(null);
  const { options: methodOptions } = useLookup('payment_method');

  const loadTreasuries = async () => {
    let list = treasuries;
    if (!list.length) {
      list = (await api.get<any[]>('/api/v1/treasuries').catch(() => ({ data: [] as any[] }))).data || [];
      setTreasuries(list);
    }
    return list;
  };

  const show = async () => {
    const list = await loadTreasuries();
    setEditing(null);
    form.resetFields();
    const id = defaultTreasuryId(list);
    if (id) form.setFieldsValue({ treasury_id: id });
    setOpen(true);
  };

  const edit = async (v: EditableVoucher) => {
    await loadTreasuries();
    setEditing(v);
    form.resetFields();
    const values = {
      customer_id: v.customer_id ?? undefined,
      supplier_id: v.supplier_id ?? undefined,
      amount: Number(v.amount),
      treasury_id: v.treasury_id ?? undefined,
      voucher_date: v.voucher_date ? dayjs(v.voucher_date) : dayjs(),
      payment_method: v.payment_method ?? undefined,
      reference: v.reference ?? undefined,
      cost_center_id: v.cost_center_id ?? undefined,
      description: v.description ?? undefined,
      statement1: v.statement1 ?? undefined,
      external_document_number: v.external_document_number ?? undefined,
      rep_user_id: v.rep_user_id ?? undefined,
    };
    form.setFieldsValue(values);
    setOpen(true);
    setTimeout(() => form.setFieldsValue(values), 0);
  };

  const submit = async (
    path: string, values: any, f: any, okMsg: string, opts?: { keepOpen?: boolean },
  ): Promise<any | null> => {
    setPosting(true);
    try {
      const payload: any = { ...values, amount: String(values.amount) };
      if (values.voucher_date) payload.voucher_date = values.voucher_date.format('YYYY-MM-DD');
      let data: any;
      if (editing) {
        data = (await api.put(`${path}/${editing.id}`, payload)).data;
        message.success(`تم تعديل السند ${editing.document_number} ✔`);
      } else {
        data = (await api.post(path, payload)).data;
        message.success(okMsg);
      }
      f.resetFields();
      if (!opts?.keepOpen) setOpen(false);
      setEditing(null);
      onSaved();
      return data ?? {};
    } catch {
      return null;
    } finally {
      setPosting(false);
    }
  };

  const close = () => { setOpen(false); setEditing(null); };

  return {
    form, open, show, edit, close, posting, submit, treasuries, methodOptions,
    editing: editing !== null,
    custodyEdit: editing !== null && !editing.treasury_id,
  };
}
