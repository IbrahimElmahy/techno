export type InspectionDim = 'document' | 'item' | 'technician' | 'merchant' | 'rep' | 'visit_kind'
  | 'month' | 'day' | 'governorate' | 'markaz' | 'branch';
export type InspectionPeriod = 'none' | 'day' | 'month';

export interface InspectionPreset {
  key: string;
  label: string;
  dims: InspectionDim[];
  period?: InspectionPeriod;
  group: string;
}

export const INSPECTION_POINTS_GROUP = 'تقارير المعاينات بالنقاط';

const P = (key: string, label: string, dims: InspectionDim[],
  period: InspectionPeriod = 'none'): InspectionPreset => ({ group: INSPECTION_POINTS_GROUP, key, label, dims, period });

export const INSPECTION_POINTS_PRESETS: InspectionPreset[] = [
  P('lines', 'الزيارات بالنقاط (سطر بسطر)', ['document', 'item']),
  P('technicians', 'الزيارات بنقاط الفني', ['technician']),
  P('items', 'نقاط الأصناف', ['item']),
  P('merchants', 'نقاط التجار', ['merchant']),
  P('reps', 'نقاط المناديب', ['rep']),
  P('technician-item', 'فني = صنف', ['technician', 'item']),
  P('monthly', 'نقاط شهرية', [], 'month'),
  P('governorates', 'المعاينات بالمحافظة', ['governorate']),
];
