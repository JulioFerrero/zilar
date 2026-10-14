import { Schema } from 'effect';
import { ToolNameSchema } from './protocol';

/**
 * The hands interface (plan §2): the four operations the brain calls on a desk.
 * It is implemented once for Zilar cloud (the `src/agent` sidecar) and once per
 * runner; both speak the same tool daemon, so `execute` has one shape
 * everywhere.
 *
 * The plain interfaces are the plan's shapes and the schemas are the boundary
 * validators. The sidecar's unix socket decodes every request against these
 * schemas with `onExcessProperty: 'error'`, so a caller can only ever send the
 * fields declared here — never a host path, an image name or a runtime flag.
 *
 * The fixed error codes live in `protocol.ts` (`ToolErrorCode`, `DeskError`) and
 * are re-exported with the package.
 */

/** The plan's per-jail ceilings, enforced at the schema boundary (§2, §4.2). */
export const MAX_MEMORY_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_PIDS = 256;
export const MAX_DISK_BYTES = 5 * 1024 * 1024 * 1024;
export const MAX_COMMAND_TIMEOUT_MS = 600_000;

/** Ids are path segments; the pattern makes a path escape impossible. */
const idSchema = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/));

function intBetween(min: number, max: number) {
  return Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(min),
    Schema.isLessThanOrEqualTo(max),
  );
}

export const DeskKeySchema = Schema.Struct({
  aiId: idSchema,
  projectId: idSchema,
});

export type DeskKey = typeof DeskKeySchema.Type;

export const DeskLimitsSchema = Schema.Struct({
  memoryBytes: intBetween(1, MAX_MEMORY_BYTES),
  pids: intBetween(1, MAX_PIDS),
  cpuShares: intBetween(1, Number.MAX_SAFE_INTEGER),
  diskBytes: intBetween(1, MAX_DISK_BYTES),
  commandTimeoutMs: intBetween(1, MAX_COMMAND_TIMEOUT_MS),
  taskWallClockMs: intBetween(1, Number.MAX_SAFE_INTEGER),
});

export type DeskLimits = typeof DeskLimitsSchema.Type;

export const DeskEgressPolicySchema = Schema.Struct({
  allowedHosts: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
  git: Schema.optional(
    Schema.Struct({
      host: Schema.String.check(Schema.isMinLength(1)),
      ownerRepo: Schema.String.check(Schema.isMinLength(1)),
    }),
  ),
});

export type DeskEgressPolicy = typeof DeskEgressPolicySchema.Type;

export const DeskSpecSchema = Schema.Struct({
  key: DeskKeySchema,
  ownerUserId: Schema.String.check(Schema.isMinLength(1)),
  /** The pinned base image; the sidecar refuses any digest but the configured one. */
  imageDigest: Schema.String.check(Schema.isMinLength(1)),
  limits: DeskLimitsSchema,
  egress: Schema.optional(DeskEgressPolicySchema),
});

export type DeskSpec = typeof DeskSpecSchema.Type;

export const DeskRefSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  key: DeskKeySchema,
});

export type DeskRef = typeof DeskRefSchema.Type;

export const DeskToolCallSchema = Schema.Struct({
  tool: ToolNameSchema,
  /** Validated by the daemon against the tool's own schema, never here. */
  args: Schema.Unknown,
  timeoutMs: Schema.optional(intBetween(1, MAX_COMMAND_TIMEOUT_MS)),
});

export type DeskToolCall = typeof DeskToolCallSchema.Type;

export const DeskChunkSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('stdout'), data: Schema.String }),
  Schema.Struct({ type: Schema.Literal('stderr'), data: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('exit'),
    code: Schema.Number.check(Schema.isInt()),
    truncated: Schema.Boolean,
  }),
]);

export type DeskChunk = typeof DeskChunkSchema.Type;

export const SnapshotRefSchema = Schema.Struct({
  deskId: Schema.String.check(Schema.isMinLength(1)),
  label: idSchema,
  bytes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});

export type SnapshotRef = typeof SnapshotRefSchema.Type;

export interface Hands {
  /** Idempotent per `DeskKey`: a second call returns the live desk, never a second jail. */
  provision(spec: DeskSpec): Promise<DeskRef>;
  /** Runs one tool; yields stdout/stderr chunks and a final exit chunk. */
  execute(ref: DeskRef, call: DeskToolCall, signal?: AbortSignal): AsyncIterable<DeskChunk>;
  /** Kills the jail. The workspace image survives unless `keepWorkspace` is false. */
  stop(ref: DeskRef, opts?: { readonly keepWorkspace?: boolean }): Promise<void>;
  snapshot(ref: DeskRef, label: string): Promise<SnapshotRef>;
}

/**
 * Thrown by an adapter when the host is over its running cap or memory pool, so
 * the caller can show "Queued (n ahead)" and retry (plan §2, §4.3). It is never
 * a hard failure: `position` is how many desks are ahead.
 */
export class DeskQueued extends Error {
  readonly position: number;

  constructor(position: number) {
    super(`queued, ${position} ahead`);
    this.name = 'DeskQueued';
    this.position = position;
  }
}
