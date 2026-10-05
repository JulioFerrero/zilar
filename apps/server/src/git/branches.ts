// Decides whether an AI may push to a git branch. This is the security core of
// the git proxy: the proxy never holds the AI's own credentials, and this
// function is the single place that decides what branch space an AI may write.
//
// The rule, from the plan: an AI may push only to `agent/<ai>/*`.
//
// The input is a bare branch name (e.g. `agent/alice/feature`), never a full
// ref. A full ref such as `refs/heads/agent/alice/feature` is rejected here so
// that a caller which forgets to strip the `refs/heads/` prefix fails closed.
//
// Branch and AI names are compared case-sensitively, matching git and GitHub:
// `Agent/alice/x` and `agent/Alice/x` are not the same branch as
// `agent/alice/x`.

export type PushDecision = { allowed: true } | { allowed: false; reason: PushRejectionReason };

export type PushRejectionReason =
  'path-traversal' | 'full-ref' | 'not-agent-branch' | 'wrong-agent';

export function isPushAllowed(aiName: string, branch: string): PushDecision {
  // Reject anything that could later be used to build a path or a remote URL:
  // a leading slash or any `..`. This runs before the value is used for
  // anything else.
  if (branch.startsWith('/') || branch.includes('..')) {
    return { allowed: false, reason: 'path-traversal' };
  }

  // The proxy strips `refs/heads/`; a raw ref reaching this function means the
  // caller skipped a step, so reject rather than guess.
  if (branch.startsWith('refs/')) {
    return { allowed: false, reason: 'full-ref' };
  }

  const segments = branch.split('/');

  // Any empty or `.` segment is also a path-style value.
  if (segments.some((segment) => segment === '' || segment === '.')) {
    return { allowed: false, reason: 'path-traversal' };
  }

  // agent/<ai>/<branch…> requires at least three non-empty segments.
  if (segments.length < 3 || segments[0] !== 'agent') {
    return { allowed: false, reason: 'not-agent-branch' };
  }

  if (segments[1] !== aiName) {
    return { allowed: false, reason: 'wrong-agent' };
  }

  return { allowed: true };
}
