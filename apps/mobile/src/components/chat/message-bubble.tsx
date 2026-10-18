import { canDeleteMessage, canEditMessage, isBigEmoji } from '@zilar/chat-core';
import { senderAvatarUrl } from '@zilar/client-core/store';
import { memo, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { useAlbumMembers } from '@/components/chat/album-members';
import { useChatRowFacts } from '@/components/chat/chat-row-facts';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { BubbleGesture } from '@/components/chat/bubble-gesture';
import { HandoffLine } from '@/components/chat/handoff-line';
import { openMessageMenu } from '@/components/chat/message-bubble-actions';
import { isMediaFirstMessage } from '@/components/chat/media-bubble';
import {
  BigEmojiBubble,
  MessageBubbleContent,
  type MessageBubbleProps,
  StickerBubble,
} from '@/components/chat/message-bubble-content';
import { appActiveSource, BubbleTail, LONG_PRESS_MS } from '@/components/chat/message-bubble-decor';
import { MessageTombstone } from '@/components/chat/message-bubble-tombstone';
import { useMessageMenu } from '@/components/chat/message-menu-host';
import { MessageMenuProvider } from '@/components/chat/message-menu-context';
import { stickerOf } from '@/components/chat/payload-card';
import { PersonPressable } from '@/components/chat/person-pressable';
import { ReactionChips } from '@/components/chat/reaction-chips';
import { RowGesture } from '@/components/chat/row-gesture';
import { Checkbox } from '@/components/ui/checkbox';
import { BUBBLE_COLORS, MUTED_FOREGROUND } from '@/lib/colors';
import { WELL_BACKGROUND, bubbleStyle } from '@/lib/depth';
import { useBubbleReveal } from '@/components/chat/use-bubble-reveal';
import { messageAccessibilityLabel } from '@/lib/message-a11y';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/store/chat-store-provider';

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
