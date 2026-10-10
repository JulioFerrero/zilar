import os from 'node:os';
import path from 'node:path';

import { isReadOnlyCurl, isReadOnlyWget } from './curl.js';
import {
  FILTER_ALLOW,
  hasHiddenEffects,
  isReadOnlySed,
  isRehearsalCurl,
  isRehearsalDocker,
} from './filters.js';
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
