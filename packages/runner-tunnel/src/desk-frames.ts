import { Schema } from 'effect';

/**
 * The `desk.*` control frames (plan §2, §6.1) that carry the four hands
 * operations over the tunnel. They are snake_cased like the rest of the
 * protocol and validated with the same bounded schemas; `desk.snapshot` is a
 * later task and is deliberately absent.
 */

/** The plan's fixed error taxonomy; never raw host text (plan §2). */
export const DeskErrorCodeSchema = Schema.Literals([
  'not_provisioned',
  'queue_full',
  'jail_unavailable',
  'timeout',
  'output_too_large',
  'path_escape',
  'host_blocked',
  'tool_failed',
]);

export type DeskErrorCode = typeof DeskErrorCodeSchema.Type;

/** The per-jail ceilings a server may ask for (plan §4.2). */
export const MAX_MEMORY_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_PIDS = 256;
export const MAX_DISK_BYTES = 5 * 1024 * 1024 * 1024;
export const MAX_CPU_SHARES = 1_000_000;
export const MAX_COMMAND_TIMEOUT_MS = 600_000;
export const MAX_TASK_WALL_CLOCK_MS = 24 * 60 * 60 * 1000;

const boundedString = (min: number, max: number): Schema.String =>
  Schema.String.check(Schema.isMinLength(min), Schema.isMaxLength(max));

const deskIdSchema = boundedString(1, 128);
const idSchema = boundedString(1, 64);
const digestSchema = boundedString(1, 256).check(
  Schema.isPattern(/^[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}$/),
);
const hostSchema = boundedString(1, 253);
const streamIdSchema: Schema.Number = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(0xff_ff_ff_ff),
);

function intBetween(min: number, max: number) {
  return Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(min),
    Schema.isLessThanOrEqualTo(max),
  );
}

export const DeskLimitsFrameSchema = Schema.Struct({
  memory_bytes: intBetween(1, MAX_MEMORY_BYTES),
  pids: intBetween(1, MAX_PIDS),
  cpu_shares: intBetween(1, MAX_CPU_SHARES),
  disk_bytes: intBetween(1, MAX_DISK_BYTES),
  command_timeout_ms: intBetween(1, MAX_COMMAND_TIMEOUT_MS),
  task_wall_clock_ms: intBetween(1, MAX_TASK_WALL_CLOCK_MS),
});

export type DeskLimitsFrame = typeof DeskLimitsFrameSchema.Type;

export const DeskEgressFrameSchema = Schema.Struct({
  allowed_hosts: Schema.optional(Schema.Array(hostSchema).check(Schema.isMaxLength(256))),
  git: Schema.optional(
    Schema.Struct({
      host: hostSchema,
      owner_repo: boundedString(1, 256),
    }),
  ),
});

export type DeskEgressFrame = typeof DeskEgressFrameSchema.Type;

export const DeskProvisionSchema = Schema.Struct({
  type: Schema.Literal('desk.provision'),
  desk_id: deskIdSchema,
  ai_id: idSchema,
  project_id: idSchema,
  image_digest: digestSchema,
  limits: DeskLimitsFrameSchema,
  egress: Schema.optional(DeskEgressFrameSchema),
});

export const DeskExecSchema = Schema.Struct({
  type: Schema.Literal('desk.exec'),
  desk_id: deskIdSchema,
  stream_id: streamIdSchema,
});

export const DeskStopSchema = Schema.Struct({
  type: Schema.Literal('desk.stop'),
  desk_id: deskIdSchema,
  keep_workspace: Schema.Boolean,
});

export const DeskReadySchema = Schema.Struct({
  type: Schema.Literal('desk.ready'),
  desk_id: deskIdSchema,
});

export const DeskStoppedSchema = Schema.Struct({
  type: Schema.Literal('desk.stopped'),
  desk_id: deskIdSchema,
});

export const DeskErrorSchema = Schema.Struct({
  type: Schema.Literal('desk.error'),
  desk_id: deskIdSchema,
  code: DeskErrorCodeSchema,
  message: boundedString(1, 512),
});

export const DeskQueuedSchema = Schema.Struct({
  type: Schema.Literal('queued'),
  desk_id: deskIdSchema,
  position: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});

export type DeskProvisionFrame = typeof DeskProvisionSchema.Type;
export type DeskExecFrame = typeof DeskExecSchema.Type;
export type DeskStopFrame = typeof DeskStopSchema.Type;
export type DeskReadyFrame = typeof DeskReadySchema.Type;
export type DeskStoppedFrame = typeof DeskStoppedSchema.Type;
export type DeskErrorFrame = typeof DeskErrorSchema.Type;
export type DeskQueuedFrame = typeof DeskQueuedSchema.Type;

/** A server→runner desk frame that expects a reply frame. */
export type DeskRequestFrame = DeskProvisionFrame | DeskStopFrame;

/** A runner→server reply to a `sendDesk` request. */
export type DeskReplyFrame = DeskReadyFrame | DeskStoppedFrame | DeskErrorFrame | DeskQueuedFrame;

/** A desk transport failure (bad state, a timeout) with a taxonomy code. */
export class DeskRequestError extends Error {
  readonly code: DeskErrorCode;

  constructor(code: DeskErrorCode, message: string) {
    super(message);
    this.name = 'DeskRequestError';
    this.code = code;
  }
}
