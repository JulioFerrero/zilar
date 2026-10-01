import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { ChatBackground } from '@/components/chat/chat-background';
import { ChannelComposerBar } from '@/components/chat/channel-composer-bar';
import { ChatHeader } from '@/components/chat/chat-header';
import { Composer } from '@/components/chat/composer';
import { MessageList } from '@/components/chat/message-list';
import { MessageListSkeleton } from '@/components/chat/skeleton';
import { PinnedBanner } from '@/components/chat/pinned-banner';
import { PinsSheet } from '@/components/chat/pins-sheet';
import { TaskStrip } from '@/components/chat/task-strip';
import { TopicInfoSheet } from '@/components/chat/topic-sheets';
import { Text } from '@/components/ui/text';
import { replyRef } from '@/lib/format';
import { attachedRoleIds, describeRolesError, mayManageRoles } from '@/lib/roles';
import { httpsTopicUrl, mayArchiveTopic } from '@/lib/topics';
import type { BannerPin } from '@/components/chat/pinned-banner';
import type { SheetPin } from '@/components/chat/pins-sheet';
import type { TopicStatus } from '@/lib/topics-api';
import type { ReplyRef, UiMessage } from '@/lib/types';
import { mockDemoStickerPacks } from '@/mock/stickers';
import { useChatStore } from '@/store/chat-store-provider';

export default function ChatScreen() {
  return (
    <RequireAuth>
      <Chat />
    </RequireAuth>
  );
}

function Chat() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; notFound?: string }>();
  const chatId = typeof params.id === 'string' ? params.id : '';
  const chat = useChatStore((state) => state.chats.find((item) => item.id === chatId));
  const chatsLoad = useChatStore((state) => state.chatsLoad);
  const openChat = useChatStore((state) => state.openChat);
  const sendText = useChatStore((state) => state.sendText);
  const sendSticker = useChatStore((state) => state.sendSticker);
  const retrySticker = useChatStore((state) => state.retrySticker);
  const sendTyping = useChatStore((state) => state.sendTyping);
  const react = useChatStore((state) => state.react);
  const startEdit = useChatStore((state) => state.startEdit);
  const deleteForEveryone = useChatStore((state) => state.deleteForEveryone);
  const pinMessage = useChatStore((state) => state.pinMessage);
  const unpinMessage = useChatStore((state) => state.unpinMessage);
  const canPinChat = useChatStore((state) => state.canPin(chatId));
  const pinFor = useChatStore((state) => state.pinFor);
  const pins = useChatStore((state) => state.pins(chatId));
  const pinsError = useChatStore((state) =>
    state.pinsError?.chatId === chatId ? state.pinsError.message : undefined,
  );
  // One memoized ids array for the message list: a pins publish with
  // unchanged membership keeps the reference, so the list does not
  // re-render on every 60 s tick or unrelated pins change.
  const pinnedIds = useMemo(() => pins.map((pin) => pin.messageId), [pins]);
  const dismissPinsError = useChatStore((state) => state.dismissPinsError);
  const loadedMessages = useChatStore((state) => state.messagesByChat[chatId]);
  const loadedMessageIds = useMemo(
    () => loadedMessages?.map((message) => message.id),
    [loadedMessages],
  );
  const actionError = useChatStore((state) =>
    state.actionError?.chatId === chatId ? state.actionError : undefined,
  );
  const dismissActionError = useChatStore((state) => state.dismissActionError);
  const cancelEdit = useChatStore((state) => state.cancelEdit);
  const currentUserId = useChatStore((state) => state.currentUserId);
  const patchTopic = useChatStore((state) => state.patchTopic);
  const removeTopicMember = useChatStore((state) => state.removeTopicMember);
  const listTopicMembers = useChatStore((state) => state.listTopicMembers);
  const listTopicAis = useChatStore((state) => state.listTopicAis);
  const setTopicRoles = useChatStore((state) => state.setTopicRoles);
  const topicRoles = useChatStore((state) => state.topicRoles(chatId));
  const refreshTopicRoles = useChatStore((state) => state.refreshTopicRoles);
  const chatGroupId = useChatStore(
    (state) => state.chats.find((item) => item.id === chatId)?.groupId,
  );
  const groupDetail = useChatStore((state) => state.groupDetail(chatGroupId ?? ''));
  // Mount loads the detail only when nothing fresh is cached: the cached
  // path dedupes in-flight loads too, so opening the chat and the group
  // screen costs one GET, not one per mount (T-0139). Explicit refreshes
  // after a write still force through `refreshGroupDetail`.
  const ensureGroupDetail = useChatStore((state) => state.ensureGroupDetail);
  const groupRoles = useChatStore((state) => state.groupRoles(chatGroupId ?? ''));
  const refreshGroupRoles = useChatStore((state) => state.refreshGroupRoles);
  const me = useChatStore((state) => state.me);
  const topicNotice = useChatStore((state) => state.topicNotice);
  const [replyTo, setReplyTo] = useState<ReplyRef | undefined>(undefined);
  // A search jump that gave up ("Message not found") lands here with
  // `?notFound=1`: the chat opens at its bottom with a short inline notice.
  // Local state, dismissed once, so going back and re-entering clears it.
  const [jumpMissed, setJumpMissed] = useState(params.notFound === '1');
  const [statusOpen, setStatusOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [stripError, setStripError] = useState('');
  const [pinsOpen, setPinsOpen] = useState(false);
  const [pinIndex, setPinIndex] = useState(0);
  const [jumpToMessageId, setJumpToMessageId] = useState<string | undefined>(undefined);
  const [jumpError, setJumpError] = useState('');
  const [pinError, setPinError] = useState('');
  const [unpinningId, setUnpinningId] = useState<string | null>(null);
  const [pinsSheetError, setPinsSheetError] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoMembers, setInfoMembers] = useState<{ userId: string; name: string }[]>([]);
  const [infoAis, setInfoAis] = useState<{ id: string; name: string }[]>([]);
  const [infoBusy, setInfoBusy] = useState(false);
  const [infoError, setInfoError] = useState('');
  const [infoRolesError, setInfoRolesError] = useState('');
  const [infoGroupRolesError, setInfoGroupRolesError] = useState('');
  // Demo packs in mock mode, so the sticker panel works without a server
  // (real mode loads the user's packs from the API instead).
  const demoPacks = useMemo(
    () =>
      process.env.NODE_ENV === 'test' || process.env.EXPO_PUBLIC_GALENA_MOCK === '1'
        ? mockDemoStickerPacks()
        : undefined,
    [],
  );

  useEffect(() => {
    if (chatId) {
      openChat(chatId);
    }
  }, [chatId, openChat]);

  // Leaving the chat stops its 60 s pins poll. `openChat` of another chat
  // stops it too; this effect only covers the leave/unmount case. The
  // effect stays above the `!chat` return, like the redirect effect below.
  const stopPinsPoll = useChatStore((state) => state.stopPinsPoll);
  useEffect(() => {
    return () => {
      stopPinsPoll();
    };
  }, [stopPinsPoll]);

  // An edit belongs to one chat: leaving it (or switching chats) drops the
  // edit mode so the composer of another chat never shows a stale edit bar.
  useEffect(() => {
    return () => {
      cancelEdit();
    };
  }, [chatId, cancelEdit]);

  // The manager bit (archive gate, role controls) and the owner picker read
  // the group detail, so load it for the topic's group: opening a topic
  // directly (deep link) must not demote a manager to a silent read-only
  // view. A load failure keeps the read-only view with a neutral notice in
  // the info sheet.
  const detailGroupId = chat?.groupId ?? chatGroupId;
  useEffect(() => {
    if (detailGroupId !== undefined && detailGroupId !== '') {
      ensureGroupDetail(detailGroupId);
    }
  }, [detailGroupId, ensureGroupDetail]);

  // A topic that disappears while open goes back to the topics screen with a
  // short notice that never names the topic (the store sets it on refresh).
  // The effect lives above the `!chat` early return on purpose: every hook
  // runs on every render, whether or not the chat has loaded yet.
  const redirectGroupId =
    chat?.topic !== undefined && topicNotice !== undefined && chat.groupId === topicNotice.groupId
      ? topicNotice.groupId
      : undefined;
  useEffect(() => {
    if (redirectGroupId !== undefined) {
      router.replace({ pathname: '/group/[id]', params: { id: redirectGroupId } });
    }
  }, [redirectGroupId, router]);

  if (!chat) {
    // The chats are still arriving: this is a loading state, not "not found".
    if (chatsLoad === 'loading') {
      return (
        <SafeAreaView className="flex-1 bg-background" edges={['top']}>
          <ChatBackground />
          <MessageListSkeleton />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background" edges={['top']}>
        <Text className="text-[15px] text-muted-foreground">Chat not found</Text>
      </SafeAreaView>
    );
  }

  const startReply = (message: UiMessage) => setReplyTo(replyRef(message, currentUserId));
  const cancelReply = () => setReplyTo(undefined);

  const jumpToPin = (pin: BannerPin | SheetPin) => {
    const messageId = pin.messageId;
    if ((loadedMessageIds ?? []).includes(messageId)) {
      setJumpError('');
      setJumpToMessageId(messageId);
      return;
    }
    // No history paging on mobile yet (no `openAtMessage` seam): say so.
    setJumpError('Message not found');
  };

  const sheetUnpin = (pin: SheetPin) => {
    setUnpinningId(pin.id);
    setPinsSheetError('');
    void unpinMessage(chatId, pin.id)
      .catch(() => setPinsSheetError('Could not unpin. Try again.'))
      .finally(() => setUnpinningId(null));
  };

  const pin = (message: UiMessage) => {
    setPinError('');
    void pinMessage(chatId, message.id).catch(() =>
      setPinError('Could not pin the message. Try again.'),
    );
  };

  const unpin = (message: UiMessage) => {
    const pinRow = pinFor(chatId, message.id);
    if (pinRow === undefined) {
      return;
    }
    setPinError('');
    const pinId = pinRow.id;
    void unpinMessage(chatId, pinId).catch(() =>
      setPinError('Could not unpin the message. Try again.'),
    );
  };

  const isTopic = chat.topic !== undefined;
  const groupName = chat.groupTitle ?? '';
  const detail = groupDetail;
  const detailLoaded = detail !== undefined;
  const myUserId = me?.id ?? currentUserId;
  const permissions = {
    members:
      detail?.members.map((member) => ({
        userId: member.userId,
        name: member.name,
        role: member.role,
      })) ?? [],
    meUserId: myUserId,
    membersCanCreateTopics: detail?.membersCanCreateTopics === true,
  };
  const canArchiveInfo = mayArchiveTopic(permissions, chat.topic);
  const isPrivateMember =
    chat.topic?.visibility !== 'private' ||
    infoMembers.some((member) => member.userId === myUserId);
  const ownerCandidates = [
    ...(detail?.members.map((member) => ({
      kind: 'user' as const,
      id: member.userId,
      name: member.name,
    })) ?? []),
    ...infoAis.map((ai) => ({ kind: 'ai' as const, id: ai.id, name: ai.name })),
  ];

  const patch = async (input: Parameters<typeof patchTopic>[1]): Promise<void> => {
    setStripError('');
    try {
      await patchTopic(chat.id, input);
    } catch {
      // The row keeps its server state (the store only applies the patch on
      // success), so a failure needs no rollback, just the inline error.
      setStripError('Could not save. Try again.');
    }
  };

  const chooseStatus = (next: TopicStatus): void => {
    setStatusOpen(false);
    if (next === chat.topic?.status) {
      return;
    }
    void patch({ status: next });
  };

  const refreshInfoRoles = () => {
    setInfoRolesError('');
    setInfoGroupRolesError('');
    // Loads map a 404 to "no longer available" (refreshable) and never show
    // raw server messages; a 403 stays the neutral denied line.
    void refreshTopicRoles(chat.id).catch((error: unknown) =>
      setInfoRolesError(describeRolesError(error, 'load')),
    );
    if (chatGroupId !== undefined) {
      void refreshGroupRoles(chatGroupId).catch((error: unknown) =>
        setInfoGroupRolesError(describeRolesError(error, 'load')),
      );
    }
  };

  const openInfo = () => {
    setInfoError('');
    setInfoOpen(true);
    void listTopicMembers(chat.id)
      .then(setInfoMembers)
      .catch(() => setInfoMembers([]));
    void listTopicAis(chat.id)
      .then(setInfoAis)
      .catch(() => setInfoAis([]));
    // The access picker reads the attached roles fresh.
    refreshInfoRoles();
  };

  const saveTopicRoles = (roleIds: string[], approverRoleId: string | null): void => {
    setInfoRolesError('');
    // Writes map 403 and 404 to the neutral denied line (the server answers
    // the same 404 for unknown and hidden ids); nothing raw reaches the UI.
    void setTopicRoles(chat.id, { roleIds, approverRoleId }).catch((error: unknown) =>
      setInfoRolesError(describeRolesError(error, 'write')),
    );
  };

  const toggleTopicRole = (roleId: string): void => {
    const attached = topicRoles?.roles ?? [];
    const next = attached.some((role) => role.id === roleId)
      ? attached.filter((role) => role.id !== roleId).map((role) => role.id)
      : [...attached.map((role) => role.id), roleId];
    saveTopicRoles(next, topicRoles?.approverRole?.id ?? null);
  };

  if (!isTopic) {
    return (
      <View className="flex-1 bg-background">
        <ChatBackground />
        <SafeAreaView edges={['top']} className="bg-surface">
          <ChatHeader
            chat={chat}
            onBack={() => router.back()}
            onSearchInChat={() => router.push({ pathname: '/', params: { searchChat: chat.id } })}
            onOpenGroup={
              chat.groupId === undefined
                ? undefined
                : (groupId: string) =>
                    router.push({ pathname: '/group/[id]', params: { id: groupId } })
            }
          />
        </SafeAreaView>
        <PinnedBanner
          pins={pins}
          pinsError={pinsError}
          index={Math.min(pinIndex, Math.max(pins.length - 1, 0))}
          jumpError={jumpError}
          onCycle={() => {
            setJumpError('');
            setPinIndex((value) => (pins.length === 0 ? 0 : (value + 1) % pins.length));
          }}
          onTapPin={jumpToPin}
          onOpenList={() => setPinsOpen(true)}
          onDismissError={() => dismissPinsError()}
        />
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <MessageList
            chat={chat}
            onReply={startReply}
            onReact={(message, emoji) => react(chat.id, message.id, emoji)}
            onEdit={(message) => startEdit(chat.id, message.id)}
            onDelete={(message) => deleteForEveryone(chat.id, message.id)}
            onPin={pin}
            onUnpin={unpin}
            pinnedIds={pinnedIds}
            jumpToMessageId={jumpToMessageId}
            onJumped={() => setJumpToMessageId(undefined)}
            onRetrySticker={(message) => retrySticker(chat.id, message.id)}
          />
          {pinError !== '' ? (
            <View className="mx-2 flex-row items-center justify-between rounded-[10px] bg-danger/20 px-3 py-2">
              <Text className="flex-1 text-[13px] text-danger">{pinError}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss error"
                onPress={() => setPinError('')}
                className="ml-2 rounded px-2 py-1 active:bg-surface-raised"
              >
                <Text className="text-[13px] font-semibold text-danger">Dismiss</Text>
              </Pressable>
            </View>
          ) : null}
          {actionError !== undefined ? (
            <View className="mx-2 flex-row items-center justify-between rounded-[10px] bg-danger/20 px-3 py-2">
              <Text className="flex-1 text-[13px] text-danger">{actionError.message}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss error"
                onPress={() => dismissActionError()}
                className="ml-2 rounded px-2 py-1 active:bg-surface-raised"
              >
                <Text className="text-[13px] font-semibold text-danger">Dismiss</Text>
              </Pressable>
            </View>
          ) : null}
          {jumpMissed ? (
            <View className="mx-2 flex-row items-center justify-between rounded-[10px] bg-surface-raised px-3 py-2">
              <Text className="flex-1 text-[13px] text-muted-foreground">Message not found</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss notice"
                onPress={() => setJumpMissed(false)}
                className="ml-2 rounded px-2 py-1 active:bg-surface-raised"
              >
                <Text className="text-[13px] font-semibold text-muted-foreground">Dismiss</Text>
              </Pressable>
            </View>
          ) : null}
          <ChannelComposerBar
            chat={chat}
            groupId={chat.groupId}
            onSend={(text) => {
              sendText(chat.id, text, replyTo === undefined ? undefined : { replyTo });
              cancelReply();
            }}
            onSendSticker={(sticker) => {
              sendSticker(chat.id, sticker, replyTo === undefined ? undefined : { replyTo });
              cancelReply();
            }}
            replyTo={replyTo}
            onCancelReply={cancelReply}
            onTyping={() => sendTyping(chat.id)}
            demoPacks={demoPacks}
          />
        </KeyboardAvoidingView>
        <PinsSheet
          open={pinsOpen}
          pins={pins}
          canUnpin={canPinChat}
          unpinningId={unpinningId}
          error={pinsSheetError}
          onUnpin={sheetUnpin}
          onJump={jumpToPin}
          onClose={() => setPinsOpen(false)}
        />
      </View>
    );
  }

  // T-0144: a channel feed opens like any topic row (the feed IS the General
  // topic); only the bottom bar differs (read-only for subscribers).
  if (!isTopic || chat.chatKind === 'channel') {
    const channelBar = chat.chatKind === 'channel';
    return (
      <View className="flex-1 bg-background">
        <ChatBackground />
        <SafeAreaView edges={['top']} className="bg-surface">
          <ChatHeader
            chat={chat}
            onBack={() => router.back()}
            onSearchInChat={() => router.push({ pathname: '/', params: { searchChat: chat.id } })}
            onOpenGroup={
              chat.groupId === undefined
                ? undefined
                : (groupId: string) =>
                    router.push({ pathname: '/group/[id]', params: { id: groupId } })
            }
          />
        </SafeAreaView>
        <PinnedBanner
          pins={pins}
          pinsError={pinsError}
          index={Math.min(pinIndex, Math.max(pins.length - 1, 0))}
          jumpError={jumpError}
          onCycle={() => {
            setJumpError('');
            setPinIndex((value) => (pins.length === 0 ? 0 : (value + 1) % pins.length));
          }}
          onTapPin={jumpToPin}
          onOpenList={() => setPinsOpen(true)}
          onDismissError={() => dismissPinsError()}
        />
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <MessageList
            chat={chat}
            onReply={startReply}
            onReact={(message, emoji) => react(chat.id, message.id, emoji)}
            onEdit={(message) => startEdit(chat.id, message.id)}
            onDelete={(message) => deleteForEveryone(chat.id, message.id)}
            onPin={pin}
            onUnpin={unpin}
            pinnedIds={pinnedIds}
            jumpToMessageId={jumpToMessageId}
            onJumped={() => setJumpToMessageId(undefined)}
          />
          {pinError !== '' ? (
            <View className="mx-2 flex-row items-center justify-between rounded-[10px] bg-danger/20 px-3 py-2">
              <Text className="flex-1 text-[13px] text-danger">{pinError}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss error"
                onPress={() => setPinError('')}
                className="ml-2 rounded px-2 py-1 active:bg-surface-raised"
              >
                <Text className="text-[13px] font-semibold text-danger">Dismiss</Text>
              </Pressable>
            </View>
          ) : null}
          {actionError !== undefined ? (
            <View className="mx-2 flex-row items-center justify-between rounded-[10px] bg-danger/20 px-3 py-2">
              <Text className="flex-1 text-[13px] text-danger">{actionError.message}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss error"
                onPress={() => dismissActionError()}
                className="ml-2 rounded px-2 py-1 active:bg-surface-raised"
              >
                <Text className="text-[13px] font-semibold text-danger">Dismiss</Text>
              </Pressable>
            </View>
          ) : null}
          {jumpMissed ? (
            <View className="mx-2 flex-row items-center justify-between rounded-[10px] bg-surface-raised px-3 py-2">
              <Text className="flex-1 text-[13px] text-muted-foreground">Message not found</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss notice"
                onPress={() => setJumpMissed(false)}
                className="ml-2 rounded px-2 py-1 active:bg-surface-raised"
              >
                <Text className="text-[13px] font-semibold text-muted-foreground">Dismiss</Text>
              </Pressable>
            </View>
          ) : null}
          {channelBar ? (
            <ChannelComposerBar
              chat={chat}
              groupId={chat.groupId}
              onSend={(text) => {
                sendText(chat.id, text, replyTo === undefined ? undefined : { replyTo });
                cancelReply();
              }}
              onSendSticker={(sticker) => {
                sendSticker(chat.id, sticker, replyTo === undefined ? undefined : { replyTo });
                cancelReply();
              }}
              replyTo={replyTo}
              onCancelReply={cancelReply}
              onTyping={() => sendTyping(chat.id)}
              demoPacks={demoPacks}
            />
          ) : (
            <Composer
              title={chat.title}
              onSend={(text) => {
                sendText(chat.id, text, replyTo === undefined ? undefined : { replyTo });
                cancelReply();
              }}
              onSendSticker={(sticker) => {
                sendSticker(chat.id, sticker, replyTo === undefined ? undefined : { replyTo });
                cancelReply();
              }}
              replyTo={replyTo}
              onCancelReply={cancelReply}
              onTyping={() => sendTyping(chat.id)}
              demoPacks={demoPacks}
            />
          )}
        </KeyboardAvoidingView>
        <PinsSheet
          open={pinsOpen}
          pins={pins}
          canUnpin={canPinChat}
          unpinningId={unpinningId}
          error={pinsSheetError}
          onUnpin={sheetUnpin}
          onJump={jumpToPin}
          onClose={() => setPinsOpen(false)}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ChatBackground />
      <SafeAreaView edges={['top']} className="bg-surface">
        <ChatHeader
          chat={chat}
          onBack={() => router.back()}
          onSearchInChat={() => router.push({ pathname: '/', params: { searchChat: chat.id } })}
          topicGroupName={groupName}
          onOpenInfo={openInfo}
          onOpenGroup={
            chat.groupId === undefined
              ? undefined
              : (groupId: string) =>
                  router.push({ pathname: '/group/[id]', params: { id: groupId } })
          }
        />
      </SafeAreaView>
      <TaskStrip
        chat={chat}
        statusOpen={statusOpen}
        onToggleStatus={() => {
          setStatusOpen((value) => !value);
          setOwnerOpen(false);
          setLinkOpen(false);
        }}
        onChooseStatus={chooseStatus}
        ownerOpen={ownerOpen}
        onToggleOwner={() => {
          setOwnerOpen((value) => !value);
          setStatusOpen(false);
          setLinkOpen(false);
        }}
        onChooseOwner={(owner) => {
          setOwnerOpen(false);
          const current = chat.topic?.owner;
          const same =
            (owner === null && current === null) ||
            (owner !== null &&
              current !== null &&
              current !== undefined &&
              owner.kind === current.kind &&
              owner.id === current.id);
          if (same) {
            return;
          }
          void patch({ owner: owner === null ? null : { kind: owner.kind, id: owner.id } });
        }}
        ownerCandidates={ownerCandidates}
        linkOpen={linkOpen}
        onToggleLink={() => {
          setLinkUrl(chat.topic?.linkUrl ?? '');
          setLinkLabel(chat.topic?.linkLabel ?? '');
          setLinkOpen((value) => !value);
          setStatusOpen(false);
          setOwnerOpen(false);
        }}
        linkUrl={linkUrl}
        linkLabel={linkLabel}
        onChangeLinkUrl={setLinkUrl}
        onChangeLinkLabel={setLinkLabel}
        onSaveLink={() => {
          const trimmed = linkUrl.trim();
          if (trimmed !== '' && httpsTopicUrl(trimmed) === undefined) {
            setStripError('Link must be an https URL.');
            return;
          }
          setLinkOpen(false);
          const nextUrl = trimmed === '' ? null : trimmed;
          const nextLabel = linkLabel.trim() === '' ? null : linkLabel.trim().slice(0, 40);
          void patch({ linkUrl: nextUrl, linkLabel: nextLabel });
        }}
        error={stripError}
      />
      <PinnedBanner
        pins={pins}
        pinsError={pinsError}
        index={Math.min(pinIndex, Math.max(pins.length - 1, 0))}
        jumpError={jumpError}
        onCycle={() => {
          setJumpError('');
          setPinIndex((value) => (pins.length === 0 ? 0 : (value + 1) % pins.length));
        }}
        onTapPin={jumpToPin}
        onOpenList={() => setPinsOpen(true)}
        onDismissError={() => dismissPinsError()}
      />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <MessageList
          chat={chat}
          onReply={startReply}
          onReact={(message, emoji) => react(chat.id, message.id, emoji)}
          onEdit={(message) => startEdit(chat.id, message.id)}
          onDelete={(message) => deleteForEveryone(chat.id, message.id)}
          onPin={pin}
          onUnpin={unpin}
          pinnedIds={pinnedIds}
          jumpToMessageId={jumpToMessageId}
          onJumped={() => setJumpToMessageId(undefined)}
          onRetrySticker={(message) => retrySticker(chat.id, message.id)}
        />
        {pinError !== '' ? (
          <View className="mx-2 flex-row items-center justify-between rounded-[10px] bg-danger/20 px-3 py-2">
            <Text className="flex-1 text-[13px] text-danger">{pinError}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss error"
              onPress={() => setPinError('')}
              className="ml-2 rounded px-2 py-1 active:bg-surface-raised"
            >
              <Text className="text-[13px] font-semibold text-danger">Dismiss</Text>
            </Pressable>
          </View>
        ) : null}
        {actionError !== undefined ? (
          <View className="mx-2 flex-row items-center justify-between rounded-[10px] bg-danger/20 px-3 py-2">
            <Text className="flex-1 text-[13px] text-danger">{actionError.message}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss error"
              onPress={() => dismissActionError()}
              className="ml-2 rounded px-2 py-1 active:bg-surface-raised"
            >
              <Text className="text-[13px] font-semibold text-danger">Dismiss</Text>
            </Pressable>
          </View>
        ) : null}
        {jumpMissed ? (
          <View className="mx-2 flex-row items-center justify-between rounded-[10px] bg-surface-raised px-3 py-2">
            <Text className="flex-1 text-[13px] text-muted-foreground">Message not found</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss notice"
              onPress={() => setJumpMissed(false)}
              className="ml-2 rounded px-2 py-1 active:bg-surface-raised"
            >
              <Text className="text-[13px] font-semibold text-muted-foreground">Dismiss</Text>
            </Pressable>
          </View>
        ) : null}
        <Composer
          title={chat.title}
          onSend={(text) => {
            sendText(chat.id, text, replyTo === undefined ? undefined : { replyTo });
            cancelReply();
          }}
          onSendSticker={(sticker) => {
            sendSticker(chat.id, sticker, replyTo === undefined ? undefined : { replyTo });
            cancelReply();
          }}
          replyTo={replyTo}
          onCancelReply={cancelReply}
          onTyping={() => sendTyping(chat.id)}
          demoPacks={demoPacks}
        />
      </KeyboardAvoidingView>
      <TopicInfoSheet
        chat={infoOpen ? chat : null}
        groupTitle={groupName}
        members={infoMembers}
        ais={infoAis}
        aiCount={infoAis.length}
        canArchive={canArchiveInfo}
        isMember={isPrivateMember}
        busy={infoBusy}
        error={infoError}
        onLeave={() => {
          setInfoBusy(true);
          setInfoError('');
          void removeTopicMember(chat.id, myUserId)
            .then(() => setInfoOpen(false))
            .catch(() => setInfoError('Could not leave the topic. Try again.'))
            .finally(() => setInfoBusy(false));
        }}
        onArchive={() => {
          setInfoBusy(true);
          setInfoError('');
          void patchTopic(chat.id, { archived: true })
            .then(() => setInfoOpen(false))
            .catch(() => setInfoError('Could not archive the topic. Try again.'))
            .finally(() => setInfoBusy(false));
        }}
        onClose={() => {
          if (!infoBusy) {
            setInfoOpen(false);
          }
        }}
        roles={topicRoles?.roles ?? []}
        rolesError={infoRolesError}
        rolesLoading={!detailLoaded && infoRolesError === ''}
        groupRolesError={infoGroupRolesError}
        approverRole={topicRoles?.approverRole ?? null}
        groupRoles={groupRoles ?? []}
        canManageRoles={mayManageRoles(
          detail?.members.find((member) => member.userId === myUserId)?.role,
        )}
        onToggleTopicRole={toggleTopicRole}
        onPickApprover={(roleId) =>
          saveTopicRoles(attachedRoleIds(topicRoles?.roles ?? []), roleId)
        }
        onRetryRoles={() => {
          setInfoRolesError('');
          void refreshTopicRoles(chat.id).catch((error: unknown) =>
            setInfoRolesError(describeRolesError(error, 'load')),
          );
        }}
        onRetryGroupRoles={() => {
          setInfoGroupRolesError('');
          if (chatGroupId !== undefined) {
            void refreshGroupRoles(chatGroupId).catch((error: unknown) =>
              setInfoGroupRolesError(describeRolesError(error, 'load')),
            );
          }
        }}
      />
      <PinsSheet
        open={pinsOpen}
        pins={pins}
        canUnpin={canPinChat}
        unpinningId={unpinningId}
        error={pinsSheetError}
        onUnpin={sheetUnpin}
        onJump={jumpToPin}
        onClose={() => setPinsOpen(false)}
      />
    </View>
  );
}
