// The mobile background lifecycle (F1): `suspend()` parks the session when
// the app leaves the foreground, `wake()` brings it back on resume.
//
// xmpp.js keeps the stream-management id across a `disconnect` and clears it
// only on `offline` (`@xmpp/stream-management/index.js:57-63` vs `:117-123`),
// and attempts a `<resume/>` when the id is still set (`stream-feature.js:18-27`).
// So `suspend()` ends the socket below the stream layer, and `wake()` drives a
// normal reconnect, which resumes when ejabberd still holds the session.
import { type XmppClient, type XmppStatus } from '@xmpp/client';
import { Effect } from 'effect';
import { attempt, type CoreRuntime } from './config';
import type { LifecycleApi } from './lifecycle';
import type { WakeOutcome } from '../types-suspend';

// Only what `suspend.ts` reads of the library client: the ambient
// `XmppClient` knows `start`/`stop`/`disconnect` but not the socket or the
// stream-management state. Fakes in the tests keep the same shape.
type SuspendableClient = {
  status: XmppStatus;
  socket: { end(): void } | null;
  reconnect: { start(): void; stop(): void };
  streamManagement?: { id?: string; on(event: string, listener: () => void): unknown } | null;
};

function asSuspendable(current: XmppClient): SuspendableClient | undefined {
  const client = current as unknown as SuspendableClient;
  return typeof client.status === 'string' && client.socket !== undefined ? client : undefined;
}

// The stream-management id xmpp.js would resume with (`previd`), if any. It
// survives `disconnect` and is cleared only by `offline` or a fresh bind.
function streamManagementId(current: XmppClient): string | undefined {
  const sm = asSuspendable(current)?.streamManagement;
  const id = sm?.id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

// `start()` throws unless the library is offline, but after a `suspend()` the
// socket just closed (`disconnect`): the stream underneath is the same one,
// so stepping back to `offline` is the resume the library's own driver would
// run, without losing the stream-management id an `offline` event would clear.
function readyForRestart(current: XmppClient): void {
  const client = asSuspendable(current);
  if (client !== undefined && client.status === 'disconnect') {
    client.status = 'offline';
  }
}

export type SuspendApi = {
  suspend: () => Effect.Effect<void, Error>;
  wake: () => Effect.Effect<WakeOutcome, Error>;
};

export function createSuspend(runtime: CoreRuntime, lifecycle: LifecycleApi): SuspendApi {
  // Whether `suspend()` stopped the reconnect driver. `wake()` restarts it
  // exactly once, so foregrounds without an earlier `suspend()` never stack
  // extra `disconnect` listeners (one drop = one reconnect).
  let suspended = false;

  // Stops the library's reconnect driver, our watchdog and our keepalive,
  // then ends the socket directly: no framing `</stream>`, no `close` hook,
  // so ejabberd moves the session to pending (stream-management hibernation)
  // and pushes per stanza while the SM id stays resumable.
  const suspend = Effect.fnUntraced(function* (): Effect.fn.Return<void, Error> {
    const current = runtime.xmpp;
    runtime.desiredOnline = false;
    lifecycle.stopWatchdog();
    lifecycle.stopKeepalive();
    if (current !== undefined) {
      const client = asSuspendable(current);
      if (client !== undefined) {
        client.reconnect.stop();
        suspended = true;
      }
      if (client?.socket != null) {
        const socket = client.socket;
        // A synchronous throw (an already-dead socket) must still leave the
        // status offline, so a failed close is ignored.
        yield* attempt(() => Promise.resolve().then(() => socket.end())).pipe(Effect.ignore);
      }
    }
    lifecycle.setStatus('offline');
  });

  // Reconnects, resuming when ejabberd still holds the session. The driver
  // restarts only when `suspend()` stopped it: without a suspend it is
  // already running, and another `start()` would stack a second `disconnect`
  // listener. A successful stream-management resume keeps the SM id (see the
  // `resumed` handler in `core-effect.ts`); a fresh bind replaces it, which
  // reports `rebound` (a new session).
  const wake = Effect.fnUntraced(function* (): Effect.fn.Return<WakeOutcome, Error> {
    const wasSuspended = suspended;
    suspended = false;
    const current = runtime.xmpp;
    if (current === undefined) {
      yield* lifecycle.connect();
      return 'rebound';
    }
    if (wasSuspended) {
      asSuspendable(current)?.reconnect.start();
    }
    const before = streamManagementId(current);
    readyForRestart(current);
    yield* lifecycle.connect();
    const after = streamManagementId(current);
    return before !== undefined && after === before ? 'resumed' : 'rebound';
  });

  return { suspend, wake };
}
