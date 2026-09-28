/**
 * The mobile draft-stream client (T-0056). The web uses `EventSource`
 * (`apps/web/src/lib/drafts.ts`); React Native has no `EventSource` and its
 * `fetch` does not stream response bodies, so this reads the SSE stream from
 * `XMLHttpRequest.responseText` as it grows.
 *
 * The contract is mirrored from `apps/server/src/drafts/events.ts`: `event:
 * draft` carries the AI's cumulative reply text, `event: end` closes a turn.
 * Frames that fail validation are dropped silently; nothing here throws and the
 * token and draft text are never logged.
 */
import type { AppStateLike } from '../store/real-store';

/** The stream path, joined with the API URL by the store. */
export const DRAFT_STREAM_PATH = '/api/drafts/stream';

/** Reconnect waits (1 s -> 30 s cap, jittered) while signed in and active. */
export const DRAFT_RECONNECT_BASE_MS = 1_000;
export const DRAFT_RECONNECT_MAX_MS = 30_000;

export interface DraftEvent {
  type: 'draft';
  chatJid: string;
  turnId: string;
  text: string;
}

export interface DraftEndEvent {
  type: 'end';
  chatJid: string;
  turnId: string;
  outcome: 'sent' | 'failed';
}

export type DraftHubEvent = DraftEvent | DraftEndEvent;

export type DraftEventListener = (event: DraftHubEvent) => void;

/** Opens the draft stream and returns a function that closes it. */
export type OpenDraftStream = (onEvent: DraftEventListener) => () => void;

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
  setTimer?: (handler: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Parses one `data:` payload into a validated draft event, or `undefined`. The
 * mobile app has no zod (see `chat-api.ts`), so this is a hand-written validator
 * over the same shapes as the web's schemas.
 */
function parseEventData(data: string): DraftHubEvent | undefined {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (!isRecord(json)) {
    return undefined;
  }
  const chatJid = json['chatJid'];
  const turnId = json['turnId'];
  if (typeof chatJid !== 'string' || chatJid.length === 0) {
    return undefined;
  }
  if (typeof turnId !== 'string' || !UUID.test(turnId)) {
    return undefined;
  }
  if (json['type'] === 'draft') {
    const text = json['text'];
    return typeof text === 'string' ? { type: 'draft', chatJid, turnId, text } : undefined;
  }
  if (json['type'] === 'end') {
    const outcome = json['outcome'];
    return outcome === 'sent' || outcome === 'failed'
      ? { type: 'end', chatJid, turnId, outcome }
      : undefined;
  }
  return undefined;
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
    return parseEventData(data);
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
  onEvent: DraftEventListener,
  options: DraftStreamOptions,
): () => void {
  const createXhr = options.createXhr ?? defaultXhr;
  const random = options.random ?? Math.random;
  const setTimer = options.setTimer ?? ((handler, delay) => setTimeout(handler, delay));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
  const baseDelayMs = options.baseDelayMs ?? DRAFT_RECONNECT_BASE_MS;
  const maxDelayMs = options.maxDelayMs ?? DRAFT_RECONNECT_MAX_MS;

  let closed = false;
  let active = options.appState.current() === 'active';
  let xhr: DraftXhr | null = null;
  let offset = 0;
  let buffer = '';
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  function clearRetry(): void {
    if (retryTimer !== null) {
      clearTimer(retryTimer);
      retryTimer = null;
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
    const base = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    attempt += 1;
    // Full jitter: half the base plus up to half again.
    const delay = Math.round(base / 2 + (base / 2) * random());
    retryTimer = setTimer(() => {
      retryTimer = null;
      void open();
    }, delay);
  }

  function finish(): void {
    if (xhr === null) {
      return;
    }
    closeXhr();
    scheduleRetry();
  }

  async function open(): Promise<void> {
    if (closed || !active || xhr !== null) {
      return;
    }
    let token: string | undefined;
    try {
      token = await options.getToken();
    } catch {
      token = undefined;
    }
    if (closed || !active || xhr !== null) {
      return;
    }
    if (token === undefined || token === '') {
      // Not signed in: nothing to stream.
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
    try {
      request.open('GET', options.url);
      request.setRequestHeader('Accept', 'text/event-stream');
      request.setRequestHeader('Authorization', `Bearer ${token}`);
      request.send();
    } catch {
      finish();
    }
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
      void open();
    } else {
      clearRetry();
      closeXhr();
    }
  });

  void open();

  return () => {
    closed = true;
    unsubscribe();
    clearRetry();
    closeXhr();
  };
}
