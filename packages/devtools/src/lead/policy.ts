import os from 'node:os';
import path from 'node:path';

export type Verdict = 'allow' | 'reject' | 'escalate';

export interface Classification {
  verdict: Verdict;
  // Present on every rejection: the worker reads it and adapts.
  message?: string | undefined;
}

export interface PermissionRequest {
  id: string;
  action: string;
  // One entry per element of the request's `resources`. OpenCode splits a
  // piped command into one pattern per pipeline segment
  // (e.g. ["npx expo run:ios --help", "grep -iE \"port|device\"", "head"]),
  // so every element is classified on its own and the worst verdict wins.
  commands: string[];
}

export interface PolicyContext {
  // Absolute path of the requesting worker's own worktree.
  worktree: string;
  // Absolute path of the task id, e.g. "T-0038", used to recognize own temp files.
  task: string;
}

// Julio's simulators. Commands touching these UDIDs are always rejected:
// the lead runs its own live checks there and Julio uses them.
const JULIO_SIMULATOR_UDIDS = [
  'A3E0C081-CEA4-453B-ABA1-23EE7D044E54',
  'DB167CD4-BDCE-4E04-BC5E-85EE868A6AD8',
];

// Only the shell tool's permission requests are classified by command. Any
// other action (including `bash`, which never matches a rule) escalates:
// when unsure, escalate, never allow by default.
const SHELL_ACTION = 'shell';

function normalize(command: string): string {
  return command.replace(/\s+/g, ' ').trim();
}

// Splits `a && b; c || d | e` into segments so one dangerous segment can't
// hide behind a harmless one. Quote-aware: `grep -iE "port|device"` stays
// whole. `$(…)` and backticks stay inside their segment, but the substring
// rules below still see them, since substitution executes.
function splitSegments(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  const push = (): void => {
    if (current.trim().length > 0) {
      parts.push(current.trim());
    }
    current = '';
  };
  let i = 0;
  while (i < command.length) {
    const ch = command[i] as string;
    if (quote !== null) {
      current += ch;
      if (ch === '\\' && i + 1 < command.length) {
        current += command[i + 1] as string;
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === '\\' && i + 1 < command.length) {
      current += ch + (command[i + 1] as string);
      i += 2;
      continue;
    }
    if (ch === '\n' || ch === ';') {
      push();
      i += 1;
      continue;
    }
    if (ch === '&' && command[i + 1] === '&') {
      push();
      i += 2;
      continue;
    }
    if (ch === '|') {
      push();
      i += command[i + 1] === '|' ? 2 : 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  push();
  return parts;
}

// Strips a leading `VAR=x` / `VAR="x"` env assignments and `command`/`env`.
function stripEnvPrefix(segment: string): string {
  let rest = segment;
  for (;;) {
    const match = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+|command\s+|env\s+)/.exec(
      rest,
    );
    if (match === null) {
      return rest;
    }
    rest = rest.slice(match[0].length);
  }
}

function firstWord(segment: string): string {
  return stripEnvPrefix(segment).split(' ')[0] ?? '';
}

function isRmRf(segment: string): boolean {
  return /^rm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+|--recursive\s+--force\s+|--force\s+--recursive\s+)/.test(
    `${stripEnvPrefix(segment)} `,
  );
}

// Targets of `rm -rf …`, with the flags removed. Stops at a segment
// separator so `rm -rf dist && git push` yields just `dist`.
function rmTargets(segment: string): string[] {
  const withoutEnv = stripEnvPrefix(segment);
  const withoutRm = withoutEnv.replace(/^rm\s+/, '');
  const tokens = withoutRm.split(' ').filter((token) => token.length > 0);
  const targets: string[] = [];
  for (const token of tokens) {
    if (token === '--') {
      continue;
    }
    if (token.startsWith('-') && !/^-\d+$/.test(token)) {
      continue;
    }
    if (token === '&&' || token === '||' || token === ';' || token === '|') {
      break;
    }
    targets.push(token);
  }
  return targets;
}

// A `.env` file (other than the checked-in `.env.example` template) anywhere
// in the segment — as a read, copy, archive, or encode operand. The only
// sanctioned use is passing it to a process via `--env-file=` without
// printing it, so that flag form is exempt.
function mentionsSecretEnv(segment: string): boolean {
  if (/--env-file=/.test(segment)) {
    return false;
  }
  return /\.env(?!\.example)\b/i.test(segment);
}

// The remainder of a git invocation after the `git` global flags
// (`-C <path>`, `-c k=v`, `--no-pager`, `--git-dir=…`, `--work-tree=…`),
// so `git -C /elsewhere push` can't dodge the subcommand rules. Null when
// the segment is not a git invocation at all.
function gitRest(segment: string): string | null {
  const tokens = stripEnvPrefix(segment)
    .split(' ')
    .filter((token) => token.length > 0);
  if (tokens[0] !== 'git') {
    return null;
  }
  let i = 1;
  while (i < tokens.length) {
    const token = tokens[i] as string;
    if (token === '-C' || token === '-c' || token === '--git-dir' || token === '--work-tree') {
      i += 2;
      continue;
    }
    if (
      token.startsWith('-C') ||
      token.startsWith('-c') ||
      token.startsWith('--git-dir=') ||
      token.startsWith('--work-tree=') ||
      token.startsWith('--namespace=')
    ) {
      i += 1;
      continue;
    }
    if (
      token === '--no-pager' ||
      token === '--paginate' ||
      token === '--no-paginate' ||
      token === '--bare' ||
      token === '--no-replace-objects'
    ) {
      i += 1;
      continue;
    }
    break;
  }
  return tokens.slice(i).join(' ');
}

function gitMatches(segment: string, pattern: RegExp): boolean {
  const rest = gitRest(segment);
  return rest !== null && pattern.test(rest);
}

// A bare shell or interpreter as the whole segment: the pipe-to-shell
// pattern (`curl … | sh`, `… | xargs …`) or a wrapper hiding the real
// command (`sh -c …`, `bash -s`, `eval …`, `source …`). Never allowed:
// the lead cannot review code it never sees as text.
function isBareShell(segment: string): boolean {
  const head = firstWord(segment).toLowerCase();
  return (
    head === 'sh' ||
    head === 'bash' ||
    head === 'zsh' ||
    head === 'dash' ||
    head === 'fish' ||
    head === 'ksh' ||
    head === 'xargs' ||
    head === 'eval' ||
    head === 'source' ||
    head === '.'
  );
}

function containsJulioUdid(segment: string): boolean {
  const upper = segment.toUpperCase();
  return JULIO_SIMULATOR_UDIDS.some((udid) => upper.includes(udid));
}

// A target is the worker's own temp only when it names an OpenCode-style
// temp folder (or the task itself) and never the lead's scratch folder.
function isOwnTemp(target: string, task: string): boolean {
  const lowerTarget = target.toLowerCase();
  if (/galena-scratch/.test(lowerTarget)) {
    return false;
  }
  const base = path.basename(target).toLowerCase();
  if (base.includes('opencode') || base.includes(task.toLowerCase())) {
    return true;
  }
  return false;
}

function classifyRmRf(segment: string, ctx: PolicyContext): Classification | null {
  if (!isRmRf(segment)) {
    return null;
  }
  const targets = rmTargets(segment);
  if (targets.length === 0) {
    return { verdict: 'escalate' };
  }
  const own = path.normalize(ctx.worktree);
  for (const target of targets) {
    const lower = target.toLowerCase();
    const normalizedTarget = path.normalize(target);
    // Wiping the checkout, the disk, or home. The shell expands ~ and
    // $HOME after our check, so they are rejected as text, not resolved.
    if (
      normalizedTarget === '.' ||
      normalizedTarget === '..' ||
      normalizedTarget === '/' ||
      target === '/*' ||
      target === '~' ||
      target === '$HOME' ||
      target.startsWith('~/') ||
      target.startsWith('$HOME/') ||
      target.includes('${HOME}') ||
      /(^|\/)~(\/|$)/.test(target)
    ) {
      return {
        verdict: 'reject',
        message: `rm of ${target} would wipe home, the disk, or the checkout itself. Clean only build output inside ${ctx.worktree}.`,
      };
    }
    const abs = path.normalize(target.startsWith('/') ? target : path.join(ctx.worktree, target));
    const isOwn = abs === own || abs.startsWith(`${own}${path.sep}`);
    if (isOwn) {
      if (lower.includes('.ssh')) {
        return {
          verdict: 'reject',
          message: `Never touch SSH keys. If you need a GitHub operation, ask in your Report.`,
        };
      }
      continue;
    }
    if (isOwnTemp(target, ctx.task)) {
      continue;
    }
    // Anything absolute, or escaping with `..`, that is neither the worker's
    // own checkout nor its own temp folder: the main checkout, another
    // worktree, home, or anywhere else. Playbook §7 says rm outside the
    // worktree is rejected, not merely escalated.
    return {
      verdict: 'reject',
      message: `rm outside your own worktree (${target}) is blocked. Clean only inside ${ctx.worktree} or your own temp folder.`,
    };
  }
  return { verdict: 'allow' };
}

interface Rule {
  test: (segment: string, ctx: PolicyContext) => boolean;
  verdict: Verdict;
  message?: string;
}

// Reject rules: things that are never safe for a worker. Order matters only
// for which message the worker sees; the first match wins.
const REJECT_RULES: Rule[] = [
  {
    test: (segment) => /(^|\s)--no-verify(\s|$)/.test(segment),
    verdict: 'reject',
    message: 'Never bypass git hooks with --no-verify. Fix the failing check instead.',
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
      "Port 3000 is Julio's own app. Never bind it; the Galena server uses 3188 and Vite 5173.",
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
];

const ALLOW_PATTERNS: RegExp[] = [
  // Local health checks against the dev stack (but never Julio's port 3000).
  /^(curl|wget)\b.*\b(127\.0\.0\.1|localhost)\b(?!.*:3000\b)/,
  // Read-only observability.
  /^(ls|pwd|whoami|uptime|ps|pgrep|df|du|wc|file|which|command|node\s+--version|pnpm\s+--version)(\s|$)/,
  // Reading and counting files (secret env files are rejected above).
  /^(cat|head|tail|less|more|wc|sort|uniq|tr|cut|jq)(\s|$)/,
  // Scaffolding inside the worker's own checkout is harmless.
  /^mkdir(\s|$)/,
];

const GIT_ALLOW_PATTERN =
  /^(status|diff|log|show|rev-parse|stash\s+list|branch(\s+(-a|--all|-vv?))?|ls-files|grep)(\s|$)/;

function isLocalhostRead(segment: string, ctx: PolicyContext): boolean {
  void ctx;
  return /^(curl|wget)\b/.test(segment) && /(127\.0\.0\.1|localhost)/.test(segment);
}

function classifySegment(segment: string, ctx: PolicyContext): Classification {
  const normalized = normalize(segment);
  if (normalized.length === 0) {
    return { verdict: 'escalate' };
  }
  for (const rule of REJECT_RULES) {
    if (rule.test(normalized, ctx)) {
      return { verdict: 'reject', message: rule.message };
    }
  }
  const rm = classifyRmRf(normalized, ctx);
  if (rm !== null) {
    return rm;
  }
  // `mkdir` is only pre-allowed inside the worker's own worktree.
  if (/^mkdir(\s|$)/.test(stripEnvPrefix(normalized))) {
    const own = path.normalize(ctx.worktree);
    const args = stripEnvPrefix(normalized)
      .replace(/^mkdir\s+/, '')
      .split(' ')
      .filter((token) => token.length > 0 && !token.startsWith('-') && token !== '--');
    const inside = (target: string): boolean => {
      if (target === '.' || target === '~' || target.startsWith('~/')) {
        return target === '.';
      }
      const abs = path.normalize(target.startsWith('/') ? target : path.join(ctx.worktree, target));
      const relative = path.relative(own, abs);
      return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
    };
    if (args.length > 0 && args.every(inside)) {
      return { verdict: 'allow' };
    }
    return { verdict: 'escalate' };
  }
  if (isLocalhostRead(normalized, ctx)) {
    if (/:3000\b/.test(normalized)) {
      return { verdict: 'escalate' };
    }
    return { verdict: 'allow' };
  }
  // Read-only git inspection, after the same global-flag stripping as the
  // reject rules, so `git --no-pager status` stays allowed.
  const rest = gitRest(normalized);
  if (rest !== null) {
    return GIT_ALLOW_PATTERN.test(rest) ? { verdict: 'allow' } : { verdict: 'escalate' };
  }
  for (const pattern of ALLOW_PATTERNS) {
    if (pattern.test(stripEnvPrefix(normalized))) {
      return { verdict: 'allow' };
    }
  }
  return { verdict: 'escalate' };
}

// Classifies one pending permission request. `allow` means the autopilot
// answers `once` itself; `reject` means it answers `reject` with the message;
// `escalate` means it prints a LEAD: line and leaves the request pending.
// Every element is classified on its own and the worst verdict wins
// (reject > escalate > allow), so one dangerous pipeline segment can never
// hide behind a harmless one.
export function classifyPermission(request: PermissionRequest, ctx: PolicyContext): Classification {
  if (request.action !== SHELL_ACTION) {
    return { verdict: 'escalate' };
  }
  if (request.commands.length === 0) {
    return { verdict: 'escalate' };
  }
  let sawEscalate = false;
  for (const command of request.commands) {
    const segments = splitSegments(command);
    if (segments.length === 0) {
      sawEscalate = true;
      continue;
    }
    for (const segment of segments) {
      const result = classifySegment(segment, ctx);
      if (result.verdict === 'reject') {
        return result;
      }
      if (result.verdict === 'escalate') {
        sawEscalate = true;
      }
    }
  }
  return sawEscalate ? { verdict: 'escalate' } : { verdict: 'allow' };
}

// Pulls one shell command per element out of an OpenCode permission
// request's resources, whatever shape they arrive in.
export function extractCommands(resources: unknown): string[] {
  if (typeof resources === 'string') {
    return resources.trim().length > 0 ? [resources] : [];
  }
  if (Array.isArray(resources)) {
    return resources.flatMap((entry) => extractCommands(entry));
  }
  if (typeof resources === 'object' && resources !== null) {
    return Object.values(resources).flatMap((value) =>
      typeof value === 'string' && value.trim().length > 0 ? [value] : [],
    );
  }
  return [];
}

export function tmpdir(): string {
  return os.tmpdir();
}
