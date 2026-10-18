import { type ChatToolDefinition, toolDefinition } from './definitions';
import {
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
