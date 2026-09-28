import { z } from 'zod';

export const UPDATE_PERSONA_TOOL = 'update_persona';
export const REVERT_PERSONA_TOOL = 'revert_persona';

// The same ceiling the API enforces on a persona (`CreateAiSchema`).
export const PERSONA_MAX_LENGTH = 4000;
export const PERSONA_SUMMARY_MAX_LENGTH = 200;

export const UpdatePersonaArgsSchema = z
  .object({
    persona: z.string().trim().min(1).max(PERSONA_MAX_LENGTH),
    summary: z.string().trim().min(1).max(PERSONA_SUMMARY_MAX_LENGTH),
  })
  .strict();

export const RevertPersonaArgsSchema = z.object({}).strict();

export type UpdatePersonaArgs = z.infer<typeof UpdatePersonaArgsSchema>;

export type ParsedToolArguments =
  | { ok: true; tool: typeof UPDATE_PERSONA_TOOL; persona: string; summary: string }
  | { ok: true; tool: typeof REVERT_PERSONA_TOOL }
  | { ok: false; reason: string };

// Validates one raw tool call's `arguments` (a JSON string) with zod. Unknown
// tool names and invalid arguments are never executed; the caller reports
// `invalid: <reason>` back to the model. Reasons carry no argument values, so
// the persona text can never leak through them.
export function parseToolArguments(toolName: string, argsJson: string): ParsedToolArguments {
  if (toolName !== UPDATE_PERSONA_TOOL && toolName !== REVERT_PERSONA_TOOL) {
    return { ok: false, reason: `unknown tool: ${toolName}` };
  }
  if (typeof argsJson !== 'string') {
    return { ok: false, reason: 'arguments must be a JSON string' };
  }
  const source = argsJson.trim() === '' ? '{}' : argsJson;
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(source);
  } catch {
    return { ok: false, reason: 'arguments are not valid JSON' };
  }
  if (toolName === REVERT_PERSONA_TOOL) {
    const parsed = RevertPersonaArgsSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return { ok: false, reason: firstIssue(parsed.error) };
    }
    return { ok: true, tool: REVERT_PERSONA_TOOL };
  }
  const parsed = UpdatePersonaArgsSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { ok: false, reason: firstIssue(parsed.error) };
  }
  return {
    ok: true,
    tool: UPDATE_PERSONA_TOOL,
    persona: parsed.data.persona,
    summary: parsed.data.summary,
  };
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'invalid arguments';
}

export interface ChatToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// The `tools` array the DM turn sends with `tool_choice: "auto"`. Only in
// turns the gateway already runs: the owner's DMs.
export const PERSONA_TOOLS: ChatToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: UPDATE_PERSONA_TOOL,
      description:
        'Rewrite your own persona. Use it only when your owner asks you to change ' +
        'how you behave from now on. `persona` is the complete new persona, not a ' +
        'diff. `summary` is one short line describing the change.',
      parameters: {
        type: 'object',
        properties: {
          persona: { type: 'string', minLength: 1, maxLength: PERSONA_MAX_LENGTH },
          summary: { type: 'string', minLength: 1, maxLength: PERSONA_SUMMARY_MAX_LENGTH },
        },
        required: ['persona', 'summary'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: REVERT_PERSONA_TOOL,
      description:
        'Undo the last persona change and restore the previous persona. ' +
        'Use it when your owner asks to undo the last persona change.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
];

// One line the gateway appends to the AI's text reply after a successful
// `update_persona`, so the owner sees what happened without relying on the
// model to say it.
export function formatPersonaUpdatedLine(summary: string): string {
  const clean = sanitizeSummary(summary) === '' ? 'updated' : sanitizeSummary(summary);
  return `\n\n✏️ Persona updated: ${clean}. Say "undo" to revert.`;
}

export const PERSONA_RESTORED_LINE = '\n\n↩️ Persona restored.';

// The summary rides into the DM text, so it stays one short line: newlines
// and control characters become spaces, runs collapse, and it caps at 200.
export function sanitizeSummary(summary: string): string {
  let out = '';
  for (const char of summary) {
    const code = char.codePointAt(0) ?? 32;
    out += code < 32 || code === 127 ? ' ' : char;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, PERSONA_SUMMARY_MAX_LENGTH);
}
