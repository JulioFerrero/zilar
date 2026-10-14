import { defineTool, type ToolEntry } from '../tool';
import { bashArgs, runBash } from './bash';
import { editArgs, runEdit } from './edit';
import { gitArgs, runGit } from './git';
import { globArgs, runGlob } from './glob';
import { grepArgs, runGrep } from './grep';
import { readArgs, runRead } from './read';
import { runWrite, writeArgs } from './write';
import type { ToolName } from '../protocol';

export const tools: Record<ToolName, ToolEntry> = {
  bash: defineTool(bashArgs, runBash),
  read: defineTool(readArgs, runRead),
  write: defineTool(writeArgs, runWrite),
  edit: defineTool(editArgs, runEdit),
  grep: defineTool(grepArgs, runGrep),
  glob: defineTool(globArgs, runGlob),
  git: defineTool(gitArgs, runGit),
};
