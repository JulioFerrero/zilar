import type { ServerCore } from '../app/deps';
import { Effect, Option, Schema } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import {
  MachinesGroup,
  MachinesPairingCodeRateLimit,
  PairMachinePayload,
  RenameMachinePayload,
  type Machine,
} from '@zilar/api-contract';
import { type Logger } from 'pino';
import { type AuditRecorder } from '../audit/recorder';

import { rateLimitLayer } from '../effect/rate-limit-middleware';

import { HttpError } from '../errors';
import {
  mountGroups,
  handler,
  requestIdOf,
  socketAddressOf,
  withErrorEnvelope,
  type EffectApiMount,
} from '../effect/http-core';
import { limiter } from '../rate-limit';
import { hashPairingCode, normalizePairingCode } from './codes';
import { createDbMachineRegistry, type DbMachineRegistry } from './registry';
import {
  consumePairingCode,
  createPairingCode,
  insertPendingMachine,
  toPublicMachine,
  MachineServiceError,
  type PublicMachine,
} from './service';
import {
  approveMachine,
  deleteMachine,
  denyMachine,
  findOwnedMachine,
  listMachines,
  renameMachine,
  revokeMachine,
} from './machines';
import { verifyPairingSignature } from './crypto';
// The dates travel as ISO strings.
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

// Tells a malformed JSON body from a shape violation after decoding.
const INVALID_JSON = Symbol('invalid-json');

// Pairing codes are minted sparingly: 10 per hour per user.

// The pair route is the brute-force target: 30/min across callers plus 10/min per IP.

// Every owner write shares one per-user budget.

export interface MachinesApiDependencies extends Pick<ServerCore, 'auth' | 'db'> {
  logger: Logger;
  audit?: AuditRecorder;
  /** Shared with the tunnel hub so revokes close live connections. */
  registry?: DbMachineRegistry;
  now?: () => number;
  isMachineOnline?: (machineId: string) => boolean;
}

const STRICT_DECODE = { onExcessProperty: 'error' } as const;

// `rename` and `pair` declare payloads for the derived client but are served
// with `handleRaw`: they read the body by hand for their own 400 texts.
const MachinesApi = HttpApi.make('machines').add(MachinesGroup);

export function createMachinesApi(deps: MachinesApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const audit = deps.audit;
  const isMachineOnline = deps.isMachineOnline;
  const machineRegistry = deps.registry ?? createDbMachineRegistry(deps.db);

  const createCodeLimiter = limiter('pairingCode', now);
  const pairGlobalLimiter = limiter('pairGlobal', now);
  const pairIpLimiter = limiter('pairIp', now);
  const writeLimiter = limiter('machineWrite', now);

  function checkWriteLimit(userId: string): void {
    if (!writeLimiter.allow(userId)) {
      throw new HttpError(429, 'rate_limited', 'Too many machine changes, try again later');
    }
  }

  // Awaited: an audit write failure rejects the route.
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

  // A `MachineServiceError` answers 409 with its code; anything else stays a 500.
  async function orConflict<A>(run: () => Promise<A>): Promise<A> {
    try {
      return await run();
    } catch (error) {
      throw toConflict(error);
    }
  }

  async function requireOwnedMachine(id: string, userId: string) {
    checkWriteLimit(userId);
    const existing = await findOwnedMachine(deps.db, id, userId);
    if (!existing) {
      throw new HttpError(404, 'not_found', 'Machine not found');
    }
    return existing;
  }

  const groupLayer = HttpApiBuilder.group(MachinesApi, 'machines', (handlers) =>
    handlers
      .handle(
        'createPairingCode',
        handler(logger, async (_request, user) => {
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
          const existing = await requireOwnedMachine(id, user.id);
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
          const existing = await requireOwnedMachine(id, user.id);
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
          const existing = await requireOwnedMachine(id, user.id);
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
            checkWriteLimit(user.id);
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
          const existing = await requireOwnedMachine(id, user.id);
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
              // Consume and signature check run together and branch once, so timing
              // does not reveal which failed; every failure answers 400 invalid_code.
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

  return mountGroups(MachinesApi, groupLayer, {
    auth: deps.auth,
    logger,
    // Spent right after the session, before any query.
    extra: rateLimitLayer(
      MachinesPairingCodeRateLimit,
      createCodeLimiter,
      'Too many pairing codes, try again later',
    ),
  });
}
