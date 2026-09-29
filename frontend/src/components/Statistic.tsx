import React from 'react';
import { Statistic as AntStatistic } from 'antd';
import type { StatisticProps } from 'antd';

/**
 * `Statistic` بتاع antd من غير فاصل آلاف.
 *
 * antd بيحط «,» بين كل تلات أرقام من نفسه (`groupSeparator` الافتراضي)، والعميل عايز
 * العلامة العشرية بس (٢٠٢٦-٠٩-٢٩) — شوف `utils/noGrouping.ts`. الشاشات بتستورده من
 * هنا بدل antd، واللي عايز فاصل لسبب ما يقدر يبعته صريح.
 */
function Statistic(props: StatisticProps) {
  return <AntStatistic groupSeparator="" {...props} />;
}

Statistic.Countdown = AntStatistic.Countdown;

export { Statistic };
export default Statistic;
