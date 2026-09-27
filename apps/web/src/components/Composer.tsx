import { Mic, Paperclip, Send, Smile } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useChatStore } from '@/store/ChatStoreProvider';

const LINE_HEIGHT = 22;
const MAX_LINES = 6;

export function Composer({ chatId }: { chatId: string }) {
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
    store.sendText(chatId, value);
    setValue('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="chat-background flex shrink-0 items-end gap-2 px-3 py-2">
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
  );
}
