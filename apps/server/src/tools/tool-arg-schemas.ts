// T-0966: argument schemas for the tool and routine adapters. Split out of
// `tools/adapters.ts` unchanged.
import { Schema } from 'effect';
import { IdSchema, struct } from '@zilar/protocol';
import { routineScheduleSchema } from '../routines/schedule';
import { MAX_ROUTINE_PROMPT_CHARS } from '../routines/schemas';
import { MAX_ROUTINE_INPUT_BYTES, MAX_ROUTINE_TITLE_CHARS } from '../routines/service';
import { toolHostsSchema, toolNameSchema, toolVersionInputSchema } from './schemas';

// `tool.run` (and the tools HTTP route) refuse an `input` that serialises
// past 16 KiB.
export const MAX_TOOL_INPUT_BYTES = 16 * 1024;

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
function inputField(maxBytes: number): Schema.Codec<unknown, unknown, never> {
  return Schema.Unknown.check(
    Schema.makeFilter((value: unknown) => {
      if (value === undefined) {
        return undefined;
      }
      const size = serialisedSize(value);
      return size !== null && size <= maxBytes
        ? undefined
        : `input must serialise to at most ${maxBytes} bytes`;
    }),
  );
}

export const toolListArgsSchema = struct({});

export const toolReadArgsSchema = struct({
  name: toolNameSchema,
  version: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
});

export const toolSaveArgsSchema = toolVersionInputSchema;

export const toolRunArgsSchema = struct({
  name: toolNameSchema,
  input: Schema.optional(inputField(MAX_TOOL_INPUT_BYTES)),
});

export const toolApproveHostsArgsSchema = struct({
  name: toolNameSchema,
});

export const toolRevokeHostsArgsSchema = toolApproveHostsArgsSchema;

// The hosts bound into the stored args at card time (T-0132): the tool's
// CURRENT version hosts read from the DB, never from model text. Stored
// args, card text and the fail-safe execution check all use this one
// value, so a tool update after the card can never approve new hosts.
export interface ApproveHostsBoundArgs {
  name: string;
  hosts: string[];
}

export const toolRevertArgsSchema = struct({
  name: toolNameSchema,
  toVersion: Schema.Int.check(Schema.isGreaterThan(0)),
});

export const routineTitleSchema = Schema.String.check(
  Schema.makeFilter((value: string) => (value.length >= 1 ? undefined : 'title must not be empty')),
  Schema.makeFilter((value: string) =>
    value.length <= MAX_ROUTINE_TITLE_CHARS
      ? undefined
      : `title must be at most ${MAX_ROUTINE_TITLE_CHARS} characters`,
  ),
);

// T-1649: the prompt a scheduled AI job runs itself. Trimmed non-empty and
// no longer than the routines service limit, so an oversize prompt fails the
// adapter schema and the gateway denies `invalid_args` before `execute`.
const routinePromptSchema = Schema.String.check(
  Schema.makeFilter((value: string) =>
    value.trim().length >= 1 ? undefined : 'prompt must not be empty',
  ),
  Schema.makeFilter((value: string) =>
    value.trim().length <= MAX_ROUTINE_PROMPT_CHARS
      ? undefined
      : `prompt must be at most ${MAX_ROUTINE_PROMPT_CHARS} characters`,
  ),
);

// T-1871: the alert card an `alert` block drives. Both ids were chosen by the
// server when it posted the card, so they are plain ids, never model text.
const alertCardField = Schema.optional(
  struct({
    card: IdSchema,
    block: IdSchema,
  }),
);

// The saved-tool form: a tool the routine runs on the schedule. T-1737:
// `hosts` is optional; when the model leaves it out the adapter binds the
// saved tool's current hosts in `prepareArgs` before the card is described,
// so the card still lists them and the fail-safe still compares equal sets.
const routineToolScheduleArgsSchema = struct({
  tool: toolNameSchema,
  title: routineTitleSchema,
  schedule: routineScheduleSchema,
  hosts: Schema.optional(toolHostsSchema),
  input: Schema.optional(inputField(MAX_ROUTINE_INPUT_BYTES)),
  alert_card: alertCardField,
});

// T-1649: the prompt form: a prompt the AI runs itself and answers here.
export const routinePromptScheduleArgsSchema = struct({
  title: routineTitleSchema,
  schedule: routineScheduleSchema,
  prompt: routinePromptSchema,
  alert_card: alertCardField,
});

// T-1649: either form, never both. The two shapes share no required field and
// the strict decode rejects the other form's keys, so a value with `prompt`
// never decodes as the tool shape and vice versa.
export const routineScheduleArgsSchema = Schema.Union([
  routineToolScheduleArgsSchema,
  routinePromptScheduleArgsSchema,
]);

// T-1737: `routine.pause` and `routine.delete` name a routine by `id` (the
// full id or the 8-character prefix `tool.list` prints) or by `title`. At
// least one field is required; an empty object fails the filter.
const routineIdSchema = Schema.String.check(
  Schema.makeFilter((value: string) =>
    /^[0-9a-fA-F-]{8,36}$/.test(value)
      ? undefined
      : 'id must be a routine id or its 8-character prefix',
  ),
);

export const routineTargetArgsSchema = struct({
  id: Schema.optional(routineIdSchema),
  title: Schema.optional(routineTitleSchema),
}).check(
  Schema.makeFilter((value) =>
    value.id !== undefined || value.title !== undefined
      ? undefined
      : 'provide the routine id or title',
  ),
);
