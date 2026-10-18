import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * A `Modal`, not `Alert.alert`: the app has no `Alert` anywhere, and its other confirmations are Modals too.
 */
export function DeleteConfirmDialog({
  aiName,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  aiName: string | null;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      visible={aiName !== null}
      title={`Delete ${aiName ?? 'AI'}?`}
      message="This removes the AI's chat account and its provider key."
      error={error}
      confirmLabel="Remove"
      busyLabel="Removing…"
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
