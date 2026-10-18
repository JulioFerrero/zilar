/** One live stream's remote endpoint, implemented by the socket bridge; the mux only
 * routes bytes and lifecycle. */
export interface StreamSink {
  /** Remote bytes arrived. Return false when full: the mux then asks the sender to pause. */
  onData(chunk: Buffer): boolean;
  onEnded(): void;
  onFailed(err: Error): void;
  /** The stream died: refused, reset, or the whole tunnel went away. */
  onSendResumed(): void;
}

export interface StreamMuxOptions {
  /** Bytes the WebSocket may buffer before senders pause their source. Default 1 MiB. */
  highWaterMarkBytes?: number;
}
