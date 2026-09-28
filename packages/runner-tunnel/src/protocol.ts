import { z } from 'zod';

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

/** Receive window per stream: beyond this the receiver asks the sender to pause. */
export const STREAM_WINDOW_BYTES = 256 * 1024;

const runnerIdSchema = z.string().min(1).max(128);
const streamIdSchema = z.number().int().min(0).max(0xff_ff_ff_ff);
const portSchema = z.number().int().min(1).max(65535);

export const HelloSchema = z.strictObject({
  type: z.literal('hello'),
  runner_id: runnerIdSchema,
  runner_version: z.string().min(1).max(64),
  protocol_version: z.number().int().min(0),
});

export const ChallengeSchema = z.strictObject({
  type: z.literal('challenge'),
  nonce: z.string().min(1).max(128),
});

export const AuthSchema = z.strictObject({
  type: z.literal('auth'),
  signature: z.string().min(1).max(256),
});

export const ReadySchema = z.strictObject({
  type: z.literal('ready'),
});

export const HeartbeatSchema = z.strictObject({
  type: z.literal('heartbeat'),
  at: z.number().int().min(0),
});

export const TunnelOpenSchema = z.strictObject({
  type: z.literal('tunnel.open'),
  stream_id: streamIdSchema,
  port: portSchema,
});

export const TunnelRefusedSchema = z.strictObject({
  type: z.literal('tunnel.refused'),
  stream_id: streamIdSchema,
  reason: z.string().min(1).max(256),
});

export const TunnelClosedSchema = z.strictObject({
  type: z.literal('tunnel.closed'),
  stream_id: streamIdSchema,
  reason: z.string().min(1).max(256),
});

export const TunnelPauseSchema = z.strictObject({
  type: z.literal('tunnel.pause'),
  stream_id: streamIdSchema,
});

export const TunnelResumeSchema = z.strictObject({
  type: z.literal('tunnel.resume'),
  stream_id: streamIdSchema,
});

export const ModelOpenSchema = z.strictObject({
  type: z.literal('model.open'),
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

export type RunnerToServerType = keyof typeof runnerToServerSchemas;
export type ServerToRunnerType = keyof typeof serverToRunnerSchemas;

export type ControlMessage =
  | z.infer<typeof HelloSchema>
  | z.infer<typeof ChallengeSchema>
  | z.infer<typeof AuthSchema>
  | z.infer<typeof ReadySchema>
  | z.infer<typeof HeartbeatSchema>
  | z.infer<typeof TunnelOpenSchema>
  | z.infer<typeof TunnelRefusedSchema>
  | z.infer<typeof TunnelClosedSchema>
  | z.infer<typeof TunnelPauseSchema>
  | z.infer<typeof TunnelResumeSchema>
  | z.infer<typeof ModelOpenSchema>;

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
  const schema = (schemas as Record<string, z.ZodType | undefined>)[typeValue];
  if (schema === undefined) {
    return { ok: false, code: CLOSE_UNKNOWN_TYPE, reason: `unknown message type ${typeValue}` };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, code: CLOSE_MALFORMED, reason: `invalid ${typeValue} frame` };
  }
  return { ok: true, message: result.data as ControlMessage };
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
