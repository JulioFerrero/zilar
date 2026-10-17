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
// T-1576: the `ask_people` tool asks the people in a room one question with
// 2-4 short reply options (plan §7 step 4). The stored question and options
// share the caps `questions/service.ts` enforces, so a valid parse is a valid
// row.
export const ASK_PEOPLE_TOOL = 'ask_people';
// T-1758: the `post_blocks` tool posts a small native card (the six Wave 1
// kinds) in a group room. Offered on every group turn, routine runs included.
export const POST_BLOCKS_TOOL = 'post_blocks';
// T-1873: the `fetch_media` tool fetches one https image or file and stores it
// under the chat's media key, so the model can cite the id in an `images` or
// `file` block. Offered wherever `post_blocks` is.
export const FETCH_MEDIA_TOOL = 'fetch_media';
// T-1883: the `save_text_media` tool stores text the model wrote (CSV, plain
// text, Markdown or JSON) as card media, so a card can offer it as a download.
// Offered wherever `fetch_media` is, and both share one per-turn budget.
export const SAVE_TEXT_MEDIA_TOOL = 'save_text_media';

const ASK_PEOPLE_QUESTION_MAX_LENGTH = 140;
const ASK_PEOPLE_OPTION_MIN = 2;
const ASK_PEOPLE_OPTION_MAX = 4;
const ASK_PEOPLE_OPTION_MAX_LENGTH = 24;

// T-1758: the `post_blocks` caps. The body is the plain summary clients show in
// previews and notifications; the three optional strings ride on the card. The
// blocks themselves are checked by `buildBlocksPayload`, not here.
const POST_BLOCKS_TEXT_MAX_LENGTH = 1000;
const POST_BLOCKS_TITLE_MAX_LENGTH = 120;
const POST_BLOCKS_ICON_MAX_LENGTH = 40;
const POST_BLOCKS_META_MAX_LENGTH = 40;
const POST_BLOCKS_BLOCK_MIN = 1;
const POST_BLOCKS_BLOCK_MAX = 6;

// T-1873: the `fetch_media` caps. The url limit matches
// `CARD_MEDIA_URL_MAX_LENGTH` in `card-media/fetch.ts`, which refuses anything
// longer before the fetch.
const FETCH_MEDIA_URL_MAX_LENGTH = 2048;
const FETCH_MEDIA_NAME_MAX_LENGTH = 100;

// T-1883: the `save_text_media` caps. The content limit matches the runner's
// 65,536-byte check, and the four formats map to fixed mimes there.
const SAVE_TEXT_MEDIA_NAME_MAX_LENGTH = 100;
const SAVE_TEXT_MEDIA_CONTENT_MAX_LENGTH = 65_536;

export const SAVE_TEXT_MEDIA_FORMATS = ['csv', 'txt', 'md', 'json'] as const;

export type SaveTextMediaFormat = (typeof SAVE_TEXT_MEDIA_FORMATS)[number];

// T-1409: the desk tools, offered only when the AI has a cloud computer. The
// names match the daemon's tool table (`packages/desk/README.md`) and OpenCode's
// where they overlap (plan §3.3).
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

/** True for one of the seven desk tool names; used by the parser and executor. */
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

// T-1409: the desk tools' arguments. They mirror the daemon's tool table
// (`packages/desk/README.md`); the daemon validates them again, so these are
// only the shape checks that turn a bad model call into `invalid: …`.
export const DESK_PATH_MAX_LENGTH = 1024;
export const DESK_COMMAND_MAX_LENGTH = 8000;
export const DESK_CONTENT_MAX_LENGTH = 1_000_000;
export const DESK_TIMEOUT_MAX_MS = 600_000;

const deskPath = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(DESK_PATH_MAX_LENGTH));

export const BashArgsSchema = struct({
  command: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(DESK_COMMAND_MAX_LENGTH)),
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
  pattern: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
  path: Schema.optional(deskPath),
  glob: Schema.optional(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(512))),
  max_results: Schema.optional(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(1000),
    ),
  ),
});

export const GlobArgsSchema = struct({
  pattern: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
  path: Schema.optional(deskPath),
});

export const GitArgsSchema = struct({
  args: Schema.mutable(
    Schema.Array(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(1024))),
  ).check(Schema.isMaxLength(64)),
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

// T-1576: the `ask_people` arguments: one question and 2-4 short options. The
// service trims and validates them again, so this is only the shape check.
export const AskPeopleArgsSchema = struct({
  question: Schema.Trim.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(ASK_PEOPLE_QUESTION_MAX_LENGTH),
  ),
  options: Schema.mutable(
    Schema.Array(
      Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(ASK_PEOPLE_OPTION_MAX_LENGTH)),
    ),
  ).check(Schema.isMinLength(ASK_PEOPLE_OPTION_MIN), Schema.isMaxLength(ASK_PEOPLE_OPTION_MAX)),
});

// T-1758: the `post_blocks` arguments. `text` is the required plain summary;
// `title`, `icon` and `meta` are optional card strings. `blocks` is only
// counted here — `buildBlocksPayload` validates the real block shapes, so a bad
// block comes back as a short reason the model can fix.
export const PostBlocksArgsSchema = struct({
  text: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(POST_BLOCKS_TEXT_MAX_LENGTH)),
  title: Schema.optional(Schema.Trim.check(Schema.isMaxLength(POST_BLOCKS_TITLE_MAX_LENGTH))),
  icon: Schema.optional(Schema.Trim.check(Schema.isMaxLength(POST_BLOCKS_ICON_MAX_LENGTH))),
  meta: Schema.optional(Schema.Trim.check(Schema.isMaxLength(POST_BLOCKS_META_MAX_LENGTH))),
  blocks: Schema.mutable(Schema.Array(Schema.Unknown)).check(
    Schema.isMinLength(POST_BLOCKS_BLOCK_MIN),
    Schema.isMaxLength(POST_BLOCKS_BLOCK_MAX),
  ),
});

// T-1873: the `fetch_media` arguments: one https url, the kind the model
// promises (the bytes are sniffed again) and an optional display name.
export const FetchMediaArgsSchema = struct({
  url: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(FETCH_MEDIA_URL_MAX_LENGTH)),
  kind: Schema.Literals(['image', 'file']),
  name: Schema.optional(Schema.Trim.check(Schema.isMaxLength(FETCH_MEDIA_NAME_MAX_LENGTH))),
});

// T-1883: the `save_text_media` arguments: the display name without its
// extension (the runner appends it), one of four formats and the text itself.
export const SaveTextMediaArgsSchema = struct({
  name: Schema.Trim.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(SAVE_TEXT_MEDIA_NAME_MAX_LENGTH),
  ),
  format: Schema.Literals(SAVE_TEXT_MEDIA_FORMATS),
  content: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(SAVE_TEXT_MEDIA_CONTENT_MAX_LENGTH),
  ),
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
