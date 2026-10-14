export {
  CLOSE_AUTH,
  CLOSE_MALFORMED,
  CLOSE_REVOKED,
  CLOSE_UNKNOWN_TYPE,
  CLOSE_VERSION,
  FRAME_DATA,
  FRAME_FIN,
  FRAME_HEADER_BYTES,
  MAX_FRAME_BYTES,
  MAX_WS_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  STREAM_WINDOW_BYTES,
  decodeBinaryFrame,
  encodeBinaryFrame,
  isAcceptedProtocolVersion,
  parseControlMessage,
  type BinaryFrame,
  type ControlMessage,
  type ControlParseFail,
  type ControlParseOk,
  type MessageDirection,
} from './protocol.ts';
export {
  DeskErrorCodeSchema,
  DeskRequestError,
  type DeskErrorCode,
  type DeskErrorFrame,
  type DeskEgressFrame,
  type DeskExecFrame,
  type DeskLimitsFrame,
  type DeskProvisionFrame,
  type DeskQueuedFrame,
  type DeskReadyFrame,
  type DeskReplyFrame,
  type DeskRequestFrame,
  type DeskStoppedFrame,
  type DeskStopFrame,
} from './desk-frames.ts';
export {
  DeskRunner,
  type DeskProvisionOutcome,
  type DeskRunnerFrame,
  type DeskRunnerHandler,
  type DeskStopOutcome,
} from './desk-runner.ts';
export { DeskServer, DEFAULT_DESK_REPLY_TIMEOUT_MS } from './desk-server.ts';
export {
  InMemoryKeyRegistry,
  generateRunnerKeypair,
  randomNonce,
  signNonce,
  verifyNonce,
  type KeyRegistry,
  type RunnerKeypair,
} from './keys.ts';
export {
  StreamMux,
  TunnelClosedError,
  attachSocketToStream,
  type StreamMuxOptions,
  type StreamSink,
} from './mux.ts';
export { TunnelServer, type TunnelServerOptions } from './server.ts';
export { RunnerClient, computeBackoff, type RunnerOptions } from './runner.ts';
export { TunnelHttpAgent, createLoopbackPair, type TunnelDialer } from './http-agent.ts';
