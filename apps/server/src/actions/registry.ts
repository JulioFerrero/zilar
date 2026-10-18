import { Exit, Schema } from 'effect';

// The args schema an adapter carries: an Effect schema that decodes service-free.
export type ArgsSchema<Args> = Schema.Codec<Args, unknown, never>;

// The one decode seam for adapter args; strict (`onExcessProperty: 'error'`), and failures answer the fixed `invalid_args`.
export function decodeActionArgs<Args>(
  schema: ArgsSchema<Args>,
  raw: unknown,
): { ok: true; value: Args } | { ok: false } {
  const exit = Schema.decodeUnknownExit(schema, {
    onExcessProperty: 'error',
  })(raw);
  return Exit.isSuccess(exit) ? { ok: true, value: exit.value } : { ok: false };
}

// The gateway's redacting logger for ops warnings; adapters log ids only, never message text, args or tool output.
export interface ActionContextLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

// `aiId`, `groupId` and `topicId` come from the gateway, never the request, so an adapter cannot act for another AI.
// Personal chat = both group and topic null; group chat = both set.
export interface ActionContext {
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  requestId: string;
  logger?: ActionContextLogger;
}

// `summary` is stored on the row (truncated to 500 chars) and must not contain adapter error text.
// `modelText` goes to the model only: never stored, audited, logged or announced.
export interface ActionResult {
  summary: string;
  modelText?: string;
  // True when the adapter already posted its answer into the room, so the group turn sends no echo.
  posted?: boolean;
}

// 16 KiB is enough for a tool source or a failing test run's logs without bloating a turn.
export const ACTION_MODEL_TEXT_MAX_CHARS = 16 * 1024;

export function truncateModelText(value: string): string {
  if (value.length <= ACTION_MODEL_TEXT_MAX_CHARS) {
    return value;
  }
  return `${value.slice(0, ACTION_MODEL_TEXT_MAX_CHARS)}…`;
}

// Removes every closing tag from `modelText` so hostile output cannot close the labelled block early.
// Case-insensitive, whitespace-tolerant, repeated until none is left: one pass would let nested tags collapse into one.
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

// Optional worst-case cost for the approval card; `currency` is the audit log's enum.
export interface ActionCost {
  currency: 'EUR' | 'USD';
  amount: number;
}

// `argsSchema` decodes the request args; `describe` builds the bounded card text; `description` and `argsExample` are what the model sees.
// `allowAlways` opts into standing rules; an adapter with `estimateCost` cannot opt in because money is never auto-approved.
export interface ActionAdapter<Args> {
  name: string;
  description: string;
  tier: 0 | 1 | 2;
  argsSchema: ArgsSchema<Args>;
  // Compact JSON of valid args, accepted by its own `argsSchema`, shown to the model.
  argsExample?: string;
  describe: (args: Args) => { summary: string; details?: string };
  estimateCost?: (args: Args) => ActionCost;
  // Accepts "Approve always"; refusal is 400 `always_not_allowed`. An adapter with `estimateCost`
  // cannot opt in: money is never auto-approved.
  allowAlways?: boolean;
  execute: (ctx: ActionContext, args: Args) => Promise<ActionResult>;
  // Server-side normalisation before the args hash and card, so a state change after the card makes execution fail.
  // Never called on the allow or auto-approved paths.
  prepareArgs?: (ctx: ActionContext, args: Args) => Promise<Args> | Args;
}

// Short enough to fit one line next to the action name.
export const ADAPTER_DESCRIPTION_MAX_LENGTH = 200;

export const ADAPTER_ARGS_EXAMPLE_MAX_LENGTH = 200;

// Validated at startup, so the running server never defends against a malformed registry.
export type ActionRegistry = Record<string, ActionAdapter<unknown>>;

// Dotted names, same regex as the audit log, so typos cannot silently make an action unreachable.
const ADAPTER_NAME_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

// Shape checks at startup so a buggy adapter never reaches the request path.
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
    if (
      adapter.argsExample !== undefined &&
      adapter.argsExample.length > ADAPTER_ARGS_EXAMPLE_MAX_LENGTH
    ) {
      throw new AdapterRegistryError(
        `adapter "${adapter.name}" argsExample is over ${ADAPTER_ARGS_EXAMPLE_MAX_LENGTH} characters`,
      );
    }
    if (typeof adapter.describe !== 'function') {
      throw new AdapterRegistryError(`adapter "${adapter.name}" is missing describe`);
    }
    if (typeof adapter.execute !== 'function') {
      throw new AdapterRegistryError(`adapter "${adapter.name}" is missing execute`);
    }
    // A cost-reporting adapter can never opt into standing rules: money is never auto-approved.
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

// Whether `approve_always` is a real choice: action registered, `allowAlways: true`, and no `estimateCost`.
// Kept next to the registry so the predicate and the startup validation cannot drift apart.
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
