import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { ARGS_HASH_PATTERN } from '@galena/protocol';
import type { ServerDatabase } from '../db/client';
import { ais, auditLog, groupMembers, groups, topicMembers, topics } from '../db/schema';

// `action` is dotted: `domain.verb`, lowercase + underscores. Same regex the
// protocol's approval schema already enforces for similar dotted ids.
const ACTION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

// A serialised `detail` blob stays under 2 KB so the audit log can never
// quietly start storing secrets, free text or big payloads.
const MAX_DETAIL_BYTES = 2 * 1024;

// We accept the few cost currencies the rest of the platform stores.
const costCurrencySchema = z.enum(['EUR', 'USD']);

// `result` is a small closed set: the row must tell the reader whether the
// action succeeded, was refused by policy, or failed because of an error.
const resultSchema = z.enum(['ok', 'denied', 'error']);

// The boundary validation: callers (the approvals and machines routes) hand
// us an entry, and we reject malformed ones before they touch the database.
// The spec forbids any free text: only ids, the action, a hash, optional
// cost, and a small `detail` object.
const entrySchema = z
  .object({
    actorUserId: z.string().min(1).max(128).nullable(),
    aiId: z.string().min(1).max(128).nullable(),
    groupId: z.string().min(1).max(128).nullable(),
    action: z.string().regex(ACTION_PATTERN).max(100),
    subjectId: z.string().min(1).max(128).nullable(),
    argsHash: z.string().regex(ARGS_HASH_PATTERN).nullable(),
    costCurrency: costCurrencySchema.nullable(),
    costAmount: z.number().finite().nonnegative().nullable(),
    result: resultSchema,
    detail: z
      .record(z.string().min(1).max(64), z.unknown())
      .nullable()
      .refine((value) => value === null || serialisedSize(value) <= MAX_DETAIL_BYTES, {
        message: `detail must serialise to at most ${MAX_DETAIL_BYTES} bytes`,
      }),
  })
  .strict();

export type AuditEntry = z.infer<typeof entrySchema>;

export interface AuditRecorderDeps {
  db: ServerDatabase;
  logger?: AuditLogger;
  /** Override `now` in tests. Defaults to the wall clock. */
  now?: () => Date;
}

// Minimal slice of pino's Logger the recorder needs. Real call sites pass the
// server's own logger; tests can pass a captor.
export interface AuditLogger {
  error: (fields: Record<string, unknown>, message: string) => void;
}

export interface AuditRecorder {
  record: (entry: AuditEntry) => Promise<void>;
}

// A recorder wraps `recordAudit` so a database failure never propagates into
// the caller's request. The error log intentionally only carries `{ action }`:
// `detail`, `actor_user_id`, `ai_id` and friends are not echoed because the
// audit log's whole point is to keep sensitive data out of write paths.
export interface CreateAuditRecorderInput {
  db: ServerDatabase;
  logger?: AuditLogger;
  now?: () => Date;
}

export function createAuditRecorder({
  db,
  logger,
  now = () => new Date(),
}: CreateAuditRecorderInput): AuditRecorder {
  return {
    async record(entry: AuditEntry): Promise<void> {
      try {
        await recordAudit(db, entry, now());
      } catch (error) {
        if (logger !== undefined) {
          logger.error({ action: entry.action, err: error }, 'audit write failed; carrying on');
        }
      }
    },
  };
}

// Validates the entry at the boundary, then inserts one row. Callers that
// must not fail on an audit write wrap this in `createAuditRecorder`. The
// `now` parameter is injectable so tests can pin the timestamp.
export async function recordAudit(db: ServerDatabase, entry: AuditEntry, now: Date): Promise<void> {
  const parsed = entrySchema.safeParse(entry);
  if (!parsed.success) {
    throw new Error(`Invalid audit entry: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  await db.insert(auditLog).values({
    id: randomId(),
    at: now,
    actorUserId: parsed.data.actorUserId,
    aiId: parsed.data.aiId,
    groupId: parsed.data.groupId,
    action: parsed.data.action,
    subjectId: parsed.data.subjectId,
    argsHash: parsed.data.argsHash,
    costCurrency: parsed.data.costCurrency,
    costAmount: parsed.data.costAmount === null ? null : parsed.data.costAmount.toFixed(2),
    result: parsed.data.result,
    detail: parsed.data.detail,
  });
}

export const MAX_AUDIT_LIST_LIMIT = 200;
export const DEFAULT_AUDIT_LIST_LIMIT = 50;

const cursorSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[0-9a-zA-Z_:.\\-]+$/);

// One result row, exactly as it appears in the API. Visibility rules are
// applied by the list functions: a row's `actor_user_id` is only included
// when the caller is allowed to see it (i.e. they own the AI, or they own
// or administer the group).
export interface PublicAuditEntry {
  id: string;
  at: Date;
  aiId: string | null;
  groupId: string | null;
  action: string;
  subjectId: string | null;
  argsHash: string | null;
  cost: { currency: 'EUR' | 'USD'; amount: number } | null;
  result: 'ok' | 'denied' | 'error';
  detail: Record<string, unknown> | null;
  /** The acting user. Only present when the caller may see it. */
  actorUserId: string | null;
}

export interface ListAuditPage {
  entries: PublicAuditEntry[];
  /** A cursor for `before`. `null` when there are no more pages. */
  next: string | null;
}

export interface ListAuditOptions {
  limit?: number;
  /** Cursor returned by a previous page. */
  before?: string;
}

// Cursor format: `<ISO_AT>_<id>`, base64url. The id breaks ties when two rows
// share the same `at` (possible when two writers inserted at the same
// instant), so pagination never returns duplicates or skips.
function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}_${id}`, 'ascii').toString('base64url');
}

function decodeCursor(cursor: string): { at: Date; id: string } {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('ascii');
  } catch {
    throw new Error('Invalid cursor');
  }
  const separatorIndex = decoded.lastIndexOf('_');
  if (separatorIndex < 0) {
    throw new Error('Invalid cursor');
  }
  const atIso = decoded.slice(0, separatorIndex);
  const id = decoded.slice(separatorIndex + 1);
  const at = new Date(atIso);
  if (Number.isNaN(at.getTime())) {
    throw new Error('Invalid cursor');
  }
  return { at, id };
}

// Lists audit rows whose `group_id` matches, newest first. Visibility:
// the group's owner and admins only. A non-member — or a plain member —
// gets the same empty page as an unknown group id, so existence is never
// leaked. T-0108: topic entries for a private topic the viewer cannot see
// are dropped from the page (the recorder never stores a private topic's
// name in `detail`, and this filter keeps the entries themselves hidden).
export async function listAuditForGroup(
  db: ServerDatabase,
  groupId: string,
  userId: string,
  options: ListAuditOptions = {},
): Promise<ListAuditPage> {
  const limit = clampLimit(options.limit);
  const before = options.before === undefined ? null : parseCursor(options.before);
  const visible = await isGroupAdmin(db, groupId, userId);
  if (!visible) {
    return { entries: [], next: null };
  }
  // Over-fetch so private-topic entries can be filtered without shrinking
  // the page more than needed; pagination stays newest-first and the cursor
  // still advances.
  const page = await listForColumn(db, auditLog.groupId, groupId, limit * 2 + 1, before);
  const kept = await filterHiddenTopicEntries(db, userId, page.entries);
  const entries = kept.slice(0, limit);
  const last = entries[entries.length - 1];
  return {
    entries,
    next: kept.length > limit && last !== undefined ? encodeCursor(last.at, last.id) : page.next,
  };
}

// Lists audit rows whose `ai_id` matches, newest first. Visibility: the AI's
// owner only. Anyone else — a stranger, even a group admin — gets the same
// empty page as an unknown AI.
export async function listAuditForAi(
  db: ServerDatabase,
  aiId: string,
  userId: string,
  options: ListAuditOptions = {},
): Promise<ListAuditPage> {
  const limit = clampLimit(options.limit);
  const before = options.before === undefined ? null : parseCursor(options.before);
  const [ai] = await db.select({ owner: ais.owner }).from(ais).where(eq(ais.id, aiId)).limit(1);
  if (!ai || ai.owner !== userId) {
    return { entries: [], next: null };
  }
  return listForColumn(db, auditLog.aiId, aiId, limit, before);
}

// The shared `WHERE` and cursor logic. `limit + 1` rows are fetched so we
// can tell the caller whether another page exists, without running two
// queries.
async function listForColumn(
  db: ServerDatabase,
  column: typeof auditLog.groupId | typeof auditLog.aiId,
  value: string,
  limit: number,
  before: { at: Date; id: string } | null,
): Promise<ListAuditPage> {
  const conditions = [eq(column, value)];
  if (before !== null) {
    conditions.push(
      or(lt(auditLog.at, before.at), and(eq(auditLog.at, before.at), lt(auditLog.id, before.id)))!,
    );
  }
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const next =
    hasMore && page.length > 0
      ? encodeCursor(page[page.length - 1]!.at, page[page.length - 1]!.id)
      : null;
  return { entries: page.map(toPublicAuditEntry), next };
}

// Maps an internal row to the public shape. The caller is known to be
// allowed to read this scope, so `actor_user_id` is always included: only
// admins and AI owners ever see it.
function toPublicAuditEntry(row: typeof auditLog.$inferSelect): PublicAuditEntry {
  const hasCost = row.costCurrency !== null && row.costAmount !== null;
  return {
    id: row.id,
    at: row.at,
    aiId: row.aiId,
    groupId: row.groupId,
    action: row.action,
    subjectId: row.subjectId,
    argsHash: row.argsHash,
    cost: hasCost
      ? {
          currency: row.costCurrency as 'EUR' | 'USD',
          amount: Number(row.costAmount),
        }
      : null,
    result: row.result,
    detail: (row.detail as Record<string, unknown> | null) ?? null,
    actorUserId: row.actorUserId,
  };
}

function isGroupAdmin(db: ServerDatabase, groupId: string, userId: string): Promise<boolean> {
  return db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupId))
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1)
    .then((rows) => {
      if (rows.length === 0) {
        return false;
      }
      const role = rows[0]!.role;
      return role === 'owner' || role === 'admin';
    });
}

// Drops entries about a private topic the viewer cannot see. Topic actions
// (`topic.*`) carry the topic id in `subject_id`; anything else passes
// through. Group membership is already established by the caller.
async function filterHiddenTopicEntries(
  db: ServerDatabase,
  userId: string,
  entries: PublicAuditEntry[],
): Promise<PublicAuditEntry[]> {
  const topicActions = entries.filter((entry) => entry.action.startsWith('topic.'));
  if (topicActions.length === 0) {
    return entries;
  }
  const subjectIds = [
    ...new Set(
      topicActions.map((entry) => entry.subjectId).filter((id): id is string => id !== null),
    ),
  ];
  if (subjectIds.length === 0) {
    return entries;
  }
  const topicRows = await db.select().from(topics).where(inArray(topics.id, subjectIds));
  const byId = new Map(topicRows.map((row) => [row.id, row]));
  let privateSeen: Set<string> = new Set();
  const privateIds = topicRows.filter((row) => row.visibility === 'private').map((row) => row.id);
  if (privateIds.length > 0) {
    const memberRows = await db
      .select({ topicId: topicMembers.topicId })
      .from(topicMembers)
      .where(and(inArray(topicMembers.topicId, privateIds), eq(topicMembers.userId, userId)));
    privateSeen = new Set(memberRows.map((row) => row.topicId));
  }
  return entries.filter((entry) => {
    if (!entry.action.startsWith('topic.') || entry.subjectId === null) {
      return true;
    }
    const topic = byId.get(entry.subjectId);
    // A topic row that is gone (or never existed) carries no private name;
    // keep the entry so the log stays complete.
    if (!topic || topic.visibility !== 'private') {
      return true;
    }
    return privateSeen.has(topic.id);
  });
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_AUDIT_LIST_LIMIT;
  }
  if (limit < 1) {
    return 1;
  }
  if (limit > MAX_AUDIT_LIST_LIMIT) {
    return MAX_AUDIT_LIST_LIMIT;
  }
  return Math.floor(limit);
}

function parseCursor(cursor: string): { at: Date; id: string } {
  const parsed = cursorSchema.safeParse(cursor);
  if (!parsed.success) {
    throw new Error('Invalid cursor');
  }
  return decodeCursor(parsed.data);
}

function serialisedSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function randomId(): string {
  return randomBytes(16).toString('hex');
}
