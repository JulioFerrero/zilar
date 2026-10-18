import type { ChatSummary } from '@zilar/chat-core';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Image,
  LogOut,
  Pin,
  Settings,
  ShieldCheck,
  Wrench,
} from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { AvatarStack, type StackPerson } from '@/components/group-info/avatar-stack';
import { InfoKeys } from '@/components/group-info/info-keys';
import { InfoRow, InfoRowGroup } from '@/components/group-info/info-row';
import { TopicsSection } from '@/components/group-info/topics-section';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import type { GroupAi, GroupMember } from '@/lib/chat-api';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';

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
