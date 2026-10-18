import { extractCommands } from './policy.js';

export type SessionState = 'idle' | 'running' | 'unknown';

export interface SessionSummary {
  state: SessionState;
  outcome: string | undefined;
  quotaError: boolean;
  // Short text of the newest active free-gateway refusal, or undefined; the autopilot
  // pauses the free listings on it.
  freeRefusal: string | undefined;
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

// When the newest message was created (ms since epoch; 0 when unknown).
export function newestMessageMs(messages: unknown[]): number {
  return messages.reduce<number>((newest, message) => Math.max(newest, createdMs(message)), 0);
}

// The text OpenCode's free gateway sends when it refuses traffic: an "abuse"
// refusal, or a listing reported as "Model unavailable".
const FREE_REFUSAL = /abuse|forbidden|model unavailable/i;

// The provider errors that count as a quota failure: `provider.quota` (which covers
// OpenCode Go's subscription limit), a free-gateway 403 or refusal text, plus a rate
// a 429, a `limit`/`quota` message and an expired credential (401), so a Go limit or a
// dead key moves the worker onto the fallback chain instead of stalling. The text check
// only inspects provider-typed objects, so ordinary message or tool text cannot match.
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
    (status === 401 || status === 402 || status === 403 || status === 429) &&
    ('error' in value || 'message' in value || 'code' in value)
  ) {
    return true;
  }
  if (typeof type === 'string' && type.startsWith('provider.')) {
    const text = `${String(value['message'] ?? '')} ${String(value['code'] ?? '')}`;
    if (/limit|quota|abuse|forbidden|model unavailable/i.test(text)) {
      return true;
    }
  }
  return Object.values(value).some((entry) => containsQuotaError(entry, depth + 1));
}

function refusalText(value: unknown, depth: number): string | undefined {
  if (depth > 8 || !isRecord(value) || Array.isArray(value)) {
    return undefined;
  }
  const type = value['type'];
  const status = value['status'];
  if (
    (typeof type === 'string' && type.startsWith('provider.')) ||
    (status === 403 && ('error' in value || 'message' in value || 'code' in value))
  ) {
    const error = value['error'];
    const message = (
      isRecord(error) ? `${String(error['message'] ?? '')}` : `${String(value['message'] ?? '')}`
    ).trim();
    const code = `${String(value['code'] ?? '')}`.trim();
    const detail = message.length > 0 ? message : code;
    if (FREE_REFUSAL.test(message) || FREE_REFUSAL.test(code) || status === 403) {
      return detail.length > 160 ? `${detail.slice(0, 160)}…` : detail;
    }
  }
  for (const entry of Object.values(value)) {
    const found = refusalText(entry, depth + 1);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

// The newest refusal no later reply has cleared, mirroring isQuotaActive.
function isFreeRefusalActive(sortedDesc: unknown[]): string | undefined {
  for (const message of sortedDesc) {
    const detail = refusalText(message, 0);
    if (detail !== undefined) {
      return detail;
    }
    if (isRecord(message) && (message['type'] === 'assistant' || message['type'] === 'error')) {
      return undefined;
    }
  }
  return undefined;
}

// Quota is active only while no newer message proves recovery: walk newest-first and
// stop at the first non-quota assistant or error message.
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

// Reads newest-first messages into what the autopilot needs: is the run over, did quota
// bite, and is a `question` call waiting.
export function summarizeSession(messages: unknown[]): SessionSummary {
  const sorted = [...messages].sort((a, b) => createdMs(b) - createdMs(a));
  const newest = sorted[0];
  let state: SessionState = 'unknown';
  let outcome: string | undefined;
  if (isRecord(newest)) {
    if (newest['type'] === 'idle') {
      // An interrupt is usually the lead's own reply flow; the resumed run still counts as running.
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
    freeRefusal: isFreeRefusalActive(sorted),
    questionRunning: questionIds.length > 0,
    questionText: found
      .map((entry) => entry.text)
      .filter(Boolean)
      .join(' | '),
    questionIds,
  };
}

// A pending permission request, read defensively: anything unshaped is skipped.
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
