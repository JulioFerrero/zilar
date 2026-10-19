// effect-plain: no effects

import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Copy, Forward, Trash2, X } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import type { Attachment } from '@zilar/protocol';
import { systemConfirmsCopy } from '@/components/chat/chat-notice-context';
import { Composer } from '@/components/chat/composer';
import { useBackCancel } from '@/components/chat/use-back-cancel';
import type { ChatScreen } from '@/components/chat/use-chat-screen';
import { useStickersApi } from '@/components/stickers/use-stickers-api';
import { API_URL } from '@/lib/auth';
import type { PickedFile } from '@/lib/attachment-ports';
import { channelViewerRole, isChannelChat, mayPostInChannel } from '@/lib/channels';
import { DANGER, ICON } from '@/lib/colors';
import { apiCall, type ApiTransport } from '@/lib/effect/api-client';
import { makeGifsApi, type GifsApi } from '@/lib/gifs-api';
import { mockDemoAttachments } from '@/mock/attachments';
import { mockToken } from '@/mock/gate';
import { useChatStore } from '@/store/chat-store-provider';
import {
  canAct,
  deleteActionFor,
  isMentionOfMe,
  jidLocalpart,
  mentionInTopic,
  type MentionMember,
  type UiMessage,
  type UiMention,
  mutedUntilFor,
} from '@zilar/chat-core';
import type {
  SendAttachmentOptions,
  SendStickerChoice,
  SendTextOptions,
  SendVoiceRecording,
} from '@/store/types';
import type { StickersApi } from '@/lib/stickers-api';
import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Avatar } from '@/components/chat/avatar';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { useAction } from '@/lib/effect/use-action';
import { isWaiting } from '@zilar/client-core';
import type { ChatSummary, ReplyRef } from '@zilar/chat-core';
import { failureOf } from '@zilar/client-core';

/** The store refused the mute change; the bar shows a fixed sentence, never the cause. */
class MuteChangeFailed extends Data.TaggedError('MuteChangeFailed')<{
  readonly reason: unknown;
}> {}

const MUTE_ERROR_TEXT = 'Could not change the mute. Try again.';

type ChannelComposerProps = {
  chat: ChatSummary;
  groupId: string | undefined;
  replyTo?: ReplyRef;
  onCancelReply: () => void;
  onTyping?: () => void;
  onSend: (text: string) => void;
  onSendSticker: (sticker: SendStickerChoice) => void;
  onSendAttachment?: ((file: PickedFile, options?: SendAttachmentOptions) => void) | undefined;
  onSendVoice?: ((recording: SendVoiceRecording, options?: SendTextOptions) => void) | undefined;
  stickersApi?: StickersApi | undefined;
  demoAttachments?: Attachment[] | undefined;
  gifsApi?: GifsApi | undefined;
};

// Subscribers are read-only here; the moderated room, not this bar, enforces
// posting. An unknown role reads as a subscriber until proven otherwise.
function ChannelComposerBar({
  chat,
  groupId,
  replyTo,
  onCancelReply,
  onTyping,
  onSend,
  onSendSticker,
  onSendAttachment,
  onSendVoice,
  stickersApi,
  demoAttachments,
  gifsApi,
}: ChannelComposerProps) {
  const insets = useSafeAreaInsets();
  const currentUserId = useChatStore((state) => state.currentUserId);
  const groupDetail = useChatStore((state) =>
    groupId === undefined ? undefined : state.groupDetail(groupId),
  );
  const setChatPref = useChatStore((state) => state.setChatPref);
  const [muteState, changeMute] = useAction((mutedUntil: string | null) =>
    Effect.tryPromise({
      try: () => setChatPref(chat.id, { mutedUntil }),
      catch: (reason) => new MuteChangeFailed({ reason }),
    }),
  );
  const busy = isWaiting(muteState);
  const error = !busy && failureOf(muteState) !== undefined ? MUTE_ERROR_TEXT : '';

  const role = channelViewerRole(chat, groupDetail, currentUserId);
  const canPost = mayPostInChannel(role);

  if (!isChannelChat(chat) || canPost) {
    return (
      <Composer
        chatKey={chat.id}
        title={chat.title}
        onSend={onSend}
        onSendSticker={onSendSticker}
        onSendAttachment={onSendAttachment}
        onSendVoice={onSendVoice}
        stickersApi={stickersApi}
        demoAttachments={demoAttachments}
        gifsApi={gifsApi}
        replyTo={replyTo}
        onCancelReply={onCancelReply}
        onTyping={onTyping}
      />
    );
  }

  const toggleMute = () => {
    changeMute(chat.muted ? null : mutedUntilFor('forever', new Date()));
  };

  return (
    <View className="px-2 pt-1.5" style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
      <View className="flex-row items-center gap-3 rounded-[14px] bg-surface-raised px-4 py-2.5">
        <Text numberOfLines={1} className="min-w-0 flex-1 text-[14px] text-muted-foreground">
          Only admins can post here
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={chat.muted ? 'Unmute' : 'Mute'}
          disabled={busy}
          onPress={toggleMute}
          className="shrink-0 rounded-full px-4 py-1.5 active:bg-surface disabled:opacity-60"
        >
          <Text className="text-[14px] font-medium text-foreground">
            {chat.muted ? 'Unmute' : 'Mute'}
          </Text>
        </Pressable>
      </View>
      {error !== '' ? (
        <Text role="alert" className="mt-1 px-1 text-[12px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

interface TopicNotIn {
  jid: string;
  name: string;
  kind: 'person' | 'ai';
  id: string;
  avatarUrl?: string | undefined;
}

type TopicNotInState = 'idle' | 'busy' | 'failed';

// The centred row a sender sees after mentioning someone who is not in the open topic: the Add key puts them in; a failure shows a muted line in its place.
function TopicNotInRow({
  name,
  avatarUrl,
  topicTitle,
  state,
  onAdd,
}: {
  name: string;
  avatarUrl?: string | undefined;
  topicTitle: string;
  state: TopicNotInState;
  onAdd: () => void;
}) {
  return (
    <View className="flex-row items-center gap-2.5 rounded-[14px] border border-[#232323] bg-[#141414] py-1.5 pr-1.5 pl-3">
      <Avatar
        seed={name}
        name={name}
        size={22}
        {...(avatarUrl === undefined ? {} : { avatarUrl })}
      />
      <Text className="text-[15px] text-[#a1a1a1]">{`${name} isn't in ${topicTitle}`}</Text>
      {state === 'failed' ? (
        <Text className="pr-1.5 text-[13px] text-muted-foreground">Couldn&apos;t add</Text>
      ) : (
        <Button
          className="rounded-[12px]"
          disabled={state === 'busy'}
          accessibilityLabel={`Add ${name} to ${topicTitle}`}
          onPress={onAdd}
        >
          <Text>{state === 'busy' ? 'Adding…' : 'Add'}</Text>
        </Button>
      )}
    </View>
  );
}

class AddToTopicFailed extends Data.TaggedError('AddToTopicFailed') {}

// One row with its own Add call, so two rows can be added while the sender keeps typing; `onAdded` drops the row once the person or AI is in.
function AddToTopicRow({
  name,
  avatarUrl,
  topicTitle,
  add,
  onAdded,
}: {
  name: string;
  avatarUrl?: string | undefined;
  topicTitle: string;
  add: () => Promise<void>;
  onAdded: () => void;
}) {
  const [state, run] = useAction<void, void, AddToTopicFailed>(() =>
    Effect.tryPromise({ try: add, catch: () => new AddToTopicFailed() }),
  );
  const done = AsyncResult.isSuccess(state);
  useEffect(() => {
    if (done) {
      onAdded();
    }
  }, [done, onAdded]);
  return (
    <TopicNotInRow
      name={name}
      avatarUrl={avatarUrl}
      topicTitle={topicTitle}
      state={isWaiting(state) ? 'busy' : failureOf(state) === undefined ? 'idle' : 'failed'}
      onAdd={() => run()}
    />
  );
}

type SelectionDeleteConfirmProps = {
  visible: boolean;
  deletable: readonly { senderName: string }[];
  isDm: boolean;
  allMine: boolean;
  onCancel: () => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
};

// The select-mode delete confirm, mirroring web's copy: an `ActionSheet` with both choices for a DM where everything is mine, otherwise a kit `ConfirmDialog`. The parent ends select mode after the delete.
function SelectionDeleteConfirm({
  visible,
  deletable,
  isDm,
  allMine,
  onCancel,
  onDeleteForMe,
  onDeleteForEveryone,
}: SelectionDeleteConfirmProps) {
  const plural = deletable.length > 1;
  const title = plural ? 'Delete messages?' : 'Delete message?';

  if (isDm && allMine) {
    return (
      <ActionSheet visible={visible} onClose={onCancel} closeLabel="Cancel delete" title={title}>
        <View className="px-4 py-3">
          <Text className="text-[14px] leading-5 text-muted-foreground">
            {plural
              ? 'Delete them for you only, or for everyone in the chat.'
              : 'Delete it for you only, or for everyone in the chat.'}
          </Text>
        </View>
        <ActionSheetItem
          label="Delete for me"
          accessibilityLabel="Delete for me"
          onPress={onDeleteForMe}
          destructive
          icon={Trash2}
        />
        <ActionSheetItem
          label="Delete for everyone"
          accessibilityLabel="Delete for everyone"
          onPress={onDeleteForEveryone}
          destructive
          icon={Trash2}
        />
        <ActionSheetItem label="Cancel" accessibilityLabel="Cancel delete" onPress={onCancel} />
      </ActionSheet>
    );
  }

  const message = isDm
    ? plural
      ? 'This removes them from your chat only.'
      : `This removes it from your chat only. ${deletable[0]?.senderName ?? ''} still has it.`
    : plural
      ? 'This deletes them for everyone in the chat.'
      : 'This deletes it for everyone in the chat.';
  const confirmLabel = isDm ? 'Delete for me' : 'Delete';

  return (
    <ConfirmDialog
      visible={visible}
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      busyLabel="Deleting…"
      busy={false}
      onCancel={onCancel}
      onConfirm={isDm ? onDeleteForMe : onDeleteForEveryone}
      cancelAccessibilityLabel="Cancel delete"
      confirmAccessibilityLabel={confirmLabel}
    />
  );
}

const EMPTY_MESSAGES: UiMessage[] = [];

// The bar shown while several messages are selected: "N selected", Cancel, Delete, Copy and Forward. Delete and Copy follow the single-message rules; Android back leaves select mode, or closes the open confirm.
function SelectionBar({
  chat,
  selectedIds,
  onForward,
  onCopied,
  onCancel,
}: {
  chat: { id: string; kind: string; isAI?: boolean };
  selectedIds: string[];
  onForward: () => void;
  onCopied?: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const meId = useChatStore((state) => state.currentUserId);
  const stored = useChatStore((state) => state.messagesByChat[chat.id]);
  const deleteForMe = useChatStore((state) => state.deleteForMe);
  const deleteForEveryone = useChatStore((state) => state.deleteForEveryone);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const selected = useMemo(() => {
    const ids = new Set(selectedIds);
    return (stored ?? EMPTY_MESSAGES).filter((message) => ids.has(message.id));
  }, [stored, selectedIds]);

  const isDm = chat.kind === 'dm' && chat.isAI !== true;
  const deletable = useMemo(
    () =>
      selected.filter(
        (message) => deleteActionFor(message, meId, isDm) !== 'none' && canAct(message),
      ),
    [selected, meId, isDm],
  );
  // "Delete for everyone" only when every deletable message is mine; a DM selection holding a peer's message can only be deleted for me.
  const allMine = deletable.every((message) => message.senderId === meId);
  const copyable = selected.filter(
    (message) => message.deleted !== true && (message.text ?? '').length > 0,
  );

  useBackCancel(() => {
    if (confirmOpen) {
      setConfirmOpen(false);
      return;
    }
    onCancel();
  });

  const copySelected = (): void => {
    Effect.runFork(
      Effect.tryPromise(() =>
        Clipboard.setStringAsync(
          copyable.map((message) => `${message.senderName}: ${message.text ?? ''}`).join('\n'),
        ),
      ).pipe(Effect.ignore),
    );
    onCopied?.();
    onCancel();
  };

  const deleteForMeOnAll = (): void => {
    for (const message of deletable) {
      void deleteForMe(chat.id, message.id);
    }
  };
  const deleteForEveryoneOnAll = (): void => {
    for (const message of deletable) {
      deleteForEveryone(chat.id, message.id);
    }
  };

  const count = selectedIds.length;

  return (
    <View className="px-2 pt-1.5" style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
      <View className="flex-row items-center gap-2 rounded-[14px] bg-surface-raised px-4 py-2.5">
        <IconButton label="Cancel" onPress={onCancel}>
          <X size={20} color={ICON} />
        </IconButton>
        <Text
          accessibilityLiveRegion="polite"
          numberOfLines={1}
          className="min-w-0 flex-1 text-[14px] text-muted-foreground"
        >
          {count} selected
        </Text>
        {deletable.length > 0 ? (
          <IconButton label="Delete selected messages" onPress={() => setConfirmOpen(true)}>
            <Trash2 size={20} color={DANGER} />
          </IconButton>
        ) : null}
        <IconButton
          label="Copy selected messages"
          disabled={copyable.length === 0}
          className={copyable.length === 0 ? 'opacity-50' : undefined}
          onPress={copySelected}
        >
          <Copy size={20} color={ICON} />
        </IconButton>
        <Button disabled={count === 0} onPress={onForward}>
          <Forward size={16} />
          <Text>Forward</Text>
        </Button>
      </View>
      <SelectionDeleteConfirm
        visible={confirmOpen}
        deletable={deletable}
        isDm={isDm}
        allMine={allMine}
        onCancel={() => setConfirmOpen(false)}
        onDeleteForMe={() => {
          setConfirmOpen(false);
          deleteForMeOnAll();
          onCancel();
        }}
        onDeleteForEveryone={() => {
          setConfirmOpen(false);
          deleteForEveryoneOnAll();
          onCancel();
        }}
      />
    </View>
  );
}

type ChatComposerDockProps = {
  screen: ChatScreen;
  chat: ChatSummary;
  variant: 'composer' | 'channel';
};

/** Builds the mock `GifsApi` behind a literal build-time condition: Metro folds
 *  it to `false`, so the mock module stays out of a release bundle. */
function makeMockGifs(): GifsApi {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mockFetch } = require('@/mock/backend') as typeof import('@/mock/backend');
    const transport: ApiTransport = { getToken: mockToken, fetchImpl: mockFetch, apiUrl: API_URL };
    return makeGifsApi(apiCall(transport), transport);
  }
  throw new Error('The mock API is not part of this build');
}

export function ChatComposerDock({ screen, chat, variant }: ChatComposerDockProps) {
  const { replyTo, cancelReply } = screen;
  const sendText = useChatStore((state) => state.sendText);
  const sendAttachment = useChatStore((state) => state.sendAttachment);
  const sendVoice = useChatStore((state) => state.sendVoice);
  const sendSticker = useChatStore((state) => state.sendSticker);
  const sendTyping = useChatStore((state) => state.sendTyping);
  const stopTyping = useChatStore((state) => state.stopTyping);
  const addTopicAi = useChatStore((state) => state.addTopicAi);
  const addTopicMember = useChatStore((state) => state.addTopicMember);
  const groupMembers = useChatStore((state) => state.groupMembers);
  // Legacy rows without `groupId` resolve through the remembered `/api/chats`
  // entries, so a cold-open load re-fires the detail subscription.
  const groupIdForChat = useChatStore((state) => state.groupIdForChat);
  const me = useChatStore((state) => state.me);
  const mentionChatKind = chat.kind;
  const mentionChatId = chat.id;
  const mentionGroupId = mentionChatKind === 'group' ? groupIdForChat(mentionChatId) : undefined;
  // Reads the detail value so this memo re-runs when an async detail load lands.
  const groupDetailForMentions = useChatStore((state) =>
    mentionGroupId === undefined ? undefined : state.groupDetail(mentionGroupId),
  );
  const meJid = me?.jid ?? undefined;
  const chatTopic = chat.topic;
  const mentionMembers: MentionMember[] | undefined = useMemo(() => {
    if (mentionChatKind !== 'group') {
      return undefined;
    }
    void groupDetailForMentions;
    const members = groupMembers(mentionChatId).filter(
      (member) => !isMentionOfMe(member.jid, meJid),
    );
    if (chatTopic === undefined) {
      return members;
    }
    const aiIdByJid = new Map<string, string>();
    for (const ai of groupDetailForMentions?.ais ?? []) {
      aiIdByJid.set(ai.jid, ai.aiId);
    }
    return members.filter((member) => mentionInTopic(chatTopic, member.jid, aiIdByJid));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionChatKind, mentionChatId, groupMembers, groupDetailForMentions, meJid, chatTopic]);
  const { api: stickersApi, mock: mockActive } = useStickersApi();
  // Above the `!chat` early return like the API hooks: every hook runs on every render.
  const demoAttachments = useMemo(
    () =>
      process.env.NODE_ENV === 'test' || process.env.EXPO_PUBLIC_ZILAR_MOCK === '1'
        ? mockDemoAttachments()
        : undefined,
    [],
  );
  const gifsApi = useMemo(() => (mockActive ? makeMockGifs() : undefined), [mockActive]);

  const [notInTopic, setNotInTopic] = useState<TopicNotIn[]>([]);
  useEffect(() => {
    setNotInTopic([]);
  }, [chat.id]);

  const surfaceNotInTopic = (sent: readonly UiMention[]): void => {
    if (chatTopic === undefined || sent.length === 0) {
      setNotInTopic([]);
      return;
    }
    const aiIdByJid = new Map<string, string>();
    for (const ai of groupDetailForMentions?.ais ?? []) {
      aiIdByJid.set(ai.jid, ai.aiId);
    }
    const missing: TopicNotIn[] = [];
    const seen = new Set<string>();
    for (const mention of sent) {
      if (seen.has(mention.jid) || mentionInTopic(chatTopic, mention.jid, aiIdByJid)) {
        continue;
      }
      seen.add(mention.jid);
      const aiId = aiIdByJid.get(mention.jid);
      if (aiId !== undefined) {
        const ai = groupDetailForMentions?.ais.find((entry) => entry.aiId === aiId);
        missing.push({
          jid: mention.jid,
          name: mention.name,
          kind: 'ai',
          id: aiId,
          ...(ai?.avatarUrl === undefined ? {} : { avatarUrl: ai.avatarUrl }),
        });
        continue;
      }
      const member = groupDetailForMentions?.members.find(
        (entry) => entry.userId.toLowerCase() === jidLocalpart(mention.jid),
      );
      missing.push({
        jid: mention.jid,
        name: mention.name,
        kind: 'person',
        id: member?.userId ?? jidLocalpart(mention.jid),
        ...(member?.avatarUrl === undefined ? {} : { avatarUrl: member.avatarUrl }),
      });
    }
    setNotInTopic(missing);
  };

  const addToTopic = (entry: TopicNotIn): Promise<void> =>
    entry.kind === 'ai' ? addTopicAi(chat.id, entry.id) : addTopicMember(chat.id, entry.id);

  const sendAttachmentNow = (file: PickedFile, options?: SendAttachmentOptions) => {
    sendAttachment(chat.id, file, options);
  };

  const sendVoiceNow = (recording: SendVoiceRecording, options?: SendTextOptions) => {
    sendVoice(chat.id, recording, options ?? (replyTo === undefined ? undefined : { replyTo }));
    cancelReply();
  };

  const sendTextNow = (text: string, mentions?: UiMention[]) => {
    sendText(
      chat.id,
      text,
      replyTo === undefined && (mentions === undefined || mentions.length === 0)
        ? undefined
        : {
            ...(replyTo === undefined ? {} : { replyTo }),
            ...(mentions === undefined || mentions.length === 0 ? {} : { mentions }),
          },
    );
    surfaceNotInTopic(mentions ?? []);
    // The paused stanza is a backstop for a slow echo or another device.
    stopTyping(chat.id);
    cancelReply();
  };

  const onSendSticker = (sticker: Parameters<typeof sendSticker>[1]) => {
    sendSticker(chat.id, sticker, replyTo === undefined ? undefined : { replyTo });
    cancelReply();
  };

  const onSendAttachment = (file: PickedFile, options?: SendAttachmentOptions) => {
    sendAttachmentNow(
      file,
      options === undefined ? (replyTo === undefined ? undefined : { replyTo }) : options,
    );
    cancelReply();
  };

  return (
    <>
      {screen.selectedIds.length > 0 ? (
        <SelectionBar
          chat={chat}
          selectedIds={screen.selectedIds}
          onCancel={() => screen.setSelectedIds([])}
          onForward={screen.forwardSelected}
          onCopied={() => {
            if (!systemConfirmsCopy()) {
              screen.setNotice('Copied');
            }
          }}
        />
      ) : variant === 'composer' ? (
        <>
          {notInTopic.length > 0 ? (
            <View className="mb-2 flex-col items-center gap-1.5 px-3">
              {notInTopic.map((entry) => (
                <AddToTopicRow
                  key={entry.jid}
                  name={entry.name}
                  avatarUrl={entry.avatarUrl}
                  topicTitle={chat.title}
                  add={() => addToTopic(entry)}
                  onAdded={() =>
                    setNotInTopic((previous) => previous.filter((item) => item.jid !== entry.jid))
                  }
                />
              ))}
            </View>
          ) : null}
          <Composer
            chatKey={chat.id}
            title={chat.title}
            onSend={sendTextNow}
            mentionMembers={mentionMembers}
            onSendSticker={onSendSticker}
            onSendAttachment={onSendAttachment}
            onSendVoice={sendVoiceNow}
            replyTo={replyTo}
            onCancelReply={cancelReply}
            onTyping={() => sendTyping(chat.id)}
            onStopTyping={() => stopTyping(chat.id)}
            stickersApi={stickersApi}
            demoAttachments={demoAttachments}
            gifsApi={gifsApi}
          />
        </>
      ) : (
        <ChannelComposerBar
          chat={chat}
          groupId={chat.groupId}
          onSend={(text) => sendTextNow(text)}
          onSendSticker={onSendSticker}
          onSendAttachment={onSendAttachment}
          onSendVoice={sendVoiceNow}
          replyTo={replyTo}
          onCancelReply={cancelReply}
          onTyping={() => sendTyping(chat.id)}
          stickersApi={stickersApi}
          demoAttachments={demoAttachments}
          gifsApi={gifsApi}
        />
      )}
    </>
  );
}
