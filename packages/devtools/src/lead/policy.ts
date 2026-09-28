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
  command: string;
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

// Splits `a && b; c || d` into segments so one dangerous segment can't hide
// behind a harmless one. Pipes are kept intact: `curl … | grep …` is one unit.
function splitSegments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
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

function mentionsEnvFile(segment: string): boolean {
  return /(^|[\s"'`])[^|\s]*\.env(\b|$)/i.test(segment) || /(^|\s)\.env(\b|$)/.test(segment);
}

function isEnvRead(segment: string): boolean {
  const head = firstWord(segment);
  if (
    head === 'cat' ||
    head === 'less' ||
    head === 'more' ||
    head === 'head' ||
    head === 'tail' ||
    head === 'grep' ||
    head === 'rg' ||
    head === 'printenv' ||
    head === 'sed' ||
    head === 'awk'
  ) {
    return mentionsEnvFile(segment);
  }
  // `<file` redirection into anything also reads the file.
  return /<\s*\S*\.env\b/i.test(segment);
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
    // Outside the worker's own checkout: another worktree, the lead's
    // scratch, a .env file, or SSH material is never allowed.
    if (
      /galena-t-\d+/i.test(target) ||
      /galena-scratch/.test(lower) ||
      /\.env(\b|$)/i.test(target) ||
      lower.includes('.ssh')
    ) {
      return {
        verdict: 'reject',
        message: `rm outside your own worktree (${target}) is blocked. Clean only inside ${ctx.worktree}, and never touch another worktree, .env files, SSH keys, or scratch folders.`,
      };
    }
    if (isOwnTemp(target, ctx.task)) {
      continue;
    }
    // Somewhere else entirely, but not recognizably dangerous: the lead decides.
    return { verdict: 'escalate' };
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
    test: (segment) => /(^|\s)git\s+push(\s|$)/.test(segment),
    verdict: 'reject',
    message:
      "Pushing is the lead's job after review. Commit on your branch and set status: review.",
  },
  {
    test: (segment) => /(^|\s)git\s+merge(\s|$)/.test(segment),
    verdict: 'reject',
    message: "Merging is the lead's job. Stay on your branch.",
  },
  {
    test: (segment) => /(^|\s)git\s+rebase(\s|$)/.test(segment),
    verdict: 'reject',
    message: "Rebasing is the lead's job. Stay on your branch.",
  },
  {
    test: (segment) => /(^|\s)git\s+reset\s+--hard(\s|$)/.test(segment),
    verdict: 'reject',
    message: 'Never reset --hard: it destroys work. Use a WIP commit instead.',
  },
  {
    test: (segment) =>
      /(^|\s)git\s+checkout(\s|$)/.test(segment) &&
      !/(^|\s)git\s+checkout\s+--(\s|$)/.test(segment),
    verdict: 'reject',
    message:
      "Don't switch or create branches; branch operations are the lead's job at merge. To restore a file, ask the lead.",
  },
  {
    test: (segment) => /(^|\s)git\s+switch(\s|$)/.test(segment),
    verdict: 'reject',
    message: "Don't switch branches. Stay on your branch.",
  },
  {
    test: (segment) =>
      /(^|\s)git\s+branch\s+(-D|--delete|-m|--move)(\s|$)/.test(segment) ||
      /(^|\s)git\s+worktree\s+(add|remove|prune|move|lock|unlock|repair)(\s|$)/.test(segment),
    verdict: 'reject',
    message: "Branch and worktree operations are the lead's job. Stay on your branch.",
  },
  {
    test: (segment) => /(^|\s)git\s+(remote|config|clean)(\s|$)/.test(segment),
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
    test: (segment) => isEnvRead(segment),
    verdict: 'reject',
    message:
      "Don't read .env files or print their values. The lead copied what you need into your own worktree; use it as-is via --env-file and never print it.",
  },
  {
    test: (segment) => /(^|[\s"'`])~\/\.ssh(\/|$)/.test(segment) || /\.ssh\//.test(segment),
    verdict: 'reject',
    message: 'Never touch ~/.ssh. If you need a GitHub operation, ask in your Report.',
  },
];

const ALLOW_PATTERNS: RegExp[] = [
  // Read-only git inspection.
  /^(git\s+(status|diff|log|show|rev-parse|stash\s+list|branch(\s+(-a|--all|-vv?))?|ls-files|grep)(\s|$))/,
  // Local health checks against the dev stack (but never Julio's port 3000).
  /^(curl|wget)\b.*\b(127\.0\.0\.1|localhost)\b(?!.*:3000\b)/,
  // Read-only observability.
  /^(ls|pwd|whoami|uptime|ps|pgrep|df|du|wc|file|which|command|node\s+--version|pnpm\s+--version)(\s|$)/,
  // Reading and counting files (env reads are rejected above).
  /^(cat|head|tail|less|more|wc|sort|uniq|tr|cut|jq)(\s|$)/,
  // Scaffolding inside the worker's own checkout is harmless.
  /^mkdir(\s|$)/,
];

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
export function classifyPermission(request: PermissionRequest, ctx: PolicyContext): Classification {
  if (request.action !== SHELL_ACTION) {
    return { verdict: 'escalate' };
  }
  const segments = splitSegments(request.command);
  if (segments.length === 0) {
    return { verdict: 'escalate' };
  }
  let sawEscalate = false;
  for (const segment of segments) {
    const result = classifySegment(segment, ctx);
    if (result.verdict === 'reject') {
      return result;
    }
    if (result.verdict === 'escalate') {
      sawEscalate = true;
    }
  }
  return sawEscalate ? { verdict: 'escalate' } : { verdict: 'allow' };
}

// Pulls the shell command text out of an OpenCode permission request's
// resources, whatever shape they arrive in.
export function extractCommand(resources: unknown): string {
  if (typeof resources === 'string') {
    return resources;
  }
  if (Array.isArray(resources)) {
    return resources
      .map((entry) => extractCommand(entry))
      .filter(Boolean)
      .join(' ');
  }
  if (typeof resources === 'object' && resources !== null) {
    return Object.values(resources)
      .map((value) => (typeof value === 'string' ? value : ''))
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

export function tmpdir(): string {
  return os.tmpdir();
}
