import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { DraftHubEvent } from './events';
import { sharedDraftHub, type DraftHub } from './hub';

// A comment line this often keeps the connection (and any proxy buffer)
// alive between turns. Carried as an SSE comment, so event parsers ignore it.
export const DRAFT_SSE_HEARTBEAT_MS = 25_000;

export interface DraftsRoutesDependencies {
  auth: Auth;
  hub?: DraftHub;
}

// `GET /api/drafts/stream`: the caller's own AI drafts as `event: draft` /
// `event: end` with JSON `data:`. Same signed-in session as the other `/api`
// routes (401 otherwise). No history and no replay: a client that connects
// mid-turn gets the next cumulative `draft`.
export function createDraftsRoutes({ auth, hub = sharedDraftHub }: DraftsRoutesDependencies): Hono {
  const routes = new Hono();

  routes.get('/drafts/stream', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    c.header('Cache-Control', 'no-cache');
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      const queue: DraftHubEvent[] = [];
      let wake: (() => void) | undefined;
      const unsubscribe = hub.subscribe(user.id, (event) => {
        queue.push(event);
        wake?.();
      });
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
        wake?.();
      });
      try {
        while (!aborted) {
          while (queue.length > 0 && !aborted) {
            const event = queue.shift() as DraftHubEvent;
            await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
          }
          if (aborted) {
            break;
          }
          // Either an event arrives or the heartbeat fires. The length check
          // inside the executor closes the race between draining and waiting.
          const notified = await new Promise<boolean>((resolve) => {
            if (queue.length > 0) {
              resolve(true);
              return;
            }
            const timer = setTimeout(() => {
              wake = undefined;
              resolve(false);
            }, DRAFT_SSE_HEARTBEAT_MS);
            wake = () => {
              clearTimeout(timer);
              wake = undefined;
              resolve(true);
            };
          });
          if (aborted) {
            break;
          }
          if (!notified) {
            await stream.write(': heartbeat\n\n');
          }
        }
      } finally {
        // Client disconnect lands here through `onAbort`: no leaked listener.
        unsubscribe();
      }
    });
  });

  return routes;
}
