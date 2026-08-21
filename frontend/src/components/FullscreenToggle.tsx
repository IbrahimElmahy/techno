import React, { useEffect, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { FullscreenExitOutlined, FullscreenOutlined } from '@ant-design/icons';

/**
 * ملء الشاشة.
 *
 * الشاشات اللي الشغل بيتعمل عليها هنا جداول: سجل فواتير، سطور فاتورة، كشف حساب. اللي
 * بيراجع بيقيس بعدد السطور اللي شايفها في المرة الواحدة، وشريط عنوان النافذة وشريط المهام
 * بياخدوا من الطول اللي هو محتاجه بالظبط — يعني سطرين تلاتة كل مرة، وسحب في كل صفحة.
 *
 * **بيتابع الحالة مش بيفترضها.** F11 والزرار بتوع النافذة بيغيّروا ملء الشاشة من غير ما
 * الزرار ده يعرف، فالأيقونة بتتسمّع لـ`fullscreenchange` بدل ما تفتكر آخر ضغطة — من غير
 * كده الزرار بيبقى بيقول «ادخل» والشاشة كاملة أصلاً.
 */
export default function FullscreenToggle() {
  const [on, setOn] = useState(() => !!document.fullscreenElement);

  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggle = () => {
    // الوعد بيترفض لو المتصفح رفض الطلب (مثلاً من غير تفاعل من المستخدم). ده مش غلط
    // يستاهل يوقف حاجة — الشاشة بتفضل زي ما هي والزرار بيفضل مكانه.
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  };

  return (
    <Tooltip title={on ? 'خروج من ملء الشاشة (F11)' : 'ملء الشاشة (F11)'}>
      <Button
        type="text"
        aria-label={on ? 'خروج من ملء الشاشة' : 'ملء الشاشة'}
        icon={on ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
        onClick={toggle}
        style={{ fontSize: 16 }}
      />
    </Tooltip>
  );
}
