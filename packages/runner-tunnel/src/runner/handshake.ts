import { Duration, Effect, Exit } from 'effect';
import { WebSocket } from 'ws';
import { signNonce } from '../keys.ts';
import { TunnelClosedError } from '../mux.ts';
import {
  CLOSE_MALFORMED,
  MAX_WS_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  parseControlMessage,
  type ControlMessage,
} from '../protocol.ts';
import { closeQuietly } from '../ws-close.ts';
import { installReadyConnection } from './connection.ts';
import type { RunnerRuntime } from './lifecycle.ts';

/** Dial the server once and run the hello/challenge/auth/ready exchange. */
export function connectOnce(rt: RunnerRuntime): Effect.Effect<void, TunnelClosedError> {
  const ws = new WebSocket(rt.serverUrl, { maxPayload: MAX_WS_PAYLOAD_BYTES });
  rt.ws = ws;
  return Effect.gen(function* () {
    yield* openSocket(ws, rt.handshakeTimeoutMs);
    if (rt.stopped) {
      return yield* Effect.fail(new TunnelClosedError('runner stopped'));
    }
    yield* Effect.sync(() => {
      ws.send(
        JSON.stringify({
          type: 'hello',
          runner_id: rt.runnerId,
          runner_version: rt.runnerVersion,
          protocol_version: PROTOCOL_VERSION,
        }),
      );
    });
    const challenge = yield* waitForType(ws, 'challenge', rt.handshakeTimeoutMs);
    if (challenge.type !== 'challenge') {
      return yield* Effect.fail(new TunnelClosedError('expected challenge'));
    }
    yield* Effect.sync(() => {
      ws.send(
        JSON.stringify({
          type: 'auth',
          signature: signNonce(rt.keypair.privateKey, Buffer.from(challenge.nonce, 'base64')),
        }),
      );
    });
    yield* waitForType(ws, 'ready', rt.handshakeTimeoutMs);
    if (rt.stopped) {
      return yield* Effect.fail(new TunnelClosedError('runner stopped'));
    }
    installReadyConnection(rt, ws);
  }).pipe(
    Effect.onExit((exit) => {
      if (Exit.isFailure(exit)) {
        closeQuietly(ws);
      }
      return Effect.void;
    }),
  );
}

export function openSocket(
  ws: WebSocket,
  timeoutMs: number,
): Effect.Effect<void, TunnelClosedError> {
  return Effect.callback<void, TunnelClosedError>((resume) => {
    function cleanup(): void {
      ws.removeListener('open', onOpen);
      ws.removeListener('error', onError);
    }
    function onOpen(): void {
      cleanup();
      resume(Effect.void);
    }
    function onError(err: Error): void {
      cleanup();
      resume(Effect.fail(new TunnelClosedError(`connection failed: ${err.message}`)));
    }
    ws.on('open', onOpen);
    ws.on('error', onError);
    return Effect.sync(cleanup);
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(timeoutMs),
      orElse: () => Effect.fail(new TunnelClosedError('connection timeout')),
    }),
  );
}

export function waitForType(
  ws: WebSocket,
  expected: 'challenge' | 'ready',
  timeoutMs: number,
): Effect.Effect<ControlMessage, TunnelClosedError> {
  return Effect.callback<ControlMessage, TunnelClosedError>((resume) => {
    function cleanup(): void {
      ws.removeListener('message', onMessage);
      ws.removeListener('close', onClose);
      ws.removeListener('error', onError);
    }
    function finish(outcome: ControlMessage | TunnelClosedError): void {
      cleanup();
      if (outcome instanceof Error) {
        resume(Effect.fail(outcome));
      } else {
        resume(Effect.succeed(outcome));
      }
    }
    function onMessage(data: unknown, isBinary: boolean): void {
      if (isBinary) {
        finish(new TunnelClosedError('binary frame during handshake'));
        closeQuietly(ws, CLOSE_MALFORMED, 'binary frame during handshake');
        return;
      }
      const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      const parsed = parseControlMessage(text, 'server-to-runner');
      if (!parsed.ok) {
        finish(new TunnelClosedError(`handshake failed: ${parsed.reason}`));
        return;
      }
      if (parsed.message.type !== expected) {
        finish(new TunnelClosedError(`expected ${expected}, got ${parsed.message.type}`));
        return;
      }
      finish(parsed.message);
    }
    function onClose(code: number, reason: Buffer): void {
      finish(
        new TunnelClosedError(
          `handshake connection closed (${code}): ${reason.toString() || 'no reason'}`,
        ),
      );
    }
    function onError(err: Error): void {
      finish(new TunnelClosedError(`handshake failed: ${err.message}`));
    }
    ws.on('message', onMessage);
    ws.on('close', onClose);
    ws.on('error', onError);
    return Effect.sync(cleanup);
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(timeoutMs),
      orElse: () => Effect.fail(new TunnelClosedError(`timeout waiting for ${expected}`)),
    }),
  );
}
