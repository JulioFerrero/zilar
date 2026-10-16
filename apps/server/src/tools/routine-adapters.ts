// effect-plain: moved unchanged from apps/server/src/tools/adapters.ts (size split)
// T-0966: the `routine.*` adapters and schedule formatting, split out of
// `tools/adapters.ts` unchanged.
import type { Schema } from 'effect';
import type { ActionAdapter, ActionContext } from '../actions/registry';
import { createPromptRoutine } from '../routines/prompt-routines';
import { nextRunAfter, type RoutineSchedule } from '../routines/schedule';
import {
  RoutineServiceError,
  createRoutine,
  deleteRoutine,
  pauseRoutine,
} from '../routines/service';
import {
  findRoutineByTitle,
  findToolByName,
  hostsEqualAsSets,
  hostsLine,
  isSubsetOf,
  ownerOf,
  plural,
  serviceFailure,
  type AdapterState,
} from './adapter-support';
import { getTool } from './service';
import { routineScheduleArgsSchema, routineTitleArgsSchema } from './tool-arg-schemas';

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// T-1649: the approval card shows at most this many characters of a
// scheduled prompt; the full prompt stays in the routine row.
const MAX_PROMPT_CARD_CHARS = 500;

function promptForCard(prompt: string): string {
  return prompt.length <= MAX_PROMPT_CARD_CHARS
    ? prompt
    : `${prompt.slice(0, MAX_PROMPT_CARD_CHARS)}…`;
}

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

export function routineScheduleAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'routine.schedule',
    description:
      'Schedule a routine here (needs approval): a prompt you run and answer, or a saved tool whose result is posted. Use the exact schedule asked for: daily HH:MM in an IANA zone, or every 1-10080 min.',
    tier: 2,
    argsExample:
      '{"title":"Release notes digest","schedule":{"kind":"interval","everyMinutes":120},"prompt":"Summarise the release notes posted in this chat since the last run."}',
    argsSchema: routineScheduleArgsSchema as unknown as Schema.Codec<unknown, unknown, never>,
    describe: (args) => {
      const parsed = args as {
        tool: string;
        title: string;
        schedule: RoutineSchedule;
        hosts: string[];
        prompt?: string;
      };
      const summary = `${parsed.title} · ${describeSchedule(parsed.schedule)}`;
      if (parsed.prompt !== undefined) {
        return {
          summary,
          details: `Runs this prompt on that schedule and posts my answer here: "${promptForCard(parsed.prompt)}"`,
        };
      }
      return {
        summary,
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
        prompt?: string;
      };
      // T-1649: the prompt form needs no tool and no hosts check; it creates
      // a `kind = 'prompt'` routine the AI runs itself and posts here.
      if (parsed.prompt !== undefined) {
        const owner = await ownerOf(state.db, actionCtx.aiId);
        try {
          const created = await createPromptRoutine(
            state.db,
            {
              aiId: actionCtx.aiId,
              groupId: actionCtx.groupId,
              topicId: actionCtx.topicId,
              title: parsed.title,
              schedule: parsed.schedule,
              prompt: parsed.prompt,
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
      }
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
      // T-0132: every host on the card must be inside the tool's approved
      // set, else `failed` and the model is told to run `tool.approve_hosts`
      // first. The set check and `createRoutine` below are not atomic: a
      // revocation racing approval could slip a host through the scheduler's
      // own pinning, but `runToolVersion` intersects with the CURRENT
      // approved set at run time, so the sandbox still refuses it.
      if (!isSubsetOf(parsed.hosts, detail.approvedHosts)) {
        return { summary: 'the tool hosts are not approved yet; run tool.approve_hosts first' };
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

export function routinePauseAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'routine.pause',
    description: 'Pause a routine in this topic so it stops running.',
    tier: 1,
    argsExample: '{"title":"Daily report"}',
    argsSchema: routineTitleArgsSchema as unknown as Schema.Codec<unknown, unknown, never>,
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

export function routineDeleteAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'routine.delete',
    description: 'Delete a routine in this topic.',
    tier: 1,
    argsExample: '{"title":"Daily report"}',
    argsSchema: routineTitleArgsSchema as unknown as Schema.Codec<unknown, unknown, never>,
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
