// The rule lives in `@zilar/protocol`; it is re-exported so `markdown.ts` and the web AI badge can never disagree.
export type AiTemplateId = 'dev' | 'marketing' | 'fun' | 'custom';

// A `null` bound means the owner set no limit; new AIs start with both empty, so the server stores NULL.
export interface AiLimitsUsd {
  perDayUsd: number | null;
  perMonthUsd: number | null;
}

export interface AiCreateFields {
  name: string;
  template: AiTemplateId;
  persona: string;
  personaTouched: boolean;
  providerConnectionId: string | null;
  model: string;
}

export interface AiCreateBody {
  name: string;
  template: AiTemplateId;
  persona?: string;
  providerConnectionId: string;
  model: string;
  limits: AiLimitsUsd;
}

export interface AiPatchBody {
  name?: string;
  persona?: string;
  limits?: AiLimitsUsd;
}

// The POST body the server's strict CreateAiSchema accepts: exactly these keys.
// `persona` is omitted for an unedited stock template so the server applies its own default.
export function buildCreateBody(
  form: AiCreateFields,
  limits: AiLimitsUsd | null,
): AiCreateBody | null {
  if (form.providerConnectionId === null || limits === null) {
    return null;
  }
  const sendPersona = form.template === 'custom' || form.personaTouched;
  return {
    name: form.name.trim(),
    template: form.template,
    ...(sendPersona ? { persona: form.persona.trim() } : {}),
    providerConnectionId: form.providerConnectionId,
    model: form.model.trim(),
    limits,
  };
}

// PATCH carries only the fields that actually changed.
export function buildPatch(input: {
  name: string;
  originalName: string;
  persona: string;
  originalPersona: string;
  limits: AiLimitsUsd | null;
  originalLimits: AiLimitsUsd;
}): AiPatchBody | null {
  const patch: AiPatchBody = {};
  if (input.name.trim() !== input.originalName) {
    patch.name = input.name.trim();
  }
  if (input.persona.trim() !== input.originalPersona) {
    patch.persona = input.persona.trim();
  }
  if (
    input.limits !== null &&
    (input.limits.perDayUsd !== input.originalLimits.perDayUsd ||
      input.limits.perMonthUsd !== input.originalLimits.perMonthUsd)
  ) {
    patch.limits = input.limits;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

// The four default personas mirror `apps/server/src/ais/templates.ts`, the source of truth: update these strings when the server persona changes.
export interface AiTemplateOption {
  id: AiTemplateId;
  label: string;
  description: string;
  defaultPersona: string;
}

export const AI_TEMPLATE_OPTIONS: readonly AiTemplateOption[] = [
  {
    id: 'dev',
    label: 'Dev',
    description: 'A concise engineer who writes tests',
    defaultPersona:
      'You are a concise senior engineer. Prefer small, reviewable changes and always write tests for the logic you add. Say what you changed and why, and ask before touching anything outside the task.',
  },
  {
    id: 'marketing',
    label: 'Marketing',
    description: 'A clear, friendly copywriter',
    defaultPersona:
      'You are a clear, friendly copywriter. Write in plain language, lead with the benefit, and keep it short. Ask for the audience and the goal when they are not obvious.',
  },
  {
    id: 'fun',
    label: 'Fun',
    description: 'A playful group-chat host',
    defaultPersona:
      'You are a playful group-chat host. Keep the energy up, be warm and quick with a joke, and make sure everyone gets a turn. Bring a game or a plan when the room goes quiet.',
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Write the persona yourself',
    defaultPersona: '',
  },
];

export function defaultPersonaFor(template: AiTemplateId): string {
  return AI_TEMPLATE_OPTIONS.find((option) => option.id === template)?.defaultPersona ?? '';
}

// The server's ceiling; it is a product safety limit, so the client can only narrow it.
export const MAX_MONTHLY_USD = 200;

export interface LimitsValidation {
  limits: AiLimitsUsd | null;
  dayError: string;
  monthError: string;
}

// The server's `LimitsSchema` twin: an empty field means no limit; a set amount must be positive,
// the day must fit inside the month, and the month is capped. USD, because that is what the server stores.
export function validateLimits(dayText: string, monthText: string): LimitsValidation {
  const day = parseAmount(dayText);
  const month = parseAmount(monthText);
  const dayValue = day === undefined ? null : day;
  const monthValue = month === undefined ? null : month;
  let dayError = '';
  let monthError = '';

  if (day === undefined) {
    dayError = 'Enter a daily amount greater than 0';
  }
  if (month === undefined) {
    monthError = 'Enter a monthly amount greater than 0';
  }
  if (dayValue !== null && monthValue !== null && dayValue > monthValue) {
    dayError = 'The daily limit must not exceed the monthly limit';
  }
  if (monthValue !== null && monthValue > MAX_MONTHLY_USD) {
    monthError = `The monthly limit must be at most $${MAX_MONTHLY_USD}`;
  }

  return {
    limits:
      dayError === '' && monthError === ''
        ? { perDayUsd: dayValue, perMonthUsd: monthValue }
        : null,
    dayError,
    monthError,
  };
}

// `null` for an empty field (no limit), `undefined` for text that is not a positive amount.
function parseAmount(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

export function formatLimit(value: number | null): string {
  return value === null ? 'No limit' : `$${value}`;
}

// The model input is always editable; these hints are the picker's fallback when models.dev cannot be reached.
const MODEL_SUGGESTIONS: Record<string, readonly string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  xai: ['grok-4', 'grok-3', 'grok-3-mini'],
  openrouter: ['openai/gpt-4o', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-pro'],
};

export function modelSuggestionsFor(provider: string): readonly string[] {
  return MODEL_SUGGESTIONS[provider] ?? [];
}

export function defaultModelFor(provider: string): string {
  return modelSuggestionsFor(provider)[0] ?? '';
}

// `AiCatalogModel` is assignable to this, so a picker takes the wire type without `chat-core` depending on `@zilar/api-contract`.
export interface CatalogModelView {
  readonly id: string;
  readonly name: string;
  readonly contextTokens: number;
  readonly inputPricePerMTok: number | null;
  readonly outputPricePerMTok: number | null;
  readonly toolCalls: boolean;
}

export function defaultCatalogModelId(models: readonly CatalogModelView[]): string {
  return (models.find((model) => model.toolCalls) ?? models[0])?.id ?? '';
}

// `0` means the catalog did not know the size.
export function formatContextTokens(tokens: number): string {
  if (tokens <= 0) {
    return '—';
  }
  if (tokens >= 1_000_000) {
    return `${trimNumber(tokens / 1_000_000)}M`;
  }
  if (tokens >= 1_000) {
    return `${trimNumber(tokens / 1_000)}K`;
  }
  return String(tokens);
}

export function formatModelPrices(input: number | null, output: number | null): string {
  if (input === null || output === null) {
    return 'Price unavailable';
  }
  return `$${formatModelUsd(input)} / $${formatModelUsd(output)} per M tokens`;
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

function formatModelUsd(value: number): string {
  if (value === 0) {
    return '0';
  }
  if (value >= 0.0001) {
    return String(Number(value.toFixed(4)));
  }
  return value.toExponential(1);
}

// `github` is a git integration, not an LLM provider: the server refuses it for an AI, so the wizard hides it while Connections still offers it.
export interface AiProvider {
  readonly id: string;
  readonly label: string;
}

// The ids match `PROVIDER_IDS` in the API contract.
export const AI_PROVIDERS: readonly AiProvider[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google Gemini' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'xai', label: 'xAI' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'openai-compatible', label: 'OpenAI-compatible' },
  { id: 'github', label: 'GitHub' },
  { id: 'brave', label: 'Brave Search' },
  { id: 'exa', label: 'Exa' },
  { id: 'firecrawl', label: 'Firecrawl' },
  { id: 'jina', label: 'Jina' },
  { id: 'tavily', label: 'Tavily' },
];

// The ids that can back an AI; `github` is deliberately absent.
export const LLM_PROVIDER_IDS: readonly string[] = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'xai',
  'openrouter',
  'openai-compatible',
];

export const LLM_PROVIDERS: readonly AiProvider[] = AI_PROVIDERS.filter((provider) =>
  LLM_PROVIDER_IDS.includes(provider.id),
);

export function isLlmProvider(id: string): boolean {
  return LLM_PROVIDER_IDS.includes(id);
}

export function providerLabel(id: string): string {
  return AI_PROVIDERS.find((provider) => provider.id === id)?.label ?? id;
}

const SUGGESTIONS: Record<string, readonly string[]> = {
  dev: ['What can you do?', 'Review my last change', 'Plan a small feature'],
  marketing: ['What can you do?', 'Write a launch post', 'Improve this headline'],
};

const DEFAULT_SUGGESTIONS: readonly string[] = [
  'What can you do?',
  'Summarize a link for me',
  'Help me plan my day',
];

export function aiSuggestions(template: string): readonly string[] {
  return SUGGESTIONS[template] ?? DEFAULT_SUGGESTIONS;
}

export interface AiErrorInfo {
  // A clear message for the user; never a raw code or a stack trace.
  message: string;
  // True when the server has AI management switched off (503).
  unavailable: boolean;
}

export interface AiFailure {
  code: string;
  status: number;
  message: string;
}

// `invalid_request` keeps the server's own message because it explains which field is wrong.
export function describeAiFailure(error: AiFailure): AiErrorInfo {
  switch (error.code) {
    case 'ais_unavailable':
      return { message: "AI management isn't configured on this server.", unavailable: true };
    case 'invalid_connection':
    case 'connection_inactive':
    case 'connection_not_llm':
      return {
        message: "That connection can't be used. Pick another one or re-add it.",
        unavailable: false,
      };
    case 'not_found':
      return { message: 'That AI no longer exists.', unavailable: false };
    case 'ai_provisioning_failed':
    case 'ai_update_failed':
    case 'ai_teardown_failed':
      return {
        message: "The server couldn't finish. Nothing was left half-created; try again.",
        unavailable: false,
      };
    case 'invalid_request':
      return { message: error.message, unavailable: false };
    default:
      // Any other server text may quote internals, so the user gets a fixed sentence; only a 503 still marks AI management off.
      return { message: 'Something went wrong. Try again.', unavailable: error.status === 503 };
  }
}

const FAILURE_REASONS: Record<string, string> = {
  key_rejected: 'Key rejected',
  model_not_found: 'Model not found',
  rate_limited: 'Rate limited',
  budget: 'Provider budget reached',
  context_too_long: 'Too much context',
  timeout: 'Timed out',
};

const UNKNOWN_REASON = 'Last reply failed';

// The health dot's state, first match wins: stopped, failing, paused, working.
export type AiHealthState = 'working' | 'failing' | 'paused' | 'stopped';

export type AiFix = 'replace_key' | 'change_model';

export interface AiHealth {
  state: AiHealthState;
  reason?: string;
  fix?: AiFix;
}

export interface AiHealthInput {
  status: string;
  limits: { perDayUsd: number | null };
  usage?: { todayUsd: number } | null;
  lastFailure?: { kind: string } | null;
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

// Today's spend as a fraction of the daily limit (0..1), or null when either is missing.
export function spendFraction(ai: AiHealthInput): number | null {
  const limit = ai.limits.perDayUsd;
  const usage = ai.usage ?? null;
  if (limit === null || usage === null) {
    return null;
  }
  return Math.min(1, usage.todayUsd / limit);
}

// First match wins: a status that is not `active` is stopped; a logged failure fails with its reason;
// today's spend at the daily limit is paused; otherwise it works.
export function aiHealth(ai: AiHealthInput): AiHealth {
  if (ai.status !== 'active') {
    return { state: 'stopped' };
  }
  const lastFailure = ai.lastFailure ?? null;
  if (lastFailure !== null) {
    const reason = FAILURE_REASONS[lastFailure.kind] ?? UNKNOWN_REASON;
    if (lastFailure.kind === 'key_rejected') {
      return { state: 'failing', reason, fix: 'replace_key' };
    }
    if (lastFailure.kind === 'model_not_found') {
      return { state: 'failing', reason, fix: 'change_model' };
    }
    return { state: 'failing', reason };
  }
  if (spendFraction(ai) === 1) {
    return { state: 'paused' };
  }
  return { state: 'working' };
}

export interface AuditEntryLike {
  action: string;
  detail: Readonly<Record<string, unknown>> | null;
}

export function describeAuditEntry(entry: AuditEntryLike): string {
  const decision = readDecision(entry.detail);
  switch (entry.action) {
    case 'approval.decided':
      if (decision === 'approve_once' || decision === 'approve_always') {
        return 'A request was approved';
      }
      if (decision === 'deny') {
        return 'A request was denied';
      }
      return 'A request was decided';
    case 'ai.stopped':
      return 'Stopped';
    case 'ai.resumed':
      return 'Resumed';
    default:
      return humaniseAction(entry.action);
  }
}

function readDecision(detail: AuditEntryLike['detail']): string | null {
  if (detail === null) {
    return null;
  }
  const value = detail['decision'];
  return typeof value === 'string' ? value : null;
}

function humaniseAction(action: string): string {
  if (action === '') {
    return 'Activity';
  }
  const parts = action.split('.');
  const head = parts[0] ?? '';
  const tail = parts.slice(1);
  const capitalised = head === '' ? '' : head.charAt(0).toUpperCase() + head.slice(1);
  return [capitalised, ...tail].join(' ');
}

export function formatRelativeAudit(at: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000));
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export type ComputerMode = 'off' | 'cloud' | 'runner' | 'auto';

export interface ComputerChoice {
  mode: ComputerMode;
  label: string;
  description: string;
  disabled: boolean;
}

// `Off` is always offered; `cloud` needs the cloud desk client; `machine` and `auto` need a home machine. A disabled choice shows why in place of its description.
export function computerChoices(cloud: boolean, hasMachine: boolean): ComputerChoice[] {
  return [
    {
      mode: 'off',
      label: 'Off',
      description: 'No computer',
      disabled: false,
    },
    {
      mode: 'cloud',
      label: 'Zilar',
      description: cloud ? 'Runs on a Zilar cloud computer' : 'Needs setup on your server',
      disabled: !cloud,
    },
    {
      mode: 'runner',
      label: 'Machine',
      description: hasMachine ? 'Runs on your home machine' : 'Pick a machine first',
      disabled: !hasMachine,
    },
    {
      mode: 'auto',
      label: 'Auto',
      description: hasMachine
        ? "My machine when it's online, otherwise Zilar cloud"
        : 'Pick a machine first',
      disabled: !hasMachine,
    },
  ];
}
