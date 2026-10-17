import { type ChatSummary, type UiMessage } from '@zilar/chat-core';
import { useMemo } from 'react';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { ApprovalCard } from '../ApprovalCard';
import { FileMessage } from '../FileMessage';
import { GifMessage } from '../GifMessage';
import { ImageMessage } from '../ImageMessage';
import { isTrustedInlineVideoUrl } from '../media/trusted-media';
import { ProgressCard } from '../ProgressCard';
import { VoiceMessage } from '../VoiceMessage';
import { cn } from '@/lib/utils';
import { mediaSrc } from '@/lib/attachments';
import { AlbumGrid } from './AlbumGrid';
import { BlockCard } from './blocks/BlockCard';
import { MediaMetaPill } from './MediaMetaPill';
import { MessageMeta } from './MessageMeta';
import { QuestionCard } from './QuestionCard';
import { SendFailure } from './SendFailure';

/** No known media host (mock store, signed out): every absolute URL is untrusted. */
const EMPTY_HOSTS: ReadonlySet<string> = new Set();

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
  /** The media is the bubble's first element (no sender/forward/reply above). */
  mediaTop: boolean;
  /** Last in its group: the bubble's bottom tail corner is 4px. */
  lastInGroup: boolean;
}) {
  const storeApi = useChatStoreApi();
  const mediaHosts = useChatSelector((state) => state.mediaTrustedHosts);
  // A `video/*` file (T-1232) plays inline instead of showing a file card, but
  // only from a trusted same-origin/media host. A peer can put any URL in the
  // payload and the player fetches it on render (preload="metadata"), so an
  // untrusted URL stays a click-to-load card, as the GIF path does.
  const videoAttachment =
    attachmentFile &&
    message.attachment !== undefined &&
    message.attachment.mime.startsWith('video/') &&
    isTrustedInlineVideoUrl(message.attachment.url, mediaHosts ?? EMPTY_HOSTS);
  // A media bubble is edge to edge (T-1335): the media fills the bubble and its
  // own clip follows the bubble's corners and tail.
  const radius = mediaCorners(mediaTop, !hasText, lastInGroup, own);
  // T-1618: a work card stands alone; T-1755: a blocks card is its own surface
  // too. Neither takes the bubble's inner padding box, and each shows its own
  // time instead of the row below the bubble.
  const cardStandsAlone =
    message.card !== undefined &&
    (message.card.type === 'progress' || message.card.type === 'blocks');
  // T-1795: an interactive blocks card answers through the route and, for the
  // decision kinds, sends the @AI reply from this room. A direct chat records
  // the card under its origin id and needs no mention (T-1825), so there the
  // reply is plain text. The viewer's own cards and fixture cards have no
  // target, so their controls stay disabled. Memoised so a bubble re-render
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
  // An album head draws the whole grid (T-1268) instead of its single photo;
  // the caption under it is the bubble's text body. A failed tile owns its own
  // upload-failure Retry, but the fixed "Not sent" row (reason, Retry, Delete
  // unsent) must still appear for the head, exactly as the single-photo paths
  // do, so a failed send stays recoverable and deletable (T-0168).
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
          {sendFailed ? (
            <div className="px-3">
              <SendFailure
                chatId={chat.id}
                messageId={message.id}
                reason={message.failureReason}
                onRetry={() => storeApi.getState().retryAttachment(chat.id, message.id)}
              />
            </div>
          ) : failed ? (
            <div className="mt-1.5 flex items-center gap-2 px-3 text-[12px] text-danger">
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
            imageOnly && <MediaMetaPill message={message} showTicks={own} />
          )}
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
            {sendFailed ? (
              <div className="px-3">
                <SendFailure
                  chatId={chat.id}
                  messageId={message.id}
                  reason={message.failureReason}
                  onRetry={() => storeApi.getState().retryAttachment(chat.id, message.id)}
                />
              </div>
            ) : failed ? (
              <div className="mt-1.5 flex items-center gap-2 px-3 text-[12px] text-danger">
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
              !hasText && <MediaMetaPill message={message} showTicks={own} />
            )}
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
            {sendFailed && (
              <SendFailure
                chatId={chat.id}
                messageId={message.id}
                reason={message.failureReason}
                onRetry={() => storeApi.getState().retryAttachment(chat.id, message.id)}
              />
            )}
          </div>
        ))}

      {gifVideo && message.attachment !== undefined && (
        <div className={cn('relative overflow-hidden', radius)}>
          <GifMessage chatId={message.chatId} attachment={message.attachment} />
          {sendFailed ? (
            <div className="px-3">
              <SendFailure
                chatId={chat.id}
                messageId={message.id}
                reason={message.failureReason}
                onRetry={() => storeApi.getState().retryAttachment(chat.id, message.id)}
              />
            </div>
          ) : failed ? (
            <div className="mt-1.5 flex items-center gap-2 px-3 text-[12px] text-danger">
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
            imageOnly && <MediaMetaPill message={message} showTicks={own} />
          )}
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

      {message.card !== undefined && (
        // T-1618: a work card stands alone; T-1755: a blocks card is its own
        // surface too, so neither gets the bubble's inner padding box.
        <div className={cn(!cardStandsAlone && 'px-3 py-1.5')}>
          {message.card.type === 'progress' && <ProgressCard progress={message.card.data} />}
          {message.card.type === 'blocks' && (
            <BlockCard
              data={message.card.data}
              footer={<MessageMeta message={message} showTicks={own} className="text-[#8a8a8a]" />}
              {...(blockRespond === undefined ? {} : { respond: blockRespond })}
            />
          )}
          {message.card.type === 'approval.request' && (
            <ApprovalCard
              request={message.card.data}
              {...(chat.topic !== undefined ? { topicName: chat.title } : {})}
            />
          )}
          {message.card.type === 'question' && (
            <QuestionCard
              question={message.card.data}
              aiName={message.senderName}
              chatId={chat.id}
              messageId={message.id}
            />
          )}
        </div>
      )}

      {!hasText &&
        (message.voice !== undefined ||
          // T-1618: a work card's own timer is its time; no clock or "edited".
          // T-1755: a blocks card shows its own time inside the card, too.
          (message.card !== undefined && !cardStandsAlone) ||
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

/**
 * The media wrapper's corner classes (T-1335): rounded at the bubble's top when
 * the media is the first element, and at the bottom when it is the last (no
 * caption), with the 4px tail corner on its own side when last in a group.
 */
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
