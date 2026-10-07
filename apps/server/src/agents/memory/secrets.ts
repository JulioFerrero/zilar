// Best-effort detection of secret-looking text, used only to refuse a
// `remember` call (docs/audit/ai-memory-plan.md §3.5). It never logs or returns
// the match: the caller sees a fixed `refused: looks like a secret` line. The
// patterns are deliberately broad — a false positive costs one refused fact, a
// false negative stores a live credential in the mirror.

const SK_KEY = /sk-[A-Za-z0-9_-]{16,}/;
const GITHUB_KEY = /gh[pousr]_[A-Za-z0-9]{20,}/i;
const GITHUB_PAT = /github_pat_/i;
const AWS_KEY = /AKIA[0-9A-Z]{16}/;
const SLACK_KEY = /xox[abprs]-/i;
const JWT = /eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/;
const PEM_HEADER = /-----BEGIN/;
const LABELLED_VALUE =
  /(password|passwd|passcode|pwd|pin|otp|token|api[ _-]?key|secret)\s*[:=]\s*\S/i;
const LONG_RUN = /[A-Za-z0-9_-]{32,}/;

// A run of 32+ base64/URL-safe characters only counts when it mixes letters
// and digits: a long English word or a long number is not a key, but a hash or
// a token is. Checking the match is cheaper and clearer than two lookaheads.
function hasLongMixedRun(text: string): boolean {
  for (const match of text.matchAll(new RegExp(LONG_RUN, 'g'))) {
    const run = match[0];
    if (/[A-Za-z]/.test(run) && /\d/.test(run)) {
      return true;
    }
  }
  return false;
}

export function looksLikeSecret(text: string): boolean {
  return (
    SK_KEY.test(text) ||
    GITHUB_KEY.test(text) ||
    GITHUB_PAT.test(text) ||
    AWS_KEY.test(text) ||
    SLACK_KEY.test(text) ||
    JWT.test(text) ||
    PEM_HEADER.test(text) ||
    LABELLED_VALUE.test(text) ||
    hasLongMixedRun(text)
  );
}
