// Machines and runner pairing (T-0070, T-0572, T-0895): the owner pairs a
// runner with a one-time code, approves it, and can rename, revoke or delete
// it. Every field of the public machine is a wire value; the dates are ISO
// strings.
//
// `rename` and `pair` declare NO payload on purpose. The server reads their
// bodies by hand so each keeps its own 400 texts (and `pair` answers every
// failure with the same `invalid_code`); a declared payload would be decoded by
// the router first and change the error order. A client sends those two bodies
// itself and the contract only types the replies.

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { MachinesPairingCodeRateLimit } from './chain-d-middleware';
import { lenientLiterals } from './lenient';
import { Session } from './middleware';

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
      success: Machine,
    }).middleware(Session),
    HttpApiEndpoint.delete('remove', '/machines/:id', {
      params: { id: Schema.String },
      success: HttpApiSchema.NoContent,
    }).middleware(Session),
    // Public: the pairing code plus signature are the credential.
    HttpApiEndpoint.post('pair', '/runner/pair', {
      success: PairResult.pipe(HttpApiSchema.status(201)),
    }),
  )
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
