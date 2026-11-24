import React from 'react';
import { Button } from 'antd';
import { WhatsAppOutlined } from '@ant-design/icons';
import { shareVia } from '../print/share';

export default function ShareButton({ run, disabled, size }: {
  run: () => unknown;
  disabled?: boolean;
  size?: 'small' | 'middle';
}) {
  return (
    <Button icon={<WhatsAppOutlined />} disabled={disabled} size={size}
      onClick={() => { void shareVia(run); }}>
      واتساب
    </Button>
  );
}
