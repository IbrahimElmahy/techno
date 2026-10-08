import React from 'react';
import { Button, Card, Empty, Tag, Typography } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { allScreens } from '../components/navigation';

interface Pending {
  what: string;
  insteadLabel?: string;
  insteadPath?: string;
  note?: string;
}

const PENDING: Record<string, Pending> = {
};

export default function PendingScreen() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const here = pathname + (search || '');
  const screens = allScreens();
  const screen = screens.find((s) => s.key === here)
    ?? screens.find((s) => s.key.split('?')[0] === pathname);
  const pending = PENDING[here] || PENDING[pathname];

  return (
    <Card>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <div style={{ textAlign: 'center', maxWidth: 520, margin: '0 auto' }}>
            <Typography.Title level={4} style={{ marginBottom: 4 }}>
              {screen?.label || 'شاشة غير معروفة'}
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              هذه الشاشة قيد الإنشاء. وهي موجودة في القائمة ليكتمل الترتيب من أول يوم.
            </Typography.Paragraph>
            {pending && (
              <Typography.Paragraph style={{ marginBottom: 8 }}>
                {pending.what}
              </Typography.Paragraph>
            )}
            {pending?.note && (
              <Typography.Paragraph type="secondary" style={{ fontSize: 15, marginBottom: 8 }}>
                {pending.note}
              </Typography.Paragraph>
            )}
            {pending?.insteadPath && (
              <Typography.Paragraph style={{ marginBottom: 8 }}>
                <Typography.Text type="secondary">لحد ما تتعمل، أقرب حاجة موجودة:</Typography.Text>
                <Button type="link" onClick={() => navigate(pending.insteadPath!)}>
                  {pending.insteadLabel}
                </Button>
              </Typography.Paragraph>
            )}
            {screen?.a5 && (
              <Tag color="blue">تقابل عندهم: {screen.a5}</Tag>
            )}
          </div>
        }
      />
    </Card>
  );
}
