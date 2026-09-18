import React from 'react';
import { Row } from 'antd';
import type { RowProps } from 'antd';
import { useAuth } from './AuthProvider';

/**
 * صفّ كروت الإحصائيات — بيتعرض للمالك وحده.
 *
 * الإجماليات اللي فوق الشاشات (مبيعات الفترة · الأرباح · المديونيات · أرصدة الخزينة)
 * بتقول «الشركة عاملة إيه» في سطر واحد. الموظف اللي بيكتب فاتورة محتاج يشوف فاتورته،
 * مش رقم أعمال الشركة — فالرقم ده بقى مقصور على `stats.view`، وهي عند «المالك» ومدير
 * النظام وبس.
 *
 * **بيخفي الصفّ كله مش الكروت.** لو خفينا `Statistic` لوحدها كان هيفضل مكانها كروت
 * فاضية بمسافاتها — شاشة مكسورة بدل شاشة مالهاش الجزء ده.
 *
 * `<StatsRow>` بدل `<Row>` في مكانها بالظبط، وبتمرّر كل خصائصها زي ما هي، فالشكل
 * مابيتغيّرش لمين بيشوفها.
 *
 * ودي **مش حاجز أمان**: اللي وراها طلبات API لكل واحدة حارسها. اللي بتعمله إن الشاشة
 * والسيرفر يقولوا نفس الكلمة، فمايحصلش إن الشاشة تعرض رقم السيرفر مكانش هيديه.
 */
export default function StatsRow({ children, ...rest }: RowProps) {
  const { can } = useAuth();
  if (!can('stats.view')) return null;
  return <Row {...rest}>{children}</Row>;
}

/** نفس الشرط من غير صفّ — للأماكن اللي الكروت فيها مش جوّه `Row`. */
export function useCanSeeStats(): boolean {
  const { can } = useAuth();
  return can('stats.view');
}
