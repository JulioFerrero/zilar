import { senderColor, type UiMessage } from '@zilar/chat-core';
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
  /** A live AI draft: the same bubble, recessed while it is written. */
  draft?: boolean;
  /**
   * The turn whose draft this final message continues (T-0056); the bubble
   * reveals from the shown length until the reveal is done.
   */
  revealTurnId?: string;
  /** Called when the user picks a quick-reaction emoji or taps a chip. */
  onReact?: (message: UiMessage, emoji: string) => void;
  /** Called when the sheet asks to edit the message. */
  onEdit?: (message: UiMessage) => void;
  /** Called when the user confirms a delete-for-everyone. */
  onDelete?: (message: UiMessage) => void;
  /** Called when the sheet asks to forward the message. */
  onForward?: (message: UiMessage) => void;
  /** Multi-select mode (T-0445): shows the row checkbox and blocks the row's
   *  own taps/long-presses while messages are picked for forwarding. */
  selecting?: boolean;
  /** Whether this message is picked in select mode. */
  selected?: boolean;
  /** Toggles this message in select mode. */
  onToggleSelect?: (message: UiMessage) => void;
  /** Enters select mode with this message picked (the sheet's Select row). */
  onStartSelect?: (message: UiMessage) => void;
  /** Called when the sticker Retry is tapped on a failed sticker send. */
  onRetrySticker?: (message: UiMessage) => void;
  /** Called when the Retry is tapped on a failed attachment upload. */
  onRetryAttachment?: (message: UiMessage) => void;
  /** Called when Cancel is tapped while an attachment uploads. */
  onCancelAttachment?: (message: UiMessage) => void;
  /** Called when the Retry is tapped on a failed voice send. */
  onRetryVoice?: (message: UiMessage) => void;
  /** Called when Cancel is tapped while a voice message uploads. */
  onCancelVoice?: (message: UiMessage) => void;
  /** Called when a file row is tapped (system open sheet). */
  onOpenAttachment?: (message: UiMessage) => void;
  /** The message id currently downloading for the open sheet. */
  openingAttachmentId?: string | undefined;
  /** The shared voice player host from the chat screen (T-0154). */
  voiceHost?: VoicePlayerHost | undefined;
  /** Pin/unpin gating for chat of this message (T-0135). */
  canPin?: boolean;
  isPinned?: boolean;
  /** Called when the sheet asks to pin or unpin the message. */
  onPin?: (message: UiMessage) => void;
  onUnpin?: (message: UiMessage) => void;
};

export type { MessageBubbleProps };

type MessageBubbleContentProps = {
  message: UiMessage;
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

/** The per-kind body of a bubble, inside the bubble's pressable surface. */
export function MessageBubbleContent({
  message,
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
  // Stable across reveal frames that repeat the same text, so `MarkdownText`'s
  // memo still skips a re-parse. The `hidden` copy reserves the meta's width at
  // the end of the last line; the visible copy is drawn bottom-right below.
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
        <Text
          className={cn('mb-0.5 text-[14px] font-semibold', mediaFirst && 'px-3 pt-2')}
          color={senderColor(message.senderId)}
        >
          {message.senderName}
        </Text>
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
      {message.card?.type === 'routine' ? (
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
          {/* T-1756: a blocks card carries its own time row as its card footer. */}
          <PayloadCard
            card={message.card}
            footer={
              message.card.type === 'blocks' ? (
                <BubbleMeta message={message} outgoing={outgoing} color={metaColor} />
              ) : undefined
            }
          />
          {/* T-1619: the progress card stands alone, so it shows no time or
              "edited" row; a blocks card shows its time inside the card. Approval
              and question cards keep theirs. */}
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

/**
 * The sticker kind (T-0838 split): no bubble surface, with the optional sender
 * header and a Retry on a failed send.
 */
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

/** The standalone big-emoji kind. */
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
