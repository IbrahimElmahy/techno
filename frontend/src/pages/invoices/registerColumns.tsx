/**
 * أعمدة سجل الفواتير — اتفصلت عن `Invoices.tsx`.
 *
 * ٢٩٠ سطر من تعريف أعمدة مافيش فيها حالة، كانت قاعدة في نص شاشة ٣١٢٠ سطر. بقت دالة
 * بتاخد اللي محتاجاه وبترجّع الأعمدة.
 */
import React from 'react';
import { Button, Modal, Space, Tag, Tooltip } from 'antd';
import { Popconfirm } from '../../components/noConfirm';
import {
  DeleteOutlined, EditOutlined, PrinterOutlined, EyeOutlined, ExclamationCircleOutlined,
} from '@ant-design/icons';
import { api } from '../../api/client';
import { printInvoice } from '../../components/InvoiceDocument';
import { money } from '../../utils/money';
import { InvoiceRecord, Customer, InvoiceFilters } from './types';

export interface RegisterColumnsCtx {
  customers: Customer[];
  /** مناديب السجل — الاسم بس، مش كارت المندوب الكامل. */
  reps: { id: number; full_name: string }[];
  postingAccounts: any[];
  filters: InvoiceFilters;
  printOpts: any;
  navigate: (to: string) => void;
  openDetail: (r: InvoiceRecord) => void;
  invoiceDoc: (inv: any) => any;
  canEditInvoice: boolean;
  canDeleteInvoice: boolean;
  handleEditInvoice: (r: InvoiceRecord) => void;
  handleDeleteInvoice: (r: InvoiceRecord) => void;
  handleDeleteReturn: (r: any) => void;
}

export function buildRegisterColumns({
  customers, reps, postingAccounts, filters, printOpts, navigate, openDetail,
  invoiceDoc, canEditInvoice, canDeleteInvoice, handleEditInvoice, handleDeleteInvoice,
  handleDeleteReturn,
}: RegisterColumnsCtx): any[] {
  return [
    {
      title: 'نوع المستند',
      dataIndex: 'doc_type',
      key: 'doc_type',
      width: 100,
      render: (t: string) => t === 'sale'
        ? <Tag color="green" style={{ fontWeight: 600 }}>فاتورة بيع</Tag>
        : <Tag color="magenta" style={{ fontWeight: 600 }}>مرتجع بيع</Tag>,
    },
    {
      title: 'رقم',
      dataIndex: 'id',
      key: 'id',
      width: 70,
      render: (id: number) => <span style={{ color: '#6b6b6b' }}>{id}</span>,
    },
    {
      title: 'التاريخ',
      dataIndex: 'date',
      key: 'date',
      width: 95,
      sorter: (a: any, b: any) => (a.date || '').localeCompare(b.date || ''),
      render: (d: string) => d || '-',
    },
    {
      title: 'مستند رقم',
      dataIndex: 'external_document_number',
      key: 'external_document_number', ellipsis: true,
      width: 120,
      sorter: (a: any, b: any) => (a.external_document_number || '').localeCompare(b.external_document_number || ''),
      render: (v: string | null) => v || '-',
    },
    {
      title: 'رقم المستند',
      dataIndex: 'document_number',
      key: 'document_number', ellipsis: true,
      width: 130,
      sorter: (a: any, b: any) => (a.document_number || '').localeCompare(b.document_number || ''),
      render: (doc: string, r: any) => (
        <Space direction="vertical" size={0}>
          {/* المسودّة مالهاش رقم — الرقم بيتحجز وقت الترحيل مش قبله. */}
          {r.__isDraft
            ? <Tag color="gold">مسودّة — لسه ما اترحّلتش</Tag>
            : <Tag color={r.doc_type === 'sale' ? 'blue' : 'volcano'}>{doc}</Tag>}
          {r.original_invoice_number && (
            <span style={{ fontSize: 11, color: '#8c8c8c' }}>عن: {r.original_invoice_number}</span>
          )}
        </Space>
      ),
    },
    {
      title: 'الحساب الفرعي',
      dataIndex: 'revenue_account_id',
      key: 'revenue_account_id',
      width: 140,
      ellipsis: true,
      render: (id: number | null) => {
        if (!id) return <span style={{ color: '#8c8c8c' }}>الافتراضي</span>;
        const a = postingAccounts.find((x: any) => x.id === id);
        return a ? (a.name || a.code || `#${id}`) : `#${id}`;
      },
    },
    {
      title: 'جهه التعامل',
      dataIndex: 'customer_id',
      key: 'customer_id',
      width: 190,
      ellipsis: true,
      sorter: (a: any, b: any) => {
        const cA = a.customer_name || customers.find((c) => c.id === a.customer_id)?.name || '';
        const cB = b.customer_name || customers.find((c) => c.id === b.customer_id)?.name || '';
        return cA.localeCompare(cB);
      },
      render: (cId: number, row: any) => {
        // الاسم جاي مع الصف؛ الكشف المحلي فاضل كخطة بديلة للصفوف القديمة.
        const name = row.customer_name || customers.find((cust) => cust.id === cId)?.name;
        // مسودّة لسه ما اتحطّ فيها عميل — «—» أصدق من «عميل #null» ورابط مايفتحش.
        if (cId == null) return <span style={{ color: '#8c8c8c' }}>—</span>;
        return (
          <a onClick={(e) => { e.stopPropagation(); navigate(`/customers/${cId}`); }}>
            {name || `عميل #${cId}`}
          </a>
        );
      },
    },
    {
      // عائلة الفاتورة — أبيض ولا بولي. عمود لوحده جنب «النوع» لأنهم بيجاوبوا سؤالين:
      // ده بيقول الفاتورة على أنهي خط، و«النوع» بيقول العميل ده إيه.
      title: 'نوع الفاتورة',
      dataIndex: 'family',
      key: 'family',
      width: 100,
      sorter: (a: any, b: any) => (a.family || '').localeCompare(b.family || ''),
      render: (f: string | null) =>
        f ? <Tag color={f === 'بولي' ? 'purple' : 'default'}>{f}</Tag> : '-',
    },
    {
      // «النوع» = تصنيف العميل (تاجر/سباك/معرض)، مش عائلة الفاتورة.
      title: 'النوع',
      dataIndex: 'customer_type',
      key: 'customer_type',
      width: 90,
      sorter: (a: any, b: any) =>
        (a.customer_type || '').localeCompare(b.customer_type || ''),
      render: (t: string | null) => t ? <Tag color="geekblue">{t}</Tag> : '-',
    },
    {
      title: 'مندوب',
      dataIndex: 'rep_id',
      key: 'rep_id',
      width: 95,
      ellipsis: true,
      render: (id: number | null, row: any) =>
        row.rep_name || reps.find((r) => r.id === id)?.full_name || '-',
    },
    {
      title: 'اجمالي قبل',
      dataIndex: 'gross',
      key: 'gross',
      width: 115,
      align: 'left' as const,
      sorter: (a: any, b: any) => a.gross - b.gross,
      render: (val: number) => `${money(val)} ج.م`,
    },
    {
      title: 'خصم',
      dataIndex: 'discount_value',
      key: 'discount_value',
      width: 105,
      align: 'left' as const,
      sorter: (a: any, b: any) => a.discount_value - b.discount_value,
      render: (val: number) => `${money(val)} ج.م`,
    },
    {
      // **النسبة من الفرق الحقيقي، مش من `combined_pct`.**
      //
      // `combined_pct` خصم المستند وحده، وهو صفر على كل فاتورة تقريباً — والخصم
      // الحقيقي عايش على السطر. فالكشف كان بيقول «خصم ٠٪» على فاتورة خصمها ٢٠٪،
      // والفاتورة نفسها لما تتفتح بتقول الرقم الصح. الكشف هو اللي بيتبص عليه.
      //
      // والأساس هو الإجمالي **قبل** خصم السطور (`discount_base`) — القسمة على الإجمالي
      // بعد الخصم بتطلّع ٢٥٪ مكان ٢٠٪.
      title: 'خصم%',
      dataIndex: 'discount_value',
      key: 'combined_pct',
      width: 80,
      sorter: (a: any, b: any) =>
        (a.discount_value / (a.discount_base || 1)) - (b.discount_value / (b.discount_base || 1)),
      render: (_v: number, r: any) => {
        const base = Number(r.discount_base || 0);
        if (base <= 0) return '-';
        const pct = (Number(r.discount_value || 0) / base) * 100;
        return pct > 0 ? `${pct.toFixed(pct < 10 ? 1 : 0)}%` : '-';
      },
    },
    {
      // دفاتر الكوبونات اللي اتسلّمت مع الفاتورة. عمود في الكشف لأن السؤال «سلّمنا
      // الراجل كام كوبون» بيتسأل على القايمة، مش جوّه الفاتورة — وقبل كده الإجابة
      // ماكانتش موجودة إلا لو فتحتها للتعديل.
      title: 'كوبونات',
      dataIndex: 'coupons',
      key: 'coupons',
      width: 120,
      align: 'left' as const,
      render: (_v: any, row: any) => {
        const rows: any[] = row.coupons ?? [];
        const named = rows.filter(
          (c) => c.coupon_kind || c.coupon_type_name || c.serial_from || c.serial_to);
        if (!named.length) {
          // الشكل القديم — مدى واحد على رأس الفاتورة، من غير فئة.
          if (!row.coupon_serial_from) return '-';
          return (
            <Tooltip title={`من ${row.coupon_serial_from} إلى ${row.coupon_serial_to}`}>
              <Tag color="gold">{row.coupon_count ?? '؟'} كوبون</Tag>
            </Tooltip>
          );
        }
        const total = named.reduce(
          (t: number, c: any) => t + (c.count ?? 0), 0);
        return (
          <Tooltip
            title={(
              <Space direction="vertical" size={0}>
                {named.map((c, i) => (
                  <span key={i}>
                    {c.coupon_kind || c.coupon_type_name || 'كوبونات'} —
                    {' '}من {c.serial_from ?? '؟'} إلى {c.serial_to ?? '؟'}
                  </span>
                ))}
              </Space>
            )}
          >
            <Tag color="gold">{total} كوبون</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: 'الصافى',
      dataIndex: 'net',
      key: 'net',
      width: 115,
      align: 'left' as const,
      sorter: (a: any, b: any) => a.net - b.net,
      render: (val: number, r: any) => (
        <strong style={{ color: r.doc_type === 'sale' ? '#237804' : '#c41d7f' }}>
          {r.doc_type === 'return' ? '-' : ''}{money(val)} ج.م
        </strong>
      ),
    },
    {
      // **اللي اتحصّل فعلاً، مش نقدي يوم البيع.**
      //
      // كان بيعرض `cash_amount` — الفلوس اللي اتاخدت مع الفاتورة نفسها — فالفاتورة
      // اللي اتباعت آجل واتحصّلت بعدها بسند كانت تفضل مكتوب جنبها «تم السداد ٠٫٠٠»
      // وحالتها «مدفوعة». الرقم الحي هو الصافي ناقص المتبقّي.
      title: 'تم السداد',
      dataIndex: 'residual',
      key: 'cash_amount',
      width: 100,
      align: 'left' as const,
      sorter: (a: any, b: any) =>
        (a.net - (a.residual ?? a.credit_amount)) - (b.net - (b.residual ?? b.credit_amount)),
      render: (_v: any, row: any) => {
        const res = Number(row.residual ?? row.credit_amount ?? 0);
        return `${money(Number(row.net || 0) - res)} ج.م`;
      },
    },
    {
      // المتبقّي الحي كمان — وبيبقى **سالب** لو العميل دفع أكتر من الفاتورة، وده
      // رصيد له مش عليه، فبيتلوّن أخضر مش أحمر.
      title: 'الباقى',
      dataIndex: 'residual',
      key: 'credit_amount',
      width: 100,
      align: 'left' as const,
      sorter: (a: any, b: any) =>
        (a.residual ?? a.credit_amount) - (b.residual ?? b.credit_amount),
      render: (_v: any, row: any) => {
        const n = Number(row.residual ?? row.credit_amount ?? 0);
        const color = n > 0.005 ? '#cf1322' : n < -0.005 ? '#6AB42D' : undefined;
        return <span style={{ color, fontWeight: Math.abs(n) > 0.005 ? 600 : undefined }}>{money(n)} ج.م</span>;
      },
    },
    {
      // «الباقي» اللي فوق رقم يوم البيع ومابيتحركش؛ ده بيتحرك مع كل تحصيل.
      title: 'التحصيل',
      dataIndex: 'payment_state',
      key: 'payment_state',
      width: 120,
      filters: [
        { text: 'مدفوعة', value: 'paid' },
        { text: 'جزئياً', value: 'partial' },
        { text: 'غير مدفوعة', value: 'not_paid' },
      ],
      onFilter: (v: any, r: any) => r.payment_state === v,
      render: (_: any, r: any) => {
        if (!r.payment_state) return '-';
        const color = r.payment_state === 'paid' ? 'green'
          : r.payment_state === 'partial' ? 'orange' : 'red';
        const rest = Number(r.residual ?? 0);
        return (
          <Tooltip title={rest > 0 ? `متبقّي ${money(rest)} ج.م` : 'مقفولة بالكامل'}>
            <Tag
              color={color}
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/reconciliation?kind=customer&partner=${r.customer_id}`);
              }}
            >
              {r.payment_state_label ?? r.payment_state}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: 'ملاحظات',
      dataIndex: 'notes',
      key: 'notes',
      width: 170,
      ellipsis: true,
      render: (v: string | null) => v || '-',
    },
    {
      // العمود كان بلا اسم وبلا تثبيت، وسط جدول أعمدته مامتقاسّهاش الفاضي كله. النتيجة
      // كانت شريط أبيض في نص السجل والأيقونات سايبة فيه — نفس السجلات التانية بتسمّيه
      // وبتثبّته على الحافة، فالإيد بتلاقيه في نفس المكان في كل شاشة.
      title: 'الإجراءات',
      key: 'actions',
      width: 130,
      // Icons, like the row icons on their own lists. Four words apiece cost more width than
      // «الصافى» and «الباقى» together — and those are the two numbers the list exists for.
      render: (_: any, record: any) => {
        const isSale = record.doc_type === 'sale';
        return (
          <Space size={2} onClick={(e) => e.stopPropagation()}>
            <Tooltip title={isSale ? 'عرض الفاتورة' : 'عرض المرتجع'}>
              <Button type="text" icon={<EyeOutlined />}
                onClick={() => {
                  if (isSale) {
                    openDetail(record.raw || record);
                  } else {
                    navigate(`/returns?id=${record.id}`);
                  }
                }} />
            </Tooltip>
            {isSale && (
              <Tooltip title="طباعة">
                <Button type="text" icon={<PrinterOutlined />}
                  onClick={async () => {
                    const detRes = await api.get(`/api/v1/sales/${record.id}`).catch(() => null);
                    if (detRes?.data) {
                      const doc = invoiceDoc({ ...record, ...detRes.data });
                      if (doc) printInvoice(doc, printOpts);
                    }
                  }} />
              </Tooltip>
            )}
            {isSale && canEditInvoice && (
              <Tooltip title="تعديل">
                <Button type="text" icon={<EditOutlined />}
                  onClick={() => handleEditInvoice(record.raw || record)} />
              </Tooltip>
            )}
            {canDeleteInvoice && (
              <Tooltip title="حذف">
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    Modal.confirm({
                      title: isSale ? 'تأكيد حذف فاتورة البيع' : 'تأكيد حذف سند المرتجع',
                      icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
                      content: (
                        <div>
                          <p>هل أنت متأكد من حذف {isSale ? 'فاتورة البيع' : 'سند المرتجع'} رقم: <b>{record.document_number}</b>؟</p>
                          <p style={{ color: '#8c8c8c', fontSize: 13 }}>سيتم حذف المستند بالكامل وإلغاء أثره المحاسبي والمخزني.</p>
                        </div>
                      ),
                      okText: 'نعم، احذف',
                      okType: 'danger',
                      cancelText: 'إلغاء',
                      onOk: async () => {
                        if (isSale) {
                          await handleDeleteInvoice(record.raw || record);
                        } else {
                          await handleDeleteReturn(record.raw || record);
                        }
                      },
                    });
                  }}
                />
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];
}
