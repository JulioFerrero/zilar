import { Schema } from 'effect';
import {
  DeskRefSchema,
  DeskSpecSchema,
  DeskToolCallSchema,
  type DeskChunk,
  type DeskRef,
  type SnapshotRef,
} from '../hands';
import { DeskError } from '../protocol';

/**
 * The sidecar's unix-socket wire protocol: one JSON object per newline. A
 * request names a `method`; a reply carries the request's `id`. `execute`
 * streams `{ id, chunk }` lines and ends with `{ id, done: true }`. The request
 * schemas are decoded with `onExcessProperty: 'error'`, so a caller can only
 * ever send the declared fields — never a host path, an image or a run flag.
 */

const requestIdSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const labelSchema = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/));

export const AgentRequestSchema = Schema.Union([
  Schema.Struct({
    id: requestIdSchema,
    method: Schema.Literal('provision'),
    params: Schema.Struct({ spec: DeskSpecSchema }),
  }),
  Schema.Struct({
    id: requestIdSchema,
    method: Schema.Literal('execute'),
    params: Schema.Struct({ ref: DeskRefSchema, call: DeskToolCallSchema }),
  }),
  Schema.Struct({
    id: requestIdSchema,
    method: Schema.Literal('stop'),
    params: Schema.Struct({ ref: DeskRefSchema, keepWorkspace: Schema.optional(Schema.Boolean) }),
  }),
  Schema.Struct({
    id: requestIdSchema,
    method: Schema.Literal('snapshot'),
    params: Schema.Struct({ ref: DeskRefSchema, label: labelSchema }),
  }),
  Schema.Struct({ id: requestIdSchema, method: Schema.Literal('status') }),
  Schema.Struct({ id: requestIdSchema, method: Schema.Literal('stop_all') }),
]);

export type AgentRequest = typeof AgentRequestSchema.Type;

export interface ErrorInfo {
  readonly code: string;
  readonly message: string;
}

export interface ErrorReply {
  readonly id: number;
  readonly ok: false;
  readonly error: ErrorInfo;
}

export interface ReadyReply {
  readonly id: number;
  readonly ok: true;
  readonly ref: DeskRef;
}

export interface QueuedReply {
  readonly id: number;
  readonly ok: true;
  readonly queued: true;
  readonly position: number;
}

export interface OkReply {
  readonly id: number;
  readonly ok: true;
}

export interface SnapshotReply {
  readonly id: number;
  readonly ok: true;
  readonly snapshot: SnapshotRef;
}

export interface StatusReply {
  readonly id: number;
  readonly ok: true;
  readonly status: { readonly running: readonly DeskRef[]; readonly queued: number };
}

export interface ChunkReply {
  readonly id: number;
  readonly chunk: DeskChunk;
}

export interface DoneReply {
  readonly id: number;
  readonly done: true;
}

export type AgentReply =
  | ErrorReply
  | ReadyReply
  | QueuedReply
  | OkReply
  | SnapshotReply
  | StatusReply
  | ChunkReply
  | DoneReply;

/** Maps any failure to the fixed error taxonomy; never raw host text. */
export function errorInfo(error: unknown): ErrorInfo {
  if (error instanceof DeskError) {
    return { code: error.code, message: error.message };
  }
  return { code: 'tool_failed', message: 'the desk agent failed' };
}
