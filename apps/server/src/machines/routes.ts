import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
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

export interface MachinesRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  logger: MachinesLogger;
  /** Audit recorder; production wires the server's own recorder. */
  audit?: AuditRecorder;
  /** Shared with the tunnel hub so revokes close live connections. */
  registry?: DbMachineRegistry;
  /** Injected in tests so rate-limit windows can advance without waiting. */
  now?: () => number;
  /** Injected in tests; production uses the socket address. */
  getClientIp?: (c: Context) => string;
  /** Injected by app.ts when the runner hub is on; absent = hub off. */
  isMachineOnline?: (machineId: string) => boolean;
}

export interface MachinesLogger {
  info: (fields: Record<string, unknown>, message: string) => void;
}

const machineNameSchema = z.string().trim().min(1).max(64);

const toolsValueSchema = z.union([
  z.string().max(1024),
  z.number(),
  z.boolean(),
  z.array(z.string().max(128)).max(64),
]);

// The capability report (§11.3), snake_case as the runner sends it. Strict so
// a report with an unexpected field is rejected rather than silently stored.
const capabilitiesSchema = z.strictObject({
  os: z.string().trim().min(1).max(64),
  os_version: z.string().trim().min(1).max(64),
  arch: z.string().trim().min(1).max(64),
  cpu: z.string().trim().min(1).max(128),
  cores: z.number().int().min(1).max(1024),
  ram_gb: z.number().min(0).max(1000000),
  disk_free_gb: z.number().min(0).max(1000000),
  power: z.string().trim().min(1).max(64),
  drivers: z.array(z.string().trim().min(1).max(64)).max(32),
  tools: z
    .record(z.string().min(1).max(128), toolsValueSchema)
    .refine((tools) => Object.keys(tools).length <= 64, {
      message: 'tools must have at most 64 entries',
    }),
  labels: z.array(z.string().trim().min(1).max(64)).max(32),
  runner_version: z.string().trim().min(1).max(64),
});

const pairSchema = z.strictObject({
  code: z.string().min(1).max(64),
  publicKey: z.string().min(1).max(512),
  signature: z.string().min(1).max(512),
  name: machineNameSchema,
  capabilities: capabilitiesSchema,
});

const renameSchema = z.strictObject({
  name: machineNameSchema,
});

export function createMachinesRoutes({
  auth,
  db,
  logger,
  audit,
  registry,
  now = Date.now,
  getClientIp,
  isMachineOnline,
}: MachinesRoutesDependencies): Hono {
  const routes = new Hono();
  const machineRegistry = registry ?? createDbMachineRegistry(db);
  const clientIp = getClientIp ?? socketAddress;

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

  routes.post('/machines/pairing-codes', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    if (!createCodeLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many pairing codes, try again later');
    }
    try {
      const { code, expiresAt } = await createPairingCode(db, user.id, new Date(now()));
      return c.json({ code, expiresAt: expiresAt.toISOString() }, 201);
    } catch (error) {
      throw toConflict(error);
    }
  });

  routes.get('/machines', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const rows = await listMachines(db, user.id);
    return c.json(rows.map((row) => toPublicMachine(row, isMachineOnline)));
  });

  routes.post('/machines/:id/approve', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const id = c.req.param('id');
    const existing = await findOwnedMachine(db, id, user.id);
    if (!existing) {
      throw new HttpError(404, 'not_found', 'Machine not found');
    }
    if (existing.status !== 'pending') {
      throw new HttpError(409, 'invalid_transition', 'Only pending machines can be approved');
    }
    const approved = await approveMachine(db, id, user.id, new Date(now()));
    if (!approved) {
      throw new HttpError(409, 'invalid_transition', 'Only pending machines can be approved');
    }
    machineRegistry.notifyApproved(id, approved.publicKey);
    logger.info({ machineId: id }, 'machine approved');
    if (audit !== undefined) {
      await audit.record({
        actorUserId: user.id,
        aiId: null,
        groupId: null,
        action: 'machine.approved',
        subjectId: id,
        argsHash: null,
        costCurrency: null,
        costAmount: null,
        result: 'ok',
        detail: null,
      });
    }
    return c.json(toPublicMachine(approved));
  });

  routes.post('/machines/:id/deny', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const id = c.req.param('id');
    const existing = await findOwnedMachine(db, id, user.id);
    if (!existing) {
      throw new HttpError(404, 'not_found', 'Machine not found');
    }
    if (existing.status !== 'pending') {
      throw new HttpError(409, 'invalid_transition', 'Only pending machines can be denied');
    }
    const denied = await denyMachine(db, id, user.id);
    if (!denied) {
      throw new HttpError(409, 'invalid_transition', 'Only pending machines can be denied');
    }
    logger.info({ machineId: id }, 'machine denied');
    if (audit !== undefined) {
      await audit.record({
        actorUserId: user.id,
        aiId: null,
        groupId: null,
        action: 'machine.denied',
        subjectId: id,
        argsHash: null,
        costCurrency: null,
        costAmount: null,
        result: 'ok',
        detail: null,
      });
    }
    return c.body(null, 204);
  });

  routes.post('/machines/:id/revoke', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const id = c.req.param('id');
    const existing = await findOwnedMachine(db, id, user.id);
    if (!existing) {
      throw new HttpError(404, 'not_found', 'Machine not found');
    }
    if (existing.status === 'revoked') {
      throw new HttpError(409, 'invalid_transition', 'Machine is already revoked');
    }
    const revoked = await revokeMachine(db, id, user.id, new Date(now()));
    if (!revoked) {
      throw new HttpError(409, 'invalid_transition', 'Machine is already revoked');
    }
    machineRegistry.notifyRevoked(id);
    logger.info({ machineId: id }, 'machine revoked');
    if (audit !== undefined) {
      await audit.record({
        actorUserId: user.id,
        aiId: null,
        groupId: null,
        action: 'machine.revoked',
        subjectId: id,
        argsHash: null,
        costCurrency: null,
        costAmount: null,
        result: 'ok',
        detail: null,
      });
    }
    return c.json(toPublicMachine(revoked));
  });

  routes.patch('/machines/:id', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const id = c.req.param('id');
    const parsed = renameSchema.safeParse(await readOwnerJson(c));
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_request', 'Invalid machine update');
    }
    const existing = await findOwnedMachine(db, id, user.id);
    if (!existing) {
      throw new HttpError(404, 'not_found', 'Machine not found');
    }
    const renamed = await renameMachine(db, id, user.id, parsed.data.name);
    if (!renamed) {
      throw new HttpError(404, 'not_found', 'Machine not found');
    }
    return c.json(toPublicMachine(renamed));
  });

  routes.delete('/machines/:id', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const id = c.req.param('id');
    const existing = await findOwnedMachine(db, id, user.id);
    if (!existing) {
      throw new HttpError(404, 'not_found', 'Machine not found');
    }
    if (existing.status === 'approved') {
      throw new HttpError(409, 'revoke_first', 'Revoke the machine before deleting it');
    }
    const deleted = await deleteMachine(db, id, user.id);
    if (!deleted) {
      throw new HttpError(409, 'invalid_transition', 'Machine can no longer be deleted');
    }
    logger.info({ machineId: id }, 'machine deleted');
    if (audit !== undefined) {
      await audit.record({
        actorUserId: user.id,
        aiId: null,
        groupId: null,
        action: 'machine.deleted',
        subjectId: id,
        argsHash: null,
        costCurrency: null,
        costAmount: null,
        result: 'ok',
        detail: null,
      });
    }
    return c.body(null, 204);
  });

  routes.post('/runner/pair', async (c) => {
    if (!pairGlobalLimiter.allow('runner-pair')) {
      throw new HttpError(429, 'rate_limited', 'Too many pairing attempts, try again in a minute');
    }
    if (!pairIpLimiter.allow(clientIp(c))) {
      throw new HttpError(429, 'rate_limited', 'Too many pairing attempts, try again in a minute');
    }
    const parsed = pairSchema.safeParse(await readPairJson(c));
    const normalized = parsed.success ? normalizePairingCode(parsed.data.code) : null;
    // The code-consume and the signature check run together and the route
    // branches once afterwards, so the timing does not reveal which one
    // failed. Every failure below answers the identical 400 invalid_code.
    const [consumed, signatureOk] = await Promise.all([
      normalized === null
        ? Promise.resolve(null)
        : consumePairingCode(db, hashPairingCode(normalized), new Date(now())),
      Promise.resolve(
        parsed.success && normalized !== null
          ? verifyPairingSignature(parsed.data.publicKey, parsed.data.signature, normalized)
          : false,
      ),
    ]);
    if (consumed === null || !signatureOk || !parsed.success || normalized === null) {
      throw invalidCode();
    }
    try {
      const machine = await insertPendingMachine(db, {
        ownerUserId: consumed.ownerUserId,
        name: parsed.data.name,
        publicKey: parsed.data.publicKey,
        capabilities: parsed.data.capabilities,
      });
      logger.info({ machineId: machine.id }, 'runner paired');
      if (audit !== undefined) {
        await audit.record({
          actorUserId: consumed.ownerUserId,
          aiId: null,
          groupId: null,
          action: 'machine.paired',
          subjectId: machine.id,
          argsHash: null,
          costCurrency: null,
          costAmount: null,
          result: 'ok',
          detail: null,
        });
      }
      return c.json({ machineId: machine.id, status: 'pending' as const }, 201);
    } catch (error) {
      throw toConflict(error);
    }
  });

  return routes;
}

// The socket address as the server sees it. Proxy headers (x-forwarded-for
// and friends) are deliberately not trusted here — anyone can forge them —
// until the deployment task puts the server behind a configured trusted
// proxy. Tests inject getClientIp instead.
function socketAddress(c: Context): string {
  try {
    const address = getConnInfo(c).remote.address;
    return typeof address === 'string' && address.length > 0 ? address : 'unknown';
  } catch {
    return 'unknown';
  }
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

async function readOwnerJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HttpError(400, 'invalid_request', 'Invalid JSON body');
  }
}

// Malformed JSON on the public pair route is indistinguishable from a bad
// code: it answers invalid_code, never invalid_request.
async function readPairJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}
