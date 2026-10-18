import { isTopicJoined } from '@zilar/chat-core';
import { BellOff, ChevronRight, Lock, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AvatarStack } from '@/components/group-info/avatar-stack';
import { InfoRowGroup } from '@/components/group-info/info-row';
import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { Text } from '@/components/ui/text';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { runInBackground } from '@/lib/effect/run-in-background';

const STACK_MAX = 4;

type SectionPerson = { id: string; name: string; avatarUrl?: string };

type SectionTopic = {
  id: string;
  title: string;
  muted: boolean;
  archived?: boolean | undefined;
  memberCount?: number | undefined;
  topic?: {
    isGeneral: boolean;
    visibility: 'public' | 'private';
    archived: boolean;
    memberIds?: string[] | undefined;
    ais?: readonly SectionPerson[] | undefined;
  };
};

type SectionMember = { userId: string; name: string; avatarUrl?: string | undefined };

type TopicsSectionProps = {
  topics: readonly SectionTopic[];
  currentUserId: string;
  members: readonly SectionMember[];
  ais: readonly { aiId: string; name: string; avatarUrl?: string | undefined }[];
  onOpenTopic: (chatId: string) => void;
  onNewTopic: () => void;
  onJoinTopic: (chatId: string) => Promise<void>;
};

function GlyphTile({ isPrivate }: { isPrivate: boolean }) {
  return (
    <View className="h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-border-strong bg-surface-raised">
      {isPrivate ? (
        <Lock size={15} color={ICON} />
      ) : (
        <Text color={ICON} className="text-[16px] font-semibold">
          #
        </Text>
      )}
    </View>
  );
}

function personOf(member: SectionMember): SectionPerson {
  return {
    id: member.userId,
    name: member.name,
    ...(member.avatarUrl === undefined ? {} : { avatarUrl: member.avatarUrl }),
  };
}

function subtitleFor(chat: SectionTopic, membersById: Map<string, SectionMember>): string {
  const info = chat.topic;
  if (info === undefined) {
    return '';
  }
  if (info.isGeneral) {
    return 'Everyone';
  }
  const ai = info.ais?.[0]?.name;
  if (info.visibility === 'private') {
    const names = (info.memberIds ?? [])
      .map((id) => membersById.get(id)?.name)
      .filter((name): name is string => name !== undefined)
      .slice(0, 2);
    if (names.length > 0) {
      return ai === undefined ? names.join(', ') : `${names.join(', ')} · ${ai}`;
    }
  }
  const count = info.memberIds?.length ?? chat.memberCount ?? 0;
  const people = `${count} ${count === 1 ? 'person' : 'people'}`;
  return ai === undefined ? people : `${people} · ${ai}`;
}

function stackFor(
  chat: SectionTopic,
  members: readonly SectionMember[],
  ais: readonly { aiId: string; name: string; avatarUrl?: string | undefined }[],
  membersById: Map<string, SectionMember>,
): SectionPerson[] {
  const info = chat.topic;
  if (info === undefined) {
    return [];
  }
  const people = info.isGeneral
    ? members.map(personOf)
    : (info.memberIds ?? [])
        .map((id) => membersById.get(id))
        .filter((member): member is SectionMember => member !== undefined)
        .map(personOf);
  const aiPeople = info.isGeneral
    ? ais.map((ai) => ({
        id: ai.aiId,
        name: ai.name,
        ...(ai.avatarUrl === undefined ? {} : { avatarUrl: ai.avatarUrl }),
      }))
    : (info.ais ?? []);
  return [...people, ...aiPeople].slice(0, STACK_MAX);
}

function YourTopicRow({
  chat,
  subtitle,
  stack,
  onOpen,
}: {
  chat: SectionTopic;
  subtitle: string;
  stack: readonly SectionPerson[];
  onOpen: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${chat.title}`}
      onPress={onOpen}
      className="min-h-[56px] flex-row items-center gap-3 px-3 active:bg-surface-raised"
    >
      <GlyphTile isPrivate={chat.topic?.visibility === 'private'} />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text numberOfLines={1} className="text-[15px] text-foreground">
          {chat.title}
        </Text>
        <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
          {subtitle}
        </Text>
      </View>
      {chat.muted ? <BellOff size={15} color={MUTED_FOREGROUND} /> : null}
      {stack.length > 0 ? <AvatarStack people={stack} /> : null}
      <ChevronRight size={14} color={MUTED_FOREGROUND} />
    </Pressable>
  );
}

function OtherTopicRow({
  chat,
  subtitle,
  onOpen,
  onJoin,
}: {
  chat: SectionTopic;
  subtitle: string;
  onOpen: () => void;
  onJoin: (chatId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const join = () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setFailed(false);
    runInBackground(() => onJoin(chat.id), {
      onFailure: () => setFailed(true),
      onSettled: () => setBusy(false),
    });
  };

  return (
    <View className="min-h-[56px] flex-row items-center gap-3 px-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${chat.title}`}
        onPress={onOpen}
        className="min-w-0 flex-1 flex-row items-center gap-3"
      >
        <GlyphTile isPrivate={chat.topic?.visibility === 'private'} />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text numberOfLines={1} className="text-[15px] text-foreground">
            {chat.title}
          </Text>
          <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
            {subtitle}
          </Text>
        </View>
      </Pressable>
      <Button
        variant="key"
        disabled={busy}
        accessibilityLabel={`Join ${chat.title}`}
        onPress={join}
        className="h-8 rounded-[10px] px-3.5"
      >
        <Text>{busy ? 'Joining…' : failed ? "Couldn't join" : 'Join'}</Text>
      </Button>
    </View>
  );
}

function NewTopicRow({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="New topic"
      onPress={onPress}
      className="min-h-[56px] flex-row items-center gap-3 px-3 active:bg-surface-raised"
    >
      <IconTile>
        <Plus size={16} color={ICON} />
      </IconTile>
      <Text className="min-w-0 flex-1 text-[15px] text-foreground">New topic</Text>
    </Pressable>
  );
}

export function TopicsSection({
  topics,
  currentUserId,
  members,
  ais,
  onOpenTopic,
  onNewTopic,
  onJoinTopic,
}: TopicsSectionProps) {
  if (topics.length === 0) {
    return null;
  }
  const membersById = new Map(members.map((member) => [member.userId, member]));
  // Archived topics (manager- or per-user) leave both lists, like the topics screen.
  const active = topics.filter((chat) => chat.topic?.archived !== true && chat.archived !== true);
  const your = active.filter(
    (chat) => chat.topic !== undefined && isTopicJoined(chat.topic, currentUserId),
  );
  const other = active.filter(
    (chat) => chat.topic?.visibility === 'public' && !isTopicJoined(chat.topic, currentUserId),
  );

  return (
    <>
      {your.length > 0 ? (
        <View className="gap-2">
          <SectionLabel>Your topics</SectionLabel>
          <InfoRowGroup>
            {your.map((chat) => (
              <YourTopicRow
                key={chat.id}
                chat={chat}
                subtitle={subtitleFor(chat, membersById)}
                stack={stackFor(chat, members, ais, membersById)}
                onOpen={() => onOpenTopic(chat.id)}
              />
            ))}
            <NewTopicRow onPress={onNewTopic} />
          </InfoRowGroup>
        </View>
      ) : null}

      {other.length > 0 ? (
        <View className="gap-2">
          <SectionLabel>Other topics</SectionLabel>
          <InfoRowGroup>
            {other.map((chat) => (
              <OtherTopicRow
                key={chat.id}
                chat={chat}
                subtitle={subtitleFor(chat, membersById)}
                onOpen={() => onOpenTopic(chat.id)}
                onJoin={onJoinTopic}
              />
            ))}
          </InfoRowGroup>
        </View>
      ) : null}
    </>
  );
}
