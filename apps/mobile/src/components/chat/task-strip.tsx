import { Linking, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import {
  httpsTopicUrl,
  topicLinkText,
  topicOwnerLabel,
  topicStatusLabel,
  topicTypeLabel,
} from '@/lib/topics';
import type { ChatSummary } from '@/lib/types';
import type { TopicStatus } from '@/lib/topics-api';

const STATUS_ORDER: TopicStatus[] = ['open', 'in_progress', 'in_review', 'blocked', 'done'];

const STATUS_DOT_BG: Record<TopicStatus, string> = {
  open: '#8a8a8a',
  in_progress: '#fbbf24',
  in_review: '#60a5fa',
  blocked: '#f87171',
  done: '#4ade80',
};

type TaskStripProps = {
  chat: ChatSummary;
  statusOpen: boolean;
  onToggleStatus: () => void;
  onChooseStatus: (status: TopicStatus) => void;
  ownerOpen: boolean;
  onToggleOwner: () => void;
  onChooseOwner: (owner: { kind: 'user' | 'ai'; id: string; name: string } | null) => void;
  ownerCandidates: { kind: 'user' | 'ai'; id: string; name: string }[];
  linkOpen: boolean;
  onToggleLink: () => void;
  linkUrl: string;
  linkLabel: string;
  onChangeLinkUrl: (value: string) => void;
  onChangeLinkLabel: (value: string) => void;
  onSaveLink: () => void;
  error: string;
};

/**
 * The task strip under the chat header (T-0112), on every topic: the type
 * chip, the status chip (dot + text, never color alone), the owner, and the
 * link (https only). State and patching live in the chat screen so the strip
 * stays a thin view; candidates come from the topic members + AIs.
 */
export function TaskStrip({
  chat,
  statusOpen,
  onToggleStatus,
  onChooseStatus,
  ownerOpen,
  onToggleOwner,
  onChooseOwner,
  ownerCandidates,
  linkOpen,
  onToggleLink,
  linkUrl,
  linkLabel,
  onChangeLinkUrl,
  onChangeLinkLabel,
  onSaveLink,
  error,
}: TaskStripProps) {
  const topic = chat.topic;
  if (topic === undefined) {
    return null;
  }
  const status = topic.status;
  const href = httpsTopicUrl(topic.linkUrl);
  return (
    <View
      accessibilityRole="none"
      accessibilityLabel="Topic details"
      className="border-b border-divider bg-surface px-4 py-2"
    >
      <View className="flex-row flex-wrap items-center gap-1.5">
        <View className="rounded-[5px] border border-badge-muted px-1.5 py-[3px]">
          <Text className="font-mono text-[10px] font-semibold leading-[15px] text-muted-foreground">
            {topicTypeLabel(topic)}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Status: ${topicStatusLabel(status)}. Change status`}
          accessibilityState={{ expanded: statusOpen }}
          onPress={onToggleStatus}
          className="flex-row items-center gap-1.5 rounded-full border border-divider px-2.5 py-1 active:bg-surface-raised"
        >
          <View
            accessibilityElementsHidden
            importantForAccessibility="no"
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: STATUS_DOT_BG[status] }}
          />
          <Text className="text-[12px] font-medium text-foreground">
            {topicStatusLabel(status)}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${topicOwnerLabel(topic)}. Change owner`}
          accessibilityState={{ expanded: ownerOpen }}
          onPress={onToggleOwner}
          className="rounded-full border border-divider px-2.5 py-1 active:bg-surface-raised"
        >
          <Text className="text-[12px] text-muted-foreground">{topicOwnerLabel(topic)}</Text>
        </Pressable>

        {href !== undefined ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${topicLinkText(topic)}`}
            onPress={() => {
              void Linking.openURL(href);
            }}
            className="flex-row items-center gap-1 rounded-full border border-divider px-2.5 py-1 active:bg-surface-raised"
          >
            <Text numberOfLines={1} className="max-w-40 text-[12px] text-muted-foreground">
              {topicLinkText(topic)}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add topic link"
            onPress={onToggleLink}
            className="rounded-full border border-divider px-2.5 py-1 active:bg-surface-raised"
          >
            <Text className="text-[12px] text-muted-foreground">{topicLinkText(topic)}</Text>
          </Pressable>
        )}
        {href !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit topic link"
            onPress={onToggleLink}
            className="rounded-full px-1.5 py-1 active:bg-surface-raised"
          >
            <Text className="text-[12px] text-muted-foreground">Edit</Text>
          </Pressable>
        ) : null}
      </View>

      {statusOpen ? (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Change status"
          className="mt-2 gap-0.5"
        >
          {STATUS_ORDER.map((option) => (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ checked: option === status }}
              accessibilityLabel={topicStatusLabel(option)}
              onPress={() => onChooseStatus(option)}
              className="flex-row items-center gap-2 rounded-lg px-2 py-2 active:bg-surface-raised"
            >
              <View
                accessibilityElementsHidden
                importantForAccessibility="no"
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: STATUS_DOT_BG[option] }}
              />
              <Text className="text-[13px] text-foreground">{topicStatusLabel(option)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {ownerOpen ? (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Change owner"
          className="mt-2 gap-0.5"
        >
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: topic.owner === null }}
            accessibilityLabel="No owner"
            onPress={() => onChooseOwner(null)}
            className="rounded-lg px-2 py-2 active:bg-surface-raised"
          >
            <Text className="text-[13px] text-foreground">No owner</Text>
          </Pressable>
          {ownerCandidates.map((candidate) => (
            <Pressable
              key={`${candidate.kind}:${candidate.id}`}
              accessibilityRole="radio"
              accessibilityState={{
                checked: topic.owner !== null && topic.owner.id === candidate.id,
              }}
              accessibilityLabel={
                candidate.kind === 'ai' ? `${candidate.name} (AI)` : candidate.name
              }
              onPress={() => onChooseOwner(candidate)}
              className="rounded-lg px-2 py-2 active:bg-surface-raised"
            >
              <Text className="text-[13px] text-foreground">
                {candidate.kind === 'ai' ? `${candidate.name} (AI)` : candidate.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {linkOpen ? (
        <View className="mt-2 gap-2">
          <TextField
            value={linkUrl}
            onChangeText={onChangeLinkUrl}
            placeholder="https://…"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Topic link URL"
            className="text-[14px]"
          />
          <TextField
            value={linkLabel}
            onChangeText={onChangeLinkLabel}
            placeholder="Label (optional)"
            maxLength={40}
            accessibilityLabel="Topic link label"
            className="text-[14px]"
          />
          <View className="flex-row justify-end">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save link"
              onPress={onSaveLink}
              className="rounded-full bg-accent px-4 py-1.5 active:opacity-90"
            >
              <Text className="text-[14px] font-medium text-accent-foreground">Save</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {error !== '' ? (
        <Text accessibilityRole="alert" className="mt-1 text-[12px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
