import { formatTime, isBigEmoji, type UiMessage } from '@galena/chat-core';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Avatar } from '@/components/chat/avatar';
import { ImageMessage } from '@/components/chat/image-message';
import { LinkText } from '@/components/chat/link-text';
import { MessageActionsSheet } from '@/components/chat/message-actions-sheet';
import { PayloadCard } from '@/components/chat/payload-card';
import { ReplyQuote } from '@/components/chat/reply-quote';
import { SwipeToReply } from '@/components/chat/swipe-to-reply';
import { Ticks } from '@/components/chat/ticks';
import { VoiceMessage } from '@/components/chat/voice-message';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { BUBBLE_COLORS } from '@/lib/colors';
import { bubbleStyle, raisedPill, senderColor } from '@/lib/depth';
import { cn } from '@/lib/utils';
import { useColorScheme } from 'nativewind';

const TAIL_WIDTH = 9;
const TAIL_HEIGHT = 12;
const LONG_PRESS_MS = 350;

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

function BigEmoji({
  message,
  outgoing,
  onLongPress,
}: {
  message: UiMessage;
  outgoing: boolean;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={LONG_PRESS_MS}
      className={cn('flex-col', outgoing ? 'items-end' : 'items-start')}
    >
      <Text className="px-2 py-1 text-[48px] leading-none text-foreground">{message.text}</Text>
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
};

export function MessageBubble({
  message,
  isGroup,
  isFirstInGroup,
  isLastInGroup,
  currentUserId,
  onReply,
}: MessageBubbleProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const colors = BUBBLE_COLORS[scheme];
  const [menuOpen, setMenuOpen] = useState(false);
  const outgoing = message.senderId === currentUserId;
  const metaColor = outgoing ? colors.outgoingMeta : colors.incomingMeta;
  const textColor = outgoing ? '#0a0a0a' : '#ededed';
  const hasText = message.text !== undefined && message.text.length > 0;
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
                <BigEmoji message={message} outgoing={outgoing} onLongPress={openMenu} />
              ) : (
                <Pressable
                  onLongPress={openMenu}
                  delayLongPress={LONG_PRESS_MS}
                  className="rounded-[14px] px-3 py-2"
                  style={bubbleStyle(outgoing ? 'outgoing' : 'incoming', isLastInGroup)}
                >
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
                          {message.text}
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
                    <Text className="text-[15px] leading-5" color={textColor}>
                      <LinkText text={message.text ?? ''} color={textColor} />
                      <Text className="font-mono text-[10px]" color={metaColor}>
                        {'  '}
                        {formatTime(message.createdAt)}
                        {outgoing ? outgoingTicks(message.status) : ''}
                      </Text>
                    </Text>
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
