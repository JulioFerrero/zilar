export function normalize(command: string): string {
  return command.replace(/\s+/g, ' ').trim();
}

// Splits `a && b; c || d | e` into segments so one dangerous segment can't
// hide behind a harmless one. Quote-aware: `grep -iE "port|device"` stays
// whole. `$(…)` and backticks stay inside their segment, but the substring
// rules below still see them, since substitution executes.
export function splitSegments(command: string): string[] {
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
export function stripEnvPrefix(segment: string): string {
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

export function firstWord(segment: string): string {
  return stripEnvPrefix(segment).split(' ')[0] ?? '';
}

// The remainder of a git invocation after the `git` global flags
// (`-C <path>`, `-c k=v`, `--no-pager`, `--git-dir=…`, `--work-tree=…`),
// so `git -C /elsewhere push` can't dodge the subcommand rules. Null when
// the segment is not a git invocation at all.
export function gitRest(segment: string): string | null {
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

export function gitMatches(segment: string, pattern: RegExp): boolean {
  const rest = gitRest(segment);
  return rest !== null && pattern.test(rest);
}

// A bare shell or interpreter as the whole segment: the pipe-to-shell
// pattern (`curl … | sh`, `… | xargs …`) or a wrapper hiding the real
// command (`sh -c …`, `bash -s`, `eval …`, `source …`). Never allowed:
// the lead cannot review code it never sees as text.
export function isBareShell(segment: string): boolean {
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

// Tokenizes a segment on whitespace the way the shell would split it:
// single/double quotes group, backslash escapes. Needed so curl flag parsing
// below sees `-H "Authorization: Bearer x"` as one value, not three tokens.
export function splitArgs(segment: string): string[] {
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
