import React from 'react';

export function Popconfirm({
  children, onConfirm, disabled, ...rest
}: {
  children?: React.ReactNode;
  onConfirm?: (e?: any) => void;
  disabled?: boolean;
  [key: string]: any;
}) {
  void rest;
  return (
    <span
      onClick={(e) => {
        if (disabled) return;
        e.stopPropagation();
        onConfirm?.(e);
      }}
    >
      {children}
    </span>
  );
}

export function runWithoutConfirm({ onOk }: { onOk: () => void | Promise<any> }) {
  void onOk();
}

export default Popconfirm;
