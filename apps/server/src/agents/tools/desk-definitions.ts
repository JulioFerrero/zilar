import type { ChatToolDefinition } from './definitions';
import {
  BASH_TOOL,
  DESK_COMMAND_MAX_LENGTH,
  DESK_CONTENT_MAX_LENGTH,
  DESK_PATH_MAX_LENGTH,
  DESK_TIMEOUT_MAX_MS,
  EDIT_TOOL,
  GIT_TOOL,
  GLOB_TOOL,
  GREP_TOOL,
  READ_TOOL,
  WRITE_TOOL,
} from './schemas';

// T-1409: the seven desk tools, offered to the model whenever the AI's
// computer resolves (any `computer_mode` but `off`, with a Hands client
// available). The names and parameters match the daemon's tool table
// (`packages/desk/README.md`). The list is fixed for the whole turn
// (design §2.5).
const DESK_TOOLS: ChatToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: BASH_TOOL,
      description:
        "Run a shell command on the AI's Linux computer. `command` runs in " +
        '`/bin/bash -lc`; set `cwd` to pick a working directory inside the ' +
        'workspace, and `timeout_ms` for a long command.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', minLength: 1, maxLength: DESK_COMMAND_MAX_LENGTH },
          cwd: { type: 'string', minLength: 1, maxLength: DESK_PATH_MAX_LENGTH },
          timeout_ms: { type: 'integer', minimum: 1, maximum: DESK_TIMEOUT_MAX_MS },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: READ_TOOL,
      description:
        'Read a text file on the computer. `path` is inside the workspace; ' +
        '`offset` and `limit` read a 1-based line window.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', minLength: 1, maxLength: DESK_PATH_MAX_LENGTH },
          offset: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1 },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: WRITE_TOOL,
      description:
        'Create or overwrite a file on the computer, creating parent folders. ' +
        '`content` replaces the whole file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', minLength: 1, maxLength: DESK_PATH_MAX_LENGTH },
          content: { type: 'string', maxLength: DESK_CONTENT_MAX_LENGTH },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: EDIT_TOOL,
      description:
        'Replace one exact string in a file on the computer. It fails unless ' +
        '`oldString` is unique; set `replaceAll` to change every match.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', minLength: 1, maxLength: DESK_PATH_MAX_LENGTH },
          oldString: { type: 'string', minLength: 1, maxLength: DESK_CONTENT_MAX_LENGTH },
          newString: { type: 'string', maxLength: DESK_CONTENT_MAX_LENGTH },
          replaceAll: { type: 'boolean' },
        },
        required: ['path', 'oldString', 'newString'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: GREP_TOOL,
      description:
        'Search file contents with ripgrep. `pattern` is a regular expression; ' +
        'narrow it with `path` and `glob`.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', minLength: 1, maxLength: 2000 },
          path: { type: 'string', minLength: 1, maxLength: DESK_PATH_MAX_LENGTH },
          glob: { type: 'string', minLength: 1, maxLength: 512 },
          max_results: { type: 'integer', minimum: 1, maximum: 1000 },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: GLOB_TOOL,
      description: 'List the files on the computer that match a glob pattern, sorted.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', minLength: 1, maxLength: DESK_PATH_MAX_LENGTH },
          path: { type: 'string', minLength: 1, maxLength: DESK_PATH_MAX_LENGTH },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: GIT_TOOL,
      description:
        'Run a hardened `git` on the computer. `args` is the git argument ' +
        'list, for example ["status"] or ["commit", "-m", "message"].',
      parameters: {
        type: 'object',
        properties: {
          args: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 1024 },
            maxItems: 64,
          },
        },
        required: ['args'],
        additionalProperties: false,
      },
    },
  },
];

/** The desk tool definitions, stable across turns. */
export function deskToolDefinitions(): ChatToolDefinition[] {
  return [...DESK_TOOLS];
}
