// effect-plain: the tool-call pipeline split out of `tool-exec.ts` so no agent
// file exceeds the 400-line cap. A pure move: the validation, redaction and
// wording are unchanged.
import { redactError } from './redact-error';
import {
  ASK_PEOPLE_TOOL,
  DELEGATE_TOOL,
  FETCH_MEDIA_TOOL,
  MEMORY_ZOOM_TOOL,
  POST_BLOCKS_TOOL,
  RECALL_TOOL,
  REMEMBER_TOOL,
  REQUEST_ACTION_TOOL,
  REVERT_PERSONA_TOOL,
  SAVE_TEXT_MEDIA_TOOL,
  TASK_STATUS_TOOL,
  UPDATE_PERSONA_TOOL,
  isDeskToolName,
  parseToolArguments,
  safeToolName,
  type DeskToolName,
  type ParsedToolArguments,
} from './tools';
import type {
  ChatToolCall,
  ExecuteToolCall,
  ModelRequestMessage,
  ToolExecution,
  ValidToolCall,
} from './tool-loop';

// T-1426: one call's row for the session log: the safe tool name, whether it
// ran, its result text (the caller redacts and truncates it), its duration and
// the exit code when the tool ran a process.
export interface ToolCallOutcome {
  tool: string;
  ok: boolean;
  content: string;
  durationMs: number;
  exitCode?: number;
  // T-1530: the approval a `request_action` call raised, carried to the
  // session log so a step's approval decision can be joined later.
  approvalId?: string;
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
): Promise<{
  message: ModelRequestMessage;
  notice?: string;
  stage?: string;
  outcome: ToolCallOutcome;
}> {
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
      outcome: {
        tool: safeToolName(call.name),
        ok: false,
        content: `invalid: ${parsed.reason}`,
        durationMs: 0,
      },
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
      outcome: {
        tool: safeToolName(call.name),
        ok: false,
        content: `invalid: unknown tool: ${safeToolName(call.name)}`,
        durationMs: 0,
      },
    };
  }
  const startedMs = Date.now();
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
      outcome: {
        tool: safeToolName(call.name),
        ok: false,
        content: 'failed: could not save',
        durationMs: Date.now() - startedMs,
      },
    };
  }
  return {
    message: { role: 'tool', content: execution.content, tool_call_id: call.id },
    ...(execution.notice === undefined ? {} : { notice: execution.notice }),
    ...(execution.stage === undefined ? {} : { stage: execution.stage }),
    outcome: {
      tool: safeToolName(call.name),
      ok: true,
      content: execution.content,
      durationMs: Date.now() - startedMs,
      ...(execution.exitCode === undefined ? {} : { exitCode: execution.exitCode }),
      ...(execution.approvalId === undefined ? {} : { approvalId: execution.approvalId }),
    },
  };
}

// Runs every parsed tool call through the executor, in order. Returns the
// follow-up `tool` messages, the persona notices that ride along on the
// final text, and one log outcome per call (same order).
export async function executeToolCalls(input: {
  toolCalls: ChatToolCall[];
  aiId: string;
  executeTool?: ExecuteToolCall;
  logger: { warn: (fields: Record<string, unknown>, message: string) => void };
  secrets: readonly string[];
}): Promise<{
  toolMessages: ModelRequestMessage[];
  notices: string[];
  stages: string[];
  outcomes: ToolCallOutcome[];
}> {
  const toolMessages: ModelRequestMessage[] = [];
  const notices: string[] = [];
  const stages: string[] = [];
  const outcomes: ToolCallOutcome[] = [];
  for (const call of input.toolCalls) {
    const { message, notice, stage, outcome } = await executeOneToolCall(call, {
      aiId: input.aiId,
      ...(input.executeTool === undefined ? {} : { executeTool: input.executeTool }),
      logger: input.logger,
      secrets: input.secrets,
    });
    toolMessages.push(message);
    outcomes.push(outcome);
    if (notice !== undefined) {
      notices.push(notice);
    }
    if (stage !== undefined) {
      stages.push(stage);
    }
  }
  return { toolMessages, notices, stages, outcomes };
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
  if (parsed.tool === ASK_PEOPLE_TOOL) {
    return { id, tool: ASK_PEOPLE_TOOL, question: parsed.question, options: parsed.options };
  }
  if (parsed.tool === POST_BLOCKS_TOOL) {
    return {
      id,
      tool: POST_BLOCKS_TOOL,
      text: parsed.text,
      ...(parsed.title === undefined ? {} : { title: parsed.title }),
      ...(parsed.icon === undefined ? {} : { icon: parsed.icon }),
      ...(parsed.meta === undefined ? {} : { meta: parsed.meta }),
      blocks: parsed.blocks,
    };
  }
  if (parsed.tool === FETCH_MEDIA_TOOL) {
    return {
      id,
      tool: FETCH_MEDIA_TOOL,
      url: parsed.url,
      kind: parsed.kind,
      ...(parsed.name === undefined ? {} : { name: parsed.name }),
    };
  }
  if (parsed.tool === SAVE_TEXT_MEDIA_TOOL) {
    return {
      id,
      tool: SAVE_TEXT_MEDIA_TOOL,
      name: parsed.name,
      format: parsed.format,
      content: parsed.content,
    };
  }
  // T-1409: the desk tools carry their validated args straight to the executor.
  if (isDeskParsedTool(parsed)) {
    return { id, tool: parsed.tool, args: parsed.args };
  }
  return {
    id,
    tool: REQUEST_ACTION_TOOL,
    action: parsed.action,
    args: parsed.args,
  };
}

// T-1409: a parsed call is a desk call when its `tool` is one of the seven
// names. The desk variant's `tool` is a union of literals, so TypeScript cannot
// subtract it from `ParsedToolArguments` by a property check alone; this
// object-level guard narrows both the `if` and the fallthrough.
function isDeskParsedTool(
  parsed: ParsedToolArgumentsOk,
): parsed is Extract<ParsedToolArgumentsOk, { tool: DeskToolName }> {
  return isDeskToolName(parsed.tool);
}

// A narrowed view of `ParsedToolArguments` for the cases that have already
// been verified `ok: true`; the helper above only runs in that branch.
type ParsedToolArgumentsOk = Extract<ParsedToolArguments, { ok: true }>;
