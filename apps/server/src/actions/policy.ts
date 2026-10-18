import { decodeActionArgs, type ActionAdapter } from './registry';

// Stable reason codes; these strings end up in audit `detail` and `reason`.
export type PolicyDenialReason =
  | 'unknown_action'
  | 'invalid_args'
  | 'ai_not_active'
  | 'ai_not_in_group'
  // Returned by the gateway, not the policy, for an unattended tier-2 request with no standing rule.
  | 'needs_approval';

export type PolicyVerdict =
  | { kind: 'allow'; tier: 0 | 1 }
  | { kind: 'require_approval'; tier: 2 }
  | { kind: 'deny'; reason: PolicyDenialReason };

// Pure function over its inputs; `aiStatus === null` and a stopped AI both answer `ai_not_active`.
export interface PolicyInput {
  adapter: ActionAdapter<unknown> | null;
  rawArgs: unknown;
  aiStatus: 'active' | 'disabled' | 'stopped' | null;
  aiInGroup: boolean | null;
}

// Checks run in this order, so the caller sees the first reason that trips: unknown action, AI active, AI in group, args parse, tier.
// The tier comes from the registered adapter, so nothing the AI writes can lower it.
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
