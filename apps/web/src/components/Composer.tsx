import type { ReplyRef } from '@galena/chat-core';
import { Mic, Paperclip, Send, Smile, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useChatStore } from '@/store/ChatStoreProvider';

const LINE_HEIGHT = 22;
const MAX_LINES = 6;

export function Composer({
  chatId,
  replyTo,
  onCancelReply,
}: {
  chatId: string;
  replyTo: ReplyRef | undefined;
  onCancelReply: () => void;
}) {
  const store = useChatStore();
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = value.trim().length > 0;

  useEffect(() => {
    const element = textareaRef.current;
    if (element === null) {
      return;
    }
    element.style.height = 'auto';
    const maxHeight = LINE_HEIGHT * MAX_LINES;
    element.style.height = `${Math.min(Math.max(element.scrollHeight, LINE_HEIGHT), maxHeight)}px`;
  }, [value]);

  const send = (): void => {
    if (!canSend) {
      return;
    }
    store.sendText(chatId, value, replyTo === undefined ? undefined : { replyTo });
    setValue('');
    onCancelReply();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape' && replyTo !== undefined) {
      event.preventDefault();
      onCancelReply();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="chat-background shrink-0 px-3 py-2">
      {replyTo !== undefined && (
        <div className="mb-2 flex items-stretch overflow-hidden rounded-lg bg-background/90 shadow-sm">
          <span className="w-[3px] shrink-0 bg-accent" aria-hidden="true" />
          <div className="min-w-0 flex-1 px-2.5 py-1">
            <div className="truncate text-[13px] leading-4 font-semibold text-accent">
              Reply to {replyTo.senderName}
            </div>
            {replyTo.text !== undefined && (
              <div className="truncate text-[13px] leading-4 text-muted-foreground">
                {replyTo.text}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Cancel reply"
            onClick={onCancelReply}
            className="flex w-9 shrink-0 items-center justify-center text-muted-foreground hover:bg-list-hover"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 items-end rounded-[22px] bg-background px-1 py-1 shadow-sm focus-within:ring-2 focus-within:ring-accent/40">
          <button
            type="button"
            aria-label="Attach a file"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover"
          >
            <Paperclip className="size-5" aria-hidden="true" />
          </button>
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Message"
            aria-label="Message"
            className="min-h-[22px] flex-1 resize-none bg-transparent px-1 py-1.5 text-[15px] leading-[22px] outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            aria-label="Insert emoji"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover"
          >
            <Smile className="size-5" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          aria-label={canSend ? 'Send message' : 'Record voice message'}
          onClick={canSend ? send : undefined}
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors hover:bg-accent/90"
        >
          {canSend ? (
            <Send className="size-5" aria-hidden="true" />
          ) : (
            <Mic className="size-5" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
