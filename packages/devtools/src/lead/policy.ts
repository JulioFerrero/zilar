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
  if (/zilar-scratch/.test(lowerTarget)) {
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
];

const ALLOW_PATTERNS: RegExp[] = [
  // Read-only observability.
  /^(ls|pwd|whoami|uptime|ps|pgrep|df|du|wc|file|which|command|node\s+--version|pnpm\s+--version)(\s|$)/,
  // Reading and counting files (secret env files are rejected above).
  /^(cat|head|tail|less|more|wc|sort|uniq|tr|cut|jq)(\s|$)/,
  // Read-only docker inspection. No logs/inspect (they can print container env).
  /^docker\s+(ps|images|version|info)(\s+-{1,2}[\w-]+(=\S+|\s+('[^']*'|"[^"]*"|[^\s-]\S*))?)*(\s+2>(&1|\/dev\/null))?$/,
  /^docker\s+compose\s+(-\S+(\s+[^\s-]\S*)?\s+)*(ps|config|images|ls)(\s+-\S+)*$/,
  // Typechecking writes nothing (`--noEmit`).
  /^(npx|pnpm\s+exec)\s+tsc\s+--noEmit(\s+-p\s+[\w./-]+)?(\s+2>&1)?$/,
  // Scaffolding inside the worker's own checkout is harmless.
  /^mkdir(\s|$)/,
];

const GIT_ALLOW_PATTERN =
  /^(status|diff|log|show|rev-parse|stash\s+list|branch(\s+(-a|--all|-vv?))?|ls-files|grep)(\s|$)/;

// Tokenizes a segment on whitespace the way the shell would split it:
// single/double quotes group, backslash escapes. Needed so curl flag parsing
// below sees `-H "Authorization: Bearer x"` as one value, not three tokens.
function splitArgs(segment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  let has = false;
  const push = (): void => {
    if (has) {
      tokens.push(current);
      current = '';
      has = false;
    }
  };
  let i = 0;
  while (i < segment.length) {
    const ch = segment[i] as string;
    if (quote !== null) {
      if (ch === '\\' && i + 1 < segment.length) {
        current += segment[i + 1] as string;
        has = true;
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
        i += 1;
        continue;
      }
      current += ch;
      has = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      i += 1;
      continue;
    }
    if (ch === '\\' && i + 1 < segment.length) {
      current += segment[i + 1] as string;
      has = true;
      i += 2;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      push();
      i += 1;
      continue;
    }
    current += ch;
    has = true;
    i += 1;
  }
  push();
  return tokens;
}

function isLocalhostUrl(token: string): boolean {
  const match = /^https?:\/\/([^/:]+)/i.exec(token);
  if (match === null) {
    return false;
  }
  const host = (match[1] as string).toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
}

const CURL_SHORT_VALUE = new Set([
  'X',
  'd',
  'F',
  'T',
  'o',
  'K',
  'u',
  'H',
  'b',
  'c',
  'e',
  'm',
  'A',
  'x',
  'w',
]);
const CURL_SHORT_BOOL = new Set([
  's',
  'S',
  'f',
  'L',
  'I',
  'i',
  'v',
  'k',
  'q',
  'N',
  'g',
  'l',
  'G',
  '0',
  '1',
  '2',
  '3',
  '4',
  '6',
  '#',
]);
const CURL_LONG_VALUE_OK = new Set([
  'referer',
  'max-time',
  'connect-timeout',
  'max-redirs',
  'retry',
  'retry-delay',
  'limit-rate',
  'user-agent',
  'write-out',
  'resolve',
  'connect-to',
  'proxy',
  'cacert',
  'capath',
]);
const CURL_LONG_BOOL_OK = new Set([
  'silent',
  'show-error',
  'fail',
  'fail-with-body',
  'location',
  'location-trusted',
  'head',
  'include',
  'verbose',
  'no-verbose',
  'insecure',
  'ipv4',
  'ipv6',
  'no-buffer',
  'compressed',
  'http1.0',
  'http1.1',
  'http2',
  'get',
  'globoff',
  'path-as-is',
  'progress-bar',
  'no-progress-meter',
  'create-dirs',
  'remove-on-error',
  'fail-early',
]);

function hasAuthOrCookie(value: string | undefined): boolean {
  return value === undefined || /authorization|cookie/i.test(value);
}

// True only for a read-only GET that prints to stdout: no request override
// (other than GET/HEAD), no body, no file output, no config file, no
// credentials. Combined short flags (`-sXPOST`) and `--opt=value` forms are
// parsed. Anything unrecognized fails closed.
function isReadOnlyCurl(args: string[]): boolean {
  let sawUrl = false;
  let i = 0;
  const next = (): string | undefined => {
    i += 1;
    return args[i];
  };
  while (i < args.length) {
    const token = args[i] as string;
    if (token === '--') {
      i += 1;
      while (i < args.length) {
        if (!isLocalhostUrl(args[i] as string)) {
          return false;
        }
        sawUrl = true;
        i += 1;
      }
      break;
    }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      const name = (eq === -1 ? token.slice(2) : token.slice(2, eq)).toLowerCase();
      const attached = eq === -1 ? null : token.slice(eq + 1);
      if (name === 'request') {
        const method = (attached ?? next() ?? '').toUpperCase();
        if (method !== 'GET' && method !== 'HEAD') {
          return false;
        }
      } else if (name === 'header') {
        if (hasAuthOrCookie(attached ?? next())) {
          return false;
        }
      } else if (
        name === 'data' ||
        name.startsWith('data-') ||
        name === 'json' ||
        name === 'form' ||
        name.startsWith('form-') ||
        name === 'upload-file' ||
        name === 'config' ||
        name === 'user' ||
        name === 'cookie' ||
        name === 'cookie-jar' ||
        name === 'netrc' ||
        name === 'netrc-file' ||
        name === 'netrc-optional' ||
        name === 'cert' ||
        name === 'key' ||
        name === 'pass'
      ) {
        return false;
      } else if (name === 'output') {
        if ((attached ?? next()) !== '-') {
          return false;
        }
      } else if (
        name === 'remote-name' ||
        name === 'remote-name-all' ||
        name === 'remote-header-name' ||
        name === 'output-dir'
      ) {
        return false;
      } else if (CURL_LONG_VALUE_OK.has(name)) {
        if (attached === null) {
          next();
        }
      } else if (!CURL_LONG_BOOL_OK.has(name)) {
        return false;
      }
      i += 1;
      continue;
    }
    if (token.startsWith('-') && token.length > 1) {
      let j = 1;
      while (j < token.length) {
        const flag = token[j] as string;
        if (flag === 'n') {
          return false;
        }
        if (CURL_SHORT_VALUE.has(flag)) {
          const attached = token.slice(j + 1);
          const value = attached.length > 0 ? attached : next();
          if (flag === 'X') {
            const method = (value ?? '').toUpperCase();
            if (method !== 'GET' && method !== 'HEAD') {
              return false;
            }
          } else if (flag === 'o') {
            if (value !== '-') {
              return false;
            }
          } else if (flag === 'H') {
            if (hasAuthOrCookie(value)) {
              return false;
            }
          } else if (
            flag === 'd' ||
            flag === 'F' ||
            flag === 'T' ||
            flag === 'K' ||
            flag === 'u' ||
            flag === 'b' ||
            flag === 'c'
          ) {
            return false;
          }
          // e, m, A, x, w take a harmless value, already consumed.
          break;
        }
        if (!CURL_SHORT_BOOL.has(flag)) {
          return false;
        }
        j += 1;
      }
      i += 1;
      continue;
    }
    // Positional: must be a localhost URL (a lone `-` means stdin: reject).
    if (!isLocalhostUrl(token)) {
      return false;
    }
    sawUrl = true;
    i += 1;
  }
  return sawUrl;
}

// wget's smaller cousin: no POST-ish method or body, no output file.
function isReadOnlyWget(args: string[]): boolean {
  let sawUrl = false;
  let i = 0;
  while (i < args.length) {
    const token = args[i] as string;
    if (token === '-O' || token === '--output-document') {
      if (args[i + 1] !== '-') {
        return false;
      }
      i += 2;
      continue;
    }
    if (/^-[a-zA-Z0-9]*O/.test(token)) {
      const rest = token.slice(token.indexOf('O') + 1);
      const value = rest.length > 0 ? rest : args[i + 1];
      if (value !== '-') {
        return false;
      }
      i += rest.length > 0 ? 1 : 2;
      continue;
    }
    if (token.startsWith('--output-document=')) {
      if (token.slice('--output-document='.length) !== '-') {
        return false;
      }
      i += 1;
      continue;
    }
    if (
      token === '--post-data' ||
      token === '--post-file' ||
      token === '--body-data' ||
      token === '--body-file'
    ) {
      return false;
    }
    if (token === '--method') {
      const method = (args[i + 1] ?? '').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        return false;
      }
      i += 2;
      continue;
    }
    if (token.startsWith('--method=')) {
      const method = token.slice('--method='.length).toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        return false;
      }
      i += 1;
      continue;
    }
    if (token.startsWith('--') && token.includes('=')) {
      const name = token.slice(2, token.indexOf('=')).toLowerCase();
      if (name !== 'tries' && name !== 'timeout' && name !== 'wait' && name !== 'limit-rate') {
        return false;
      }
      i += 1;
      continue;
    }
    if (token.startsWith('-') && token.length > 1) {
      i += 1;
      continue;
    }
    if (!isLocalhostUrl(token)) {
      return false;
    }
    sawUrl = true;
    i += 1;
  }
  return sawUrl;
}

// Shell syntax that can run or write something the segment's first word
// does not show: command substitution, process substitution, or a redirect
// to anything but a file descriptor or /dev/null.
function hasHiddenEffects(segment: string): boolean {
  if (/\$\(|`|<\(|>\(/.test(segment)) {
    return true;
  }
  // A `>` inside quotes is literal text, so only the unquoted part is checked.
  const unquoted = segment.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, '');
  return unquoted.replace(/\d?>&\d|&?\d?>\s*\/dev\/null/g, '').includes('>');
}

// Pure text filters and timers: they read stdin or named files and print.
const FILTER_ALLOW =
  /^(grep|egrep|fgrep|echo|printf|sleep|cmp|diff|basename|dirname|date|seq|true)(\s|$)/;

// `sed` only prints or substitutes: no -i/-f/-e/-s, and the script is one
// `Np`, `N,Mp` or `s<d>…<d>…<d>[gIp]` command, so no `w`/`e` can hide in it.
function isReadOnlySed(segment: string): boolean {
  const args = splitArgs(stripEnvPrefix(segment)).slice(1);
  const operands: string[] = [];
  for (const arg of args) {
    if (['-n', '-E', '-r', '--quiet', '--silent'].includes(arg)) {
      continue;
    }
    if (arg.startsWith('-')) {
      return false;
    }
    operands.push(arg);
  }
  const script = operands[0];
  if (script === undefined) {
    return false;
  }
  return (
    /^\d+(,\d+)?p$/.test(script) || /^s([#/|,])(?:(?!\1).)*\1(?:(?!\1).)*\1[gIp0-9]*$/.test(script)
  );
}

// The rehearsal stack (T-0159) is a throwaway: containers named
// `zilar-rehearsal-*`. Inspecting them or running commands inside them can
// only touch that stack, never the live install.
const REHEARSAL_CONTAINER = /^zilar-rehearsal-[a-z0-9-]+$/;
const DOCKER_VALUE_FLAGS = new Set([
  '-e',
  '--env',
  '-u',
  '--user',
  '-w',
  '--workdir',
  '--since',
  '--until',
  '--tail',
  '-n',
  '--format',
  '-f',
]);

function isRehearsalDocker(segment: string): boolean {
  const args = splitArgs(stripEnvPrefix(segment));
  if (args[0] !== 'docker' || !['logs', 'exec', 'inspect', 'top'].includes(args[1] ?? '')) {
    return false;
  }
  for (let i = 2; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg.startsWith('-')) {
      if (DOCKER_VALUE_FLAGS.has(arg)) {
        i += 1;
      }
      continue;
    }
    return REHEARSAL_CONTAINER.test(arg);
  }
  return false;
}

// Any curl method is fine against the rehearsal stack's own port, as long as
// every URL names it and any file it writes stays in a temp folder.
const CURL_WRITE_FLAGS = new Set(['-o', '--output', '-D', '--dump-header', '-c', '--cookie-jar']);

function isRehearsalCurl(segment: string, ctx: PolicyContext): boolean {
  const args = splitArgs(stripEnvPrefix(segment)).slice(1);
  const urls = args.filter((arg) => /^https?:\/\//i.test(arg));
  if (urls.length === 0 || !urls.every((url) => /^https:\/\/localhost:18443(\/|$)/.test(url))) {
    return false;
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === '-K' || arg === '--config') {
      return false;
    }
    if (CURL_WRITE_FLAGS.has(arg)) {
      const target = args[i + 1] ?? '';
      const own = target.startsWith('/tmp/') || target.startsWith(`${ctx.worktree}/`);
      if (!own && target !== '/dev/null') {
        return false;
      }
    }
  }
  return true;
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
  // Local fetches: allowed only for read-only GETs that print to stdout.
  // Anything that mutates, writes a file, or carries credentials escalates
  // (Julio's port 3000 always escalates). Non-local fetches fall through
  // below and escalate as unknown commands.
  const head = firstWord(normalized);
  if (!hasHiddenEffects(normalized)) {
    const bare = stripEnvPrefix(normalized);
    if (FILTER_ALLOW.test(bare) || (head === 'sed' && isReadOnlySed(normalized))) {
      return { verdict: 'allow' };
    }
    if (isRehearsalDocker(normalized) || (head === 'curl' && isRehearsalCurl(normalized, ctx))) {
      return { verdict: 'allow' };
    }
  }
  if ((head === 'curl' || head === 'wget') && /(127\.0\.0\.1|localhost)/.test(normalized)) {
    if (/:3000\b/.test(normalized)) {
      return { verdict: 'escalate' };
    }
    const fetchArgs = splitArgs(stripEnvPrefix(normalized)).slice(1);
    const readOnly = head === 'curl' ? isReadOnlyCurl(fetchArgs) : isReadOnlyWget(fetchArgs);
    return readOnly ? { verdict: 'allow' } : { verdict: 'escalate' };
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
// Julio's explicit choice (2026-09-30): with ZILAR_LEAD_ALLOW_ALL=1 the
// autopilot answers `once` to every permission request, including the ones
// the rules below would reject or escalate. Off by default; unset the
// variable and restart the autopilot to bring the rules back.
export function allowAllEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.ZILAR_LEAD_ALLOW_ALL === '1';
}

export function classifyPermission(request: PermissionRequest, ctx: PolicyContext): Classification {
  if (allowAllEnabled()) {
    return { verdict: 'allow' };
  }
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
