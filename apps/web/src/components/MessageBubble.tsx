import { type ChatSummary, type UiMessage } from '@zilar/chat-core';
import { isCardAllowedFrom } from '@zilar/client-core';
import { senderAvatarUrl } from '@zilar/client-core/store';
import { Effect } from 'effect';
import { memo, useRef, useState } from 'react';
import { EntityAvatar } from './EntityAvatar';
import { ForwardedHeader } from './ForwardedHeader';
import { AttachmentBody } from './message/AttachmentBody';
import { BigEmoji } from './message/BigEmoji';
import { doubleClickReply } from './message/doubleClickReply';
import { MessageActionsButton, MessageMenu } from './message/MessageMenu';
import { MessageSender } from './message/MessageMeta';
import { MessageTextBody } from './message/MessageTextBody';
import { RoutineHeader } from './message/RoutineHeader';
import { hidesBodyText } from './message/QuestionCard';
import { MessageTombstone } from './message/MessageTombstone';
import { bubbleFlags, draftAnimates } from './message/bubbleFlags';
import { PersonLink } from './personLink';
import { ReactionChips } from './ReactionChips';
import { ReplyQuote } from './ReplyQuote';
import { StickerMessage } from './StickerMessage';
import { Checkbox } from './ui/checkbox';
import { fromApi } from '@/lib/effect/api-effect';
import { useAction } from '@/lib/effect/use-action';
import { scrollToMessage } from '@/lib/scrollToMessage';
import { useSmoothText } from '@/lib/useSmoothText';
import { cn } from '@/lib/utils';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';

export { SendFailure } from './message/SendFailure';

/** No known media host (mock store, signed out): every absolute URL is untrusted. */
const EMPTY_HOSTS: ReadonlySet<string> = new Set();

export interface MessageBubbleProps {
  message: UiMessage;
  chat: ChatSummary;
  firstInGroup: boolean;
  lastInGroup: boolean;
  currentUserId: string;
  /** My bare JID, for highlighting a mention of me. */
  meJid?: string | undefined;
  onReply: (message: UiMessage) => void;
  /** Opens the forward picker for this message. Omitted callers hide the item. */
  onForward?: (message: UiMessage) => void;
  /** Multi-select mode (T-0439): shows a checkbox and routes clicks to selection. */
  selecting?: boolean;
  /** True when this message is checked in select mode. */
  selected?: boolean;
  /** Toggles this message's checked state. */
  onToggleSelect?: (message: UiMessage) => void;
  /** Enters select mode with this message checked (the menu's Select item). */
  onStartSelect?: (message: UiMessage) => void;
  /** A live AI draft: same bubble, but recessed while it is written. */
  draft?: boolean;
  /**
   * The turn whose draft this final message continues (T-0045). The bubble
   * keeps revealing from the shown length and only becomes a normal message
   * once the reveal is done.
   */
  revealTurnId?: string | undefined;
  /** The pin on this message, resolved once per list (T-2011). */
  pinId?: string | undefined;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  chat,
  firstInGroup,
  lastInGroup,
  currentUserId,
  meJid,
  onReply,
  onForward,
  selecting = false,
  selected = false,
  onToggleSelect,
  onStartSelect,
  draft = false,
  revealTurnId,
  pinId,
}: MessageBubbleProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // A right-click opens the menu at the pointer; the "…" button leaves it
  // undefined so the menu keeps its old corner position.
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | undefined>(undefined);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const storeApi = useChatStoreApi();
  const mediaTrustedHosts = useChatSelector((s) => s.mediaTrustedHosts);
  const chatId = chat.id;
  const chatCanPin = useChatSelector((s) => s.canPin(chatId));
  // T-1996: the group detail carries a member's picture, the topic row an AI's.
  const groupMembers = useChatSelector((s) => s.groupInfos[chat.id]?.members);
  const senderAvatar = senderAvatarUrl(message.senderId, chat.topic?.ais, groupMembers);
  const senderPerson = { id: message.senderId, name: message.senderName, avatarUrl: senderAvatar };
  const mediaHosts = mediaTrustedHosts ?? EMPTY_HOSTS;
  const animate = draftAnimates(draft, revealTurnId);
  const { text, done } = useSmoothText(message.text ?? '', {
    animate,
    initial: 'full',
  });
  const {
    own,
    deleted,
    markdown,
    hasText,
    generating,
    transitioning,
    isSending,
    canForward,
    sticker,
    bigEmoji,
    showSender,
    mediaTop,
    attachmentImage,
    gifVideo,
    attachmentFile,
    failed,
    sendFailed,
    imageOnly,
    canEdit,
    canDelete,
    canPin,
  } = bubbleFlags({
    message,
    chat,
    currentUserId,
    firstInGroup,
    draft,
    revealTurnId,
    done,
    mediaHosts,
    chatCanPin,
    now: new Date(),
  });
  // A question card draws itself in place of the fallback body text (T-1578):
  // the bubble hides the text body, but keeps `hasText` for copy and the text
  // on the message for replies and search.
  const bodyText = hasText && !hidesBodyText(message.card);
  // A work (progress) card stands alone (T-1618): like `bigEmoji`, the message
  // draws no bubble surface around it and the card's own box is the only one.
  // A blocks card (T-1755) stands alone the same way.
  const standaloneCard = message.card?.type === 'progress' || message.card?.type === 'blocks';

  // A reply quote click: scroll when loaded, else load around it then scroll (PinnedBanner.tsx:40-55).
  const [, openQuote] = useAction((messageId: string) =>
    Effect.suspend(() =>
      scrollToMessage(messageId)
        ? Effect.void
        : fromApi(() => storeApi.getState().openAtMessage(chatId, messageId)).pipe(
            Effect.tap(() =>
              Effect.sync(() => window.requestAnimationFrame(() => scrollToMessage(messageId))),
            ),
          ),
    ),
  );

  const handleReact = (emoji: string): void => {
    storeApi.getState().react(chat.id, message.id, emoji);
  };

  // A retracted message keeps its place as a slim tombstone and has no actions.
  if (deleted) {
    return (
      <MessageTombstone
        message={message}
        own={own}
        showAvatarSlot={!own && chat.kind === 'group'}
        firstInGroup={firstInGroup}
        lastInGroup={lastInGroup}
      />
    );
  }

  // Both bubble layouts share one menu element; only the branch on screen
  // renders it. The failed sticker branch has no copy or edit items.
  const messageMenu = (
    <MessageMenu
      open={
        menuOpen && !generating && !selecting && (sticker === undefined || message.failed !== true)
      }
      message={message}
      chatId={chatId}
      pinId={pinId}
      menuButtonRef={menuButtonRef}
      canCopy={sticker === undefined && hasText}
      canEdit={sticker === undefined && canEdit}
      canDelete={canDelete}
      canPin={canPin}
      canForward={canForward}
      align={own ? 'right' : 'left'}
      point={menuPoint}
      onReply={() => onReply(message)}
      onForward={() => onForward?.(message)}
      onSelectMessages={() => onStartSelect?.(message)}
      onReact={handleReact}
      onClose={() => setMenuOpen(false)}
    />
  );

  return (
    <div
      data-message-id={message.id}
      data-draft-turn={revealTurnId}
      onContextMenu={
        generating || selecting
          ? undefined
          : (event) => {
              event.preventDefault();
              setMenuPoint({ x: event.clientX, y: event.clientY });
              setMenuOpen(true);
            }
      }
      onClick={
        selecting && !generating && canForward
          ? (event) => {
              if ((event.target as HTMLElement).closest('input[type="checkbox"]') !== null) {
                return;
              }
              onToggleSelect?.(message);
            }
          : undefined
      }
      onDoubleClick={generating || selecting ? undefined : doubleClickReply(() => onReply(message))}
      className={cn(
        'group relative flex items-end gap-1.5',
        own ? 'flex-row-reverse' : 'flex-row',
        firstInGroup ? 'mt-2' : 'mt-0.5',
        isSending && 'animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none',
        selecting && 'cursor-pointer',
      )}
    >
      {selecting && !generating && (
        <span className="flex shrink-0 items-center self-center">
          <Checkbox
            checked={selected}
            disabled={!canForward}
            label="Select message"
            onCheckedChange={() => onToggleSelect?.(message)}
          />
        </span>
      )}
      {!own &&
        chat.kind === 'group' &&
        (lastInGroup ? (
          <PersonLink target={{ jid: message.senderId }} name={message.senderName}>
            <EntityAvatar person={senderPerson} size={34} />
          </PersonLink>
        ) : (
          <span className="w-[34px] shrink-0" aria-hidden="true" />
        ))}
      <div className={cn('flex min-w-0 flex-col', own ? 'items-end' : 'items-start')}>
        {sticker !== undefined ? (
          <div className={cn('relative flex flex-col', own ? 'items-end' : 'items-start')}>
            {showSender && <MessageSender message={message} className="pb-1" />}
            {message.forward !== undefined && (
              <div className="mb-1">
                <ForwardedHeader origin={message.forward} />
              </div>
            )}
            {message.replyTo !== undefined && (
              <div className="mb-1 w-full max-w-[200px]">
                <ReplyQuote message={message} onOpen={() => openQuote(message.replyTo!.id)} />
              </div>
            )}
            <StickerMessage sticker={sticker} message={message} own={own} selecting={selecting} />
            {message.failed === true ? (
              <div className="mt-1.5 flex items-center gap-2 px-0.5 text-[12px] text-danger">
                <span>Send failed</span>
                <button
                  type="button"
                  aria-label="Retry sticker"
                  onClick={() => storeApi.getState().retrySticker(chat.id, message.id)}
                  className="font-semibold underline"
                >
                  Retry
                </button>
              </div>
            ) : (
              !generating &&
              !selecting && (
                <MessageActionsButton
                  buttonRef={menuButtonRef}
                  open={menuOpen}
                  onOpen={() => {
                    setMenuPoint(undefined);
                    setMenuOpen(true);
                  }}
                />
              )
            )}
            {messageMenu}
          </div>
        ) : (
          <div
            data-bubble-look={
              bigEmoji || standaloneCard
                ? undefined
                : own
                  ? 'outgoing'
                  : generating
                    ? 'generating'
                    : 'incoming'
            }
            className={cn(
              'relative flex min-w-0 flex-col',
              own ? 'max-w-[min(520px,100%)]' : 'max-w-[min(560px,100%)]',
              bigEmoji || standaloneCard
                ? undefined
                : cn(
                    'rounded-[14px] bg-clip-padding text-[14px] leading-[1.5]',
                    own ? 'bubble-out' : generating ? 'bubble-gen' : 'bubble-in',
                    transitioning &&
                      'transition-[color,background,box-shadow,border-color] duration-[400ms] ease-out motion-reduce:transition-none',
                    lastInGroup && (own ? 'rounded-br-[4px]' : 'rounded-bl-[4px]'),
                  ),
            )}
          >
            {showSender && <MessageSender message={message} className="px-3 pt-2" />}

            {message.forward !== undefined && (
              <div className="px-3 pt-2">
                <ForwardedHeader origin={message.forward} />
              </div>
            )}

            {message.replyTo !== undefined && (
              <div className="px-3 pt-2">
                <ReplyQuote message={message} onOpen={() => openQuote(message.replyTo!.id)} />
              </div>
            )}

            {message.card?.type === 'routine' &&
              isCardAllowedFrom(message.card, message.senderId) && (
                <div className="px-3 pt-2">
                  <RoutineHeader routine={message.card.data} />
                </div>
              )}

            {bigEmoji ? (
              <BigEmoji message={message} text={text} own={own} generating={generating} />
            ) : (
              <>
                <AttachmentBody
                  message={message}
                  chat={chat}
                  own={own}
                  hasText={bodyText}
                  imageOnly={imageOnly}
                  attachmentImage={attachmentImage}
                  attachmentFile={attachmentFile}
                  gifVideo={gifVideo}
                  sendFailed={sendFailed}
                  failed={failed}
                  isSending={isSending}
                  mediaTop={mediaTop}
                  lastInGroup={lastInGroup}
                />

                <MessageTextBody
                  message={message}
                  text={text}
                  own={own}
                  generating={generating}
                  markdown={markdown}
                  meJid={meJid}
                  hasText={bodyText}
                />
              </>
            )}

            {!generating && !selecting && (
              <MessageActionsButton
                buttonRef={menuButtonRef}
                open={menuOpen}
                onOpen={() => {
                  setMenuPoint(undefined);
                  setMenuOpen(true);
                }}
                beside={bigEmoji ? (own ? 'left' : 'right') : undefined}
              />
            )}
          </div>
        )}

        {sticker === undefined ? messageMenu : null}
        {!generating && message.reactions !== undefined && message.reactions.length > 0 && (
          <ReactionChips reactions={message.reactions} own={own} onToggle={handleReact} />
        )}
      </div>
    </div>
  );
});
