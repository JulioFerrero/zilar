import { isTopicJoined, type ChatSummary } from '@zilar/chat-core';
import {
  Activity,
  BellOff,
  ChevronLeft,
  ChevronRight,
  Image,
  Lock,
  LogOut,
  Pin,
  Plus,
  Settings,
  ShieldCheck,
  Wrench,
} from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { AvatarStack, type StackPerson } from '@/components/group-info/avatar-stack';
import { InfoKeys } from '@/components/group-info/info-keys';
import { InfoRow, InfoRowGroup } from '@/components/group-info/info-row';
import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { IconTile } from '@/components/ui/icon-tile';
import { Text } from '@/components/ui/text';
import type { GroupAi, GroupMember } from '@/lib/chat-api';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { runInBackground } from '@/lib/effect/run-in-background';

const STACK_MAX = 5;

const personOfMember = (member: GroupMember): StackPerson => ({
  id: member.userId,
  name: member.name,
  ...(member.avatarUrl === undefined ? {} : { avatarUrl: member.avatarUrl }),
});

const personOfAi = (ai: GroupAi): StackPerson => ({
  id: ai.aiId,
  name: ai.name,
  ...(ai.avatarUrl === undefined ? {} : { avatarUrl: ai.avatarUrl }),
});

const stackOf = (members: readonly GroupMember[], ais: readonly GroupAi[]): StackPerson[] =>
  [...ais.map(personOfAi), ...members.map(personOfMember)].slice(0, STACK_MAX);

const TOPIC_STACK_MAX = 4;

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
  return [...people, ...aiPeople].slice(0, TOPIC_STACK_MAX);
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

type GroupInfoRootProps = {
  groupChatId: string;
  chatReady: boolean;
  title: string;
  memberCount: number | undefined;
  pinsCount: number | undefined;
  allowedCount: number | undefined;
  topics: readonly ChatSummary[];
  currentUserId: string;
  groupMembers: readonly GroupMember[];
  groupAis: readonly GroupAi[];
  isManager: boolean;
  isOwner: boolean;
  onBack: () => void;
  onSearch: () => void;
  onAdd: () => void;
  onMore: () => void;
  onOpenMembers: () => void;
  onOpenSettings: () => void;
  onLeave: () => void;
  onOpenMedia: () => void;
  onOpenPins: () => void;
  onOpenTools: () => void;
  onOpenActivity: () => void;
  onOpenAllowed: () => void;
  onOpenTopic: (chatId: string) => void;
  onNewTopic: () => void;
  onJoinTopic: (chatId: string) => Promise<void>;
};

const memberLabel = (count: number): string => `${count} ${count === 1 ? 'member' : 'members'}`;

export function GroupInfoRoot({
  groupChatId,
  chatReady,
  title,
  memberCount,
  pinsCount,
  allowedCount,
  topics,
  currentUserId,
  groupMembers,
  groupAis,
  isManager,
  isOwner,
  onBack,
  onSearch,
  onAdd,
  onMore,
  onOpenMembers,
  onOpenSettings,
  onLeave,
  onOpenMedia,
  onOpenPins,
  onOpenTools,
  onOpenActivity,
  onOpenAllowed,
  onOpenTopic,
  onNewTopic,
  onJoinTopic,
}: GroupInfoRootProps) {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="h-14 flex-row items-center px-3">
        <IconButton label="Back" onPress={onBack}>
          <ChevronLeft size={18} color={ICON} />
        </IconButton>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="items-center gap-1.5 px-4 pb-[18px]">
          <EntityAvatar chat={{ id: groupChatId, title }} size={96} />
          <Text
            numberOfLines={1}
            className="mt-2 max-w-full text-[22px] font-semibold tracking-[-0.02em] text-foreground"
          >
            {title}
          </Text>
          {memberCount === undefined ? null : (
            <Text className="text-[14px] text-muted-foreground">{memberLabel(memberCount)}</Text>
          )}
        </View>

        {/* T-1569: Mute and Search act on the group's own chat row, so they stay
            disabled (dimmed, non-interactive) until that row is loaded, instead
            of falling back to the raw group id. */}
        <View
          className={chatReady ? undefined : 'opacity-40'}
          pointerEvents={chatReady ? 'auto' : 'none'}
        >
          <InfoKeys
            groupChatId={groupChatId}
            canManage={isManager}
            isOwner={isOwner}
            onSearch={onSearch}
            onAdd={onAdd}
            onMore={onMore}
          />
        </View>

        <View className="gap-3 px-4">
          {/* T-1858: one People and AIs row, after `PhoneGroup.dc.html:56-61`:
              the stack (AIs first), the label, the total and a chevron. */}
          <InfoRowGroup>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="People and AIs"
              onPress={onOpenMembers}
              className="min-h-[48px] flex-row items-center gap-3 px-3 active:bg-surface-raised"
            >
              <AvatarStack people={stackOf(groupMembers, groupAis)} />
              <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] text-foreground">
                People and AIs
              </Text>
              {memberCount === undefined ? null : (
                <Text className="font-mono text-[13px] text-muted-foreground">{memberCount}</Text>
              )}
              <ChevronRight size={14} color={MUTED_FOREGROUND} />
            </Pressable>
          </InfoRowGroup>

          {/* T-1787: Your topics and Other topics, after `PhoneGroup.dc.html:64-107`. */}
          <TopicsSection
            topics={topics}
            currentUserId={currentUserId}
            members={groupMembers}
            ais={groupAis}
            onOpenTopic={onOpenTopic}
            onNewTopic={onNewTopic}
            onJoinTopic={onJoinTopic}
          />

          {/* T-1573: the Content group, between People and Settings, after
              `Phone.dc.html:64-90`. Activity and Always allowed are for
              managers; every row opens a page. */}
          <InfoRowGroup>
            <InfoRow icon={Image} label="Shared media" onPress={onOpenMedia} />
            <InfoRow icon={Pin} label="Pinned messages" count={pinsCount} onPress={onOpenPins} />
            <InfoRow icon={Wrench} label="Tools and routines" onPress={onOpenTools} />
            {isManager ? (
              <InfoRow icon={Activity} label="Activity" onPress={onOpenActivity} />
            ) : null}
            {isManager ? (
              <InfoRow
                icon={ShieldCheck}
                label="Always allowed"
                count={allowedCount}
                onPress={onOpenAllowed}
              />
            ) : null}
          </InfoRowGroup>

          {/* T-1574: the Settings row is for managers, like web
              (`GroupInfoRoot.tsx:265`). Each control inside keeps its own
              rule: picture and switches for managers, visibility for the
              owner. */}
          {isManager ? (
            <InfoRowGroup>
              <InfoRow icon={Settings} label="Settings" onPress={onOpenSettings} />
            </InfoRowGroup>
          ) : null}

          {isOwner ? null : (
            <InfoRowGroup>
              <InfoRow icon={LogOut} label="Leave group" danger onPress={onLeave} />
            </InfoRowGroup>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
