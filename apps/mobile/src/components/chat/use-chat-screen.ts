import { replyRef } from '@zilar/chat-core';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAiMemoryApi } from '@/components/ais/use-ai-memory-api';
import { runInBackground } from '@/lib/effect/run-in-background';
import { describeRolesError } from '@/lib/roles';
import { selectedInOrder, toggleSelected } from '@/lib/selection';
import { mayArchiveTopic } from '@/lib/topics';
import { useChatStore, useChatStoreApi } from '@/store/chat-store-provider';
import type { BannerPin } from '@/components/chat/pinned-banner';
import type { SheetPin } from '@/components/chat/pins-sheet';
import type { ReplyRef, UiMessage } from '@/lib/types';

export function useChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; notFound?: string; notice?: string }>();
  const chatId = typeof params.id === 'string' ? params.id : '';
  const chat = useChatStore((state) => state.chats.find((item) => item.id === chatId));
  const chatsLoad = useChatStore((state) => state.chatsLoad);
  const openChat = useChatStore((state) => state.openChat);
  const closeChat = useChatStore((state) => state.closeChat);
  const canPinChat = useChatStore((state) => state.canPin(chatId));
  const pinFor = useChatStore((state) => state.pinFor);
  const pins = useChatStore((state) => state.pins(chatId));
  const pinsError = useChatStore((state) =>
    state.pinsError?.chatId === chatId ? state.pinsError.message : undefined,
  );
  // One memoized ids array: a pins publish with unchanged membership keeps the reference, so the list does not re-render on every 60 s tick.
  const pinnedIds = useMemo(() => pins.map((pin) => pin.messageId), [pins]);
  const dismissPinsError = useChatStore((state) => state.dismissPinsError);
  // Messages are read at call time: subscribing the screen to `messagesByChat` re-rendered it and every row on every message.
  const store = useChatStoreApi();
  const cancelEdit = useChatStore((state) => state.cancelEdit);
  const currentUserId = useChatStore((state) => state.currentUserId);
  const patchTopic = useChatStore((state) => state.patchTopic);
  const listTopicMembers = useChatStore((state) => state.listTopicMembers);
  const refreshTopicRoles = useChatStore((state) => state.refreshTopicRoles);
  const topicRoles = useChatStore((state) => state.topicRoles(chatId));
  const chatGroupId = useChatStore(
    (state) => state.chats.find((item) => item.id === chatId)?.groupId,
  );
  const groupDetail = useChatStore((state) => state.groupDetail(chatGroupId ?? ''));
  // Mount loads detail only when nothing fresh is cached; the cache dedupes in-flight loads, so a remount costs no extra GET.
  const ensureGroupDetail = useChatStore((state) => state.ensureGroupDetail);
  const groupRoles = useChatStore((state) => state.groupRoles(chatGroupId ?? ''));
  const refreshGroupRoles = useChatStore((state) => state.refreshGroupRoles);
  const me = useChatStore((state) => state.me);
  const topicNotice = useChatStore((state) => state.topicNotice);
  const { api: memoryApi } = useAiMemoryApi();

  const [replyTo, setReplyTo] = useState<ReplyRef | undefined>(undefined);
  // A search jump that gave up lands here with `?notFound=1`: the chat opens at its bottom with a short notice, dismissed once.
  const [jumpMissed, setJumpMissed] = useState(params.notFound === '1');
  // A partial AI create lands here with `?notice=partial`: a quiet notice shown once.
  const [partialNotice, setPartialNotice] = useState(params.notice === 'partial');
  // A short "Copied" notice asked for by the tiles; the thread shows it through its one toast.
  const [notice, setNotice] = useState<string | null>(null);
  // The topic rows in the info sheet (link, done) report a save failure here.
  const [topicError, setTopicError] = useState('');
  const [pinsOpen, setPinsOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [pinIndex, setPinIndex] = useState(0);
  const [jumpToMessageId, setJumpToMessageId] = useState<string | undefined>(undefined);
  const [jumpError, setJumpError] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoMembers, setInfoMembers] = useState<{ userId: string; name: string }[]>([]);
  const [memoryAi, setMemoryAi] = useState<{ id: string; name: string } | null>(null);
  const [infoBusy, setInfoBusy] = useState(false);
  const [infoError, setInfoError] = useState('');
  const [infoRolesError, setInfoRolesError] = useState('');
  const [infoGroupRolesError, setInfoGroupRolesError] = useState('');
  const [forwarding, setForwarding] = useState<UiMessage[] | null>(null);
  // Multi-select for forwarding: the checked ids while the SelectionBar replaces the composer.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // The chat is open only while its screen is focused: a screen pushed over it blurs it, so messages stay unread until the user returns.
  useFocusEffect(
    useCallback(() => {
      if (!chatId) {
        return;
      }
      openChat(chatId);
      // Leaving or switching clears the open chat, so a message arriving on the list is not marked seen.
      return () => {
        closeChat(chatId);
      };
    }, [chatId, openChat, closeChat]),
  );

  // Leaving the chat stops its 60 s pins poll; this effect covers leave/unmount, and stays above the `!chat` return.
  const stopPinsPoll = useChatStore((state) => state.stopPinsPoll);
  useEffect(() => {
    return () => {
      stopPinsPoll();
    };
  }, [stopPinsPoll]);

  // An edit belongs to one chat: leaving or switching drops the edit mode, so the composer never shows a stale bar.
  useEffect(() => {
    return () => {
      cancelEdit();
    };
  }, [chatId, cancelEdit]);

  // Selecting is per chat: leaving or switching drops the checks, adjusted during render so no stale checks flash.
  const [selectedIdsChatId, setSelectedIdsChatId] = useState(chatId);
  if (selectedIdsChatId !== chatId) {
    setSelectedIdsChatId(chatId);
    setSelectedIds([]);
  }

  const toggleSelectedMessage = useCallback((message: UiMessage) => {
    setSelectedIds((ids) => toggleSelected(ids, message.id));
  }, []);
  const startSelection = useCallback((message: UiMessage) => {
    setSelectedIds([message.id]);
  }, []);
  // Memoised on the ids with stable handlers, so a message change does not re-render every mounted row.
  const selection = useMemo(
    () => ({ ids: selectedIds, onToggle: toggleSelectedMessage, onStart: startSelection }),
    [selectedIds, toggleSelectedMessage, startSelection],
  );

  const forwardSelected = () => {
    const list = selectedInOrder(store.getState().messages(chatId), selectedIds);
    setSelectedIds([]);
    if (list.length === 0) return;
    setForwarding(list);
  };

  // The manager controls and owner picker read the group detail, so load it for the topic's group: a deep link must not demote a manager. A failure keeps the read-only view.
  const detailGroupId = chat?.groupId ?? chatGroupId;
  useEffect(() => {
    if (detailGroupId !== undefined && detailGroupId !== '') {
      ensureGroupDetail(detailGroupId);
    }
  }, [detailGroupId, ensureGroupDetail]);

  // A topic that disappears while open goes back with a notice that never names it. Above the `!chat` return on purpose: hooks run on every render.
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
    const loaded = store
      .getState()
      .messages(chatId)
      .some((message) => message.id === messageId);
    if (loaded) {
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

  const patch = (input: Parameters<typeof patchTopic>[1]): void => {
    setTopicError('');
    runInBackground(() => patchTopic(chatId, input), {
      // The store only applies the patch on success, so a failure needs no rollback, just the inline error.
      onFailure: () => setTopicError('Could not save. Try again.'),
    });
  };

  const refreshInfoRoles = () => {
    setInfoRolesError('');
    setInfoGroupRolesError('');
    // Loads map 404 to "no longer available" and never show raw server text; 403 stays the neutral denied line.
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
    partialNotice,
    setPartialNotice,
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
    notice,
    setNotice,
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
    openGroup,
    topicError,
    setTopicError,
    infoOpen,
    setInfoOpen,
    infoMembers,
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
