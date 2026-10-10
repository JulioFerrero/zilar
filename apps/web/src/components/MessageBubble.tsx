import {
  canDeleteMessage,
  canEditMessage,
  isBigEmoji,
  shouldRenderMarkdown,
  type ChatSummary,
  type UiMessage,
} from '@zilar/chat-core';
import { memo, useRef, useState } from 'react';
import { Avatar } from './Avatar';
import { ForwardedHeader } from './ForwardedHeader';
import { isGifVideoAttachment } from './GifMessage';
import { AttachmentBody } from './message/AttachmentBody';
import { BigEmoji } from './message/BigEmoji';
import { MessageActionsButton, MessageMenu } from './message/MessageMenu';
import { MessageSender } from './message/MessageMeta';
import { MessageTextBody } from './message/MessageTextBody';
import { ReactionChips } from './ReactionChips';
import { ReplyQuote } from './ReplyQuote';
import { StickerMessage } from './StickerMessage';
import { Checkbox } from './ui/checkbox';
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
}: MessageBubbleProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const storeApi = useChatStoreApi();
  const mediaTrustedHosts = useChatSelector((s) => s.mediaTrustedHosts);
  const chatId = chat.id;
  const chatCanPin = useChatSelector((s) => s.canPin(chatId));
  const pin = useChatSelector((s) => s.pinFor(chatId, message.id));
  const own = message.senderId === currentUserId;
  const deleted = message.deleted === true;
  const markdown = shouldRenderMarkdown(chat, message, currentUserId);
  const hasText = message.text !== undefined && message.text.length > 0;
  const beyondDraft = revealTurnId !== undefined && !draft;
  const animate = draft || beyondDraft;
  const { text, done } = useSmoothText(message.text ?? '', {
    animate,
    initial: 'full',
  });
  const generating = draft || (beyondDraft && !done);
  // Keep the 400 ms transition on any bubble that was ever written live, so
  // the change to the normal look fades instead of jumping.
  const transitioning = draft || revealTurnId !== undefined;
  const isSending = own && message.status === 'sending';
  const canForward = !deleted && !isSending && !(own && message.failed === true);
  const sticker =
    message.card !== undefined && message.card.type === 'sticker' ? message.card.data : undefined;
  const bigEmoji =
    hasText &&
    sticker === undefined &&
    message.replyTo === undefined &&
    message.image === undefined &&
    message.voice === undefined &&
    message.attachment === undefined &&
    message.card === undefined &&
    isBigEmoji(message.text ?? '');
  // A big-emoji message is shown without its bubble, so the sender name would
  // float on its own; a classic messenger shows only the avatar in that case.
  const showSender = !own && chat.kind === 'group' && firstInGroup && !bigEmoji;
  const attachmentImage = message.attachment?.kind === 'image';
  // GIF-origin videos render inline only on a trusted media URL (the store
  // sanitizer renames untrusted `gif-` attachments first; the URL check here
  // is the second layer, so a hostile absolute URL never auto-loads).
  const mediaHosts = mediaTrustedHosts ?? EMPTY_HOSTS;
  const gifVideo =
    message.attachment !== undefined &&
    message.attachment.kind === 'file' &&
    isGifVideoAttachment(message.attachment, mediaHosts);
  const attachmentFile = message.attachment?.kind === 'file' && !gifVideo;
  const failed = message.failed === true;
  // A failed own send (T-0168): the bubble left `sending` for `failed` and
  // shows "Not sent" with Retry and Delete. The legacy `failed` flag without
  // the status keeps the old rows below, so older bubbles still render.
  const sendFailed = own && message.status === 'failed' && !generating;
  const imageOnly =
    (message.image !== undefined || attachmentImage || gifVideo) &&
    !hasText &&
    message.card === undefined &&
    message.voice === undefined &&
    !attachmentFile;

  const handleReact = (emoji: string): void => {
    storeApi.getState().react(chat.id, message.id, emoji);
  };

  // Sender-side limits: Edit is for my own text messages under 48 h, Delete for
  // everyone is for my own messages of any kind. Neither applies to a tombstone.
  // Pin is for anyone who may pin in the chat (DM either side, topic manager),
  // on any loaded message that is not deleted.
  const canEdit =
    !generating &&
    !deleted &&
    message.attachment === undefined &&
    canEditMessage(message, currentUserId, new Date());
  const canDelete = !generating && !deleted && canDeleteMessage(message, currentUserId);
  const canPin = !generating && !deleted && chatCanPin;

  // A retracted message keeps its place as a slim tombstone and has no actions.
  if (deleted) {
    return (
      <div
        data-message-id={message.id}
        className={cn(
          'group relative flex items-end gap-1.5',
          own ? 'flex-row-reverse' : 'flex-row',
          firstInGroup ? 'mt-2' : 'mt-0.5',
        )}
      >
        {!own &&
          chat.kind === 'group' &&
          (lastInGroup ? (
            <Avatar id={message.senderId} name={message.senderName} size={34} />
          ) : (
            <span className="w-[34px] shrink-0" aria-hidden="true" />
          ))}
        <div className={cn('flex min-w-0 flex-col', own ? 'items-end' : 'items-start')}>
          <div
            className={cn(
              'tombstone rounded-[14px] px-3 py-1.5 text-[13px] italic',
              own ? 'rounded-br-[4px]' : 'rounded-bl-[4px]',
            )}
          >
            {own ? 'You deleted this message' : 'This message was deleted'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-message-id={message.id}
      data-draft-turn={revealTurnId}
      onContextMenu={
        generating || selecting
          ? undefined
          : (event) => {
              event.preventDefault();
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
      className={cn(
        'group relative flex items-end gap-1.5',
        own ? 'flex-row-reverse' : 'flex-row',
        firstInGroup ? 'mt-2' : 'mt-0.5',
        isSending && 'animate-in fade-in slide-in-from-bottom-2 duration-150',
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
          <Avatar id={message.senderId} name={message.senderName} size={34} />
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
                <ReplyQuote quote={message.replyTo} />
              </div>
            )}
            <StickerMessage sticker={sticker} message={message} own={own} />
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
                  onOpen={() => setMenuOpen(true)}
                />
              )
            )}
            <MessageMenu
              open={menuOpen && !generating && message.failed !== true && !selecting}
              message={message}
              chatId={chat.id}
              pinId={pin?.id}
              menuButtonRef={menuButtonRef}
              canCopy={false}
              canEdit={false}
              canDelete={canDelete}
              canPin={canPin}
              canForward={canForward}
              align={own ? 'right' : 'left'}
              onReply={() => onReply(message)}
              onForward={() => onForward?.(message)}
              onSelectMessages={() => onStartSelect?.(message)}
              onReact={handleReact}
              onClose={() => setMenuOpen(false)}
            />
          </div>
        ) : (
          <div
            data-bubble-look={
              bigEmoji ? undefined : own ? 'outgoing' : generating ? 'generating' : 'incoming'
            }
            className={cn(
              'relative flex flex-col',
              own ? 'max-w-[520px]' : 'max-w-[560px]',
              bigEmoji
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
                <ReplyQuote quote={message.replyTo} />
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
                  hasText={hasText}
                  imageOnly={imageOnly}
                  attachmentImage={attachmentImage}
                  attachmentFile={attachmentFile}
                  gifVideo={gifVideo}
                  sendFailed={sendFailed}
                  failed={failed}
                  isSending={isSending}
                />

                <MessageTextBody
                  message={message}
                  text={text}
                  own={own}
                  generating={generating}
                  markdown={markdown}
                  meJid={meJid}
                  hasText={hasText}
                />
              </>
            )}

            {!generating && !selecting && (
              <MessageActionsButton
                buttonRef={menuButtonRef}
                open={menuOpen}
                onOpen={() => setMenuOpen(true)}
              />
            )}
          </div>
        )}

        <MessageMenu
          open={menuOpen && !generating && !selecting}
          message={message}
          chatId={chat.id}
          pinId={pin?.id}
          menuButtonRef={menuButtonRef}
          canCopy={hasText}
          canEdit={canEdit}
          canDelete={canDelete}
          canPin={canPin}
          canForward={canForward}
          align={own ? 'right' : 'left'}
          onReply={() => onReply(message)}
          onForward={() => onForward?.(message)}
          onSelectMessages={() => onStartSelect?.(message)}
          onReact={handleReact}
          onClose={() => setMenuOpen(false)}
        />
        {!generating && message.reactions !== undefined && message.reactions.length > 0 && (
          <ReactionChips reactions={message.reactions} own={own} onToggle={handleReact} />
        )}
      </div>
    </div>
  );
});
