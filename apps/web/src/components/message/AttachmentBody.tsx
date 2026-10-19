import { ApprovalCard } from '../ApprovalCard';
import { GifMessage } from '../GifMessage';
import { ProgressCard } from '../ProgressCard';
import { VoiceMessage } from '../VoiceMessage';
import { AlbumGrid } from './AlbumGrid';
import { BlockCard } from './blocks/BlockCard';
import { useMediaViewer } from '../media/MediaViewer';
import { MessageMeta } from './MessageMeta';
import { QuestionCard } from './QuestionCard';
import { SendFailure } from './SendFailure';
import { IconButton } from '@/components/ui/icon-button';
import { mediaSrc } from '@/lib/attachments';
import { useMediaRetry } from '@/lib/media-retry';
import { downloadFile, openPdfInNewTab } from '@/lib/open-file';
import { cn } from '@/lib/utils';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import {
  type ChatSummary,
  type UiMessage,
  isTrustedMediaUrl,
  type Attachment,
  formatFileMeta,
  isPdfAttachment,
  safeHttpUrl,
} from '@zilar/chat-core';
import { isCardAllowedFrom, UNSUPPORTED_MESSAGE_TEXT } from '@zilar/client-core';
import { ArrowDown, FileText, Loader2, RotateCcw } from 'lucide-react';
import { useMemo, type MouseEvent, useState } from 'react';
/**
 * A root-relative `/api/` path is same-origin by construction; an absolute URL
 * must be http(s) on a trusted media host. Anything else (`data:`, `blob:`, a
 * peer's arbitrary host) stays a click-to-load file card: a peer can put any
 * URL in the payload, and `<video preload="metadata">` fetches it on render,
 * leaking the reader's IP.
 */

export function isTrustedInlineVideoUrl(url: string, trustedHosts: ReadonlySet<string>): boolean {
  if (url.startsWith('/api/')) {
    return true;
  }
  return isTrustedMediaUrl(url, trustedHosts);
}

/** No known media host (mock store, signed out): every absolute URL is untrusted. */
const EMPTY_HOSTS: ReadonlySet<string> = new Set();

export function MediaMetaPill({
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
      className={cn(
        'absolute right-2 bottom-2 inline-flex items-center rounded-full bg-black/45 px-1.5 py-0.5 text-white',
        className,
      )}
    >
      <MessageMeta message={message} showTicks={showTicks} edited={message.edited === true} />
    </span>
  );
}

interface ImageMessageProps {
  /** The chat JID; `GET /api/files` checks membership. */
  chatId: string;
  messageId: string;
  url: string;
  alt: string;
  width?: number | undefined;
  height?: number | undefined;
}

/**
 * Reserves space from the known size so the list never jumps; only http(s)
 * URLs are clickable. A just-sent `blob:` preview stays while its `/api/files`
 * copy 404s behind the indexer.
 */
function ImageMessage({ chatId, messageId, url, alt, width, height }: ImageMessageProps) {
  const openViewer = useMediaViewer();
  const media = useMediaRetry(chatId, url);

  if (media.unavailable) {
    return (
      <div className="flex h-[120px] w-full flex-col items-center justify-center gap-1.5 bg-well text-[13px] text-muted-foreground">
        <span>Image unavailable</span>
        <button type="button" onClick={media.retry} className="text-[12px] font-semibold underline">
          Retry
        </button>
      </div>
    );
  }

  const ratio = width !== undefined && height !== undefined ? `${width} / ${height}` : undefined;
  // The raw URL decides linkability; trusted same-origin uploads open through the file route.
  const href = safeHttpUrl(url) === undefined ? undefined : mediaSrc(chatId, url);
  const image = (
    <div className="relative">
      <img
        src={media.src}
        alt={alt}
        loading="lazy"
        {...(width === undefined ? {} : { width })}
        {...(height === undefined ? {} : { height })}
        onLoad={media.onLoad}
        onError={media.onError}
        style={ratio === undefined ? undefined : { aspectRatio: ratio }}
        className="max-h-[320px] w-full object-cover"
      />
      {media.preview !== undefined && !media.loaded && (
        <img
          src={media.preview}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );

  const open = (event: MouseEvent<HTMLElement>): void => {
    if (openViewer === null) {
      return;
    }
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    openViewer({ chatId, messageId });
  };

  if (href !== undefined) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${alt}`}
        onClick={open}
        className="block"
      >
        {image}
      </a>
    );
  }
  if (openViewer === null) {
    return image;
  }
  return (
    <button type="button" aria-label={`View ${alt}`} onClick={open} className="block w-full">
      {image}
    </button>
  );
}

interface FileMessageProps {
  /** The chat JID; `GET /api/files` checks membership. */
  chatId: string;
  attachment: Attachment;
  own: boolean;
  uploading?: boolean;
  failed?: boolean;
  onRetry?: (() => void) | undefined;
}

function FileMessage({
  chatId,
  attachment,
  own,
  uploading = false,
  failed = false,
  onRetry,
}: FileMessageProps) {
  const [opening, setOpening] = useState(false);
  const href =
    safeHttpUrl(attachment.url) === undefined ? undefined : mediaSrc(chatId, attachment.url);
  const pdf = isPdfAttachment(attachment);
  const busy = uploading || opening;
  const canOpen = href !== undefined && !busy && !failed;
  const meta = failed
    ? 'Upload failed'
    : uploading
      ? 'Uploading…'
      : formatFileMeta(attachment.size, attachment.name);

  const open = (): void => {
    if (href === undefined || !canOpen) {
      return;
    }
    if (!pdf) {
      downloadFile(href, attachment.name);
      return;
    }
    setOpening(true);
    openPdfInNewTab(href, attachment.name, () => setOpening(false));
  };

  return (
    <div className="min-w-[210px] max-w-[320px]">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={open}
          disabled={!canOpen}
          aria-label={pdf ? `Open ${attachment.name}` : `Download ${attachment.name}`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-[10px] text-left active:opacity-80"
        >
          <span
            className={cn(
              'flex size-12 shrink-0 items-center justify-center rounded-full',
              own ? 'bg-bubble-in text-foreground' : 'bg-accent text-accent-foreground',
            )}
          >
            {busy ? (
              <Loader2
                className="size-6 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : pdf ? (
              <FileText className="size-6" aria-hidden="true" />
            ) : (
              <ArrowDown className="size-6" aria-hidden="true" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold" title={attachment.name}>
              {attachment.name}
            </span>
            <span
              className={cn(
                'block truncate text-[12px] tabular-nums',
                own ? 'text-bubble-out-meta' : 'text-muted-foreground',
              )}
            >
              {meta}
            </span>
          </span>
        </button>
        {failed && (
          <IconButton size={32} radius={16} aria-label="Retry upload" onClick={onRetry}>
            <RotateCcw className="size-4" aria-hidden="true" />
          </IconButton>
        )}
      </div>
    </div>
  );
}

export function AttachmentBody({
  message,
  chat,
  own,
  hasText,
  imageOnly,
  attachmentImage,
  attachmentFile,
  gifVideo,
  sendFailed,
  failed,
  isSending,
  mediaTop,
  lastInGroup,
}: {
  message: UiMessage;
  chat: ChatSummary;
  own: boolean;
  hasText: boolean;
  imageOnly: boolean;
  attachmentImage: boolean;
  attachmentFile: boolean;
  gifVideo: boolean;
  sendFailed: boolean;
  failed: boolean;
  isSending: boolean;
  mediaTop: boolean;
  lastInGroup: boolean;
}) {
  const storeApi = useChatStoreApi();
  const mediaHosts = useChatSelector((state) => state.mediaTrustedHosts);
  // A `video/*` file plays inline only from a trusted same-origin/media host:
  // a peer can put any URL in the payload and `preload="metadata"` fetches it
  // on render, so an untrusted URL stays a click-to-load card.
  const videoAttachment =
    attachmentFile &&
    message.attachment !== undefined &&
    message.attachment.mime.startsWith('video/') &&
    isTrustedInlineVideoUrl(message.attachment.url, mediaHosts ?? EMPTY_HOSTS);
  const radius = mediaCorners(mediaTop, !hasText, lastInGroup, own);
  // Only an AI may render an approval, question, blocks, routine or progress
  // card. From a person the bubble shows plain text instead.
  const card =
    message.card !== undefined && isCardAllowedFrom(message.card, message.senderId)
      ? message.card
      : undefined;
  const cardStandsAlone =
    card !== undefined && (card.type === 'progress' || card.type === 'blocks');
  // A direct chat records the card under its origin id and needs no mention, so
  // there the reply is plain text. The viewer's own cards and fixture cards have
  // no target, so their controls stay disabled. Memoised so a bubble re-render
  // does not replace the card's context identity.
  const blockRespond = useMemo(() => {
    if (own) {
      return undefined;
    }
    const direct = chat.kind !== 'group';
    const replyTo = { id: message.id, senderName: message.senderName };
    return {
      messageId: direct ? (message.originId ?? message.id) : message.id,
      chatId: chat.id,
      aiName: message.senderName,
      aiJid: message.senderId,
      reply: (text: string): void => {
        if (direct) {
          storeApi.getState().sendText(chat.id, text, { replyTo });
          return;
        }
        storeApi.getState().sendText(chat.id, `@${message.senderName} ${text}`, {
          replyTo,
          mentions: [
            {
              jid: message.senderId,
              name: message.senderName,
              begin: 0,
              end: message.senderName.length + 1,
            },
          ],
        });
      },
    };
  }, [
    own,
    message.id,
    message.originId,
    message.senderId,
    message.senderName,
    chat.id,
    chat.kind,
    storeApi,
  ]);
  if (message.album !== undefined) {
    return (
      <>
        <div className={cn('relative overflow-hidden', radius)}>
          <AlbumGrid message={message} chat={chat} />
          {!hasText && !sendFailed && !failed && (
            <MediaMetaPill message={message} showTicks={own} />
          )}
        </div>
        {sendFailed && (
          <div className="px-1.5">
            <SendFailure
              chatId={chat.id}
              messageId={message.id}
              reason={message.failureReason}
              onRetry={() => storeApi.getState().retryAttachment(chat.id, message.id)}
            />
          </div>
        )}
      </>
    );
  }
  const footer: FooterState = { sendFailed, own, chat, message };
  return (
    <>
      {message.image !== undefined && (
        <div className={cn('relative overflow-hidden', radius)}>
          <ImageMessage
            chatId={message.chatId}
            messageId={message.id}
            url={message.image.url}
            alt="Photo"
            width={message.image.width}
            height={message.image.height}
          />
          {imageOnly && <MediaMetaPill message={message} showTicks={own} />}
        </div>
      )}

      {attachmentImage && message.attachment !== undefined && (
        <div className={cn('relative overflow-hidden', radius)}>
          <ImageMessage
            chatId={message.chatId}
            messageId={message.id}
            url={message.attachment.url}
            alt={message.attachment.name}
            width={message.attachment.width}
            height={message.attachment.height}
          />
          <AttachmentFooter footer={footer} failed={failed} showMeta={imageOnly} />
        </div>
      )}

      {attachmentFile &&
        message.attachment !== undefined &&
        (videoAttachment ? (
          <div className={cn('relative overflow-hidden', radius)}>
            <video
              controls
              preload="metadata"
              src={mediaSrc(message.chatId, message.attachment.url)}
              className="max-h-[320px] w-full object-cover"
            />
            <AttachmentFooter footer={footer} failed={failed} showMeta={!hasText} />
          </div>
        ) : (
          <div className="px-3 py-1.5">
            <FileMessage
              chatId={message.chatId}
              attachment={message.attachment}
              own={own}
              uploading={isSending && !failed}
              failed={failed && !sendFailed}
              onRetry={() => storeApi.getState().retryAttachment(chat.id, message.id)}
            />
            <AttachmentFooter footer={footer} showMeta={false} sendFailurePadding="px-0" />
          </div>
        ))}

      {gifVideo && message.attachment !== undefined && (
        <div className={cn('relative overflow-hidden', radius)}>
          <GifMessage chatId={message.chatId} attachment={message.attachment} />
          <AttachmentFooter footer={footer} failed={failed} showMeta={imageOnly} />
        </div>
      )}

      {message.voice !== undefined && (
        <div className="px-3 py-1.5">
          <VoiceMessage chatId={message.chatId} voice={message.voice} own={own} />
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

      {card !== undefined && (
        <div className={cn(!cardStandsAlone && 'px-3 py-1.5')}>
          {card.type === 'progress' && <ProgressCard progress={card.data} />}
          {card.type === 'blocks' && (
            <BlockCard
              data={card.data}
              footer={<MessageMeta message={message} showTicks={own} className="text-[#8a8a8a]" />}
              {...(blockRespond === undefined ? {} : { respond: blockRespond })}
            />
          )}
          {card.type === 'approval.request' && (
            <ApprovalCard
              request={card.data}
              senderId={message.senderId}
              {...(chat.topic !== undefined ? { topicName: chat.title } : {})}
            />
          )}
          {card.type === 'question' && (
            <QuestionCard
              question={card.data}
              aiName={message.senderName}
              chatId={chat.id}
              messageId={message.id}
            />
          )}
        </div>
      )}

      {message.card !== undefined && card === undefined && !hasText && (
        <div className="px-3 py-1.5 text-[15px] leading-[22px] break-words">
          {UNSUPPORTED_MESSAGE_TEXT}
        </div>
      )}

      {!hasText &&
        (message.voice !== undefined ||
          (card !== undefined && !cardStandsAlone) ||
          (attachmentFile && !videoAttachment)) && (
          <div className="flex justify-end px-3 pb-2">
            <MessageMeta
              message={message}
              showTicks={own}
              className={own ? 'text-bubble-out-meta' : 'text-bubble-in-meta'}
            />
          </div>
        )}
    </>
  );
}

type FooterState = {
  sendFailed: boolean;
  own: boolean;
  chat: ChatSummary;
  message: UiMessage;
};

function AttachmentFooter({
  footer: { sendFailed, own, chat, message },
  failed = false,
  showMeta,
  sendFailurePadding = 'px-3',
}: {
  footer: FooterState;
  failed?: boolean;
  showMeta: boolean;
  sendFailurePadding?: string;
}) {
  const storeApi = useChatStoreApi();
  const retry = () => storeApi.getState().retryAttachment(chat.id, message.id);
  if (sendFailed) {
    return (
      <div className={sendFailurePadding}>
        <SendFailure
          chatId={chat.id}
          messageId={message.id}
          reason={message.failureReason}
          onRetry={retry}
        />
      </div>
    );
  }
  if (failed) {
    return (
      <div className="mt-1.5 flex items-center gap-2 px-3 text-[12px] text-danger">
        <span>Upload failed</span>
        <button
          type="button"
          aria-label="Retry upload"
          onClick={retry}
          className="font-semibold underline"
        >
          Retry
        </button>
      </div>
    );
  }
  return showMeta ? <MediaMetaPill message={message} showTicks={own} /> : null;
}

function mediaCorners(top: boolean, bottom: boolean, lastInGroup: boolean, own: boolean): string {
  const corners: string[] = [];
  if (top) {
    corners.push('rounded-t-[14px]');
  }
  if (bottom) {
    corners.push(
      lastInGroup
        ? own
          ? 'rounded-bl-[14px] rounded-br-[4px]'
          : 'rounded-bl-[4px] rounded-br-[14px]'
        : 'rounded-b-[14px]',
    );
  }
  return corners.join(' ');
}
