import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Link2, Plus, Search } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, Share, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { Avatar } from '@/components/chat/avatar';
import { InviteLinksSheet, type CreateInviteLinkForm } from '@/components/chat/invite-links-sheet';
import { NewTopicSheet, type NewTopicInput } from '@/components/chat/new-topic-sheet';
import { TopicActionsSheet, type TopicSheetAction } from '@/components/chat/topic-sheets';
import { TopicRow } from '@/components/chat/topic-row';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { well } from '@/lib/depth';
import type { GroupInviteLink } from '@/lib/invite-links-api';
import { mayArchiveTopic, mayCreateTopic, topicsHeaderSubtitle, topicsOfGroup } from '@/lib/topics';
import type { ChatSummary } from '@/lib/types';
import { useChatStore } from '@/store/chat-store-provider';

export default function GroupTopicsScreen() {
  return (
    <RequireAuth>
      <GroupTopics />
    </RequireAuth>
  );
}

function GroupTopics() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const groupId = typeof params.id === 'string' ? params.id : '';
  const scheme = asColorScheme(useColorScheme().colorScheme);

  const chats = useChatStore((state) => state.chats);
  const chatsLoad = useChatStore((state) => state.chatsLoad);
  const groupDetail = useChatStore((state) => state.groupDetail(groupId));
  const refreshGroupDetail = useChatStore((state) => state.refreshGroupDetail);
  const ownedAis = useChatStore((state) => state.ownedAis);
  const currentUserId = useChatStore((state) => state.currentUserId);
  const listInviteLinks = useChatStore((state) => state.listInviteLinks);
  const createInviteLink = useChatStore((state) => state.createInviteLink);
  const revokeInviteLink = useChatStore((state) => state.revokeInviteLink);
  const createTopic = useChatStore((state) => state.createTopic);
  const addTopicAi = useChatStore((state) => state.addTopicAi);
  const [linksOpen, setLinksOpen] = useState(false);
  const [links, setLinks] = useState<GroupInviteLink[]>([]);
  const [linksBusy, setLinksBusy] = useState(false);
  const [linksError, setLinksError] = useState('');
  const [createdUrl, setCreatedUrl] = useState<string | undefined>(undefined);
  const [revokingId, setRevokingId] = useState<string | undefined>(undefined);
  const archiveTopic = useChatStore((state) => state.archiveTopic);
  const muteChat = useChatStore((state) => state.muteChat);
  const topicNotice = useChatStore((state) => state.topicNotice);
  const dismissTopicNotice = useChatStore((state) => state.dismissTopicNotice);

  const [search, setSearch] = useState('');
  const [sheetFor, setSheetFor] = useState<ChatSummary | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerBusy, setComposerBusy] = useState(false);
  const [composerError, setComposerError] = useState('');
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState('');
  const [composerAiError, setComposerAiError] = useState('');

  // The detail is keyed by group id (not chat id): load it on mount so the
  // member list, the "+" gate and the AI count resolve even on first visit.
  useEffect(() => {
    if (groupId !== '') {
      refreshGroupDetail(groupId);
    }
  }, [groupId, refreshGroupDetail]);

  const topics = useMemo(() => topicsOfGroup(chats, groupId), [chats, groupId]);
  const general = topics.find((topic) => topic.topic?.isGeneral === true);
  const groupTitle = general?.groupTitle ?? general?.title ?? 'Group';
  const groupChatId = general?.id ?? topics[0]?.id ?? groupId;

  const query = search.trim().toLowerCase();
  const visible =
    query === '' ? topics : topics.filter((topic) => topic.title.toLowerCase().includes(query));

  const members = useMemo(() => groupDetail?.members ?? [], [groupDetail]);
  const groupAis = useMemo(() => groupDetail?.ais ?? [], [groupDetail]);
  const myAisInGroup = useMemo(
    () => groupAis.filter((ai) => ownedAis.some((owned) => owned.id === ai.aiId)),
    [groupAis, ownedAis],
  );
  const canManageLinks = useMemo(
    () =>
      members.some(
        (member) =>
          member.userId === currentUserId && (member.role === 'owner' || member.role === 'admin'),
      ),
    [members, currentUserId],
  );
  const canCreate = mayCreateTopic({
    members,
    meUserId: currentUserId,
    membersCanCreateTopics: groupDetail?.membersCanCreateTopics === true,
  });
  const notice =
    topicNotice !== undefined && topicNotice.groupId === groupId ? topicNotice.message : undefined;

  // Invite links (T-0136): owner/admin only, like the web panel. The list
  // loads when the sheet opens; the created URL is kept only until
  // dismissed, never stored.
  const reloadLinks = async (): Promise<void> => {
    setLinksError('');
    try {
      setLinks(await listInviteLinks(groupId));
    } catch {
      setLinksError('Could not load invite links. Try again.');
    }
  };

  const openLinks = () => {
    setLinksError('');
    setCreatedUrl(undefined);
    setRevokingId(undefined);
    setLinksOpen(true);
    void reloadLinks();
  };

  const createLink = (input: CreateInviteLinkForm) => {
    setLinksBusy(true);
    setLinksError('');
    void createInviteLink(groupId, input)
      .then((created) => {
        setCreatedUrl(created.url);
        return reloadLinks();
      })
      .catch(() => setLinksError('Could not create the invite link. Try again.'))
      .finally(() => setLinksBusy(false));
  };

  const revokeLink = (linkId: string) => {
    setRevokingId(linkId);
    setLinksError('');
    void revokeInviteLink(groupId, linkId)
      .then(() => reloadLinks())
      .catch(() => setLinksError('Could not revoke the invite link. Try again.'))
      .finally(() => setRevokingId(undefined));
  };

  // The clipboard/share bridge for the shown-once block: `expo-clipboard`
  // and React Native's `Share` cannot run in Node tests, so the sheet takes
  // callbacks and this screen wires the real modules at the edge.
  const linksShare = useMemo(
    () => ({
      copyText: (text: string) => Clipboard.setStringAsync(text).then(() => {}),
      shareText: async (text: string): Promise<void> => {
        await Share.share({ message: text });
      },
    }),
    [],
  );

  const openTopic = (chat: ChatSummary) => {
    dismissTopicNotice();
    router.push({ pathname: '/chat/[id]', params: { id: chat.id } });
  };

  const runSheetAction = (action: TopicSheetAction) => {
    const chat = sheetFor;
    if (chat === null) {
      return;
    }
    if (action === 'mute') {
      muteChat(chat.id, !chat.muted);
      setSheetFor(null);
      return;
    }
    setSheetBusy(true);
    setSheetError('');
    void archiveTopic(chat.id)
      .then(() => setSheetFor(null))
      .catch(() => setSheetError('Could not archive the topic. Try again.'))
      .finally(() => setSheetBusy(false));
  };

  // Creates the topic, then adds one AI per tick. The sheet stays open
  // until the topic exists: a `createTopic` failure shows its error in the
  // open sheet, and a failed AI add names the AI (the topic still exists, so
  // the user lands in it and can retry from the topic panel).
  const create = (input: NewTopicInput) => {
    setComposerBusy(true);
    setComposerError('');
    setComposerAiError('');
    const aiNames = new Map(myAisInGroup.map((ai) => [ai.aiId, ai.name]));
    void createTopic(groupChatId, {
      name: input.name,
      kind: input.kind,
      visibility: input.visibility,
      ...(input.memberIds === undefined ? {} : { memberIds: input.memberIds }),
    })
      .then(async (chatId) => {
        const failed: string[] = [];
        for (const aiId of input.aiIds) {
          try {
            await addTopicAi(chatId, aiId);
          } catch {
            failed.push(aiNames.get(aiId) ?? 'An AI');
          }
        }
        setComposerOpen(false);
        if (failed.length > 0) {
          setComposerAiError(
            `Topic created, but could not add: ${failed.join(', ')}. Add them from the topic panel.`,
          );
        }
        router.push({ pathname: '/chat/[id]', params: { id: chatId } });
      })
      .catch(() => setComposerError('Could not create the topic. Try again.'))
      .finally(() => setComposerBusy(false));
  };

  if (topics.length === 0 && chatsLoad === 'loaded') {
    router.back();
    return null;
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center gap-1 border-b border-divider bg-surface px-1 py-1">
        <IconButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={24} color={ICON[scheme]} />
        </IconButton>
        <Avatar id={groupChatId} name={groupTitle} size={36} />
        <View className="ml-2.5 min-w-0 flex-1">
          <Text numberOfLines={1} className="shrink text-[15px] font-semibold text-foreground">
            {groupTitle}
          </Text>
          <Text numberOfLines={1} className="shrink text-[12px] text-muted-foreground">
            {topicsHeaderSubtitle({
              memberCount: general?.memberCount ?? members.length,
              aiCount: groupAis.length,
              topicCount: topics.length,
            })}
          </Text>
        </View>
        {canManageLinks ? (
          <IconButton label="Invite links" onPress={openLinks}>
            <Link2 size={20} color={ICON[scheme]} />
          </IconButton>
        ) : null}
      </View>

      {notice !== undefined ? (
        <View className="border-b border-divider bg-surface px-4 py-2">
          <Text className="text-center text-[13px] text-muted-foreground">{notice}</Text>
        </View>
      ) : null}
      {composerAiError !== '' ? (
        <View className="border-b border-divider bg-surface px-4 py-2">
          <Text className="text-center text-[13px] text-danger">{composerAiError}</Text>
        </View>
      ) : null}

      <View className="flex-row items-center gap-2 px-4 py-2">
        <View className="h-10 flex-1 flex-row items-center gap-2 rounded-xl px-3" style={well}>
          <Search size={16} color="#8a8a8a" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search topics"
            placeholderTextColor={MUTED_FOREGROUND[scheme]}
            accessibilityLabel="Search topics"
            className="flex-1 text-[15px] text-foreground"
          />
        </View>
      </View>

      <FlatList
        className="flex-1"
        data={visible}
        keyExtractor={(chat) => chat.id}
        contentContainerStyle={{ paddingBottom: 96 }}
        renderItem={({ item }) => (
          <TopicRow
            chat={item}
            onPress={() => openTopic(item)}
            onLongPress={() => {
              setSheetError('');
              setSheetFor(item);
            }}
          />
        )}
        ListEmptyComponent={
          <View className="items-center px-6 pt-16">
            <Text className="text-[15px] text-muted-foreground">No topics found</Text>
          </View>
        }
      />

      {canCreate ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New topic"
          onPress={() => {
            setComposerError('');
            setComposerAiError('');
            setComposerOpen(true);
          }}
          className="absolute bottom-6 right-5 h-14 w-14 items-center justify-center rounded-[18px] bg-accent active:opacity-90"
        >
          <Plus size={24} color="#0a0a0a" />
        </Pressable>
      ) : null}

      <TopicActionsSheet
        chat={sheetFor}
        canArchive={
          sheetFor !== null &&
          mayArchiveTopic(
            {
              members,
              meUserId: currentUserId,
              membersCanCreateTopics: groupDetail?.membersCanCreateTopics === true,
            },
            sheetFor.topic,
          )
        }
        onAction={runSheetAction}
        onClose={() => {
          if (!sheetBusy) {
            setSheetFor(null);
          }
        }}
      />
      {sheetError !== '' ? (
        <View className="absolute bottom-24 left-4 right-4 rounded-[10px] bg-danger/20 px-3 py-2">
          <Text className="text-center text-[13px] text-danger">{sheetError}</Text>
        </View>
      ) : null}

      <NewTopicSheet
        visible={composerOpen}
        groupTitle={groupTitle}
        members={members}
        myAis={myAisInGroup}
        meUserId={currentUserId}
        busy={composerBusy}
        error={composerError}
        onCreate={create}
        onClose={() => {
          if (!composerBusy) {
            setComposerOpen(false);
          }
        }}
      />
      <InviteLinksSheet
        visible={linksOpen}
        links={links}
        busy={linksBusy}
        error={linksError}
        createdUrl={createdUrl}
        revokingId={revokingId}
        share={linksShare}
        onCreate={createLink}
        onRevoke={revokeLink}
        onDismissCreated={() => setCreatedUrl(undefined)}
        onClose={() => {
          if (!linksBusy) {
            setLinksOpen(false);
          }
        }}
      />
    </SafeAreaView>
  );
}
