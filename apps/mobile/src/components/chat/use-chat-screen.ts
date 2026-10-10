import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';

import { useAiMemoryApi } from '@/components/ais/use-ai-memory-api';
import { runInBackground } from '@/lib/effect/run-in-background';
import { replyRef } from '@/lib/format';
import { describeRolesError } from '@/lib/roles';
import { selectedInOrder, toggleSelected } from '@/lib/selection';
import { mayArchiveTopic } from '@/lib/topics';
import { useChatStore } from '@/store/chat-store-provider';
import type { BannerPin } from '@/components/chat/pinned-banner';
import type { SheetPin } from '@/components/chat/pins-sheet';
import type { TopicStatus } from '@/lib/topics-api';
import type { ReplyRef, UiMessage } from '@/lib/types';

/**
 * The chat screen's store subscriptions, local state and handlers. The route
 * stays the screen (`app/chat/[id].tsx`) and renders the branches; the pieces
 * it repeats live in `components/chat/`.
 */
export function useChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; notFound?: string }>();
  const chatId = typeof params.id === 'string' ? params.id : '';
  const chat = useChatStore((state) => state.chats.find((item) => item.id === chatId));
  const chatsLoad = useChatStore((state) => state.chatsLoad);
  const openChat = useChatStore((state) => state.openChat);
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
  const cancelEdit = useChatStore((state) => state.cancelEdit);
  const currentUserId = useChatStore((state) => state.currentUserId);
  const patchTopic = useChatStore((state) => state.patchTopic);
  const listTopicMembers = useChatStore((state) => state.listTopicMembers);
  const listTopicAis = useChatStore((state) => state.listTopicAis);
  const refreshTopicRoles = useChatStore((state) => state.refreshTopicRoles);
  const topicRoles = useChatStore((state) => state.topicRoles(chatId));
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
  const { api: memoryApi } = useAiMemoryApi();

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
  const [mediaOpen, setMediaOpen] = useState(false);
  const [pinIndex, setPinIndex] = useState(0);
  const [jumpToMessageId, setJumpToMessageId] = useState<string | undefined>(undefined);
  const [jumpError, setJumpError] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoMembers, setInfoMembers] = useState<{ userId: string; name: string }[]>([]);
  const [infoAis, setInfoAis] = useState<{ id: string; name: string }[]>([]);
  const [memoryAi, setMemoryAi] = useState<{ id: string; name: string } | null>(null);
  const [infoBusy, setInfoBusy] = useState(false);
  const [infoError, setInfoError] = useState('');
  const [infoRolesError, setInfoRolesError] = useState('');
  const [infoGroupRolesError, setInfoGroupRolesError] = useState('');
  const [forwarding, setForwarding] = useState<UiMessage[] | null>(null);
  // Multi-select for forwarding (T-0445): the checked message ids while the
  // SelectionBar replaces the composer.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

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

  // Selecting is per chat: leaving or switching drops the checked messages.
  // Adjust during render (React's derived-state pattern) so a switch never
  // shows the previous chat's checks, and so `react/set-state-in-effect`
  // stays quiet.
  const [selectedIdsChatId, setSelectedIdsChatId] = useState(chatId);
  if (selectedIdsChatId !== chatId) {
    setSelectedIdsChatId(chatId);
    setSelectedIds([]);
  }

  const selection = {
    ids: selectedIds,
    onToggle: (message: UiMessage) => setSelectedIds((ids) => toggleSelected(ids, message.id)),
    onStart: (message: UiMessage) => setSelectedIds([message.id]),
  };

  const forwardSelected = () => {
    const list = selectedInOrder(loadedMessages ?? [], selectedIds);
    setSelectedIds([]);
    if (list.length === 0) return;
    setForwarding(list);
  };

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

  const startReply = (message: UiMessage) => setReplyTo(replyRef(message, currentUserId));
  const cancelReply = () => setReplyTo(undefined);

  const jumpTo = (messageId: string) => {
    if ((loadedMessageIds ?? []).includes(messageId)) {
      setJumpError('');
      setJumpToMessageId(messageId);
      return;
    }
    // No history paging on mobile yet (no `openAtMessage` seam): say so.
    setJumpError('Message not found');
  };

  const jumpToPin = (pin: BannerPin | SheetPin) => {
    jumpTo(pin.messageId);
  };

  const isTopic = chat?.topic !== undefined;
  const groupName = chat?.groupTitle ?? '';
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
  const canArchiveInfo = mayArchiveTopic(permissions, chat?.topic);
  const isPrivateMember =
    chat?.topic?.visibility !== 'private' ||
    infoMembers.some((member) => member.userId === myUserId);
  const ownerCandidates = [
    ...(detail?.members.map((member) => ({
      kind: 'user' as const,
      id: member.userId,
      name: member.name,
    })) ?? []),
    ...infoAis.map((ai) => ({ kind: 'ai' as const, id: ai.id, name: ai.name })),
  ];

  const patch = (input: Parameters<typeof patchTopic>[1]): void => {
    setStripError('');
    runInBackground(() => patchTopic(chatId, input), {
      // The row keeps its server state (the store only applies the patch on
      // success), so a failure needs no rollback, just the inline error.
      onFailure: () => setStripError('Could not save. Try again.'),
    });
  };

  const chooseStatus = (next: TopicStatus): void => {
    setStatusOpen(false);
    if (next === chat?.topic?.status) {
      return;
    }
    patch({ status: next });
  };

  const refreshInfoRoles = () => {
    setInfoRolesError('');
    setInfoGroupRolesError('');
    // Loads map a 404 to "no longer available" (refreshable) and never show
    // raw server messages; a 403 stays the neutral denied line.
    runInBackground(() => refreshTopicRoles(chatId), {
      onFailure: (error) => setInfoRolesError(describeRolesError(error, 'load')),
    });
    if (chatGroupId !== undefined) {
      runInBackground(() => refreshGroupRoles(chatGroupId), {
        onFailure: (error) => setInfoGroupRolesError(describeRolesError(error, 'load')),
      });
    }
  };

  const openInfo = () => {
    setInfoError('');
    setInfoOpen(true);
    runInBackground(() => listTopicMembers(chatId), {
      onSuccess: setInfoMembers,
      onFailure: () => setInfoMembers([]),
    });
    runInBackground(() => listTopicAis(chatId), {
      onSuccess: setInfoAis,
      onFailure: () => setInfoAis([]),
    });
    // The access picker reads the attached roles fresh.
    refreshInfoRoles();
  };

  const openGroup =
    chat?.groupId === undefined
      ? undefined
      : (groupId: string) => router.push({ pathname: '/group/[id]', params: { id: groupId } });

  return {
    router,
    chat,
    chatsLoad,
    chatId,
    isTopic,
    groupName,
    replyTo,
    startReply,
    cancelReply,
    selection,
    selectedIds,
    setSelectedIds,
    forwardSelected,
    jumpTo,
    jumpToPin,
    jumpToMessageId,
    setJumpToMessageId,
    jumpError,
    setJumpError,
    jumpMissed,
    setJumpMissed,
    pins,
    pinsError,
    pinIndex,
    setPinIndex,
    pinnedIds,
    dismissPinsError,
    pinsOpen,
    setPinsOpen,
    mediaOpen,
    setMediaOpen,
    forwarding,
    setForwarding,
    canPinChat,
    pinFor,
    patch,
    chooseStatus,
    openGroup,
    ownerCandidates,
    statusOpen,
    setStatusOpen,
    ownerOpen,
    setOwnerOpen,
    linkOpen,
    setLinkOpen,
    linkUrl,
    setLinkUrl,
    linkLabel,
    setLinkLabel,
    stripError,
    setStripError,
    infoOpen,
    setInfoOpen,
    infoMembers,
    infoAis,
    infoBusy,
    setInfoBusy,
    infoError,
    setInfoError,
    infoRolesError,
    setInfoRolesError,
    infoGroupRolesError,
    setInfoGroupRolesError,
    topicRoles,
    groupRoles,
    chatGroupId,
    detail,
    detailLoaded,
    myUserId,
    canArchiveInfo,
    isPrivateMember,
    memoryAi,
    setMemoryAi,
    memoryApi,
    openInfo,
    refreshInfoRoles,
  };
}

export type ChatScreen = ReturnType<typeof useChatScreen>;
