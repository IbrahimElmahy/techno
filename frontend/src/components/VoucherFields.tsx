import React, { useMemo, useState } from 'react';
import {
  Button, Form, Input, Select, Tag, message,
} from 'antd';
import { InputNumber } from './NumberInput';
import { PlusOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { TabModal } from './TabModal';

/**
 * الخزنة وحساب المصروف — الحقلين اللي بيتحدد بيهم الفلوس بتتحرك منين وعلى إيه.
 *
 * Both were dropdowns showing a bare name, on a screen whose entire job is deciding where money
 * goes. Everything needed to choose properly was already coming back from the API and being thrown
 * away: the account's code and how much has been spent on it, and the treasury's kind and how much
 * cash is actually in it.
 *
 * The treasury one was worse than thin. It offered a placeholder «الافتراضية» and no selection, so
 * the person recording an expense could not see which safe it would come out of — the server picked
 * one and told nobody. «اتحكم بالخزنة اللي مربوط بيها أي حاجة» is exactly that complaint: not a
 * missing field, a hidden decision.
 */

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export interface Treasury {
  id: number; name: string; kind?: string; balance?: string | number;
  is_default?: boolean; active?: boolean; bank_name?: string | null;
  /** حساب الخزنة في الشجرة — بيه بنعرف إن الحساب ده خزنة، ومين. */
  account_id?: number;
}

export interface ExpenseAccount {
  id: number; code?: string | null; name?: string | null; balance?: string | number;
}

/**
 * الخزنة — باسمها ورصيدها ونوعها، ومختارة من الأول.
 *
 * The default is PRE-SELECTED rather than implied. A blank box labelled «الافتراضية» means the
 * money leaves a safe the person never named, and they find out which one from the ledger
 * afterwards — if they think to look.
 *
 * The balance is shown beside each because the question behind picking a safe is «فيها كام». An
 * amount larger than what is in it is flagged as it is typed rather than refused at save.
 */
export function TreasuryField({
  treasuries, amount, width = 260,
}: { treasuries: Treasury[]; amount?: number | null; width?: number }) {
  const live = treasuries.filter((t) => t.active !== false);

  const options = live.map((t) => {
    const bal = Number(t.balance || 0);
    return {
      value: t.id,
      // `label` is what the closed box shows and what the search matches, so it stays plain text.
      label: `${t.name}${t.is_default ? ' (الافتراضية)' : ''}`,
      title: `${t.name} — ${money(bal)} ج.م`,
      short: t.name,
      balance: bal,
      kind: t.kind,
      isDefault: !!t.is_default,
    };
  });

  return (
    <Form.Item
      name="treasury_id"
      label="الخزينة"
      // Required, deliberately. The old form allowed «no answer» and resolved it server-side, which
      // is the same as answering for them.
      rules={[{ required: true, message: 'اختر الخزينة التي ستتحرك منها الأموال' }]}
    >
      <Select
        showSearch optionFilterProp="label" style={{ width }}
        placeholder="اختر الخزينة"
        options={options.map((o) => ({
          value: o.value,
          label: o.label,
          title: o.title,
          children: undefined,
        }))}
        optionRender={(opt) => {
          const o = options.find((x) => x.value === opt.value)!;
          const short = Number(o.balance) < Number(amount || 0);
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span>
                {o.short}
                {o.kind === 'bank' && <Tag style={{ marginInlineStart: 6 }}>بنك</Tag>}
                {o.isDefault && <Tag color="green" style={{ marginInlineStart: 6 }}>الافتراضية</Tag>}
              </span>
              {/* «فيها كام» — the question behind choosing a safe, answered before the choice. */}
              <span style={{ color: short ? '#cf1322' : '#6AB42D', fontSize: 12 }}>
                {money(o.balance)} ج.م
              </span>
            </div>
          );
        }}
      />
    </Form.Item>
  );
}

/** The id of the treasury a form should open on — the default, or the only one there is. */
export function defaultTreasuryId(treasuries: Treasury[]): number | undefined {
  const live = treasuries.filter((t) => t.active !== false);
  return (live.find((t) => t.is_default) ?? live[0])?.id;
}

/**
 * حساب المصروف — بالكود والاسم واللي اتصرف عليه، ومنه تضيف حساب جديد.
 *
 * It listed `name || code`: never both, so two accounts called «مصروفات إدارية» under different
 * codes were the same line twice. And it showed nothing about the account, though the API returns
 * the balance — «إحنا صرفنا على البنزين كام الشهر ده» is the question somebody has in mind at the
 * exact moment they are choosing it.
 *
 * Adding one is here too. Needing a new expense account mid-voucher meant abandoning the form,
 * going to the chart of accounts, and starting again — which is how people end up posting rent to
 * «مصروفات أخرى».
 */
export function ExpenseAccountField({
  accounts, onCreated, width = 300, groups = [],
}: {
  accounts: ExpenseAccount[]; onCreated: () => void; width?: number;
  /** المجموعات الرئيسية للمصروفات — الحساب الجديد لازم يقع تحت واحدة منها. */
  groups?: ExpenseAccount[];
}) {
  const [adding, setAdding] = useState(false);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const options = useMemo(() => accounts.map((a) => ({
    value: a.id,
    // Code AND name. Either alone is ambiguous on a real chart of accounts.
    label: `${a.code ? `${a.code} — ` : ''}${a.name ?? ''}`.trim(),
    spent: Number(a.balance || 0),
  })), [accounts]);

  const create = async (v: any) => {
    setSaving(true);
    try {
      await api.post('/api/v1/accounts', {
        code: v.code, name: v.name, nature: 'expense', is_postable: true,
        // Under a heading, not loose. An account with no parent is postable but belongs to no
        // group, so it vanishes from دليل الحسابات and from every report that walks the tree.
        parent_id: v.parent_id ?? null,
      });
      message.success('اتضاف حساب المصروف');
      setAdding(false);
      form.resetFields();
      onCreated();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر إضافة الحساب');
    } finally { setSaving(false); }
  };

  return (
    <>
      <Form.Item
        name="expense_account_id"
        label="حساب المصروف"
        rules={[{ required: true, message: 'اختر حساب المصروف' }]}
      >
        <Select
          showSearch optionFilterProp="label" style={{ width }}
          placeholder="إيجار / مرتبات / بنزين…"
          options={options}
          optionRender={(opt) => {
            const o = options.find((x) => x.value === opt.value)!;
            return (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span>{o.label}</span>
                <span style={{ color: '#6b6b6b', fontSize: 12 }}>{money(o.spent)} ج.م</span>
              </div>
            );
          }}
          dropdownRender={(menu) => (
            <>
              {menu}
              <div style={{ borderTop: '1px solid #f0f0f0', padding: 6 }}>
                <Button type="link" icon={<PlusOutlined />} size="small"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setAdding(true)}>
                  حساب مصروف جديد
                </Button>
              </div>
            </>
          )}
        />
      </Form.Item>

      <TabModal
        open={adding} onCancel={() => setAdding(false)} onOk={() => form.submit()}
        title="حساب مصروف جديد" okText="إضافة" cancelText="إلغاء"
        confirmLoading={saving} destroyOnHidden width={420}
      >
        <Form form={form} layout="vertical" onFinish={create} requiredMark={false}>
          <Form.Item name="parent_id" label="تحت أي حساب رئيسي"
            rules={[{ required: true, message: 'اختر الحساب الرئيسي' }]}>
            <Select showSearch optionFilterProp="label" placeholder="مصروفات ..."
              options={groups.map((g) => ({
                value: g.id, label: `${g.code ? `${g.code} — ` : ''}${g.name ?? ''}`.trim(),
              }))} />
          </Form.Item>
          <Form.Item name="code" label="الكود"
            rules={[{ required: true, message: 'اكتب كود الحساب' }]}>
            <Input placeholder="مثال: 5.010" />
          </Form.Item>
          <Form.Item name="name" label="الاسم"
            rules={[{ required: true, message: 'اكتب اسم الحساب' }]}>
            <Input placeholder="مثال: بنزين وانتقالات" />
          </Form.Item>
          <div style={{ color: '#6b6b6b', fontSize: 12 }}>
            بيتعمل كحساب مصروف يقبل الترحيل، فيبان في القايمة على طول.
            وتقدر تعدّله أو تخفيه بعد كده من «اداره الانشاءات ← الحسابات الفرعيه».
          </div>
        </Form>
      </TabModal>
    </>
  );
}

export { money as voucherMoney };
