import {
  canDeleteMessage,
  canEditMessage,
  formatFullDateTime,
  formatTime,
  isAiJid,
  isBigEmoji,
  sendFailureLabel,
  shouldRenderMarkdown,
  type ChatSummary,
  type SendFailureReason,
  type UiMessage,
} from '@zilar/chat-core';
import { MoreHorizontal } from 'lucide-react';
import { useRef, useState } from 'react';
import { AiBadge } from './AiBadge';
import { ApprovalCard } from './ApprovalCard';
import { Avatar } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';
import { FileMessage } from './FileMessage';
import { ForwardedHeader } from './ForwardedHeader';
import { GifMessage, isGifVideoAttachment } from './GifMessage';
import { ImageMessage } from './ImageMessage';
import { LinkText } from './LinkText';
import { MarkdownText } from './MarkdownText';
import { MessageActionsMenu } from './MessageActionsMenu';
import { MessageTicks } from './MessageTicks';
import { ProgressCard } from './ProgressCard';
import { ReactionChips } from './ReactionChips';
import { ReplyQuote } from './ReplyQuote';
import { StickerMessage } from './StickerMessage';
import { VoiceMessage } from './VoiceMessage';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { copyText } from '@/lib/clipboard';
import { useSmoothText } from '@/lib/useSmoothText';
import { cn } from '@/lib/utils';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';

/** Monochrome-friendly sender name colors (ui-style.md §5). */
const SENDER_COLORS = ['#d4d4d4', '#a1a1a1', '#8a8a8a', '#ededed'] as const;

/** No known media host (mock store, signed out): every absolute URL is untrusted. */
const EMPTY_HOSTS: ReadonlySet<string> = new Set();

function senderColor(id: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return SENDER_COLORS[(hash >>> 0) % SENDER_COLORS.length] ?? SENDER_COLORS[0];
}

/**
 * The "Not sent" row under a failed own message (T-0168): a red label with
 * the fixed reason, a Retry button that re-runs the same pipeline from the
 * retained blob, and a Delete button that removes the local bubble. All
 * three are plain buttons, keyboard reachable with accessible names.
 */
export function SendFailure({
  chatId,
  messageId,
  reason,
  onRetry,
}: {
  chatId: string;
  messageId: string;
  reason: SendFailureReason | undefined;
  onRetry: () => void;
}) {
  const storeApi = useChatStoreApi();
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 px-0.5 text-[12px]">
      <span className="font-semibold text-danger">
        Not sent{reason === undefined ? '' : `: ${sendFailureLabel(reason)}`}
      </span>
      <button
        type="button"
        aria-label="Retry sending message"
        onClick={onRetry}
        className="font-semibold text-muted-foreground underline"
      >
        Retry
      </button>
      <button
        type="button"
        aria-label="Delete unsent message"
        onClick={() => storeApi.getState().deleteFailedMessage(chatId, messageId)}
        className="font-semibold text-muted-foreground underline"
      >
        Delete
      </button>
    </div>
  );
}

function MessageMeta({
  message,
  showTicks,
  edited = false,
  className,
}: {
  message: UiMessage;
  showTicks: boolean;
  edited?: boolean;
  className?: string;
}) {
  return (
    <span
      title={formatFullDateTime(message.createdAt)}
      className={cn(
        'font-mono inline-flex items-center gap-0.5 text-[10px] tabular-nums',
        className,
      )}
    >
      {edited && <span>edited</span>}
      {formatTime(message.createdAt)}
      {showTicks && <MessageTicks status={message.status} />}
    </span>
  );
}

function BigEmoji({
  message,
  text,
  own,
  generating = false,
}: {
  message: UiMessage;
  text: string;
  own: boolean;
  generating?: boolean;
}) {
  return (
    <div className={cn('flex flex-col', own ? 'items-end' : 'items-start')}>
      <span className="px-2 py-1 text-[48px] leading-none break-words">
        {text}
        {generating && <DraftCaret />}
      </span>
      <span
        className={cn(
          'raised-pill mt-1 rounded-full px-2 py-0.5 text-muted-foreground',
          generating && 'invisible',
        )}
      >
        <MessageMeta
          message={message}
          showTicks={own && !generating}
          edited={message.edited === true}
        />
      </span>
    </div>
  );
}

/**
 * A soft blinking caret at the end of a live draft. It has zero layout width
 * and paints into the trailing space, so swapping the draft for the final
 * message never moves the text.
 */
function DraftCaret() {
  return (
    <span aria-hidden="true" className="relative inline-block h-[1em] w-0 align-[-0.15em]">
      <span className="absolute inset-y-0 left-0 w-0.5 animate-pulse bg-[#bdbdbd] motion-reduce:animate-none" />
    </span>
  );
}

/** The recessed `generating` label under a reply that is still being written. */
function GeneratingLabel() {
  return (
    <span className="font-mono flex items-center gap-1.5 px-3 pt-1 pb-2 text-[11px] text-subtle-foreground">
      <span className="pulse-dot size-1.5 rounded-full bg-subtle-foreground" aria-hidden="true" />
      generating
    </span>
  );
}

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

export function MessageBubble({
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const storeApi = useChatStoreApi();
  const store = useChatStore();
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
  // In a group, an incoming AI reply (recognisable from its `ai-` JID) carries
  // the small AI badge next to its name (T-0055).
  const senderIsAi = showSender && isAiJid(message.senderId);
  const attachmentImage = message.attachment?.kind === 'image';
  // GIF-origin videos render inline only on a trusted media URL (the store
  // sanitizer renames untrusted `gif-` attachments first; the URL check here
  // is the second layer, so a hostile absolute URL never auto-loads).
  const mediaHosts = store.mediaTrustedHosts ?? EMPTY_HOSTS;
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
  const canPin = !generating && !deleted && store.canPin(chat.id);
  const pin = store.pinFor(chat.id, message.id);

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
            {showSender && (
              <div
                className="flex items-center gap-1.5 pb-1 text-[14px] leading-5 font-semibold"
                style={{ color: senderColor(message.senderId) }}
              >
                <span className="truncate">{message.senderName}</span>
                {senderIsAi && <AiBadge />}
              </div>
            )}
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
                <Button
                  ref={menuButtonRef}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Message actions"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen(true)}
                  className="absolute top-0.5 right-0.5 z-10 size-6 rounded-full bg-surface/80 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </Button>
              )
            )}
            {!generating && message.failed !== true && !selecting && menuOpen && (
              <MessageActionsMenu
                canCopy={false}
                canEdit={false}
                canDelete={canDelete}
                canPin={canPin}
                isPinned={pin !== undefined}
                canForward={canForward}
                onReact={(emoji) => {
                  setMenuOpen(false);
                  handleReact(emoji);
                }}
                onReply={() => {
                  setMenuOpen(false);
                  onReply(message);
                }}
                onForward={() => {
                  setMenuOpen(false);
                  onForward?.(message);
                }}
                onSelectMessages={() => {
                  setMenuOpen(false);
                  onStartSelect?.(message);
                }}
                onEdit={() => setMenuOpen(false)}
                onCopy={() => setMenuOpen(false)}
                onDelete={() => {
                  setMenuOpen(false);
                  menuButtonRef.current?.focus();
                  setConfirmOpen(true);
                }}
                onPin={() => {
                  setMenuOpen(false);
                  storeApi
                    .getState()
                    .pinMessage(chat.id, message.id)
                    .catch(() => {});
                }}
                onUnpin={() => {
                  setMenuOpen(false);
                  if (pin !== undefined) {
                    storeApi
                      .getState()
                      .unpinMessage(chat.id, pin.id)
                      .catch(() => {});
                  }
                }}
                onClose={() => setMenuOpen(false)}
                align={own ? 'right' : 'left'}
              />
            )}
            {confirmOpen && (
              <ConfirmDialog
                title="Delete message?"
                body="This deletes it for everyone in the chat."
                confirmLabel="Delete"
                onCancel={() => setConfirmOpen(false)}
                onConfirm={() => {
                  setConfirmOpen(false);
                  storeApi.getState().deleteForEveryone(chat.id, message.id);
                }}
              />
            )}
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
            {showSender && (
              <div
                className="flex items-center gap-1.5 px-3 pt-2 text-[14px] leading-5 font-semibold"
                style={{ color: senderColor(message.senderId) }}
              >
                <span className="truncate">{message.senderName}</span>
                {senderIsAi && <AiBadge />}
              </div>
            )}

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
                {message.image !== undefined && (
                  <div className={cn('relative', hasText ? 'px-1.5 pt-1.5' : 'p-1.5')}>
                    <ImageMessage
                      url={message.image.url}
                      alt="Photo"
                      width={message.image.width}
                      height={message.image.height}
                    />
                    {imageOnly && (
                      <MessageMeta
                        message={message}
                        showTicks={own}
                        className="raised-pill absolute right-2.5 bottom-2.5 rounded-full px-1.5 py-0.5 text-muted-foreground"
                      />
                    )}
                  </div>
                )}

                {attachmentImage && message.attachment !== undefined && (
                  <div className={cn('relative', hasText ? 'px-1.5 pt-1.5' : 'p-1.5')}>
                    <ImageMessage
                      url={message.attachment.url}
                      alt={message.attachment.name}
                      width={message.attachment.width}
                      height={message.attachment.height}
                    />
                    {sendFailed ? (
                      <SendFailure
                        chatId={chat.id}
                        messageId={message.id}
                        reason={message.failureReason}
                        onRetry={() => storeApi.getState().retryAttachment(chat.id, message.id)}
                      />
                    ) : failed ? (
                      <div className="mt-1.5 flex items-center gap-2 px-0.5 text-[12px] text-danger">
                        <span>Upload failed</span>
                        <button
                          type="button"
                          aria-label="Retry upload"
                          onClick={() => storeApi.getState().retryAttachment(chat.id, message.id)}
                          className="font-semibold underline"
                        >
                          Retry
                        </button>
                      </div>
                    ) : (
                      imageOnly && (
                        <MessageMeta
                          message={message}
                          showTicks={own}
                          className="raised-pill absolute right-2.5 bottom-2.5 rounded-full px-1.5 py-0.5 text-muted-foreground"
                        />
                      )
                    )}
                  </div>
                )}

                {attachmentFile && message.attachment !== undefined && (
                  <div className="px-3 py-1.5">
                    <FileMessage
                      attachment={message.attachment}
                      own={own}
                      uploading={isSending && !failed}
                      failed={failed && !sendFailed}
                      onRetry={() => storeApi.getState().retryAttachment(chat.id, message.id)}
                    />
                    {sendFailed && (
                      <SendFailure
                        chatId={chat.id}
                        messageId={message.id}
                        reason={message.failureReason}
                        onRetry={() => storeApi.getState().retryAttachment(chat.id, message.id)}
                      />
                    )}
                  </div>
                )}

                {gifVideo && message.attachment !== undefined && (
                  <div className={cn('relative', hasText ? 'px-1.5 pt-1.5' : 'p-1.5')}>
                    <GifMessage attachment={message.attachment} />
                    {sendFailed ? (
                      <SendFailure
                        chatId={chat.id}
                        messageId={message.id}
                        reason={message.failureReason}
                        onRetry={() => storeApi.getState().retryAttachment(chat.id, message.id)}
                      />
                    ) : failed ? (
                      <div className="mt-1.5 flex items-center gap-2 px-0.5 text-[12px] text-danger">
                        <span>Upload failed</span>
                        <button
                          type="button"
                          aria-label="Retry upload"
                          onClick={() => storeApi.getState().retryAttachment(chat.id, message.id)}
                          className="font-semibold underline"
                        >
                          Retry
                        </button>
                      </div>
                    ) : (
                      imageOnly && (
                        <MessageMeta
                          message={message}
                          showTicks={own}
                          className="raised-pill absolute right-2.5 bottom-2.5 rounded-full px-1.5 py-0.5 text-muted-foreground"
                        />
                      )
                    )}
                  </div>
                )}

                {message.voice !== undefined && (
                  <div className="px-3 py-1.5">
                    <VoiceMessage voice={message.voice} own={own} />
                    {sendFailed && (
                      <SendFailure
                        chatId={chat.id}
                        messageId={message.id}
                        reason={message.failureReason}
                        onRetry={() => storeApi.getState().retryVoice(chat.id, message.id)}
                      />
                    )}
                  </div>
                )}

                {message.card !== undefined && (
                  <div className="px-3 py-1.5">
                    {message.card.type === 'progress' && (
                      <ProgressCard progress={message.card.data} />
                    )}
                    {message.card.type === 'approval.request' && (
                      <ApprovalCard
                        request={message.card.data}
                        {...(chat.topic !== undefined ? { topicName: chat.title } : {})}
                      />
                    )}
                  </div>
                )}

                {hasText && markdown && (
                  <div className={cn('md break-words', own ? 'px-3 py-2' : 'px-3 py-2.5')}>
                    <MarkdownText text={text} />
                    <span className="md-tail">
                      {generating && <DraftCaret />}
                      <MessageMeta
                        message={message}
                        showTicks={own && !generating}
                        edited={message.edited === true}
                        className={cn(
                          'float-right ml-1.5 translate-y-[4px]',
                          own ? 'text-bubble-out-meta' : 'text-bubble-in-meta',
                          // Keeps the width the final message will have, so the
                          // swap does not move anything.
                          generating && 'invisible',
                        )}
                      />
                    </span>
                  </div>
                )}

                {hasText && !markdown && (
                  <p
                    className={cn(
                      'break-words whitespace-pre-wrap',
                      own ? 'px-3 py-2' : 'px-3 py-2.5',
                    )}
                  >
                    <LinkText text={text} mentions={message.mentions} meJid={meJid} />
                    {generating && <DraftCaret />}
                    <MessageMeta
                      message={message}
                      showTicks={own && !generating}
                      edited={message.edited === true}
                      className={cn(
                        'float-right ml-1.5 translate-y-[4px]',
                        own ? 'text-bubble-out-meta' : 'text-bubble-in-meta',
                        // Keeps the width the final message will have, so the
                        // swap does not move anything.
                        generating && 'invisible',
                      )}
                    />
                  </p>
                )}

                {generating && hasText && <GeneratingLabel />}

                {!hasText &&
                  (message.voice !== undefined || message.card !== undefined || attachmentFile) && (
                    <div className="flex justify-end px-3 pb-2">
                      <MessageMeta
                        message={message}
                        showTicks={own}
                        className={own ? 'text-bubble-out-meta' : 'text-bubble-in-meta'}
                      />
                    </div>
                  )}
              </>
            )}

            {!generating && !selecting && (
              <Button
                ref={menuButtonRef}
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Message actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(true)}
                className="absolute top-0.5 right-0.5 z-10 size-6 rounded-full bg-surface/80 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        )}

        {!generating && sticker === undefined && !selecting && menuOpen && (
          <MessageActionsMenu
            canCopy={hasText}
            canEdit={canEdit}
            canDelete={canDelete}
            canPin={canPin}
            isPinned={pin !== undefined}
            canForward={canForward}
            onReact={(emoji) => {
              setMenuOpen(false);
              handleReact(emoji);
            }}
            onReply={() => {
              setMenuOpen(false);
              onReply(message);
            }}
            onForward={() => {
              setMenuOpen(false);
              onForward?.(message);
            }}
            onSelectMessages={() => {
              setMenuOpen(false);
              onStartSelect?.(message);
            }}
            onEdit={() => {
              setMenuOpen(false);
              storeApi.getState().startEdit(chat.id, message.id);
            }}
            onCopy={() => {
              setMenuOpen(false);
              void copyText(message.text ?? '');
            }}
            onDelete={() => {
              setMenuOpen(false);
              // Focus the opener so the dialog can restore it on close.
              menuButtonRef.current?.focus();
              setConfirmOpen(true);
            }}
            onPin={() => {
              setMenuOpen(false);
              storeApi
                .getState()
                .pinMessage(chat.id, message.id)
                .catch(() => {});
            }}
            onUnpin={() => {
              setMenuOpen(false);
              if (pin !== undefined) {
                storeApi
                  .getState()
                  .unpinMessage(chat.id, pin.id)
                  .catch(() => {});
              }
            }}
            onClose={() => setMenuOpen(false)}
            align={own ? 'right' : 'left'}
          />
        )}

        {sticker === undefined && confirmOpen && (
          <ConfirmDialog
            title="Delete message?"
            body="This deletes it for everyone in the chat."
            confirmLabel="Delete"
            onCancel={() => setConfirmOpen(false)}
            onConfirm={() => {
              setConfirmOpen(false);
              storeApi.getState().deleteForEveryone(chat.id, message.id);
            }}
          />
        )}
        {!generating && message.reactions !== undefined && message.reactions.length > 0 && (
          <ReactionChips reactions={message.reactions} own={own} onToggle={handleReact} />
        )}
      </div>
    </div>
  );
}
