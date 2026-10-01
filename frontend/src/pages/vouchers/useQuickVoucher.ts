import { useState } from 'react';
import { Form, message } from 'antd';
import { api } from '../../api/client';
import { defaultTreasuryId } from '../../components/VoucherFields';
import { useLookup } from '../../hooks/useLookup';

/**
 * **سند من جوّه سجل** — «سند قبض جديد» في سجل المبيعات و«سند صرف جديد» في سجل المشتريات
 * (طلب العميل ٢٠٢٦-١٠-٠١). نفس فتح وحفظ شاشة السندات: فورم فاضي على الخزنة الافتراضية،
 * والحفظ بنفس الـpayload. الشاشة بتدّي الـ`*Modal` بتاع السند اللي عايزاه القيم دي بس.
 */
export function useQuickVoucher(onSaved: () => void) {
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [treasuries, setTreasuries] = useState<any[]>([]);
  const { options: methodOptions } = useLookup('payment_method');

  /** الخزاين بتتجاب أول مرة الفورم يتفتح بس — مش مع كل فتحة للسجل. */
  const show = async () => {
    let list = treasuries;
    if (!list.length) {
      list = (await api.get<any[]>('/api/v1/treasuries').catch(() => ({ data: [] as any[] }))).data || [];
      setTreasuries(list);
    }
    form.resetFields();
    const id = defaultTreasuryId(list);
    if (id) form.setFieldsValue({ treasury_id: id });
    setOpen(true);
  };

  /** نفس توقيع `submit` اللي الـ`*Modal` بتاع السندات بيستناه. */
  const submit = async (path: string, values: any, f: any, okMsg: string) => {
    setPosting(true);
    try {
      const payload: any = { ...values, amount: String(values.amount) };
      if (values.voucher_date) payload.voucher_date = values.voucher_date.format('YYYY-MM-DD');
      await api.post(path, payload);
      message.success(okMsg);
      f.resetFields();
      setOpen(false);
      onSaved();
    } catch {
      // رسالة الخطأ بيطلّعها `api` نفسه.
    } finally {
      setPosting(false);
    }
  };

  return {
    form, open, show, close: () => setOpen(false), posting, submit, treasuries, methodOptions,
  };
}
