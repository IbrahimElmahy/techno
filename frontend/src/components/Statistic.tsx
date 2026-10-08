import React from 'react';
import { Statistic as AntStatistic } from 'antd';
import type { StatisticProps } from 'antd';

function Statistic(props: StatisticProps) {
  return <AntStatistic groupSeparator="" {...props} />;
}

Statistic.Countdown = AntStatistic.Countdown;

export { Statistic };
export default Statistic;
