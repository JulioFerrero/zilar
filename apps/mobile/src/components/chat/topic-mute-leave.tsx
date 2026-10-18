import { isTopicJoined } from '@zilar/chat-core';
import { Bell, LogOut } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { rawCall } from '@/components/chat/group-action';
import { IconTile } from '@/components/ui/icon-tile';
import { Text } from '@/components/ui/text';
import { mutedUntilFor } from '@/lib/chat-prefs';
import { ACCENT, DANGER, ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import type { ChatSummary } from '@/lib/types';
import { useChatStore } from '@/store/chat-store-provider';

const MUTE_ERROR = 'Could not change notifications. Try again.';

const TRACK_ON = MUTED_FOREGROUND;
const TRACK_OFF = '#0c0c0c';
const TRACK_BORDER = '#262626';

type TopicMuteLeaveProps = {
  chat: ChatSummary;
  myUserId: string;
  disabled: boolean;
  onAskLeave: () => void;
};

// The bottom group of the In this topic sheet: the Mute row with its 46×28 switch and the red Leave topic row. Only people in a non-General topic see it; the confirm lives in `leave-topic-sheet.tsx`.
export function TopicMuteLeave({ chat, myUserId, disabled, onAskLeave }: TopicMuteLeaveProps) {
  const setChatPref = useChatStore((state) => state.setChatPref);
  // A group mute sits on the General row and covers every topic; the switch below writes only this topic's own row.
  const groupMuted = useChatStore((state) =>
    chat.groupId === undefined
      ? false
      : state.chats.some(
          (entry) =>
            entry.groupId === chat.groupId && entry.topic?.isGeneral === true && entry.muted,
        ),
  );
  const [muteState, runMute] = useAction((mutedUntil: string | null) =>
    rawCall(() => setChatPref(chat.id, { mutedUntil })),
  );
  const busy = isWaiting(muteState);
  const error = !busy && failureOf(muteState) !== undefined ? MUTE_ERROR : '';
  const topic = chat.topic;

  if (topic === undefined || topic.isGeneral || !isTopicJoined(topic, myUserId)) {
    return null;
  }

  const muted = chat.muted === true;
  // Clearing this topic's row does not lift an inherited group mute, so the switch must not accept a change it cannot make.
  const inheritedMute = muted && groupMuted;
  const switchDisabled = disabled || busy || inheritedMute;

  return (
    <View className="gap-1">
      <View className="overflow-hidden rounded-[14px] border border-border bg-surface">
        <View className="min-h-[52px] flex-row items-center gap-3 px-3">
          <IconTile>
            <Bell size={16} color={ICON} />
          </IconTile>
          <Text className="min-w-0 flex-1 text-[16px] text-foreground">Mute</Text>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel={`Mute ${chat.title}`}
            accessibilityHint={inheritedMute ? 'Muted for the whole group' : undefined}
            accessibilityState={{ checked: muted, disabled: switchDisabled }}
            disabled={switchDisabled}
            onPress={() => runMute(muted ? null : mutedUntilFor('forever', new Date()))}
            className="h-[28px] w-[46px] flex-row items-center rounded-full px-[3px]"
            style={{
              backgroundColor: muted ? TRACK_ON : TRACK_OFF,
              borderWidth: 1,
              borderColor: muted ? TRACK_ON : TRACK_BORDER,
              justifyContent: muted ? 'flex-end' : 'flex-start',
            }}
          >
            <View className="h-5 w-5 rounded-full" style={{ backgroundColor: ACCENT }} />
          </Pressable>
        </View>
        {inheritedMute ? (
          <Text className="px-3 pb-2 text-[12px] text-muted-foreground">
            Muted for the whole group.
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Leave ${chat.title}`}
          disabled={disabled}
          onPress={onAskLeave}
          className="min-h-[52px] flex-row items-center gap-3 border-t border-divider px-3 active:bg-surface-raised disabled:opacity-60"
        >
          <View className="w-[34px] items-center justify-center">
            <LogOut size={18} color={DANGER} />
          </View>
          <Text className="text-[16px] text-danger">Leave topic</Text>
        </Pressable>
      </View>
      {error !== '' ? (
        <Text accessibilityRole="alert" className="px-3 text-[13px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
