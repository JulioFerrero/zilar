import { Result, Schema } from 'effect';
import { struct } from '@zilar/protocol';

// The draft-stream contract, mirrored from `apps/server/src/drafts/events.ts`
// (T-0041). The web app cannot import server code, so the shapes are copied
// here; keep them in sync with that file.
//
// - `chatJid` is the AI's bare JID, which is the DM's chat id in the store.
// - `turnId` is one UUID per gateway turn.
// - `text` is cumulative (the whole reply so far), so a dropped event is
//   harmless and a client that connects mid-turn renders the next one.
// - `end` is published after the server sent the final XMPP message (or the
//   failure text).
const draftEventSchema = struct({
  type: Schema.Literal('draft'),
  chatJid: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  turnId: Schema.String.pipe(Schema.check(Schema.isUUID())),
  text: Schema.String,
});

const endEventSchema = struct({
  type: Schema.Literal('end'),
  chatJid: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  turnId: Schema.String.pipe(Schema.check(Schema.isUUID())),
  outcome: Schema.Literals(['sent', 'failed']),
});

export type DraftEvent = typeof draftEventSchema.Type;
export type DraftEndEvent = typeof endEventSchema.Type;
export type DraftHubEvent = DraftEvent | DraftEndEvent;

export type DraftEventListener = (event: DraftHubEvent) => void;

/** Opens the draft stream and returns a function that closes it. */
export type OpenDraftStream = (onEvent: DraftEventListener) => () => void;

/** Same origin as the app: the session cookie is sent automatically. */
export const DRAFT_STREAM_URL = '/api/drafts/stream';

/** The slice of `EventSource` the client uses. Tests inject a fake. */
export interface DraftEventSource {
  /** `EventSource.readyState`: 2 means the browser stopped reconnecting. */
  readonly readyState: number;
  addEventListener(type: 'draft' | 'end' | 'error', listener: (event: MessageEvent) => void): void;
  close(): void;
}

/** Reconnect backoff: first retry after 1 s, doubling up to 30 s. */
export const DRAFT_RECONNECT_BASE_MS = 1_000;
export const DRAFT_RECONNECT_MAX_MS = 30_000;

const EVENT_SOURCE_CLOSED = 2;

function defaultDraftSource(url: string): DraftEventSource {
  return new EventSource(url);
}

function parseEvent<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  data: unknown,
): S['Type'] | undefined {
  if (typeof data !== 'string') {
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return undefined;
  }
  const parsed = Schema.decodeUnknownResult(schema)(json);
  return Result.isSuccess(parsed) ? parsed.success : undefined;
}

/**
 * Subscribes to the signed-in user's own AI drafts. Events that fail
 * validation are dropped silently; nothing here throws. An `EventSource` only
 * reconnects on its own after a dropped connection: a non-2xx response (a
 * deploy's 502, a 401) closes it for good, so those are reopened with a
 * jittered backoff (1 s -> 30 s). The returned function cancels a pending
 * retry and closes the current source.
 */
export function subscribeToDrafts(
  onEvent: DraftEventListener,
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
    const base = Math.min(DRAFT_RECONNECT_MAX_MS, DRAFT_RECONNECT_BASE_MS * 2 ** attempt);
    attempt += 1;
    // Full jitter: half the base plus up to half again.
    const delay = Math.round(base / 2 + (base / 2) * random());
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
      // No usable `EventSource`: the app simply behaves as without drafts.
      return;
    }
    source = next;

    // A frame proves the stream is healthy, so the next retry starts at 1 s.
    next.addEventListener('draft', (event) => {
      attempt = 0;
      const parsed = parseEvent(draftEventSchema, event.data);
      if (parsed !== undefined) {
        onEvent(parsed);
      }
    });
    next.addEventListener('end', (event) => {
      attempt = 0;
      const parsed = parseEvent(endEventSchema, event.data);
      if (parsed !== undefined) {
        onEvent(parsed);
      }
    });
    next.addEventListener('error', () => {
      // CONNECTING means the browser will reconnect by itself; only a CLOSED
      // source (a non-2xx response) needs a fresh `EventSource`.
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
