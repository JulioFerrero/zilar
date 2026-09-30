import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { ais, aiToolRuns, aiTools, aiToolVersions } from '../db/schema';
import { parseToolVersionInput } from './schemas';
import type { ToolRunner, ToolRunResult } from './types';

export type { ToolRunner, ToolRunResult };

// T-0103: versioned tool code per AI and topic. A tool belongs to one AI
// and one topic (`groupId` + `topicId`, or both null for the personal chat
// with the owner). History is append-only: `saveToolVersion` and
// `revertTool` only insert into `ai_tool_versions`; no function here ever
// updates or deletes a version row.

// Caps: at most 20 active tools per (AI, topic), at most 200 versions per
// tool. The runner output stored on a run row is truncated to 2 KiB, and
// only the newest 50 runs per tool are kept.
export const MAX_TOOLS_PER_TOPIC = 20;
export const MAX_VERSIONS_PER_TOOL = 200;
export const MAX_RUNS_PER_TOOL = 50;
export const MAX_RUN_OUTPUT_BYTES = 2 * 1024;

export class ToolServiceError extends Error {
  readonly errorCode: string;

  constructor(errorCode: string, message: string) {
    super(message);
    this.name = 'ToolServiceError';
    this.errorCode = errorCode;
  }
}

type ToolRow = typeof aiTools.$inferSelect;
type VersionRow = typeof aiToolVersions.$inferSelect;

export interface SaveToolVersionInput {
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  name: string;
  description: string;
  source: string;
  hosts: string[];
  message: string;
  userId: string;
}

// One tool as the list returns it: no source. `hosts` and `lastRunStatus`
// come from the current version and the newest run row.
export interface PublicTool {
  id: string;
  aiId: string;
  groupId: string | null;
  /** The topic the tool belongs to. Null for personal-chat tools. */
  topicId: string | null;
  name: string;
  description: string;
  currentVersion: number;
  hosts: string[];
  lastRunStatus: 'ok' | 'error' | null;
  updatedAt: Date;
}

// One tool with its current source, as `getTool` returns it.
export interface ToolDetail extends PublicTool {
  source: string;
}

export interface PublicToolVersion {
  id: string;
  toolId: string;
  version: number;
  message: string;
  hosts: string[];
  createdBy: string;
  createdAt: Date;
}

export interface ToolVersionDetail extends PublicToolVersion {
  source: string;
}

export interface PublicToolRun {
  id: string;
  toolId: string;
  version: number;
  trigger: 'manual' | 'routine' | 'ai';
  status: 'ok' | 'error';
  errorKind: string | null;
  durationMs: number;
  fetchCount: number;
  outputText: string | null;
  createdAt: Date;
}

export interface SaveToolVersionResult {
  tool: ToolDetail;
  version: ToolVersionDetail;
  /** True when source and hosts matched the current version, so no new row
   *  was written. */
  unchanged: boolean;
  /** `created: true` when the tool row was inserted by this call. */
  created: boolean;
}

interface AppendVersionResult {
  tool: ToolDetail;
  version: ToolVersionDetail;
  /** True when source and hosts matched the current version, so no new row
   *  was written. */
  unchanged: boolean;
}

// Creates the tool with version 1 when the name is new in that topic, or
// appends version N+1 when source or hosts differ from the current
// version. An identical save returns the current version with
// `unchanged: true` and writes nothing. All in one transaction; the tool
// row is locked (`SELECT … FOR UPDATE`) so two concurrent saves end with
// consecutive version numbers and no duplicate.
//
// `audit` is optional: when present, a `tool.created` or `tool.updated`
// entry is written after the transaction commits, with `detail { name,
// version }` and never any source. (No route in this task creates or
// updates tools — T-0104's AI-facing tools will pass the recorder.)
// The audit write never throws into the caller.
export async function saveToolVersion(
  db: ServerDatabase,
  input: SaveToolVersionInput,
  now: Date,
  audit?: AuditRecorder,
): Promise<SaveToolVersionResult> {
  const parsed = parseToolVersionInput({
    name: input.name,
    description: input.description,
    source: input.source,
    hosts: input.hosts,
    message: input.message,
  });
  if (!parsed.ok) {
    throw new ToolServiceError('invalid_request', parsed.message);
  }
  const { name, description, source, hosts, message } = parsed.value;

  const existing = await findActiveTool(db, input.aiId, input.topicId, name);
  if (!existing) {
    await enforceToolLimit(db, input.aiId, input.topicId);
    const createdResult = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as ServerDatabase;
      const [inserted] = await tx
        .insert(aiTools)
        .values({
          id: randomUUID(),
          aiId: input.aiId,
          groupId: input.groupId,
          topicId: input.topicId,
          name,
          description,
          currentVersion: 1,
          createdBy: input.userId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted !== undefined) {
        const version = await insertVersion(tx, {
          toolId: inserted.id,
          version: 1,
          source,
          hosts,
          message,
          createdBy: input.userId,
          now,
        });
        return {
          tool: toToolDetail(inserted, version, null),
          version: toVersionDetail(version),
          unchanged: false,
          created: true,
        };
      }
      // Lost the race with a concurrent create of the same name: append
      // to the winner's history instead.
      const winner = await findActiveTool(tx, input.aiId, input.topicId, name);
      if (!winner) {
        throw new Error('Failed to create tool');
      }
      return {
        ...(await appendVersion(tx, {
          tool: winner,
          description,
          source,
          hosts,
          message,
          userId: input.userId,
          now,
        })),
        created: false,
      };
    });
    if (audit !== undefined && !createdResult.unchanged) {
      await recordSaveAudit(audit, {
        action: createdResult.created ? 'tool.created' : 'tool.updated',
        toolId: createdResult.tool.id,
        actorUserId: input.userId,
        aiId: input.aiId,
        groupId: input.groupId,
        version: createdResult.version.version,
        name,
      });
    }
    return createdResult;
  }
  const updatedResult = await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as ServerDatabase;
    const [locked] = await tx
      .select()
      .from(aiTools)
      .where(eq(aiTools.id, existing.id))
      .for('update')
      .limit(1);
    if (!locked || locked.deletedAt !== null) {
      throw new ToolServiceError('not_found', 'Tool not found');
    }
    return {
      ...(await appendVersion(tx, {
        tool: locked,
        description,
        source,
        hosts,
        message,
        userId: input.userId,
        now,
      })),
      created: false,
    };
  });
  if (audit !== undefined && !updatedResult.unchanged) {
    await recordSaveAudit(audit, {
      action: 'tool.updated',
      toolId: updatedResult.tool.id,
      actorUserId: input.userId,
      aiId: input.aiId,
      groupId: input.groupId,
      version: updatedResult.version.version,
      name,
    });
  }
  return updatedResult;
}

interface AppendVersionInput {
  tool: ToolRow;
  description: string;
  source: string;
  hosts: string[];
  message: string;
  userId: string;
  now: Date;
}

// Appends version N+1 inside the caller's transaction, or returns the
// current version unchanged when source and hosts both match. The lock on
// the tool row (taken by the caller) serialises concurrent appends.
async function appendVersion(
  tx: ServerDatabase,
  input: AppendVersionInput,
): Promise<AppendVersionResult> {
  const [current] = await tx
    .select()
    .from(aiToolVersions)
    .where(
      and(
        eq(aiToolVersions.toolId, input.tool.id),
        eq(aiToolVersions.version, input.tool.currentVersion),
      ),
    )
    .limit(1);
  if (!current) {
    throw new Error('Tool is missing its current version');
  }
  if (current.source === input.source && hostsEqual(current.hosts, input.hosts)) {
    const [run] = await tx
      .select({ status: aiToolRuns.status })
      .from(aiToolRuns)
      .where(eq(aiToolRuns.toolId, input.tool.id))
      .orderBy(desc(aiToolRuns.createdAt), desc(aiToolRuns.id))
      .limit(1);
    return {
      tool: toToolDetail(input.tool, current, run?.status ?? null),
      version: toVersionDetail(current),
      unchanged: true,
    };
  }
  if (input.tool.currentVersion >= MAX_VERSIONS_PER_TOOL) {
    throw new ToolServiceError(
      'version_limit',
      `A tool has at most ${MAX_VERSIONS_PER_TOOL} versions`,
    );
  }
  const next = input.tool.currentVersion + 1;
  const version = await insertVersion(tx, {
    toolId: input.tool.id,
    version: next,
    source: input.source,
    hosts: input.hosts,
    message: input.message,
    createdBy: input.userId,
    now: input.now,
  });
  const [updated] = await tx
    .update(aiTools)
    .set({ description: input.description, currentVersion: next, updatedAt: input.now })
    .where(eq(aiTools.id, input.tool.id))
    .returning();
  if (!updated) {
    throw new Error('Tool disappeared while saving a version');
  }
  const [run] = await tx
    .select({ status: aiToolRuns.status })
    .from(aiToolRuns)
    .where(eq(aiToolRuns.toolId, input.tool.id))
    .orderBy(desc(aiToolRuns.createdAt), desc(aiToolRuns.id))
    .limit(1);
  return {
    tool: toToolDetail(updated, version, run?.status ?? null),
    version: toVersionDetail(version),
    unchanged: false,
  };
}

// Lists the non-deleted tools of one AI in one topic (no source). The
// route decides which topics to query; the helper does not.
export async function listTools(
  db: ServerDatabase,
  input: { aiId: string; groupId: string | null; topicId: string | null },
): Promise<PublicTool[]> {
  const rows = await db
    .select()
    .from(aiTools)
    .where(
      input.topicId === null
        ? and(eq(aiTools.aiId, input.aiId), isNull(aiTools.topicId), isNull(aiTools.deletedAt))
        : and(
            eq(aiTools.aiId, input.aiId),
            eq(aiTools.topicId, input.topicId),
            isNull(aiTools.deletedAt),
          ),
    )
    .orderBy(asc(aiTools.name));
  const result: PublicTool[] = [];
  for (const tool of rows) {
    const [current] = await db
      .select()
      .from(aiToolVersions)
      .where(
        and(eq(aiToolVersions.toolId, tool.id), eq(aiToolVersions.version, tool.currentVersion)),
      )
      .limit(1);
    const [run] = await db
      .select({ status: aiToolRuns.status })
      .from(aiToolRuns)
      .where(eq(aiToolRuns.toolId, tool.id))
      .orderBy(desc(aiToolRuns.createdAt), desc(aiToolRuns.id))
      .limit(1);
    result.push({
      id: tool.id,
      aiId: tool.aiId,
      groupId: tool.groupId,
      topicId: tool.topicId,
      name: tool.name,
      description: tool.description,
      currentVersion: tool.currentVersion,
      hosts: current?.hosts ?? [],
      lastRunStatus: run?.status ?? null,
      updatedAt: tool.updatedAt,
    });
  }
  return result;
}

// One non-deleted tool with its current source, or null for a missing id
// and a deleted one alike.
export async function getTool(db: ServerDatabase, id: string): Promise<ToolDetail | null> {
  const [tool] = await db.select().from(aiTools).where(eq(aiTools.id, id)).limit(1);
  if (!tool || tool.deletedAt !== null) {
    return null;
  }
  const [current] = await db
    .select()
    .from(aiToolVersions)
    .where(and(eq(aiToolVersions.toolId, tool.id), eq(aiToolVersions.version, tool.currentVersion)))
    .limit(1);
  if (!current) {
    return null;
  }
  const [run] = await db
    .select({ status: aiToolRuns.status })
    .from(aiToolRuns)
    .where(eq(aiToolRuns.toolId, tool.id))
    .orderBy(desc(aiToolRuns.createdAt), desc(aiToolRuns.id))
    .limit(1);
  return toToolDetail(tool, current, run?.status ?? null);
}

// Every version of a tool, newest first, without source. Returns null for
// a missing or deleted tool.
export async function listVersions(
  db: ServerDatabase,
  toolId: string,
): Promise<PublicToolVersion[] | null> {
  const tool = await getToolRow(db, toolId);
  if (!tool) {
    return null;
  }
  const rows = await db
    .select()
    .from(aiToolVersions)
    .where(eq(aiToolVersions.toolId, toolId))
    .orderBy(desc(aiToolVersions.version));
  return rows.map(toPublicVersion);
}

// One version with source, or null for a missing/deleted tool or version.
export async function getVersion(
  db: ServerDatabase,
  toolId: string,
  version: number,
): Promise<ToolVersionDetail | null> {
  const tool = await getToolRow(db, toolId);
  if (!tool) {
    return null;
  }
  const [row] = await db
    .select()
    .from(aiToolVersions)
    .where(and(eq(aiToolVersions.toolId, toolId), eq(aiToolVersions.version, version)))
    .limit(1);
  return row ? toVersionDetail(row) : null;
}

export interface RevertToolInput {
  toolId: string;
  toVersion: number;
  userId: string;
  message?: string;
}

// Appends a new version copying an older version's source and hosts. The
// message is the standard `Revert to v<N>` unless the caller passes one.
// History is never rewritten: older rows are untouched.
export async function revertTool(
  db: ServerDatabase,
  input: RevertToolInput,
  now: Date,
): Promise<{ tool: ToolDetail; version: ToolVersionDetail }> {
  const message = input.message === undefined ? `Revert to v${input.toVersion}` : input.message;
  const parsed = parseToolVersionInput({
    name: 'revert-placeholder',
    description: 'revert placeholder',
    source: 'placeholder',
    hosts: [],
    message,
  });
  if (!parsed.ok) {
    throw new ToolServiceError('invalid_request', parsed.message);
  }
  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as ServerDatabase;
    const [tool] = await tx
      .select()
      .from(aiTools)
      .where(eq(aiTools.id, input.toolId))
      .for('update')
      .limit(1);
    if (!tool || tool.deletedAt !== null) {
      throw new ToolServiceError('not_found', 'Tool not found');
    }
    const [old] = await tx
      .select()
      .from(aiToolVersions)
      .where(and(eq(aiToolVersions.toolId, tool.id), eq(aiToolVersions.version, input.toVersion)))
      .limit(1);
    if (!old) {
      throw new ToolServiceError('not_found', 'Tool version not found');
    }
    if (tool.currentVersion >= MAX_VERSIONS_PER_TOOL) {
      throw new ToolServiceError(
        'version_limit',
        `A tool has at most ${MAX_VERSIONS_PER_TOOL} versions`,
      );
    }
    const next = tool.currentVersion + 1;
    const version = await insertVersion(tx, {
      toolId: tool.id,
      version: next,
      source: old.source,
      hosts: old.hosts,
      message,
      createdBy: input.userId,
      now,
    });
    const [updated] = await tx
      .update(aiTools)
      .set({ currentVersion: next, updatedAt: now })
      .where(eq(aiTools.id, tool.id))
      .returning();
    if (!updated) {
      throw new Error('Tool disappeared while reverting');
    }
    const [run] = await tx
      .select({ status: aiToolRuns.status })
      .from(aiToolRuns)
      .where(eq(aiToolRuns.toolId, tool.id))
      .orderBy(desc(aiToolRuns.createdAt), desc(aiToolRuns.id))
      .limit(1);
    return {
      tool: toToolDetail(updated, version, run?.status ?? null),
      version: toVersionDetail(version),
    };
  });
}

// Soft-deletes one tool by id. Idempotent: a missing id or an already
// deleted tool returns `deleted: false` and writes nothing.
export async function deleteTool(
  db: ServerDatabase,
  toolId: string,
  now: Date,
): Promise<{ deleted: boolean }> {
  const [updated] = await db
    .update(aiTools)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(aiTools.id, toolId), isNull(aiTools.deletedAt)))
    .returning();
  return { deleted: updated !== undefined };
}

// Soft-deletes every active tool of one AI in one topic. Called from
// topic-AI removal in the same transaction (the `tx` parameter is the
// caller's transaction). Returns the deleted tool ids.
export async function deleteToolsForAiInTopic(
  tx: ServerDatabase,
  input: { aiId: string; topicId: string; now: Date },
): Promise<string[]> {
  const rows = await tx
    .update(aiTools)
    .set({ deletedAt: input.now, updatedAt: input.now })
    .where(
      and(
        eq(aiTools.aiId, input.aiId),
        eq(aiTools.topicId, input.topicId),
        isNull(aiTools.deletedAt),
      ),
    )
    .returning();
  return rows.map((row) => row.id);
}

// Soft-deletes every active tool of one AI in every topic of a group.
// Called from `groups/service.ts` `removeGroupAi` in the same transaction
// (the `tx` parameter is the caller's transaction). Returns the deleted
// tool ids.
export async function deleteToolsForAiInGroup(
  tx: ServerDatabase,
  input: { aiId: string; groupId: string; now: Date },
): Promise<string[]> {
  const rows = await tx
    .update(aiTools)
    .set({ deletedAt: input.now, updatedAt: input.now })
    .where(
      and(
        eq(aiTools.aiId, input.aiId),
        eq(aiTools.groupId, input.groupId),
        isNull(aiTools.deletedAt),
      ),
    )
    .returning();
  return rows.map((row) => row.id);
}

export interface RunToolVersionDeps {
  db: ServerDatabase;
  runner: ToolRunner;
}

export interface RunToolVersionInput {
  toolId: string;
  version?: number;
  input?: unknown;
  trigger: 'manual' | 'routine' | 'ai';
}

// Runs one version (default: current) through the injected runner port and
// records an `ai_tool_runs` row in the same step. The AI must be `active`
// (the kill switch): a stopped or provisioning AI throws
// `ai_not_active` before the runner is called. A runner failure is
// recorded as `error` with its kind and returned, never thrown.
export async function runToolVersion(
  deps: RunToolVersionDeps,
  input: RunToolVersionInput,
  now: Date,
): Promise<{ result: ToolRunResult; run: PublicToolRun }> {
  const tool = await getToolRow(deps.db, input.toolId);
  if (!tool) {
    throw new ToolServiceError('not_found', 'Tool not found');
  }
  const wantVersion = input.version ?? tool.currentVersion;
  const [versionRow] = await deps.db
    .select()
    .from(aiToolVersions)
    .where(and(eq(aiToolVersions.toolId, tool.id), eq(aiToolVersions.version, wantVersion)))
    .limit(1);
  if (!versionRow) {
    throw new ToolServiceError('not_found', 'Tool version not found');
  }
  const [ai] = await deps.db
    .select({ status: ais.status })
    .from(ais)
    .where(eq(ais.id, tool.aiId))
    .limit(1);
  if (!ai || ai.status !== 'active') {
    throw new ToolServiceError('ai_not_active', 'The AI is not active');
  }
  const result = await deps.runner({
    source: versionRow.source,
    input: input.input ?? null,
    allowedHosts: versionRow.hosts,
  });
  const run = await recordRun(deps.db, {
    toolId: tool.id,
    version: versionRow.version,
    trigger: input.trigger,
    result,
    now,
  });
  return { result, run };
}

// Newest runs of a tool, newest first, capped at 20 for the public route.
// Returns null for a missing or deleted tool.
export async function listRuns(
  db: ServerDatabase,
  toolId: string,
  limit = 20,
): Promise<PublicToolRun[] | null> {
  const tool = await getToolRow(db, toolId);
  if (!tool) {
    return null;
  }
  const rows = await db
    .select()
    .from(aiToolRuns)
    .where(eq(aiToolRuns.toolId, toolId))
    .orderBy(desc(aiToolRuns.createdAt), desc(aiToolRuns.id))
    .limit(Math.max(1, Math.min(limit, 50)));
  return rows.map(toPublicRun);
}

interface InsertVersionInput {
  toolId: string;
  version: number;
  source: string;
  hosts: string[];
  message: string;
  createdBy: string;
  now: Date;
}

interface RecordSaveAuditInput {
  action: 'tool.created' | 'tool.updated';
  toolId: string;
  actorUserId: string;
  aiId: string;
  groupId: string | null;
  version: number;
  name: string;
}

// Writes the `tool.created` / `tool.updated` audit entry: actor, AI and
// chat ids, subject = the tool id looked up by name, `detail { name,
// version }`. Never source, hosts or output. The recorder swallows its
// own failures, so this never throws into the save.
async function recordSaveAudit(audit: AuditRecorder, input: RecordSaveAuditInput): Promise<void> {
  await audit.record({
    actorUserId: input.actorUserId,
    aiId: input.aiId,
    groupId: input.groupId,
    action: input.action,
    subjectId: input.toolId,
    argsHash: null,
    costCurrency: null,
    costAmount: null,
    result: 'ok',
    detail: { name: input.name, version: input.version },
  });
}

async function insertVersion(tx: ServerDatabase, input: InsertVersionInput): Promise<VersionRow> {
  const [row] = await tx
    .insert(aiToolVersions)
    .values({
      id: randomUUID(),
      toolId: input.toolId,
      version: input.version,
      source: input.source,
      hosts: input.hosts,
      message: input.message,
      createdBy: input.createdBy,
      createdAt: input.now,
    })
    .returning();
  if (!row) {
    throw new Error('Failed to insert tool version');
  }
  return row;
}

interface RecordRunInput {
  toolId: string;
  version: number;
  trigger: 'manual' | 'routine' | 'ai';
  result: ToolRunResult;
  now: Date;
}

// Inserts the run row and prunes older rows beyond the newest 50, in one
// transaction. Output text is truncated to 2 KiB (UTF-8 bytes).
async function recordRun(db: ServerDatabase, input: RecordRunInput): Promise<PublicToolRun> {
  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as ServerDatabase;
    const outputText = input.result.ok ? input.result.output.text : null;
    const [row] = await tx
      .insert(aiToolRuns)
      .values({
        id: randomUUID(),
        toolId: input.toolId,
        version: input.version,
        trigger: input.trigger,
        status: input.result.ok ? 'ok' : 'error',
        errorKind: input.result.ok ? null : input.result.error.kind,
        durationMs: input.result.durationMs,
        fetchCount: input.result.fetchCount,
        outputText: truncateBytes(outputText, MAX_RUN_OUTPUT_BYTES),
        createdAt: input.now,
      })
      .returning();
    if (!row) {
      throw new Error('Failed to record tool run');
    }
    const newest = await tx
      .select({ id: aiToolRuns.id })
      .from(aiToolRuns)
      .where(eq(aiToolRuns.toolId, input.toolId))
      .orderBy(desc(aiToolRuns.createdAt), desc(aiToolRuns.id))
      .limit(MAX_RUNS_PER_TOOL + 1);
    const keepIds = new Set(newest.slice(0, MAX_RUNS_PER_TOOL).map((kept) => kept.id));
    keepIds.add(row.id);
    const stale = newest.map((kept) => kept.id).filter((id) => !keepIds.has(id));
    if (stale.length > 0) {
      await tx
        .delete(aiToolRuns)
        .where(and(eq(aiToolRuns.toolId, input.toolId), inArray(aiToolRuns.id, stale)));
    }
    return toPublicRun(row);
  });
}

async function findActiveTool(
  db: ServerDatabase,
  aiId: string,
  topicId: string | null,
  name: string,
): Promise<ToolRow | null> {
  const [row] = await db
    .select()
    .from(aiTools)
    .where(
      topicId === null
        ? and(
            eq(aiTools.aiId, aiId),
            isNull(aiTools.topicId),
            eq(aiTools.name, name),
            isNull(aiTools.deletedAt),
          )
        : and(
            eq(aiTools.aiId, aiId),
            eq(aiTools.topicId, topicId),
            eq(aiTools.name, name),
            isNull(aiTools.deletedAt),
          ),
    )
    .limit(1);
  return row ?? null;
}

async function enforceToolLimit(
  db: ServerDatabase,
  aiId: string,
  topicId: string | null,
): Promise<void> {
  const rows = await db
    .select({ total: count() })
    .from(aiTools)
    .where(
      topicId === null
        ? and(eq(aiTools.aiId, aiId), isNull(aiTools.topicId), isNull(aiTools.deletedAt))
        : and(eq(aiTools.aiId, aiId), eq(aiTools.topicId, topicId), isNull(aiTools.deletedAt)),
    );
  if (Number(rows[0]?.total ?? 0) >= MAX_TOOLS_PER_TOPIC) {
    throw new ToolServiceError('tool_limit', `A topic has at most ${MAX_TOOLS_PER_TOPIC} tools`);
  }
}

async function getToolRow(db: ServerDatabase, toolId: string): Promise<ToolRow | null> {
  const [tool] = await db.select().from(aiTools).where(eq(aiTools.id, toolId)).limit(1);
  if (!tool || tool.deletedAt !== null) {
    return null;
  }
  return tool;
}

function hostsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((host, index) => host === b[index]);
}

function truncateBytes(value: string | null, maxBytes: number): string | null {
  if (value === null) {
    return null;
  }
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
    return value;
  }
  const buffer = Buffer.from(value, 'utf8').subarray(0, maxBytes);
  return buffer.toString('utf8');
}

function toToolDetail(
  tool: ToolRow,
  current: VersionRow,
  lastRunStatus: 'ok' | 'error' | null,
): ToolDetail {
  return {
    id: tool.id,
    aiId: tool.aiId,
    groupId: tool.groupId,
    topicId: tool.topicId,
    name: tool.name,
    description: tool.description,
    currentVersion: tool.currentVersion,
    hosts: current.hosts,
    source: current.source,
    lastRunStatus,
    updatedAt: tool.updatedAt,
  };
}

function toPublicVersion(row: VersionRow): PublicToolVersion {
  return {
    id: row.id,
    toolId: row.toolId,
    version: row.version,
    message: row.message,
    hosts: row.hosts,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

function toVersionDetail(row: VersionRow): ToolVersionDetail {
  return { ...toPublicVersion(row), source: row.source };
}

function toPublicRun(row: typeof aiToolRuns.$inferSelect): PublicToolRun {
  return {
    id: row.id,
    toolId: row.toolId,
    version: row.version,
    trigger: row.trigger,
    status: row.status,
    errorKind: row.errorKind,
    durationMs: row.durationMs,
    fetchCount: row.fetchCount,
    outputText: row.outputText,
    createdAt: row.createdAt,
  };
}

// Counts the active tools of one AI across every topic, for the route that
// lists all of an AI's tools.
export async function listToolsForAi(
  db: ServerDatabase,
  aiId: string,
): Promise<
  Array<
    PublicTool & {
      /** `personal` means the owner's DM with the AI; `group` a real group topic. */
      scope: 'personal' | 'group';
    }
  >
> {
  const rows = await db
    .select()
    .from(aiTools)
    .where(and(eq(aiTools.aiId, aiId), isNull(aiTools.deletedAt)))
    .orderBy(asc(aiTools.name));
  const result: Array<PublicTool & { scope: 'personal' | 'group' }> = [];
  for (const tool of rows) {
    const [current] = await db
      .select()
      .from(aiToolVersions)
      .where(
        and(eq(aiToolVersions.toolId, tool.id), eq(aiToolVersions.version, tool.currentVersion)),
      )
      .limit(1);
    const [run] = await db
      .select({ status: aiToolRuns.status })
      .from(aiToolRuns)
      .where(eq(aiToolRuns.toolId, tool.id))
      .orderBy(desc(aiToolRuns.createdAt), desc(aiToolRuns.id))
      .limit(1);
    result.push({
      id: tool.id,
      aiId: tool.aiId,
      groupId: tool.groupId,
      topicId: tool.topicId,
      name: tool.name,
      description: tool.description,
      currentVersion: tool.currentVersion,
      hosts: current?.hosts ?? [],
      lastRunStatus: run?.status ?? null,
      updatedAt: tool.updatedAt,
      scope: tool.groupId === null ? 'personal' : 'group',
    });
  }
  return result;
}

// How many versions a tool has (append-only count, used to assert the
// version cap without reading every row).
