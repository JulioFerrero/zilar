// effect-plain: the runner's desk frames are control/byte plumbing over the
// mux (loopback sockets, docker exec); the mux itself carries the Effect.
import type net from 'node:net';
import {
  type DeskErrorCode,
  type DeskExecFrame,
  type DeskProvisionFrame,
  type DeskReplyFrame,
  type DeskStopFrame,
} from './desk-frames.ts';
import { createLoopbackPair } from './http-agent.ts';
import { attachSocketToStream, type StreamMux } from './mux.ts';

/** The outcome of a runner-side provision, mapped by the runner's handler. */
export type DeskProvisionOutcome =
  | { readonly kind: 'ready' }
  | { readonly kind: 'queued'; readonly position: number }
  | { readonly kind: 'error'; readonly code: DeskErrorCode; readonly message: string };

/** The outcome of a runner-side stop. */
export type DeskStopOutcome =
  | { readonly kind: 'stopped' }
  | { readonly kind: 'error'; readonly code: DeskErrorCode; readonly message: string };

/**
 * The runner app implements this against `@zilar/desk`'s lifecycle and its own
 * isolation driver. The tunnel package injects it, so this layer never imports
 * Docker or the desk package (plan §2, §6.2).
 */
export interface DeskRunnerHandler {
  /** Idempotent per `desk_id`; a missing jail driver answers `jail_unavailable`. */
  provision(frame: DeskProvisionFrame): Promise<DeskProvisionOutcome>;
  stop(frame: DeskStopFrame): Promise<DeskStopOutcome>;
  /**
   * Runs `docker exec -i … desk-tool serve` for the jail and bridges `stream`
   * (the local end of a loopback pair) to the daemon's stdin/stdout. Rejects
   * when the jail is not provisioned or the daemon cannot start.
   */
  exec(frame: DeskExecFrame, stream: net.Socket): Promise<void>;
}

/** The frames this side handles: every server→runner `desk.*` frame. */
export type DeskRunnerFrame = DeskProvisionFrame | DeskExecFrame | DeskStopFrame;

/**
 * Answers every request when the runner supplied no handler: the runner still
 * pairs and serves its other features, but its desks are refused (plan §6.2,
 * "no unsandboxed mode").
 */
const REFUSING_HANDLER: DeskRunnerHandler = {
  provision: () =>
    Promise.resolve({
      kind: 'error',
      code: 'jail_unavailable',
      message: 'this runner has no desk handler',
    }),
  stop: () =>
    Promise.resolve({
      kind: 'error',
      code: 'jail_unavailable',
      message: 'this runner has no desk handler',
    }),
  exec: () => Promise.reject(new Error('this runner has no desk handler')),
};

/**
 * The runner side of the desk frames (plan §2, §6.1). It validates stream ids,
 * asks the injected handler, and answers with `desk.ready`/`desk.stopped`/
 * `desk.error`/`queued`. It never throws: a bad frame is answered on the wire.
 */
export class DeskRunner {
  private readonly handler: DeskRunnerHandler;

  constructor(handler: DeskRunnerHandler | null = null) {
    this.handler = handler ?? REFUSING_HANDLER;
  }

  handle(mux: StreamMux, message: DeskRunnerFrame): void {
    switch (message.type) {
      case 'desk.provision':
        void this.provision(mux, message);
        return;
      case 'desk.exec':
        void this.exec(mux, message);
        return;
      case 'desk.stop':
        void this.stop(mux, message);
        return;
    }
  }

  private async provision(mux: StreamMux, frame: DeskProvisionFrame): Promise<void> {
    try {
      const outcome = await this.handler.provision(frame);
      if (outcome.kind === 'ready') {
        this.send(mux, { type: 'desk.ready', desk_id: frame.desk_id });
      } else if (outcome.kind === 'queued') {
        this.send(mux, { type: 'queued', desk_id: frame.desk_id, position: outcome.position });
      } else {
        this.send(mux, {
          type: 'desk.error',
          desk_id: frame.desk_id,
          code: outcome.code,
          message: outcome.message,
        });
      }
    } catch {
      this.sendError(mux, frame.desk_id, 'tool_failed');
    }
  }

  private async stop(mux: StreamMux, frame: DeskStopFrame): Promise<void> {
    try {
      const outcome = await this.handler.stop(frame);
      if (outcome.kind === 'stopped') {
        this.send(mux, { type: 'desk.stopped', desk_id: frame.desk_id });
      } else {
        this.send(mux, {
          type: 'desk.error',
          desk_id: frame.desk_id,
          code: outcome.code,
          message: outcome.message,
        });
      }
    } catch {
      this.sendError(mux, frame.desk_id, 'tool_failed');
    }
  }

  private async exec(mux: StreamMux, frame: DeskExecFrame): Promise<void> {
    // Stream ids are split by parity: the server allocates even ids. An odd or
    // already-live id is a buggy or hostile server: refuse only this stream.
    if (frame.stream_id % 2 !== 0 || mux.hasStream(frame.stream_id)) {
      this.sendTunnelClosed(mux, frame.stream_id, 'bad desk.exec stream id');
      return;
    }
    // Register a buffering sink before building the loopback pair: the pair
    // takes a tick, and the request bytes the server sends meanwhile must not
    // be dropped by the mux's unknown-stream path.
    const buffered: Buffer[] = [];
    mux.registerStream(frame.stream_id, {
      onData(chunk): boolean {
        buffered.push(chunk);
        return true;
      },
      onEnded(): void {},
      onFailed(): void {},
      onSendResumed(): void {},
    });
    let pair: { client: net.Socket; server: net.Socket };
    try {
      pair = await createLoopbackPair();
    } catch {
      mux.unregisterStream(frame.stream_id);
      this.sendTunnelClosed(mux, frame.stream_id, 'could not open the desk stream');
      return;
    }
    const { client, server: bridge } = pair;
    attachSocketToStream(mux, frame.stream_id, bridge);
    for (const chunk of buffered) {
      if (!bridge.destroyed) {
        bridge.write(chunk);
      }
    }
    try {
      await this.handler.exec(frame, client);
    } catch {
      // Destroying the bridge opens a clean FIN to the server's desk socket.
      client.destroy();
      bridge.destroy();
    }
  }

  private send(mux: StreamMux, frame: DeskReplyFrame): void {
    try {
      mux.sendControl(frame);
    } catch {
      // The tunnel is dying; the close path cleans up.
    }
  }

  private sendError(mux: StreamMux, deskId: string, code: DeskErrorCode): void {
    this.send(mux, {
      type: 'desk.error',
      desk_id: deskId,
      code,
      message: 'the desk handler failed',
    });
  }

  private sendTunnelClosed(mux: StreamMux, streamId: number, reason: string): void {
    try {
      mux.sendControl({ type: 'tunnel.closed', stream_id: streamId, reason });
    } catch {
      // The tunnel is dying; the close path cleans up.
    }
  }
}
