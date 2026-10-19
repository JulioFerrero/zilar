import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AiBadge } from '@/components/chat/ai-badge';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Text, TextField } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import type { TopicVisibility } from '@/lib/topics-api';
import type { GroupAi, GroupMember } from '@/lib/chat-api';

export type NewTopicInput = {
  name: string;
  visibility: TopicVisibility;
  memberIds: string[] | undefined;
  aiIds: string[];
};

// The new-topic sheet: name, Public/Private with help text, the member list for private (the creator locked in), and the group AIs unticked with "AIs only read topics you add them to". The screen validates and creates.
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
      visibility,
      memberIds: visibility === 'private' ? [meUserId, ...selectedMembers] : undefined,
      aiIds: selectedAis,
    });
  };

  const shownError = localError !== '' ? localError : error;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close new topic"
      title="New topic"
      footer={
        <Button
          accessibilityLabel="Create topic"
          disabled={busy || name.trim() === ''}
          onPress={create}
        >
          <Text>{busy ? 'Creating…' : 'Create'}</Text>
        </Button>
      }
    >
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
          ? 'Anyone in the group can find it and join.'
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
                <EntityAvatar person={member} size={28} />
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
                    <EntityAvatar
                      person={{ id: ai.jid, name: ai.name, avatarUrl: ai.avatarUrl }}
                      size={28}
                      ai
                    />
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
    </BottomSheet>
  );
}
