// effect-plain: the server's desk request plumbing is timers and loopback
// sockets over the mux; the mux itself carries the Effect.
import type net from 'node:net';
import type { DeskReplyFrame, DeskRequestFrame } from './desk-frames.ts';
import { DeskRequestError } from './desk-frames.ts';
import { createLoopbackPair } from './http-agent.ts';
import { attachSocketToStream, TunnelClosedError, type StreamMux } from './mux.ts';
import type { ControlMessage } from './protocol.ts';

/** How long `sendDesk` waits for the runner's reply before it gives up. */
export const DEFAULT_DESK_REPLY_TIMEOUT_MS = 30_000;

interface PendingDesk {
  readonly runnerId: string;
  readonly resolve: (reply: DeskReplyFrame) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

/**
 * Keyed by runner *and* desk id: ids are deterministic per ai/project, so two
 * runners may hold the same id and a reply may only resolve its own runner's request.
 */
function pendingKey(runnerId: string, deskId: string): string {
  return `${runnerId}\u0000${deskId}`;
}

/**
 * The server side of the desk frames: `sendDesk` sends provision/stop and resolves
 * with the reply frame; `openDeskExec` opens a duplex socket to the jail's daemon.
 */
export class DeskServer {
  private readonly pending = new Map<string, PendingDesk>();

  constructor(
    private readonly muxFor: (runnerId: string) => StreamMux | null,
    private readonly replyTimeoutMs: number = DEFAULT_DESK_REPLY_TIMEOUT_MS,
  ) {}

  /** Resolves with the runner's reply, or rejects on timeout/disconnect. */
  sendDesk(runnerId: string, frame: DeskRequestFrame): Promise<DeskReplyFrame> {
    const mux = this.muxFor(runnerId);
    if (mux === null) {
      return Promise.reject(new TunnelClosedError(`runner ${runnerId} is not connected`));
    }
    const key = pendingKey(runnerId, frame.desk_id);
    if (this.pending.has(key)) {
      return Promise.reject(
        new DeskRequestError('tool_failed', `a desk request for ${frame.desk_id} is in flight`),
      );
    }
    return new Promise<DeskReplyFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new DeskRequestError('timeout', `no desk reply for ${frame.desk_id}`));
      }, this.replyTimeoutMs);
      timer.unref();
      this.pending.set(key, { runnerId, resolve, reject, timer });
      try {
        mux.sendControl(frame);
      } catch (error) {
        this.pending.delete(key);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new TunnelClosedError('send failed'));
      }
    });
  }

  async openDeskExec(runnerId: string, deskId: string): Promise<net.Socket> {
    const mux = this.muxFor(runnerId);
    if (mux === null) {
      throw new TunnelClosedError(`runner ${runnerId} is not connected`);
    }
    const streamId = mux.allocateId();
    const { client, server: bridge } = await createLoopbackPair();
    attachSocketToStream(mux, streamId, bridge, {
      onStreamFailed: (error) => {
        if (!client.destroyed) {
          client.destroy(error);
        }
      },
    });
    try {
      mux.sendControl({ type: 'desk.exec', desk_id: deskId, stream_id: streamId });
    } catch (error) {
      client.destroy();
      bridge.destroy();
      throw error instanceof Error ? error : new TunnelClosedError('send failed');
    }
    return client;
  }

  /**
   * Routes a reply from `runnerId`; false when it is not a reply. A reply from a
   * runner holding no matching request is dropped, so one cannot resolve another's.
   */
  route(runnerId: string | null, message: ControlMessage): boolean {
    if (
      message.type !== 'desk.ready' &&
      message.type !== 'desk.stopped' &&
      message.type !== 'desk.error' &&
      message.type !== 'queued'
    ) {
      return false;
    }
    if (runnerId === null) {
      // Pre-auth connections cannot hold desk requests; drop the frame.
      return true;
    }
    const key = pendingKey(runnerId, message.desk_id);
    const pending = this.pending.get(key);
    if (pending === undefined) {
      // A reply with no request pending (e.g. after a timeout) is dropped, not a violation.
      return true;
    }
    this.pending.delete(key);
    clearTimeout(pending.timer);
    pending.resolve(message);
    return true;
  }

  /** A runner dropped: fail every request that was waiting on it. */
  failRunner(runnerId: string): void {
    for (const [key, pending] of this.pending) {
      if (pending.runnerId !== runnerId) {
        continue;
      }
      this.pending.delete(key);
      clearTimeout(pending.timer);
      pending.reject(new TunnelClosedError(`runner ${runnerId} disconnected`));
    }
  }
}
