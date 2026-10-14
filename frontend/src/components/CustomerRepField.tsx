import React from 'react';
import { Form, Select } from 'antd';
import type { CSSProperties } from 'react';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { isAfterSalesType, repOptions, serviceRepOptions } from '../utils/reps';

export default function CustomerRepField({
  reps, serviceReps, territories, repLabel = 'مندوب', style, branchId: fixedBranch,
}: {
  reps: any[];
  serviceReps: any[];
  territories: any[];
  repLabel?: string;
  style?: CSSProperties;
  branchId?: number | null;
}) {
  const form = Form.useFormInstance();
  const type = Form.useWatch('customer_type', form) as string | undefined;
  const branchId = Form.useWatch('branch_id', form) as number | undefined;
  const territoryId = Form.useWatch('territory_id', form) as number | undefined;
  const repId = Form.useWatch('rep_id', form) as number | undefined;
  const serviceRepId = Form.useWatch('service_rep_id', form) as number | undefined;
  const branch = fixedBranch ?? branchId ?? territories.find((t: any) => t.id === territoryId)?.branch_id;

  if (isAfterSalesType(type)) {
    return (
      <Form.Item key="service_rep_id" name="service_rep_id" label="مندوب خدمة ما بعد البيع"
        style={style}
        rules={[{ required: true, message: 'يرجى تحديد مندوب خدمة ما بعد البيع!' }]}>
        <Select showSearch placeholder="اختر مندوب الخدمة"
          options={[
            ...serviceRepOptions(serviceReps, branch, serviceRepId),
            ...(serviceRepId && !serviceReps.some((r: any) => r.id === serviceRepId)
              ? [{ value: serviceRepId,
                  label: reps.find((r: any) => r.id === serviceRepId)?.full_name
                    || `مندوب #${serviceRepId}` }]
              : []),
          ]}
          filterOption={searchFilter} filterSort={searchRank} />
      </Form.Item>
    );
  }
  return (
    <Form.Item key="rep_id" name="rep_id" label={repLabel} style={style}
      rules={[{ required: true, message: 'يرجى تحديد المندوب!' }]}>
      <Select showSearch placeholder="اختر المندوب"
        options={repOptions(reps, repId)}
        filterOption={searchFilter} filterSort={searchRank} />
    </Form.Item>
  );
}
