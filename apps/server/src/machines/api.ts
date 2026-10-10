// Machines and runner pairing on the Effect `HttpApi` adapter (T-0572): the
// same methods, paths, statuses, bodies, texts, logs, audit entries and per
// route step order as the deleted router (`routes.ts`), mounted by the Effect
// edge (`apps/server/src/effect/edge.ts`). Its service runs on effect/sql.
//
// Two details keep the tests unchanged:
// - the owner routes run the session middleware before anything else, and the
//   public pair route runs the global then per-IP limiter before the body;
// - the per-IP limiter reads `socketAddressOf` (the socket edge stamps the
//   header); tests stamp the socket header themselves before calling the
//   handler.

import { Effect, Layer, Option, Schema } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import {
  MachinesGroup,
  MachinesPairingCodeRateLimit,
  PairMachinePayload,
  RenameMachinePayload,
  type Machine,
} from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { rateLimitLayer } from '../effect/rate-limit-middleware';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import {
  handler,
  mountApi,
  requestIdOf,
  sessionLayer,
  socketAddressOf,
  withErrorEnvelope,
  type EffectApiMount,
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
  type PublicMachine,
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

// The group, the body schemas and the reply schemas live in the shared
// contract (`@zilar/api-contract`, `machines.ts`, T-0895). `rename` and `pair`
// declare their payloads for the derived client but are served with
// `handleRaw`: they read the body by hand (their own 400 texts, and `pair`
// answers every failure with the same `invalid_code`), so the error order
// stays.
const MachinesApi = HttpApi.make('machines').add(MachinesGroup);

// The wire form of a `PublicMachine`: the dates as the ISO strings
// `JSON.stringify` produced on the old route.
function toMachineView(machine: PublicMachine): Machine {
  return {
    ...machine,
    createdAt: machine.createdAt.toISOString(),
    approvedAt: machine.approvedAt?.toISOString() ?? null,
    lastSeenAt: machine.lastSeenAt?.toISOString() ?? null,
  };
}

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
  async function recordAudit(entry: {
    actorUserId: string;
    action: string;
    subjectId: string;
  }): Promise<void> {
    if (audit === undefined) {
      return;
    }
    await audit.record({
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
    });
  }

  // Runs a service call whose rejection may be a `MachineServiceError`, which
  // answers 409 with the service's code; anything else stays a 500.
  async function orConflict<A>(run: () => Promise<A>): Promise<A> {
    try {
      return await run();
    } catch (error) {
      throw toConflict(error);
    }
  }

  const groupLayer = HttpApiBuilder.group(MachinesApi, 'machines', (handlers) =>
    handlers
      .handle(
        'createPairingCode',
        handler(logger, async (_request, user) => {
          // The pairing-code budget is spent by `PairingCodeRateLimit`, which
          // reads this limiter through the layer below.
          const created = await orConflict(() =>
            createPairingCode(deps.db, user.id, new Date(now())),
          );
          return { code: created.code, expiresAt: created.expiresAt.toISOString() };
        }),
      )
      .handle(
        'list',
        handler(logger, async (_request, user) => {
          const rows = await listMachines(deps.db, user.id);
          return rows.map((row) => toMachineView(toPublicMachine(row, isMachineOnline)));
        }),
      )
      .handle(
        'approve',
        handler(logger, async (request, user) => {
          const id = request.params.id;
          const existing = await findOwnedMachine(deps.db, id, user.id);
          if (!existing) {
            throw new HttpError(404, 'not_found', 'Machine not found');
          }
          if (existing.status !== 'pending') {
            throw new HttpError(409, 'invalid_transition', 'Only pending machines can be approved');
          }
          const approved = await approveMachine(deps.db, id, user.id, new Date(now()));
          if (!approved) {
            throw new HttpError(409, 'invalid_transition', 'Only pending machines can be approved');
          }
          machineRegistry.notifyApproved(id, approved.publicKey);
          logger.info({ machineId: id }, 'machine approved');
          await recordAudit({ actorUserId: user.id, action: 'machine.approved', subjectId: id });
          return toMachineView(toPublicMachine(approved));
        }),
      )
      .handle(
        'deny',
        handler(logger, async (request, user) => {
          const id = request.params.id;
          const existing = await findOwnedMachine(deps.db, id, user.id);
          if (!existing) {
            throw new HttpError(404, 'not_found', 'Machine not found');
          }
          if (existing.status !== 'pending') {
            throw new HttpError(409, 'invalid_transition', 'Only pending machines can be denied');
          }
          const denied = await denyMachine(deps.db, id, user.id);
          if (!denied) {
            throw new HttpError(409, 'invalid_transition', 'Only pending machines can be denied');
          }
          logger.info({ machineId: id }, 'machine denied');
          await recordAudit({ actorUserId: user.id, action: 'machine.denied', subjectId: id });
        }),
      )
      .handle(
        'revoke',
        handler(logger, async (request, user) => {
          const id = request.params.id;
          const existing = await findOwnedMachine(deps.db, id, user.id);
          if (!existing) {
            throw new HttpError(404, 'not_found', 'Machine not found');
          }
          if (existing.status === 'revoked') {
            throw new HttpError(409, 'invalid_transition', 'Machine is already revoked');
          }
          const revoked = await revokeMachine(deps.db, id, user.id, new Date(now()));
          if (!revoked) {
            throw new HttpError(409, 'invalid_transition', 'Machine is already revoked');
          }
          machineRegistry.notifyRevoked(id);
          logger.info({ machineId: id }, 'machine revoked');
          await recordAudit({ actorUserId: user.id, action: 'machine.revoked', subjectId: id });
          return toMachineView(toPublicMachine(revoked));
        }),
      )
      .handleRaw(
        'rename',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const id = request.params.id;
            const raw = yield* request.request.json.pipe(
              Effect.catchCause(() => Effect.succeed<unknown>(INVALID_JSON)),
            );
            if (raw === INVALID_JSON) {
              throw new HttpError(400, 'invalid_request', 'Invalid JSON body');
            }
            const parsed = Schema.decodeUnknownOption(RenameMachinePayload, STRICT_DECODE)(raw);
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
            return toMachineView(toPublicMachine(renamed));
          }),
        ),
      )
      .handle(
        'remove',
        handler(logger, async (request, user) => {
          const id = request.params.id;
          const existing = await findOwnedMachine(deps.db, id, user.id);
          if (!existing) {
            throw new HttpError(404, 'not_found', 'Machine not found');
          }
          if (existing.status === 'approved') {
            throw new HttpError(409, 'revoke_first', 'Revoke the machine before deleting it');
          }
          const deleted = await deleteMachine(deps.db, id, user.id);
          if (!deleted) {
            throw new HttpError(409, 'invalid_transition', 'Machine can no longer be deleted');
          }
          logger.info({ machineId: id }, 'machine deleted');
          await recordAudit({ actorUserId: user.id, action: 'machine.deleted', subjectId: id });
        }),
      )
      .handleRaw(
        'pair',
        // Public route: no session, so it uses the envelope directly.
        (request) =>
          withErrorEnvelope(
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
              const parsed = Schema.decodeUnknownOption(PairMachinePayload, STRICT_DECODE)(raw);
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
              if (
                consumed === null ||
                !signatureOk ||
                Option.isNone(parsed) ||
                normalized === null
              ) {
                throw invalidCode();
              }
              const body = parsed.value;
              const machine = yield* Effect.promise(() =>
                orConflict(() =>
                  insertPendingMachine(deps.db, {
                    ownerUserId: consumed.ownerUserId,
                    name: body.name,
                    publicKey: body.publicKey,
                    capabilities: body.capabilities,
                  }),
                ),
              );
              logger.info({ machineId: machine.id }, 'runner paired');
              yield* Effect.promise(() =>
                recordAudit({
                  actorUserId: consumed.ownerUserId,
                  action: 'machine.paired',
                  subjectId: machine.id,
                }),
              );
              return { machineId: machine.id, status: 'pending' as const };
            }),
            logger,
            requestIdOf(request.request),
          ),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(MachinesApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    // Pairing codes are minted sparingly; the budget is spent right after the
    // session, before any query.
    Layer.provide(
      rateLimitLayer(
        MachinesPairingCodeRateLimit,
        createCodeLimiter,
        'Too many pairing codes, try again later',
      ),
    ),
  );

  return mountApi(MachinesApi, apiLayer);
}
