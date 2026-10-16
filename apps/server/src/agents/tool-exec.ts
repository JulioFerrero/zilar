// effect-plain: moved unchanged from apps/server/src/agents/reply.ts (size split)
import { classifyFailure } from './failure-class';
import { REQUEST_ACTION_TOOL } from './tools';
import { stripTaskTitle } from './tools/parse';
import { QUIET_TOOLS, stageForToolCall } from './tool-guide';
import {
  BUDGET_EXCEEDED_REPLY,
  CONTEXT_TOO_LONG_REPLY,
  MODEL_NOT_FOUND_REPLY,
  PROVIDER_KEY_REJECTED_REPLY,
  RATE_LIMITED_REPLY,
  TRANSIENT_FAILURE_REPLY,
} from './replies';
import {
  TOOL_CAPPED_RESULT,
  TOOL_REPEAT_RESULT,
  TOOL_RESULT_MAX_CHARS,
  type ChatCompletionResult,
  type ExecuteToolCall,
  type ModelRequestMessage,
} from './tool-loop';
import { executeToolCalls } from './tool-calls';
import { redactError } from './redact-error';
import { byteLength, redactAndTruncate, type TurnLog } from './log/append';

// AI-22: the failure class and its log fields live in `./failure-class`.
export { failureLogFields } from './failure-class';
// T-1409 review: kept re-exported here for the existing callers.
export { executeToolCalls, redactError };

// Maps any turn failure to the exact DM text. Never the raw provider body.
export function mapFailureToReply(error: unknown): string {
  switch (classifyFailure(error).kind) {
    case 'budget':
      return BUDGET_EXCEEDED_REPLY;
    case 'key_rejected':
      return PROVIDER_KEY_REJECTED_REPLY;
    case 'rate_limited':
      return RATE_LIMITED_REPLY;
    case 'model_not_found':
      return MODEL_NOT_FOUND_REPLY;
    case 'context_too_long':
      return CONTEXT_TOO_LONG_REPLY;
    default:
      return TRANSIENT_FAILURE_REPLY;
  }
}

// Builds the messages array for the second model call: the original
// conversation, the assistant turn with its raw tool calls, and every
// collected tool result in order.
export function followUpMessages(
  history: ModelRequestMessage[],
  first: ChatCompletionResult,
  toolMessages: ModelRequestMessage[],
): ModelRequestMessage[] {
  return [
    ...history,
    {
      role: 'assistant',
      content: first.content ?? '',
      tool_calls: first.toolCalls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.argsJson },
      })),
    },
    ...toolMessages,
  ];
}

// T-0106: truncates one executed tool result before it is fed back to the
// model. Summaries are already short; `modelText` inside
// `<untrusted-tool-output>` can be 16 KiB. The wrapper survives: only the
// inside is cut and the closing tag is put back, so the model still sees
// labelled data, never instructions.
const TOOL_OUTPUT_CLOSE = '\n</untrusted-tool-output>';

function truncateToolContent(content: string): string {
  if (content.length <= TOOL_RESULT_MAX_CHARS) {
    return content;
  }
  if (content.includes('<untrusted-tool-output>')) {
    const keep = TOOL_RESULT_MAX_CHARS - TOOL_OUTPUT_CLOSE.length - 1;
    return `${content.slice(0, keep)}…${TOOL_OUTPUT_CLOSE}`;
  }
  return `${content.slice(0, TOOL_RESULT_MAX_CHARS)}…`;
}

// T-0106: the per-round pipeline both loops share: dedupe repeated calls,
// report progress, execute (capped), truncate results, collect notices.
// Returns the follow-up messages for the next model call.
export async function runLoopRound(input: {
  aiId: string;
  messages: ModelRequestMessage[];
  result: ChatCompletionResult;
  previousSignature: string | null;
  executedCalls: number;
  /** T-1611: the turn's total call cap (`caps.maxCalls`). */
  maxCalls: number;
  executeTool?: ExecuteToolCall;
  executeAdvertised?: ExecuteToolCall;
  logger: { warn: (fields: Record<string, unknown>, message: string) => void };
  secrets: string[];
  reportProgress?: (stage: string, title?: string) => Promise<string | null>;
  progressPosted?: boolean;
  actionOf?: (tool: string, argsJson: string) => string | undefined;
  /** T-1426: the turn's session log. One `tool_call` and one `tool_result`
   * row are appended per executed call (redacted and truncated). */
  log?: TurnLog;
}): Promise<{
  messages: ModelRequestMessage[];
  notices: string[];
  previousSignature: string;
  executedCalls: number;
  progressPosted: boolean;
}> {
  const signature = input.result.toolCalls
    .map((call) => `${call.name}\n${call.argsJson}`)
    .join('\n');
  if (input.previousSignature !== null && input.previousSignature === signature) {
    const repeated = input.result.toolCalls.map((call) => ({
      role: 'tool' as const,
      content: TOOL_REPEAT_RESULT,
      tool_call_id: call.id,
    }));
    return {
      messages: followUpMessages(input.messages, input.result, repeated),
      notices: [],
      previousSignature: signature,
      executedCalls: input.executedCalls,
      progressPosted: input.progressPosted ?? false,
    };
  }
  let progressPosted = input.progressPosted ?? false;
  if (input.reportProgress !== undefined) {
    // T-1727: skip the memory and persona tools. A round that only recalls or
    // remembers has no stage worth a card, so it opens none; the first call
    // that is not one of them reports progress as before.
    const first = input.result.toolCalls.find((call) => !QUIET_TOOLS.has(call.name));
    if (first !== undefined) {
      const stage = stageForToolCall(first.name, input.actionOf?.(first.name, first.argsJson));
      // T-1745: the first call of the round may carry the model's own task
      // title. It names the card only; it is never logged and never reaches
      // a tool (parse.ts strips it before the decode).
      const title = taskTitleOfCall(first.argsJson);
      try {
        await input.reportProgress(stage, title);
        progressPosted = true;
      } catch (error) {
        input.logger.warn(
          { aiId: input.aiId, err: redactError(error, input.secrets) },
          progressPosted
            ? 'AI progress message could not be updated'
            : 'AI progress message could not be posted',
        );
      }
    }
  }
  const remaining = input.maxCalls - input.executedCalls;
  const runnable = input.result.toolCalls.slice(0, Math.max(0, remaining));
  const dropped = input.result.toolCalls.slice(runnable.length);
  const { toolMessages, notices, stages, outcomes } = await executeToolCalls({
    toolCalls: runnable,
    aiId: input.aiId,
    ...(input.executeAdvertised !== undefined
      ? { executeTool: input.executeAdvertised }
      : input.executeTool === undefined
        ? {}
        : { executeTool: input.executeTool }),
    logger: input.logger,
    secrets: input.secrets,
  });
  // T-1426: one pair of session-log rows per executed call — the tool name,
  // the arguments and the output redacted and truncated to 2 KiB, the byte
  // counts, the exit code and the duration. Order: tool_call then tool_result.
  if (input.log !== undefined) {
    for (let index = 0; index < runnable.length; index += 1) {
      const outcome = outcomes[index];
      const call = runnable[index];
      if (outcome === undefined || call === undefined) {
        continue;
      }
      const loggedArgs = stripTaskTitle(call.argsJson);
      input.log.append('tool_call', {
        tool: outcome.tool,
        args: redactAndTruncate(loggedArgs, input.secrets),
        args_bytes: byteLength(loggedArgs),
      });
      input.log.append(
        'tool_result',
        {
          tool: outcome.tool,
          output: redactAndTruncate(outcome.content, input.secrets),
          output_bytes: byteLength(outcome.content),
          ok: outcome.ok,
          ...(outcome.exitCode === undefined ? {} : { exit_code: outcome.exitCode }),
          ...(outcome.approvalId === undefined ? {} : { approval_id: outcome.approvalId }),
        },
        outcome.durationMs,
      );
    }
  }
  // T-1409: a call may report a new stage after it ran (for example
  // "Waiting for a computer" while the desk is queued). Report the last one,
  // best effort, exactly like the pre-round stage above.
  const postStage = stages[stages.length - 1];
  if (postStage !== undefined && input.reportProgress !== undefined) {
    try {
      await input.reportProgress(postStage);
      progressPosted = true;
    } catch (error) {
      input.logger.warn(
        { aiId: input.aiId, err: redactError(error, input.secrets) },
        'AI progress message could not be updated',
      );
    }
  }
  // Every dropped call still gets a result: without one the follow-up
  // history carries an assistant `tool_calls` entry with no matching
  // `tool` message. The capped notice is fixed text (no ids, no args), so
  // truncation is a no-op but keeps the pipeline uniform.
  const cappedMessages = dropped.map((call) => ({
    role: 'tool' as const,
    content: TOOL_CAPPED_RESULT,
    tool_call_id: call.id,
  }));
  return {
    messages: followUpMessages(
      input.messages,
      input.result,
      [...toolMessages, ...cappedMessages].map((message) => ({
        ...message,
        content: truncateToolContent(message.content),
      })),
    ),
    notices,
    previousSignature: signature,
    executedCalls: input.executedCalls + runnable.length,
    progressPosted,
  };
}

// T-0106: reads the adapter name out of a `request_action` call's arguments
// for the progress stage lookup. Anything unparsable (or any other tool)
// yields undefined, and the stage falls back to the tool name's entry.
export function actionOfCall(tool: string, argsJson: string): string | undefined {
  if (tool !== REQUEST_ACTION_TOOL) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(argsJson);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const action = (parsed as { action?: unknown }).action;
      if (typeof action === 'string' && action !== '') {
        return action;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

// T-1745: reads the model's optional `task_title` out of one call's arguments,
// the way `actionOfCall` reads `request_action`'s action. It is cleaned to one
// plain line of at most 40 characters; a blank or unparsable title is dropped.
export const TASK_TITLE_MAX_LENGTH = 40;

export function taskTitleOfCall(argsJson: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  const raw = (parsed as { task_title?: unknown }).task_title;
  return typeof raw === 'string' ? sanitizeTaskTitle(raw) : undefined;
}

function sanitizeTaskTitle(raw: string): string | undefined {
  let out = '';
  for (const char of raw.replace(/\s+/g, ' ').trim()) {
    const code = char.codePointAt(0) ?? 32;
    if (code >= 32 && code !== 127) {
      out += char;
    }
  }
  const clean = out.trim();
  return clean === '' ? undefined : clean.slice(0, TASK_TITLE_MAX_LENGTH);
}
