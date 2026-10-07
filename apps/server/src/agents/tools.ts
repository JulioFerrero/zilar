import { z } from 'zod';

export const UPDATE_PERSONA_TOOL = 'update_persona';
export const REVERT_PERSONA_TOOL = 'revert_persona';
export const REQUEST_ACTION_TOOL = 'request_action';
export const RECALL_TOOL = 'recall';
export const MEMORY_ZOOM_TOOL = 'memory_zoom';
export const REMEMBER_TOOL = 'remember';
// T-0482: the delegation tools (plan `listener-delegation-plan.md` §4.1-§4.3).
export const DELEGATE_TOOL = 'delegate';
export const TASK_STATUS_TOOL = 'task_status';

// The same ceiling the API enforces on a persona (`CreateAiSchema`).
export const PERSONA_MAX_LENGTH = 4000;
export const PERSONA_SUMMARY_MAX_LENGTH = 200;

// The same ceiling the `remember` tool schema enforces on a fact.
export const REMEMBERED_FACT_MAX_LENGTH = 280;

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

export const RecallArgsSchema = z
  .object({
    query: z.string().trim().min(1).max(100),
  })
  .strict();

// The block id shape OptMem uses (`64-79`): one open, one close, both capped
// at 9 digits so an absurd id is a parse failure, never a bad query.
export const MemoryZoomArgsSchema = z
  .object({
    block: z.string().regex(/^\d{1,9}-\d{1,9}$/),
  })
  .strict();

export const RememberArgsSchema = z
  .object({
    text: z.string().trim().min(1).max(280),
  })
  .strict();

// T-0482: the `delegate` tool's arguments. `objective` is the only required
// text; the rest are hints. `to` is an AI id from the roster that the tool
// description lists, never a name taken from model output. The service caps
// and cuts these values itself, so the schema only rejects out-of-shape input.
export const DelegateArgsSchema = z
  .object({
    to: z.string().trim().min(1).max(64),
    objective: z.string().trim().min(1).max(1000),
    context_summary: z.string().trim().max(1200).optional(),
    acceptance: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
    return_format: z.string().trim().max(200).optional(),
  })
  .strict();

export const TaskStatusArgsSchema = z
  .object({
    task_id: z.string().trim().min(1).max(64),
  })
  .strict();

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
  | { ok: true; tool: typeof RECALL_TOOL; query: string }
  | { ok: true; tool: typeof MEMORY_ZOOM_TOOL; block: string }
  | { ok: true; tool: typeof REMEMBER_TOOL; text: string }
  | {
      ok: true;
      tool: typeof DELEGATE_TOOL;
      to: string;
      objective: string;
      context_summary?: string;
      acceptance?: string[];
      return_format?: string;
    }
  | { ok: true; tool: typeof TASK_STATUS_TOOL; task_id: string }
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
    toolName !== REQUEST_ACTION_TOOL &&
    toolName !== RECALL_TOOL &&
    toolName !== MEMORY_ZOOM_TOOL &&
    toolName !== REMEMBER_TOOL &&
    toolName !== DELEGATE_TOOL &&
    toolName !== TASK_STATUS_TOOL
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
  if (toolName === RECALL_TOOL) {
    const parsed = RecallArgsSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return { ok: false, reason: firstIssue(parsed.error) };
    }
    return { ok: true, tool: RECALL_TOOL, query: parsed.data.query };
  }
  if (toolName === MEMORY_ZOOM_TOOL) {
    const parsed = MemoryZoomArgsSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return { ok: false, reason: firstIssue(parsed.error) };
    }
    return { ok: true, tool: MEMORY_ZOOM_TOOL, block: parsed.data.block };
  }
  if (toolName === REMEMBER_TOOL) {
    const parsed = RememberArgsSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return { ok: false, reason: firstIssue(parsed.error) };
    }
    return { ok: true, tool: REMEMBER_TOOL, text: parsed.data.text };
  }
  if (toolName === DELEGATE_TOOL) {
    const parsed = DelegateArgsSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return { ok: false, reason: firstIssue(parsed.error) };
    }
    return {
      ok: true,
      tool: DELEGATE_TOOL,
      to: parsed.data.to,
      objective: parsed.data.objective,
      ...(parsed.data.context_summary === undefined
        ? {}
        : { context_summary: parsed.data.context_summary }),
      ...(parsed.data.acceptance === undefined ? {} : { acceptance: parsed.data.acceptance }),
      ...(parsed.data.return_format === undefined
        ? {}
        : { return_format: parsed.data.return_format }),
    };
  }
  if (toolName === TASK_STATUS_TOOL) {
    const parsed = TaskStatusArgsSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return { ok: false, reason: firstIssue(parsed.error) };
    }
    return { ok: true, tool: TASK_STATUS_TOOL, task_id: parsed.data.task_id };
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

// The three memory tools offered in every DM and room turn (T-0444,
// docs/audit/ai-memory-plan.md §3.4). They are always advertised: recall and
// memory_zoom read this chat's mirror, and remember pins a fact. The AI id and
// chat key never appear here — they come from the turn, never from the
// arguments.
export const MEMORY_TOOLS: ChatToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: RECALL_TOOL,
      description:
        'Search everything said in this chat, including messages older than what you ' +
        "can see. Use it before saying you don't remember. `query` is a few words; " +
        'every word must appear. Returns the newest matches as `#seq date sender: text`.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 100 },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: MEMORY_ZOOM_TOOL,
      description:
        'Open one block of your memory of this chat, like `64-79`, into its two ' +
        'halves (shorter summaries or the messages themselves).',
      parameters: {
        type: 'object',
        properties: {
          block: { type: 'string', pattern: '^\\d{1,9}-\\d{1,9}$' },
        },
        required: ['block'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: REMEMBER_TOOL,
      description:
        'Pin one short fact for this chat. Use it only when someone asks you to ' +
        'remember something, or for a lasting decision. One line, at most 280 ' +
        'characters. Never passwords, codes, keys or tokens.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', minLength: 1, maxLength: 280 },
        },
        required: ['text'],
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

// T-0482: the tool definition the model sees for `delegate`. The targets are
// listed as `id — name`, and the model must pick the id (a name from its own
// text is never trusted). The worker runs the task with its own model, key and
// budget and answers in the room; the boss reads the stored result later with
// `task_status`.
export function buildDelegateTool(
  targets: ReadonlyArray<{ id: string; name: string }>,
): ChatToolDefinition {
  const list = targets.map((target) => `${target.id} — ${target.name}`).join('; ');
  return {
    type: 'function',
    function: {
      name: DELEGATE_TOOL,
      description:
        'Hand a task to another AI in this room. It works on the task with its own ' +
        'model and budget and replies in the room. `to` is the target id from the ' +
        'list below, `objective` is what it must do. Use task_status later to read ' +
        `the stored result. Targets: ${list}.`,
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', minLength: 1, maxLength: 64 },
          objective: { type: 'string', minLength: 1, maxLength: 1000 },
          context_summary: { type: 'string', maxLength: 1200 },
          acceptance: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 300 },
            maxItems: 10,
          },
          return_format: { type: 'string', maxLength: 200 },
        },
        required: ['to', 'objective'],
        additionalProperties: false,
      },
    },
  };
}

// The `task_status` tool definition, the same for every room that offers the
// delegation tools: it reads one delegation row for the two AIs involved.
export const TASK_STATUS_TOOL_DEF: ChatToolDefinition = {
  type: 'function',
  function: {
    name: TASK_STATUS_TOOL,
    description:
      'Read the stored result of a task you delegated or received. `task_id` is ' +
      'the id `delegate` returned.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', minLength: 1, maxLength: 64 },
      },
      required: ['task_id'],
      additionalProperties: false,
    },
  },
};

// The full tools array for one DM turn: the persona tools, the memory tools,
// and `request_action` only when at least one action is registered. With no
// actions (the production default while `ACTION_DEMO_ENABLED` is off and no
// real adapters are wired) a `request_action` call still falls through to
// `invalid: unknown tool`, while `recall` / `memory_zoom` / `remember` keep
// working.
export function buildTools(
  actions: ReadonlyArray<{ name: string; description: string }>,
): ChatToolDefinition[] {
  if (actions.length === 0) {
    return [...PERSONA_TOOLS, ...MEMORY_TOOLS];
  }
  return [...PERSONA_TOOLS, ...MEMORY_TOOLS, buildRequestActionTool(actions)];
}

// The tools array for one group turn: always the three memory tools (T-0444),
// plus `request_action` only when the trigger is allowed to ask for an action
// (T-0098). Persona tools never appear in a group — only the AI's owner may
// reshape it, and only in the DM. With no acceptable actions the result is the
// memory tools alone, so a plain member's turn still carries no action tool.
// T-0482: when `delegateTargets` is non-empty (the AI may delegate and at
// least one accepting AI is in the room) `delegate` and `task_status` are
// appended. Without targets the output is unchanged.
export function buildGroupTools(
  actions: ReadonlyArray<{ name: string; description: string }>,
  delegateTargets?: ReadonlyArray<{ id: string; name: string }>,
): ChatToolDefinition[] {
  const base =
    actions.length === 0 ? [...MEMORY_TOOLS] : [...MEMORY_TOOLS, buildRequestActionTool(actions)];
  if (delegateTargets === undefined || delegateTargets.length === 0) {
    return base;
  }
  return [...base, buildDelegateTool(delegateTargets), TASK_STATUS_TOOL_DEF];
}

// One line the gateway appends to the AI's text reply after a successful
// `update_persona`, so the owner sees what happened without relying on the
// model to say it.
export function formatPersonaUpdatedLine(summary: string): string {
  const clean = sanitizeSummary(summary);
  return `\n\n✏️ Persona updated: ${clean === '' ? 'updated' : clean}. Say "undo" to revert.`;
}

export const PERSONA_RESTORED_LINE = '\n\n↩️ Persona restored.';

// One plain line the gateway appends to the AI's text reply after a successful
// `remember`, so everyone in the chat sees which fact was pinned. No emoji.
export function formatRememberedLine(text: string): string {
  return `\n\nRemembered: ${sanitizeLine(text, REMEMBERED_FACT_MAX_LENGTH)}`;
}

// The summary rides into the DM text, so it stays one short line: newlines
// and control characters become spaces, runs collapse, and it caps at 200.
export function sanitizeSummary(summary: string): string {
  return sanitizeLine(summary, PERSONA_SUMMARY_MAX_LENGTH);
}

// Shared by the persona and memory reply lines: control characters become
// spaces, whitespace runs collapse, and the result caps at `maxLength`.
function sanitizeLine(text: string, maxLength: number): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 32;
    out += code < 32 || code === 127 ? ' ' : char;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
