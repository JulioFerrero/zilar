import { Schema } from 'effect';
import { struct } from '@zilar/protocol';

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

export const UpdatePersonaArgsSchema = struct({
  persona: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(PERSONA_MAX_LENGTH)),
  summary: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(PERSONA_SUMMARY_MAX_LENGTH)),
});

export const RevertPersonaArgsSchema = struct({}).check(
  Schema.makeFilter((value) =>
    Object.keys(value).length === 0
      ? undefined
      : `Unrecognized key: "${String(Object.keys(value)[0])}"`,
  ),
);

export const RecallArgsSchema = struct({
  query: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
});

// The block id shape OptMem uses (`64-79`): one open, one close, both capped
// at 9 digits so an absurd id is a parse failure, never a bad query.
export const MemoryZoomArgsSchema = struct({
  block: Schema.String.check(Schema.isPattern(/^\d{1,9}-\d{1,9}$/)),
});

export const RememberArgsSchema = struct({
  text: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(280)),
});

// T-0482: the `delegate` tool's arguments. `objective` is the only required
// text; the rest are hints. `to` is an AI id from the roster that the tool
// description lists, never a name taken from model output. The service caps
// and cuts these values itself, so the schema only rejects out-of-shape input.
export const DelegateArgsSchema = struct({
  to: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  objective: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
  context_summary: Schema.optional(Schema.Trim.check(Schema.isMaxLength(1200))),
  acceptance: Schema.optional(
    Schema.mutable(
      Schema.Array(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(300))),
    ).check(Schema.isMaxLength(10)),
  ),
  return_format: Schema.optional(Schema.Trim.check(Schema.isMaxLength(200))),
});

export const TaskStatusArgsSchema = struct({
  task_id: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
});

// `args` is a JSON object (never an array, never a primitive): a JSON
// object is the shape every adapter's zod schema expects. `action` rides
// through to the gateway unchanged, but its pattern is checked so a
// crafted model call cannot smuggle a foreign name into the registry.
export const RequestActionArgsSchema = struct({
  action: Schema.Trim.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(ACTION_NAME_MAX_LENGTH),
    Schema.isPattern(ACTION_NAME_PATTERN),
  ),
  args: Schema.Record(Schema.String, Schema.Unknown),
});

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
