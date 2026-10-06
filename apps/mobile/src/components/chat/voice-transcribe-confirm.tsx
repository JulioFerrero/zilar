import { ConfirmDialog } from '@/components/ui/confirm-dialog';

type TranscribeConfirmProps = {
  open: boolean;
  busy: boolean;
  onDownload: () => void;
  onClose: () => void;
};

/**
 * The one-time model download confirm (T-0179): "Download the transcription
 * model? 17 MB, once. Everything stays on your phone." with Download /
 * Cancel on the kit `ConfirmDialog`. While busy the backdrop does nothing.
 */
export function VoiceTranscribeConfirm({
  open,
  busy,
  onDownload,
  onClose,
}: TranscribeConfirmProps) {
  if (!open) {
    return null;
  }
  return (
    <ConfirmDialog
      visible={open}
      title="Download the transcription model?"
      message="17 MB, once. Everything stays on your phone."
      confirmLabel="Download"
      busyLabel="Downloading…"
      busy={busy}
      destructive={false}
      onConfirm={onDownload}
      onCancel={busy ? () => {} : onClose}
      confirmAccessibilityLabel="Download transcription model"
      cancelAccessibilityLabel="Cancel transcription download"
      accessibilityLabel="Download the transcription model"
    />
  );
}
