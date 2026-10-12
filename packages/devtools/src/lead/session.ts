import { extractCommands } from './policy.js';

export type SessionState = 'idle' | 'running' | 'unknown';

export interface SessionSummary {
  state: SessionState;
  outcome: string | undefined;
  quotaError: boolean;
  questionRunning: boolean;
  questionText: string;
  questionIds: string[];
}

export interface ParsedPermission {
  id: string;
  action: string;
  commands: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function createdMs(message: unknown): number {
  if (!isRecord(message)) {
    return 0;
  }
  const time = message['time'];
  if (isRecord(time) && typeof time['created'] === 'number') {
    return time['created'];
  }
  return 0;
}

// When the newest message of a session was created (ms since epoch; 0 when
// unknown). The dashboard shows it as "last activity".
export function newestMessageMs(messages: unknown[]): number {
  return messages.reduce<number>((newest, message) => Math.max(newest, createdMs(message)), 0);
}

// Recursively looks for a provider quota failure. OpenCode classifies its own
// provider errors, and `provider.quota` also covers OpenCode Go's subscription
// limit: OpenCode maps `GoUsageLimitError` / a usage-limit message to
// QuotaExceeded (see the `gousagelimiterror` code and the usage-limit message
// patterns in the OpenCode 2.0.25 binary). T-1242 also treats a provider rate
// limit (`provider.rate-limit`), a 429 status, and a `limit`/`quota` message on
// a provider-typed error as quota, so a Go limit that surfaces one of those
// ways still moves the worker onto the fallback chain. T-1264 adds an expired
// or invalid provider credential (`provider.auth`, or a 401 status): that must
// move work onto the fallback chain like a quota error, or the run stalls
// silently with nothing to do. The text check only inspects provider-typed
// objects, so ordinary message or tool text can never match.
function containsQuotaError(value: unknown, depth: number): boolean {
  if (depth > 8 || !isRecord(value) || Array.isArray(value)) {
    if (Array.isArray(value) && depth <= 8) {
      return value.some((entry) => containsQuotaError(entry, depth + 1));
    }
    return false;
  }
  const type = value['type'];
  if (type === 'provider.quota' || type === 'provider.rate-limit' || type === 'provider.auth') {
    return true;
  }
  const status = value['status'];
  if (
    (status === 401 || status === 402 || status === 429) &&
    ('error' in value || 'message' in value || 'code' in value)
  ) {
    return true;
  }
  if (typeof type === 'string' && type.startsWith('provider.')) {
    const text = `${String(value['message'] ?? '')} ${String(value['code'] ?? '')}`;
    if (/limit|quota/i.test(text)) {
      return true;
    }
  }
  return Object.values(value).some((entry) => containsQuotaError(entry, depth + 1));
}

// Quota counts as active only while no newer message proves recovery: walk
// newest-first, and stop at the first assistant or error message that is not
// itself a quota failure. An old 402 followed by a normal reply is cleared;
// a run that ended on the quota error stays active.
function isQuotaActive(sortedDesc: unknown[]): boolean {
  for (const message of sortedDesc) {
    if (containsQuotaError(message, 0)) {
      return true;
    }
    if (isRecord(message) && (message['type'] === 'assistant' || message['type'] === 'error')) {
      return false;
    }
  }
  return false;
}

function collectQuestions(value: unknown, found: { id: string; text: string }[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectQuestions(entry, found);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  if (
    value['type'] === 'tool' &&
    value['name'] === 'question' &&
    isRecord(value['state']) &&
    value['state']['status'] === 'running'
  ) {
    const id = typeof value['id'] === 'string' ? value['id'] : '';
    const input = value['state']['input'];
    const questions =
      isRecord(input) && Array.isArray(input['questions']) ? input['questions'] : [];
    const texts = questions
      .map((entry) =>
        isRecord(entry) && typeof entry['question'] === 'string' ? entry['question'] : '',
      )
      .filter((text) => text.length > 0);
    if (id !== '') {
      found.push({ id, text: texts.join(' | ') });
    }
    return;
  }
  for (const entry of Object.values(value)) {
    collectQuestions(entry, found);
  }
}

// Reads newest-first messages (as returned by session.message.list with
// order=desc) into what the autopilot needs: is the run over, did quota
// bite, and is a `question` tool call waiting on input.
export function summarizeSession(messages: unknown[]): SessionSummary {
  const sorted = [...messages].sort((a, b) => createdMs(b) - createdMs(a));
  const newest = sorted[0];
  let state: SessionState = 'unknown';
  let outcome: string | undefined;
  if (isRecord(newest)) {
    if (newest['type'] === 'idle') {
      // An interrupt is usually the lead's own reply flow; the resumed run
      // is still to come, so it counts as running, not as a stall.
      if (newest['outcome'] === 'interrupted') {
        state = 'running';
      } else {
        state = 'idle';
      }
      outcome = typeof newest['outcome'] === 'string' ? newest['outcome'] : undefined;
    } else if (newest['type'] !== undefined) {
      state = 'running';
    }
  }
  const found: { id: string; text: string }[] = [];
  for (const message of sorted) {
    collectQuestions(message, found);
  }
  const seen = new Set<string>();
  const questionIds: string[] = [];
  for (const entry of found) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      questionIds.push(entry.id);
    }
  }
  return {
    state,
    outcome,
    quotaError: isQuotaActive(sorted),
    questionRunning: questionIds.length > 0,
    questionText: found
      .map((entry) => entry.text)
      .filter(Boolean)
      .join(' | '),
    questionIds,
  };
}

// A pending permission request, read defensively: anything unshaped is
// skipped by the caller rather than crashing the loop.
export function parsePermission(entry: unknown): ParsedPermission | null {
  if (!isRecord(entry)) {
    return null;
  }
  const id = entry['id'];
  const action = entry['action'];
  if (typeof id !== 'string' || typeof action !== 'string') {
    return null;
  }
  return { id, action, commands: extractCommands(entry['resources']) };
}
