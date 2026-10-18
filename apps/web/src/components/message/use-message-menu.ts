import { useState } from 'react';

/**
 * The menu's own dialog state. It lives in the always-mounted shell so the
 * store-reading body can unmount while nothing is open (T-2011). The delete
 * confirm and the emoji picker outlive the menu, which closes when either
 * opens.
 */
export interface MessageMenuState {
  confirmOpen: boolean;
  pickerOpen: boolean;
  openConfirm: () => void;
  closeConfirm: () => void;
  openPicker: () => void;
  closePicker: () => void;
}

export function useMessageMenu(): MessageMenuState {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  return {
    confirmOpen,
    pickerOpen,
    openConfirm: () => setConfirmOpen(true),
    closeConfirm: () => setConfirmOpen(false),
    openPicker: () => setPickerOpen(true),
    closePicker: () => setPickerOpen(false),
  };
}
