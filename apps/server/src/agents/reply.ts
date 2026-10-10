// The AI reply pipeline used to live here. It is split into `tool-loop.ts`
// (the model call + the tool-loop types and caps), `tool-exec.ts` (tool
// execution, the round pipeline and redaction), `dm-turn.ts` (the DM turn),
// `dm-tool-turn.ts` (the shared tool loop and the DM tool turn) and
// `group-turn.ts` (the group turn). This path stays a thin barrel so every
// importer keeps working with the same names and kinds.
export type {
  ChatToolCall,
  CompleteChatInput,
  ExecuteToolCall,
  ModelRequestMessage,
  ToolExecution,
  ValidToolCall,
} from './tool-loop';
export {
  BUDGET_EXCEEDED_REPLY,
  ChatCompletionError,
  LITELLM_CHAT_TIMEOUT_MS,
  PROVIDER_KEY_REJECTED_REPLY,
  REPLY_MAX_TOKENS,
  TOOL_CAPPED_RESULT,
  TOOL_REPEAT_RESULT,
  TOOL_RESULT_MAX_CHARS,
  TOOL_TURN_MAX_CALLS,
  TOOL_TURN_WALL_CLOCK_MS,
  TRANSIENT_FAILURE_REPLY,
} from './tool-loop';

export { mapFailureToReply } from './tool-exec';

export type { DmTurnDeps, DmTurnOutcome } from './dm-turn';
export {
  completeChat,
  dailyLimitReply,
  dailyWarningReply,
  monthlyWarningReply,
  runDmTurn,
} from './dm-turn';

export { runToolLoop } from './dm-tool-turn';

export { runGroupTurn } from './group-turn';
export type { GroupTurnDeps } from './group-turn';
