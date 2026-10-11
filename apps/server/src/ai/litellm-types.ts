// The address the dev stack publishes LiteLLM on. Kept here rather than in the
// env schema so an absent LITELLM_BASE_URL does not change the parsed config.
export const DEFAULT_LITELLM_BASE_URL = 'http://127.0.0.1:4000';

// Every failure coming from LiteLLM is wrapped in this type. The message is
// redacted before construction: it never carries the master key or a provider
// key, whatever the proxy echoed back.
export class LitellmApiError extends Error {
  readonly operation: string;
  readonly status: number;

  constructor(operation: string, status: number, detail: string) {
    super(
      status === 0
        ? `LiteLLM "${operation}" request failed: ${detail}`
        : `LiteLLM "${operation}" failed with HTTP ${status}: ${detail}`,
    );
    this.name = 'LitellmApiError';
    this.operation = operation;
    this.status = status;
  }
}

export interface LitellmClientConfig {
  baseUrl: string;
  masterKey: string;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface GenerateVirtualKeyInput {
  /** Model groups the key may call. At least one, and never empty. */
  models: string[];
  /** Hard spend cap in USD. Enforced by the proxy before every call. */
  maxBudget?: number;
  /** Reset window for the budget, e.g. "30d" or "1h". */
  budgetDuration?: string;
  tpmLimit?: number;
  rpmLimit?: number;
  keyAlias?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateVirtualKeyInput {
  key: string;
  /** Replaces the model allowlist. At least one model when present. */
  models?: string[];
  maxBudget?: number;
  tpmLimit?: number;
  rpmLimit?: number;
  blocked?: boolean;
  /**
   * Admin-only spend override. LiteLLM accepts it on /key/update; the spike's
   * integration script uses it to cross a cap without a real provider. Never
   * used by the app to *set* what a user spent.
   */
  spend?: number;
}

export interface AddModelInput {
  /** The model group our AIs call, e.g. "ai-<aiId>". Unique per AI. */
  modelName: string;
  /** The provider-qualified model, e.g. "openai/gpt-4o-mini". */
  litellmModel: string;
  /**
   * The owner's provider key. LiteLLM stores its own encrypted copy; the
   * plaintext never leaves this request and is redacted from every error.
   */
  apiKey: string;
  /** Extra metadata stored as LiteLLM's `model_info`, e.g. `{ ai_id }`. */
  metadata?: Record<string, unknown>;
}

export interface VirtualKey {
  /** LiteLLM's token id, the stable handle we store for a key. */
  id: string;
  /** The placeholder key handed to the client. */
  key: string;
  keyAlias: string | null;
  maxBudget: number | null;
  spend: number;
  models: string[];
}

export interface VirtualKeyInfo {
  keyAlias: string | null;
  maxBudget: number | null;
  spend: number;
  tpmLimit: number | null;
  rpmLimit: number | null;
  blocked: boolean | null;
  models: string[];
}

export interface ModelListing {
  /** LiteLLM's model id, the handle `/model/delete` needs. */
  id: string;
  /** The public group name, e.g. `ai-<aiId>`. */
  name: string;
}

export interface LitellmAdminClient {
  generateKey(input: GenerateVirtualKeyInput): Promise<VirtualKey>;
  getKeyInfo(key: string): Promise<VirtualKeyInfo>;
  updateKey(input: UpdateVirtualKeyInput): Promise<VirtualKeyInfo>;
  revokeKey(key: string): Promise<void>;
  /** Registers a private model group and returns LiteLLM's model id. */
  addModel(input: AddModelInput): Promise<string>;
  /** Deletes a registered model. A model that is already gone is not an error. */
  deleteModel(modelId: string): Promise<void>;
  /** Lists the registered models. Entries without an id or a name are skipped. */
  listModels(): Promise<ModelListing[]>;
}
