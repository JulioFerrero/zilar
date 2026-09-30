// T-0105: tool and routine adapters for the action gateway. The AI uses
// the versioned tools store (T-0103) and the routines scheduler (T-0104)
// only through these adapters, so the gateway's policy (the AI's id and
// chat come from the session), kill switch, audit log and approval cards
// all apply with no new special cases.
//
// Scope is (AI, topic): every lookup is within `ctx.aiId` + `ctx.topicId`,
// and `tool.run` and routine posts go into that topic's room. A tool of
// another chat or AI is invisible (a plain summary, never a throw).
//
// `created_by` for tools and routines is the AI's owner: the gateway does
// not carry the human who asked yet, so the owner is the only stable
// attribution available.
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ActionAdapter, ActionContext } from '../actions/registry';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { ais } from '../db/schema';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import {
  createRoutine,
  deleteRoutine,
  listRoutinesForAi,
  MAX_ROUTINE_INPUT_BYTES,
  MAX_ROUTINE_TITLE_CHARS,
  pauseRoutine,
  RoutineServiceError,
} from '../routines/service';
import { nextRunAfter, routineScheduleSchema, type RoutineSchedule } from '../routines/schedule';
import { toolHostsSchema, toolNameSchema, toolVersionInputSchema } from './schemas';
import {
  getTool,
  getVersion,
  listTools,
  revertTool,
  runToolVersion,
  saveToolVersion,
  ToolServiceError,
} from './service';
import type { ToolRunner } from './types';

export interface BuildToolAdaptersDeps {
  db: ServerDatabase;
  runner: ToolRunner;
  /** Posts as the AI (`postToChat` in production). `false` = not posted. */
  post: (input: {
    aiId: string;
    groupId: string | null;
    topicId?: string;
    text: string;
  }) => Promise<boolean>;
  now?: () => Date;
  /** When false, `routine.schedule` is not registered (tools still work). */
  routinesEnabled?: boolean;
  /** Passed to the tools/routines services so saves and schedules audit
   *  ids and names only — never source, output or error text. */
  audit?: AuditRecorder;
}

// At most 6 `tool.run` executions per AI per chat per hour. Over the cap
// the adapter answers `run limit reached, try later` without running.
export const TOOL_RUNS_PER_HOUR = 6;
export const TOOL_RUN_WINDOW_MS = 60 * 60 * 1000;

// `tool.run` (and the tools HTTP route) refuse an `input` that serialises
// past 16 KiB.
export const MAX_TOOL_INPUT_BYTES = 16 * 1024;

// A `tool.run` post is `"<name>\n<text>"` cut at 4 000 chars, like the
// routine posts in `routines/execute.ts`.
export const MAX_TOOL_POST_CHARS = 4_000;

// `tool.save`'s `modelText`: the test run's output text or its error
// message plus captured logs, capped at 2 KiB.
export const MAX_SAVE_MODEL_TEXT_CHARS = 2 * 1024;

// Builds the eight tool/routine adapters. The caller registers them in the
// action registry next to (not instead of) the demo adapter.
export function buildToolAdapters(deps: BuildToolAdaptersDeps): ActionAdapter<unknown>[] {
  const state = createAdapterState(deps);
  const adapters: ActionAdapter<unknown>[] = [
    toolListAdapter(state),
    toolReadAdapter(state),
    toolSaveAdapter(state),
    toolRunAdapter(state),
    toolRevertAdapter(state),
    routinePauseAdapter(state),
    routineDeleteAdapter(state),
  ];
  if (deps.routinesEnabled !== false) {
    adapters.push(routineScheduleAdapter(state));
  }
  return adapters;
}

interface AdapterState {
  db: ServerDatabase;
  runner: ToolRunner;
  post: BuildToolAdaptersDeps['post'];
  now: () => Date;
  audit: AuditRecorder | undefined;
  runLimiter: RateLimiter;
}

function createAdapterState(deps: BuildToolAdaptersDeps): AdapterState {
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

// The AI's owner id. The gateway already denied stopped AIs before
// `execute`, so a missing row is unexpected and throws (the gateway's
// generic `failed`, never a leak).
async function ownerOf(db: ServerDatabase, aiId: string): Promise<string> {
  const [row] = await db.select({ owner: ais.owner }).from(ais).where(eq(ais.id, aiId)).limit(1);
  if (!row) {
    throw new Error('AI disappeared between the gateway check and the adapter');
  }
  return row.owner;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function hostsLine(hosts: readonly string[]): string {
  return hosts.length === 0 ? 'no sites' : hosts.join(', ');
}

function truncateChars(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// `schedule` in words for cards, lists and summaries, e.g. `every 6 hours`
// or `daily at 09:00 Europe/Madrid on Mon, Wed, Fri`.
export function describeSchedule(schedule: RoutineSchedule): string {
  if (schedule.kind === 'interval') {
    const minutes = schedule.everyMinutes;
    if (minutes % 1440 === 0) {
      return `every ${plural(minutes / 1440, 'day')}`;
    }
    if (minutes % 60 === 0) {
      return `every ${plural(minutes / 60, 'hour')}`;
    }
    return `every ${plural(minutes, 'minute')}`;
  }
  const weekdays = schedule.weekdays ?? [1, 2, 3, 4, 5, 6, 7];
  const allDays = weekdays.length === 7;
  const days = allDays
    ? ''
    : ` on ${[...weekdays]
        .sort((a, b) => a - b)
        .map((day) => WEEKDAY_SHORT[day - 1])
        .join(', ')}`;
  return `daily at ${schedule.time} ${schedule.timezone}${days}`;
}

// The routine's next run as an ISO time in the schedule's zone (daily) or
// a plain UTC ISO instant (interval, which has no zone).
export function formatNextRun(schedule: RoutineSchedule, at: Date): string {
  if (schedule.kind !== 'daily') {
    return at.toISOString();
  }
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: schedule.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
    const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '00';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')} (${schedule.timezone})`;
  } catch {
    return at.toISOString();
  }
}

// Every adapter returns expected problems as a summary the model can act
// on; only unexpected exceptions propagate to the gateway's generic
// `failed`. Service error messages carry constraint text, never tool
// source, output or fetched strings, so they are safe to surface.
function serviceFailure(error: ToolServiceError | RoutineServiceError): string {
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
    return 'the approved hosts must include every host the tool contacts';
  }
  return error.message;
}

function serialisedSize(value: unknown): number | null {
  let serialised: string;
  try {
    serialised = JSON.stringify(value) ?? 'null';
  } catch {
    return null;
  }
  return Buffer.byteLength(serialised, 'utf8');
}

// Shared `input` field for `tool.run` (16 KiB) and `routine.schedule`
// (2 KiB, the routines service limit): oversize input fails the adapter's
// schema, so the gateway denies `invalid_args` before `execute` runs.
function inputField(maxBytes: number): z.ZodType<unknown> {
  return z.unknown().refine(
    (value) => {
      if (value === undefined) {
        return true;
      }
      const size = serialisedSize(value);
      return size !== null && size <= maxBytes;
    },
    { message: `input must serialise to at most ${maxBytes} bytes` },
  );
}

// One tool of this (AI, topic) by name, or null for a missing name —
// including a tool that belongs to another chat or AI, which `listTools`
// never returns.
async function findToolByName(
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

// Every routine of this (AI, topic), oldest first. Personal chat =
// `topicId` null on both sides; group chat = exact topic match.
async function routinesInScope(state: AdapterState, ctx: ActionContext) {
  const all = await listRoutinesForAi(state.db, ctx.aiId);
  return all.filter((routine) => routine.topicId === ctx.topicId);
}

async function findRoutineByTitle(
  state: AdapterState,
  ctx: ActionContext,
  title: string,
): Promise<
  | { status: 'missing' }
  | { status: 'ambiguous' }
  | { status: 'found'; id: string; title: string; routineStatus: string }
> {
  const matches = (await routinesInScope(state, ctx)).filter((routine) => routine.title === title);
  if (matches.length === 0) {
    return { status: 'missing' };
  }
  if (matches.length > 1) {
    return { status: 'ambiguous' };
  }
  const match = matches[0] as { id: string; title: string; status: string };
  return { status: 'found', id: match.id, title: match.title, routineStatus: match.status };
}

const toolListArgsSchema = z.object({}).strict();

const toolReadArgsSchema = z
  .object({
    name: toolNameSchema,
    version: z.number().int().min(1).optional(),
  })
  .strict();

const toolSaveArgsSchema = toolVersionInputSchema.strict();

const toolRunArgsSchema = z
  .object({
    name: toolNameSchema,
    input: inputField(MAX_TOOL_INPUT_BYTES).optional(),
  })
  .strict();

const toolRevertArgsSchema = z
  .object({
    name: toolNameSchema,
    toVersion: z.number().int().min(1),
  })
  .strict();

const routineTitleSchema = z
  .string()
  .min(1, { message: 'title must not be empty' })
  .max(MAX_ROUTINE_TITLE_CHARS, {
    message: `title must be at most ${MAX_ROUTINE_TITLE_CHARS} characters`,
  });

const routineScheduleArgsSchema = z
  .object({
    tool: toolNameSchema,
    title: routineTitleSchema,
    schedule: routineScheduleSchema,
    hosts: toolHostsSchema,
    input: inputField(MAX_ROUTINE_INPUT_BYTES).optional(),
  })
  .strict();

const routineTitleArgsSchema = z
  .object({
    title: routineTitleSchema,
  })
  .strict();

function toolListAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'tool.list',
    description: 'List the tools and routines in this topic, with versions, hosts and schedules.',
    tier: 0,
    argsSchema: toolListArgsSchema as unknown as z.ZodType<unknown>,
    describe: () => ({ summary: 'List the tools and routines in this topic' }),
    execute: async (ctx, _args) => {
      const actionCtx = ctx as ActionContext;
      const tools = await listTools(state.db, {
        aiId: actionCtx.aiId,
        groupId: actionCtx.groupId,
        topicId: actionCtx.topicId,
      });
      const routines = await routinesInScope(state, actionCtx);
      const toolLines = tools.map(
        (tool) =>
          `- ${tool.name} v${tool.currentVersion}: ${tool.description} (${hostsLine(tool.hosts)})`,
      );
      const routineLines = routines.map(
        (routine) =>
          `- ${routine.title}: runs ${routine.toolName}, ${describeSchedule(routine.schedule)} [${routine.status}]`,
      );
      const lines = [...toolLines, ...routineLines];
      return {
        summary: `${plural(tools.length, 'tool')}, ${plural(routines.length, 'routine')}`,
        modelText: lines.length === 0 ? 'No tools or routines in this topic.' : lines.join('\n'),
      };
    },
  };
}

function toolReadAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'tool.read',
    description: "Read one tool's source and hosts in this topic, optionally at an older version.",
    tier: 0,
    argsSchema: toolReadArgsSchema as unknown as z.ZodType<unknown>,
    describe: (args) => {
      const parsed = args as { name: string; version?: number };
      return {
        summary:
          parsed.version === undefined
            ? `Read the tool "${parsed.name}"`
            : `Read the tool "${parsed.name}" at v${parsed.version}`,
      };
    },
    execute: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as { name: string; version?: number };
      const found = await findToolByName(state, actionCtx, parsed.name);
      if (!found) {
        return { summary: 'no such tool' };
      }
      if (parsed.version === undefined) {
        const tool = await getTool(state.db, found.id);
        if (!tool) {
          return { summary: 'no such tool' };
        }
        return {
          summary: `${tool.name} v${tool.currentVersion}`,
          modelText: `${tool.name} v${tool.currentVersion} (hosts: ${hostsLine(tool.hosts)})\n${tool.source}`,
        };
      }
      const version = await getVersion(state.db, found.id, parsed.version);
      if (!version) {
        return { summary: 'no such version' };
      }
      return {
        summary: `${found.name} v${version.version}`,
        modelText: `${found.name} v${version.version} (hosts: ${hostsLine(version.hosts)})\n${version.source}`,
      };
    },
  };
}

function toolSaveAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'tool.save',
    description: 'Save a new version of a tool in this topic and test-run it in the sandbox.',
    tier: 1,
    argsSchema: toolSaveArgsSchema as unknown as z.ZodType<unknown>,
    describe: (args) => {
      const parsed = args as { name: string };
      return { summary: `Save the tool "${parsed.name}"` };
    },
    execute: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as {
        name: string;
        description: string;
        source: string;
        hosts: string[];
        message: string;
      };
      const owner = await ownerOf(state.db, actionCtx.aiId);
      let saved;
      try {
        saved = await saveToolVersion(
          state.db,
          {
            aiId: actionCtx.aiId,
            groupId: actionCtx.groupId,
            topicId: actionCtx.topicId,
            name: parsed.name,
            description: parsed.description,
            source: parsed.source,
            hosts: parsed.hosts,
            message: parsed.message,
            userId: owner,
          },
          state.now(),
          ...(state.audit === undefined ? [] : ([state.audit] as const)),
        );
      } catch (error) {
        if (error instanceof ToolServiceError) {
          return { summary: serviceFailure(error) };
        }
        throw error;
      }
      const head = `saved ${saved.tool.name} v${saved.version.version}`;
      if (saved.unchanged) {
        return { summary: `${head} (unchanged)` };
      }
      // The save itself is never rolled back when the test run fails: the
      // model fixes the code in the next call.
      let testSummary: string;
      let testText: string;
      try {
        const { result } = await runToolVersion(
          { db: state.db, runner: state.runner },
          {
            toolId: saved.tool.id,
            version: saved.version.version,
            input: null,
            trigger: 'ai',
          },
          state.now(),
        );
        if (result.ok) {
          testSummary = 'test run ok';
          testText = result.output.text;
        } else {
          testSummary = `test run failed: ${result.error.kind}`;
          testText =
            result.logs === '' ? result.error.message : `${result.error.message}\n${result.logs}`;
        }
      } catch (error) {
        if (error instanceof ToolServiceError) {
          return { summary: `${head}: test run failed: ${error.errorCode}` };
        }
        throw error;
      }
      return {
        summary: `${head}: ${testSummary}`,
        modelText: truncateChars(testText, MAX_SAVE_MODEL_TEXT_CHARS),
      };
    },
  };
}

function toolRunAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'tool.run',
    description: "Run this topic's tool now and post its output into the topic.",
    tier: 1,
    argsSchema: toolRunArgsSchema as unknown as z.ZodType<unknown>,
    describe: (args) => {
      const parsed = args as { name: string };
      return { summary: `Run the tool "${parsed.name}"` };
    },
    execute: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as { name: string; input?: unknown };
      const key = `${actionCtx.aiId}\n${actionCtx.groupId ?? ''}\n${actionCtx.topicId ?? ''}`;
      if (!state.runLimiter.allow(key)) {
        return { summary: 'run limit reached, try later' };
      }
      const found = await findToolByName(state, actionCtx, parsed.name);
      if (!found) {
        return { summary: 'no such tool' };
      }
      let ran;
      try {
        ran = await runToolVersion(
          { db: state.db, runner: state.runner },
          {
            toolId: found.id,
            input: parsed.input ?? null,
            trigger: 'ai',
          },
          state.now(),
        );
      } catch (error) {
        if (error instanceof ToolServiceError) {
          if (error.errorCode === 'not_found') {
            return { summary: 'no such tool' };
          }
          return { summary: serviceFailure(error) };
        }
        throw error;
      }
      if (!ran.result.ok) {
        const failure = ran.result;
        return {
          summary: failure.error.kind,
          modelText:
            failure.logs === ''
              ? failure.error.message
              : `${failure.error.message}\n${failure.logs}`,
        };
      }
      const text = ran.result.output.text;
      // The live example the user sees: the output posted as the AI into
      // the topic. A `false` answer (stopped AI, left room) still returns
      // the normal result — delivery is best-effort.
      try {
        await state.post({
          aiId: actionCtx.aiId,
          groupId: actionCtx.groupId,
          ...(actionCtx.topicId === null ? {} : { topicId: actionCtx.topicId }),
          text: `${found.name}\n${truncateChars(text, MAX_TOOL_POST_CHARS)}`,
        });
      } catch {
        // Best-effort like the gateway announcer: a throwing chat layer
        // never turns a good run into a failure.
      }
      return { summary: 'ok', modelText: text };
    },
  };
}

function toolRevertAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'tool.revert',
    description: 'Revert a tool in this topic to an older version (appends a new version).',
    tier: 1,
    argsSchema: toolRevertArgsSchema as unknown as z.ZodType<unknown>,
    describe: (args) => {
      const parsed = args as { name: string; toVersion: number };
      return { summary: `Revert the tool "${parsed.name}" to v${parsed.toVersion}` };
    },
    execute: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as { name: string; toVersion: number };
      const found = await findToolByName(state, actionCtx, parsed.name);
      if (!found) {
        return { summary: 'no such tool' };
      }
      const old = await getVersion(state.db, found.id, parsed.toVersion);
      if (!old) {
        return { summary: 'no such version' };
      }
      const owner = await ownerOf(state.db, actionCtx.aiId);
      try {
        const { tool } = await revertTool(
          state.db,
          { toolId: found.id, toVersion: parsed.toVersion, userId: owner },
          state.now(),
        );
        return {
          summary: `reverted ${tool.name} to v${parsed.toVersion} (now v${tool.currentVersion})`,
        };
      } catch (error) {
        if (error instanceof ToolServiceError) {
          if (error.errorCode === 'not_found') {
            return { summary: 'no such version' };
          }
          return { summary: serviceFailure(error) };
        }
        throw error;
      }
    },
  };
}

function routineScheduleAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'routine.schedule',
    description:
      'Schedule a routine in this topic that runs a tool and posts the result here (needs approval).',
    tier: 2,
    argsSchema: routineScheduleArgsSchema as unknown as z.ZodType<unknown>,
    describe: (args) => {
      const parsed = args as {
        tool: string;
        title: string;
        schedule: RoutineSchedule;
        hosts: string[];
      };
      return {
        summary: `Schedule "${parsed.title}": ${describeSchedule(parsed.schedule)}`,
        details: `Runs tool ${parsed.tool} and posts the result here. It will contact: ${hostsLine(parsed.hosts)}.`,
      };
    },
    execute: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as {
        tool: string;
        title: string;
        schedule: unknown;
        hosts: string[];
        input?: unknown;
      };
      const found = await findToolByName(state, actionCtx, parsed.tool);
      if (!found) {
        return { summary: 'no such tool' };
      }
      // Fail safe: the card showed `hosts`, so the tool's current version
      // must still contact exactly that set. A code change after the card
      // means nothing runs — the throw becomes the gateway's generic
      // `failed`, which the model hears as "the action failed".
      const detail = await getTool(state.db, found.id);
      if (!detail || !hostsEqualAsSets(detail.hosts, parsed.hosts)) {
        throw new Error('tool hosts changed after the approval card was shown');
      }
      const owner = await ownerOf(state.db, actionCtx.aiId);
      try {
        const created = await createRoutine(
          state.db,
          {
            aiId: actionCtx.aiId,
            groupId: actionCtx.groupId,
            topicId: actionCtx.topicId,
            toolId: found.id,
            title: parsed.title,
            schedule: parsed.schedule,
            ...(parsed.input === undefined ? {} : { input: parsed.input }),
            approvedHosts: parsed.hosts,
            userId: owner,
          },
          state.now(),
          ...(state.audit === undefined ? [] : ([state.audit] as const)),
        );
        const next = nextRunAfter(created.schedule, state.now());
        return {
          summary: `Scheduled "${created.title}"; next run ${formatNextRun(created.schedule, next)}`,
        };
      } catch (error) {
        if (error instanceof RoutineServiceError) {
          return { summary: serviceFailure(error) };
        }
        throw error;
      }
    },
  };
}

function routinePauseAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'routine.pause',
    description: 'Pause a routine in this topic so it stops running.',
    tier: 1,
    argsSchema: routineTitleArgsSchema as unknown as z.ZodType<unknown>,
    describe: (args) => {
      const parsed = args as { title: string };
      return { summary: `Pause the routine "${parsed.title}"` };
    },
    execute: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as { title: string };
      const found = await findRoutineByTitle(state, actionCtx, parsed.title);
      if (found.status === 'missing') {
        return { summary: 'no such routine' };
      }
      if (found.status === 'ambiguous') {
        return { summary: 'ambiguous routine title' };
      }
      if (found.routineStatus !== 'active') {
        return { summary: `already paused "${found.title}"` };
      }
      const owner = await ownerOf(state.db, actionCtx.aiId);
      try {
        await pauseRoutine(
          state.db,
          found.id,
          owner,
          state.now(),
          ...(state.audit === undefined ? [] : ([state.audit] as const)),
        );
        return { summary: `paused "${found.title}"` };
      } catch (error) {
        if (error instanceof RoutineServiceError) {
          return { summary: serviceFailure(error) };
        }
        throw error;
      }
    },
  };
}

function routineDeleteAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'routine.delete',
    description: 'Delete a routine in this topic.',
    tier: 1,
    argsSchema: routineTitleArgsSchema as unknown as z.ZodType<unknown>,
    describe: (args) => {
      const parsed = args as { title: string };
      return { summary: `Delete the routine "${parsed.title}"` };
    },
    execute: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as { title: string };
      const found = await findRoutineByTitle(state, actionCtx, parsed.title);
      if (found.status === 'missing') {
        return { summary: 'no such routine' };
      }
      if (found.status === 'ambiguous') {
        return { summary: 'ambiguous routine title' };
      }
      const owner = await ownerOf(state.db, actionCtx.aiId);
      try {
        await deleteRoutine(
          state.db,
          found.id,
          owner,
          state.now(),
          ...(state.audit === undefined ? [] : ([state.audit] as const)),
        );
        return { summary: `deleted "${found.title}"` };
      } catch (error) {
        if (error instanceof RoutineServiceError) {
          return { summary: serviceFailure(error) };
        }
        throw error;
      }
    },
  };
}

function hostsEqualAsSets(current: readonly string[], approved: readonly string[]): boolean {
  if (current.length !== approved.length) {
    return false;
  }
  const allowed = new Set(approved);
  return current.every((host) => allowed.has(host));
}
