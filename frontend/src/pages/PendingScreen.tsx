import React from 'react';
import { Card, Empty, Tag, Typography } from 'antd';
import { useLocation } from 'react-router-dom';
import { allScreens } from '../components/navigation';

/**
 * What a menu entry shows before its screen exists.
 *
 * The menu was rebuilt to the shape of the system the client is migrating from, all fifty-seven
 * screens of it, because a half-copied menu teaches the wrong map — someone learns that «السرايل»
 * is missing, and keeps believing it after we add it.
 *
 * So every entry is present and every entry tells the truth. A dead link that silently does nothing
 * is the worst of the options: the person clicking cannot tell it apart from a broken system, and
 * they report it as a bug. This says plainly that the screen is still being built, and names the
 * screen it will mirror so it can be checked against the original when it arrives.
 */
export default function PendingScreen() {
  const { pathname, search } = useLocation();
  const here = pathname + (search || '');
  const screen = allScreens().find((s) => s.key === here || s.key.split('?')[0] === pathname);

  return (
    <Card>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <div style={{ textAlign: 'center' }}>
            <Typography.Title level={4} style={{ marginBottom: 4 }}>
              {screen?.label || 'شاشة غير معروفة'}
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              الشاشة دي لسه بتتبني. موجودة في المنيو عشان الترتيب يبقى كامل من أول يوم.
            </Typography.Paragraph>
            {screen?.a5 && (
              <Tag color="blue">تقابل عندهم: {screen.a5}</Tag>
            )}
          </div>
        }
      />
    </Card>
  );
}
