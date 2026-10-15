import { Schema } from 'effect';
import { RunnerOptionsSchema, type RunnerOptions } from './runner/options.ts';
import {
  createRunnerRuntime,
  onRunnerEvent,
  startRunner,
  stopRunner,
  type RunnerRuntime,
} from './runner/lifecycle.ts';

export { computeBackoff } from './runner/options.ts';
export type { RunnerOptions } from './runner/options.ts';

type RunnerEvent = 'ready' | 'failed';

/**
 * The runner side: dials out to the server (never the reverse, so it works
 * behind home routers), authenticates with its ed25519 key, serves engine
 * streams from its allowlisted ports, and exposes the model listener.
 *
 * The shell keeps the public surface, the constructor and the mutable runtime;
 * the connection, handshake, lifecycle and model-listener modules hold the work.
 */
export class RunnerClient {
  readonly runnerId: string;
  private readonly rt: RunnerRuntime;

  constructor(options: RunnerOptions) {
    const validated = Schema.decodeUnknownSync(RunnerOptionsSchema, {
      onExcessProperty: 'error',
    })({
      serverUrl: options.serverUrl,
      runnerId: options.runnerId,
      runnerVersion: options.runnerVersion,
      exposedPorts: options.exposedPorts,
      enableModelListener: options.enableModelListener,
      reconnectBaseMs: options.reconnectBaseMs,
      reconnectMaxMs: options.reconnectMaxMs,
      handshakeTimeoutMs: options.handshakeTimeoutMs,
      highWaterMarkBytes: options.highWaterMarkBytes,
    });
    this.runnerId = validated.runnerId;
    this.rt = createRunnerRuntime(validated, options);
  }

  /** Successful authentications since start (reconnects re-authenticate). */
  get readyCount(): number {
    return this.rt.readyCountValue;
  }

  /** Reconnect waits scheduled since start. */
  get reconnectAttempts(): number {
    return this.rt.reconnectAttemptsValue;
  }

  get connected(): boolean {
    return this.rt.mux !== null;
  }

  /** `http://127.0.0.1:<port>`: the LLM base URL desks use. Null when disabled. */
  get modelUrl(): string | null {
    const address = this.rt.modelServer?.address();
    if (typeof address === 'string' || address === null || address === undefined) {
      return null;
    }
    return `http://127.0.0.1:${address.port}`;
  }

  /** The local address the model listener is bound to (null when disabled). */
  get modelBindAddress(): string | null {
    const address = this.rt.modelServer?.address();
    if (typeof address === 'string' || address === null || address === undefined) {
      return null;
    }
    return address.address;
  }

  on(event: RunnerEvent, listener: (err?: Error) => void): () => void {
    return onRunnerEvent(this.rt, event, listener);
  }

  /** Start the model listener and connect. Resolves on the first authentication. */
  start(): Promise<void> {
    return startRunner(this.rt);
  }

  stop(): Promise<void> {
    return stopRunner(this.rt);
  }
}
