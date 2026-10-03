import { Modal, View } from 'react-native';

import { Button } from '@/components/ui/button';
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
    <Modal
      visible={rule !== null}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      accessibilityLabel="Confirm revoke"
    >
      <View className="flex-1 items-center justify-center bg-black/40 p-6">
        <View className="w-full max-w-xs rounded-2xl bg-background p-4">
          <Text className="text-[16px] font-semibold text-foreground">
            Stop always allowing {rule?.action ?? 'this action'}?
          </Text>
          <Text className="mt-1 text-[14px] leading-5 text-muted-foreground">
            The AI will ask for approval again next time.
          </Text>
          {error !== '' ? (
            <Text accessibilityRole="alert" className="mt-2 text-[13px] text-danger">
              {error}
            </Text>
          ) : null}
          <View className="mt-4 flex-row justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onPress={onCancel}>
              <Text>Cancel</Text>
            </Button>
            <Button variant="destructive" size="sm" disabled={busy} onPress={onConfirm}>
              <Text>{busy ? 'Revoking…' : 'Revoke'}</Text>
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}
