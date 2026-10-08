import { decodeActionArgs, type ActionAdapter } from './registry';

// The stable reason codes the gateway answers. They are the wire enum the
// audit log and any future client of `request` see; the strings are the
// values that end up in audit `detail` and `reason`.
export type PolicyDenialReason =
  'unknown_action' | 'invalid_args' | 'ai_not_active' | 'ai_not_in_group';

export type PolicyVerdict =
  | { kind: 'allow'; tier: 0 | 1 }
  | { kind: 'require_approval'; tier: 2 }
  | { kind: 'deny'; reason: PolicyDenialReason };

// The inputs the policy reads. The gateway owns the database reads and the
// order of checks; the policy is a pure function over its inputs.
//
// `aiStatus === null` means the AI does not exist (or the gateway could not
// read it); either way it ends up as `ai_not_active` so a stopped AI is
// indistinguishable from one that was never created. `aiInGroup` is null
// when the request did not name a group; in that case the check is skipped.
export interface PolicyInput {
  adapter: ActionAdapter<unknown> | null;
  rawArgs: unknown;
  aiStatus: 'active' | 'disabled' | 'stopped' | null;
  aiInGroup: boolean | null;
}

// Policy v1 (decided; not configurable): the gateway runs the checks in
// this exact order, so the reason the caller sees is the first one that
// trips. Unknown action → deny `unknown_action`. Then: AI must exist and
// be `active` → otherwise `ai_not_active`. Then, when a group was named,
// the AI must belong to that group → otherwise `ai_not_in_group`. Then the
// args must parse against the adapter's args schema → otherwise
// `invalid_args`. Finally the tier decides: 0/1 → allow, 2 → require
// approval. Nothing the AI writes can lower a tier, because the tier comes
// from the registered adapter, not from the request.
export function policy(input: PolicyInput): PolicyVerdict {
  if (input.adapter === null) {
    return { kind: 'deny', reason: 'unknown_action' };
  }
  if (input.aiStatus !== 'active') {
    return { kind: 'deny', reason: 'ai_not_active' };
  }
  if (input.aiInGroup === false) {
    return { kind: 'deny', reason: 'ai_not_in_group' };
  }
  const parsed = decodeActionArgs(input.adapter.argsSchema, input.rawArgs);
  if (!parsed.ok) {
    return { kind: 'deny', reason: 'invalid_args' };
  }
  if (input.adapter.tier <= 1) {
    return { kind: 'allow', tier: input.adapter.tier as 0 | 1 };
  }
  return { kind: 'require_approval', tier: 2 };
}
