import {
  canDeleteMessage,
  canEditMessage,
  formatTime,
  isBigEmoji,
  type UiMessage,
} from '@zilar/chat-core';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Pressable, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { Avatar } from '@/components/chat/avatar';
import { AttachmentBody } from '@/components/chat/attachment-body';
import { ImageMessage } from '@/components/chat/image-message';
import { LinkText } from '@/components/chat/link-text';
import { rendersMarkdown } from '@/components/chat/markdown-decision';
import { MarkdownText } from '@/components/chat/markdown-text';
import { MessageActionsSheet } from '@/components/chat/message-actions-sheet';
import { PayloadCard, stickerOf } from '@/components/chat/payload-card';
import { ReactionChips } from '@/components/chat/reaction-chips';
import { ReplyQuote } from '@/components/chat/reply-quote';
import { StickerMessage } from '@/components/chat/sticker-message';
import { SwipeToReply } from '@/components/chat/swipe-to-reply';
import { Ticks } from '@/components/chat/ticks';
import { PulseDot } from '@/components/chat/typing-dots';
import { VoiceMessage } from '@/components/chat/voice-message';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { BUBBLE_COLORS } from '@/lib/colors';
import { WELL_BACKGROUND, bubbleStyle, raisedPill, senderColor } from '@/lib/depth';
import { useSmoothText, type ActiveSource } from '@/lib/use-smooth-text';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/store/chat-store-provider';
import { useColorScheme } from 'nativewind';

const TAIL_WIDTH = 9;
const TAIL_HEIGHT = 12;
const LONG_PRESS_MS = 350;
// Mirrors `--generating-foreground` in `src/global.css` (the bubble text while
// the AI is still writing).
const GENERATING_FOREGROUND = '#8f8f8f';
const CARET_COLOR = '#bdbdbd';
// The recessed generating look fades into the incoming look over this long.
const SWAP_MS = 400;

// The bubble follows the app's foreground state so a reply that arrives while
// the app was backgrounded snaps to its latest text instead of replaying.
const appActiveSource: ActiveSource = {
  subscribe: (onActive) => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        onActive();
      }
    });
    return () => subscription.remove();
  },
};

function BubbleTail({ outgoing, color }: { outgoing: boolean; color: string }) {
  return (
    <Svg
      width={TAIL_WIDTH}
      height={TAIL_HEIGHT}
      viewBox={`0 0 ${TAIL_WIDTH} ${TAIL_HEIGHT}`}
      style={
        outgoing
          ? { position: 'absolute', right: -8, bottom: 0 }
          : { position: 'absolute', left: -8, bottom: 0, transform: [{ scaleX: -1 }] }
      }
    >
      <Path
        d={`M0 0 C0.5 6.5 2.5 9.5 ${TAIL_WIDTH} ${TAIL_HEIGHT} L0 ${TAIL_HEIGHT} Z`}
        fill={color}
      />
    </Svg>
  );
}

function BubbleMeta({
  message,
  outgoing,
  color,
  className,
}: {
  message: UiMessage;
  outgoing: boolean;
  color: string;
  className?: string;
}) {
  return (
    <View className={cn('flex-row items-center gap-1', className)}>
      <Text className="font-mono text-[10px]" color={color}>
        {formatTime(message.createdAt)}
      </Text>
      {outgoing ? <Ticks status={message.status} color={color} size={13} /> : null}
    </View>
  );
}

/** Delivered/read ticks as glyphs, so they flow inline at the end of the text (as main did). */
function outgoingTicks(status: UiMessage['status']): string {
  if (status === 'sending') {
    return ' ○';
  }
  return status === 'read' ? ' ✓✓' : ' ✓';
}

/** A soft blinking caret at the end of a live draft (no blink with reduced motion). */
function DraftCaret({ reduceMotion }: { reduceMotion: boolean }) {
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.2, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity, reduceMotion]);
  return (
    <Animated.Text style={{ color: CARET_COLOR, opacity }} accessible={false}>
      ▍
    </Animated.Text>
  );
}

/** The recessed `generating` label under a reply that is still being written. */
function GeneratingLabel() {
  return (
    <View className="mt-1 flex-row items-center gap-1.5">
      <PulseDot color={GENERATING_FOREGROUND} size={5} />
      <Text className="font-mono text-[11px]" color={GENERATING_FOREGROUND}>
        generating
      </Text>
    </View>
  );
}

function BigEmoji({
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
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={LONG_PRESS_MS}
      className={cn('flex-col', outgoing ? 'items-end' : 'items-start')}
    >
      <Text
        className="px-2 py-1 text-[48px] leading-none text-foreground"
        {...(generating ? { color: GENERATING_FOREGROUND } : {})}
      >
        {text}
        {generating ? <DraftCaret reduceMotion={reduceMotion} /> : null}
      </Text>
      <View
        className="mt-1 flex-row items-center gap-1 self-center rounded-full px-2 py-0.5"
        style={raisedPill}
      >
        <Text className="font-mono text-[10px] text-muted-foreground">
          {message.edited === true ? 'edited ' : ''}
          {formatTime(message.createdAt)}
        </Text>
        {outgoing ? <Ticks status={message.status} color="#8a8a8a" size={13} /> : null}
      </View>
    </Pressable>
  );
}

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
   * The turn whose draft this final message continues (T-0056). The bubble keeps
   * revealing from the shown length and only becomes a normal message once the
   * reveal is done.
   */
  revealTurnId?: string;
  /** Called when the user picks a quick-reaction emoji or taps a chip. */
  onReact?: (message: UiMessage, emoji: string) => void;
  /** Called when the sheet asks to edit the message. */
  onEdit?: (message: UiMessage) => void;
  /** Called when the user confirms a delete-for-everyone. */
  onDelete?: (message: UiMessage) => void;
  /** Called when the sticker Retry is tapped on a failed sticker send. */
  onRetrySticker?: (message: UiMessage) => void;
  /** Called when the Retry is tapped on a failed attachment upload. */
  onRetryAttachment?: (message: UiMessage) => void;
  /** Called when Cancel is tapped while an attachment uploads. */
  onCancelAttachment?: (message: UiMessage) => void;
  /** Called when a file row is tapped (system open sheet). */
  onOpenAttachment?: (message: UiMessage) => void;
  /** The message id currently downloading for the open sheet. */
  openingAttachmentId?: string | undefined;
  /** Pin/unpin gating for chat of this message (T-0135). */
  canPin?: boolean;
  isPinned?: boolean;
  /** Called when the sheet asks to pin or unpin the message. */
  onPin?: (message: UiMessage) => void;
  onUnpin?: (message: UiMessage) => void;
};

export function MessageBubble({
  message,
  isGroup,
  isFirstInGroup,
  isLastInGroup,
  currentUserId,
  onReply,
  draft = false,
  revealTurnId,
  onReact,
  onEdit,
  onDelete,
  onRetrySticker,
  onRetryAttachment,
  onCancelAttachment,
  onOpenAttachment,
  openingAttachmentId,
  canPin,
  isPinned,
  onPin,
  onUnpin,
}: MessageBubbleProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const colors = BUBBLE_COLORS[scheme];
  const reduceMotion = useReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const outgoing = message.senderId === currentUserId;
  // `MessageBubble` has no chat prop, so the shared Markdown rule is evaluated
  // against the store's chat for this message (AI DMs and AI group replies).
  const showMarkdown = useChatStore((state) =>
    rendersMarkdown(state.chats, message, currentUserId),
  );
  // Edit/Delete are user-side limits: my own text message under 48 h, or my
  // own message of any kind. Tombstones and live drafts offer neither. An
  // attachment message keeps delete (and copy of the caption) but never
  // edits the file itself: the caption is plain text, edited like web
  // (web's composer edits the caption; the attachment payload is replaced
  // only by sending a new message).
  const canEdit =
    !draft &&
    message.deleted !== true &&
    message.attachment === undefined &&
    canEditMessage(message, currentUserId, new Date());
  const canDelete = !draft && message.deleted !== true && canDeleteMessage(message, currentUserId);
  const myReactions = (message.reactions ?? []).filter((entry) => entry.mine);
  const react = onReact ?? (() => {});
  const metaColor = outgoing ? colors.outgoingMeta : colors.incomingMeta;
  const hasText = message.text !== undefined && message.text.length > 0;
  const beyondDraft = revealTurnId !== undefined && !draft;
  const animate = draft || beyondDraft;
  const { text, done } = useSmoothText(message.text ?? '', {
    animate,
    initial: 'full',
    reducedMotion: reduceMotion,
    active: appActiveSource,
  });
  const generating = draft || (beyondDraft && !done);
  // A bubble that was ever written live keeps the recessed shell and fades the
  // incoming look in over it, so the swap has no jump.
  const everLive = !outgoing && (draft || revealTurnId !== undefined);
  const textColor = outgoing ? '#0a0a0a' : generating ? GENERATING_FOREGROUND : '#ededed';
  const [swap] = useState(() => new Animated.Value(generating ? 0 : 1));
  const wasGenerating = useRef(generating);
  useEffect(() => {
    if (wasGenerating.current && !generating) {
      if (reduceMotion) {
        swap.setValue(1);
      } else {
        Animated.timing(swap, {
          toValue: 1,
          duration: SWAP_MS,
          useNativeDriver: true,
        }).start();
      }
    } else if (!wasGenerating.current && generating) {
      swap.setValue(0);
    }
    wasGenerating.current = generating;
  }, [generating, reduceMotion, swap]);
  const bigEmoji =
    hasText &&
    message.replyTo === undefined &&
    message.image === undefined &&
    message.attachment === undefined &&
    message.voice === undefined &&
    message.card === undefined &&
    isBigEmoji(message.text ?? '');
  // A sticker renders without a bubble (validated against `StickerSchema`;
  // an invalid payload falls back to the body text like an unknown client).
  const sticker = stickerOf(message);
  // An attachment message carries the caption as its text: copy text is the
  // caption, pins and replies keep working (the reply quote shows the
  // caption via `previewBody`), and delete removes the whole message.
  const hasAttachment = message.attachment !== undefined;
  const showSenderName =
    isGroup && !outgoing && isFirstInGroup && !bigEmoji && sticker === undefined;
  const showAvatar = isGroup && !outgoing && isLastInGroup;

  const openMenu = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setMenuOpen(true);
  };

  // A failed sticker keeps its message and shows a Retry instead of a silent
  // "sending" state, like attachments do on web.
  const failedSticker = sticker !== undefined && message.failed === true;

  // A retracted message keeps its place as a slim tombstone, with no actions
  // and no reactions: web does the same.
  if (message.deleted === true) {
    return (
      <View
        className={cn(
          'flex-row px-2',
          outgoing ? 'justify-end' : 'items-end',
          isLastInGroup ? 'mb-2' : 'mb-0.5',
        )}
      >
        {!outgoing ? (
          showAvatar ? (
            <Avatar id={message.senderId} name={message.senderName} size={34} className="mr-2" />
          ) : (
            <View className="mr-2" style={{ width: 34 }} />
          )
        ) : null}
        <View className={cn('max-w-[80%] shrink', outgoing ? 'items-end' : 'items-start')}>
          <View
            className={cn(
              'rounded-[14px] bg-[#1a1a1a] px-3 py-1.5',
              outgoing ? 'rounded-br-[4px]' : 'rounded-bl-[4px]',
            )}
          >
            <Text className="text-[13px] italic text-muted-foreground">
              {outgoing ? 'You deleted this message' : 'This message was deleted'}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <>
      <SwipeToReply color={colors.incomingMeta} onReply={() => onReply(message)}>
        <View
          className={cn(
            'flex-row px-2',
            outgoing ? 'justify-end' : 'items-end',
            isLastInGroup ? 'mb-2' : 'mb-0.5',
          )}
        >
          {!outgoing ? (
            showAvatar ? (
              <Avatar id={message.senderId} name={message.senderName} size={34} className="mr-2" />
            ) : (
              <View className="mr-2" style={{ width: 34 }} />
            )
          ) : null}
          <View className={cn('max-w-[80%] shrink', outgoing ? 'items-end' : 'items-start')}>
            <View className="relative">
              {sticker !== undefined ? (
                <>
                  {showSenderName ? (
                    <Text
                      className="mb-0.5 text-[14px] font-semibold"
                      color={senderColor(message.senderId)}
                    >
                      {message.senderName}
                    </Text>
                  ) : null}
                  {message.replyTo ? <ReplyQuote reply={message.replyTo} /> : null}
                  <StickerMessage
                    sticker={sticker}
                    message={message}
                    outgoing={outgoing}
                    onLongPress={openMenu}
                  />
                  {failedSticker ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Retry sending sticker"
                      onPress={() => onRetrySticker?.(message)}
                      className="mt-1 rounded-[10px] bg-danger/20 px-3 py-1.5 active:opacity-80"
                    >
                      <Text className="text-[13px] font-semibold text-danger">
                        Couldn't send. Retry
                      </Text>
                    </Pressable>
                  ) : null}
                </>
              ) : bigEmoji ? (
                <BigEmoji
                  message={message}
                  text={text}
                  outgoing={outgoing}
                  generating={generating}
                  reduceMotion={reduceMotion}
                  onLongPress={generating ? () => {} : openMenu}
                />
              ) : (
                <Pressable
                  onLongPress={generating ? undefined : openMenu}
                  delayLongPress={LONG_PRESS_MS}
                  className="rounded-[14px] px-3 py-2"
                  style={bubbleStyle(
                    outgoing ? 'outgoing' : everLive ? 'generating' : 'incoming',
                    isLastInGroup,
                  )}
                >
                  {everLive ? (
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        StyleSheet.absoluteFill,
                        bubbleStyle('incoming', isLastInGroup),
                        { opacity: swap },
                      ]}
                    />
                  ) : null}
                  {showSenderName ? (
                    <Text
                      className="mb-0.5 text-[14px] font-semibold"
                      color={senderColor(message.senderId)}
                    >
                      {message.senderName}
                    </Text>
                  ) : null}
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
                        {outgoing ? (
                          <Ticks status={message.status} color="#8a8a8a" size={13} />
                        ) : null}
                      </View>
                      {message.text ? (
                        <Text className="mt-1 px-0.5 text-[15px]" color={textColor}>
                          {text}
                        </Text>
                      ) : null}
                    </View>
                  ) : message.voice ? (
                    <>
                      <VoiceMessage voice={message.voice} outgoing={outgoing} />
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
                        <Text
                          className="font-mono text-[10px]"
                          color={metaColor}
                          style={generating ? { opacity: 0 } : undefined}
                        >
                          {'  '}
                          {message.edited === true ? 'edited ' : ''}
                          {formatTime(message.createdAt)}
                          {outgoing ? outgoingTicks(message.status) : ''}
                        </Text>
                      </Text>
                      {generating ? <GeneratingLabel /> : null}
                    </>
                  ) : (
                    <>
                      <Text className="text-[15px] leading-5" color={textColor}>
                        <LinkText text={text} color={textColor} />
                        {generating ? <DraftCaret reduceMotion={reduceMotion} /> : null}
                        <Text
                          className="font-mono text-[10px]"
                          color={metaColor}
                          style={generating ? { opacity: 0 } : undefined}
                        >
                          {'  '}
                          {message.edited === true ? 'edited ' : ''}
                          {formatTime(message.createdAt)}
                          {outgoing ? outgoingTicks(message.status) : ''}
                        </Text>
                      </Text>
                      {generating ? <GeneratingLabel /> : null}
                    </>
                  )}
                </Pressable>
              )}
              {isLastInGroup ? (
                <BubbleTail
                  outgoing={outgoing}
                  // Match the body: the well colour while recessed/generating, and
                  // the gradient's bottom stop once the incoming look is in.
                  color={outgoing ? '#dedede' : generating ? WELL_BACKGROUND : '#161616'}
                />
              ) : null}
            </View>
            {isLastInGroup && message.reactions !== undefined && message.reactions.length > 0 ? (
              <ReactionChips
                reactions={message.reactions}
                outgoing={outgoing}
                onToggle={
                  onReact === undefined
                    ? undefined
                    : (emoji) => {
                        react(message, emoji);
                      }
                }
              />
            ) : null}
          </View>
        </View>
      </SwipeToReply>
      <MessageActionsSheet
        visible={menuOpen}
        canCopy={hasText && sticker === undefined}
        canEdit={sticker === undefined && !hasAttachment && canEdit}
        canDelete={canDelete}
        canPin={canPin}
        isPinned={isPinned}
        myReactions={myReactions}
        confirmOpen={confirmOpen}
        onReply={() => {
          setMenuOpen(false);
          onReply(message);
        }}
        onEdit={() => {
          setMenuOpen(false);
          onEdit?.(message);
        }}
        onCopy={() => {
          setMenuOpen(false);
          void Clipboard.setStringAsync(message.text ?? '');
        }}
        onDelete={() => {
          setConfirmOpen(true);
        }}
        onPin={() => {
          setMenuOpen(false);
          if (isPinned === true) {
            onUnpin?.(message);
          } else {
            onPin?.(message);
          }
        }}
        onCloseConfirm={() => setConfirmOpen(false)}
        onConfirmDelete={() => {
          setConfirmOpen(false);
          setMenuOpen(false);
          onDelete?.(message);
        }}
        onReact={(emoji) => {
          setMenuOpen(false);
          react(message, emoji);
        }}
        onClose={() => setMenuOpen(false)}
      />
    </>
  );
}
