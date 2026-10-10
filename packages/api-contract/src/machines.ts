// Machines and runner pairing (T-0070, T-0572, T-0895): the owner pairs a
// runner with a one-time code, approves it, and can rename, revoke or delete
// it. Every field of the public machine is a wire value; the dates are ISO
// strings.
//
// `rename` and `pair` declare their payloads so the derived client is typed and
// encodes them, but the server serves both with `handleRaw` and reads the
// bodies by hand, so each keeps its own 400 texts (and `pair` answers every
// failure with the same `invalid_code`).

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { lenientLiterals } from './lenient';
import { MachinesPairingCodeRateLimit, Session } from './middleware';

export const MACHINE_STATUSES = ['pending', 'approved', 'revoked'] as const;

export type MachineStatus = (typeof MACHINE_STATUSES)[number];

/**
 * A machine row as the owner sees it. An unknown `status` from a newer server
 * decodes to `pending`; `online` is optional so an older server still decodes.
 */
export const Machine = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: lenientLiterals(MACHINE_STATUSES, 'pending'),
  os: Schema.String,
  osVersion: Schema.String,
  arch: Schema.String,
  cpu: Schema.String,
  cores: Schema.Number,
  ramGb: Schema.Number,
  diskFreeGb: Schema.Number,
  drivers: Schema.Array(Schema.String),
  fingerprint: Schema.String,
  createdAt: Schema.String,
  approvedAt: Schema.NullOr(Schema.String),
  lastSeenAt: Schema.NullOr(Schema.String),
  online: Schema.optional(Schema.Boolean),
});

export type Machine = typeof Machine.Type;

/** The list is a bare array, not an envelope. */
export const MachineList = Schema.Array(Machine);

export const PairingCode = Schema.Struct({ code: Schema.String, expiresAt: Schema.String });

export type PairingCode = typeof PairingCode.Type;

export const PairResult = Schema.Struct({
  machineId: Schema.String,
  status: Schema.Literals(['pending']),
});

// The two bodies below are decoded by hand in the server handlers (strict:
// an excess key fails), so each route keeps its own 400 texts.

const MachineName = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64));

/** The rename body: a trimmed name, 1..64 characters. */
export const RenameMachinePayload = Schema.Struct({ name: MachineName });

export type RenameMachinePayload = typeof RenameMachinePayload.Type;

// A capability report value: a string, a number, a boolean or a string list.
const ToolsValue = Schema.Union([
  Schema.String.check(Schema.isMaxLength(1024)),
  Schema.Number,
  Schema.Boolean,
  Schema.Array(Schema.String.check(Schema.isMaxLength(128))).check(Schema.isMaxLength(64)),
]);

// `Schema.Record` does not run checks on the key schema, so the key length and
// the 64-entry cap are enforced on the whole record.
const Tools = Schema.Record(Schema.String, ToolsValue).check(
  Schema.makeFilter((tools) => {
    const keys = Object.keys(tools);
    if (keys.length > 64) {
      return 'tools must have at most 64 entries';
    }
    if (keys.some((key) => key.length < 1 || key.length > 128)) {
      return 'tool keys must be 1-128 characters';
    }
    return undefined;
  }),
);

// The capability report (§11.3), snake_case as the runner sends it. Strict so a
// report with an unexpected field is rejected rather than silently stored.
const Capabilities = Schema.Struct({
  os: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  os_version: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  arch: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  cpu: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  cores: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(1024),
  ),
  ram_gb: Schema.Number.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(1000000),
  ),
  disk_free_gb: Schema.Number.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(1000000),
  ),
  power: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  drivers: Schema.Array(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64))).check(
    Schema.isMaxLength(32),
  ),
  tools: Tools,
  labels: Schema.Array(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64))).check(
    Schema.isMaxLength(32),
  ),
  runner_version: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
});

/** What the runner sends to pair: the code, its key and signature, and its report. */
export const PairMachinePayload = Schema.Struct({
  code: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  publicKey: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  signature: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  name: MachineName,
  capabilities: Capabilities,
});

export type PairMachinePayload = typeof PairMachinePayload.Type;

export const MachinesGroup = HttpApiGroup.make('machines')
  .add(
    HttpApiEndpoint.post('createPairingCode', '/machines/pairing-codes', {
      success: PairingCode.pipe(HttpApiSchema.status(201)),
    })
      // The later middleware is the outer one, so `Session` runs first.
      .middleware(MachinesPairingCodeRateLimit)
      .middleware(Session),
    HttpApiEndpoint.get('list', '/machines', {
      success: MachineList,
    }).middleware(Session),
    HttpApiEndpoint.post('approve', '/machines/:id/approve', {
      params: { id: Schema.String },
      success: Machine,
    }).middleware(Session),
    HttpApiEndpoint.post('deny', '/machines/:id/deny', {
      params: { id: Schema.String },
      success: HttpApiSchema.NoContent,
    }).middleware(Session),
    HttpApiEndpoint.post('revoke', '/machines/:id/revoke', {
      params: { id: Schema.String },
      success: Machine,
    }).middleware(Session),
    HttpApiEndpoint.patch('rename', '/machines/:id', {
      params: { id: Schema.String },
      payload: RenameMachinePayload,
      success: Machine,
    }).middleware(Session),
    HttpApiEndpoint.delete('remove', '/machines/:id', {
      params: { id: Schema.String },
      success: HttpApiSchema.NoContent,
    }).middleware(Session),
    // Public: the pairing code plus signature are the credential.
    HttpApiEndpoint.post('pair', '/runner/pair', {
      payload: PairMachinePayload,
      success: PairResult.pipe(HttpApiSchema.status(201)),
    }),
  )
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
