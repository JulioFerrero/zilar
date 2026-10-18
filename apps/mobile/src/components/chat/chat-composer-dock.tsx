// effect-plain: no effects

import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { ChannelComposerBar } from '@/components/chat/channel-composer-bar';
import { systemConfirmsCopy } from '@/components/chat/chat-notice-context';
import { Composer } from '@/components/chat/composer';
import { SelectionBar } from '@/components/chat/selection-bar';
import type { ChatScreen } from '@/components/chat/use-chat-screen';
import { useStickersApi } from '@/components/stickers/use-stickers-api';
import { API_URL } from '@/lib/auth';
import type { PickedFile } from '@/lib/attachment-ports';
import { createGifsApi, type GifsApi } from '@/lib/gifs-api';
import { mockDemoAttachments } from '@/mock/attachments';
import { mockToken } from '@/mock/gate';
import { useChatStore } from '@/store/chat-store-provider';
import {
  isMentionOfMe,
  mentionInTopic,
  type MentionMember,
  type UiMention,
} from '@zilar/chat-core';
import type { ChatSummary } from '@/lib/types';
import type { SendAttachmentOptions, SendTextOptions, SendVoiceRecording } from '@/store/types';
import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Avatar } from '@/components/chat/avatar';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';

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

type ChatComposerDockProps = {
  screen: ChatScreen;
  chat: ChatSummary;
  variant: 'composer' | 'channel';
};

/** Builds the mock `GifsApi` behind a literal build-time condition: Metro folds
 *  it to `false`, so the mock module stays out of a release bundle. */
function createMockGifs(): GifsApi {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mockFetch } = require('@/mock/backend') as typeof import('@/mock/backend');
    return createGifsApi(mockToken, mockFetch, API_URL);
  }
  throw new Error('The mock API is not part of this build');
}

function jidLocalpart(jid: string): string {
  const at = jid.indexOf('@');
  return (at === -1 ? jid : jid.slice(0, at)).toLowerCase();
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
  const gifsApi = useMemo(() => (mockActive ? createMockGifs() : undefined), [mockActive]);

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
