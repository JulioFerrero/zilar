// Shared state, lookups and helpers for the tool and routine adapters.
import { Effect, type Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import type { Payload } from '@zilar/protocol';
import type { ActionAdapter, ActionContext } from '../actions/registry';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { listRoutinesForAi, type RoutineServiceError } from '../routines/service';
import { ToolServiceError, approveToolHosts, getTool, listTools, revokeToolHosts } from './service';
import {
  toolApproveHostsArgsSchema,
  toolRevokeHostsArgsSchema,
  type ApproveHostsBoundArgs,
} from './tool-arg-schemas';
import type { ToolRunner } from './types';

export interface BuildToolAdaptersDeps {
  db: ServerDatabase;
  runner: ToolRunner;
  // Posts as the AI; `false` = not posted.
  post: (input: {
    aiId: string;
    groupId: string | null;
    topicId?: string;
    text: string;
    payload?: Payload;
  }) => Promise<boolean>;
  now?: () => Date;
  // When false, `routine.schedule` is not registered (tools still work).
  routinesEnabled?: boolean;
  // Saves and schedules audit ids and names only — never source, output or error text.
  audit?: AuditRecorder;
}

// At most 6 `tool.run` executions per AI per chat per hour; over it the adapter answers `run limit reached, try later`.
export const TOOL_RUNS_PER_HOUR = 6;
export const TOOL_RUN_WINDOW_MS = 60 * 60 * 1000;

// A `tool.run` post is `"<name>\n<text>"` cut at 4 000 chars.
export const MAX_TOOL_POST_CHARS = 4_000;

// `tool.save`'s `modelText`: test output or error plus logs, capped at 2 KiB.
export const MAX_SAVE_MODEL_TEXT_CHARS = 2 * 1024;

export interface AdapterState {
  db: ServerDatabase;
  runner: ToolRunner;
  post: BuildToolAdaptersDeps['post'];
  now: () => Date;
  audit: AuditRecorder | undefined;
  runLimiter: RateLimiter;
}

export function createAdapterState(deps: BuildToolAdaptersDeps): AdapterState {
  const now = deps.now ?? (() => new Date());
  return {
    db: deps.db,
    runner: deps.runner,
    post: deps.post,
    now,
    audit: deps.audit,
    runLimiter: createRateLimiter({
      max: TOOL_RUNS_PER_HOUR,
      windowMs: TOOL_RUN_WINDOW_MS,
      now: () => now().getTime(),
    }),
  };
}

// A missing AI row is unexpected (the gateway denied stopped AIs) and throws into the generic `failed`.
export async function ownerOf(db: ServerDatabase, aiId: string): Promise<string> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ owner: string }>`SELECT owner FROM ais WHERE id = ${aiId} LIMIT 1`;
    }),
  );
  if (!row) {
    throw new Error('AI disappeared between the gateway check and the adapter');
  }
  return row.owner;
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function hostsLine(hosts: readonly string[]): string {
  return hosts.length === 0 ? 'no sites' : hosts.join(', ');
}

// Expected problems are an actionable summary; only unexpected exceptions reach the gateway's generic `failed`.
export function serviceFailure(error: ToolServiceError | RoutineServiceError): string {
  if (error.errorCode === 'tool_limit' || error.errorCode === 'routine_limit') {
    return error.errorCode === 'tool_limit' ? 'tool limit reached' : 'routine limit reached';
  }
  if (error.errorCode === 'version_limit') {
    return 'version limit reached';
  }
  if (error.errorCode === 'ai_not_active') {
    return 'the AI is not active';
  }
  if (error.errorCode === 'hosts_not_approved') {
    // Routine creation keeps its own hosts message; the tool approval path has its own hint.
    return 'the approved hosts must include every host the tool contacts';
  }
  if (error.errorCode === 'tool_hosts_not_approved') {
    return 'the tool hosts are not approved yet; run tool.approve_hosts first';
  }
  return error.message;
}

// One tool of this (AI, topic) by name, or null for a missing or foreign name.
export async function findToolByName(
  state: AdapterState,
  ctx: ActionContext,
  name: string,
): Promise<{ id: string; name: string; currentVersion: number } | null> {
  const tools = await listTools(state.db, {
    aiId: ctx.aiId,
    groupId: ctx.groupId,
    topicId: ctx.topicId,
  });
  return tools.find((tool) => tool.name === name) ?? null;
}

// Every routine of this (AI, topic), oldest first; personal chat has null topic on both sides.
export async function routinesInScope(state: AdapterState, ctx: ActionContext) {
  const all = await listRoutinesForAi(state.db, ctx.aiId);
  return all.filter((routine) => routine.topicId === ctx.topicId);
}

// Resolves the `{id, title}` target `routine.pause`/`routine.delete` accept: an id, its 8-character prefix, or a title.
// Ambiguity is an error summary the model can act on.
export type RoutineTarget =
  | { status: 'found'; id: string; title: string; routineStatus: string }
  | { status: 'error'; summary: string };

export async function findRoutineTarget(
  state: AdapterState,
  ctx: ActionContext,
  target: { id?: string; title?: string },
): Promise<RoutineTarget> {
  const routines = await routinesInScope(state, ctx);
  if (target.id !== undefined) {
    const id = target.id;
    const exact = routines.find((routine) => routine.id === id);
    if (exact !== undefined) {
      return { status: 'found', id: exact.id, title: exact.title, routineStatus: exact.status };
    }
    const prefixed = routines.filter((routine) => routine.id.startsWith(id));
    if (prefixed.length === 0) {
      return { status: 'error', summary: 'no such routine' };
    }
    if (prefixed.length > 1) {
      const ids = prefixed.map((routine) => routine.id).join(', ');
      return {
        status: 'error',
        summary: `that id matches several routines: ${ids}; use the full id`,
      };
    }
    const match = prefixed[0] as { id: string; title: string; status: string };
    return { status: 'found', id: match.id, title: match.title, routineStatus: match.status };
  }
  const title = target.title as string;
  const matches = routines.filter((routine) => routine.title === title);
  if (matches.length === 0) {
    return { status: 'error', summary: 'no such routine' };
  }
  if (matches.length > 1) {
    const ids = matches.map((routine) => routine.id).join(', ');
    return {
      status: 'error',
      summary: `several routines are called "${title}": ids ${ids}; use id`,
    };
  }
  const match = matches[0] as { id: string; title: string; status: string };
  return { status: 'found', id: match.id, title: match.title, routineStatus: match.status };
}

// True when a live, active routine with this title already exists in scope, so the schedule creates nothing.
export async function activeRoutineWithTitleExists(
  state: AdapterState,
  ctx: ActionContext,
  title: string,
): Promise<boolean> {
  const routines = await routinesInScope(state, ctx);
  return routines.some((routine) => routine.title === title && routine.status === 'active');
}

export function hostsEqualAsSets(current: readonly string[], approved: readonly string[]): boolean {
  if (current.length !== approved.length) {
    return false;
  }
  const allowed = new Set(approved);
  return current.every((host) => allowed.has(host));
}

export function isSubsetOf(current: readonly string[], approved: readonly string[]): boolean {
  const allowed = new Set(approved);
  return current.every((host) => allowed.has(host));
}

// `tool.approve_hosts` (tier 2): the model names the tool; `prepareArgs` binds the current version's hosts before the hash and card.
// `execute` approves fail-safe: if the current hosts differ from the card's set, it does nothing and fails.
export function toolApproveHostsAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'tool.approve_hosts',
    description: 'Allow a tool in this topic to contact its declared hosts (needs approval).',
    tier: 2,
    argsExample: '{"name":"daily-report"}',
    argsSchema: toolApproveHostsArgsSchema as unknown as Schema.Codec<unknown, unknown, never>,
    prepareArgs: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as { name: string };
      const found = await findToolByName(state, actionCtx, parsed.name);
      if (!found) {
        throw new Error('no such tool');
      }
      const detail = await getTool(state.db, found.id);
      if (!detail) {
        throw new Error('no such tool');
      }
      return { name: parsed.name, hosts: [...detail.hosts] };
    },
    describe: (args) => {
      const parsed = args as ApproveHostsBoundArgs;
      return {
        summary: `Allow "${parsed.name}" to use the web`,
        details: `The tool ${parsed.name} may contact: ${hostsLine(parsed.hosts)}. Approving replaces the tool's approved hosts with exactly this set.`,
      };
    },
    execute: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as ApproveHostsBoundArgs;
      const found = await findToolByName(state, actionCtx, parsed.name);
      if (!found) {
        throw new Error('tool hosts changed after the approval card was shown');
      }
      // Fail safe: a save after the card means nothing is approved; the throw becomes the generic `failed`.
      const detail = await getTool(state.db, found.id);
      if (!detail || !hostsEqualAsSets(detail.hosts, parsed.hosts)) {
        throw new Error('tool hosts changed after the approval card was shown');
      }
      const owner = await ownerOf(state.db, actionCtx.aiId);
      try {
        const approved = await approveToolHosts(
          state.db,
          { toolId: found.id, hosts: parsed.hosts, userId: owner },
          state.now(),
          ...(state.audit === undefined ? [] : ([state.audit] as const)),
        );
        return {
          summary: `approved ${approved.name} to contact: ${hostsLine(approved.approvedHosts)}`,
        };
      } catch (error) {
        if (error instanceof ToolServiceError) {
          if (error.errorCode === 'not_found') {
            throw new Error('tool hosts changed after the approval card was shown');
          }
          return { summary: serviceFailure(error) };
        }
        throw error;
      }
    },
  };
}

// `tool.revoke_hosts` (tier 1) empties the set; the tool keeps working without network. Audits ids and the name only.
export function toolRevokeHostsAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'tool.revoke_hosts',
    description: "Revoke a tool's approved hosts in this topic (it keeps running offline).",
    tier: 1,
    argsExample: '{"name":"daily-report"}',
    argsSchema: toolRevokeHostsArgsSchema as unknown as Schema.Codec<unknown, unknown, never>,
    describe: (args) => {
      const parsed = args as { name: string };
      return { summary: `Revoke the approved hosts of the tool "${parsed.name}"` };
    },
    execute: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as { name: string };
      const found = await findToolByName(state, actionCtx, parsed.name);
      if (!found) {
        return { summary: 'no such tool' };
      }
      const owner = await ownerOf(state.db, actionCtx.aiId);
      try {
        const revoked = await revokeToolHosts(
          state.db,
          { toolId: found.id, userId: owner },
          state.now(),
          ...(state.audit === undefined ? [] : ([state.audit] as const)),
        );
        return { summary: `revoked the approved hosts of "${revoked.name}"` };
      } catch (error) {
        if (error instanceof ToolServiceError) {
          if (error.errorCode === 'not_found') {
            return { summary: 'no such tool' };
          }
          return { summary: serviceFailure(error) };
        }
        throw error;
      }
    },
  };
}
