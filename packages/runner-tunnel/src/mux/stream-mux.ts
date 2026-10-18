import { Deferred, Duration, Effect } from 'effect';
import type { WebSocket } from 'ws';
import {
  FRAME_DATA,
  FRAME_FIN,
  MAX_FRAME_BYTES,
  decodeBinaryFrame,
  encodeBinaryFrame,
  type ControlMessage,
} from '../protocol.ts';
import { TunnelClosedError } from './errors.ts';
import type { StreamMuxOptions, StreamSink } from './types.ts';

/**
 * Multiplexes streams over one WebSocket; both sides share it, only stream-id parity
 * differs. Backpressure end to end: a slow sink returns false from `onData`, which
 * sends `tunnel.pause`; a full WebSocket buffer stops reading the source.
 */
export class StreamMux {
  unknownStreamsDropped = 0;
  /** Highest `bufferedAmount` seen on this socket. Reported by the 50 MB test. */
  peakBufferedAmount = 0;

  private readonly highWaterMark: number;
  private nextId: number;
  private readonly streams = new Map<number, StreamSink>();
  private readonly locallyPaused = new Set<number>();
  private readonly pausedByRemote = new Set<number>();
  private readonly resumeWaiters = new Map<number, Array<Deferred.Deferred<void, Error>>>();
  private readonly tails = new Map<number, Deferred.Deferred<void>>();
  private failed: Error | null = null;

  private readonly ws: WebSocket;

  constructor(ws: WebSocket, startId: number, options?: StreamMuxOptions) {
    this.ws = ws;
    this.nextId = startId;
    this.highWaterMark = options?.highWaterMarkBytes ?? 1024 * 1024;
  }

  allocateId(): number {
    const id = this.nextId;
    this.nextId += 2;
    return id;
  }

  registerStream(streamId: number, sink: StreamSink): void {
    this.streams.set(streamId, sink);
  }

  hasStream(streamId: number): boolean {
    return this.streams.has(streamId);
  }

  unregisterStream(streamId: number): boolean {
    this.locallyPaused.delete(streamId);
    this.pausedByRemote.delete(streamId);
    return this.streams.delete(streamId);
  }

  sendControl(message: ControlMessage): void {
    this.throwIfDead();
    try {
      this.ws.send(JSON.stringify(message));
    } catch {
      throw new TunnelClosedError('websocket send failed');
    }
  }

  /**
   * Chunks to the max frame size and waits while the remote asked for a pause and while
   * the socket buffer is over the high-water mark. Sends on one stream are FIFO: a queued
   * teardown always runs last, so a FIN never overtakes trailing data.
   */
  sendStreamData(streamId: number, chunk: Buffer): Promise<void> {
    return Effect.runPromise(this.sendStreamDataEffect(streamId, chunk));
  }

  /** `sendStreamData` as an Effect; the queue slot is taken when it starts running. */
  sendStreamDataEffect(streamId: number, chunk: Buffer): Effect.Effect<void, Error> {
    return Effect.suspend(() => {
      const previous = this.tails.get(streamId);
      const current = Deferred.makeUnsafe<void>();
      this.tails.set(streamId, current);
      const release = Effect.sync(() => {
        if (this.tails.get(streamId) === current) {
          this.tails.delete(streamId);
        }
        Deferred.doneUnsafe(current, Effect.void);
      });
      return (previous === undefined ? Effect.void : Deferred.await(previous)).pipe(
        Effect.andThen(this.sendNow(streamId, chunk)),
        Effect.ensuring(release),
      );
    });
  }

  /**
   * Tear down after everything queued has gone out: a clean FIN or `tunnel.closed`. Only
   * the first teardown acts; the rest are no-ops. Never throws.
   */
  enqueueTeardown(streamId: number, kind: 'fin' | { closed: string }): void {
    const previous = this.tails.get(streamId);
    const done = Deferred.makeUnsafe<void>();
    this.tails.set(streamId, done);
    const teardown = Effect.gen({ self: this }, function* () {
      if (previous !== undefined) {
        yield* Deferred.await(previous);
      }
      if (this.unregisterStream(streamId)) {
        if (kind === 'fin') {
          this.sendFin(streamId);
        } else {
          // The tunnel is dying; failAll below cleans the stream up.
          yield* Effect.try(() =>
            this.sendControl({ type: 'tunnel.closed', stream_id: streamId, reason: kind.closed }),
          ).pipe(Effect.ignore);
        }
      }
    });
    Effect.runFork(
      teardown.pipe(
        Effect.catchCause(() => Effect.void),
        Effect.ensuring(
          Effect.sync(() => {
            if (this.tails.get(streamId) === done) {
              this.tails.delete(streamId);
            }
            Deferred.doneUnsafe(done, Effect.void);
          }),
        ),
      ),
    );
  }

  private sendNow(streamId: number, chunk: Buffer): Effect.Effect<void, Error> {
    return Effect.gen({ self: this }, function* () {
      let offset = 0;
      while (offset < chunk.length) {
        yield* this.waitSendable(streamId);
        const end = Math.min(chunk.length, offset + MAX_FRAME_BYTES);
        const frame = encodeBinaryFrame(streamId, FRAME_DATA, chunk.subarray(offset, end));
        offset = end;
        this.peakBufferedAmount = Math.max(this.peakBufferedAmount, this.ws.bufferedAmount);
        yield* this.sendRaw(frame);
      }
    });
  }

  sendFin(streamId: number): void {
    if (this.ws.readyState !== this.ws.OPEN) {
      return;
    }
    try {
      this.ws.send(encodeBinaryFrame(streamId, FRAME_FIN, Buffer.alloc(0)));
    } catch {
      // Teardown best-effort: the peer detects the dead socket anyway.
    }
  }

  handleBinary(data: Buffer): void {
    let frame: ReturnType<typeof decodeBinaryFrame>;
    try {
      frame = decodeBinaryFrame(data);
    } catch {
      this.unknownStreamsDropped += 1;
      return;
    }
    if (frame === null || (frame.kind !== FRAME_DATA && frame.kind !== FRAME_FIN)) {
      this.unknownStreamsDropped += 1;
      return;
    }
    const sink = this.streams.get(frame.streamId);
    if (sink === undefined) {
      this.unknownStreamsDropped += 1;
      return;
    }
    try {
      if (frame.kind === FRAME_FIN) {
        this.unregisterStream(frame.streamId);
        sink.onEnded();
      } else {
        const accepted = sink.onData(frame.payload);
        if (!accepted) {
          this.noteSinkFull(frame.streamId);
        }
      }
    } catch {
      this.unregisterStream(frame.streamId);
      notifyFailed(sink, new TunnelClosedError('stream sink threw'));
    }
  }

  handlePause(streamId: number): void {
    if (!this.streams.has(streamId)) {
      return;
    }
    this.pausedByRemote.add(streamId);
  }

  handleResume(streamId: number): void {
    if (!this.pausedByRemote.delete(streamId)) {
      return;
    }
    const waiters = this.resumeWaiters.get(streamId);
    this.resumeWaiters.delete(streamId);
    for (const waiter of waiters ?? []) {
      Deferred.doneUnsafe(waiter, Effect.void);
    }
  }

  noteSinkFull(streamId: number): void {
    if (this.locallyPaused.has(streamId) || !this.streams.has(streamId)) {
      return;
    }
    this.locallyPaused.add(streamId);
    try {
      this.sendControl({ type: 'tunnel.pause', stream_id: streamId });
    } catch {
      // The tunnel is dying; failAll below will clean the stream up.
    }
  }

  noteDrained(streamId: number): void {
    if (!this.locallyPaused.delete(streamId)) {
      return;
    }
    try {
      this.sendControl({ type: 'tunnel.resume', stream_id: streamId });
    } catch {
      // The tunnel is dying; failAll below will clean the stream up.
    }
  }

  failStream(streamId: number, err: Error): boolean {
    const sink = this.streams.get(streamId);
    if (sink === undefined) {
      return false;
    }
    this.unregisterStream(streamId);
    notifyFailed(sink, err);
    return true;
  }

  failAll(err: Error): void {
    if (this.failed !== null) {
      return;
    }
    this.failed = err;
    for (const waiters of this.resumeWaiters.values()) {
      for (const waiter of waiters) {
        Deferred.doneUnsafe(waiter, Effect.fail(err));
      }
    }
    this.resumeWaiters.clear();
    const sinks = [...this.streams.entries()];
    this.streams.clear();
    this.locallyPaused.clear();
    this.pausedByRemote.clear();
    for (const [, sink] of sinks) {
      notifyFailed(sink, err);
    }
  }

  private deadError(): Error | null {
    if (this.failed !== null) {
      return this.failed;
    }
    if (this.ws.readyState !== this.ws.OPEN) {
      return new TunnelClosedError('websocket is not open');
    }
    return null;
  }

  private throwIfDead(): void {
    const dead = this.deadError();
    if (dead !== null) {
      throw dead;
    }
  }

  private failIfDead(): Effect.Effect<void, Error> {
    return Effect.suspend(() => {
      const dead = this.deadError();
      return dead === null ? Effect.void : Effect.fail(dead);
    });
  }

  private waitSendable(streamId: number): Effect.Effect<void, Error> {
    return Effect.gen({ self: this }, function* () {
      for (;;) {
        yield* this.failIfDead();
        if (!this.pausedByRemote.has(streamId) && this.ws.bufferedAmount <= this.highWaterMark) {
          return;
        }
        if (this.pausedByRemote.has(streamId)) {
          yield* this.waitResume(streamId);
        } else {
          yield* Effect.sleep(Duration.millis(2));
        }
      }
    });
  }

  private waitResume(streamId: number): Effect.Effect<void, Error> {
    return Effect.suspend(() => {
      const waiter = Deferred.makeUnsafe<void, Error>();
      const list = this.resumeWaiters.get(streamId) ?? [];
      list.push(waiter);
      this.resumeWaiters.set(streamId, list);
      return Deferred.await(waiter);
    });
  }

  private sendRaw(frame: Buffer): Effect.Effect<void, Error> {
    return this.failIfDead().pipe(
      Effect.andThen(
        Effect.callback<void, Error>((resume) => {
          try {
            this.ws.send(frame, (err) => {
              resume(err ? Effect.fail(new TunnelClosedError(err.message)) : Effect.void);
            });
          } catch (err) {
            resume(
              Effect.fail(
                err instanceof Error ? err : new TunnelClosedError('websocket send failed'),
              ),
            );
          }
        }),
      ),
    );
  }
}

function notifyFailed(sink: StreamSink, err: Error): void {
  try {
    sink.onFailed(err);
  } catch {
    // Last resort: never let a bad sink kill the mux.
  }
}
