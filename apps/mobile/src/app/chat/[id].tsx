import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { ChatBackground } from '@/components/chat/chat-background';
import { ChatHeader } from '@/components/chat/chat-header';
import { Composer } from '@/components/chat/composer';
import { MessageList } from '@/components/chat/message-list';
import { MessageListSkeleton } from '@/components/chat/skeleton';
import { TaskStrip } from '@/components/chat/task-strip';
import { TopicInfoSheet } from '@/components/chat/topic-sheets';
import { Text } from '@/components/ui/text';
import { replyRef } from '@/lib/format';
import { attachedRoleIds, describeRolesError, mayManageRoles } from '@/lib/roles';
import { httpsTopicUrl, mayArchiveTopic } from '@/lib/topics';
import type { TopicStatus } from '@/lib/topics-api';
import type { ReplyRef, UiMessage } from '@/lib/types';
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
  const sendTyping = useChatStore((state) => state.sendTyping);
  const react = useChatStore((state) => state.react);
  const startEdit = useChatStore((state) => state.startEdit);
  const deleteForEveryone = useChatStore((state) => state.deleteForEveryone);
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
  const refreshGroupDetail = useChatStore((state) => state.refreshGroupDetail);
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
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoMembers, setInfoMembers] = useState<{ userId: string; name: string }[]>([]);
  const [infoAis, setInfoAis] = useState<{ id: string; name: string }[]>([]);
  const [infoBusy, setInfoBusy] = useState(false);
  const [infoError, setInfoError] = useState('');
  const [infoRolesError, setInfoRolesError] = useState('');
  const [infoGroupRolesError, setInfoGroupRolesError] = useState('');

  useEffect(() => {
    if (chatId) {
      openChat(chatId);
    }
  }, [chatId, openChat]);

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
      refreshGroupDetail(detailGroupId);
    }
  }, [detailGroupId, refreshGroupDetail]);

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
          />
        </SafeAreaView>
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
          />
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
            replyTo={replyTo}
            onCancelReply={cancelReply}
            onTyping={() => sendTyping(chat.id)}
          />
        </KeyboardAvoidingView>
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
        />
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
          replyTo={replyTo}
          onCancelReply={cancelReply}
          onTyping={() => sendTyping(chat.id)}
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
    </View>
  );
}
