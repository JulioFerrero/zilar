import { Schema } from 'effect';
import { runCommand } from '../process';
import { outcome, type ToolContext, type ToolOutcome } from '../tool';

// Options a task may not pass because they inject config or run a program.
// `GIT_ALLOW_PROTOCOL=https` enforces the transport, so arguments need no remote
// parsing; the jail is the real boundary, this stops a repo running hooks or
// reading local files through git. Matched exactly and with `=value`.
const REFUSED_OPTIONS = [
  '--config',
  '--config-env',
  '--exec',
  '--exec-path',
  '--receive-pack',
  '--upload-pack',
];

export const gitArgs = Schema.Struct({
  args: Schema.Array(Schema.String),
});

export type GitArgs = typeof gitArgs.Type;

// `-c` in any form (`-c foo=bar`, `-cfoo=bar`) and the long options above; bare `-u`
// is left alone because it is also `push -u`, and `GIT_ALLOW_PROTOCOL=https` makes
// `--upload-pack` harmless.
function refusedFlag(args: readonly string[]): string | undefined {
  return args.find(
    (arg) =>
      arg.startsWith('-c') ||
      REFUSED_OPTIONS.some((option) => arg === option || arg.startsWith(`${option}=`)),
  );
}

export async function runGit(args: GitArgs, ctx: ToolContext): Promise<ToolOutcome> {
  const flag = refusedFlag(args.args);
  if (flag !== undefined) {
    return outcome({
      exitCode: 1,
      error: { code: 'tool_failed', message: `git flag is not allowed: ${flag}` },
    });
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_ALLOW_PROTOCOL: 'https',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_LFS_SKIP_SMUDGE: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
  const hardened = [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'protocol.file.allow=never',
    ...args.args,
  ];
  const result = await runCommand('git', hardened, {
    cwd: ctx.workspace.root,
    env,
    maxOutputBytes: ctx.maxOutputBytes,
    signal: ctx.signal,
  });
  if (result.spawnError !== undefined) {
    return outcome({ exitCode: 127, error: { code: 'tool_failed', message: result.spawnError } });
  }
  return outcome({
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    truncated: result.truncated,
    ...(result.aborted ? { error: { code: 'timeout' as const, message: 'git timed out' } } : {}),
  });
}
