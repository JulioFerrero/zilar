import type { XmppClient } from '@xmpp/client';
import { Effect } from 'effect';
import { buildPingRequest } from '../stanza';
import { schedule } from '../timers';
import {
  DEFAULT_KEEPALIVE_MS,
  DEFAULT_KEEPALIVE_TIMEOUT_MS,
  attempt,
  type CoreRuntime,
} from './config';

export type KeepaliveApi = {
  stopKeepalive: () => void;
  startKeepalive: () => void;
  keepaliveEnabled: () => boolean;
  handleKeepaliveReply: (id: string) => boolean;
};

// The XEP-0199 keepalive: while online, ping the server after an idle period and tear
// the connection down when no reply comes, so the normal path reconnects.
export function createKeepalive(
  runtime: CoreRuntime,
  disconnectQuietly: (current: XmppClient) => void,
): KeepaliveApi {
  function keepaliveEnabled(): boolean {
    const idle = runtime.options.keepaliveMs ?? DEFAULT_KEEPALIVE_MS;
    const timeout = runtime.options.keepaliveTimeoutMs ?? DEFAULT_KEEPALIVE_TIMEOUT_MS;
    return idle > 0 && timeout > 0;
  }

  function stopKeepalive(): void {
    runtime.keepalivePingId = undefined;
    if (runtime.keepaliveIdleTimer !== undefined) {
      runtime.keepaliveIdleTimer();
      runtime.keepaliveIdleTimer = undefined;
    }
    if (runtime.keepaliveReplyTimer !== undefined) {
      runtime.keepaliveReplyTimer();
      runtime.keepaliveReplyTimer = undefined;
    }
  }

  // Pings after `keepaliveMs` of silence; no reply in `keepaliveTimeoutMs` means dead.
  function startKeepalive(): void {
    stopKeepalive();
    if (!keepaliveEnabled() || !runtime.desiredOnline) return;
    runtime.keepaliveIdleTimer = schedule(
      runtime.options.keepaliveMs ?? DEFAULT_KEEPALIVE_MS,
      () => {
        runtime.keepaliveIdleTimer = undefined;
        Effect.runFork(sendKeepalivePing());
      },
    );
  }

  const sendKeepalivePing = Effect.fnUntraced(function* (): Effect.fn.Return<void> {
    const current = runtime.xmpp;
    if (current === undefined || !runtime.desiredOnline || runtime.currentStatus !== 'online') {
      return;
    }
    const id = runtime.generateId();
    runtime.keepalivePingId = id;
    const sent = yield* attempt(() =>
      current.send(buildPingRequest({ id, to: runtime.options.domain })),
    ).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (!sent) {
      runtime.keepalivePingId = undefined;
      reconnectDeadConnection();
      return;
    }
    runtime.keepaliveReplyTimer = schedule(
      runtime.options.keepaliveTimeoutMs ?? DEFAULT_KEEPALIVE_TIMEOUT_MS,
      () => {
        runtime.keepaliveReplyTimer = undefined;
        runtime.keepalivePingId = undefined;
        reconnectDeadConnection();
      },
    );
  });

  // The keepalive found a dead connection: tear the socket down so the library reconnects
  // through the normal path.
  function reconnectDeadConnection(): void {
    stopKeepalive();
    const current = runtime.xmpp;
    if (current === undefined || !runtime.desiredOnline) return;
    disconnectQuietly(current);
  }

  function handleKeepaliveReply(id: string): boolean {
    if (runtime.keepalivePingId === undefined || runtime.keepalivePingId !== id) return false;
    runtime.keepalivePingId = undefined;
    if (runtime.keepaliveReplyTimer !== undefined) {
      runtime.keepaliveReplyTimer();
      runtime.keepaliveReplyTimer = undefined;
    }
    // A result or an error both prove the connection is alive.
    startKeepalive();
    return true;
  }

  return { stopKeepalive, startKeepalive, keepaliveEnabled, handleKeepaliveReply };
}
