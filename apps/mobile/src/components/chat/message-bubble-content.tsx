import { formatTime, type UiMessage } from '@zilar/chat-core';
import type { Sticker } from '@zilar/protocol';
import { Pressable, View } from 'react-native';

import { AttachmentBody } from '@/components/chat/attachment-body';
import { ForwardedHeader } from '@/components/chat/forwarded-header';
import { ImageMessage } from '@/components/chat/image-message';
import { LinkText } from '@/components/chat/link-text';
import { MarkdownText } from '@/components/chat/markdown-text';
import {
  BigEmoji,
  BubbleMeta,
  DraftCaret,
  GeneratingLabel,
} from '@/components/chat/message-bubble-decor';
import { PayloadCard } from '@/components/chat/payload-card';
import { ReplyQuote } from '@/components/chat/reply-quote';
import { StickerMessage } from '@/components/chat/sticker-message';
import { Ticks } from '@/components/chat/ticks';
import { VoiceMessage } from '@/components/chat/voice-message';
import type { VoicePlayerHost } from '@/components/chat/voice-player';
import { Text } from '@/components/ui/text';
import { raisedPill, senderColor } from '@/lib/depth';

type MessageBubbleContentProps = {
  message: UiMessage;
  outgoing: boolean;
  generating: boolean;
  showSenderName: boolean;
  hasAttachment: boolean;
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

/**
 * The inline time/edited/ticks meta shared by the markdown and plain text
 * branches of a bubble, on the time's own line.
 */
export function BubbleInlineMeta({
  message,
  outgoing,
  color,
  generating,
}: {
  message: UiMessage;
  outgoing: boolean;
  color: string;
  generating: boolean;
}) {
  return (
    <Text
      className="font-mono text-[10px]"
      color={color}
      style={generating ? { opacity: 0 } : undefined}
    >
      {'  '}
      {message.edited === true ? 'edited ' : ''}
      {formatTime(message.createdAt)}
      {/* A no-break space then a word joiner: the tick
          view stays on the time's line and cannot wrap
          alone onto a second line. */}
      {outgoing ? '\u00a0\u2060' : null}
      {outgoing ? (
        <View
          style={{
            width: 14,
            height: 11,
            // Nudge the ticks down onto the time's baseline
            // (they otherwise sit about a third too high).
            transform: [{ translateY: 2 }],
            ...(generating ? { opacity: 0 } : undefined),
          }}
        >
          <Ticks status={message.status} color={color} size={11} />
        </View>
      ) : null}
    </Text>
  );
}

/** The per-kind body of a bubble, inside the bubble's pressable surface. */
export function MessageBubbleContent({
  message,
  outgoing,
  generating,
  showSenderName,
  hasAttachment,
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
  return (
    <>
      {showSenderName ? (
        <Text className="mb-0.5 text-[14px] font-semibold" color={senderColor(message.senderId)}>
          {message.senderName}
        </Text>
      ) : null}
      {message.forward !== undefined ? <ForwardedHeader origin={message.forward} /> : null}
      {message.replyTo ? <ReplyQuote reply={message.replyTo} /> : null}
      {hasAttachment ? (
        <AttachmentBody
          message={message}
          outgoing={outgoing}
          onRetryAttachment={onRetryAttachment}
          onCancelAttachment={onCancelAttachment}
          onOpenAttachment={onOpenAttachment}
          opening={openingAttachmentId === message.id}
        />
      ) : message.card ? (
        <>
          <PayloadCard card={message.card} />
          <BubbleMeta
            message={message}
            outgoing={outgoing}
            color={metaColor}
            className="mt-1 justify-end"
          />
        </>
      ) : message.image ? (
        <View className="relative">
          <ImageMessage image={message.image} />
          <View
            className="absolute right-2 bottom-2 flex-row items-center gap-1 rounded-full px-2 py-0.5"
            style={raisedPill}
          >
            <Text className="font-mono text-[10px] text-muted-foreground">
              {formatTime(message.createdAt)}
            </Text>
            {outgoing ? <Ticks status={message.status} color="#8a8a8a" size={13} /> : null}
          </View>
          {message.text ? (
            <Text className="mt-1 px-0.5 text-[15px]" color={textColor}>
              {text}
            </Text>
          ) : null}
        </View>
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
        <>
          <MarkdownText text={text} color={textColor} />
          <Text className="text-[15px] leading-5" color={textColor}>
            {generating ? <DraftCaret reduceMotion={reduceMotion} /> : null}
            <BubbleInlineMeta
              message={message}
              outgoing={outgoing}
              color={metaColor}
              generating={generating}
            />
          </Text>
          {generating ? <GeneratingLabel /> : null}
        </>
      ) : (
        <>
          <Text className="text-[15px] leading-5" color={textColor}>
            <LinkText
              text={text}
              color={textColor}
              mentions={message.mentions}
              meJid={meJid}
              outgoing={outgoing}
            />
            {generating ? <DraftCaret reduceMotion={reduceMotion} /> : null}
            <BubbleInlineMeta
              message={message}
              outgoing={outgoing}
              color={metaColor}
              generating={generating}
            />
          </Text>
          {generating ? <GeneratingLabel /> : null}
        </>
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
      {message.replyTo ? <ReplyQuote reply={message.replyTo} /> : null}
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
          <Text className="text-[13px] font-semibold text-danger">Couldn't send. Retry</Text>
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
