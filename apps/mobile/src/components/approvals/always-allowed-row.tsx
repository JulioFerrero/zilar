import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Text } from '@/components/ui/text';
import type { ApprovalRule } from '@/lib/approvals-api';

/** One always-allowed rule with a two-step Revoke, mirroring web's `AlwaysAllowedList`. */
export function AlwaysAllowedRow({
  rule,
  confirming,
  revoking,
  onAsk,
  onCancel,
  onConfirm,
}: {
  rule: ApprovalRule;
  confirming: boolean;
  revoking: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <View className="flex-row items-center gap-2 px-2 py-1.5">
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[14px]">
          {rule.action}
        </Text>
        <Text numberOfLines={1} className="text-[12px] text-muted-foreground">
          {rule.topicName ?? (rule.scope === 'personal' ? 'Personal chat' : 'In a group')}
        </Text>
      </View>
      {confirming ? (
        <View className="shrink-0 flex-row items-center gap-1">
          <Button
            variant="destructive"
            size="sm"
            disabled={revoking}
            accessibilityLabel={`Confirm revoking ${rule.action}`}
            onPress={onConfirm}
          >
            <Text>{revoking ? 'Revoking…' : 'Revoke'}</Text>
          </Button>
          <Button variant="ghost" size="sm" disabled={revoking} onPress={onCancel}>
            <Text>Cancel</Text>
          </Button>
        </View>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          accessibilityLabel={`Revoke ${rule.action}`}
          onPress={onAsk}
        >
          <Text>Revoke</Text>
        </Button>
      )}
    </View>
  );
}

/**
 * The confirm-first step for revoking a rule. The app has no `Alert`
 * anywhere; the other confirmations are Modals too (see `DeleteConfirmDialog`).
 */
export function RevokeConfirmDialog({
  rule,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  rule: ApprovalRule | null;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      visible={rule !== null}
      title={`Stop always allowing ${rule?.action ?? 'this action'}?`}
      message="The AI will ask for approval again next time."
      error={error}
      confirmLabel="Revoke"
      busyLabel="Revoking…"
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
      accessibilityLabel="Confirm revoke"
    />
  );
}
