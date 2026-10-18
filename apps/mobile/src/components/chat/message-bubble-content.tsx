import { senderColor, type UiMessage } from '@zilar/chat-core';
import { isCardAllowedFrom } from '@zilar/client-core';
import type { Sticker } from '@zilar/protocol';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';

import { AttachmentBody } from '@/components/chat/attachment-body';
import { ForwardedHeader } from '@/components/chat/forwarded-header';
import { MarkdownText } from '@/components/chat/markdown-text';
import { MediaBubble } from '@/components/chat/media-bubble';
import {
  BigEmoji,
  BubbleMeta,
  DraftCaret,
  GeneratingLabel,
} from '@/components/chat/message-bubble-decor';
import { PayloadCard, isRenderedCard } from '@/components/chat/payload-card';
import { PersonPressable } from '@/components/chat/person-pressable';
import {
  BubbleInlineMeta,
  META_OVERLAY,
  PlainBubbleBody,
} from '@/components/chat/plain-bubble-body';
import { ReplyQuote } from '@/components/chat/reply-quote';
import { RoutineHeader } from '@/components/chat/routine-header';
import { StickerMessage } from '@/components/chat/sticker-message';
import { VoiceMessage } from '@/components/chat/voice-message';
import type { VoicePlayerHost } from '@/components/chat/voice-player';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

type MessageBubbleProps = {
  message: UiMessage;
  isGroup: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  currentUserId: string;
  onReply: (message: UiMessage) => void;
  draft?: boolean;
  revealTurnId?: string;
  onReact?: (message: UiMessage, emoji: string) => void;
  onEdit?: (message: UiMessage) => void;
  onDelete?: (message: UiMessage) => void;
  onForward?: (message: UiMessage) => void;
  selecting?: boolean;
  selected?: boolean;
  onToggleSelect?: (message: UiMessage) => void;
  onStartSelect?: (message: UiMessage) => void;
  onRetrySticker?: (message: UiMessage) => void;
  onRetryAttachment?: (message: UiMessage) => void;
  onCancelAttachment?: (message: UiMessage) => void;
  onRetryVoice?: (message: UiMessage) => void;
  onCancelVoice?: (message: UiMessage) => void;
  onOpenAttachment?: (message: UiMessage) => void;
  openingAttachmentId?: string | undefined;
  voiceHost?: VoicePlayerHost | undefined;
  canPin?: boolean;
  isPinned?: boolean;
  onPin?: (message: UiMessage) => void;
  onUnpin?: (message: UiMessage) => void;
};

export type { MessageBubbleProps };

type MessageBubbleContentProps = {
  message: UiMessage;
  /** A group chat: a card there answers with a mention; a direct chat does not. */
  isGroup: boolean;
  outgoing: boolean;
  generating: boolean;
  showSenderName: boolean;
  hasAttachment: boolean;
  /** A photo, video, album or GIF: the media is the bubble, edge to edge. */
  mediaFirst: boolean;
  showMarkdown: boolean;
  text: string;
  textColor: string;
  metaColor: string;
  reduceMotion: boolean;
  meJid?: string | undefined;
  onRetryAttachment?: ((message: UiMessage) => void) | undefined;
  onCancelAttachment?: ((message: UiMessage) => void) | undefined;
  onOpenAttachment?: ((message: UiMessage) => void) | undefined;
  openingAttachmentId?: string | undefined;
  onRetryVoice?: ((message: UiMessage) => void) | undefined;
  onCancelVoice?: ((message: UiMessage) => void) | undefined;
  voiceHost?: VoicePlayerHost | undefined;
};

export function MessageBubbleContent({
  message,
  isGroup,
  outgoing,
  generating,
  showSenderName,
  hasAttachment,
  mediaFirst,
  showMarkdown,
  text,
  textColor,
  metaColor,
  reduceMotion,
  meJid,
  onRetryAttachment,
  onCancelAttachment,
  onOpenAttachment,
  openingAttachmentId,
  onRetryVoice,
  onCancelVoice,
  voiceHost,
}: MessageBubbleContentProps) {
  // Stable across reveal frames that repeat the same text, so `MarkdownText`'s memo skips a re-parse. The hidden copy reserves the meta's width; the visible one is bottom-right.
  const trailingMeta = useMemo(
    () => (
      <>
        {generating ? <DraftCaret reduceMotion={reduceMotion} /> : null}
        <BubbleInlineMeta
          message={message}
          outgoing={outgoing}
          color={metaColor}
          generating={generating}
          hidden
        />
      </>
    ),
    [generating, message, outgoing, metaColor, reduceMotion],
  );

  return (
    <>
      {showSenderName ? (
        <PersonPressable target={{ jid: message.senderId }} name={message.senderName}>
          <Text
            className={cn('mb-0.5 text-[14px] font-semibold', mediaFirst && 'px-3 pt-2')}
            color={senderColor(message.senderId)}
          >
            {message.senderName}
          </Text>
        </PersonPressable>
      ) : null}
      {message.forward !== undefined ? (
        <View className={cn(mediaFirst && 'px-3 pt-2')}>
          <ForwardedHeader origin={message.forward} />
        </View>
      ) : null}
      {message.replyTo ? (
        <View className={cn(mediaFirst && 'px-3 pt-2')}>
          <ReplyQuote message={message} />
        </View>
      ) : null}
      {message.card?.type === 'routine' && isCardAllowedFrom(message.card, message.senderId) ? (
        <View className={cn(mediaFirst && 'px-3 pt-2')}>
          <RoutineHeader routine={message.card.data} />
        </View>
      ) : null}
      {mediaFirst ? (
        <MediaBubble
          message={message}
          outgoing={outgoing}
          text={text}
          textColor={textColor}
          metaColor={metaColor}
          reduceMotion={reduceMotion}
          meJid={meJid}
          onRetryAttachment={onRetryAttachment}
          onCancelAttachment={onCancelAttachment}
        />
      ) : message.card && isRenderedCard(message.card) ? (
        <>
          <PayloadCard
            card={message.card}
            senderId={message.senderId}
            footer={
              message.card.type === 'blocks' ? (
                <BubbleMeta message={message} outgoing={outgoing} color={metaColor} />
              ) : undefined
            }
            respond={
              outgoing
                ? undefined
                : {
                    // A direct chat records its card under the origin id.
                    messageId: isGroup ? message.id : (message.originId ?? message.id),
                    direct: !isGroup,
                    chatId: message.chatId,
                    aiName: message.senderName,
                    aiJid: message.senderId,
                  }
            }
          />
          {/* A blocks card carries its time inside the card; a progress card shows none. */}
          {message.card.type === 'progress' || message.card.type === 'blocks' ? null : (
            <BubbleMeta
              message={message}
              outgoing={outgoing}
              color={metaColor}
              className="mt-1 justify-end"
            />
          )}
        </>
      ) : hasAttachment ? (
        <AttachmentBody
          message={message}
          outgoing={outgoing}
          onRetryAttachment={onRetryAttachment}
          onCancelAttachment={onCancelAttachment}
          onOpenAttachment={onOpenAttachment}
          opening={openingAttachmentId === message.id}
        />
      ) : message.voice ? (
        <>
          <VoiceMessage
            voice={message.voice}
            outgoing={outgoing}
            message={message}
            onRetryVoice={onRetryVoice}
            onCancelVoice={onCancelVoice}
            {...(voiceHost === undefined
              ? {}
              : { playback: voiceHost.playback, controls: voiceHost.controls })}
          />
          <BubbleMeta
            message={message}
            outgoing={outgoing}
            color={metaColor}
            className="mt-1 justify-end"
          />
        </>
      ) : showMarkdown ? (
        <View>
          <MarkdownText text={text} color={textColor} trailing={trailingMeta} />
          {generating ? <GeneratingLabel /> : null}
          <View style={META_OVERLAY}>
            <Text className="text-[15px] leading-5" color={textColor}>
              <BubbleInlineMeta
                message={message}
                outgoing={outgoing}
                color={metaColor}
                generating={generating}
              />
            </Text>
          </View>
        </View>
      ) : (
        <PlainBubbleBody
          message={message}
          outgoing={outgoing}
          generating={generating}
          text={text}
          textColor={textColor}
          metaColor={metaColor}
          reduceMotion={reduceMotion}
          meJid={meJid}
        />
      )}
    </>
  );
}

// The sticker kind: no bubble surface, with the optional sender header and a Retry on a failed send.
export function StickerBubble({
  sticker,
  message,
  outgoing,
  showSenderName,
  failed,
  onRetry,
  onLongPress,
}: {
  sticker: Sticker;
  message: UiMessage;
  outgoing: boolean;
  showSenderName: boolean;
  failed: boolean;
  onRetry: ((message: UiMessage) => void) | undefined;
  onLongPress: () => void;
}) {
  return (
    <>
      {showSenderName ? (
        <Text className="mb-0.5 text-[14px] font-semibold" color={senderColor(message.senderId)}>
          {message.senderName}
        </Text>
      ) : null}
      {message.forward !== undefined ? <ForwardedHeader origin={message.forward} /> : null}
      {message.replyTo ? <ReplyQuote message={message} /> : null}
      <StickerMessage
        sticker={sticker}
        message={message}
        outgoing={outgoing}
        onLongPress={onLongPress}
      />
      {failed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry sending sticker"
          onPress={() => onRetry?.(message)}
          className="mt-1 rounded-[10px] bg-danger/20 px-3 py-1.5 active:opacity-80"
        >
          <Text className="text-[13px] font-semibold text-danger">Could not send. Try again.</Text>
        </Pressable>
      ) : null}
    </>
  );
}

export function BigEmojiBubble({
  message,
  text,
  outgoing,
  generating,
  reduceMotion,
  onLongPress,
}: {
  message: UiMessage;
  text: string;
  outgoing: boolean;
  generating: boolean;
  reduceMotion: boolean;
  onLongPress: () => void;
}) {
  return (
    <>
      {message.forward !== undefined ? <ForwardedHeader origin={message.forward} /> : null}
      <BigEmoji
        message={message}
        text={text}
        outgoing={outgoing}
        generating={generating}
        reduceMotion={reduceMotion}
        onLongPress={onLongPress}
      />
    </>
  );
}
