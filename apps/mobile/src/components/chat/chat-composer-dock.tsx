// effect-plain: moved unchanged from apps/mobile/src/app/chat/[id].tsx (size split)
import { useMemo } from 'react';

import { ChannelComposerBar } from '@/components/chat/channel-composer-bar';
import { Composer } from '@/components/chat/composer';
import { SelectionBar } from '@/components/chat/selection-bar';
import type { ChatScreen } from '@/components/chat/use-chat-screen';
import type { PickedFile } from '@/lib/attachment-ports';
import { mockDemoAttachments } from '@/mock/attachments';
import { mockDemoGifs } from '@/mock/gifs';
import { mockDemoStickerPacks } from '@/mock/stickers';
import { useChatStore } from '@/store/chat-store-provider';
import { isMentionOfMe, type MentionMember, type UiMention } from '@zilar/chat-core';
import type { ChatSummary } from '@/lib/types';
import type { SendAttachmentOptions, SendTextOptions, SendVoiceRecording } from '@/store/types';

type ChatComposerDockProps = {
  screen: ChatScreen;
  chat: ChatSummary;
  /** `composer` is the full composer with the `@` picker; `channel` the feed bar. */
  variant: 'composer' | 'channel';
};

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
  const mentionMembers: MentionMember[] | undefined = useMemo(() => {
    if (mentionChatKind !== 'group') {
      return undefined;
    }
    void groupDetailForMentions;
    return groupMembers(mentionChatId).filter((member) => !isMentionOfMe(member.jid, meJid));
    // The memo reads the detail value above only to subscribe to its async
    // loads: `groupMembers` resolves from the same cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionChatKind, mentionChatId, groupMembers, groupDetailForMentions, meJid]);
  // Demo packs in mock mode, so the sticker panel works without a server
  // (real mode loads the user's packs from the API instead).
  const demoPacks = useMemo(
    () =>
      process.env.NODE_ENV === 'test' || process.env.EXPO_PUBLIC_ZILAR_MOCK === '1'
        ? mockDemoStickerPacks()
        : undefined,
    [],
  );
  // This `useMemo` sits above the `!chat` early return, like `demoPacks`:
  // every hook runs on every render (enforced by the oxlint
  // `react/rules-of-hooks` rule on `src/app`).
  const demoAttachments = useMemo(
    () =>
      process.env.NODE_ENV === 'test' || process.env.EXPO_PUBLIC_ZILAR_MOCK === '1'
        ? mockDemoAttachments()
        : undefined,
    [],
  );
  // Demo GIFs in mock mode, so the GIF tab works without a server (real
  // mode searches the provider through the proxy instead).
  const demoGifs = useMemo(
    () =>
      process.env.NODE_ENV === 'test' || process.env.EXPO_PUBLIC_ZILAR_MOCK === '1'
        ? mockDemoGifs()
        : undefined,
    [],
  );

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
          count={screen.selectedIds.length}
          onCancel={() => screen.setSelectedIds([])}
          onForward={screen.forwardSelected}
        />
      ) : variant === 'composer' ? (
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
          demoPacks={demoPacks}
          demoAttachments={demoAttachments}
          demoGifs={demoGifs}
        />
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
          demoPacks={demoPacks}
          demoAttachments={demoAttachments}
          demoGifs={demoGifs}
        />
      )}
    </>
  );
}
