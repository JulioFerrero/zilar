// effect-plain: the browser EventSource adapter behind the drafts port, a callback transport.
import type { DraftHubEvent } from '@zilar/client-core/store';
import { decodeDraftEvent, draftReconnectDelay } from '@zilar/client-core/store';

export type { OpenDraftStream } from '@zilar/client-core/store';

/** Same origin as the app: the session cookie is sent automatically. */
export const DRAFT_STREAM_URL = '/api/drafts/stream';

/** The slice of EventSource the client uses. Tests inject a fake. */
export interface DraftEventSource {
  /** EventSource.readyState: 2 means the browser stopped reconnecting. */
  readonly readyState: number;
  addEventListener(
    type: 'draft' | 'end' | 'error' | 'open',
    listener: (event: MessageEvent) => void,
  ): void;
  close(): void;
}

const EVENT_SOURCE_CLOSED = 2;

function defaultDraftSource(url: string): DraftEventSource {
  return new EventSource(url);
}

/** Events that fail validation are dropped silently; nothing here throws. An EventSource
 * reconnects on its own only after a dropped connection: a non-2xx response closes it for
 * good, so those are reopened with a jittered backoff (1 s -> 30 s). */
export function subscribeToDrafts(
  onEvent: (event: DraftHubEvent) => void,
  createSource: (url: string) => DraftEventSource = defaultDraftSource,
  random: () => number = Math.random,
): () => void {
  let closed = false;
  let source: DraftEventSource | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;

  function clearRetry(): void {
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
  }

  function scheduleRetry(): void {
    if (closed || retryTimer !== undefined) {
      return;
    }
    const delay = draftReconnectDelay(attempt, random);
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      open();
    }, delay);
  }

  function open(): void {
    if (closed) {
      return;
    }
    let next: DraftEventSource;
    try {
      next = createSource(DRAFT_STREAM_URL);
    } catch {
      // No usable EventSource: the app simply behaves as without drafts.
      return;
    }
    source = next;

    // An open connection proves the stream is healthy, so the next retry starts at the base.
    next.addEventListener('open', () => {
      attempt = 0;
    });
    next.addEventListener('draft', (event) => {
      const parsed = decodeDraftEvent('draft', event.data);
      if (parsed !== undefined) {
        onEvent(parsed);
      }
    });
    next.addEventListener('end', (event) => {
      const parsed = decodeDraftEvent('end', event.data);
      if (parsed !== undefined) {
        onEvent(parsed);
      }
    });
    next.addEventListener('error', () => {
      // CONNECTING means the browser will reconnect by itself; only a CLOSED source needs a new one.
      if (next.readyState === EVENT_SOURCE_CLOSED) {
        next.close();
        scheduleRetry();
      }
    });
  }

  open();

  return () => {
    closed = true;
    clearRetry();
    source?.close();
  };
}
