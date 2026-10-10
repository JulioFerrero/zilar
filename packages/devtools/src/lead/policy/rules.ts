import { containsJulioUdid, mentionsSecretEnv } from './rm.js';
import { gitMatches, isBareShell } from './shell-parse.js';
import type { Rule } from './types.js';

// Reject rules: things that are never safe for a worker. Order matters only
// for which message the worker sees; the first match wins.
export const REJECT_RULES: Rule[] = [
  {
    test: (segment) => /(^|\s)--no-verify(\s|$)/.test(segment),
    verdict: 'reject',
    message: 'Never bypass git hooks with --no-verify. Fix the failing check instead.',
  },
  {
    // The repo already has these tools; `npx` could download and run a
    // different, unreviewed copy. The worker is told the exact replacement
    // and carries on without waiting for the lead (found 2026-10-03: every
    // worker asked for `npx prettier` and each ask needed a manual answer).
    test: (segment) => /^npx\s+(prettier|vitest|eslint|oxlint|jest|turbo)(\s|$)/.test(segment),
    verdict: 'reject',
    message:
      'No npx for tools this repo already has. From the repo root use: pnpm exec prettier --write <files>, pnpm lint, pnpm format:check, pnpm typecheck, and for tests only pnpm --filter <package> test --maxWorkers=2 <path>. Then continue.',
  },
  {
    test: (segment) => isBareShell(segment),
    verdict: 'reject',
    message:
      'A bare shell (sh, bash, xargs, eval, source, …) executes code the lead cannot review. Invoke the underlying command directly instead of wrapping it or piping into it.',
  },
  {
    test: (segment) => /(^|\s)(sudo|doas)(\s|$)/.test(segment),
    verdict: 'reject',
    message:
      'No sudo or system installs. If it is really needed, say so in your Report and the lead will ask Julio.',
  },
  {
    test: (segment) => /(^|\s)brew(\s|$)/.test(segment),
    verdict: 'reject',
    message:
      'No Homebrew installs from a worker. If it is really needed, say so in your Report and the lead will ask Julio.',
  },
  {
    test: (segment) => /(^|\s)(kill|pkill|killall)(\s|$)/.test(segment),
    verdict: 'reject',
    message:
      "Workers can't kill processes (you couldn't restart what you stop). List the PIDs and the reason in your Report and keep working on something else.",
  },
  {
    test: (segment) => gitMatches(segment, /^push(\s|$)/),
    verdict: 'reject',
    message:
      "Pushing is the lead's job after review. Commit on your branch and set status: review.",
  },
  {
    test: (segment) => gitMatches(segment, /^merge(\s|$)/),
    verdict: 'reject',
    message: "Merging is the lead's job. Stay on your branch.",
  },
  {
    test: (segment) => gitMatches(segment, /^rebase(\s|$)/),
    verdict: 'reject',
    message: "Rebasing is the lead's job. Stay on your branch.",
  },
  {
    test: (segment) => gitMatches(segment, /^reset\s+--hard(\s|$)/),
    verdict: 'reject',
    message: 'Never reset --hard: it destroys work. Use a WIP commit instead.',
  },
  {
    test: (segment) =>
      gitMatches(segment, /^checkout(\s|$)/) && !gitMatches(segment, /^checkout\s+--(\s|$)/),
    verdict: 'reject',
    message:
      "Don't switch or create branches; branch operations are the lead's job at merge. To restore a file, ask the lead.",
  },
  {
    test: (segment) => gitMatches(segment, /^switch(\s|$)/),
    verdict: 'reject',
    message: "Don't switch branches. Stay on your branch.",
  },
  {
    test: (segment) =>
      gitMatches(segment, /^branch\s+(-D|--delete|-m|--move)(\s|$)/) ||
      gitMatches(segment, /^worktree\s+(add|remove|prune|move|lock|unlock|repair)(\s|$)/),
    verdict: 'reject',
    message: "Branch and worktree operations are the lead's job. Stay on your branch.",
  },
  {
    test: (segment) => gitMatches(segment, /^(remote|config|clean)(\s|$)/),
    verdict: 'reject',
    message:
      'That git operation is blocked (remotes, config and clean can escape the worktree or wipe ignored files like infra/.env). Ask the lead.',
  },
  {
    test: (segment) => /(^|\s)gh(\s|$)/.test(segment),
    verdict: 'reject',
    message: 'The gh CLI is blocked for workers. CI and merges are the lead’s job.',
  },
  {
    test: (segment) => /(^|\s)(ssh|scp)(\s|$)/.test(segment),
    verdict: 'reject',
    message: 'Never use ssh/scp. If you need a GitHub operation, ask in your Report.',
  },
  {
    test: (segment) => /(^|\s)security(\s|$)/.test(segment),
    verdict: 'reject',
    message: 'The macOS security CLI reads the keychain. Never touch it.',
  },
  {
    test: (segment) => /(^|\s)(npm|pnpm)\s+publish(\s|$)/.test(segment),
    verdict: 'reject',
    message: 'Publishing packages is blocked.',
  },
  {
    test: (segment) => /(^|\s)opencode2?(\s|$)/.test(segment),
    verdict: 'reject',
    message: 'Controlling OpenCode sessions is the lead’s job.',
  },
  {
    test: (segment) => /(^|\s)docker\s+compose\s+.*\b(up|down|stop|restart)\b/.test(segment),
    verdict: 'reject',
    message:
      'The stack is serving Julio; test against it as it is. Never stop, restart or recreate containers.',
  },
  {
    test: (segment) => /(^|\s)pnpm\s+infra:/.test(segment),
    verdict: 'reject',
    message: 'The stack is serving Julio; test against it as it is. Never bring infra up or down.',
  },
  {
    test: (segment) => /xcrun\s+simctl\s+shutdown\s+all/.test(segment),
    verdict: 'reject',
    message:
      'Never shut down all simulators; that kills everyone else’s devices. Use only your own simulator.',
  },
  {
    test: (segment) => /xcrun\s+simctl\s+erase/.test(segment),
    verdict: 'reject',
    message:
      'Never erase a simulator; that wipes someone else’s device. Use only your own simulator.',
  },
  {
    test: (segment) => containsJulioUdid(segment),
    verdict: 'reject',
    message:
      'That simulator belongs to Julio. Never touch it; use only your own simulator, and ask in your Report if you need one.',
  },
  {
    test: (segment) => /(^|\s)--port\s+8081(\s|$)/.test(segment),
    verdict: 'reject',
    message: 'Port 8081 is taken. Run your own Metro on 8082.',
  },
  {
    test: (segment) => /(^|\s)--port\s+3000(\s|$)/.test(segment),
    verdict: 'reject',
    message:
      "Port 3000 is Julio's own app. Never bind it; the Zilar server uses 3188 and Vite 5173.",
  },
  {
    test: (segment) => mentionsSecretEnv(segment),
    verdict: 'reject',
    message:
      "Don't read, copy, archive, or encode .env files, and never print their values. The lead copied what you need into your own worktree; use it as-is via --env-file and never print it. (.env.example is fine to read.)",
  },
  {
    test: (segment) => /(^|[\s"'`])~\/\.ssh(\/|$)/.test(segment) || /\.ssh\//.test(segment),
    verdict: 'reject',
    message: 'Never touch ~/.ssh. If you need a GitHub operation, ask in your Report.',
  },
  {
    // Anything a worker starts in the background or detaches outlives its
    // session and cannot be stopped (found 2026-10-08: a worker ran its gate
    // and tests as launchd jobs that relaunched on every kill for 45 min). A
    // trailing `&` is a background run the same way `nohup …` is.
    test: (segment) =>
      /(^|\s)(launchctl|nohup|setsid|disown|crontab|at|osascript|screen|tmux)(\s|$)/.test(
        segment,
      ) || /(^|[^&])&\s*$/.test(segment),
    verdict: 'reject',
    message:
      'Workers may not start daemons, background jobs or detached runs (launchd, nohup, &, tmux…): they outlive your session and cannot be stopped. Run every command in the foreground; for tests use pnpm --filter <package> test --maxWorkers=2 <path>, then pnpm gate once.',
  },
];

export const ALLOW_PATTERNS: RegExp[] = [
  // Read-only observability.
  /^(ls|pwd|whoami|uptime|ps|pgrep|df|du|wc|file|which|command|node\s+--version|pnpm\s+--version)(\s|$)/,
  // Reading and counting files (secret env files are rejected above).
  /^(cat|head|tail|less|more|wc|sort|uniq|tr|cut|jq)(\s|$)/,
  // Read-only docker inspection. No logs/inspect (they can print container env).
  /^docker\s+(ps|images|version|info)(\s+-{1,2}[\w-]+(=\S+|\s+('[^']*'|"[^"]*"|[^\s-]\S*))?)*(\s+2>(&1|\/dev\/null))?$/,
  /^docker\s+compose\s+(-\S+(\s+[^\s-]\S*)?\s+)*(ps|config|images|ls)(\s+-\S+)*$/,
  // Listing volumes and networks changes nothing.
  /^docker\s+(volume|network)\s+ls(\s+--format\s+('[^']*'|"[^"]*"|\S+))?(\s+2>(&1|\/dev\/null))?$/,
  // Typechecking writes nothing (`--noEmit`).
  /^(npx|pnpm\s+exec)\s+tsc\s+--noEmit(\s+-p\s+[\w./-]+)?(\s+2>&1)?$/,
  // Scaffolding inside the worker's own checkout is harmless.
  /^mkdir(\s|$)/,
];

export const GIT_ALLOW_PATTERN =
  /^(status|diff|log|show|rev-parse|stash\s+list|branch(\s+(-a|--all|-vv?))?|ls-files|grep)(\s|$)/;
