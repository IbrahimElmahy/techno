import React from 'react';
import { Modal, Drawer } from 'antd';
import type { ModalProps, DrawerProps } from 'antd';
import { useOnScreen } from './keyboard';

/**
 * بوباب بيفضل في التبويب اللي فتحه.
 *
 * The workspace keeps every open screen MOUNTED and hides the inactive ones with `display: none`
 * (see `TabWorkspace`). A dialog does not live in that div — antd renders it through a portal on
 * `document.body` — so a dialog left open on one screen sat on top of whatever screen you switched
 * to. You would open فاتورة, leave the item picker open, go to الخزينة, and find the item picker
 * over it; «حفظ» then posted against the invoice you were no longer looking at.
 *
 * The rule lives here rather than in each of the seventy-odd dialogs: a rule copied seventy times
 * is a rule that is right sixty-nine times.
 *
 * **Two things, not one.** `open` goes false so the dialog stops holding the keyboard and Esc — but
 * closing is an ANIMATION, and antd only hides the element once that animation reports finished. A
 * window that is not painting gets no animation frames, so the dialog sat there fully visible,
 * frozen mid-fade, with `open` already false. The class hides it on the same render, without
 * waiting for a frame that may never arrive. It stays MOUNTED either way, so a half-typed form is
 * exactly where it was when its tab is opened again.
 *
 * `Modal.confirm` and friends are static calls, not elements, so they are untouched. They are also
 * short-lived — nobody leaves one open and walks away — so they were never the problem.
 */

/** Hidden outright, without waiting for a close animation that may never run. See index.css. */
const AWAY = 'tab-dialog-away';

const away = (onScreen: boolean, existing?: string) =>
  [existing, onScreen ? '' : AWAY].filter(Boolean).join(' ') || undefined;

export function TabModal({ open, rootClassName, ...rest }: ModalProps) {
  const onScreen = useOnScreen();
  return (
    <Modal
      {...rest}
      open={!!open && onScreen}
      rootClassName={away(onScreen, rootClassName)}
    />
  );
}

export function TabDrawer({ open, rootClassName, ...rest }: DrawerProps) {
  const onScreen = useOnScreen();
  return (
    <Drawer
      {...rest}
      open={!!open && onScreen}
      rootClassName={away(onScreen, rootClassName)}
    />
  );
}

export default TabModal;
