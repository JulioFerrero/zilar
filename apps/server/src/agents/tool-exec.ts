// effect-plain: this module's public edge stays Promise-shaped.
import type { ModelCallResult } from '../ai/model-client';
import { REQUEST_ACTION_TOOL } from './tools/schemas';
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
  type ExecuteToolCall,
  type ModelRequestMessage,
  ChatCompletionError,
} from './tool-loop';
import { executeToolCalls } from './tool-calls';
import { redactError } from './redact-error';
import { byteLength, redactAndTruncate, type TurnLog } from './log/append';

type AiFailureKind =
  | 'budget'
  | 'key_rejected'
  | 'rate_limited'
  | 'model_not_found'
  | 'context_too_long'
  | 'timeout'
  | 'provider_error'
  | 'other';

interface AiFailureClass {
  kind: AiFailureKind;
  /** HTTP status when the provider answered with one; 0 when there is none. */
  status: number;
}

function statusAndDetail(error: unknown): { status: number; detail: string } {
  if (error instanceof ChatCompletionError) {
    return { status: error.status, detail: error.detail };
  }
  return { status: 0, detail: error instanceof Error ? error.message : String(error) };
}

// Order matters: a provider hard cap arrives as a 400 with "Budget has been
// exceeded" (AI-4), so the budget test comes before the status ones.
function classifyFailure(error: unknown): AiFailureClass {
  const { status, detail } = statusAndDetail(error);
  if (/budget/i.test(detail)) {
    return { kind: 'budget', status };
  }
  if (status === 401 || status === 403) {
    return { kind: 'key_rejected', status };
  }
  if (status === 429) {
    return { kind: 'rate_limited', status };
  }
  if ((status === 400 || status === 404) && /model/i.test(detail)) {
    return { kind: 'model_not_found', status };
  }
  if (/context|too long|maximum context|token limit/i.test(detail)) {
    return { kind: 'context_too_long', status };
  }
  if (status === 0 && /timed out|timeout/i.test(detail)) {
    return { kind: 'timeout', status };
  }
  if (status !== 0) {
    return { kind: 'provider_error', status };
  }
  return { kind: 'other', status };
}

// The fields a failure log carries: the class and, only when the provider
// answered with one, the HTTP status. Never the provider's message (AI-22).
export function failureLogFields(error: unknown): { kind: AiFailureKind; status?: number } {
  const { kind, status } = classifyFailure(error);
  return status === 0 ? { kind } : { kind, status };
}
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

export function followUpMessages(
  history: ModelRequestMessage[],
  first: ModelCallResult,
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

export async function runLoopRound(input: {
  aiId: string;
  messages: ModelRequestMessage[];
  result: ModelCallResult;
  previousSignature: string | null;
  executedCalls: number;
  maxCalls: number;
  executeTool?: ExecuteToolCall;
  executeAdvertised?: ExecuteToolCall;
  logger: { warn: (fields: Record<string, unknown>, message: string) => void };
  secrets: string[];
  reportProgress?: (stage: string, title?: string) => Promise<string | null>;
  progressPosted?: boolean;
  actionOf?: (tool: string, argsJson: string) => string | undefined;
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
    const first = input.result.toolCalls.find((call) => !QUIET_TOOLS.has(call.name));
    if (first !== undefined) {
      const stage = stageForToolCall(first.name, input.actionOf?.(first.name, first.argsJson));
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
