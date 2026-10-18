import { LogOut } from 'lucide-react-native';
import { View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { DANGER } from '@/lib/colors';
import type { ChatSummary } from '@/lib/types';

type LeaveTopicSheetProps = {
  chat: ChatSummary | null;
  groupTitle: string;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onLeave: () => void;
};

export function LeaveTopicSheet({
  chat,
  groupTitle,
  busy,
  error,
  onCancel,
  onLeave,
}: LeaveTopicSheetProps) {
  const title = chat?.title ?? '';
  const message =
    chat?.topic?.visibility === 'private'
      ? 'Someone in it has to add you back.'
      : `You stop getting its messages. You can join again from ${
          groupTitle === '' ? 'the group' : groupTitle
        }.`;
  return (
    <BottomSheet
      visible={chat !== null}
      onClose={onCancel}
      closeLabel="Close leave topic"
      dismissible={!busy}
    >
      {chat === null ? null : (
        <View className="gap-3.5 pb-2">
          <View className="gap-1.5 px-1">
            <Text className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">
              Leave {title}?
            </Text>
            <Text className="text-[15px] leading-[22px] text-muted-foreground">{message}</Text>
          </View>
          {error !== '' ? (
            <Text accessibilityRole="alert" className="px-1 text-[13px] text-danger">
              {error}
            </Text>
          ) : null}
          <Button
            variant="outline"
            accessibilityLabel={`Leave ${title}`}
            disabled={busy}
            className="h-12 w-full rounded-[14px]"
            onPress={onLeave}
          >
            <LogOut size={18} color={DANGER} />
            <Text className="text-[16px] text-danger">{busy ? 'Leaving…' : 'Leave'}</Text>
          </Button>
          <Button
            variant="outline"
            accessibilityLabel="Cancel"
            disabled={busy}
            className="h-12 w-full rounded-[14px]"
            onPress={onCancel}
          >
            <Text className="text-[16px]">Cancel</Text>
          </Button>
        </View>
      )}
    </BottomSheet>
  );
}
