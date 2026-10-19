import {
  canDeleteMessage,
  canEditMessage,
  chipLabel,
  isBigEmoji,
  QUICK_REACTIONS,
  UiMessage,
  type AvatarPersonInput,
  type ChatSummary,
  type MentionMember,
  type UiReaction,
} from '@zilar/chat-core';
import { senderAvatarUrl } from '@zilar/client-core/store';
import {
  createContext,
  memo,
  useContext,
  useState,
  useMemo,
  type ReactNode,
  useEffect,
  useRef,
} from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { useChatRowFacts } from '@/components/chat/chat-row-facts';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { openMessageMenu } from '@/components/chat/message-bubble-actions';
import { isMediaFirstMessage } from '@/components/chat/media-bubble';
import {
  BigEmojiBubble,
  MessageBubbleContent,
  type MessageBubbleProps,
  StickerBubble,
} from '@/components/chat/message-bubble-content';
import {
  appActiveSource,
  BubbleTail,
  LONG_PRESS_MS,
  GENERATING_FOREGROUND,
  SWAP_MS,
} from '@/components/chat/message-bubble-decor';
import { useMessageMenu } from '@/components/chat/message-menu-host';
import { MessageMenuProvider } from '@/components/chat/message-menu-context';
import { stickerOf } from '@/components/chat/payload-card';
import { PersonPressable } from '@/components/chat/person-pressable';
import { Checkbox } from '@/components/ui/checkbox';
import { BUBBLE_COLORS, MUTED_FOREGROUND } from '@/lib/colors';
import { WELL_BACKGROUND, bubbleStyle, raisedPill } from '@/lib/depth';
import { messageAccessibilityLabel } from '@/lib/message-a11y';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/store/chat-store-provider';
import { tap as tapHaptic } from './haptics';
import {
  Gesture,
  GestureDetector,
  type PanGesture,
  type TapGesture,
} from 'react-native-gesture-handler';
import { Text } from '@/components/ui/text';
import { type HandoffLine as HandoffLineData, jidLocal } from '@zilar/protocol';
import { ArrowRight, Reply } from 'lucide-react-native';
import type { Contact } from '@/lib/chat-api';
import { interruptFiber, runLater, useAlbumMembers, useSmoothText } from '@zilar/client-core';
import type { ActiveSource } from '@zilar/chat-core';

/** How long the "who reacted" line stays under the chips. */
const REACTORS_VISIBLE_MS = 3000;

interface ReactionChipsProps {
  reactions: UiReaction[];
  outgoing: boolean;
  onToggle?: (emoji: string) => void;
}

// The raised reaction pills under a bubble. Mine use a brighter accent. With `onToggle` a chip is a toggle: tapping one I already reacted with clears it.
function ReactionChips({ reactions, outgoing, onToggle }: ReactionChipsProps) {
  const [shown, setShown] = useState<{ emoji: string; names: string[] } | null>(null);

  useEffect(() => {
    if (shown === null) {
      return undefined;
    }
    const hide = runLater(REACTORS_VISIBLE_MS, () => setShown(null));
    return () => {
      interruptFiber(hide);
    };
  }, [shown]);

  if (reactions.length === 0) {
    return null;
  }

  return (
    <View className={cn('mt-1', outgoing ? 'self-end' : 'self-start')}>
      <View accessibilityRole="text" className="flex-row flex-wrap gap-1">
        {reactions.map((reaction) => {
          const togglable = onToggle !== undefined;
          return (
            <Pressable
              key={reaction.emoji}
              accessibilityLabel={chipLabel(reaction)}
              accessibilityHint="Long press to see who reacted"
              accessibilityState={{ selected: reaction.mine }}
              hitSlop={8}
              delayLongPress={350}
              onPress={() => onToggle?.(reaction.emoji)}
              onLongPress={() => setShown({ emoji: reaction.emoji, names: reaction.reactors })}
              className={cn(
                'flex-row items-center gap-1 rounded-full px-2 py-1',
                togglable ? 'active:opacity-80' : null,
                reaction.mine ? 'bg-[#ededed]' : null,
              )}
              style={reaction.mine ? null : raisedPill}
            >
              <Text className="text-[13px] leading-[17px]">{reaction.emoji}</Text>
              <Text
                className={cn(
                  'font-mono text-[11px] tabular-nums leading-none',
                  reaction.mine ? 'text-[#0a0a0a]' : 'text-muted-foreground',
                )}
              >
                {reaction.count}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {shown !== null ? (
        <Text
          numberOfLines={2}
          className={cn('mt-1 text-[12px] text-muted-foreground', outgoing ? 'self-end' : null)}
        >
          {shown.emoji} {shown.names.join(', ')}
        </Text>
      ) : null}
    </View>
  );
}

interface PersonSources {
  members: readonly MentionMember[];
  contacts: readonly Contact[];
  chats: readonly ChatSummary[];
}

/** Resolves from the chat's members, then contacts and AIs, then the JID
 *  localpart, so a line always names something. */
function personFor(jid: string, sources: PersonSources, fallbackName = ''): AvatarPersonInput {
  const member = sources.members.find((entry) => entry.jid === jid);
  const contact = sources.contacts.find((entry) => entry.jid === jid);
  const chat = sources.chats.find((entry) => entry.id === jid);
  const name =
    member?.name ??
    contact?.name ??
    chat?.title ??
    (fallbackName === '' ? jidLocal(jid) : fallbackName);
  const avatarUrl = contact?.avatarUrl ?? chat?.avatarUrl;
  return { id: jid, name, ...(avatarUrl === undefined ? {} : { avatarUrl }) };
}

interface HandoffLineProps {
  card: HandoffLineData;
  chatId: string;
  senderName: string;
  onToggle: () => void;
}

function HandoffLine({ card, chatId, senderName, onToggle }: HandoffLineProps) {
  const contacts = useChatStore((state) => state.contacts);
  const chats = useChatStore((state) => state.chats);
  const groupMembers = useChatStore((state) => state.groupMembers);
  // Reads `groupMembers` to re-resolve when an async group detail lands.
  useChatStore((state) => state.groupDetailsRevision);
  const sources: PersonSources = { members: groupMembers(chatId), contacts, chats };
  const from = personFor(card.from, sources, senderName);
  const to = card.to.map((jid) => personFor(jid, sources));
  const targets = to.map((person) => person.name).join(', ');
  const handedOff = `${from.name} handed off to ${targets}`;
  const label = card.task === '' ? handedOff : `${handedOff}: ${card.task}`;

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-row items-center gap-2"
    >
      <EntityAvatar person={from} size={16} ai />
      <ArrowRight size={14} color={MUTED_FOREGROUND} />
      {to.map((person, index) => (
        <EntityAvatar key={card.to[index]} person={person} size={16} ai />
      ))}
      {card.task !== '' ? (
        <Text numberOfLines={1} className="shrink text-[14px]" color={MUTED_FOREGROUND}>
          {card.task}
        </Text>
      ) : null}
    </Pressable>
  );
}

function useBubbleReveal({
  message,
  outgoing,
  draft,
  revealTurnId,
  reduceMotion,
  appActiveSource,
}: {
  message: UiMessage;
  outgoing: boolean;
  draft: boolean;
  revealTurnId: string | undefined;
  reduceMotion: boolean;
  appActiveSource: ActiveSource;
}) {
  const beyondDraft = revealTurnId !== undefined && !draft;
  const animate = draft || beyondDraft;
  const { text, done } = useSmoothText(message.text ?? '', {
    animate,
    initial: 'full',
    reducedMotion: reduceMotion,
    active: appActiveSource,
  });
  const generating = draft || (beyondDraft && !done);
  // A bubble ever written live keeps the recessed shell and fades the incoming look in over it, so the swap has no jump.
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
  return { text, generating, everLive, textColor, swap };
}

function MessageTombstone({
  message,
  outgoing,
  isGroup,
  isLastInGroup,
}: {
  message: UiMessage;
  outgoing: boolean;
  isGroup: boolean;
  isLastInGroup: boolean;
}) {
  const showAvatar = isGroup && !outgoing && isLastInGroup;
  return (
    <View
      className={cn(
        'flex-row px-2',
        outgoing ? 'justify-end' : 'items-end',
        isLastInGroup ? 'mb-2' : 'mb-0.5',
      )}
    >
      {!outgoing && isGroup ? (
        showAvatar ? (
          <EntityAvatar
            person={{ id: message.senderId, name: message.senderName }}
            size={34}
            className="mr-2"
          />
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

type BubbleGestureProps = {
  message: UiMessage;
  onReact?: ((message: UiMessage, emoji: string) => void) | undefined;
  enabled?: boolean;
  className?: string;
  children: ReactNode;
};

/** The tap is linked to the row's swipe pan so both run; a swipe still replies. */
function BubbleGesture({
  message,
  onReact,
  enabled = true,
  className,
  children,
}: BubbleGestureProps) {
  const rowPan = useContext(RowPanContext);
  const canReact =
    onReact !== undefined && enabled && message.status !== 'sending' && message.status !== 'failed';
  const doubleTap = useMemo(() => {
    const tap: TapGesture = Gesture.Tap()
      .numberOfTaps(2)
      .enabled(canReact)
      .runOnJS(true)
      .onEnd(() => {
        tapHaptic();
        onReact?.(message, QUICK_REACTIONS[0]);
      });
    return rowPan === null ? tap : tap.simultaneousWithExternalGesture(rowPan);
  }, [canReact, message, onReact, rowPan]);
  return (
    <GestureDetector gesture={doubleTap}>
      <View className={className}>{children}</View>
    </GestureDetector>
  );
}

function MessageBubbleImpl({
  message,
  isGroup,
  isFirstInGroup,
  isLastInGroup,
  currentUserId,
  onReply,
  draft = false,
  revealTurnId,
  onReact,
  onForward,
  selecting = false,
  selected = false,
  onToggleSelect,
  onRetrySticker,
  onRetryAttachment,
  onCancelAttachment,
  onRetryVoice,
  onCancelVoice,
  onOpenAttachment,
  openingAttachmentId,
  voiceHost,
  canPin,
  isPinned,
}: MessageBubbleProps) {
  const colors = BUBBLE_COLORS;
  const reduceMotion = useReducedMotion();
  const menu = useMessageMenu();
  const members = useAlbumMembers();
  // A press on the handoff line toggles the full one.
  const [handoffOpen, setHandoffOpen] = useState(false);
  const outgoing = message.senderId === currentUserId;
  // Per-chat facts come from the list's one context, not a store subscription per row.
  const { mediaHosts, showMarkdown: rendersMessageMarkdown, meJid, chat } = useChatRowFacts();
  const mediaFirst = isMediaFirstMessage(message, mediaHosts);
  const showMarkdown = rendersMessageMarkdown(message);
  // Edit/Delete are user-side limits: my own text under 48 h, or my own message of any kind. A long-press Edit edits an attachment's caption through the same correction path web uses.
  const canEdit =
    !draft &&
    message.deleted !== true &&
    message.voice === undefined &&
    canEditMessage(message, currentUserId, new Date());
  const canDelete = !draft && message.deleted !== true && canDeleteMessage(message, currentUserId);
  // In a DM every message that is not deleted or still sending can be deleted from my copy; my own can also be deleted for everyone.
  const isDm = chat.kind === 'dm' && chat.isAI !== true;
  // A sender's real picture (an AI's from the topic row, a member's from the group detail); the ball seeded from the name is only the fallback.
  const senderAvatar = useChatStore((state) => {
    if (outgoing || !isGroup) {
      return undefined;
    }
    const groupId = chat.groupId ?? state.groupIdForChat(message.chatId);
    const members = groupId === undefined ? undefined : state.groupDetail(groupId)?.members;
    return senderAvatarUrl(message.senderId, chat.topic?.ais, members);
  });
  const canDeleteForMe = !draft && isDm && message.deleted !== true && message.status !== 'sending';
  // A forward copies what is on screen: tombstones, still-sending and failed sends have nothing to forward.
  const canForward =
    message.deleted !== true &&
    message.status !== 'sending' &&
    !(outgoing && message.status === 'failed');
  const myReactions = (message.reactions ?? []).filter((entry) => entry.mine);
  const react = onReact ?? (() => {});
  const metaColor = outgoing ? colors.outgoingMeta : MUTED_FOREGROUND;
  const hasText = message.text !== undefined && message.text.length > 0;
  const { text, generating, everLive, textColor, swap } = useBubbleReveal({
    message,
    outgoing,
    draft,
    revealTurnId,
    reduceMotion,
    appActiveSource,
  });
  const bigEmoji =
    hasText &&
    message.replyTo === undefined &&
    message.image === undefined &&
    message.attachment === undefined &&
    message.voice === undefined &&
    message.card === undefined &&
    isBigEmoji(message.text ?? '');
  // A sticker renders without a bubble; an invalid payload falls back to the body text like an unknown client.
  const sticker = stickerOf(message);
  const standaloneCard = message.card?.type === 'progress' || message.card?.type === 'blocks';
  const handoff = message.card?.type === 'handoff.line' ? message.card.data : undefined;
  // An attachment's caption is its text: copy, pins and replies use it, and delete removes the whole message.
  const hasAttachment = message.attachment !== undefined;
  const showSenderName =
    isGroup && !outgoing && isFirstInGroup && !bigEmoji && sticker === undefined;
  const showAvatar = isGroup && !outgoing && isLastInGroup;
  // No tail without a bubble: a sticker, a lone big emoji and media with no caption have no surface for it.
  const showTail = isLastInGroup && sticker === undefined && !bigEmoji && !(mediaFirst && !hasText);

  // The haptic starts in the press handler and is not awaited; a failed one is ignored. The target carries this row's flags and album.
  const openMenu = () =>
    openMessageMenu(() =>
      menu.open({
        message,
        albumMembers:
          message.album !== undefined && members !== null && members.length >= 2
            ? [...members]
            : undefined,
        canCopy: hasText && sticker === undefined,
        canEdit: sticker === undefined && message.voice === undefined && canEdit,
        canDelete,
        canDeleteForMe,
        isDm,
        own: outgoing,
        senderName: message.senderName,
        canForward: onForward !== undefined && canForward,
        canPin,
        isPinned,
        myReactions,
      }),
    );

  // A failed sticker keeps its message and shows Retry instead of a silent "sending".
  const failedSticker = sticker !== undefined && message.failed === true;

  // A retracted message keeps its place as a slim tombstone with no actions and no reactions, like web.
  if (message.deleted === true) {
    return (
      <MessageTombstone
        message={message}
        outgoing={outgoing}
        isGroup={isGroup}
        isLastInGroup={isLastInGroup}
      />
    );
  }

  const bubbleBody = (
    <MessageMenuProvider openMenu={generating ? undefined : openMenu}>
      <MessageBubbleContent
        message={message}
        isGroup={isGroup}
        outgoing={outgoing}
        generating={generating}
        showSenderName={showSenderName}
        hasAttachment={hasAttachment}
        mediaFirst={mediaFirst}
        showMarkdown={showMarkdown}
        text={text}
        textColor={textColor}
        metaColor={metaColor}
        reduceMotion={reduceMotion}
        meJid={meJid}
        onRetryAttachment={onRetryAttachment}
        onCancelAttachment={onCancelAttachment}
        onOpenAttachment={onOpenAttachment}
        openingAttachmentId={openingAttachmentId}
        onRetryVoice={onRetryVoice}
        onCancelVoice={onCancelVoice}
        voiceHost={voiceHost}
      />
    </MessageMenuProvider>
  );

  const bubbleColumn = (
    <View className={cn('max-w-[80%] shrink', outgoing ? 'items-end' : 'items-start')}>
      <BubbleGesture
        message={message}
        onReact={onReact}
        enabled={selecting !== true && !draft}
        className="relative"
      >
        {sticker !== undefined ? (
          <MessageMenuProvider openMenu={openMenu}>
            <StickerBubble
              sticker={sticker}
              message={message}
              outgoing={outgoing}
              showSenderName={showSenderName}
              failed={failedSticker}
              onRetry={onRetrySticker}
              onLongPress={openMenu}
            />
          </MessageMenuProvider>
        ) : standaloneCard ? (
          <Pressable
            onLongPress={generating ? undefined : openMenu}
            delayLongPress={LONG_PRESS_MS}
            accessibilityLabel={messageAccessibilityLabel(message, outgoing)}
          >
            {bubbleBody}
          </Pressable>
        ) : bigEmoji ? (
          <BigEmojiBubble
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
            accessibilityLabel={messageAccessibilityLabel(message, outgoing)}
            className={cn('rounded-[14px]', mediaFirst ? 'overflow-hidden' : 'px-3 py-2')}
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
            {bubbleBody}
          </Pressable>
        )}
        {showTail ? (
          <BubbleTail
            outgoing={outgoing}
            // Match the body: the well colour while recessed/generating, the gradient's bottom stop once the incoming look is in.
            color={outgoing ? '#dedede' : generating ? WELL_BACKGROUND : '#161616'}
          />
        ) : null}
      </BubbleGesture>
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
  );

  return (
    <RowGesture
      color={colors.incomingMeta}
      swipeEnabled={selecting !== true}
      onReply={() => onReply(message)}
    >
      <View
        className={cn(
          'relative flex-row px-2',
          outgoing ? 'justify-end' : 'items-end',
          isLastInGroup ? 'mb-2' : 'mb-0.5',
        )}
      >
        {selecting ? (
          <View className="mr-2 self-center">
            <Checkbox checked={selected} disabled={!canForward} />
          </View>
        ) : null}
        {!outgoing && isGroup && handoff === undefined ? (
          showAvatar ? (
            <PersonPressable target={{ jid: message.senderId }} name={message.senderName}>
              <EntityAvatar
                person={{
                  id: message.senderId,
                  name: message.senderName,
                  ...(senderAvatar === undefined ? {} : { avatarUrl: senderAvatar }),
                }}
                size={34}
                className="mr-2"
              />
            </PersonPressable>
          ) : (
            <View className="mr-2" style={{ width: 34 }} />
          )
        ) : null}
        {handoff !== undefined ? (
          <View className="min-w-0 flex-1 items-center">
            <HandoffLine
              card={handoff}
              chatId={message.chatId}
              senderName={message.senderName}
              onToggle={() => setHandoffOpen((open) => !open)}
            />
            {handoffOpen ? <View className="mt-1 w-full">{bubbleColumn}</View> : null}
          </View>
        ) : (
          bubbleColumn
        )}
        {selecting ? (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected === true, disabled: !canForward }}
            accessibilityLabel="Select message"
            onPress={() => {
              if (canForward) {
                onToggleSelect?.(message);
              }
            }}
            className="absolute inset-0"
          />
        ) : null}
      </View>
    </RowGesture>
  );
}

// Memoised: a bubble re-renders only when its own message, selection or flags change.
export const MessageBubble = memo(MessageBubbleImpl);

const SPRING_BACK = { damping: 1000, stiffness: 700, overshootClamping: true } as const;

// A rightward drag moves the row up to 96 px; past 60 px it replies on release, and it always springs back.
function makePan(
  enabled: boolean,
  translateX: SharedValue<number>,
  fireReply: () => void,
): PanGesture {
  return (
    Gesture.Pan()
      .enabled(enabled)
      // Only the activation distance, so the pan starts after a 12 px rightward drag.
      .activeOffsetX(12)
      .failOffsetY([-10, 10])
      .onUpdate((event) => {
        translateX.value = Math.min(Math.max(event.translationX, 0), 96);
      })
      .onEnd((_event, success) => {
        if (success && translateX.value >= 60) {
          runOnJS(fireReply)();
        }
      })
      .onFinalize(() => {
        translateX.value = withSpring(0, SPRING_BACK);
      })
  );
}

// A stable callback: the pan keeps its identity across renders while calling this render's reply.
function useStableVoidCallback(callback: () => void): () => void {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  }, [callback]);
  return useMemo(() => () => latest.current(), []);
}

// The bubble's double-tap lives in its own detector but must not cancel the row's swipe, so it finds the pan here and runs beside it.
const RowPanContext = createContext<PanGesture | null>(null);

// Swipe-to-reply without `ReanimatedSwipeable`: one pan, one shared value. It starts only on a rightward drag and fails on vertical movement, so a fling never swipes a row; past 60 px a haptic fires and replies, and the row always springs back.
function RowGesture({
  color,
  onReply,
  swipeEnabled = true,
  children,
}: {
  color: string;
  onReply: () => void;
  swipeEnabled?: boolean;
  children: ReactNode;
}) {
  const translateX = useSharedValue(0);
  // The pan keeps its identity across renders by reading the reply through a stable function.
  const fireReply = useStableVoidCallback(() => {
    tapHaptic();
    onReply();
  });

  const pan = useMemo(
    () => makePan(swipeEnabled, translateX, fireReply),
    [fireReply, swipeEnabled, translateX],
  );

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  const replyStyle = useAnimatedStyle(() => {
    const value = Math.min(translateX.value / 60, 1);
    return { opacity: value, transform: [{ scale: 0.7 + 0.3 * value }] };
  });

  return (
    <RowPanContext.Provider value={pan}>
      <GestureDetector gesture={pan}>
        <View style={{ overflow: 'hidden' }}>
          <Reanimated.View
            pointerEvents="none"
            style={[
              replyStyle,
              {
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width: 72,
                alignItems: 'center',
                justifyContent: 'center',
              },
            ]}
          >
            <Reply size={22} color={color} />
          </Reanimated.View>
          <Reanimated.View style={rowStyle}>{children}</Reanimated.View>
        </View>
      </GestureDetector>
    </RowPanContext.Provider>
  );
}
