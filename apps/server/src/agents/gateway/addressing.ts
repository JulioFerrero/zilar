// A mention's `@` must sit at the start of the body or right after whitespace
// or an opening bracket/quote, so `a@deepseek.com` is an address, not a
// mention.
const AT_PREFIX = `(?:^|[\\s(\\[{"'])`;

// The name must end the body or be followed by whitespace or punctuation, so
// `@Deepseeker` does not match `Deepseek`.
const AT_SUFFIX = `(?:$|[\\s,.:;!?)\\]}'"])`;

/**
 * Whether `body` addresses an AI called by one of `names`, case-insensitively.
 * A name matches as `@<name>` (with a boundary on each side), or at the start
 * of the body followed by `,` or `:` as in "Deepseek, run the tests". Blank
 * names are ignored.
 */
export function bodyAddressesAi(body: string, names: readonly string[]): boolean {
  for (const name of names) {
    if (name.trim() === '') {
      continue;
    }
    const escaped = escapeRegExp(name);
    if (new RegExp(`${AT_PREFIX}@${escaped}${AT_SUFFIX}`, 'i').test(body)) {
      return true;
    }
    if (new RegExp(`^\\s*${escaped}[,:]`, 'i').test(body)) {
      return true;
    }
  }
  return false;
}
// V1 and V3 only apply to names of 4 or more characters: shorter names collide
// with common words ("Bob, come here" is not an address).
const MIN_VOCATIVE_NAME_LENGTH = 4;

// Rule R wakes an AI that replied in the room within the last two minutes, as
// long as no other AI has replied since.
const FOLLOW_UP_WINDOW_MS = 120_000;

// A question opens, whole word and case-insensitively, with one of these. Kept
// short on purpose; every other question relies on its trailing `?`.
const QUESTION_WORDS = [
  'what',
  'where',
  'when',
  'who',
  'whom',
  'whose',
  'why',
  'how',
  'which',
  'can',
  'could',
  'would',
  'will',
  'does',
  'do',
  'did',
  'is',
  'are',
  'am',
  'was',
  'were',
  'should',
  'shall',
  'may',
  'might',
] as const;

const QUESTION_WORD_RE = new RegExp(`^(?:${QUESTION_WORDS.join('|')})\\b`, 'i');

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function firstNonEmptyLine(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== '') {
      return trimmed;
    }
  }
  return '';
}

/**
 * Whether `body` reads as a question: its first non-empty line, trimmed, ends
 * with `?` or opens with a question word (whole word, case-insensitive). A `?`
 * on a later line does not count.
 */
export function isQuestion(body: string): boolean {
  const line = firstNonEmptyLine(body);
  if (line.endsWith('?')) {
    return true;
  }
  return QUESTION_WORD_RE.test(line);
}

export type WakeReason = 'address' | 'one_ai_question' | 'follow_up_question';

// V1: the body, after leading whitespace, starts with a name of at least four
// characters followed by whitespace, `,` or `:`.
function leadingVocative(body: string, names: readonly string[]): boolean {
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed.length < MIN_VOCATIVE_NAME_LENGTH) {
      continue;
    }
    const escaped = escapeRegExp(trimmed);
    if (new RegExp(`^\\s*@?${escaped}[,\\s:]`, 'i').test(body)) {
      return true;
    }
  }
  return false;
}

// V3: a name of at least four characters followed by `,` or `:` anywhere, with
// a word boundary before it.
function midSentenceVocative(body: string, names: readonly string[]): boolean {
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed.length < MIN_VOCATIVE_NAME_LENGTH) {
      continue;
    }
    const escaped = escapeRegExp(trimmed);
    if (new RegExp(`(?:^|\\W)${escaped}[,:]`, 'i').test(body)) {
      return true;
    }
  }
  return false;
}

/**
 * The reason to wake this AI for `body`, in priority order: a direct address
 * (V1–V3), then the one-AI-room question (S), then the follow-up question (R).
 * `null` means the message is not for this AI.
 */
export function decideWake(input: {
  body: string;
  names: readonly string[];
  liveAisInRoom: number;
  lastOwnReplyAtMs: number | null;
  otherAiRepliedSince: boolean;
  nowMs: number;
  rules: { oneAiQuestion: boolean; followUpQuestion: boolean };
}): WakeReason | null {
  const { body, names, liveAisInRoom, lastOwnReplyAtMs, otherAiRepliedSince, nowMs, rules } = input;

  if (
    bodyAddressesAi(body, names) ||
    leadingVocative(body, names) ||
    midSentenceVocative(body, names)
  ) {
    return 'address';
  }
  if (rules.oneAiQuestion && liveAisInRoom === 1 && isQuestion(body)) {
    return 'one_ai_question';
  }
  if (
    rules.followUpQuestion &&
    lastOwnReplyAtMs !== null &&
    nowMs - lastOwnReplyAtMs <= FOLLOW_UP_WINDOW_MS &&
    !otherAiRepliedSince &&
    isQuestion(body)
  ) {
    return 'follow_up_question';
  }
  return null;
}
