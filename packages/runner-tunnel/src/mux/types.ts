/**
 * One live stream's remote endpoint. Implemented by the socket bridge; the mux
 * only routes bytes and lifecycle, it never interprets them.
 */
export interface StreamSink {
  /** Remote bytes arrived. Return false when full: the mux then asks the sender to pause. */
  onData(chunk: Buffer): boolean;
  /** The remote end finished writing. */
  onEnded(): void;
  /** The stream died: refused, reset, or the whole tunnel went away. */
  onFailed(err: Error): void;
  /** The remote end asked us to resume sending after a pause. */
  onSendResumed(): void;
}

export interface StreamMuxOptions {
  /** Bytes the WebSocket may buffer before senders pause their source. Default 1 MiB. */
  highWaterMarkBytes?: number;
}
