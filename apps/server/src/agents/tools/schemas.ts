import { Schema, SchemaGetter } from 'effect';
import { BlockIconSchema, struct } from '@zilar/protocol';

export const UPDATE_PERSONA_TOOL = 'update_persona';
export const REVERT_PERSONA_TOOL = 'revert_persona';
export const REQUEST_ACTION_TOOL = 'request_action';
export const RECALL_TOOL = 'recall';
export const MEMORY_ZOOM_TOOL = 'memory_zoom';
export const REMEMBER_TOOL = 'remember';
export const DELEGATE_TOOL = 'delegate';
export const TASK_STATUS_TOOL = 'task_status';
export const ASK_PEOPLE_TOOL = 'ask_people';
export const POST_BLOCKS_TOOL = 'post_blocks';
export const FETCH_MEDIA_TOOL = 'fetch_media';
export const SAVE_TEXT_MEDIA_TOOL = 'save_text_media';

const ASK_PEOPLE_QUESTION_MAX_LENGTH = 140;
const ASK_PEOPLE_OPTION_MIN = 2;
const ASK_PEOPLE_OPTION_MAX = 4;
const ASK_PEOPLE_OPTION_MAX_LENGTH = 24;

const POST_BLOCKS_TEXT_MAX_LENGTH = 1000;
const POST_BLOCKS_TITLE_MAX_LENGTH = 120;
const POST_BLOCKS_META_MAX_LENGTH = 40;
const POST_BLOCKS_BLOCK_MIN = 1;
const POST_BLOCKS_BLOCK_MAX = 6;

const FETCH_MEDIA_URL_MAX_LENGTH = 2048;
const FETCH_MEDIA_NAME_MAX_LENGTH = 100;

const SAVE_TEXT_MEDIA_NAME_MAX_LENGTH = 100;
const SAVE_TEXT_MEDIA_CONTENT_MAX_LENGTH = 65_536;

export const SAVE_TEXT_MEDIA_FORMATS = ['csv', 'txt', 'md', 'json'] as const;

export type SaveTextMediaFormat = (typeof SAVE_TEXT_MEDIA_FORMATS)[number];

export const BASH_TOOL = 'bash';
export const READ_TOOL = 'read';
export const WRITE_TOOL = 'write';
export const EDIT_TOOL = 'edit';
export const GREP_TOOL = 'grep';
export const GLOB_TOOL = 'glob';
export const GIT_TOOL = 'git';

export const DESK_TOOL_NAMES = [
  BASH_TOOL,
  READ_TOOL,
  WRITE_TOOL,
  EDIT_TOOL,
  GREP_TOOL,
  GLOB_TOOL,
  GIT_TOOL,
] as const;

export type DeskToolName = (typeof DESK_TOOL_NAMES)[number];

export function isDeskToolName(name: string): name is DeskToolName {
  return (DESK_TOOL_NAMES as readonly string[]).includes(name);
}

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

// Trim before the checks so padded input is validated and stored without its
// padding. A plain `Schema.Trim` would hide those checks from the JSON Schema
// the model reads.
const TrimmedString = Schema.String.pipe(
  Schema.decode({
    decode: SchemaGetter.transform((value: string) => value.trim()),
    encode: SchemaGetter.transform((value: string) => value),
  }),
);

export const UpdatePersonaArgsSchema = struct({
  persona: TrimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(PERSONA_MAX_LENGTH)),
  summary: TrimmedString.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(PERSONA_SUMMARY_MAX_LENGTH),
  ),
});

export const RevertPersonaArgsSchema = struct({}).check(
  Schema.makeFilter((value) =>
    Object.keys(value).length === 0
      ? undefined
      : `Unrecognized key: "${String(Object.keys(value)[0])}"`,
  ),
);

export const RecallArgsSchema = struct({
  query: TrimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
});

// The block id shape OptMem uses (`64-79`): one open, one close, both capped
// at 9 digits so an absurd id is a parse failure, never a bad query.
export const MemoryZoomArgsSchema = struct({
  block: Schema.String.check(Schema.isPattern(/^\d{1,9}-\d{1,9}$/u)),
});

export const RememberArgsSchema = struct({
  text: TrimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(280)),
});

export const DelegateArgsSchema = struct({
  to: TrimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  objective: TrimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
  context_summary: Schema.optional(TrimmedString.check(Schema.isMaxLength(1200))),
  acceptance: Schema.optional(
    Schema.mutable(
      Schema.Array(TrimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(300))),
    ).check(Schema.isMaxLength(10)),
  ),
  return_format: Schema.optional(TrimmedString.check(Schema.isMaxLength(200))),
});

export const TaskStatusArgsSchema = struct({
  task_id: TrimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
});

export const DESK_PATH_MAX_LENGTH = 1024;
export const DESK_COMMAND_MAX_LENGTH = 8000;
export const DESK_CONTENT_MAX_LENGTH = 1_000_000;
export const DESK_TIMEOUT_MAX_MS = 600_000;

const deskPath = TrimmedString.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(DESK_PATH_MAX_LENGTH),
);

export const BashArgsSchema = struct({
  command: TrimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(DESK_COMMAND_MAX_LENGTH)),
  cwd: Schema.optional(deskPath),
  timeout_ms: Schema.optional(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(DESK_TIMEOUT_MAX_MS),
    ),
  ),
});

export const ReadArgsSchema = struct({
  path: deskPath,
  offset: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
  limit: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
});

export const WriteArgsSchema = struct({
  path: deskPath,
  content: Schema.String.check(Schema.isMaxLength(DESK_CONTENT_MAX_LENGTH)),
});

export const EditArgsSchema = struct({
  path: deskPath,
  oldString: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(DESK_CONTENT_MAX_LENGTH),
  ),
  newString: Schema.String.check(Schema.isMaxLength(DESK_CONTENT_MAX_LENGTH)),
  replaceAll: Schema.optional(Schema.Boolean),
});

export const GrepArgsSchema = struct({
  pattern: TrimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
  path: Schema.optional(deskPath),
  glob: Schema.optional(TrimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(512))),
  max_results: Schema.optional(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(1000),
    ),
  ),
});

export const GlobArgsSchema = struct({
  pattern: TrimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
  path: Schema.optional(deskPath),
});

export const GitArgsSchema = struct({
  args: Schema.mutable(
    Schema.Array(TrimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(1024))),
  ).check(Schema.isMaxLength(64)),
});

// `args` is a JSON object (never an array, never a primitive): a JSON
// object is the shape every adapter's zod schema expects. `action` rides
// through to the gateway unchanged, but its pattern is checked so a
// crafted model call cannot smuggle a foreign name into the registry.
export const RequestActionArgsSchema = struct({
  action: TrimmedString.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(ACTION_NAME_MAX_LENGTH),
    Schema.isPattern(ACTION_NAME_PATTERN),
  ),
  // Effect drops `additionalProperties: true` because it is the JSON Schema
  // default; the model's parameters spell it out, so keep it as an annotation.
  args: Schema.Record(Schema.String, Schema.Unknown).annotate({ additionalProperties: true }),
});

export const AskPeopleArgsSchema = struct({
  question: TrimmedString.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(ASK_PEOPLE_QUESTION_MAX_LENGTH),
  ),
  options: Schema.mutable(
    Schema.Array(
      TrimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(ASK_PEOPLE_OPTION_MAX_LENGTH)),
    ),
  ).check(Schema.isMinLength(ASK_PEOPLE_OPTION_MIN), Schema.isMaxLength(ASK_PEOPLE_OPTION_MAX)),
});

export const PostBlocksArgsSchema = struct({
  text: TrimmedString.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(POST_BLOCKS_TEXT_MAX_LENGTH),
  ).annotate({ description: 'The plain summary shown in previews and notifications.' }),
  title: Schema.optional(TrimmedString.check(Schema.isMaxLength(POST_BLOCKS_TITLE_MAX_LENGTH))),
  icon: Schema.optional(Schema.Literals([...BlockIconSchema.literals])),
  meta: Schema.optional(TrimmedString.check(Schema.isMaxLength(POST_BLOCKS_META_MAX_LENGTH))),
  blocks: Schema.mutable(Schema.Array(Schema.Record(Schema.String, Schema.Unknown))).check(
    Schema.isMinLength(POST_BLOCKS_BLOCK_MIN),
    Schema.isMaxLength(POST_BLOCKS_BLOCK_MAX),
  ),
});

export const FetchMediaArgsSchema = struct({
  url: TrimmedString.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(FETCH_MEDIA_URL_MAX_LENGTH),
  ).annotate({ description: 'An https URL.' }),
  kind: Schema.Literals(['image', 'file']).annotate({
    description: 'Image media render inline; file media get a download card.',
  }),
  name: Schema.optional(
    TrimmedString.check(Schema.isMaxLength(FETCH_MEDIA_NAME_MAX_LENGTH)).annotate({
      description: 'The display name people see; defaults to the URL name.',
    }),
  ),
});

export const SaveTextMediaArgsSchema = struct({
  name: TrimmedString.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(SAVE_TEXT_MEDIA_NAME_MAX_LENGTH),
  ).annotate({
    description: 'The display name; the format extension is added when it is missing.',
  }),
  format: Schema.Literals(SAVE_TEXT_MEDIA_FORMATS).annotate({
    description: 'The file type: csv, txt, md or json.',
  }),
  content: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(SAVE_TEXT_MEDIA_CONTENT_MAX_LENGTH),
  ).annotate({ description: 'The text to save, unchanged.' }),
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
  | { ok: true; tool: typeof ASK_PEOPLE_TOOL; question: string; options: string[] }
  | {
      ok: true;
      tool: typeof POST_BLOCKS_TOOL;
      text: string;
      title?: string;
      icon?: string;
      meta?: string;
      blocks: unknown[];
    }
  | { ok: true; tool: typeof FETCH_MEDIA_TOOL; url: string; kind: 'image' | 'file'; name?: string }
  | {
      ok: true;
      tool: typeof SAVE_TEXT_MEDIA_TOOL;
      name: string;
      format: SaveTextMediaFormat;
      content: string;
    }
  | { ok: true; tool: DeskToolName; args: Record<string, unknown> }
  | { ok: false; reason: string };
