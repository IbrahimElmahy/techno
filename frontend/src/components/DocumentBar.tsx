import React from 'react';
import { Button, Space, Tag, Tooltip } from 'antd';
import { RightOutlined, LeftOutlined } from '@ant-design/icons';

export interface DocumentStep {
  key: string;
  label: string;
  color?: string;
}

export default function DocumentBar({
  listLabel, listTo, title, position, total, onPrev, onNext, steps, current, extra,
}: {
  listLabel: string;
  listTo?: string;
  title: string;
  position?: number | null;
  total?: number | null;
  onPrev?: () => void;
  onNext?: () => void;
  steps?: DocumentStep[];
  current?: string | null;
  extra?: React.ReactNode;
}) {
  const showPager = onPrev || onNext;
  const now = steps?.find((s) => s.key === current);

  void listLabel; void listTo; void title;
  return (
    <Space size={6} style={{ fontWeight: 400 }}>
      {now && (
        <Tooltip title={steps!.map((s) => s.label).join(' ← ')}>
          <Tag color={now.color || 'blue'} style={{ marginInlineEnd: 0 }}>{now.label}</Tag>
        </Tooltip>
      )}
      {extra}
      {showPager && (
        <Space size={0}>
          <Tooltip title="السابق">
            <Button size="small" type="text" icon={<RightOutlined />}
                    disabled={!onPrev} onClick={onPrev} />
          </Tooltip>
          {position != null && total != null && (
            <span style={{ color: '#888', fontSize: 14, minWidth: 48, textAlign: 'center' }}>
              {position} / {total}
            </span>
          )}
          <Tooltip title="التالي">
            <Button size="small" type="text" icon={<LeftOutlined />}
                    disabled={!onNext} onClick={onNext} />
          </Tooltip>
        </Space>
      )}
    </Space>
  );
}
