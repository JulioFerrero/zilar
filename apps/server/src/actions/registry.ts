import type { z } from 'zod';

// The context the adapter receives at execution time. `aiId` and `groupId`
// come from the gateway (never from the request), so an adapter can never be
// tricked into acting on a different AI's behalf. `requestId` is the id of
// the pending-action row the gateway wrote, in case the adapter wants to
// log it for its own bookkeeping (the adapter never sees the stored args
// outside of the `args` argument).
export interface ActionContext {
  aiId: string;
  groupId: string | null;
  requestId: string;
}

// The result an adapter returns on success. `summary` is what gets stored on
// the pending-action row (truncated to 500 chars) and bubbled up to the
// gateway caller; it must not include the adapter's internal error text.
export interface ActionResult {
  summary: string;
}

// The optional worst-case cost the adapter reports so the approval card can
// show it. `currency` is the same enum the audit log already understands.
export interface ActionCost {
  currency: 'EUR' | 'USD';
  amount: number;
}

// One adapter. `argsSchema` is a zod schema; the gateway calls
// `safeParse(input.args)` and uses the parsed value as the
// canonical-JSON/args-hash input. `describe` builds the card text
// (`summary` is the bolded line, `details` the body, both bounded).
// `execute` performs the side effect and returns the success summary.
export interface ActionAdapter<Args> {
  name: string;
  tier: 0 | 1 | 2;
  argsSchema: z.ZodType<Args>;
  describe: (args: Args) => { summary: string; details?: string };
  estimateCost?: (args: Args) => ActionCost;
  execute: (ctx: ActionContext, args: Args) => Promise<ActionResult>;
}

// A registry is a plain object indexed by adapter name. The gateway keeps
// it in a typed record so an unknown action answers `unknown_action`
// without a runtime lookup. Construction validates names and rejects
// duplicates at startup, so the running server never has to defend against
// a malformed registry.
export type ActionRegistry = Record<string, ActionAdapter<unknown>>;

// Adapters are registered by dotted name; the same regex the audit log
// uses (`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`) keeps the namespace flat
// and rejects typos that would silently make an action unreachable.
const ADAPTER_NAME_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

// Shape checks performed at startup so a buggy adapter never reaches the
// request path: `tier` must be one of the three values the spec defines,
// `name` must match the dotted pattern and be non-empty, and `describe` /
// `execute` must be functions.
export function buildRegistry(adapters: ReadonlyArray<ActionAdapter<unknown>>): ActionRegistry {
  const registry: ActionRegistry = {};
  for (const adapter of adapters) {
    if (typeof adapter.name !== 'string' || adapter.name === '') {
      throw new AdapterRegistryError('adapter name must be a non-empty string');
    }
    if (!ADAPTER_NAME_PATTERN.test(adapter.name)) {
      throw new AdapterRegistryError(
        `adapter name "${adapter.name}" does not match the dotted pattern`,
      );
    }
    if (registry[adapter.name] !== undefined) {
      throw new AdapterRegistryError(`duplicate adapter name "${adapter.name}"`);
    }
    if (adapter.tier !== 0 && adapter.tier !== 1 && adapter.tier !== 2) {
      throw new AdapterRegistryError(`adapter "${adapter.name}" has invalid tier ${adapter.tier}`);
    }
    if (typeof adapter.describe !== 'function') {
      throw new AdapterRegistryError(`adapter "${adapter.name}" is missing describe`);
    }
    if (typeof adapter.execute !== 'function') {
      throw new AdapterRegistryError(`adapter "${adapter.name}" is missing execute`);
    }
    registry[adapter.name] = adapter;
  }
  return registry;
}

export class AdapterRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterRegistryError';
  }
}
