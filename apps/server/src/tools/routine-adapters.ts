// effect-plain: routine adapter definitions
// The `routine.*` adapters and schedule formatting.
import { Option, Schema, Effect } from 'effect';
import { BlocksDataSchema } from '@zilar/protocol';
import type { ActionAdapter, ActionContext } from '../actions/registry';
import { findCard } from '../message-blocks/cards';
import { nextRunAfter, type RoutineSchedule } from '../routines/schedule';
import {
  MAX_ROUTINE_PROMPT_CHARS,
  RoutineServiceError,
  type CreatePromptRoutineInput,
  type PublicRoutine,
} from '../routines/schemas';
import {
  createRoutine,
  deleteRoutine,
  insertRoutineRow,
  parseRoutineBasics,
  pauseRoutine,
} from '../routines/support';
import {
  activeRoutineWithTitleExists,
  findRoutineTarget,
  findToolByName,
  hostsEqualAsSets,
  hostsLine,
  isSubsetOf,
  ownerOf,
  plural,
  serviceFailure,
  type AdapterState,
} from './adapter-support';
import { routineScheduleArgsSchema, routineTargetArgsSchema } from './tool-arg-schemas';
import { randomUUID } from 'node:crypto';
import { SqlClient } from 'effect/sql';
import type { AuditRecorder } from '../audit/recorder';
import type { ServerDatabase } from '../db/client';
import { enforceRoutineLimit, toPublicRoutine } from '../routines/queries';
import { getTool } from './queries';
import { type RoutineRow } from '../db/rows-agents';

// Creates a `kind = 'prompt'` routine: no tool and no hosts.
// Validates title, schedule and prompt; enforces the same 10-per-topic limit as a tool routine and audits ids only.
export async function createPromptRoutine(
  db: ServerDatabase,
  input: CreatePromptRoutineInput,
  now: Date,
  audit?: AuditRecorder,
): Promise<PublicRoutine> {
  const { title, schedule } = parseRoutineBasics(input);
  const prompt = input.prompt.trim();
  if (prompt.length < 1) {
    throw new RoutineServiceError('invalid_request', 'prompt must not be empty');
  }
  if (prompt.length > MAX_ROUTINE_PROMPT_CHARS) {
    throw new RoutineServiceError(
      'invalid_request',
      `prompt must be at most ${MAX_ROUTINE_PROMPT_CHARS} characters`,
    );
  }
  await enforceRoutineLimit(db, input.aiId, input.topicId);
  const nextRunAt = nextRunAfter(schedule, now);
  const inserted = await insertRoutineRow(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<RoutineRow>`INSERT INTO routines (
            id, ai_id, group_id, topic_id, kind, tool_id, prompt, title, schedule,
            input, alert_card_id, alert_block_id, approved_hosts, status,
            paused_reason, next_run_at, last_run_at, last_status,
            consecutive_failures, created_by, created_at, updated_at, deleted_at
          ) VALUES (
            ${randomUUID()}, ${input.aiId}, ${input.groupId}, ${input.topicId},
            'prompt', NULL, ${prompt}, ${title},
            ${JSON.stringify(schedule)}::jsonb, NULL,
            ${input.alertCard?.cardId ?? null}, ${input.alertCard?.blockId ?? null},
            '[]'::jsonb, 'active', NULL, ${nextRunAt.toISOString()}, NULL, NULL, 0,
            ${input.userId}, ${now.toISOString()}, ${now.toISOString()}, NULL
          )
          RETURNING *`;
    }),
    'Failed to create prompt routine',
  );
  if (audit !== undefined) {
    await audit.record({
      actorUserId: input.userId,
      aiId: input.aiId,
      groupId: input.groupId,
      action: 'routine.created',
      subjectId: inserted.id,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: { kind: 'prompt', ...(input.alertCard === undefined ? {} : { alertCard: true }) },
    });
  }
  return toPublicRoutine(inserted, '', schedule);
}
const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// The approval card shows at most this many characters of a prompt; the full prompt stays in the row.
const MAX_PROMPT_CARD_CHARS = 500;

function promptForCard(prompt: string): string {
  return prompt.length <= MAX_PROMPT_CARD_CHARS
    ? prompt
    : `${prompt.slice(0, MAX_PROMPT_CARD_CHARS)}…`;
}

// Turns a `RoutineServiceError` into a summary; any other failure throws.
async function serviceSummary(run: () => Promise<string>): Promise<{ summary: string }> {
  try {
    return { summary: await run() };
  } catch (error) {
    if (error instanceof RoutineServiceError) {
      return { summary: serviceFailure(error) };
    }
    throw error;
  }
}

// Shared tail: create the routine, then answer with its title and next run.
function scheduledSummary(
  created: Promise<{ title: string; schedule: RoutineSchedule }>,
  now: Date,
): Promise<{ summary: string }> {
  return serviceSummary(async () => {
    const routine = await created;
    return `Scheduled "${routine.title}"; next run ${formatNextRun(routine.schedule, nextRunAfter(routine.schedule, now))}`;
  });
}

// `schedule` in words for cards and lists, e.g. `every 6 hours`.
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

// The next run as an ISO time in the schedule's zone (daily) or a UTC instant (interval).
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

interface AlertCardArgs {
  card: string;
  block: string;
}

// The card must be this AI's, in this chat, and hold the named `alert` block; every failure answers the same message.
async function requireOwnAlertCard(
  state: AdapterState,
  actionCtx: ActionContext,
  alertCard: AlertCardArgs,
): Promise<void> {
  const row = await findCard(state.db, alertCard.card);
  const decoded =
    row === null ? Option.none() : Schema.decodeUnknownOption(BlocksDataSchema)(row.data);
  const hasBlock =
    Option.isSome(decoded) &&
    decoded.value.blocks.some((block) => block.kind === 'alert' && block.id === alertCard.block);
  if (
    row === null ||
    row.aiId !== actionCtx.aiId ||
    row.groupId !== actionCtx.groupId ||
    row.topicId !== actionCtx.topicId ||
    !hasBlock
  ) {
    throw new Error('no such alert card');
  }
}

function alertCardLink(args: {
  alert_card?: AlertCardArgs;
}): { cardId: string; blockId: string } | undefined {
  return args.alert_card === undefined
    ? undefined
    : { cardId: args.alert_card.card, blockId: args.alert_card.block };
}

export function routineScheduleAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'routine.schedule',
    description:
      'Schedule a routine (needs approval). Prefer the saved-tool form when a saved tool does the job: {"title":"Prices","schedule":{"kind":"interval","everyMinutes":5},"tool":"market-prices"}',
    tier: 2,
    argsExample:
      '{"title":"Release notes digest","schedule":{"kind":"interval","everyMinutes":120},"prompt":"Summarise the release notes posted in this chat since the last run."}',
    argsSchema: routineScheduleArgsSchema as unknown as Schema.Codec<unknown, unknown, never>,
    // The tool form may omit `hosts`; bind the saved tool's current hosts before the hash and card.
    prepareArgs: async (ctx, args) => {
      const parsed = args as {
        tool?: string;
        hosts?: string[];
        prompt?: string;
        alert_card?: AlertCardArgs;
      };
      const actionCtx = ctx as ActionContext;
      if (parsed.alert_card !== undefined) {
        await requireOwnAlertCard(state, actionCtx, parsed.alert_card);
      }
      if (parsed.prompt !== undefined || parsed.tool === undefined || parsed.hosts !== undefined) {
        return args;
      }
      const found = await findToolByName(state, actionCtx, parsed.tool);
      if (!found) {
        throw new Error('no such tool');
      }
      const detail = await getTool(state.db, found.id);
      if (!detail) {
        throw new Error('no such tool');
      }
      return { ...parsed, hosts: [...detail.hosts] };
    },
    describe: (args) => {
      const parsed = args as {
        tool: string;
        title: string;
        schedule: RoutineSchedule;
        hosts: string[];
        prompt?: string;
        alert_card?: AlertCardArgs;
      };
      const summary = `${parsed.title} · ${describeSchedule(parsed.schedule)}`;
      const alertNote =
        parsed.alert_card === undefined
          ? ''
          : ' It also links the alert card above, so its switch and threshold drive this routine.';
      if (parsed.prompt !== undefined) {
        return {
          summary,
          details: `Runs this prompt on that schedule and posts my answer here: "${promptForCard(parsed.prompt)}"${alertNote}`,
        };
      }
      return {
        summary,
        details: `Runs tool ${parsed.tool} and posts the result here. It will contact: ${hostsLine(parsed.hosts)}.${alertNote}`,
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
        prompt?: string;
        alert_card?: AlertCardArgs;
      };
      const alertCard = alertCardLink(parsed);
      // A second approval for the same title creates nothing and says so.
      if (await activeRoutineWithTitleExists(state, actionCtx, parsed.title)) {
        return { summary: `a routine called "${parsed.title}" already exists here` };
      }
      // The prompt form needs no tool or hosts check; it creates a `kind = 'prompt'` routine.
      if (parsed.prompt !== undefined) {
        const owner = await ownerOf(state.db, actionCtx.aiId);
        return scheduledSummary(
          createPromptRoutine(
            state.db,
            {
              aiId: actionCtx.aiId,
              groupId: actionCtx.groupId,
              topicId: actionCtx.topicId,
              title: parsed.title,
              schedule: parsed.schedule,
              prompt: parsed.prompt,
              userId: owner,
              ...(alertCard === undefined ? {} : { alertCard }),
            },
            state.now(),
            ...(state.audit === undefined ? [] : ([state.audit] as const)),
          ),
          state.now(),
        );
      }
      const found = await findToolByName(state, actionCtx, parsed.tool);
      if (!found) {
        return { summary: 'no such tool' };
      }
      // Fail safe: a code change after the card means nothing runs.
      const detail = await getTool(state.db, found.id);
      if (!detail || !hostsEqualAsSets(detail.hosts, parsed.hosts)) {
        throw new Error('tool hosts changed after the approval card was shown');
      }
      // Every card host must be in the tool's approved set, else `failed` with a `tool.approve_hosts` hint.
      // The set check and create are not atomic, but `runToolVersion` intersects with the current set at run time.
      if (!isSubsetOf(parsed.hosts, detail.approvedHosts)) {
        return { summary: 'the tool hosts are not approved yet; run tool.approve_hosts first' };
      }
      const owner = await ownerOf(state.db, actionCtx.aiId);
      return scheduledSummary(
        createRoutine(
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
            ...(alertCard === undefined ? {} : { alertCard }),
          },
          state.now(),
          ...(state.audit === undefined ? [] : ([state.audit] as const)),
        ),
        state.now(),
      );
    },
  };
}

export function routinePauseAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'routine.pause',
    description: 'Pause a routine in this topic so it stops running.',
    tier: 1,
    argsExample: '{"id":"1a2b3c4d"}',
    argsSchema: routineTargetArgsSchema as unknown as Schema.Codec<unknown, unknown, never>,
    describe: (args) => {
      const parsed = args as { id?: string; title?: string };
      return {
        summary:
          parsed.title === undefined
            ? `Pause the routine with id ${parsed.id}`
            : `Pause the routine "${parsed.title}"`,
      };
    },
    execute: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as { id?: string; title?: string };
      const found = await findRoutineTarget(state, actionCtx, parsed);
      if (found.status === 'error') {
        return { summary: found.summary };
      }
      if (found.routineStatus !== 'active') {
        return { summary: `already paused "${found.title}"` };
      }
      const owner = await ownerOf(state.db, actionCtx.aiId);
      return serviceSummary(async () => {
        await pauseRoutine(
          state.db,
          found.id,
          owner,
          state.now(),
          ...(state.audit === undefined ? [] : ([state.audit] as const)),
        );
        return `paused "${found.title}"`;
      });
    },
  };
}

export function routineDeleteAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'routine.delete',
    description: 'Delete a routine in this topic.',
    tier: 1,
    argsExample: '{"id":"1a2b3c4d"}',
    argsSchema: routineTargetArgsSchema as unknown as Schema.Codec<unknown, unknown, never>,
    describe: (args) => {
      const parsed = args as { id?: string; title?: string };
      return {
        summary:
          parsed.title === undefined
            ? `Delete the routine with id ${parsed.id}`
            : `Delete the routine "${parsed.title}"`,
      };
    },
    execute: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as { id?: string; title?: string };
      const found = await findRoutineTarget(state, actionCtx, parsed);
      if (found.status === 'error') {
        return { summary: found.summary };
      }
      const owner = await ownerOf(state.db, actionCtx.aiId);
      return serviceSummary(async () => {
        await deleteRoutine(
          state.db,
          found.id,
          owner,
          state.now(),
          ...(state.audit === undefined ? [] : ([state.audit] as const)),
        );
        return `deleted "${found.title}"`;
      });
    },
  };
}
