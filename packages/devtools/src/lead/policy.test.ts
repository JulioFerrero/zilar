import { describe, expect, it } from 'vitest';
import { classifyPermission, extractCommand, type PolicyContext, type Verdict } from './policy';

const CTX: PolicyContext = {
  worktree: '/Users/julio/personal-projects/galena-T-0038',
  task: 'T-0038',
};

// Every row: what the worker asked, and what the autopilot must do with it.
// allow = answer `once` itself; reject = answer `reject` with a message;
// escalate = print a LEAD: line and leave it for the lead. When unsure the
// verdict is always escalate, never allow.
const CASES: { name: string; action: string; command: string; verdict: Verdict }[] = [
  // Own cleanup and read-only commands: allow.
  { name: 'rm node_modules', action: 'shell', command: 'rm -rf node_modules', verdict: 'allow' },
  { name: 'rm dist', action: 'shell', command: 'rm -rf dist', verdict: 'allow' },
  { name: 'rm .turbo', action: 'shell', command: 'rm -rf .turbo', verdict: 'allow' },
  {
    name: 'rm own worktree build output',
    action: 'shell',
    command: 'rm -rf /Users/julio/personal-projects/galena-T-0038/dist',
    verdict: 'allow',
  },
  {
    name: 'rm own opencode temp folder',
    action: 'shell',
    command: 'rm -rf /tmp/opencode-abc123',
    verdict: 'allow',
  },
  {
    name: 'curl local server health',
    action: 'shell',
    command: 'curl -s http://127.0.0.1:3188/health',
    verdict: 'allow',
  },
  {
    name: 'curl local web api',
    action: 'shell',
    command: 'curl -s http://localhost:5173/api/me',
    verdict: 'allow',
  },
  {
    name: 'git status',
    action: 'shell',
    command: 'git status --short',
    verdict: 'allow',
  },
  {
    name: 'git diff stat',
    action: 'shell',
    command: 'git diff main...HEAD --stat',
    verdict: 'allow',
  },
  {
    name: 'git log',
    action: 'shell',
    command: 'git log --oneline -5',
    verdict: 'allow',
  },
  { name: 'ls', action: 'shell', command: 'ls apps/server/src', verdict: 'allow' },
  {
    name: 'cat a source file',
    action: 'shell',
    command: 'cat packages/devtools/package.json',
    verdict: 'allow',
  },
  { name: 'pgrep burner check', action: 'shell', command: 'pgrep -x yes', verdict: 'allow' },
  {
    name: 'mkdir inside own worktree',
    action: 'shell',
    command: 'mkdir -p apps/web/src/test',
    verdict: 'allow',
  },
  { name: 'git branch list', action: 'shell', command: 'git branch -a', verdict: 'allow' },

  // Dangerous or out-of-scope: reject with a steering message.
  {
    name: 'rm another worktree (relative)',
    action: 'shell',
    command: 'rm -rf ../galena-T-0024',
    verdict: 'reject',
  },
  {
    name: 'rm another worktree (absolute)',
    action: 'shell',
    command: 'rm -rf /Users/julio/personal-projects/galena-T-0024/dist',
    verdict: 'reject',
  },
  { name: 'rm ~/.ssh', action: 'shell', command: 'rm -rf ~/.ssh', verdict: 'reject' },
  { name: 'rm home', action: 'shell', command: 'rm -rf ~', verdict: 'reject' },
  {
    name: 'cat a .env file',
    action: 'shell',
    command: 'cat apps/server/.env',
    verdict: 'reject',
  },
  { name: 'cat infra env', action: 'shell', command: 'cat infra/.env', verdict: 'reject' },
  {
    name: 'grep an env file',
    action: 'shell',
    command: 'grep -r KEY infra/.env',
    verdict: 'reject',
  },
  { name: 'git push --force', action: 'shell', command: 'git push --force', verdict: 'reject' },
  {
    name: 'git push origin',
    action: 'shell',
    command: 'git push origin main',
    verdict: 'reject',
  },
  { name: 'git merge', action: 'shell', command: 'git merge main', verdict: 'reject' },
  { name: 'git rebase', action: 'shell', command: 'git rebase main', verdict: 'reject' },
  {
    name: 'git reset --hard',
    action: 'shell',
    command: 'git reset --hard HEAD',
    verdict: 'reject',
  },
  {
    name: 'git checkout main',
    action: 'shell',
    command: 'git checkout main',
    verdict: 'reject',
  },
  {
    name: 'git checkout another branch',
    action: 'shell',
    command: 'git checkout some-other-branch',
    verdict: 'reject',
  },
  {
    name: 'git switch',
    action: 'shell',
    command: 'git switch -c feature',
    verdict: 'reject',
  },
  {
    name: 'git commit --no-verify',
    action: 'shell',
    command: 'git commit --no-verify -m x',
    verdict: 'reject',
  },
  {
    name: 'git worktree add',
    action: 'shell',
    command: 'git worktree add ../galena-T-0099 -b task/x main',
    verdict: 'reject',
  },
  { name: 'git clean', action: 'shell', command: 'git clean -fdx', verdict: 'reject' },
  {
    name: 'git config',
    action: 'shell',
    command: 'git config user.email x@y.z',
    verdict: 'reject',
  },
  { name: 'git remote', action: 'shell', command: 'git remote -v', verdict: 'reject' },
  { name: 'sudo', action: 'shell', command: 'sudo rm -rf /tmp/x', verdict: 'reject' },
  { name: 'kill a pid', action: 'shell', command: 'kill 1234', verdict: 'reject' },
  { name: 'pkill node', action: 'shell', command: 'pkill -f node', verdict: 'reject' },
  {
    name: 'docker compose up',
    action: 'shell',
    command: 'docker compose up -d',
    verdict: 'reject',
  },
  {
    name: 'docker compose down',
    action: 'shell',
    command: 'docker compose down',
    verdict: 'reject',
  },
  {
    name: 'docker compose stop',
    action: 'shell',
    command: 'docker compose stop litellm',
    verdict: 'reject',
  },
  {
    name: 'docker compose restart',
    action: 'shell',
    command: 'docker compose restart server',
    verdict: 'reject',
  },
  { name: 'pnpm infra:up', action: 'shell', command: 'pnpm infra:up', verdict: 'reject' },
  {
    name: 'simctl shutdown all',
    action: 'shell',
    command: 'xcrun simctl shutdown all',
    verdict: 'reject',
  },
  {
    name: 'simctl erase',
    action: 'shell',
    command: 'xcrun simctl erase all',
    verdict: 'reject',
  },
  {
    name: "Julio's iPhone UDID",
    action: 'shell',
    command: 'xcrun simctl io DB167CD4-BDCE-4E04-BC5E-85EE868A6AD8 screenshot out.png',
    verdict: 'reject',
  },
  {
    name: 'expo on port 8081',
    action: 'shell',
    command: 'npx expo run:ios --port 8081',
    verdict: 'reject',
  },
  {
    name: 'bind port 3000',
    action: 'shell',
    command: 'npx vite --port 3000',
    verdict: 'reject',
  },
  { name: 'brew install', action: 'shell', command: 'brew install foo', verdict: 'reject' },
  { name: 'gh cli', action: 'shell', command: 'gh run list --limit 1', verdict: 'reject' },
  { name: 'ssh', action: 'shell', command: 'ssh julio@host', verdict: 'reject' },
  {
    name: 'read an ssh key',
    action: 'shell',
    command: 'cat ~/.ssh/id_ed25519',
    verdict: 'reject',
  },
  {
    name: 'opencode cli',
    action: 'shell',
    command: 'opencode2 api session.list',
    verdict: 'reject',
  },
  {
    name: 'macOS security cli',
    action: 'shell',
    command: 'security find-generic-password -s galena',
    verdict: 'reject',
  },
  { name: 'npm publish', action: 'shell', command: 'npm publish', verdict: 'reject' },
  {
    name: 'rm lead scratch',
    action: 'shell',
    command: 'rm -rf /tmp/galena-scratch/workers.txt',
    verdict: 'reject',
  },

  // Everything else: escalate, never allow by default.
  {
    name: 'npx expo install',
    action: 'shell',
    command: 'npx expo install expo-camera',
    verdict: 'escalate',
  },
  { name: 'npx tsc', action: 'shell', command: 'npx tsc --noEmit', verdict: 'escalate' },
  {
    name: 'pnpm dlx',
    action: 'shell',
    command: 'pnpm dlx tsx script.ts',
    verdict: 'escalate',
  },
  {
    name: 'curl docs site',
    action: 'shell',
    command: 'curl -s https://docs.rs/xmpp',
    verdict: 'escalate',
  },
  {
    name: 'wget external',
    action: 'shell',
    command: 'wget https://example.com/x.tar.gz',
    verdict: 'escalate',
  },
  { name: 'docker ps', action: 'shell', command: 'docker ps', verdict: 'escalate' },
  {
    name: 'docker compose logs',
    action: 'shell',
    command: 'docker compose logs server',
    verdict: 'escalate',
  },
  {
    name: 'rm unknown tmp dir',
    action: 'shell',
    command: 'rm -rf /tmp/some-unknown-dir',
    verdict: 'escalate',
  },
  {
    name: 'git checkout a file',
    action: 'shell',
    command: 'git checkout -- apps/web/src/x.ts',
    verdict: 'escalate',
  },
  {
    name: 'bash action never matches rules',
    action: 'bash',
    command: 'echo hi',
    verdict: 'escalate',
  },
  {
    name: "curl Julio's port 3000",
    action: 'shell',
    command: 'curl -s http://localhost:3000/api/me',
    verdict: 'escalate',
  },
  {
    name: 'mkdir outside worktree',
    action: 'shell',
    command: 'mkdir -p /tmp/foo',
    verdict: 'escalate',
  },
  { name: 'plain pnpm dev', action: 'shell', command: 'pnpm dev', verdict: 'escalate' },
  {
    name: 'simctl on an unknown device',
    action: 'shell',
    command: 'xcrun simctl io 12345678-1234-1234-1234-123456789012 screenshot out.png',
    verdict: 'escalate',
  },
  {
    name: 'git worktree list',
    action: 'shell',
    command: 'git worktree list',
    verdict: 'escalate',
  },
  {
    name: 'self-terminating burner',
    action: 'shell',
    command: 'timeout 600 yes > /dev/null &',
    verdict: 'escalate',
  },
  {
    name: 'perl burner',
    action: 'shell',
    command: 'perl -e \'alarm 600; exec "yes"\' > /dev/null &',
    verdict: 'escalate',
  },
  { name: 'plain echo', action: 'shell', command: 'echo hello', verdict: 'escalate' },
  {
    name: 'dangerous segment hides behind rm',
    action: 'shell',
    command: 'rm -rf dist && git push',
    verdict: 'reject',
  },
];

describe('classifyPermission', () => {
  it(`has at least 40 cases (${CASES.length} defined)`, () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
  });

  for (const entry of CASES) {
    it(`${entry.verdict}: ${entry.name}`, () => {
      const result = classifyPermission(
        { id: 'per_test', action: entry.action, command: entry.command },
        CTX,
      );
      expect(result.verdict).toBe(entry.verdict);
    });
  }

  it('escalates unknown commands by default', () => {
    expect(
      classifyPermission({ id: 'per_x', action: 'shell', command: 'frobnicate --all' }, CTX)
        .verdict,
    ).toBe('escalate');
  });

  it('every rejection carries a message', () => {
    for (const entry of CASES.filter((row) => row.verdict === 'reject')) {
      const result = classifyPermission(
        { id: 'per_test', action: entry.action, command: entry.command },
        CTX,
      );
      expect(result.message, entry.name).toBeTruthy();
    }
  });

  it('escalates an empty command', () => {
    expect(classifyPermission({ id: 'per_x', action: 'shell', command: '  ' }, CTX).verdict).toBe(
      'escalate',
    );
  });
});

describe('extractCommand', () => {
  it('passes strings through', () => {
    expect(extractCommand('git push')).toBe('git push');
  });

  it('joins arrays', () => {
    expect(extractCommand(['rm -rf', 'dist'])).toBe('rm -rf dist');
  });

  it('reads string values out of objects', () => {
    expect(extractCommand({ command: 'git push', other: 3 })).toBe('git push');
  });

  it('returns empty for anything else', () => {
    expect(extractCommand(undefined)).toBe('');
    expect(extractCommand(42)).toBe('');
  });
});
