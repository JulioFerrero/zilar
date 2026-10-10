import { splitArgs, stripEnvPrefix } from './shell-parse.js';
import type { PolicyContext } from './types.js';

// Shell syntax that can run or write something the segment's first word
// does not show: command substitution, process substitution, or a redirect
// to anything but a file descriptor or /dev/null.
export function hasHiddenEffects(segment: string): boolean {
  if (/\$\(|`|<\(|>\(/.test(segment)) {
    return true;
  }
  // A `>` inside quotes is literal text, so only the unquoted part is checked.
  const unquoted = segment.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, '');
  return unquoted.replace(/\d?>&\d|&?\d?>\s*\/dev\/null/g, '').includes('>');
}

// Pure text filters and timers: they read stdin or named files and print.
export const FILTER_ALLOW =
  /^(grep|egrep|fgrep|echo|printf|sleep|cmp|diff|basename|dirname|date|seq|true)(\s|$)/;

// `sed` only prints or substitutes: no -i/-f/-e/-s, and the script is one
// `Np`, `N,Mp` or `s<d>…<d>…<d>[gIp]` command, so no `w`/`e` can hide in it.
export function isReadOnlySed(segment: string): boolean {
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

export function isRehearsalDocker(segment: string): boolean {
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

export function isRehearsalCurl(segment: string, ctx: PolicyContext): boolean {
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
