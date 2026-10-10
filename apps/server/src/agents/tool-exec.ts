// effect-plain: moved unchanged from apps/server/src/agents/reply.ts (size split)
import { LitellmApiError, redactSecrets } from '../ai/litellm-client';
import {
  DELEGATE_TOOL,
  MEMORY_ZOOM_TOOL,
  RECALL_TOOL,
  REMEMBER_TOOL,
  REQUEST_ACTION_TOOL,
  REVERT_PERSONA_TOOL,
  TASK_STATUS_TOOL,
  UPDATE_PERSONA_TOOL,
  parseToolArguments,
  safeToolName,
  type ParsedToolArguments,
} from './tools';
import { stageForToolCall } from './tool-guide';
import {
  BUDGET_EXCEEDED_REPLY,
  ChatCompletionError,
  PROVIDER_KEY_REJECTED_REPLY,
  TOOL_CAPPED_RESULT,
  TOOL_REPEAT_RESULT,
  TOOL_RESULT_MAX_CHARS,
  TOOL_TURN_MAX_CALLS,
  TRANSIENT_FAILURE_REPLY,
  type ChatCompletionResult,
  type ChatToolCall,
  type ExecuteToolCall,
  type ModelRequestMessage,
  type ToolExecution,
  type ValidToolCall,
} from './tool-loop';

function statusAndDetail(error: unknown): { status: number; detail: string } {
  if (error instanceof ChatCompletionError) {
    return { status: error.status, detail: error.detail };
  }
  if (error instanceof LitellmApiError) {
    return { status: error.status, detail: error.message };
  }
  return { status: 0, detail: error instanceof Error ? error.message : String(error) };
}

// Maps any turn failure to the exact DM text. Never the raw provider body.
export function mapFailureToReply(error: unknown): string {
  const { status, detail } = statusAndDetail(error);
  if (status === 429 || /budget_exceeded/i.test(detail)) {
    return BUDGET_EXCEEDED_REPLY;
  }
  if (status === 401 || status === 403) {
    return PROVIDER_KEY_REJECTED_REPLY;
  }
  return TRANSIENT_FAILURE_REPLY;
}

// Parses one raw tool call's `arguments`, runs the executor on it, and turns
// the result into a `tool` message plus an optional persona notice. Shared by
// the DM and the group tool loop (T-0098) so they run the exact same
// validation and redaction rules. A thrown executor becomes a
// `failed: could not save` message and the next call still runs.
async function executeOneToolCall(
  call: ChatToolCall,
  context: {
    aiId: string;
    executeTool?: ExecuteToolCall;
    logger: { warn: (fields: Record<string, unknown>, message: string) => void };
    secrets: readonly string[];
  },
): Promise<{ message: ModelRequestMessage; notice?: string }> {
  const parsed = parseToolArguments(call.name, call.argsJson);
  if (!parsed.ok) {
    // Never executed. The arguments stay out of the log entirely: only the
    // tool name travels with the AI id, never the persona text.
    context.logger.warn(
      { aiId: context.aiId, tool: safeToolName(call.name) },
      'AI tool call was not executed',
    );
    return {
      message: { role: 'tool', content: `invalid: ${parsed.reason}`, tool_call_id: call.id },
    };
  }
  if (context.executeTool === undefined) {
    context.logger.warn(
      { aiId: context.aiId, tool: safeToolName(call.name) },
      'AI tool call was not executed',
    );
    return {
      message: {
        role: 'tool',
        content: `invalid: unknown tool: ${safeToolName(call.name)}`,
        tool_call_id: call.id,
      },
    };
  }
  let execution: ToolExecution;
  try {
    execution = await context.executeTool(toCall(parsed, call.id));
  } catch (error) {
    // One call failing must not drop the others or the notices already
    // earned: the change (if any) stays, this call reports a failure, and
    // the loop continues with the remaining calls.
    context.logger.warn(
      {
        aiId: context.aiId,
        tool: safeToolName(call.name),
        ok: false,
        err: redactError(error, context.secrets),
      },
      'AI tool call failed',
    );
    return {
      message: { role: 'tool', content: 'failed: could not save', tool_call_id: call.id },
    };
  }
  return {
    message: { role: 'tool', content: execution.content, tool_call_id: call.id },
    ...(execution.notice === undefined ? {} : { notice: execution.notice }),
  };
}

// Runs every parsed tool call through the executor, in order. Returns the
// follow-up `tool` messages and the persona notices that ride along on the
// final text. Both the DM and the group tool loops call this so they share
// one validation + execution pipeline.
export async function executeToolCalls(input: {
  toolCalls: ChatToolCall[];
  aiId: string;
  executeTool?: ExecuteToolCall;
  logger: { warn: (fields: Record<string, unknown>, message: string) => void };
  secrets: readonly string[];
}): Promise<{ toolMessages: ModelRequestMessage[]; notices: string[] }> {
  const toolMessages: ModelRequestMessage[] = [];
  const notices: string[] = [];
  for (const call of input.toolCalls) {
    const { message, notice } = await executeOneToolCall(call, {
      aiId: input.aiId,
      ...(input.executeTool === undefined ? {} : { executeTool: input.executeTool }),
      logger: input.logger,
      secrets: input.secrets,
    });
    toolMessages.push(message);
    if (notice !== undefined) {
      notices.push(notice);
    }
  }
  return { toolMessages, notices };
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
  executeTool?: ExecuteToolCall;
  executeAdvertised?: ExecuteToolCall;
  logger: { warn: (fields: Record<string, unknown>, message: string) => void };
  secrets: string[];
  reportProgress?: (stage: string) => Promise<string | null>;
  progressPosted?: boolean;
  actionOf?: (tool: string, argsJson: string) => string | undefined;
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
    const first = input.result.toolCalls[0];
    if (first !== undefined) {
      const stage = stageForToolCall(first.name, input.actionOf?.(first.name, first.argsJson));
      try {
        await input.reportProgress(stage);
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
  const remaining = TOOL_TURN_MAX_CALLS - input.executedCalls;
  const runnable = input.result.toolCalls.slice(0, Math.max(0, remaining));
  const dropped = input.result.toolCalls.slice(runnable.length);
  const { toolMessages, notices } = await executeToolCalls({
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

// Lifts a parsed `request_action` / `update_persona` / `revert_persona` /
// memory-tool shape into the `ValidToolCall` the executor understands. The
// call id comes from the wire; everything else is already validated by zod.
// T-0482: the delegation tools fold their snake_case arguments into the
// camelCase shape the executor uses.
function toCall(parsed: ParsedToolArgumentsOk, id: string): ValidToolCall {
  if (parsed.tool === UPDATE_PERSONA_TOOL) {
    return {
      id,
      tool: UPDATE_PERSONA_TOOL,
      persona: parsed.persona,
      summary: parsed.summary,
    };
  }
  if (parsed.tool === REVERT_PERSONA_TOOL) {
    return { id, tool: REVERT_PERSONA_TOOL };
  }
  if (parsed.tool === RECALL_TOOL) {
    return { id, tool: RECALL_TOOL, query: parsed.query };
  }
  if (parsed.tool === MEMORY_ZOOM_TOOL) {
    return { id, tool: MEMORY_ZOOM_TOOL, block: parsed.block };
  }
  if (parsed.tool === REMEMBER_TOOL) {
    return { id, tool: REMEMBER_TOOL, text: parsed.text };
  }
  if (parsed.tool === DELEGATE_TOOL) {
    return {
      id,
      tool: DELEGATE_TOOL,
      toAiId: parsed.to,
      objective: parsed.objective,
      ...(parsed.context_summary === undefined ? {} : { contextSummary: parsed.context_summary }),
      ...(parsed.acceptance === undefined ? {} : { acceptance: parsed.acceptance }),
      ...(parsed.return_format === undefined ? {} : { returnFormat: parsed.return_format }),
    };
  }
  if (parsed.tool === TASK_STATUS_TOOL) {
    return { id, tool: TASK_STATUS_TOOL, taskId: parsed.task_id };
  }
  return {
    id,
    tool: REQUEST_ACTION_TOOL,
    action: parsed.action,
    args: parsed.args,
  };
}

// A narrowed view of `ParsedToolArguments` for the cases that have already
// been verified `ok: true`; the helper above only runs in that branch.
type ParsedToolArgumentsOk = Extract<ParsedToolArguments, { ok: true }>;

// Rebuilds the error with every secret redacted out of its message, so the
// logger (which prints `err.message` and `err.stack`) can never leak a key.
// Assert on `err.message` and `err.stack`, never on `JSON.stringify(err)`.
export function redactError(error: unknown, secrets: readonly string[]): Error {
  if (error instanceof Error) {
    const redacted = new Error(redactSecrets(error.message, secrets));
    redacted.name = error.name;
    const stack = error.stack ?? '';
    const messageIndex = stack.indexOf(error.message);
    redacted.stack =
      messageIndex < 0
        ? redactSecrets(stack, secrets)
        : `${stack.slice(0, messageIndex)}${redactSecrets(error.message, secrets)}${redactSecrets(stack.slice(messageIndex + error.message.length), secrets)}`;
    return redacted;
  }
  return new Error(redactSecrets(String(error), secrets));
}
