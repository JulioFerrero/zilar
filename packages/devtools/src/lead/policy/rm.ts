import path from 'node:path';

import { stripEnvPrefix } from './shell-parse.js';
import { JULIO_SIMULATOR_UDIDS, type Classification, type PolicyContext } from './types.js';

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
export function mentionsSecretEnv(segment: string): boolean {
  if (/--env-file=/.test(segment)) {
    return false;
  }
  return /\.env(?!\.example)\b/i.test(segment);
}

export function containsJulioUdid(segment: string): boolean {
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

export function classifyRmRf(segment: string, ctx: PolicyContext): Classification | null {
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
