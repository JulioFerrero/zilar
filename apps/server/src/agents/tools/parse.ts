import { Exit, Schema } from 'effect';
import { firstIssueReason } from '../tool-arg-issues';
import {
  DELEGATE_TOOL,
  DelegateArgsSchema,
  MEMORY_ZOOM_TOOL,
  MemoryZoomArgsSchema,
  RECALL_TOOL,
  REMEMBER_TOOL,
  REQUEST_ACTION_TOOL,
  REVERT_PERSONA_TOOL,
  RecallArgsSchema,
  RememberArgsSchema,
  RequestActionArgsSchema,
  RevertPersonaArgsSchema,
  TASK_STATUS_TOOL,
  TaskStatusArgsSchema,
  UPDATE_PERSONA_TOOL,
  UpdatePersonaArgsSchema,
  type ParsedToolArguments,
} from './schemas';

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

// Validates one raw tool call's `arguments` (a JSON string) with Effect
// Schema. Unknown tool names and invalid arguments are never executed; the
// caller reports `invalid: <reason>` back to the model. Reasons carry no
// argument values, so the persona text can never leak through them.
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
    const parsed = decodeToolArguments(RevertPersonaArgsSchema, parsedJson);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }
    return { ok: true, tool: REVERT_PERSONA_TOOL };
  }
  if (toolName === UPDATE_PERSONA_TOOL) {
    const parsed = decodeToolArguments(UpdatePersonaArgsSchema, parsedJson);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }
    return {
      ok: true,
      tool: UPDATE_PERSONA_TOOL,
      persona: parsed.value.persona,
      summary: parsed.value.summary,
    };
  }
  if (toolName === RECALL_TOOL) {
    const parsed = decodeToolArguments(RecallArgsSchema, parsedJson);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }
    return { ok: true, tool: RECALL_TOOL, query: parsed.value.query };
  }
  if (toolName === MEMORY_ZOOM_TOOL) {
    const parsed = decodeToolArguments(MemoryZoomArgsSchema, parsedJson);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }
    return { ok: true, tool: MEMORY_ZOOM_TOOL, block: parsed.value.block };
  }
  if (toolName === REMEMBER_TOOL) {
    const parsed = decodeToolArguments(RememberArgsSchema, parsedJson);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }
    return { ok: true, tool: REMEMBER_TOOL, text: parsed.value.text };
  }
  if (toolName === DELEGATE_TOOL) {
    const parsed = decodeToolArguments(DelegateArgsSchema, parsedJson);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }
    return {
      ok: true,
      tool: DELEGATE_TOOL,
      to: parsed.value.to,
      objective: parsed.value.objective,
      ...(parsed.value.context_summary === undefined
        ? {}
        : { context_summary: parsed.value.context_summary }),
      ...(parsed.value.acceptance === undefined ? {} : { acceptance: parsed.value.acceptance }),
      ...(parsed.value.return_format === undefined
        ? {}
        : { return_format: parsed.value.return_format }),
    };
  }
  if (toolName === TASK_STATUS_TOOL) {
    const parsed = decodeToolArguments(TaskStatusArgsSchema, parsedJson);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }
    return { ok: true, tool: TASK_STATUS_TOOL, task_id: parsed.value.task_id };
  }
  const parsed = decodeToolArguments(RequestActionArgsSchema, parsedJson);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }
  return {
    ok: true,
    tool: REQUEST_ACTION_TOOL,
    action: parsed.value.action,
    args: { ...parsed.value.args },
  };
}

// Decodes one tool call's arguments with Effect Schema. All eight schemas are
// strict, so an extra key fails; `errors: 'all'` collects every issue and the
// first one is turned into a value-free reason for the model (see
// `firstIssueReason`).
function decodeToolArguments<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  raw: unknown,
): { ok: true; value: S['Type'] } | { ok: false; reason: string } {
  const exit = Schema.decodeUnknownExit(schema, { errors: 'all', onExcessProperty: 'error' })(raw);
  if (Exit.isSuccess(exit)) {
    return { ok: true, value: exit.value };
  }
  for (const reason of exit.cause.reasons) {
    if (reason._tag === 'Fail') {
      const message = firstIssueReason(reason.error.issue, raw);
      if (message !== undefined) {
        return { ok: false, reason: message };
      }
    }
  }
  return { ok: false, reason: 'invalid arguments' };
}
