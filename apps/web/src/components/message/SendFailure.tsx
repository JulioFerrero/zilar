import { sendFailureLabel, type SendFailureReason } from '@zilar/chat-core';
import { useChatStoreApi } from '@/store/ChatStoreProvider';

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
