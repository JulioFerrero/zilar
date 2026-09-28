import {
  avatarGradient,
  formatFullDateTime,
  formatTime,
  isBigEmoji,
  type ChatSummary,
  type UiMessage,
} from '@galena/chat-core';
import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { ApprovalCard } from './ApprovalCard';
import { Avatar } from './Avatar';
import { ImageMessage } from './ImageMessage';
import { LinkText } from './LinkText';
import { MessageActionsMenu } from './MessageActionsMenu';
import { MessageTicks } from './MessageTicks';
import { ProgressCard } from './ProgressCard';
import { ReplyQuote } from './ReplyQuote';
import { VoiceMessage } from './VoiceMessage';
import { copyText } from '@/lib/clipboard';
import { useSmoothText } from '@/lib/useSmoothText';
import { cn } from '@/lib/utils';

function MessageMeta({
  message,
  showTicks,
  className,
}: {
  message: UiMessage;
  showTicks: boolean;
  className?: string;
}) {
  return (
    <span
      title={formatFullDateTime(message.createdAt)}
      className={cn('inline-flex items-center gap-0.5 text-[12px] tabular-nums', className)}
    >
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
          'mt-1 rounded-full bg-black/25 px-2 py-0.5 text-white backdrop-blur-sm',
          generating && 'invisible',
        )}
      >
        <MessageMeta message={message} showTicks={own && !generating} />
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
      <span className="absolute inset-y-0 left-0 w-0.5 animate-pulse bg-current motion-reduce:animate-none" />
    </span>
  );
}

export interface MessageBubbleProps {
  message: UiMessage;
  chat: ChatSummary;
  firstInGroup: boolean;
  lastInGroup: boolean;
  currentUserId: string;
  onReply: (message: UiMessage) => void;
  /** A live AI draft: same bubble, but muted and dimmed while it is written. */
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
  onReply,
  draft = false,
  revealTurnId,
}: MessageBubbleProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const own = message.senderId === currentUserId;
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
  const bigEmoji =
    hasText &&
    message.replyTo === undefined &&
    message.image === undefined &&
    message.voice === undefined &&
    message.card === undefined &&
    isBigEmoji(message.text ?? '');
  // A big-emoji message is shown without its bubble, so the sender name would
  // float on its own; Telegram shows only the avatar in that case.
  const showSender = !own && chat.kind === 'group' && firstInGroup && !bigEmoji;
  const imageOnly =
    message.image !== undefined &&
    !hasText &&
    message.card === undefined &&
    message.voice === undefined;

  return (
    <div
      data-message-id={message.id}
      data-draft-turn={revealTurnId}
      onContextMenu={
        generating
          ? undefined
          : (event) => {
              event.preventDefault();
              setMenuOpen(true);
            }
      }
      className={cn(
        'group relative flex items-end gap-1.5',
        own ? 'flex-row-reverse' : 'flex-row',
        firstInGroup ? 'mt-2' : 'mt-0.5',
        isSending && 'animate-in fade-in slide-in-from-bottom-2 duration-150',
      )}
    >
      {!own &&
        chat.kind === 'group' &&
        (lastInGroup ? (
          <Avatar id={message.senderId} name={message.senderName} size={34} />
        ) : (
          <span className="w-[34px] shrink-0" aria-hidden="true" />
        ))}
      <div
        className={cn(
          'relative flex max-w-[480px] flex-col',
          bigEmoji
            ? undefined
            : cn(
                'rounded-2xl bg-clip-padding text-[15px] leading-[19px]',
                generating && !own ? 'text-bubble-in-generating' : 'text-foreground',
                own ? 'bg-bubble-out' : generating ? 'bg-bubble-in/90' : 'bg-bubble-in',
                transitioning &&
                  'transition-[color,background-color] duration-[400ms] ease-out motion-reduce:transition-none',
                lastInGroup &&
                  (own ? 'bubble-tail-out rounded-br-none' : 'bubble-tail-in rounded-bl-none'),
              ),
        )}
      >
        {showSender && (
          <div
            className="px-2.5 pt-1 text-[14px] leading-5 font-semibold"
            style={{ color: avatarGradient(message.senderId).from }}
          >
            {message.senderName}
          </div>
        )}

        {message.replyTo !== undefined && (
          <div className="px-2.5 pt-1.5">
            <ReplyQuote quote={message.replyTo} />
          </div>
        )}

        {bigEmoji ? (
          <BigEmoji message={message} text={text} own={own} generating={generating} />
        ) : (
          <>
            {message.image !== undefined && (
              <div className={cn('relative', hasText ? 'px-1 pt-1.5' : 'p-1')}>
                <ImageMessage image={message.image} alt="Photo" />
                {imageOnly && (
                  <MessageMeta
                    message={message}
                    showTicks={own}
                    className="absolute right-2.5 bottom-2.5 rounded-full bg-black/45 px-1.5 py-0.5 text-white/95 backdrop-blur-sm"
                  />
                )}
              </div>
            )}

            {message.voice !== undefined && (
              <div className="px-2.5 py-1.5">
                <VoiceMessage voice={message.voice} own={own} />
              </div>
            )}

            {message.card !== undefined && (
              <div className="px-2.5 py-1.5">
                {message.card.type === 'progress' && <ProgressCard progress={message.card.data} />}
                {message.card.type === 'approval.request' && (
                  <ApprovalCard request={message.card.data} />
                )}
              </div>
            )}

            {hasText && (
              <p className="px-2.5 py-1.5 break-words whitespace-pre-wrap">
                <LinkText text={text} />
                {generating && <DraftCaret />}
                <MessageMeta
                  message={message}
                  showTicks={own && !generating}
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

            {!hasText && (message.voice !== undefined || message.card !== undefined) && (
              <div className="flex justify-end px-2.5 pb-1.5">
                <MessageMeta
                  message={message}
                  showTicks={own}
                  className={own ? 'text-bubble-out-meta' : 'text-bubble-in-meta'}
                />
              </div>
            )}
          </>
        )}

        {!generating && (
          <button
            type="button"
            aria-label="Message actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            className="absolute top-0.5 right-0.5 z-10 flex size-6 items-center justify-center rounded-full bg-background/80 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </button>
        )}

        {!generating && menuOpen && (
          <MessageActionsMenu
            canCopy={hasText}
            onReply={() => {
              setMenuOpen(false);
              onReply(message);
            }}
            onCopy={() => {
              setMenuOpen(false);
              void copyText(message.text ?? '');
            }}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
