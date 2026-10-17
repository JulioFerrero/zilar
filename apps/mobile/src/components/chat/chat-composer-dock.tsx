// effect-plain: moved unchanged from apps/mobile/src/app/chat/[id].tsx (size split)
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { AiStatusLine } from '@/components/chat/ai-status-line';
import { ChannelComposerBar } from '@/components/chat/channel-composer-bar';
import { systemConfirmsCopy } from '@/components/chat/chat-notice-context';
import { Composer } from '@/components/chat/composer';
import { SelectionBar } from '@/components/chat/selection-bar';
import { AddToTopicRow, type TopicNotIn } from '@/components/chat/topic-not-in-row';
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

type ChatComposerDockProps = {
  screen: ChatScreen;
  chat: ChatSummary;
  /** `composer` is the full composer with the `@` picker; `channel` the feed bar. */
  variant: 'composer' | 'channel';
};

/**
 * Builds the mock-mode `GifsApi` on the shared mock backend, behind a literal
 * build-time condition: Metro folds it to `false` in a release build, so the
 * mock module stays out of the bundle.
 */
function createMockGifs(): GifsApi {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mockFetch } = require('@/mock/backend') as typeof import('@/mock/backend');
    return createGifsApi(mockToken, mockFetch, API_URL);
  }
  throw new Error('The mock API is not part of this build');
}

/** The localpart of a jid, lowercased (`Ana@x` → `ana`). */
function jidLocalpart(jid: string): string {
  const at = jid.indexOf('@');
  return (at === -1 ? jid : jid.slice(0, at)).toLowerCase();
}

/**
 * The bottom bar: the selection bar while forwarding, otherwise the full
 * composer or the channel feed bar. One copy replaces the three composer
 * wrappers the screen repeated.
 */
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
  // The `@` picker members (T-0227, like web): group and topic chats read
  // the group's members and AIs, minus me; DMs pass nothing (no picker).
  // Scalar deps only — `chat` itself is still loading above this line.
  const groupMembers = useChatStore((state) => state.groupMembers);
  // The group id behind this row, including legacy rows that carry no
  // `groupId` (T-0227): the store resolves them through the remembered
  // `/api/chats` entries, so the detail subscription below re-fires when a
  // cold-open load lands — `chat?.groupId` alone stays `''` forever there.
  const groupIdForChat = useChatStore((state) => state.groupIdForChat);
  const me = useChatStore((state) => state.me);
  const mentionChatKind = chat.kind;
  const mentionChatId = chat.id;
  const mentionGroupId = mentionChatKind === 'group' ? groupIdForChat(mentionChatId) : undefined;
  // Subscribes the memo below to async detail loads: `groupMembers` is a
  // stable function over a closure cache filled by `ensureGroupDetail`, so
  // reading the detail value here re-runs the memo when it arrives — without
  // it a cold open keeps returning `[]` forever.
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
    // T-1788: in a topic, `@` offers only its people and AIs (the phone twin
    // of web's T-1783 filter). Other chats stay unfiltered.
    if (chatTopic === undefined) {
      return members;
    }
    const aiIdByJid = new Map<string, string>();
    for (const ai of groupDetailForMentions?.ais ?? []) {
      aiIdByJid.set(ai.jid, ai.aiId);
    }
    return members.filter((member) => mentionInTopic(chatTopic, member.jid, aiIdByJid));
    // The memo reads the detail value above only to subscribe to its async
    // loads: `groupMembers` resolves from the same cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionChatKind, mentionChatId, groupMembers, groupDetailForMentions, meJid, chatTopic]);
  // Stickers: `useStickersApi` returns the mock-backed adapter in mock mode
  // and the real one otherwise, so the panel loads the same way in both.
  const { api: stickersApi, mock: mockActive } = useStickersApi();
  // This `useMemo` sits above the `!chat` early return, like the API hooks:
  // every hook runs on every render (enforced by the oxlint
  // `react/rules-of-hooks` rule on `src/app`).
  const demoAttachments = useMemo(
    () =>
      process.env.NODE_ENV === 'test' || process.env.EXPO_PUBLIC_ZILAR_MOCK === '1'
        ? mockDemoAttachments()
        : undefined,
    [],
  );
  // GIFs: the shared mock backend serves trending and search, so mock mode
  // gets the mock-backed client; real mode falls back to the panel's own.
  const gifsApi = useMemo(() => (mockActive ? createMockGifs() : undefined), [mockActive]);

  // T-1788: the mentions of people outside the open topic that the last send
  // put on screen (the phone twin of web's T-1783 list). Cleared on a chat
  // switch and replaced on the next send.
  const [notInTopic, setNotInTopic] = useState<TopicNotIn[]>([]);
  useEffect(() => {
    setNotInTopic([]);
  }, [chat.id]);

  // T-1788: after a send in a topic, collect the mentions of people and AIs
  // who are not in it, deduped by jid, with the name and picture from the
  // group detail. A General topic, a non-topic chat and an older server whose
  // `memberIds` is missing produce no rows.
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

  // T-1788: the Add key's call for one entry; its group half is added first on
  // the server (T-1769). The row drops itself through `onAdded` on success.
  const addToTopic = (entry: TopicNotIn): Promise<void> =>
    entry.kind === 'ai' ? addTopicAi(chat.id, entry.id) : addTopicMember(chat.id, entry.id);

  const sendAttachmentNow = (file: PickedFile, options?: SendAttachmentOptions) => {
    sendAttachment(chat.id, file, options);
  };

  const sendVoiceNow = (recording: SendVoiceRecording, options?: SendTextOptions) => {
    sendVoice(chat.id, recording, options ?? (replyTo === undefined ? undefined : { replyTo }));
    cancelReply();
  };

  // Sending carries the composer's tracked mentions (T-0227, like web):
  // the message text is unchanged, the ranges ride along. The channel bar
  // takes a text-only send, so its wrapper below drops the mentions.
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
    // The receiver clears the line on the message itself; the paused stanza is
    // the backstop for a slow echo or another device.
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
          <AiStatusLine chat={chat} />
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
