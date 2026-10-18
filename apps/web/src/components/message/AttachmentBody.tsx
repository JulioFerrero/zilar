import { type ChatSummary, type UiMessage, isTrustedMediaUrl } from '@zilar/chat-core';
import { isCardAllowedFrom, UNSUPPORTED_MESSAGE_TEXT } from '@zilar/client-core';
import { useMemo } from 'react';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { ApprovalCard } from '../ApprovalCard';
import { FileMessage } from '../FileMessage';
import { GifMessage } from '../GifMessage';
import { ImageMessage } from '../ImageMessage';
import { ProgressCard } from '../ProgressCard';
import { VoiceMessage } from '../VoiceMessage';
import { cn } from '@/lib/utils';
import { mediaSrc } from '@/lib/attachments';
import { AlbumGrid } from './AlbumGrid';
import { BlockCard } from './blocks/BlockCard';
import { MessageMeta } from './MessageMeta';
import { QuestionCard } from './QuestionCard';
import { SendFailure } from './SendFailure';

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
