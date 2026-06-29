import React from 'react';
import { Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';

interface ConfirmParams {
  title: string;
  content: string;
  onOk: () => void | Promise<any>;
  onCancel?: () => void;
  okText?: string;
  cancelText?: string;
}

export function showReversalConfirm({
  title = 'تأكيد عملية التراجع/الإرجاع',
  content,
  onOk,
  onCancel,
  okText = 'تأكيد العملية',
  cancelText = 'إلغاء',
}: ConfirmParams) {
  Modal.confirm({
    title,
    icon: <ExclamationCircleOutlined style={{ color: '#F5A11D' }} />, // Accent warning color
    content,
    okText,
    cancelText,
    okType: 'danger',
    direction: 'rtl',
    className: 'rtl-confirm-modal',
    onOk,
    onCancel,
  });
}

export function showDeactivationConfirm({
  title = 'تأكيد إلغاء التفعيل/التعطيل',
  content,
  onOk,
  onCancel,
  okText = 'تأكيد التعطيل',
  cancelText = 'إلغاء',
}: ConfirmParams) {
  Modal.confirm({
    title,
    icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
    content,
    okText,
    cancelText,
    okType: 'danger',
    direction: 'rtl',
    className: 'rtl-confirm-modal',
    onOk,
    onCancel,
  });
}
