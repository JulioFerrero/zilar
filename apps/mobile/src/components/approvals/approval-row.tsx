import { Check, X } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { useKeyPress } from '@/components/ui/use-key-press';
import type { ApprovalDecision, PublicApproval } from '@/lib/approvals-api';
import { ACCENT_FOREGROUND, ICON } from '@/lib/colors';
import { KEY_PRIMARY_PRESSED_SHADOW, pressStyle, primaryKey } from '@/lib/depth';
import { cn } from '@/lib/utils';

import type { RowBusy } from './rows';

export function PendingApprovalRow({
  approval,
  aiName,
  busy,
  actionError,
  last,
  onDecide,
}: {
  approval: PublicApproval;
  aiName: string;
  busy: RowBusy;
  actionError: string;
  last: boolean;
  onDecide: (id: string, decision: ApprovalDecision) => void;
}) {
  const name = approval.aiName === '' ? aiName : approval.aiName;
  const where =
    name === '' ? '' : approval.groupName === null ? name : `${name} · ${approval.groupName}`;
  const disabled = busy !== null;
  return (
    <View className={cn('flex-col', !last && 'border-b border-divider')}>
      <View className="flex-row items-center gap-3 p-3.5">
        <EntityAvatar person={{ id: approval.aiId, name }} size={40} ai />
        <View className="min-w-0 flex-1 flex-col gap-[3px]">
          <Text numberOfLines={2} className="text-[15px] font-medium">
            {approval.summary}
          </Text>
          {where !== '' ? (
            <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
              {where}
            </Text>
          ) : null}
        </View>
        <IconButton
          label={`Deny: ${approval.summary}`}
          className={disabled ? 'opacity-50' : undefined}
          disabled={disabled}
          onPress={() => onDecide(approval.id, 'deny')}
        >
          <X size={17} color={ICON} />
        </IconButton>
        <PrimaryIconKey
          label={`Approve: ${approval.summary}`}
          disabled={disabled}
          onPress={() => onDecide(approval.id, 'approve_once')}
        />
      </View>

      {actionError !== '' ? (
        <View className="px-4 pb-3.5">
          <Text accessibilityRole="alert" className="text-[13px] text-danger">
            {actionError}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The Approve key. The kit's `IconButton` is the dark icon key only, so this
 * uses the same 40 px, 12 radius recipe with the primary look (`depth.ts`).
 */
function PrimaryIconKey({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const { pressed, reduceMotion, setPressed } = useKeyPress();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      className={cn('h-10 w-10 items-center justify-center rounded-xl', disabled && 'opacity-50')}
      style={[primaryKey, pressStyle(pressed, KEY_PRIMARY_PRESSED_SHADOW, reduceMotion)]}
    >
      <Check size={17} color={ACCENT_FOREGROUND} />
    </Pressable>
  );
}
