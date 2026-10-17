import type { ChatSummary } from '@zilar/chat-core';
import {
  Activity,
  Bot,
  ChevronLeft,
  Image,
  Link2,
  LogOut,
  Pin,
  Settings,
  ShieldCheck,
  Users,
  Wrench,
} from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { InfoKeys } from '@/components/group-info/info-keys';
import { InfoRow, InfoRowGroup } from '@/components/group-info/info-row';
import { TopicsSection } from '@/components/group-info/topics-section';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import type { GroupAi, GroupMember } from '@/lib/chat-api';
import { ICON } from '@/lib/colors';

type GroupInfoRootProps = {
  /** The group's own chat row: the General topic, for the picture and Mute. */
  groupChatId: string;
  /** Whether that chat row is loaded; until then Mute and Search are disabled. */
  chatReady: boolean;
  title: string;
  /** People plus AIs; `undefined` while the detail is not loaded (no number). */
  memberCount: number | undefined;
  /** People only, for the Members row; `undefined` when not loaded. */
  peopleCount: number | undefined;
  /** The group's AIs, for the AIs row; `undefined` when not loaded. */
  aisCount: number | undefined;
  /** The group chat's pins, for the Pinned messages row; `undefined` when not loaded. */
  pinsCount: number | undefined;
  /** The group's always-allowed rules; `undefined` when not loaded. */
  allowedCount: number | undefined;
  /** The group's topic rows, for the Your/Other topics lists (T-1787). */
  topics: readonly ChatSummary[];
  /** The signed-in user's id, for the joined split and the subtitle names. */
  currentUserId: string;
  /** The group's people and AIs, for the subtitle names, the stacks and seeds. */
  groupMembers: readonly GroupMember[];
  groupAis: readonly GroupAi[];
  isManager: boolean;
  isOwner: boolean;
  onBack: () => void;
  onSearch: () => void;
  onAdd: () => void;
  onMore: () => void;
  onOpenMembers: () => void;
  onOpenAis: () => void;
  onOpenLinks: () => void;
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

/**
 * The group info root page (T-1552), after `Phone.dc.html`: a back key, the
 * group picture, name and combined member count, the four keys, the People,
 * Content and Settings rows, and the red Leave group row for non-owners. Thin
 * view: the route mounts the sheets and owns the writes. T-1569 adds the AIs
 * row and disables the keys until the group's own chat row is loaded; T-1573
 * adds the Content group (Shared media, Pinned messages, Tools and routines,
 * and Activity and Always allowed for managers); T-1574 shows the Settings row
 * to managers, like web.
 */
export function GroupInfoRoot({
  groupChatId,
  chatReady,
  title,
  memberCount,
  peopleCount,
  aisCount,
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
  onOpenAis,
  onOpenLinks,
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
          <InfoRowGroup>
            <InfoRow icon={Users} label="Members" count={peopleCount} onPress={onOpenMembers} />
            <InfoRow icon={Bot} label="AIs" count={aisCount} onPress={onOpenAis} />
            {isManager ? <InfoRow icon={Link2} label="Invite links" onPress={onOpenLinks} /> : null}
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
