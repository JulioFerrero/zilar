import { Schema } from 'effect';
import { IdSchema, struct } from '@zilar/protocol';
import { routineScheduleSchema } from '../routines/schedule';
import {
  MAX_ROUTINE_PROMPT_CHARS,
  MAX_ROUTINE_INPUT_BYTES,
  MAX_ROUTINE_TITLE_CHARS,
} from '../routines/schemas';
import { toolHostsSchema, toolNameSchema, toolVersionInputSchema } from './schemas';

// `tool.run` and the tools route refuse an `input` that serialises past 16 KiB.
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

// Oversize input fails the adapter's schema, so the gateway denies `invalid_args` before `execute`.
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

// The tool's current version hosts read from the DB, never model text; args, card text and the fail-safe all use this value.
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

// Trimmed non-empty and within the service limit, so an oversize prompt denies `invalid_args` before `execute`.
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

// Both ids were chosen by the server when it posted the card, never model text.
const alertCardField = Schema.optional(
  struct({
    card: IdSchema,
    block: IdSchema,
  }),
);

// `hosts` is optional; the adapter binds the saved tool's current hosts in `prepareArgs` before the card.
const routineToolScheduleArgsSchema = struct({
  tool: toolNameSchema,
  title: routineTitleSchema,
  schedule: routineScheduleSchema,
  hosts: Schema.optional(toolHostsSchema),
  input: Schema.optional(inputField(MAX_ROUTINE_INPUT_BYTES)),
  alert_card: alertCardField,
});

// The prompt form: a prompt the AI runs itself and answers here.
export const routinePromptScheduleArgsSchema = struct({
  title: routineTitleSchema,
  schedule: routineScheduleSchema,
  prompt: routinePromptSchema,
  alert_card: alertCardField,
});

// Either form, never both: the strict decode rejects the other form's keys.
export const routineScheduleArgsSchema = Schema.Union([
  routineToolScheduleArgsSchema,
  routinePromptScheduleArgsSchema,
]);

// Names a routine by `id` (full or 8-character prefix) or `title`; at least one is required.
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
