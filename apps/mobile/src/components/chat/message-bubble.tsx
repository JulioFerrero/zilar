import { canDeleteMessage, canEditMessage, isBigEmoji, type UiMessage } from '@zilar/chat-core';
import { memo, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { Avatar } from '@/components/chat/avatar';
import { rendersMarkdown } from '@/components/chat/markdown-decision';
import { BubbleActionsSheet, openMessageMenu } from '@/components/chat/message-bubble-actions';
import {
  BigEmojiBubble,
  MessageBubbleContent,
  StickerBubble,
} from '@/components/chat/message-bubble-content';
import {
  appActiveSource,
  BubbleTail,
  GENERATING_FOREGROUND,
  LONG_PRESS_MS,
  SWAP_MS,
} from '@/components/chat/message-bubble-decor';
import { MessageTombstone } from '@/components/chat/message-bubble-tombstone';
import { stickerOf } from '@/components/chat/payload-card';
import { ReactionChips } from '@/components/chat/reaction-chips';
import { SwipeToReply } from '@/components/chat/swipe-to-reply';
import type { VoicePlayerHost } from '@/components/chat/voice-player';
import { Checkbox } from '@/components/ui/checkbox';
import { BUBBLE_COLORS } from '@/lib/colors';
import { WELL_BACKGROUND, bubbleStyle } from '@/lib/depth';
import { useSmoothText } from '@/lib/use-smooth-text';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/store/chat-store-provider';

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
  onEdit,
  onDelete,
  onForward,
  selecting = false,
  selected = false,
  onToggleSelect,
  onStartSelect,
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
  onPin,
  onUnpin,
}: MessageBubbleProps) {
  const colors = BUBBLE_COLORS;
  const reduceMotion = useReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const outgoing = message.senderId === currentUserId;
  // `MessageBubble` has no chat prop, so the shared Markdown rule is evaluated
  // against the store's chat for this message (AI DMs and AI group replies).
  const showMarkdown = useChatStore((state) =>
    rendersMarkdown(state.chats, message, currentUserId),
  );
  const meJid = useChatStore((state) => state.me?.jid ?? undefined);
  // Edit/Delete are user-side limits: my own text message under 48 h, or my
  // own message of any kind. Tombstones and live drafts offer neither. An
  // attachment message keeps delete (and copy of the caption); a long-press
  // Edit edits the caption through the same correction path web uses, keeping
  // the attachment payload (T-0157). `canEditMessage` (chat-core) already
  // limits to my own text-carrying messages within the window.
  const canEdit =
    !draft &&
    message.deleted !== true &&
    message.voice === undefined &&
    canEditMessage(message, currentUserId, new Date());
  const canDelete = !draft && message.deleted !== true && canDeleteMessage(message, currentUserId);
  // A forward copies what is already on screen: tombstones, still-sending
  // copies and my own failed sends have nothing to forward.
  const canForward =
    message.deleted !== true &&
    message.status !== 'sending' &&
    !(outgoing && message.status === 'failed');
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

  // The haptic is a native call the press does not wait for; it starts here,
  // in the press handler, and a failed haptic is ignored.
  const openMenu = () => openMessageMenu(setMenuOpen);

  // A failed sticker keeps its message and shows a Retry instead of a silent
  // "sending" state, like attachments do on web.
  const failedSticker = sticker !== undefined && message.failed === true;

  // A retracted message keeps its place as a slim tombstone, with no actions
  // and no reactions: web does the same.
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

  return (
    <>
      <SwipeToReply
        color={colors.incomingMeta}
        enabled={selecting !== true}
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
          {!outgoing && isGroup ? (
            showAvatar ? (
              <Avatar id={message.senderId} name={message.senderName} size={34} className="mr-2" />
            ) : (
              <View className="mr-2" style={{ width: 34 }} />
            )
          ) : null}
          <View className={cn('max-w-[80%] shrink', outgoing ? 'items-end' : 'items-start')}>
            <View className="relative">
              {sticker !== undefined ? (
                <StickerBubble
                  sticker={sticker}
                  message={message}
                  outgoing={outgoing}
                  showSenderName={showSenderName}
                  failed={failedSticker}
                  onRetry={onRetrySticker}
                  onLongPress={openMenu}
                />
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
                  <MessageBubbleContent
                    message={message}
                    outgoing={outgoing}
                    generating={generating}
                    showSenderName={showSenderName}
                    hasAttachment={hasAttachment}
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
      </SwipeToReply>
      <BubbleActionsSheet
        visible={menuOpen}
        confirmOpen={confirmOpen}
        message={message}
        canCopy={hasText && sticker === undefined}
        canEdit={sticker === undefined && message.voice === undefined && canEdit}
        canDelete={canDelete}
        canForward={onForward !== undefined && canForward}
        canPin={canPin}
        isPinned={isPinned}
        myReactions={myReactions}
        onReply={onReply}
        onEdit={onEdit}
        onDelete={onDelete}
        onForward={onForward}
        onStartSelect={onStartSelect}
        onPin={onPin}
        onUnpin={onUnpin}
        react={react}
        setMenuOpen={setMenuOpen}
        setConfirmOpen={setConfirmOpen}
      />
    </>
  );
}

/**
 * Memoised (T-0846): the list passes stable handlers, so a bubble re-renders
 * only when its own message, selection or flags change, not on every draft
 * token or store update elsewhere in the list.
 */
export const MessageBubble = memo(MessageBubbleImpl);
