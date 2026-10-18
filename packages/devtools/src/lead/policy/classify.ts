import os from 'node:os';
import path from 'node:path';

import { isReadOnlyCurl, isReadOnlyWget } from './curl.js';
import { classifyRmRf } from './rm.js';
import { ALLOW_PATTERNS, GIT_ALLOW_PATTERN, REJECT_RULES } from './rules.js';
import {
  firstWord,
  gitRest,
  normalize,
  splitArgs,
  splitSegments,
  stripEnvPrefix,
} from './shell-parse.js';
import {
  SHELL_ACTION,
  type Classification,
  type PermissionRequest,
  type PolicyContext,
} from './types.js';

// Shell syntax that can run or write something the first word does not show:
// command or process substitution, or a redirect to anything but a fd or /dev/null.
function hasHiddenEffects(segment: string): boolean {
  if (/\$\(|`|<\(|>\(/.test(segment)) {
    return true;
  }
  // A `>` inside quotes is literal text, so only the unquoted part is checked.
  const unquoted = segment.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, '');
  return unquoted.replace(/\d?>&\d|&?\d?>\s*\/dev\/null/g, '').includes('>');
}

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
  // Local fetches: only read-only GETs that print to stdout; anything that mutates,
  // writes a file or carries credentials escalates.
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
  // Read-only git inspection, after the same global-flag stripping as the reject rules.
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

// `allow` answers `once`, `reject` answers `reject` with the message, `escalate`
// leaves the request pending and prints a LEAD: line. Every element is classified
// on its own and the worst verdict wins, so a dangerous segment cannot hide behind
// a harmless one. With `ZILAR_LEAD_ALLOW_ALL=1` every request is allowed; off by
// default.
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
