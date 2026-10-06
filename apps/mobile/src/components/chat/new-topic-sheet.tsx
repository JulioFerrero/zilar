import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AiBadge } from '@/components/chat/ai-badge';
import { Avatar } from '@/components/chat/avatar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Checkbox } from '@/components/ui/checkbox';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { cn } from '@/lib/utils';
import type { TopicKind, TopicVisibility } from '@/lib/topics-api';
import type { GroupAi, GroupMember } from '@/lib/chat-api';

const TYPE_CHIPS: { kind: TopicKind; label: string }[] = [
  { kind: 'chat', label: 'Topic' },
  { kind: 'task', label: 'Task' },
  { kind: 'bug', label: 'Bug' },
  { kind: 'ui', label: 'UI' },
  { kind: 'routine', label: 'Routine' },
];

export type NewTopicInput = {
  name: string;
  kind: TopicKind;
  visibility: TopicVisibility;
  memberIds: string[] | undefined;
  aiIds: string[];
};

/**
 * The new-topic sheet (T-0112): name, type chips, Public/Private with the
 * help text, the member list for private (the creator locked in), and the
 * viewer's group AIs unticked with "AIs only read topics you add them to".
 * Thin view: the screen validates and creates.
 */
export function NewTopicSheet({
  visible,
  groupTitle,
  members,
  myAis,
  meUserId,
  busy,
  error,
  onCreate,
  onClose,
}: {
  visible: boolean;
  groupTitle: string;
  members: GroupMember[];
  myAis: GroupAi[];
  meUserId: string;
  busy: boolean;
  error: string;
  onCreate: (input: NewTopicInput) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TopicKind>('chat');
  const [visibility, setVisibility] = useState<TopicVisibility>('public');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [selectedAis, setSelectedAis] = useState<string[]>([]);
  const [localError, setLocalError] = useState('');

  const toggleMember = (userId: string): void => {
    if (userId === meUserId) {
      return;
    }
    setSelectedMembers((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  };

  const toggleAi = (aiId: string): void => {
    setSelectedAis((current) =>
      current.includes(aiId) ? current.filter((id) => id !== aiId) : [...current, aiId],
    );
  };

  const create = (): void => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setLocalError('Enter a topic name');
      return;
    }
    setLocalError('');
    onCreate({
      name: trimmed.slice(0, 80),
      kind,
      visibility,
      memberIds: visibility === 'private' ? [meUserId, ...selectedMembers] : undefined,
      aiIds: selectedAis,
    });
  };

  const shownError = localError !== '' ? localError : error;

  return (
    <BottomSheet visible={visible} onClose={onClose} closeLabel="Close new topic" title="New topic">
      <Text className="mt-1 text-[14px] text-muted-foreground">in {groupTitle}</Text>

      <Text className="mt-4 text-[14px] font-medium text-foreground">Name</Text>
      <TextField
        value={name}
        onChangeText={setName}
        maxLength={80}
        placeholder="e.g. Checkout bug"
        accessibilityLabel="Topic name"
        className="mt-1"
      />

      <Text className="mt-3 text-[14px] font-medium text-foreground">Type</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Topic type"
        className="mt-1.5 flex-row flex-wrap gap-1.5"
      >
        {TYPE_CHIPS.map((chip) => {
          const selected = kind === chip.kind;
          return (
            <Pressable
              key={chip.kind}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={chip.label}
              onPress={() => setKind(chip.kind)}
              className={cn(
                'rounded-full border px-3 py-1.5 active:bg-surface-raised',
                selected ? 'border-border-strong bg-surface-raised' : 'border-border',
              )}
            >
              <Text
                className={cn(
                  'text-[13px] font-medium',
                  selected ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {chip.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text className="mt-3 text-[14px] font-medium text-foreground">Who can see it</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Topic visibility"
        className="mt-1.5 flex-row gap-0.5 rounded-[10px] border border-border bg-well p-[3px]"
      >
        {(
          [
            { value: 'public', label: 'Public' },
            { value: 'private', label: 'Private' },
          ] as const
        ).map((option) => {
          const selected = visibility === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={option.label}
              onPress={() => setVisibility(option.value)}
              className={cn(
                'h-[30px] flex-1 items-center justify-center rounded-[7px] active:bg-surface-raised',
                selected ? 'bg-surface-raised' : null,
              )}
            >
              <Text
                className={cn(
                  'text-[13px] font-medium',
                  selected ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text className="mt-1 text-[13px] text-muted-foreground">
        {visibility === 'public'
          ? 'Everyone in the group can read and write here.'
          : 'Only the people you pick can see this topic — it stays hidden from everyone else, including group admins.'}
      </Text>

      {visibility === 'private' ? (
        <View className="mt-3 gap-1">
          <Text className="text-[14px] font-medium text-foreground">People</Text>
          {members.map((member) => {
            const locked = member.userId === meUserId;
            const checked = locked || selectedMembers.includes(member.userId);
            return (
              <Pressable
                key={member.userId}
                accessibilityRole="checkbox"
                accessibilityState={{ checked, disabled: locked }}
                accessibilityLabel={`${member.name}${locked ? ' (you, always included)' : ''}`}
                disabled={locked}
                onPress={() => toggleMember(member.userId)}
                className="flex-row items-center gap-3 rounded-lg px-2 py-2 active:bg-surface-raised"
              >
                <Checkbox checked={checked} disabled={locked} />
                <Avatar id={member.userId} name={member.name} size={28} />
                <Text numberOfLines={1} className="min-w-0 flex-1 text-[14px] text-foreground">
                  {member.name}
                </Text>
                {member.role !== 'member' ? (
                  <Text className="font-mono text-[10px] text-muted-foreground">{member.role}</Text>
                ) : null}
              </Pressable>
            );
          })}
          {myAis.length > 0 ? (
            <>
              <Text className="mt-2 text-[14px] font-medium text-foreground">
                My AIs in this group
              </Text>
              <Text className="text-[13px] text-muted-foreground">
                AIs only read topics you add them to.
              </Text>
              {myAis.map((ai) => {
                const checked = selectedAis.includes(ai.aiId);
                return (
                  <Pressable
                    key={ai.aiId}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    accessibilityLabel={ai.name}
                    onPress={() => toggleAi(ai.aiId)}
                    className="flex-row items-center gap-3 rounded-lg px-2 py-2 active:bg-surface-raised"
                  >
                    <Checkbox checked={checked} />
                    <Avatar id={ai.jid} name={ai.name} size={28} ai />
                    <Text numberOfLines={1} className="min-w-0 flex-1 text-[14px] text-foreground">
                      {ai.name}
                    </Text>
                    <AiBadge />
                  </Pressable>
                );
              })}
            </>
          ) : null}
        </View>
      ) : null}

      {shownError !== '' ? (
        <Text accessibilityRole="alert" className="mt-2 text-[13px] text-danger">
          {shownError}
        </Text>
      ) : null}

      <View className="mt-4 flex-row justify-end gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={onClose}
          className="rounded-full px-4 py-2 active:bg-surface-raised"
        >
          <Text className="text-[15px] text-foreground">Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create topic"
          disabled={busy}
          onPress={create}
          className="rounded-full bg-accent px-4 py-2 active:opacity-90 disabled:opacity-50"
        >
          <Text className="text-[15px] font-medium text-accent-foreground">
            {busy ? 'Creating…' : 'Create'}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
