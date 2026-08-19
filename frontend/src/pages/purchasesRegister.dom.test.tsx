/**
 * سجل الشرا — بيترسم فعلاً وبتتضغط أزراره.
 *
 * كل اختبارات الشاشة دي كانت بتقرا نص الكود: «الدالة دي بتنادي كذا». وده مسك حاجات كتير،
 * وعمى تماماً عن نوع واحد — **الضغطة اللي مابتوديش مكان**. حصل مرتين ورا بعض، والسويت خضرا
 * في المرتين والمستخدم هو اللي شافهم:
 *
 * 1. «عرض» كان بيعكس الفاتورة أول ما تفتحها. العكس بيطلّع البضاعة من المخزن، فأي فاتورة
 *    أصنافها اتباعت بقت مش قابلة للفتح: «الرصيد مايكفيش» على مجرد إنك عايز تبص.
 * 2. لما العكس اتشال من الفتح، الشاشة بقت بتتملّى في الخلفية والسجل فاضل قدامك — تدوس وتلفّ
 *    وماتوديش مكان.
 *
 * الاختبارات اللي تحت بترسم الصفحة وتضغط الزرار وتبص على اللي حصل، فالنوع ده بيتمسك هنا.
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/** كل نداءات الشبكة بتتسجّل هنا عشان الاختبار يشوف إيه اللي اتبعت فعلاً. */
const calls: { method: string; url: string }[] = [];

const INVOICE = {
  id: 7, kind: 'purchase', document_number: 'PINV-000007',
  supplier_id: 1, supplier_name: 'مورد الاختبار',
  purchase_date: '2026-08-19', created_at: '2026-08-19T10:00:00',
  external_document_number: 'X-1', notes: null,
  branch_id: null, branch_name: null,
  expense_account_id: null, expense_account_name: null,
  gross: '1000.00', discount_amount: '0.00', combined_pct: '0.00',
  tax_amount: '0.00', tax_pct: '0.00', net: '1000.00',
  total: '1000.00', cash_amount: '1000.00', credit_amount: '0.00',
};

const DETAIL = {
  ...INVOICE,
  location_kind: 'warehouse', location_id: 3,
  variable_discount_pct: '0',
  lines: [{ item_id: 11, quantity: '10', unit_price: '100', line_total: '1000',
    unit: null, discount_pct: null, line_location_id: 3 }],
  returns: [],
};

vi.mock('../api/client', () => ({
  api: {
    get: (url: string) => {
      calls.push({ method: 'GET', url });
      if (url === '/api/v1/purchases') return Promise.resolve({ data: [INVOICE] });
      if (url === '/api/v1/purchases/returns') return Promise.resolve({ data: [] });
      if (url === '/api/v1/purchases/7') return Promise.resolve({ data: DETAIL });
      if (url === '/api/v1/items') {
        return Promise.resolve({ data: [{ id: 11, name: 'صنف الاختبار', active: true,
          category: null, purchase_price: '100' }] });
      }
      if (url === '/api/v1/suppliers') {
        return Promise.resolve({ data: [{ id: 1, name: 'مورد الاختبار', code: 'S1' }] });
      }
      if (url === '/api/v1/warehouses') {
        return Promise.resolve({ data: [{ id: 3, name: 'المخزن المركزي',
          warehouse_type: 'central', branch_id: null }] });
      }
      return Promise.resolve({ data: [] });
    },
    post: (url: string) => {
      calls.push({ method: 'POST', url });
      return Promise.resolve({ data: {} });
    },
    put: (url: string) => { calls.push({ method: 'PUT', url }); return Promise.resolve({ data: {} }); },
    delete: (url: string) => {
      calls.push({ method: 'DELETE', url }); return Promise.resolve({ data: {} });
    },
  },
}));

// eslint-disable-next-line import/first
import Purchases from './Purchases';

const draw = () => render(<MemoryRouter><Purchases /></MemoryRouter>);

beforeEach(() => { calls.length = 0; });

describe('السجل بيترسم', () => {
  it('بيعرض الفاتورة اللي جاية من السيرفر', async () => {
    draw();
    // antd بترسم الأعمدة المثبّتة مرتين — طبقة ثابتة وطبقة بتتمرّر — فالنص بيتلاقى مرتين.
    expect((await screen.findAllByText('PINV-000007')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('مورد الاختبار').length).toBeGreaterThan(0);
  });

  it('بيقرا الفواتير والمرتجعات مع بعض', async () => {
    draw();
    await screen.findAllByText('PINV-000007');
    const urls = calls.filter((c) => c.method === 'GET').map((c) => c.url);
    expect(urls).toContain('/api/v1/purchases');
    expect(urls).toContain('/api/v1/purchases/returns');
  });
});

describe('«عرض» بيوصل مكان ومابيغيّرش حاجة', () => {
  it('بيفتح شاشة تعديل الفاتورة', async () => {
    draw();
    await screen.findAllByText('PINV-000007');
    // antd بترسم الأعمدة المثبّتة في طبقتين — الزرار اللي بيستقبل الضغط هو بتاع آخر طبقة.
    const shown = screen.getAllByRole('button', { name: /عرض/ });
    await userEvent.click(shown[shown.length - 1]);

    // الشاشة اللي بتتفتح فيها زرار الترحيل — يعني الكتابة، مش السجل.
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /تسجيل وترحيل فاتورة الشراء/ }).length)
        .toBeGreaterThan(0);
    });
  });

  it('الفتح لوحده مابيبعتش أي حاجة بتغيّر — ولا عكس ولا ترحيل', async () => {
    /*
     * ده الاختبار اللي كان هيمسك العطل الأول.
     *
     * «عرض» كان بيعكس الفاتورة قبل ما يفتحها. الفتح لازم يبقى قراية: لو الواحد بص وقفل،
     * مايكونش اتحرك مخزون ولا اتكتب قيد.
     */
    draw();
    await screen.findAllByText('PINV-000007');
    // antd بترسم الأعمدة المثبّتة في طبقتين — الزرار اللي بيستقبل الضغط هو بتاع آخر طبقة.
    const shown = screen.getAllByRole('button', { name: /عرض/ });
    await userEvent.click(shown[shown.length - 1]);
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /تسجيل وترحيل فاتورة الشراء/ }).length)
        .toBeGreaterThan(0);
    });

    const writes = calls.filter((c) => c.method !== 'GET');
    expect(writes, `الفتح بعت: ${writes.map((w) => `${w.method} ${w.url}`).join('، ')}`)
      .toEqual([]);
  });

  it('بيملا الشاشة بمحتوى الفاتورة', async () => {
    draw();
    await screen.findAllByText('PINV-000007');
    // antd بترسم الأعمدة المثبّتة في طبقتين — الزرار اللي بيستقبل الضغط هو بتاع آخر طبقة.
    const shown = screen.getAllByRole('button', { name: /عرض/ });
    await userEvent.click(shown[shown.length - 1]);
    // سطر الفاتورة بصنفه — مش شاشة فاضية.
    expect((await screen.findAllByText('صنف الاختبار')).length).toBeGreaterThan(0);
  });
});
