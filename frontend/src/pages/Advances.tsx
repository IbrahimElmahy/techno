import React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';

export default function Advances() {
  const [search] = useSearchParams();
  const tab = search.get('tab') === 'adjustments' ? 'adjustments' : 'advances';
  return <Navigate to={`/payroll?tab=advances&sub=${tab}`} replace />;
}
