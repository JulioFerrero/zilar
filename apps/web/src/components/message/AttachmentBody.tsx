import { type ChatSummary, type UiMessage } from '@zilar/chat-core';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { ApprovalCard } from '../ApprovalCard';
import { FileMessage } from '../FileMessage';
import { GifMessage } from '../GifMessage';
import { ImageMessage } from '../ImageMessage';
import { ProgressCard } from '../ProgressCard';
import { VoiceMessage } from '../VoiceMessage';
import { cn } from '@/lib/utils';
import { MessageMeta } from './MessageMeta';
import { SendFailure } from './SendFailure';

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
  return (
    <>
      {message.image !== undefined && (
        <div className={cn('relative', hasText ? 'px-1.5 pt-1.5' : 'p-1.5')}>
          <ImageMessage
            chatId={message.chatId}
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
