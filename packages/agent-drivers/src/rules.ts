import type { PermissionEffect, PermissionRule } from './types';

// The OpenCode v2 action name for shell commands is `shell`, not `bash`.
const SHELL_ACTION = 'shell';

function shellRules(effect: PermissionEffect, commands: string[]): PermissionRule[] {
  return commands.map((command) => ({ action: SHELL_ACTION, resource: `${command}*`, effect }));
}

// The ruleset used for DeepSeek workers. Order matters: later rules win, so the narrow
// `allow` rules override the broad `ask` on `rm -rf`, and the `deny` list is checked last.
export function defaultWorkerRules(): PermissionRule[] {
  return [
    ...shellRules('ask', ['curl', 'wget', 'npx', 'pnpm dlx', 'brew', 'docker', 'rm -rf']),
    ...shellRules('allow', ['rm -rf node_modules', 'rm -rf dist', 'rm -rf .turbo']),
    ...shellRules('deny', [
      'git push',
      'git merge',
      'git rebase',
      'git reset --hard',
      'git checkout main',
      'git switch',
      'git branch -D',
      'git worktree',
      'git remote',
      'git config',
      'git clean',
      'gh',
      'sudo',
      'ssh',
      'scp',
      'npm publish',
      'pnpm publish',
      'opencode',
      'security',
    ]),
  ];
}
