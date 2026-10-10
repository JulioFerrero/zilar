// The agent tool names, argument schemas, tool definitions and reply lines
// used to live here. T-1029 split the body into `tools/schemas.ts` (the tool
// names, caps and Effect argument schemas), `tools/parse.ts` (the raw tool-call
// argument decoder), `tools/definitions.ts` (the `ChatToolDefinition` objects
// and the `build*` helpers) and `tools/reply-lines.ts` (the reply lines the
// gateway appends). This path stays a thin barrel so every importer keeps
// working with the same names and kinds.
export {
  ACTION_NAME_MAX_LENGTH,
  DELEGATE_TOOL,
  MEMORY_ZOOM_TOOL,
  PERSONA_MAX_LENGTH,
  PERSONA_SUMMARY_MAX_LENGTH,
  RECALL_TOOL,
  REMEMBERED_FACT_MAX_LENGTH,
  REMEMBER_TOOL,
  REQUEST_ACTION_TOOL,
  REVERT_PERSONA_TOOL,
  TASK_STATUS_TOOL,
  UPDATE_PERSONA_TOOL,
  DelegateArgsSchema,
  MemoryZoomArgsSchema,
  RecallArgsSchema,
  RememberArgsSchema,
  RequestActionArgsSchema,
  RevertPersonaArgsSchema,
  TaskStatusArgsSchema,
  UpdatePersonaArgsSchema,
} from './tools/schemas';
export type { ParsedToolArguments } from './tools/schemas';

export { TOOL_NAME_MAX_LENGTH, parseToolArguments, safeToolName } from './tools/parse';

export type { ChatToolDefinition } from './tools/definitions';
export {
  MEMORY_TOOLS,
  PERSONA_TOOLS,
  TASK_STATUS_TOOL_DEF,
  buildDelegateTool,
  buildGroupTools,
  buildRequestActionTool,
  buildTools,
} from './tools/definitions';

export {
  PERSONA_RESTORED_LINE,
  formatPersonaUpdatedLine,
  formatRememberedLine,
  sanitizeSummary,
} from './tools/reply-lines';
