import { Exit, Schema, SchemaGetter } from 'effect';
import { struct } from '@zilar/protocol';
import { firstIssueMessage } from '../effect/schema-issues';

// One shared schema for names, descriptions, sources and host allowlists, so the rules hold at every boundary.

export const MAX_TOOL_SOURCE_BYTES = 64 * 1024;
export const MAX_TOOL_HOSTS = 5;

const CONTROL_CHARS = String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index), 127);

function hasControl(value: string): boolean {
  return value.split('').some((char) => CONTROL_CHARS.includes(char));
}

// A slug: start lowercase, then lowercase, digits, `_` or `-`.
// effect 4 drops `{ message }` on length checks, but a filter's returned text carries.
export const toolNameSchema = Schema.String.check(
  Schema.makeFilter((value: string) =>
    /^[a-z][a-z0-9_-]{1,39}$/.test(value) ? undefined : 'name must match ^[a-z][a-z0-9_-]{1,39}$',
  ),
);

// 1-200 chars, no control characters so descriptions render safely.
export const toolDescriptionSchema = Schema.String.check(
  Schema.makeFilter((value: string) =>
    value.length >= 1 ? undefined : 'description must not be empty',
  ),
  Schema.makeFilter((value: string) =>
    value.length <= 200 ? undefined : 'description must be at most 200 characters',
  ),
  Schema.makeFilter((value: string) =>
    hasControl(value) ? 'description must not contain control characters' : undefined,
  ),
);

// The version's message; same bounds as the description so history renders the same.
export const toolMessageSchema = Schema.String.check(
  Schema.makeFilter((value: string) =>
    value.length >= 1 ? undefined : 'message must not be empty',
  ),
  Schema.makeFilter((value: string) =>
    value.length <= 200 ? undefined : 'message must be at most 200 characters',
  ),
  Schema.makeFilter((value: string) =>
    hasControl(value) ? 'message must not contain control characters' : undefined,
  ),
);

// 1 byte to 64 KiB, measured in UTF-8 bytes (not characters).
export const toolSourceSchema = Schema.String.check(
  Schema.makeFilter((value: string) =>
    Buffer.byteLength(value, 'utf8') >= 1 ? undefined : 'source must not be empty',
  ),
  Schema.makeFilter((value: string) =>
    Buffer.byteLength(value, 'utf8') <= MAX_TOOL_SOURCE_BYTES
      ? undefined
      : `source must be at most ${MAX_TOOL_SOURCE_BYTES} bytes`,
  ),
);

// A lowercase DNS hostname with at least one dot: no scheme, port, path, wildcard or IP literal.
// Raw strings are normalised to lowercase; trim runs before the length checks.
const singleHostSchema = Schema.Trim.check(
  Schema.makeFilter((value: string) =>
    value.length >= 1 ? undefined : 'hosts must not contain an empty entry',
  ),
  Schema.makeFilter((value: string) =>
    value.length <= 253 ? undefined : 'each host must be at most 253 characters',
  ),
  Schema.makeFilter((value: string) =>
    /^[A-Za-z0-9.-]+$/.test(value)
      ? undefined
      : 'each host must be letters, digits, dots or hyphens',
  ),
  Schema.makeFilter((value: string) =>
    value.includes('.') ? undefined : 'each host must contain at least one dot',
  ),
  Schema.makeFilter((value: string) =>
    !value.includes('*') ? undefined : 'each host must not contain a wildcard',
  ),
  Schema.makeFilter((value: string) =>
    !value.startsWith('.') && !value.endsWith('.')
      ? undefined
      : 'each host must not start or end with a dot',
  ),
  Schema.makeFilter((value: string) =>
    !value.includes('..') ? undefined : 'each host must not contain an empty label',
  ),
  Schema.makeFilter((value: string) =>
    !/^\d+\.\d+\.\d+\.\d+$/.test(value) ? undefined : 'each host must not be an IP literal',
  ),
  Schema.makeFilter((value: string) =>
    value.split('.').every((label) => label.length > 0 && label.length <= 63)
      ? undefined
      : 'each host label must be 1-63 characters',
  ),
  Schema.makeFilter((value: string) =>
    value.split('.').every((label) => !label.startsWith('-') && !label.endsWith('-'))
      ? undefined
      : 'each host label must not start or end with a hyphen',
  ),
).pipe(
  Schema.decode({
    decode: SchemaGetter.transform((value: string) => value.toLowerCase()),
    encode: SchemaGetter.transform((value: string) => value),
  }),
);

// 0-5 entries, de-duplicated after lowercasing.
export const toolHostsSchema = Schema.mutable(Schema.Array(singleHostSchema))
  .check(
    Schema.makeFilter((hosts: ReadonlyArray<string>) =>
      hosts.length <= MAX_TOOL_HOSTS ? undefined : `at most ${MAX_TOOL_HOSTS} hosts`,
    ),
  )
  .pipe(
    Schema.decode({
      decode: SchemaGetter.transform((hosts: string[]) => [...new Set(hosts)]),
      encode: SchemaGetter.transform((hosts: string[]) => [...hosts]),
    }),
  );

export const toolVersionInputSchema = struct({
  name: toolNameSchema,
  description: toolDescriptionSchema,
  source: toolSourceSchema,
  hosts: toolHostsSchema,
  message: toolMessageSchema,
});

export interface ToolVersionInput {
  name: string;
  description: string;
  source: string;
  hosts: string[];
  message: string;
}

// Normalises hosts and strips unknown keys, like the old non-strict zod object.
export function parseToolVersionInput(input: unknown):
  | {
      ok: true;
      value: ToolVersionInput;
    }
  | { ok: false; message: string } {
  const exit = Schema.decodeUnknownExit(toolVersionInputSchema, { errors: 'all' })(input);
  if (!Exit.isSuccess(exit)) {
    for (const reason of exit.cause.reasons) {
      if (reason._tag === 'Fail') {
        const message =
          firstIssueMessage(reason.error.issue, { filterAnnotations: true }) ??
          reason.error.message.split('\n')[0] ??
          'Invalid tool input';
        return { ok: false, message };
      }
    }
    return { ok: false, message: 'Invalid tool input' };
  }
  return { ok: true, value: exit.value };
}
