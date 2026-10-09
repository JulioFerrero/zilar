// Machines and runner pairing on the Effect `HttpApi` adapter (T-0572): the
// same methods, paths, statuses, bodies, texts, logs, audit entries and per
// route step order as the deleted Hono router (`routes.ts`), mounted under
// Hono by `apps/server/src/effect/http.ts`. Handlers keep calling the drizzle
// service; the DB rewrite is a separate lane.
//
// Two details keep the tests unchanged:
// - the owner routes run the session middleware before anything else, and the
//   public pair route runs the global then per-IP limiter before the body;
// - the per-IP limiter reads `socketAddressOf` (the socket edge stamps the
//   header); tests stamp the socket header themselves before calling the
//   handler.

import { Effect, Layer, Option, Schema } from 'effect';
import { HttpServer, HttpServerResponse, HttpRouter } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import {
  CurrentUser,
  Session,
  requestIdOf,
  sessionLayer,
  socketAddressOf,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http-core';
import { createRateLimiter } from '../rate-limit';
import { hashPairingCode, normalizePairingCode } from './codes';
import { createDbMachineRegistry, type DbMachineRegistry } from './registry';
import {
  approveMachine,
  consumePairingCode,
  createPairingCode,
  deleteMachine,
  denyMachine,
  findOwnedMachine,
  insertPendingMachine,
  listMachines,
  MachineServiceError,
  renameMachine,
  revokeMachine,
  toPublicMachine,
  verifyPairingSignature,
} from './service';

// Pairing codes are minted sparingly: 10 per hour per user.
export const PAIRING_CODE_RATE_LIMIT_MAX = 10;
export const PAIRING_CODE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// The public pair route is the brute-force target: 30 attempts per minute
// across all callers, plus 10 per minute per IP.
export const PAIR_GLOBAL_RATE_LIMIT_MAX = 30;
export const PAIR_IP_RATE_LIMIT_MAX = 10;
export const PAIR_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export interface MachinesApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  logger: MachinesLogger;
  /** Audit recorder; production wires the server's own recorder. */
  audit?: AuditRecorder;
  /** Shared with the tunnel hub so revokes close live connections. */
  registry?: DbMachineRegistry;
  /** Injected in tests so rate-limit windows can advance without waiting. */
  now?: () => number;
  /** Injected by app.ts when the runner hub is on; absent = hub off. */
  isMachineOnline?: (machineId: string) => boolean;
}

// The pino surface: the Effect envelope logs an unhandled failure through the
// same `error` method the old `onError` used.
export type MachinesLogger = Logger;

const STRICT_DECODE = { onExcessProperty: 'error' } as const;

// zod `.trim().min(1).max(64)`.
const MachineName = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64));

// Strips nothing and stays non-strict; a malformed body is handled by the
// caller with the route's own text.
const PairingCode = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64));
const PublicKey = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
const Signature = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));

// A capability report value: `z.union([string, number, boolean, string[]])`.
const ToolsValue = Schema.Union([
  Schema.String.check(Schema.isMaxLength(1024)),
  Schema.Number,
  Schema.Boolean,
  Schema.Array(Schema.String.check(Schema.isMaxLength(128))).check(Schema.isMaxLength(64)),
]);

// `Schema.Record` does not run checks on the key schema, so the key length and
// the 64-entry cap are enforced on the whole record (`toolsValueSchema`).
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

const PairBody = Schema.Struct({
  code: PairingCode,
  publicKey: PublicKey,
  signature: Signature,
  name: MachineName,
  capabilities: Capabilities,
});

const RenameBody = Schema.Struct({ name: MachineName });

const MachineIdParams = Schema.Struct({ id: Schema.String });

// Every field of `PublicMachine` (`service.ts`), compared side by side: id,
// name, status, os, osVersion, arch, cpu, cores, ramGb, diskFreeGb, drivers,
// fingerprint, online, createdAt, approvedAt, lastSeenAt. Dates encode to the
// ISO strings JSON.stringify produced on the Hono route.
const PublicMachineView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.Literals(['pending', 'approved', 'revoked']),
  os: Schema.String,
  osVersion: Schema.String,
  arch: Schema.String,
  cpu: Schema.String,
  cores: Schema.Number,
  ramGb: Schema.Number,
  diskFreeGb: Schema.Number,
  drivers: Schema.Array(Schema.String),
  fingerprint: Schema.String,
  online: Schema.Boolean,
  createdAt: Schema.Date,
  approvedAt: Schema.NullOr(Schema.Date),
  lastSeenAt: Schema.NullOr(Schema.Date),
});

const CreatedPairingCode = Schema.Struct({ code: Schema.String, expiresAt: Schema.String });

const PairResult = Schema.Struct({
  machineId: Schema.String,
  status: Schema.Literals(['pending']),
});

const MachinesGroup = HttpApiGroup.make('machines')
  .add(
    HttpApiEndpoint.post('createPairingCode', '/machines/pairing-codes', {
      success: CreatedPairingCode,
    }).middleware(Session),
    HttpApiEndpoint.get('list', '/machines', {
      success: Schema.Array(PublicMachineView),
    }).middleware(Session),
    HttpApiEndpoint.post('approve', '/machines/:id/approve', {
      params: MachineIdParams,
      success: PublicMachineView,
    }).middleware(Session),
    HttpApiEndpoint.post('deny', '/machines/:id/deny', {
      params: MachineIdParams,
      success: Schema.Void,
    }).middleware(Session),
    HttpApiEndpoint.post('revoke', '/machines/:id/revoke', {
      params: MachineIdParams,
      success: PublicMachineView,
    }).middleware(Session),
    HttpApiEndpoint.patch('rename', '/machines/:id', {
      params: MachineIdParams,
      success: PublicMachineView,
    }).middleware(Session),
    HttpApiEndpoint.delete('remove', '/machines/:id', {
      params: MachineIdParams,
      success: Schema.Void,
    }).middleware(Session),
    // Public: the pairing code plus signature are the credential.
    HttpApiEndpoint.post('pair', '/runner/pair', { success: PairResult }),
  )
  // The adapter forwards `c.req.raw` unchanged, so paths keep Hono's `/api`.
  .prefix('/api');

const MachinesApi = HttpApi.make('machines').add(MachinesGroup);

export const MACHINES_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'POST', path: '/api/machines/pairing-codes' },
  { method: 'GET', path: '/api/machines' },
  { method: 'POST', path: '/api/machines/:id/approve' },
  { method: 'POST', path: '/api/machines/:id/deny' },
  { method: 'POST', path: '/api/machines/:id/revoke' },
  { method: 'PATCH', path: '/api/machines/:id' },
  { method: 'DELETE', path: '/api/machines/:id' },
  { method: 'POST', path: '/api/runner/pair' },
];

function invalidCode(): HttpError {
  return new HttpError(400, 'invalid_code', 'Invalid or expired pairing code');
}

function toConflict(error: unknown): unknown {
  if (error instanceof MachineServiceError) {
    return new HttpError(409, error.errorCode, error.message);
  }
  throw error;
}

// Used to tell a malformed JSON body from a shape violation after the sentinel
// has been replaced by the decoded value.
const INVALID_JSON = Symbol('invalid-json');

export function createMachinesApi(deps: MachinesApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const audit = deps.audit;
  const isMachineOnline = deps.isMachineOnline;
  const machineRegistry = deps.registry ?? createDbMachineRegistry(deps.db);

  const createCodeLimiter = createRateLimiter({
    max: PAIRING_CODE_RATE_LIMIT_MAX,
    windowMs: PAIRING_CODE_RATE_LIMIT_WINDOW_MS,
    now,
  });
  const pairGlobalLimiter = createRateLimiter({
    max: PAIR_GLOBAL_RATE_LIMIT_MAX,
    windowMs: PAIR_RATE_LIMIT_WINDOW_MS,
    now,
  });
  const pairIpLimiter = createRateLimiter({
    max: PAIR_IP_RATE_LIMIT_MAX,
    windowMs: PAIR_RATE_LIMIT_WINDOW_MS,
    now,
  });

  // `audit.record` stays awaited: a write failure rejects the route just like
  // the old `await`.
  function recordAudit(entry: {
    actorUserId: string;
    action: string;
    subjectId: string;
  }): Effect.Effect<void, never, never> {
    if (audit === undefined) {
      return Effect.void;
    }
    return Effect.promise(() =>
      audit.record({
        actorUserId: entry.actorUserId,
        aiId: null,
        groupId: null,
        action: entry.action,
        subjectId: entry.subjectId,
        argsHash: null,
        costCurrency: null,
        costAmount: null,
        result: 'ok',
        detail: null,
      }),
    );
  }

  const groupLayer = HttpApiBuilder.group(MachinesApi, 'machines', (handlers) =>
    handlers
      .handle('createPairingCode', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            if (!createCodeLimiter.allow(user.id)) {
              throw new HttpError(429, 'rate_limited', 'Too many pairing codes, try again later');
            }
            const outcome = yield* Effect.promise(() =>
              createPairingCode(deps.db, user.id, new Date(now())),
            ).pipe(
              Effect.map((value) => ({ ok: true as const, value })),
              Effect.catchDefect((defect) => Effect.succeed({ ok: false as const, defect })),
            );
            if (!outcome.ok) {
              throw toConflict(outcome.defect);
            }
            return HttpServerResponse.jsonUnsafe(
              { code: outcome.value.code, expiresAt: outcome.value.expiresAt.toISOString() },
              { status: 201 },
            );
          }),
          logger,
          requestId,
        );
      })
      .handle('list', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const rows = yield* Effect.promise(() => listMachines(deps.db, user.id));
            return rows.map((row) => toPublicMachine(row, isMachineOnline));
          }),
          logger,
          requestId,
        );
      })
      .handle('approve', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const id = request.params.id;
            const existing = yield* Effect.promise(() => findOwnedMachine(deps.db, id, user.id));
            if (!existing) {
              throw new HttpError(404, 'not_found', 'Machine not found');
            }
            if (existing.status !== 'pending') {
              throw new HttpError(
                409,
                'invalid_transition',
                'Only pending machines can be approved',
              );
            }
            const approved = yield* Effect.promise(() =>
              approveMachine(deps.db, id, user.id, new Date(now())),
            );
            if (!approved) {
              throw new HttpError(
                409,
                'invalid_transition',
                'Only pending machines can be approved',
              );
            }
            machineRegistry.notifyApproved(id, approved.publicKey);
            logger.info({ machineId: id }, 'machine approved');
            yield* recordAudit({ actorUserId: user.id, action: 'machine.approved', subjectId: id });
            return toPublicMachine(approved);
          }),
          logger,
          requestId,
        );
      })
      .handle('deny', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const id = request.params.id;
            const existing = yield* Effect.promise(() => findOwnedMachine(deps.db, id, user.id));
            if (!existing) {
              throw new HttpError(404, 'not_found', 'Machine not found');
            }
            if (existing.status !== 'pending') {
              throw new HttpError(409, 'invalid_transition', 'Only pending machines can be denied');
            }
            const denied = yield* Effect.promise(() => denyMachine(deps.db, id, user.id));
            if (!denied) {
              throw new HttpError(409, 'invalid_transition', 'Only pending machines can be denied');
            }
            logger.info({ machineId: id }, 'machine denied');
            yield* recordAudit({ actorUserId: user.id, action: 'machine.denied', subjectId: id });
            return HttpServerResponse.empty({ status: 204 });
          }),
          logger,
          requestId,
        );
      })
      .handle('revoke', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const id = request.params.id;
            const existing = yield* Effect.promise(() => findOwnedMachine(deps.db, id, user.id));
            if (!existing) {
              throw new HttpError(404, 'not_found', 'Machine not found');
            }
            if (existing.status === 'revoked') {
              throw new HttpError(409, 'invalid_transition', 'Machine is already revoked');
            }
            const revoked = yield* Effect.promise(() =>
              revokeMachine(deps.db, id, user.id, new Date(now())),
            );
            if (!revoked) {
              throw new HttpError(409, 'invalid_transition', 'Machine is already revoked');
            }
            machineRegistry.notifyRevoked(id);
            logger.info({ machineId: id }, 'machine revoked');
            yield* recordAudit({ actorUserId: user.id, action: 'machine.revoked', subjectId: id });
            return toPublicMachine(revoked);
          }),
          logger,
          requestId,
        );
      })
      .handle('rename', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const id = request.params.id;
            const raw = yield* request.request.json.pipe(
              Effect.catchCause(() => Effect.succeed<unknown>(INVALID_JSON)),
            );
            if (raw === INVALID_JSON) {
              throw new HttpError(400, 'invalid_request', 'Invalid JSON body');
            }
            const parsed = Schema.decodeUnknownOption(RenameBody, STRICT_DECODE)(raw);
            if (Option.isNone(parsed)) {
              throw new HttpError(400, 'invalid_request', 'Invalid machine update');
            }
            const existing = yield* Effect.promise(() => findOwnedMachine(deps.db, id, user.id));
            if (!existing) {
              throw new HttpError(404, 'not_found', 'Machine not found');
            }
            const renamed = yield* Effect.promise(() =>
              renameMachine(deps.db, id, user.id, parsed.value.name),
            );
            if (!renamed) {
              throw new HttpError(404, 'not_found', 'Machine not found');
            }
            return toPublicMachine(renamed);
          }),
          logger,
          requestId,
        );
      })
      .handle('remove', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const id = request.params.id;
            const existing = yield* Effect.promise(() => findOwnedMachine(deps.db, id, user.id));
            if (!existing) {
              throw new HttpError(404, 'not_found', 'Machine not found');
            }
            if (existing.status === 'approved') {
              throw new HttpError(409, 'revoke_first', 'Revoke the machine before deleting it');
            }
            const deleted = yield* Effect.promise(() => deleteMachine(deps.db, id, user.id));
            if (!deleted) {
              throw new HttpError(409, 'invalid_transition', 'Machine can no longer be deleted');
            }
            logger.info({ machineId: id }, 'machine deleted');
            yield* recordAudit({ actorUserId: user.id, action: 'machine.deleted', subjectId: id });
            return HttpServerResponse.empty({ status: 204 });
          }),
          logger,
          requestId,
        );
      })
      .handle('pair', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            if (!pairGlobalLimiter.allow('runner-pair')) {
              throw new HttpError(
                429,
                'rate_limited',
                'Too many pairing attempts, try again in a minute',
              );
            }
            if (!pairIpLimiter.allow(socketAddressOf(request.request))) {
              throw new HttpError(
                429,
                'rate_limited',
                'Too many pairing attempts, try again in a minute',
              );
            }
            const raw = yield* request.request.json.pipe(
              Effect.catchCause(() => Effect.succeed<unknown>(undefined)),
            );
            const parsed = Schema.decodeUnknownOption(PairBody, STRICT_DECODE)(raw);
            const normalized = Option.isSome(parsed)
              ? normalizePairingCode(parsed.value.code)
              : null;
            // The code-consume and the signature check run together and the
            // route branches once afterwards, so the timing does not reveal
            // which one failed. Every failure below answers the identical 400
            // invalid_code. The `Promise.all` shape is kept on purpose.
            const [consumed, signatureOk] = yield* Effect.promise(() =>
              Promise.all([
                normalized === null
                  ? Promise.resolve(null)
                  : consumePairingCode(deps.db, hashPairingCode(normalized), new Date(now())),
                Promise.resolve(
                  Option.isSome(parsed) && normalized !== null
                    ? verifyPairingSignature(
                        parsed.value.publicKey,
                        parsed.value.signature,
                        normalized,
                      )
                    : false,
                ),
              ]),
            );
            if (consumed === null || !signatureOk || Option.isNone(parsed) || normalized === null) {
              throw invalidCode();
            }
            const body = parsed.value;
            const outcome = yield* Effect.promise(() =>
              insertPendingMachine(deps.db, {
                ownerUserId: consumed.ownerUserId,
                name: body.name,
                publicKey: body.publicKey,
                capabilities: body.capabilities,
              }),
            ).pipe(
              Effect.map((value) => ({ ok: true as const, value })),
              Effect.catchDefect((defect) => Effect.succeed({ ok: false as const, defect })),
            );
            if (!outcome.ok) {
              throw toConflict(outcome.defect);
            }
            const machine = outcome.value;
            logger.info({ machineId: machine.id }, 'runner paired');
            yield* recordAudit({
              actorUserId: consumed.ownerUserId,
              action: 'machine.paired',
              subjectId: machine.id,
            });
            return HttpServerResponse.jsonUnsafe(
              { machineId: machine.id, status: 'pending' },
              { status: 201 },
            );
          }),
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(MachinesApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
  );

  // Hono keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: MACHINES_API_ROUTES };
}
