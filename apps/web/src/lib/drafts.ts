import { z } from 'zod';

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
const draftEventSchema = z.object({
  type: z.literal('draft'),
  chatJid: z.string().min(1),
  turnId: z.string().uuid(),
  text: z.string(),
});

const endEventSchema = z.object({
  type: z.literal('end'),
  chatJid: z.string().min(1),
  turnId: z.string().uuid(),
  outcome: z.enum(['sent', 'failed']),
});

export type DraftEvent = z.infer<typeof draftEventSchema>;
export type DraftEndEvent = z.infer<typeof endEventSchema>;
export type DraftHubEvent = DraftEvent | DraftEndEvent;

export type DraftEventListener = (event: DraftHubEvent) => void;

/** Opens the draft stream and returns a function that closes it. */
export type OpenDraftStream = (onEvent: DraftEventListener) => () => void;

/** Same origin as the app: the session cookie is sent automatically. */
export const DRAFT_STREAM_URL = '/api/drafts/stream';

/** The slice of `EventSource` the client uses. Tests inject a fake. */
export interface DraftEventSource {
  addEventListener(type: 'draft' | 'end', listener: (event: MessageEvent) => void): void;
  close(): void;
}

function defaultDraftSource(url: string): DraftEventSource {
  return new EventSource(url);
}

function parseEvent<T>(schema: z.ZodType<T>, data: unknown): T | undefined {
  if (typeof data !== 'string') {
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return undefined;
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Subscribes to the signed-in user's own AI drafts. Events that fail
 * validation are dropped silently; nothing here throws. `EventSource`
 * reconnects on its own, so there is no retry loop. The returned function
 * closes the stream.
 */
export function subscribeToDrafts(
  onEvent: DraftEventListener,
  createSource: (url: string) => DraftEventSource = defaultDraftSource,
): () => void {
  let source: DraftEventSource;
  try {
    source = createSource(DRAFT_STREAM_URL);
  } catch {
    // No usable `EventSource`: the app simply behaves as without drafts.
    return () => {};
  }

  source.addEventListener('draft', (event) => {
    const parsed = parseEvent(draftEventSchema, event.data);
    if (parsed !== undefined) {
      onEvent(parsed);
    }
  });
  source.addEventListener('end', (event) => {
    const parsed = parseEvent(endEventSchema, event.data);
    if (parsed !== undefined) {
      onEvent(parsed);
    }
  });

  return () => source.close();
}
