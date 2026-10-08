import React, { useEffect, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { FullscreenExitOutlined, FullscreenOutlined } from '@ant-design/icons';

export function useFullscreen(): [boolean, () => void] {
  const [on, setOn] = useState(() => !!document.fullscreenElement);

  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  };

  return [on, toggle];
}

export default function FullscreenToggle() {
  const [on, toggle] = useFullscreen();

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
