import { z } from 'zod';

export const UPDATE_PERSONA_TOOL = 'update_persona';
export const REVERT_PERSONA_TOOL = 'revert_persona';
export const REQUEST_ACTION_TOOL = 'request_action';

// The same ceiling the API enforces on a persona (`CreateAiSchema`).
export const PERSONA_MAX_LENGTH = 4000;
export const PERSONA_SUMMARY_MAX_LENGTH = 200;

// Same ceiling the audit log and the protocol's `ApprovalRequest` use: the
// adapter name is `dotted-name` and rides into log lines and chat payloads.
export const ACTION_NAME_MAX_LENGTH = 100;

// The dotted-name pattern the action registry uses (matches
// `apps/server/src/actions/registry.ts`). The model can never choose
// anything outside this set; everything else fails parse.
const ACTION_NAME_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export const UpdatePersonaArgsSchema = z
  .object({
    persona: z.string().trim().min(1).max(PERSONA_MAX_LENGTH),
    summary: z.string().trim().min(1).max(PERSONA_SUMMARY_MAX_LENGTH),
  })
  .strict();

export const RevertPersonaArgsSchema = z.object({}).strict();

// `args` is a JSON object (never an array, never a primitive): a JSON
// object is the shape every adapter's zod schema expects. `action` rides
// through to the gateway unchanged, but its pattern is checked so a
// crafted model call cannot smuggle a foreign name into the registry.
export const RequestActionArgsSchema = z
  .object({
    action: z.string().trim().min(1).max(ACTION_NAME_MAX_LENGTH).regex(ACTION_NAME_PATTERN),
    args: z.record(z.string(), z.unknown()),
  })
  .strict();

export type UpdatePersonaArgs = z.infer<typeof UpdatePersonaArgsSchema>;
export type RequestActionArgs = z.infer<typeof RequestActionArgsSchema>;

export type ParsedToolArguments =
  | { ok: true; tool: typeof UPDATE_PERSONA_TOOL; persona: string; summary: string }
  | { ok: true; tool: typeof REVERT_PERSONA_TOOL }
  | {
      ok: true;
      tool: typeof REQUEST_ACTION_TOOL;
      action: string;
      args: Record<string, unknown>;
    }
  | { ok: false; reason: string };

// Tool names ride into log lines and back to the model, so a model-chosen
// name stays short and single-line: capped at 64 characters with control
// characters stripped.
export const TOOL_NAME_MAX_LENGTH = 64;

export function safeToolName(name: string): string {
  let out = '';
  for (const char of name) {
    const code = char.codePointAt(0) ?? 32;
    if (code >= 32 && code !== 127) {
      out += char;
    }
    if (out.length >= TOOL_NAME_MAX_LENGTH) {
      break;
    }
  }
  return out;
}

// Validates one raw tool call's `arguments` (a JSON string) with zod. Unknown
// tool names and invalid arguments are never executed; the caller reports
// `invalid: <reason>` back to the model. Reasons carry no argument values, so
// the persona text can never leak through them.
export function parseToolArguments(toolName: string, argsJson: string): ParsedToolArguments {
  if (
    toolName !== UPDATE_PERSONA_TOOL &&
    toolName !== REVERT_PERSONA_TOOL &&
    toolName !== REQUEST_ACTION_TOOL
  ) {
    return { ok: false, reason: `unknown tool: ${safeToolName(toolName)}` };
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
  if (toolName === UPDATE_PERSONA_TOOL) {
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
  const parsed = RequestActionArgsSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { ok: false, reason: firstIssue(parsed.error) };
  }
  return {
    ok: true,
    tool: REQUEST_ACTION_TOOL,
    action: parsed.data.action,
    args: parsed.data.args,
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

// The minimal description the AI sees for `request_action`: it lists every
// registered action as `name — description`. The list is sorted by name so
// the tool definition is stable across turns. The platform runs whatever
// the approval is granted for; the AI must never claim an action happened
// until it sees the outcome in the next model reply.
function describeRequestAction(
  actions: ReadonlyArray<{ name: string; description: string }>,
): string {
  const list = actions.map((action) => `${action.name} — ${action.description}`).join('; ');
  return (
    'Ask the platform to run one of the registered actions below. The platform ' +
    'will ask your owner for approval when needed (a card appears in this chat) ' +
    'and will tell you what happened in the next reply. Never claim an action ' +
    'happened until you see its outcome. `action` is the registered name, ' +
    '`args` is a JSON object matching the action. Available actions: ' +
    `${list}.`
  );
}

// The tool definition the model sees for `request_action`. Kept in one
// place so `buildTools` and its tests share it.
export function buildRequestActionTool(
  actions: ReadonlyArray<{ name: string; description: string }>,
): ChatToolDefinition {
  return {
    type: 'function',
    function: {
      name: REQUEST_ACTION_TOOL,
      description: describeRequestAction(actions),
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', minLength: 1, maxLength: ACTION_NAME_MAX_LENGTH },
          args: { type: 'object', additionalProperties: true },
        },
        required: ['action', 'args'],
        additionalProperties: false,
      },
    },
  };
}

// The full tools array for one DM turn. With no actions registered (the
// production default while `ACTION_DEMO_ENABLED` is off and no real
// adapters are wired), the model only sees the persona tools, and a
// `request_action` call falls through to `invalid: unknown tool` — the
// spec's promise that "with the flag off, nothing changes".
export function buildTools(
  actions: ReadonlyArray<{ name: string; description: string }>,
): ChatToolDefinition[] {
  if (actions.length === 0) {
    return [...PERSONA_TOOLS];
  }
  return [...PERSONA_TOOLS, buildRequestActionTool(actions)];
}

// The tools array for one group turn when the trigger is allowed to ask
// for an action (T-0098): only `request_action`. Persona tools never appear
// in a group — only the AI's owner may reshape it, and only in the DM. With
// no actions registered the result is an empty list, so the caller can
// fall back to the plain `completeChat` path (today's behaviour).
export function buildGroupTools(
  actions: ReadonlyArray<{ name: string; description: string }>,
): ChatToolDefinition[] {
  if (actions.length === 0) {
    return [];
  }
  return [buildRequestActionTool(actions)];
}

// One line the gateway appends to the AI's text reply after a successful
// `update_persona`, so the owner sees what happened without relying on the
// model to say it.
export function formatPersonaUpdatedLine(summary: string): string {
  const clean = sanitizeSummary(summary);
  return `\n\n✏️ Persona updated: ${clean === '' ? 'updated' : clean}. Say "undo" to revert.`;
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
