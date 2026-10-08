import React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';

/**
 * «سلف العاملين» اندمجت في «ذمم وسلف الموظفين» (طلب العميل ٢٠٢٦-١٠-٠٨).
 *
 * الرابط القديم بيفضل شغّال — المفضّلة والتابات المحفوظة والروابط اللي اتبعتت — وبيوصل لنفس
 * الشريحة اللي كان بيفتحها: `/advances` على «السلف»، و`?tab=adjustments` على «الجزاءات».
 */
export default function Advances() {
  const [search] = useSearchParams();
  const tab = search.get('tab') === 'adjustments' ? 'adjustments' : 'advances';
  return <Navigate to={`/employee-receivables?tab=${tab}`} replace />;
}
