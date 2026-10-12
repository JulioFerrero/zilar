import { type ChatSummary, type UiMessage } from '@zilar/chat-core';
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
import { MessageMeta } from './MessageMeta';
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
  return (
    <>
      {message.image !== undefined && (
        <div className={cn('relative', hasText ? 'px-1.5 pt-1.5' : 'p-1.5')}>
          <ImageMessage
            chatId={message.chatId}
            messageId={message.id}
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
            chatId={message.chatId}
            messageId={message.id}
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
          {videoAttachment ? (
            <video
              controls
              preload="metadata"
              src={mediaSrc(message.chatId, message.attachment.url)}
              className="max-h-[320px] w-full rounded-[12px] border border-edge"
            />
          ) : (
            <FileMessage
              chatId={message.chatId}
              attachment={message.attachment}
              own={own}
              uploading={isSending && !failed}
              failed={failed && !sendFailed}
              onRetry={() => storeApi.getState().retryAttachment(chat.id, message.id)}
            />
          )}
          {videoAttachment && failed && !sendFailed && (
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
          )}
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
          <GifMessage chatId={message.chatId} attachment={message.attachment} />
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
        <div className="px-3 py-1.5">
          {message.card.type === 'progress' && <ProgressCard progress={message.card.data} />}
          {message.card.type === 'approval.request' && (
            <ApprovalCard
              request={message.card.data}
              {...(chat.topic !== undefined ? { topicName: chat.title } : {})}
            />
          )}
        </div>
      )}

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
  );
}
