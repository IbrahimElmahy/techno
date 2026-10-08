import React from 'react';
import { Row } from 'antd';
import type { RowProps } from 'antd';
import { useAuth } from './AuthProvider';

export default function StatsRow({ children, ...rest }: RowProps) {
  const { can } = useAuth();
  if (!can('stats.view')) return null;
  return <Row {...rest}>{children}</Row>;
}

export function useCanSeeStats(): boolean {
  const { can } = useAuth();
  return can('stats.view');
}
