import { formatTime, isBigEmoji, type UiMessage } from '@galena/chat-core';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Pressable, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { Avatar } from '@/components/chat/avatar';
import { ImageMessage } from '@/components/chat/image-message';
import { LinkText } from '@/components/chat/link-text';
import { MessageActionsSheet } from '@/components/chat/message-actions-sheet';
import { PayloadCard } from '@/components/chat/payload-card';
import { ReplyQuote } from '@/components/chat/reply-quote';
import { SwipeToReply } from '@/components/chat/swipe-to-reply';
import { Ticks } from '@/components/chat/ticks';
import { PulseDot } from '@/components/chat/typing-dots';
import { VoiceMessage } from '@/components/chat/voice-message';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { BUBBLE_COLORS } from '@/lib/colors';
import { bubbleStyle, raisedPill, senderColor } from '@/lib/depth';
import { useSmoothText, type ActiveSource } from '@/lib/use-smooth-text';
import { cn } from '@/lib/utils';
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
}: MessageBubbleProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const colors = BUBBLE_COLORS[scheme];
  const reduceMotion = useReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const outgoing = message.senderId === currentUserId;
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
    message.voice === undefined &&
    message.card === undefined &&
    isBigEmoji(message.text ?? '');
  const showSenderName = isGroup && !outgoing && isFirstInGroup && !bigEmoji;
  const showAvatar = isGroup && !outgoing && isLastInGroup;

  const openMenu = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setMenuOpen(true);
  };

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
              {bigEmoji ? (
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
                  {message.card ? (
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
                  // The gradient's bottom stop, so the tail has no seam with the body.
                  color={outgoing ? '#dedede' : '#161616'}
                />
              ) : null}
            </View>
          </View>
        </View>
      </SwipeToReply>
      <MessageActionsSheet
        visible={menuOpen}
        canCopy={hasText}
        onReply={() => {
          setMenuOpen(false);
          onReply(message);
        }}
        onCopy={() => {
          setMenuOpen(false);
          void Clipboard.setStringAsync(message.text ?? '');
        }}
        onClose={() => setMenuOpen(false)}
      />
    </>
  );
}
