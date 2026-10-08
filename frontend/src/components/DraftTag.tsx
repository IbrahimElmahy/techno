import React from 'react';
import { Button, Space, Tag, message } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';

export default function DraftTag({
  onDelete,
  label = 'مسودّة — لسه ما اترحّلتش',
}: {
  onDelete: () => void | Promise<void>;
  label?: string;
}) {
  const [busy, setBusy] = React.useState(false);

  const run = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onDelete();
      message.success('المسودّة اتمسحت');
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر مسح المسودّة');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Space size={6}>
      <Tag color="gold" style={{ marginInlineEnd: 0 }}>{label}</Tag>
      <Button
        size="small"
        danger
        loading={busy}
        icon={<DeleteOutlined />}
        onClick={run}
      >
        امسح
      </Button>
    </Space>
  );
}
