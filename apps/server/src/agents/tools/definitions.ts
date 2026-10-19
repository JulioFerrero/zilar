import {
  ASK_PEOPLE_TOOL,
  AskPeopleArgsSchema,
  DELEGATE_TOOL,
  DelegateArgsSchema,
  MEMORY_ZOOM_TOOL,
  MemoryZoomArgsSchema,
  RECALL_TOOL,
  REMEMBER_TOOL,
  REQUEST_ACTION_TOOL,
  REVERT_PERSONA_TOOL,
  RecallArgsSchema,
  RememberArgsSchema,
  RequestActionArgsSchema,
  TASK_STATUS_TOOL,
  TaskStatusArgsSchema,
  UPDATE_PERSONA_TOOL,
  UpdatePersonaArgsSchema,
  POST_BLOCKS_TOOL,
  PostBlocksArgsSchema,
  FETCH_MEDIA_TOOL,
  FetchMediaArgsSchema,
  SAVE_TEXT_MEDIA_TOOL,
  SaveTextMediaArgsSchema,
  BASH_TOOL,
  BashArgsSchema,
  EDIT_TOOL,
  EditArgsSchema,
  GIT_TOOL,
  GitArgsSchema,
  GLOB_TOOL,
  GlobArgsSchema,
  GREP_TOOL,
  GrepArgsSchema,
  READ_TOOL,
  ReadArgsSchema,
  WRITE_TOOL,
  WriteArgsSchema,
} from './schemas';
import { toolParameters } from './tool-params';
import { cardGuide } from '../../message-blocks/guide';
import type { ChatToolDefinition } from '../../ai/model-client';

const DESK_TOOLS: ChatToolDefinition[] = [
  toolDefinition(
    BASH_TOOL,
    "Run a shell command on the AI's Linux computer. `command` runs in " +
      '`/bin/bash -lc`; set `cwd` to pick a working directory inside the ' +
      'workspace, and `timeout_ms` for a long command. `/workspace` persists ' +
      'between jobs and `/tmp` is scratch. The public web works through the ' +
      'built-in proxy (curl, pip, git clone) but not raw IP addresses or ' +
      'private networks. Installed: git, python3 with pip, build-essential, ' +
      'curl, jq and ripgrep. It runs as a normal user without root.',
    toolParameters(BashArgsSchema),
  ),
  toolDefinition(
    READ_TOOL,
    'Read a text file on the computer. `path` is inside the workspace; ' +
      '`offset` and `limit` read a 1-based line window.',
    toolParameters(ReadArgsSchema),
  ),
  toolDefinition(
    WRITE_TOOL,
    'Create or overwrite a file on the computer, creating parent folders. ' +
      '`content` replaces the whole file.',
    toolParameters(WriteArgsSchema),
  ),
  toolDefinition(
    EDIT_TOOL,
    'Replace one exact string in a file on the computer. It fails unless ' +
      '`oldString` is unique; set `replaceAll` to change every match.',
    toolParameters(EditArgsSchema),
  ),
  toolDefinition(
    GREP_TOOL,
    'Search file contents with ripgrep. `pattern` is a regular expression; ' +
      'narrow it with `path` and `glob`.',
    toolParameters(GrepArgsSchema),
  ),
  toolDefinition(
    GLOB_TOOL,
    'List the files on the computer that match a glob pattern, sorted.',
    toolParameters(GlobArgsSchema),
  ),
  toolDefinition(
    GIT_TOOL,
    'Run a hardened `git` on the computer. `args` is the git argument ' +
      'list, for example ["status"] or ["commit", "-m", "message"].',
    toolParameters(GitArgsSchema),
  ),
];

/** The desk tool definitions, stable across turns. */
export function deskToolDefinitions(): ChatToolDefinition[] {
  return [...DESK_TOOLS];
}
export const FETCH_MEDIA_TOOL_DEF = toolDefinition(
  FETCH_MEDIA_TOOL,
  'Fetch one https image (PNG, JPEG, WebP; at most 8 MB) or file (PDF, CSV, ' +
    'plain text; at most 25 MB) so a card can show it. Returns a media id: put ' +
    'the id in an `images` block (`items`) or a `file` block (`media`), never ' +
    'the URL.',
  toolParameters(FetchMediaArgsSchema),
);

export const SAVE_TEXT_MEDIA_TOOL_DEF = toolDefinition(
  SAVE_TEXT_MEDIA_TOOL,
  'Save text you wrote (CSV, plain text, Markdown or JSON; at most 64 KB) as a ' +
    'file people can download from a card. Returns a media id: put it in a ' +
    "`file` block's `media`.",
  toolParameters(SaveTextMediaArgsSchema),
);
export const POST_BLOCKS_TOOL_DEF = toolDefinition(
  POST_BLOCKS_TOOL,
  'Post a small native card with numbers, lists or status — not for prose. `text` ' +
    'is the plain summary people see in previews and notifications; every other ' +
    'value is a pre-formatted display string and links must be https. ' +
    'The result gives the card id; pass it to `routine.schedule` as `alert_card` ' +
    "when the card's alert drives a routine. " +
    cardGuide({ interactive: true }),
  toolParameters(PostBlocksArgsSchema),
);
export function toolDefinition(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
): ChatToolDefinition {
  return { type: 'function', function: { name, description, parameters } };
}

export const TASK_TITLE_PARAM = 'task_title';
export const TASK_TITLE_MAX_LENGTH = 40;

const TASK_TITLE_DESCRIPTION =
  'Only on your first tool call of a task: 2-4 plain words naming the whole job, ' +
  'e.g. "Check the prices".';

function withTaskTitle(tool: ChatToolDefinition): ChatToolDefinition {
  const parameters = tool.function.parameters;
  const properties = parameters.properties;
  const merged: Record<string, unknown> =
    properties !== null && typeof properties === 'object'
      ? { ...(properties as Record<string, unknown>) }
      : {};
  merged[TASK_TITLE_PARAM] = {
    type: 'string',
    maxLength: TASK_TITLE_MAX_LENGTH,
    description: TASK_TITLE_DESCRIPTION,
  };
  return {
    ...tool,
    function: {
      ...tool.function,
      parameters: { ...parameters, properties: merged },
    },
  };
}

function withTaskTitles(tools: ChatToolDefinition[]): ChatToolDefinition[] {
  return tools.map(withTaskTitle);
}

export const PERSONA_TOOLS: ChatToolDefinition[] = [
  toolDefinition(
    UPDATE_PERSONA_TOOL,
    'Rewrite your own persona. Use it only when your owner asks you to change ' +
      'how you behave from now on. `persona` is the complete new persona, not a ' +
      'diff. `summary` is one short line describing the change.',
    toolParameters(UpdatePersonaArgsSchema),
  ),
  toolDefinition(
    REVERT_PERSONA_TOOL,
    'Undo the last persona change and restore the previous persona. ' +
      'Use it when your owner asks to undo the last persona change.',
    { type: 'object', properties: {}, additionalProperties: false },
  ),
];

export const MEMORY_TOOLS: ChatToolDefinition[] = [
  toolDefinition(
    RECALL_TOOL,
    'Search everything said in this chat, including messages older than what you ' +
      "can see. Use it before saying you don't remember. `query` is a few words; " +
      'every word must appear. Returns the newest matches as `#seq date sender: text`.',
    toolParameters(RecallArgsSchema),
  ),
  toolDefinition(
    MEMORY_ZOOM_TOOL,
    'Open one block of your memory of this chat, like `64-79`, into its two ' +
      'halves (shorter summaries or the messages themselves).',
    toolParameters(MemoryZoomArgsSchema),
  ),
  toolDefinition(
    REMEMBER_TOOL,
    'Pin one short fact for this chat. Use it only when someone asks you to ' +
      'remember something, or for a lasting decision. One line, at most 280 ' +
      'characters. Never passwords, codes, keys or tokens.',
    toolParameters(RememberArgsSchema),
  ),
];

// The minimal description the AI sees for `request_action`: it lists every
// registered action as `name — description Args: <example>`. The list is
// sorted by name so the tool definition is stable across turns. The
// `Args` example is a valid call for that action, so the model sees the
// exact field names. The platform runs whatever the approval is granted
// for; the AI must never claim an action happened until it sees the
// outcome in the next model reply.
function describeRequestAction(
  actions: ReadonlyArray<{ name: string; description: string; argsExample?: string }>,
): string {
  const list = actions
    .map((action) =>
      action.argsExample === undefined
        ? `${action.name} — ${action.description}`
        : `${action.name} — ${action.description} Args: ${action.argsExample}`,
    )
    .join('; ');
  return (
    'Ask the platform to run one of the registered actions below. The platform ' +
    'will ask your owner for approval when needed (a card appears in this chat) ' +
    'and will tell you what happened in the next reply. Never claim an action ' +
    'happened until you see its outcome. `action` is the registered name, ' +
    '`args` is a JSON object matching the action (see the Args shown for it). ' +
    'Available actions: ' +
    `${list}.`
  );
}

export function buildRequestActionTool(
  actions: ReadonlyArray<{ name: string; description: string; argsExample?: string }>,
): ChatToolDefinition {
  return toolDefinition(
    REQUEST_ACTION_TOOL,
    describeRequestAction(actions),
    toolParameters(RequestActionArgsSchema),
  );
}

export function buildDelegateTool(
  targets: ReadonlyArray<{ id: string; name: string }>,
): ChatToolDefinition {
  const list = targets.map((target) => `${target.id} — ${target.name}`).join('; ');
  return toolDefinition(
    DELEGATE_TOOL,
    'Hand a task to another AI in this room. It works on the task with its own ' +
      'model and budget and replies in the room. `to` is the target id from the ' +
      'list below, `objective` is what it must do. Use task_status later to read ' +
      `the stored result. Targets: ${list}.`,
    toolParameters(DelegateArgsSchema),
  );
}

export const ASK_PEOPLE_TOOL_DEF = toolDefinition(
  ASK_PEOPLE_TOOL,
  'Ask the people in this room to decide something only they can decide. Ask ' +
    'one short question in plain words; options of one to three words: they can ' +
    'tap one, and a free reply is still allowed. Ask one question at a time and ' +
    'never ask the same thing twice. When someone asks you for buttons, a poll or a form, use post_blocks instead.',
  toolParameters(AskPeopleArgsSchema),
);

// The `task_status` tool definition, the same for every room that offers the
// delegation tools: it reads one delegation row for the two AIs involved.
export const TASK_STATUS_TOOL_DEF = toolDefinition(
  TASK_STATUS_TOOL,
  'Read the stored result of a task you delegated or received. `task_id` is ' +
    'the id `delegate` returned.',
  toolParameters(TaskStatusArgsSchema),
);

export function buildTools(
  actions: ReadonlyArray<{ name: string; description: string; argsExample?: string }>,
  opts?: { desk?: boolean },
): ChatToolDefinition[] {
  const base =
    actions.length === 0
      ? [...PERSONA_TOOLS, ...MEMORY_TOOLS]
      : [...PERSONA_TOOLS, ...MEMORY_TOOLS, buildRequestActionTool(actions)];
  const withBlocks = [
    ...base,
    POST_BLOCKS_TOOL_DEF,
    FETCH_MEDIA_TOOL_DEF,
    SAVE_TEXT_MEDIA_TOOL_DEF,
  ];
  return withTaskTitles(
    opts?.desk === true ? [...withBlocks, ...deskToolDefinitions()] : withBlocks,
  );
}

export function buildGroupTools(
  actions: ReadonlyArray<{ name: string; description: string; argsExample?: string }>,
  delegateTargets?: ReadonlyArray<{ id: string; name: string }>,
  opts?: { desk?: boolean; askPeople?: boolean },
): ChatToolDefinition[] {
  const base =
    actions.length === 0 ? [...MEMORY_TOOLS] : [...MEMORY_TOOLS, buildRequestActionTool(actions)];
  const withDelegation =
    delegateTargets === undefined || delegateTargets.length === 0
      ? base
      : [...base, buildDelegateTool(delegateTargets), TASK_STATUS_TOOL_DEF];
  const withAskPeople =
    opts?.askPeople === true ? [...withDelegation, ASK_PEOPLE_TOOL_DEF] : withDelegation;
  const withBlocks = [
    ...withAskPeople,
    POST_BLOCKS_TOOL_DEF,
    FETCH_MEDIA_TOOL_DEF,
    SAVE_TEXT_MEDIA_TOOL_DEF,
  ];
  return withTaskTitles(
    opts?.desk === true ? [...withBlocks, ...deskToolDefinitions()] : withBlocks,
  );
}
