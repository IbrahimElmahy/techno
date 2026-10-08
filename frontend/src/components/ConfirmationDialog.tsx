interface ConfirmParams {
  title?: string;
  content?: string;
  onOk: () => void | Promise<any>;
  onCancel?: () => void;
  okText?: string;
  cancelText?: string;
}

export function showReversalConfirm({ onOk }: ConfirmParams) {
  void onOk();
}

export function showDeactivationConfirm({ onOk }: ConfirmParams) {
  void onOk();
}
