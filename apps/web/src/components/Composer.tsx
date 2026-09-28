import { formatDuration, type ReplyRef } from '@galena/chat-core';
import { Mic, Paperclip, Send, Smile, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { VOICE_MAX_BYTES, VOICE_MIN_MS, VoiceRecorder, computeWaveform } from '@/lib/voice';
import { useChatStore } from '@/store/ChatStoreProvider';

const LINE_HEIGHT = 22;
const MAX_LINES = 6;
const SLIDE_CANCEL_PX = 60;

interface PressState {
  startX: number;
  cancel: boolean;
  released: boolean;
}

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
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [voiceError, setVoiceError] = useState<string | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingRef = useRef(0);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const pressRef = useRef<PressState | null>(null);
  const canSend = value.trim().length > 0;

  const onChange = (next: string): void => {
    setValue(next);
    const timestamp = Date.now();
    if (next.trim().length > 0 && timestamp - lastTypingRef.current > 2000) {
      lastTypingRef.current = timestamp;
      store.sendTyping(chatId);
    }
  };

  useEffect(() => {
    const element = textareaRef.current;
    if (element === null) {
      return;
    }
    element.style.height = 'auto';
    const maxHeight = LINE_HEIGHT * MAX_LINES;
    element.style.height = `${Math.min(Math.max(element.scrollHeight, LINE_HEIGHT), maxHeight)}px`;
  }, [value]);

  useEffect(() => {
    if (!recording) {
      return;
    }
    const timer = window.setInterval(() => {
      const recorder = recorderRef.current;
      if (recorder !== null) {
        setElapsedMs(recorder.durationMs);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [recording]);

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

  const beginRecording = async (startX: number): Promise<void> => {
    pressRef.current = { startX, cancel: false, released: false };
    setVoiceError(undefined);
    setElapsedMs(0);
    setCancelArmed(false);
    try {
      const recorder = await VoiceRecorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      if (pressRef.current?.released === true) {
        recorder.cancel();
        recorderRef.current = null;
        setRecording(false);
      }
    } catch {
      pressRef.current = null;
      setVoiceError('Microphone unavailable');
    }
  };

  const finishRecording = async (): Promise<void> => {
    const press = pressRef.current;
    const recorder = recorderRef.current;
    pressRef.current = null;
    recorderRef.current = null;
    setRecording(false);
    setCancelArmed(false);
    if (recorder === null) {
      return;
    }
    if (press?.cancel === true) {
      recorder.cancel();
      return;
    }

    const recorded = await recorder.stop();
    if (recorded.durationMs < VOICE_MIN_MS) {
      setVoiceError('Hold to record');
      return;
    }
    if (recorded.blob.size > VOICE_MAX_BYTES) {
      setVoiceError('Recording is too long');
      return;
    }
    const waveform = await computeWaveform(recorded.blob);
    store.sendVoice(
      chatId,
      { blob: recorded.blob, durationMs: recorded.durationMs, waveform },
      replyTo === undefined ? undefined : { replyTo },
    );
    onCancelReply();
  };

  const onMicPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (canSend) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    void beginRecording(event.clientX);
  };

  const onMicPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const press = pressRef.current;
    if (press === null) {
      return;
    }
    const cancel = event.clientX < press.startX - SLIDE_CANCEL_PX;
    press.cancel = cancel;
    setCancelArmed(cancel);
  };

  const onMicPointerUp = (): void => {
    if (pressRef.current !== null) {
      pressRef.current.released = true;
    }
    if (recorderRef.current !== null || pressRef.current === null) {
      void finishRecording();
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
      {voiceError !== undefined && (
        <div className="mb-1 px-1 text-[12px] text-red-500" role="alert">
          {voiceError}
        </div>
      )}
      <div className="flex items-end gap-2">
        {recording ? (
          <div className="flex h-[52px] min-w-0 flex-1 items-center gap-3 rounded-[22px] bg-background px-4 shadow-sm">
            <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
            <span className="shrink-0 text-[15px] tabular-nums">{formatDuration(elapsedMs)}</span>
            <span className="min-w-0 flex-1 truncate text-center text-[13px] text-muted-foreground">
              {cancelArmed ? 'Release to cancel' : 'Slide to cancel'}
            </span>
          </div>
        ) : (
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
              onChange={(event) => onChange(event.target.value)}
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
        )}
        <button
          type="button"
          aria-label={
            recording ? 'Cancel voice message' : canSend ? 'Send message' : 'Record voice message'
          }
          onClick={canSend ? send : undefined}
          onPointerDown={canSend ? undefined : onMicPointerDown}
          onPointerMove={canSend ? undefined : onMicPointerMove}
          onPointerUp={canSend ? undefined : onMicPointerUp}
          onPointerCancel={canSend ? undefined : onMicPointerUp}
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors hover:bg-accent/90"
        >
          {canSend && !recording ? (
            <Send className="size-5" aria-hidden="true" />
          ) : (
            <Mic className="size-5" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
