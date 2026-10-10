// T-0966: argument schemas for the tool and routine adapters. Split out of
// `tools/adapters.ts` unchanged.
import { Schema } from 'effect';
import { struct } from '@zilar/protocol';
import { routineScheduleSchema } from '../routines/schedule';
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

export const routineScheduleArgsSchema = struct({
  tool: toolNameSchema,
  title: routineTitleSchema,
  schedule: routineScheduleSchema,
  hosts: toolHostsSchema,
  input: Schema.optional(inputField(MAX_ROUTINE_INPUT_BYTES)),
});

export const routineTitleArgsSchema = struct({
  title: routineTitleSchema,
});
