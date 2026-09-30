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
  const params = useLocalSearchParams<{ id: string }>();
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
  const chatGroupId = useChatStore(
    (state) => state.chats.find((item) => item.id === chatId)?.groupId,
  );
  const groupDetail = useChatStore((state) => state.groupDetail(chatGroupId ?? ''));
  const me = useChatStore((state) => state.me);
  const topicNotice = useChatStore((state) => state.topicNotice);
  const [replyTo, setReplyTo] = useState<ReplyRef | undefined>(undefined);
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

  const openInfo = () => {
    setInfoError('');
    setInfoOpen(true);
    void listTopicMembers(chat.id)
      .then(setInfoMembers)
      .catch(() => setInfoMembers([]));
    void listTopicAis(chat.id)
      .then(setInfoAis)
      .catch(() => setInfoAis([]));
  };

  if (!isTopic) {
    return (
      <View className="flex-1 bg-background">
        <ChatBackground />
        <SafeAreaView edges={['top']} className="bg-surface">
          <ChatHeader chat={chat} onBack={() => router.back()} />
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
      />
    </View>
  );
}
