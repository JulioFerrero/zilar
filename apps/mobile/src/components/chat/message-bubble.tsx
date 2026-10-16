import { canDeleteMessage, canEditMessage, isBigEmoji } from '@zilar/chat-core';
import { memo, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { BubbleGesture } from '@/components/chat/bubble-gesture';
import { HandoffLine } from '@/components/chat/handoff-line';
import { rendersMarkdown } from '@/components/chat/markdown-decision';
import { BubbleActionsSheet, openMessageMenu } from '@/components/chat/message-bubble-actions';
import { isMediaFirstMessage } from '@/components/chat/media-bubble';
import {
  BigEmojiBubble,
  MessageBubbleContent,
  type MessageBubbleProps,
  StickerBubble,
} from '@/components/chat/message-bubble-content';
import { appActiveSource, BubbleTail, LONG_PRESS_MS } from '@/components/chat/message-bubble-decor';
import { MessageTombstone } from '@/components/chat/message-bubble-tombstone';
import { MessageMenuProvider } from '@/components/chat/message-menu-context';
import { stickerOf } from '@/components/chat/payload-card';
import { ReactionChips } from '@/components/chat/reaction-chips';
import { SwipeToReply } from '@/components/chat/swipe-to-reply';
import { Checkbox } from '@/components/ui/checkbox';
import { BUBBLE_COLORS, MUTED_FOREGROUND } from '@/lib/colors';
import { WELL_BACKGROUND, bubbleStyle } from '@/lib/depth';
import { useBubbleReveal } from '@/components/chat/use-bubble-reveal';
import { messageAccessibilityLabel } from '@/lib/message-a11y';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/store/chat-store-provider';

const EMPTY_HOSTS: ReadonlySet<string> = new Set();

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
  // T-1575: the handoff line replaces the bubble; a press toggles the full one.
  const [handoffOpen, setHandoffOpen] = useState(false);
  const outgoing = message.senderId === currentUserId;
  const mediaHosts = useChatStore((state) => state.mediaTrustedHosts) ?? EMPTY_HOSTS;
  const mediaFirst = isMediaFirstMessage(message, mediaHosts);
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
  // T-1247: in a DM (and not an AI chat) every message that is not deleted or
  // still sending can be deleted from my own copy; my own message can also be
  // deleted for everyone (`canDelete` above).
  const chat = useChatStore((state) => state.chats.find((entry) => entry.id === message.chatId));
  const isDm = chat?.kind === 'dm' && chat.isAI !== true;
  const canDeleteForMe = !draft && isDm && message.deleted !== true && message.status !== 'sending';
  // A forward copies what is already on screen: tombstones, still-sending
  // copies and my own failed sends have nothing to forward.
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
  // A sticker renders without a bubble (validated against `StickerSchema`;
  // an invalid payload falls back to the body text like an unknown client).
  const sticker = stickerOf(message);
  // T-1619: the AI work card renders without a bubble, the way a sticker skips
  // it; the card carries its own surface (payload-card.tsx) and no meta row.
  // T-1756: a blocks card is standalone the same way.
  const standaloneCard = message.card?.type === 'progress' || message.card?.type === 'blocks';
  // T-1575: a `handoff.line` card renders the small centred line instead of the
  // bubble, exactly like a sticker skips it.
  const handoff = message.card?.type === 'handoff.line' ? message.card.data : undefined;
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

  const bubbleBody = (
    <MessageMenuProvider openMenu={generating ? undefined : openMenu}>
      <MessageBubbleContent
        message={message}
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
        {isLastInGroup ? (
          <BubbleTail
            outgoing={outgoing}
            // Match the body: the well colour while recessed/generating, and
            // the gradient's bottom stop once the incoming look is in.
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
          {!outgoing && isGroup && handoff === undefined ? (
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
      </SwipeToReply>
      <BubbleActionsSheet
        visible={menuOpen}
        confirmOpen={confirmOpen}
        message={message}
        canCopy={hasText && sticker === undefined}
        canEdit={sticker === undefined && message.voice === undefined && canEdit}
        canDelete={canDelete}
        canDeleteForMe={canDeleteForMe}
        isDm={isDm}
        own={outgoing}
        senderName={message.senderName}
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
 * Memoised (T-0846): a bubble re-renders only when its own message, selection
 * or flags change, not on every draft token or store update in the list.
 */
export const MessageBubble = memo(MessageBubbleImpl);
