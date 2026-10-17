import { Exit, Schema } from 'effect';
import { firstIssueReason } from '../tool-arg-issues';
import {
  ASK_PEOPLE_TOOL,
  AskPeopleArgsSchema,
  BASH_TOOL,
  BashArgsSchema,
  DELEGATE_TOOL,
  DelegateArgsSchema,
  EDIT_TOOL,
  EditArgsSchema,
  FETCH_MEDIA_TOOL,
  FetchMediaArgsSchema,
  GIT_TOOL,
  GitArgsSchema,
  GLOB_TOOL,
  GlobArgsSchema,
  GREP_TOOL,
  GrepArgsSchema,
  MEMORY_ZOOM_TOOL,
  MemoryZoomArgsSchema,
  POST_BLOCKS_TOOL,
  PostBlocksArgsSchema,
  READ_TOOL,
  ReadArgsSchema,
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
  WRITE_TOOL,
  WriteArgsSchema,
  isDeskToolName,
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

// T-1745: `task_title` is not a tool argument — it only names the work card.
// It is dropped from the parsed object before the strict decode so no tool
// ever sees it, and from the raw string the session log keeps.
const TASK_TITLE_KEY = 'task_title';

function withoutTaskTitle(parsed: unknown): unknown {
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    !(TASK_TITLE_KEY in parsed)
  ) {
    return parsed;
  }
  const copy: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
  delete copy[TASK_TITLE_KEY];
  return copy;
}

/** Drops a top-level `task_title` from a raw arguments JSON string, for the
 * session log. Returns the input unchanged when there is nothing to drop. */
export function stripTaskTitle(argsJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson.trim() === '' ? '{}' : argsJson);
  } catch {
    return argsJson;
  }
  const stripped = withoutTaskTitle(parsed);
  return stripped === parsed ? argsJson : JSON.stringify(stripped);
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
    toolName !== TASK_STATUS_TOOL &&
    toolName !== ASK_PEOPLE_TOOL &&
    toolName !== POST_BLOCKS_TOOL &&
    toolName !== FETCH_MEDIA_TOOL &&
    !isDeskToolName(toolName)
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
  parsedJson = withoutTaskTitle(parsedJson);
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
  if (toolName === ASK_PEOPLE_TOOL) {
    const parsed = decodeToolArguments(AskPeopleArgsSchema, parsedJson);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }
    return {
      ok: true,
      tool: ASK_PEOPLE_TOOL,
      question: parsed.value.question,
      options: parsed.value.options,
    };
  }
  if (toolName === POST_BLOCKS_TOOL) {
    const parsed = decodeToolArguments(PostBlocksArgsSchema, parsedJson);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }
    return {
      ok: true,
      tool: POST_BLOCKS_TOOL,
      text: parsed.value.text,
      ...(parsed.value.title === undefined ? {} : { title: parsed.value.title }),
      ...(parsed.value.icon === undefined ? {} : { icon: parsed.value.icon }),
      ...(parsed.value.meta === undefined ? {} : { meta: parsed.value.meta }),
      blocks: parsed.value.blocks,
    };
  }
  if (toolName === FETCH_MEDIA_TOOL) {
    const parsed = decodeToolArguments(FetchMediaArgsSchema, parsedJson);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }
    return {
      ok: true,
      tool: FETCH_MEDIA_TOOL,
      url: parsed.value.url,
      kind: parsed.value.kind,
      ...(parsed.value.name === undefined ? {} : { name: parsed.value.name }),
    };
  }
  if (toolName === BASH_TOOL) {
    const parsed = decodeToolArguments(BashArgsSchema, parsedJson);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }
    return {
      ok: true,
      tool: BASH_TOOL,
      args: {
        command: parsed.value.command,
        ...(parsed.value.cwd === undefined ? {} : { cwd: parsed.value.cwd }),
        ...(parsed.value.timeout_ms === undefined ? {} : { timeout_ms: parsed.value.timeout_ms }),
      },
    };
  }
  if (toolName === READ_TOOL) {
    const parsed = decodeToolArguments(ReadArgsSchema, parsedJson);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }
    return {
      ok: true,
      tool: READ_TOOL,
      args: {
        path: parsed.value.path,
        ...(parsed.value.offset === undefined ? {} : { offset: parsed.value.offset }),
        ...(parsed.value.limit === undefined ? {} : { limit: parsed.value.limit }),
      },
    };
  }
  if (toolName === WRITE_TOOL) {
    const parsed = decodeToolArguments(WriteArgsSchema, parsedJson);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }
    return {
      ok: true,
      tool: WRITE_TOOL,
      args: { path: parsed.value.path, content: parsed.value.content },
    };
  }
  if (toolName === EDIT_TOOL) {
    const parsed = decodeToolArguments(EditArgsSchema, parsedJson);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }
    return {
      ok: true,
      tool: EDIT_TOOL,
      args: {
        path: parsed.value.path,
        oldString: parsed.value.oldString,
        newString: parsed.value.newString,
        ...(parsed.value.replaceAll === undefined ? {} : { replaceAll: parsed.value.replaceAll }),
      },
    };
  }
  if (toolName === GREP_TOOL) {
    const parsed = decodeToolArguments(GrepArgsSchema, parsedJson);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }
    return {
      ok: true,
      tool: GREP_TOOL,
      args: {
        pattern: parsed.value.pattern,
        ...(parsed.value.path === undefined ? {} : { path: parsed.value.path }),
        ...(parsed.value.glob === undefined ? {} : { glob: parsed.value.glob }),
        ...(parsed.value.max_results === undefined
          ? {}
          : { max_results: parsed.value.max_results }),
      },
    };
  }
  if (toolName === GLOB_TOOL) {
    const parsed = decodeToolArguments(GlobArgsSchema, parsedJson);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }
    return {
      ok: true,
      tool: GLOB_TOOL,
      args: {
        pattern: parsed.value.pattern,
        ...(parsed.value.path === undefined ? {} : { path: parsed.value.path }),
      },
    };
  }
  if (toolName === GIT_TOOL) {
    const parsed = decodeToolArguments(GitArgsSchema, parsedJson);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason };
    }
    return { ok: true, tool: GIT_TOOL, args: { args: parsed.value.args } };
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
