import { senderColor, UiMessage, lightToPlain, replyQuoteContent } from '@zilar/chat-core';
import { isCardAllowedFrom } from '@zilar/client-core';
import type { Sticker, ForwardOrigin, RoutinePost } from '@zilar/protocol';
import { useMemo, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { AttachmentBody } from '@/components/chat/attachment-body';
import { MarkdownText } from '@/components/chat/markdown-text';
import { MediaBubble } from '@/components/chat/media-bubble';
import {
  BigEmoji,
  BubbleMeta,
  DraftCaret,
  GeneratingLabel,
  LONG_PRESS_MS,
} from '@/components/chat/message-bubble-decor';
import { PayloadCard, isRenderedCard } from '@/components/chat/payload-card';
import { PersonPressable } from '@/components/chat/person-pressable';
import {
  BubbleInlineMeta,
  META_OVERLAY,
  PlainBubbleBody,
} from '@/components/chat/plain-bubble-body';
import { VoiceMessage } from '@/components/chat/voice-message';
import type { VoicePlayerHost } from '@/components/chat/voice-player-host';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { Forward, Repeat } from 'lucide-react-native';
import { MUTED_FOREGROUND, ACCENT, SEEN } from '@/lib/colors';
import { useRouter, router } from 'expo-router';
import { useChatJump } from '@/components/chat/chat-jump-context';
import { useOpenMessageMenu } from '@/components/chat/message-menu-context';
import { useChatStore } from '@/store/chat-store-provider';
import { Effect, Fiber } from 'effect';
import { Image } from 'expo-image';
import { metaTimeText } from '@/components/chat/meta-time';
import { Ticks } from '@/components/chat/ticks';
import { API_URL } from '@/lib/auth';
import { raisedPill } from '@/lib/depth';
import { messageAccessibilityLabel } from '@/lib/message-a11y';
import { getSessionToken } from '@/lib/session-token';
import { isSameOriginStickerUrl, stickerImageSource } from '@/lib/stickers';

const STICKER_SIZE = 200;

type StickerMessageProps = {
  sticker: Sticker;
  message: UiMessage;
  outgoing: boolean;
  onLongPress: () => void;
};

// A sticker without a bubble: at most 200 pt, with time and ticks in a small pill. The image loads only from the same origin as the Zilar API; anything else shows the emoji or a placeholder, so a hostile sender cannot make every device fetch an arbitrary URL. The bearer rides along only to the API origin.
function StickerMessage({ sticker, message, outgoing, onLongPress }: StickerMessageProps) {
  const [broken, setBroken] = useState(false);
  const [token, setToken] = useState<string | undefined>(undefined);
  const trusted = isSameOriginStickerUrl(sticker.url, API_URL);
  const alt = sticker.emoji !== undefined && sticker.emoji !== '' ? sticker.emoji : 'Sticker';
  const ratio = sticker.width / sticker.height;

  useEffect(() => {
    if (!trusted) {
      return;
    }
    // The token read is a fiber: cleanup interrupts it, so a late answer for an old URL never sets the token.
    const read = Effect.runFork(
      Effect.promise(() => getSessionToken()).pipe(
        Effect.andThen((value) =>
          Effect.sync(() => {
            setToken(value);
          }),
        ),
      ),
    );
    return () => {
      Effect.runSync(Fiber.interrupt(read));
    };
  }, [trusted]);

  return (
    <Pressable
      onPress={() => router.push(`/stickers/${sticker.pack_id}`)}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="image"
      accessibilityLabel={messageAccessibilityLabel(message, outgoing)}
      accessibilityHint="Opens the sticker pack"
      className={cn('relative', outgoing ? 'items-end' : 'items-start')}
    >
      {trusted && !broken ? (
        <Image
          source={stickerImageSource(sticker.url, API_URL, token)}
          accessibilityLabel={alt}
          onError={() => setBroken(true)}
          style={{ width: STICKER_SIZE, aspectRatio: ratio, maxHeight: STICKER_SIZE }}
          contentFit="contain"
        />
      ) : (
        <View
          accessibilityRole="image"
          accessibilityLabel={alt}
          className="items-center justify-center rounded-[8px] border border-edge bg-surface"
          style={{ width: 120, height: 120 }}
        >
          <Text className="text-[40px] leading-none">{alt === 'Sticker' ? '🙂' : alt}</Text>
        </View>
      )}
      <View
        className="absolute right-1 bottom-1 flex-row items-center gap-1 rounded-full px-2 py-0.5"
        style={raisedPill}
      >
        <Text className="font-mono text-[11px] text-muted-foreground">{metaTimeText(message)}</Text>
        {outgoing ? (
          <Ticks
            status={message.status}
            color={message.status === 'read' ? SEEN : MUTED_FOREGROUND}
            size={13}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

// Quoted reply block at the top of a bubble: a bar and the replied-to sender's name in their colour, and the excerpt or a media label when the target has no text. With a chat-jump it is a button that jumps to the message; a long hold still opens the bubble menu.
function ReplyQuote({ message }: { message: UiMessage }) {
  const reply = message.replyTo;
  const jump = useChatJump();
  const openMenu = useOpenMessageMenu();
  // The wire reply carries no name: resolve the target from the loaded history.
  const referenced = useChatStore((state) =>
    reply === undefined
      ? undefined
      : state.messagesByChat[message.chatId]?.find((item) => item.id === reply.id),
  );
  const currentUserId = useChatStore((state) => state.currentUserId);
  if (reply === undefined) {
    return null;
  }
  const content = replyQuoteContent(reply, referenced, currentUserId);
  if (content === undefined) {
    return null;
  }
  const color = content.own ? ACCENT : senderColor(content.senderId);
  const block = (
    <>
      <View className="w-[3px]" style={{ backgroundColor: color }} />
      <View className="min-w-0 flex-1 px-2 py-1">
        <Text className="text-[13px] font-semibold" color={color}>
          {content.senderName}
        </Text>
        {content.text !== undefined ? (
          <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
            {lightToPlain(content.text)}
          </Text>
        ) : null}
      </View>
    </>
  );
  if (jump === undefined) {
    return <View className="mb-1 flex-row overflow-hidden rounded-md bg-surface">{block}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Go to the message from ${content.senderName}`}
      onPress={() => jump(reply.id)}
      onLongPress={openMenu}
      delayLongPress={LONG_PRESS_MS}
      className="mb-1 flex-row overflow-hidden rounded-md bg-surface"
    >
      {block}
    </Pressable>
  );
}

// The header a routine's live message shows above its text: a repeat icon, the routine title and its schedule. The row opens Settings › Routines.
function RoutineHeader({ routine }: { routine: RoutinePost }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Routines: ${routine.title}, ${routine.schedule}`}
      onPress={() => router.push('/settings/routines')}
      className="mb-1 min-h-6 flex-row items-center gap-2"
    >
      <Repeat size={14} color={MUTED_FOREGROUND} />
      <Text numberOfLines={1} className="shrink text-[13px] font-medium text-muted-foreground">
        {routine.title}
      </Text>
      <Text className="ml-auto shrink-0 font-mono text-[12px] text-muted-foreground">
        {routine.schedule}
      </Text>
    </Pressable>
  );
}

function ForwardedHeader({ origin }: { origin: ForwardOrigin }) {
  const label =
    origin.chat_name === undefined
      ? `Forwarded from ${origin.sender_name}`
      : `Forwarded from ${origin.sender_name} in ${origin.chat_name}`;
  return (
    <View className="mb-1 flex-row items-center gap-1">
      <Forward size={13} color={MUTED_FOREGROUND} />
      <Text numberOfLines={1} className="shrink text-[12px] italic text-muted-foreground">
        {label}
      </Text>
    </View>
  );
}

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
