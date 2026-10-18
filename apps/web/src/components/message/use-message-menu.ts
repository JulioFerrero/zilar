import { useState } from 'react';

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
