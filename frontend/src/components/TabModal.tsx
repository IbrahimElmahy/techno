import React from 'react';
import { Modal, Drawer } from 'antd';
import type { ModalProps, DrawerProps } from 'antd';
import { useOnScreen } from './keyboard';
import { usePanelBusy } from './panelBusy';

const AWAY = 'tab-dialog-away';

const away = (onScreen: boolean, existing?: string) =>
  [existing, onScreen ? '' : AWAY].filter(Boolean).join(' ') || undefined;

export function TabModal({ open, rootClassName, maskClosable, ...rest }: ModalProps) {
  const onScreen = useOnScreen();
  usePanelBusy(!!open);
  return (
    <Modal
      {...rest}
      maskClosable={maskClosable ?? false}
      open={!!open && onScreen}
      rootClassName={away(onScreen, rootClassName)}
    />
  );
}

export function TabDrawer({ open, rootClassName, ...rest }: DrawerProps) {
  const onScreen = useOnScreen();
  usePanelBusy(!!open);
  return (
    <Drawer
      {...rest}
      open={!!open && onScreen}
      rootClassName={away(onScreen, rootClassName)}
    />
  );
}

export default TabModal;
