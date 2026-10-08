import { Exit, Schema } from 'effect';

// The args schema an adapter carries: an Effect schema that decodes
// service-free (plan T-G removed the zod member).
export type ArgsSchema<Args> = Schema.Codec<Args, unknown, never>;

// The one decode seam for adapter args. Callers only need success or failure
// and the decoded value: the deny reason is the fixed `invalid_args`, so no
// message is produced here (the plan's issue walker belongs to T-B). The
// decode is strict (`onExcessProperty: 'error'`) to match the old zod
// schemas' `.strict()`.
export function decodeActionArgs<Args>(
  schema: ArgsSchema<Args>,
  raw: unknown,
): { ok: true; value: Args } | { ok: false } {
  const exit = Schema.decodeUnknownExit(schema, {
    onExcessProperty: 'error',
  })(raw);
  return Exit.isSuccess(exit) ? { ok: true, value: exit.value } : { ok: false };
}

// The context the adapter receives at execution time. `aiId`, `groupId`
// and `topicId` come from the gateway (never from the request), so an
// adapter can never be tricked into acting on a different AI's behalf.
// Personal chat = `groupId` and `topicId` both null; group chat = both
// set (T-0110 scope). `requestId` is the id of the pending-action row the
// gateway wrote, in case the adapter wants to log it for its own
// bookkeeping (the adapter never sees the stored args outside of the
// `args` argument).
export interface ActionContext {
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  requestId: string;
}

// The result an adapter returns on success. `summary` is what gets stored on
// the pending-action row (truncated to 500 chars) and bubbled up to the
// gateway caller; it must not include the adapter's internal error text.
// `modelText` (T-0105) carries a larger payload for the model only (tool
// source, a test run's output): the gateway returns it in the outcome of an
// immediately executed action, never stores it, never audits or logs it,
// never puts it in an announcement or an approval row.
export interface ActionResult {
  summary: string;
  modelText?: string;
}

// The hard ceiling on an adapter's `modelText`: longer text is truncated
// with `…`. 16 KiB is enough for a tool source or a failing test run's
// logs, small enough that it never bloats a turn.
export const ACTION_MODEL_TEXT_MAX_CHARS = 16 * 1024;

// Truncates an adapter's `modelText` to the ceiling above, appending `…`
// when cut. Pure so adapters and the gateway share it.
export function truncateModelText(value: string): string {
  if (value.length <= ACTION_MODEL_TEXT_MAX_CHARS) {
    return value;
  }
  return `${value.slice(0, ACTION_MODEL_TEXT_MAX_CHARS)}…`;
}

// The closing tag of the wrapper the agent gateway puts around `modelText`
// (see `agents/gateway.ts`). Adapters must never emit it: the gateway
// strips every occurrence before wrapping so a tool's output cannot break
// out of the labelled block.
export const MODEL_TEXT_WRAPPER_CLOSE = '</untrusted-tool-output>';

// Removes every occurrence of the wrapper's closing tag from `modelText`
// so a hostile tool output cannot close the labelled block early.
//
// Matching is case-insensitive and tolerates whitespace inside the tag, and it
// repeats until nothing is left to remove: a single pass would let
// `</untrusted-tool-<untrusted-tool-output>output>` collapse into a working
// closing tag once the inner one is removed.
const MODEL_TEXT_CLOSE_PATTERN = /<\/\s*untrusted-tool-output\s*>/gi;

export function stripModelTextCloseTag(value: string): string {
  let current = value;
  for (;;) {
    const next = current.replace(MODEL_TEXT_CLOSE_PATTERN, '');
    if (next === current) {
      return current;
    }
    current = next;
  }
}

// The optional worst-case cost the adapter reports so the approval card can
// show it. `currency` is the same enum the audit log already understands.
export interface ActionCost {
  currency: 'EUR' | 'USD';
  amount: number;
}

// One adapter. `argsSchema` is an Effect schema. The gateway calls
// `decodeActionArgs(input.args)` and uses the parsed value as the
// canonical-JSON/args-hash input. `describe` builds the card text
// (`summary` is the bolded line, `details` the body, both bounded).
// `description` is one short line the model sees in the `request_action`
// tool definition, so it knows what each adapter does without a long card.
// `execute` performs the side effect and returns the success summary.
//
// `allowAlways` (T-0099) opts the adapter in to the standing-rule flow:
// an owner who clicks "Approve always" in this chat for this action
// creates an `approval_rules` row that runs future matching requests
// without a card. Off by default — most adapters should never be granted
// a standing approval. Adapters that report a worst-case cost
// (`estimateCost`) cannot opt in: money is never auto-approved.
export interface ActionAdapter<Args> {
  name: string;
  description: string;
  tier: 0 | 1 | 2;
  argsSchema: ArgsSchema<Args>;
  describe: (args: Args) => { summary: string; details?: string };
  estimateCost?: (args: Args) => ActionCost;
  /**
   * When `true`, an "Approve always" decision for this adapter is
   * accepted and stored as an `approval_rules` row. When `false` or
   * omitted, an "Approve always" decision is refused with 400
   * `always_not_allowed`. Adapters that report a worst-case cost
   * (`estimateCost`) cannot opt in: the registry rejects the
   * combination at startup so money can never get a standing approval.
   */
  allowAlways?: boolean;
  execute: (ctx: ActionContext, args: Args) => Promise<ActionResult>;
  /**
   * Optional server-side normalisation of the parsed args, run by the
   * gateway on the approval path (T-0132) before the args hash is computed
   * and the card is described. Lets a tier-2 adapter bind server-side state
   * (e.g. hosts read from the DB at card time) into the stored args, so the
   * fail-safe holds: any state change after the card means the execution
   * cannot match and fails. Async-capable; a throw becomes the gateway's
   * generic `failed` via the approval path's error handling. Never called
   * on the allow or auto-approved paths.
   */
  prepareArgs?: (ctx: ActionContext, args: Args) => Promise<Args> | Args;
}

// The hard ceiling on an adapter's description: short enough to fit one
// line in the `request_action` tool definition next to the action name.
export const ADAPTER_DESCRIPTION_MAX_LENGTH = 200;

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
// `name` must match the dotted pattern and be non-empty, `description`
// must be a one-line string under the ceiling, and `describe` / `execute`
// must be functions.
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
    if (typeof adapter.description !== 'string' || adapter.description.trim() === '') {
      throw new AdapterRegistryError(`adapter "${adapter.name}" is missing a description`);
    }
    if (adapter.description.length > ADAPTER_DESCRIPTION_MAX_LENGTH) {
      throw new AdapterRegistryError(
        `adapter "${adapter.name}" description is over ${ADAPTER_DESCRIPTION_MAX_LENGTH} characters`,
      );
    }
    if (typeof adapter.describe !== 'function') {
      throw new AdapterRegistryError(`adapter "${adapter.name}" is missing describe`);
    }
    if (typeof adapter.execute !== 'function') {
      throw new AdapterRegistryError(`adapter "${adapter.name}" is missing execute`);
    }
    // T-0099: an adapter that reports a worst-case cost can never opt in
    // to standing rules — money is never auto-approved. The registry
    // refuses the combination at startup so a misconfigured demo or
    // future adapter can never reach the request path with this state.
    if (adapter.allowAlways === true && adapter.estimateCost !== undefined) {
      throw new AdapterRegistryError(
        `adapter "${adapter.name}" has allowAlways=true but reports a worst-case cost; ` +
          'money must not be auto-approved',
      );
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

// T-0099: the "always-eligible" predicate the approvals routes use to
// decide whether `approve_always` is a real choice (button shown, rule
// created) or an unavailable one (400 `always_not_allowed`). It folds
// the three blockers the spec names into a single boolean:
//   - the action must be registered (unknown actions never get a card)
//   - the adapter must have opted in via `allowAlways: true`
//   - the adapter must not report a worst-case cost (money is never
//     auto-approved)
//
// Keeping it here, next to the registry, means the predicate and the
// validation rules above cannot drift apart — a future change that
// rejects `allowAlways + estimateCost` at startup also makes this
// predicate return `false` for the same case at runtime.
export function buildAlwaysEligible(registry: ActionRegistry): (action: string) => boolean {
  return (action: string): boolean => {
    const adapter = registry[action];
    if (adapter === undefined) {
      return false;
    }
    if (adapter.allowAlways !== true) {
      return false;
    }
    if (adapter.estimateCost !== undefined) {
      return false;
    }
    return true;
  };
}
