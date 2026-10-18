/**
 * The mobile draft-stream client (T-0056). React Native has no `EventSource`
 * and its `fetch` does not stream response bodies, so this reads the SSE stream
 * from `XMLHttpRequest.responseText` as it grows. The event contract, the
 * validation and the reconnect backoff are shared with the web in
 * `@zilar/client-core/store` (`draft-events.ts`).
 *
 * `event: draft` carries the AI's cumulative reply text, `event: end` closes a
 * turn. Frames that fail validation are dropped silently; nothing here throws
 * and the token and draft text are never logged.
 */
import type { DraftHubEvent } from '@zilar/client-core/store';
import { decodeDraftEvent, draftReconnectDelay } from '@zilar/client-core/store';
import { Effect, Fiber } from 'effect';

import type { AppStateLike } from '../store/real-store';

export type { OpenDraftStream } from '@zilar/client-core/store';

/** The stream path, joined with the API URL by the store. */
export const DRAFT_STREAM_PATH = '/api/drafts/stream';

/** The slice of `XMLHttpRequest` the client drives. Tests inject a fake. */
export interface DraftXhr {
  readonly readyState: number;
  readonly status: number;
  readonly responseText: string;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(): void;
  abort(): void;
  onprogress: (() => void) | null;
  onreadystatechange: (() => void) | null;
  onerror: (() => void) | null;
  onload: (() => void) | null;
}

export interface DraftStreamOptions {
  /** Absolute stream URL. */
  url: string;
  /** Reads the persisted bearer token. */
  getToken: () => Promise<string | undefined> | string | undefined;
  /** React Native's `AppState`; the stream follows the foreground state. */
  appState: AppStateLike;
  /** Test seam. */
  createXhr?: () => DraftXhr;
  /** Test seam for the jittered backoff. */
  random?: () => number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/** One SSE block (`event:` + `data:` lines, no trailing blank line). */
function parseFrame(frame: string): DraftHubEvent | undefined {
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    // Heartbeats and other comment lines start with `:`.
    if (line === '' || line.startsWith(':')) {
      continue;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }
    if (field === 'event') {
      eventName = value;
    } else if (field === 'data') {
      dataLines.push(value);
    }
  }
  if (dataLines.length === 0) {
    return undefined;
  }
  const data = dataLines.join('\n');
  if (eventName === 'draft' || eventName === 'end') {
    return decodeDraftEvent(eventName, data);
  }
  return undefined;
}

function defaultXhr(): DraftXhr {
  // The DOM `XMLHttpRequest` has the same surface; the handler parameter types
  // differ, so the boundary is narrowed here.
  return new XMLHttpRequest() as unknown as DraftXhr;
}

/**
 * Subscribes to the signed-in user's own AI drafts over a bearer SSE stream.
 *
 * The stream is open while the app is `active`; it closes on background and
 * reopens on `active`. A dropped connection reconnects with a jittered backoff
 * (1 s -> 30 s). The returned function closes the stream for good.
 */
export function subscribeToDrafts(
  onEvent: (event: DraftHubEvent) => void,
  options: DraftStreamOptions,
): () => void {
  const createXhr = options.createXhr ?? defaultXhr;
  const random = options.random ?? Math.random;

  let closed = false;
  let active = options.appState.current() === 'active';
  let xhr: DraftXhr | null = null;
  let offset = 0;
  let buffer = '';
  let retryTimer: Fiber.Fiber<void> | null = null;
  let attempt = 0;

  function clearRetry(): void {
    if (retryTimer !== null) {
      const pending = retryTimer;
      retryTimer = null;
      Effect.runSync(Fiber.interrupt(pending));
    }
  }

  function closeXhr(): void {
    const request = xhr;
    if (request === null) {
      return;
    }
    xhr = null;
    request.onprogress = null;
    request.onreadystatechange = null;
    request.onerror = null;
    request.onload = null;
    request.abort();
  }

  function pump(): void {
    const request = xhr;
    if (request === null) {
      return;
    }
    const text = request.responseText;
    if (text.length <= offset) {
      return;
    }
    const chunk = text.slice(offset);
    offset = text.length;
    const parts = (buffer + chunk).replace(/\r\n?/g, '\n').split('\n\n');
    buffer = parts.pop() ?? '';
    for (const frame of parts) {
      const event = parseFrame(frame);
      if (event !== undefined) {
        onEvent(event);
      }
    }
  }

  function scheduleRetry(): void {
    if (closed || !active || retryTimer !== null) {
      return;
    }
    const delay = draftReconnectDelay(attempt, random, options.baseDelayMs, options.maxDelayMs);
    attempt += 1;
    retryTimer = Effect.runFork(
      Effect.sleep(delay).pipe(
        Effect.andThen(
          Effect.sync(() => {
            retryTimer = null;
            startOpen();
          }),
        ),
      ),
    );
  }

  function finish(): void {
    if (xhr === null) {
      return;
    }
    // A tail (an `end`, or the final `draft`) that only arrives with the last
    // readyState change / onload / onerror must still be parsed before the
    // stream goes away.
    pump();
    closeXhr();
    scheduleRetry();
  }

  // A token read that throws or rejects is "no token", like a missing one.
  const readToken: Effect.Effect<string | undefined> = Effect.try(() => options.getToken()).pipe(
    Effect.flatMap((token) =>
      typeof token === 'string' || token === undefined
        ? Effect.succeed(token)
        : Effect.tryPromise(() => token),
    ),
    Effect.orElseSucceed(() => undefined),
  );

  const open: Effect.Effect<void> = Effect.gen(function* () {
    if (closed || !active || xhr !== null) {
      return;
    }
    const token = yield* readToken;
    if (closed || !active || xhr !== null) {
      return;
    }
    if (token === undefined || token === '') {
      // A missing session (or a transient read failure) must not silence the
      // stream until the next AppState cycle: retry with the normal backoff.
      scheduleRetry();
      return;
    }
    const request = createXhr();
    xhr = request;
    offset = 0;
    buffer = '';
    request.onprogress = () => pump();
    request.onreadystatechange = () => {
      if (request.readyState === 3) {
        // A first partial response means the connection is live; retry soon
        // after a later drop.
        attempt = 0;
        pump();
      } else if (request.readyState === 4) {
        finish();
      }
    };
    request.onerror = () => finish();
    request.onload = () => {
      if (request.readyState === 4) {
        finish();
      }
    };
    yield* Effect.try(() => {
      request.open('GET', options.url);
      request.setRequestHeader('Accept', 'text/event-stream');
      request.setRequestHeader('Authorization', `Bearer ${token}`);
      request.send();
    }).pipe(Effect.catch(() => Effect.sync(finish)));
  });

  function startOpen(): void {
    Effect.runFork(open);
  }

  const unsubscribe = options.appState.subscribe((state) => {
    if (closed) {
      return;
    }
    const next = state === 'active';
    if (next === active) {
      return;
    }
    active = next;
    if (active) {
      clearRetry();
      attempt = 0;
      startOpen();
    } else {
      clearRetry();
      closeXhr();
    }
  });

  startOpen();

  return () => {
    closed = true;
    unsubscribe();
    clearRetry();
    closeXhr();
  };
}
