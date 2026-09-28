// Pure log classification for the boot check: given the lines Metro printed and
// the lines the simulator printed for the app, say whether the boot failed, or
// whether the JS bundle has loaded. No I/O here.

export type LogVerdict =
  { status: 'pending' } | { status: 'bundled' } | { status: 'failed'; reason: string };

const FAILURE_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /Cannot find native module/, reason: 'the app reported "Cannot find native module"' },
  {
    pattern: /Unable to resolve/,
    reason: 'Metro reported "Unable to resolve" (stale JS dependencies?)',
  },
  { pattern: /Invariant Violation/, reason: 'the app reported an Invariant Violation' },
  { pattern: /Bundling failed/, reason: 'the JS bundle failed to build' },
  {
    // A standalone ERROR token: Expo/Metro print red boxes as " ERROR  ...",
    // while noisy platform lines like "Socket SO_ERROR" must not match.
    pattern: /(^|[^A-Za-z0-9_])ERROR([^A-Za-z0-9_]|$)/,
    reason: 'the app logged an ERROR (red box)',
  },
];

const ESC = 0x1b;

function isControlSequenceFinalByte(character: string): boolean {
  const code = character.charCodeAt(0);
  return code >= 0x40 && code <= 0x7e;
}

/**
 * Remove ANSI escape sequences so patterns match what a human would read. This
 * is a small parser rather than a regular expression because matching control
 * characters in regular expressions is banned by the linter.
 */
export function stripAnsi(line: string): string {
  let out = '';
  let index = 0;
  while (index < line.length) {
    if (line.charCodeAt(index) !== ESC) {
      out += line[index];
      index += 1;
      continue;
    }
    const selector = line[index + 1];
    if (selector === '[') {
      index += 2;
      while (index < line.length && !isControlSequenceFinalByte(line[index])) {
        index += 1;
      }
      index += 1;
    } else if (selector === undefined) {
      index += 1;
    } else {
      index += 2;
    }
  }
  return out;
}

/** The first failure this line signals, or null when the line is benign. */
export function findFailureReason(line: string): string | null {
  const text = stripAnsi(line);
  for (const { pattern, reason } of FAILURE_PATTERNS) {
    if (pattern.test(text)) {
      return reason;
    }
  }
  return null;
}

/** True for Metro's "Bundled 156ms (...)" success line. */
export function isBundleLoadedLine(line: string): boolean {
  return /\bBundled\b/.test(stripAnsi(line));
}

/**
 * True for React Native's "Running "main" with {...}" line, which the JS side
 * logs when AppRegistry mounts the root component — the earliest reliable
 * evidence in the app log that the JS app actually ran.
 */
export function isFirstRenderLine(line: string): boolean {
  return /Running "[^"]+" with \{/.test(stripAnsi(line));
}

const LOG_LINE_TIMESTAMP = /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?)/;

/**
 * Milliseconds (local time) of a `log show --style compact` line's leading
 * timestamp, or null when the line has none. Used to ignore log lines written
 * before the launch being watched.
 */
export function logLineTimestampMs(line: string): number | null {
  const match = LOG_LINE_TIMESTAMP.exec(line);
  if (!match) {
    return null;
  }
  const parsed = Date.parse(match[1].replace(' ', 'T'));
  return Number.isNaN(parsed) ? null : parsed;
}

export interface WatchInput {
  metroLog: string;
  appLog: string;
  appExited?: boolean;
}

/**
 * Verdict over everything seen so far. A failure anywhere always wins over a
 * loaded bundle (a red box after a successful bundle is still a broken app).
 */
export function evaluateWatch(input: WatchInput): LogVerdict {
  let bundled = false;
  for (const line of input.metroLog.split('\n')) {
    const failure = findFailureReason(line);
    if (failure) {
      return { status: 'failed', reason: failure };
    }
    bundled = bundled || isBundleLoadedLine(line);
  }
  for (const line of input.appLog.split('\n')) {
    const failure = findFailureReason(line);
    if (failure) {
      return { status: 'failed', reason: failure };
    }
  }
  if (input.appExited) {
    return { status: 'failed', reason: 'the app process exited' };
  }
  if (bundled) {
    return { status: 'bundled' };
  }
  return { status: 'pending' };
}
