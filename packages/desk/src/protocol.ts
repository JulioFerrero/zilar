import { Schema } from 'effect';

/**
 * The tool daemon's wire protocol (plan §2, "The daemon protocol"). One request
 * per newline on stdin, one response per newline on stdout; requests may
 * overlap by `id`. The transport (mux stream, `docker exec`, unix socket) is
 * deliberately absent here: cloud and runner speak the same lines.
 */

/** The tools the daemon serves (plan §3.2). */
export const ToolNameSchema = Schema.Literals([
  'bash',
  'read',
  'write',
  'edit',
  'grep',
  'glob',
  'git',
]);

export type ToolName = typeof ToolNameSchema.Type;

/**
 * The fixed error mini-taxonomy (plan §2, "Limits and errors"). Never raw host
 * text, so the caller can map a code to a fixed sentence.
 */
export const ToolErrorCodeSchema = Schema.Literals([
  'not_provisioned',
  'queue_full',
  'jail_unavailable',
  'timeout',
  'output_too_large',
  'path_escape',
  'host_blocked',
  'tool_failed',
]);

export type ToolErrorCode = typeof ToolErrorCodeSchema.Type;

export const StreamNameSchema = Schema.Literals(['stdout', 'stderr']);
export type StreamName = typeof StreamNameSchema.Type;

const RequestIdSchema: Schema.Number = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
);

/** `{"id":1,"tool":"bash","args":{"command":"pytest -q"}}` */
export const RequestSchema = Schema.Struct({
  id: RequestIdSchema,
  tool: ToolNameSchema,
  args: Schema.Unknown,
});

export type Request = typeof RequestSchema.Type;

/** `{"id":1,"stream":"stdout","data":"..."}` */
export const StreamResponseSchema = Schema.Struct({
  id: RequestIdSchema,
  stream: StreamNameSchema,
  data: Schema.String,
});

export type StreamResponse = typeof StreamResponseSchema.Type;

/** `{"id":1,"done":true,"exit_code":0,"truncated":false}` */
export const DoneResponseSchema = Schema.Struct({
  id: RequestIdSchema,
  done: Schema.Literal(true),
  exit_code: Schema.Number.check(Schema.isInt()),
  truncated: Schema.Boolean,
});

export type DoneResponse = typeof DoneResponseSchema.Type;

export const ErrorInfoSchema = Schema.Struct({
  code: ToolErrorCodeSchema,
  message: Schema.String,
});

export type ErrorInfo = typeof ErrorInfoSchema.Type;

/** `{"id":1,"error":{"code":"path_escape","message":"outside the workspace"}}` */
export const ErrorResponseSchema = Schema.Struct({
  id: RequestIdSchema,
  error: ErrorInfoSchema,
});

export type ErrorResponse = typeof ErrorResponseSchema.Type;

export const ResponseSchema = Schema.Union([
  StreamResponseSchema,
  DoneResponseSchema,
  ErrorResponseSchema,
]);

export type Response = typeof ResponseSchema.Type;

/** A refusal with one of the fixed codes; callers map it to a user sentence. */
export class DeskError extends Error {
  readonly code: ToolErrorCode;

  constructor(code: ToolErrorCode, message: string) {
    super(message);
    this.name = 'DeskError';
    this.code = code;
  }
}

export function streamResponse(id: number, stream: StreamName, data: string): StreamResponse {
  return { id, stream, data };
}

export function doneResponse(id: number, exitCode: number, truncated: boolean): DoneResponse {
  return { id, done: true, exit_code: exitCode, truncated };
}

export function errorResponse(id: number, code: ToolErrorCode, message: string): ErrorResponse {
  return { id, error: { code, message } };
}
