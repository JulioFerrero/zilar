import { z } from 'zod';

// T-0103: one shared schema for tool names, descriptions, sources and host
// allowlists. Routes and the service both validate through it, so the rules
// below hold at every boundary.

export const MAX_TOOL_SOURCE_BYTES = 64 * 1024;
export const MAX_TOOL_HOSTS = 5;

// A slug: start lowercase, then lowercase, digits, `_` or `-`.
export const toolNameSchema = z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/, {
  message: 'name must match ^[a-z][a-z0-9_-]{1,39}$',
});

const CONTROL_CHARS = String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index), 127);

// 1-200 chars, no control characters so descriptions render safely.
export const toolDescriptionSchema = z
  .string()
  .min(1, { message: 'description must not be empty' })
  .max(200, { message: 'description must be at most 200 characters' })
  .refine((value) => !value.split('').some((char) => CONTROL_CHARS.includes(char)), {
    message: 'description must not contain control characters',
  });

// The "commit message" attached to one version. Same bounds as the
// description so version history renders the same way.
export const toolMessageSchema = z
  .string()
  .min(1, { message: 'message must not be empty' })
  .max(200, { message: 'message must be at most 200 characters' })
  .refine((value) => !value.split('').some((char) => CONTROL_CHARS.includes(char)), {
    message: 'message must not contain control characters',
  });

// 1 byte to 64 KiB, measured in UTF-8 bytes (not characters).
export const toolSourceSchema = z
  .string()
  .refine((value) => Buffer.byteLength(value, 'utf8') >= 1, {
    message: 'source must not be empty',
  })
  .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_TOOL_SOURCE_BYTES, {
    message: `source must be at most ${MAX_TOOL_SOURCE_BYTES} bytes`,
  });

// One host allowlist entry: a lowercase DNS hostname with at least one
// dot. No scheme, port, path, wildcard or IP literal. Callers pass raw
// strings; the schema normalises to lowercase and rejects the rest.
const singleHostSchema = z
  .string()
  .trim()
  .min(1, { message: 'hosts must not contain an empty entry' })
  .max(253, { message: 'each host must be at most 253 characters' })
  .regex(/^[A-Za-z0-9.-]+$/, {
    message: 'each host must be letters, digits, dots or hyphens',
  })
  .refine((value) => value.includes('.'), {
    message: 'each host must contain at least one dot',
  })
  .refine((value) => !value.includes('*'), {
    message: 'each host must not contain a wildcard',
  })
  .refine((value) => !value.startsWith('.') && !value.endsWith('.'), {
    message: 'each host must not start or end with a dot',
  })
  .refine((value) => !value.includes('..'), {
    message: 'each host must not contain an empty label',
  })
  .refine((value) => !/^\d+\.\d+\.\d+\.\d+$/.test(value), {
    message: 'each host must not be an IP literal',
  })
  .refine((value) => value.split('.').every((label) => label.length > 0 && label.length <= 63), {
    message: 'each host label must be 1-63 characters',
  })
  .refine(
    (value) => value.split('.').every((label) => !label.startsWith('-') && !label.endsWith('-')),
    { message: 'each host label must not start or end with a hyphen' },
  )
  .transform((value) => value.toLowerCase());

// 0-5 entries, de-duplicated after lowercasing.
export const toolHostsSchema = z
  .array(singleHostSchema)
  .max(MAX_TOOL_HOSTS, { message: `at most ${MAX_TOOL_HOSTS} hosts` })
  .transform((hosts) => [...new Set(hosts)]);

// The full boundary for creating or updating a tool's code.
export const toolVersionInputSchema = z.object({
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

// Validates and normalises (hosts are lowercased and de-duplicated).
export function parseToolVersionInput(input: unknown):
  | {
      ok: true;
      value: ToolVersionInput;
    }
  | { ok: false; message: string } {
  const parsed = toolVersionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid tool input' };
  }
  return { ok: true, value: parsed.data };
}
