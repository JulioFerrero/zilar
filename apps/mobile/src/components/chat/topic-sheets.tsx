import { Lock } from 'lucide-react-native';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/chat/avatar';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { MUTED_FOREGROUND } from '@/lib/colors';
import type { TopicMember } from '@/lib/topics-api';
import type { ChatSummary } from '@/lib/types';
import { useColorScheme } from 'nativewind';

export type TopicSheetAction = 'mute' | 'archive';

/**
 * The long-press sheet on a topic row (T-0112): Mute always, Archive for
 * managers (never General — the caller hides it). Thin view; the screen
 * performs the actions.
 */
export function TopicActionsSheet({
  chat,
  canArchive,
  onAction,
  onClose,
}: {
  chat: ChatSummary | null;
  canArchive: boolean;
  onAction: (action: TopicSheetAction) => void;
  onClose: () => void;
}) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={chat !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close topic actions"
        onPress={onClose}
        className="flex-1 justify-end bg-black/40 px-2"
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <Pressable onPress={() => {}} className="overflow-hidden rounded-2xl bg-background">
          {chat !== null ? (
            <View className="flex-row items-center gap-3 border-b border-divider px-4 py-3">
              <View className="h-9 w-9 items-center justify-center rounded-[10px] border border-edge bg-surface-raised">
                <Text className="text-[16px] font-semibold text-foreground">
                  {chat.topic?.glyph ?? 'G'}
                </Text>
              </View>
              <Text numberOfLines={1} className="min-w-0 flex-1 text-[16px] font-semibold">
                {chat.title}
              </Text>
              {chat.topic?.visibility === 'private' ? (
                <Lock size={16} color={MUTED_FOREGROUND[scheme]} />
              ) : null}
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mute topic"
            onPress={() => onAction('mute')}
            className="border-b border-divider px-4 py-3.5 active:bg-surface-raised"
          >
            <Text className="text-[16px] text-foreground">Mute</Text>
          </Pressable>
          {canArchive ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Archive topic"
              onPress={() => onAction('archive')}
              className="px-4 py-3.5 active:bg-surface-raised"
            >
              <Text className="text-[16px] text-danger">Archive</Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * The topic-info sheet opened from the topic header (T-0112): visibility,
 * members (private list with Leave for a member), AIs in the topic, and
 * Archive / Leave actions for managers and members. The screen loads the
 * data; the sheet only renders it.
 */
export function TopicInfoSheet({
  chat,
  groupTitle,
  members,
  ais,
  aiCount,
  canArchive,
  isMember,
  busy,
  error,
  onLeave,
  onArchive,
  onClose,
}: {
  chat: ChatSummary | null;
  groupTitle: string;
  members: TopicMember[];
  ais: { id: string; name: string }[];
  aiCount: number;
  canArchive: boolean;
  isMember: boolean;
  busy: boolean;
  error: string;
  onLeave: () => void;
  onArchive: () => void;
  onClose: () => void;
}) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const insets = useSafeAreaInsets();
  const topic = chat?.topic;
  return (
    <Modal visible={chat !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close topic info"
        onPress={onClose}
        className="flex-1 justify-end bg-black/40"
      >
        <Pressable
          onPress={() => {}}
          className="max-h-[80%] rounded-t-2xl border-t border-border-strong bg-surface px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <View className="mb-1 h-1 w-10 self-center rounded-full bg-surface-raised" />
          {chat !== null && topic !== undefined ? (
            <View className="gap-3 py-2">
              <View className="flex-row items-center gap-3">
                <Avatar id={chat.id} name={chat.title} size={44} />
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-[17px] font-semibold text-foreground">
                    {chat.title}
                  </Text>
                  <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
                    {groupTitle} · {topic.visibility === 'private' ? 'Private' : 'Public'}
                  </Text>
                </View>
                {topic.visibility === 'private' ? (
                  <Lock size={16} color={MUTED_FOREGROUND[scheme]} />
                ) : null}
              </View>

              <View>
                <Text className="text-[13px] font-semibold text-muted-foreground">
                  {topic.visibility === 'private'
                    ? `Members (${members.length})`
                    : `All ${chat.memberCount ?? members.length} members of the group`}
                </Text>
                {topic.visibility === 'private'
                  ? members.map((member) => (
                      <View key={member.userId} className="flex-row items-center gap-2 py-1.5">
                        <Avatar id={member.userId} name={member.name} size={28} />
                        <Text numberOfLines={1} className="flex-1 text-[15px] text-foreground">
                          {member.name}
                        </Text>
                      </View>
                    ))
                  : null}
              </View>

              <View>
                <Text className="text-[13px] font-semibold text-muted-foreground">
                  AIs in this topic ({aiCount})
                </Text>
                {ais.map((ai) => (
                  <View key={ai.id} className="flex-row items-center gap-2 py-1.5">
                    <Avatar id={ai.id} name={ai.name} size={28} ai />
                    <Text numberOfLines={1} className="flex-1 text-[15px] text-foreground">
                      {ai.name}
                    </Text>
                  </View>
                ))}
                {ais.length === 0 ? (
                  <Text className="py-1 text-[14px] text-muted-foreground">No AIs here yet.</Text>
                ) : null}
              </View>

              {error !== '' ? (
                <Text accessibilityRole="alert" className="text-[13px] text-danger">
                  {error}
                </Text>
              ) : null}

              <View className="flex-row justify-end gap-2">
                {topic.visibility === 'private' && isMember && !topic.isGeneral ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Leave topic"
                    disabled={busy}
                    onPress={onLeave}
                    className="rounded-[10px] px-4 py-2 active:bg-surface-raised disabled:opacity-50"
                  >
                    <Text className="text-[15px] text-foreground">Leave</Text>
                  </Pressable>
                ) : null}
                {canArchive ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Archive topic"
                    disabled={busy}
                    onPress={onArchive}
                    className="rounded-[10px] bg-danger px-4 py-2 active:opacity-80 disabled:opacity-50"
                  >
                    <Text className="text-[15px] font-semibold text-accent-foreground">
                      {busy ? 'Working…' : 'Archive'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
