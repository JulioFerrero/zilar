import { Exit, Schema } from 'effect';

/** The only protocol version this spike speaks. */
export const PROTOCOL_VERSION = 1;

/** WebSocket close codes (4000-4999 are application-defined). */
export const CLOSE_MALFORMED = 4400;
export const CLOSE_UNKNOWN_TYPE = 4401;
export const CLOSE_VERSION = 4402;
export const CLOSE_AUTH = 4403;
export const CLOSE_REVOKED = 4404;

/** Binary frame kinds. Every binary frame starts with a 5-byte header. */
export const FRAME_DATA = 0;
export const FRAME_FIN = 1;
export const FRAME_RESET = 2;

export const FRAME_HEADER_BYTES = 5;

/** Largest single binary payload we put on the wire; bigger writes are chunked. */
export const MAX_FRAME_BYTES = 256 * 1024;

/**
 * Largest WebSocket message either side accepts. Control frames are small JSON
 * and stream frames are capped at MAX_FRAME_BYTES plus the header, so anything
 * bigger is an attack or a bug, not traffic.
 */
export const MAX_WS_PAYLOAD_BYTES = MAX_FRAME_BYTES + FRAME_HEADER_BYTES;

/** Receive window per stream: beyond this the receiver asks the sender to pause. */
export const STREAM_WINDOW_BYTES = 256 * 1024;

const boundedString = (min: number, max: number): Schema.String =>
  Schema.String.check(Schema.isMinLength(min), Schema.isMaxLength(max));

const nonNegativeInt: Schema.Number = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
);

const runnerIdSchema = boundedString(1, 128);
const streamIdSchema: Schema.Number = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(0xff_ff_ff_ff),
);
const portSchema: Schema.Number = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(65535),
);

export const HelloSchema = Schema.Struct({
  type: Schema.Literal('hello'),
  runner_id: runnerIdSchema,
  runner_version: boundedString(1, 64),
  protocol_version: nonNegativeInt,
});

export const ChallengeSchema = Schema.Struct({
  type: Schema.Literal('challenge'),
  nonce: boundedString(1, 128),
});

export const AuthSchema = Schema.Struct({
  type: Schema.Literal('auth'),
  signature: boundedString(1, 256),
});

export const ReadySchema = Schema.Struct({
  type: Schema.Literal('ready'),
});

export const HeartbeatSchema = Schema.Struct({
  type: Schema.Literal('heartbeat'),
  at: nonNegativeInt,
});

export const TunnelOpenSchema = Schema.Struct({
  type: Schema.Literal('tunnel.open'),
  stream_id: streamIdSchema,
  port: portSchema,
});

export const TunnelRefusedSchema = Schema.Struct({
  type: Schema.Literal('tunnel.refused'),
  stream_id: streamIdSchema,
  reason: boundedString(1, 256),
});

export const TunnelClosedSchema = Schema.Struct({
  type: Schema.Literal('tunnel.closed'),
  stream_id: streamIdSchema,
  reason: boundedString(1, 256),
});

export const TunnelPauseSchema = Schema.Struct({
  type: Schema.Literal('tunnel.pause'),
  stream_id: streamIdSchema,
});

export const TunnelResumeSchema = Schema.Struct({
  type: Schema.Literal('tunnel.resume'),
  stream_id: streamIdSchema,
});

export const ModelOpenSchema = Schema.Struct({
  type: Schema.Literal('model.open'),
  stream_id: streamIdSchema,
});

const runnerToServerSchemas = {
  hello: HelloSchema,
  auth: AuthSchema,
  heartbeat: HeartbeatSchema,
  'model.open': ModelOpenSchema,
  'tunnel.refused': TunnelRefusedSchema,
  'tunnel.closed': TunnelClosedSchema,
  'tunnel.pause': TunnelPauseSchema,
  'tunnel.resume': TunnelResumeSchema,
} as const;

const serverToRunnerSchemas = {
  challenge: ChallengeSchema,
  ready: ReadySchema,
  'tunnel.open': TunnelOpenSchema,
  'tunnel.closed': TunnelClosedSchema,
  'tunnel.pause': TunnelPauseSchema,
  'tunnel.resume': TunnelResumeSchema,
} as const;

export type ControlMessage =
  | typeof HelloSchema.Type
  | typeof ChallengeSchema.Type
  | typeof AuthSchema.Type
  | typeof ReadySchema.Type
  | typeof HeartbeatSchema.Type
  | typeof TunnelOpenSchema.Type
  | typeof TunnelRefusedSchema.Type
  | typeof TunnelClosedSchema.Type
  | typeof TunnelPauseSchema.Type
  | typeof TunnelResumeSchema.Type
  | typeof ModelOpenSchema.Type;

type ControlSchema =
  | typeof HelloSchema
  | typeof ChallengeSchema
  | typeof AuthSchema
  | typeof ReadySchema
  | typeof HeartbeatSchema
  | typeof TunnelOpenSchema
  | typeof TunnelRefusedSchema
  | typeof TunnelClosedSchema
  | typeof TunnelPauseSchema
  | typeof TunnelResumeSchema
  | typeof ModelOpenSchema;

export type MessageDirection = 'runner-to-server' | 'server-to-runner';

export interface ControlParseOk {
  ok: true;
  message: ControlMessage;
}

export interface ControlParseFail {
  ok: false;
  code: number;
  reason: string;
}

/**
 * Validate one text frame. Never throws: any garbage becomes a close code,
 * so a handler can close the socket cleanly instead of crashing.
 */
export function parseControlMessage(
  raw: string,
  direction: MessageDirection,
): ControlParseOk | ControlParseFail {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: CLOSE_MALFORMED, reason: 'frame is not JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, code: CLOSE_MALFORMED, reason: 'frame is not an object' };
  }
  const typeValue = (parsed as { type?: unknown }).type;
  if (typeof typeValue !== 'string') {
    return { ok: false, code: CLOSE_MALFORMED, reason: 'frame has no string type' };
  }
  const schemas = direction === 'runner-to-server' ? runnerToServerSchemas : serverToRunnerSchemas;
  const schema = (schemas as Record<string, ControlSchema | undefined>)[typeValue];
  if (schema === undefined) {
    return { ok: false, code: CLOSE_UNKNOWN_TYPE, reason: `unknown message type ${typeValue}` };
  }
  const result = Schema.decodeUnknownExit(schema, { onExcessProperty: 'error' })(parsed);
  if (!Exit.isSuccess(result)) {
    return { ok: false, code: CLOSE_MALFORMED, reason: `invalid ${typeValue} frame` };
  }
  return { ok: true, message: result.value as ControlMessage };
}

export interface BinaryFrame {
  streamId: number;
  kind: number;
  payload: Buffer;
}

/** Decode one binary frame. Returns null when the frame is shorter than the header. */
export function decodeBinaryFrame(data: Buffer): BinaryFrame | null {
  if (data.length < FRAME_HEADER_BYTES) {
    return null;
  }
  return {
    streamId: data.readUInt32BE(0),
    kind: data[4] ?? 0,
    payload: data.subarray(FRAME_HEADER_BYTES),
  };
}

/** Encode one binary frame. The payload is copied by the caller contract (subarray is fine). */
export function encodeBinaryFrame(streamId: number, kind: number, payload: Buffer): Buffer {
  const out = Buffer.allocUnsafe(FRAME_HEADER_BYTES + payload.length);
  out.writeUInt32BE(streamId, 0);
  out[4] = kind;
  payload.copy(out, FRAME_HEADER_BYTES);
  return out;
}
