import { Schema } from 'effect';
import { isUrl } from '@zilar/protocol';

// Bring-your-own-key: a user's provider key is registered as its own model
// group, one per AI, so it never shares a group with the platform's models.
// This is the exact entry that goes into LiteLLM's `model_list`:
//
//   model_list:
//     - model_name: ai-<ai-id>
//       litellm_params:
//         model: anthropic/claude-sonnet-4-5
//         api_key: os.environ/USER_KEY_<ai-id>
//
// The platform's keys live in the gateway's environment (`os.environ/...`); a
// user's key is the only credential in this entry, and the two never mix.
// With `general_settings.store_model_in_db: true` the same object is POSTed to
// LiteLLM's `/model/new`, so a key can be added without an edit and reload.

const ModelNameSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]{0,63}$/)),
);

const ProviderModelSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]*\/\S+$/i)),
);

const ApiKeySchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
);

const ApiBaseSchema = Schema.String.pipe(
  Schema.check(Schema.makeFilter((value) => (isUrl(value) ? undefined : 'must be a URL'))),
);

const decodeModelName = Schema.decodeUnknownSync(ModelNameSchema);
const decodeProviderModel = Schema.decodeUnknownSync(ProviderModelSchema);
const decodeApiKey = Schema.decodeUnknownSync(ApiKeySchema);
const decodeApiBase = Schema.decodeUnknownSync(ApiBaseSchema);

export interface UserProviderKeyInput {
  /** Model group the AI calls. Unique per AI so keys stay separate. */
  modelName: string;
  /** Provider-qualified model, e.g. "anthropic/claude-sonnet-4-5". */
  providerModel: string;
  /** The user's own provider key. Never logged or returned to a client. */
  apiKey: string;
  /** Optional custom endpoint, e.g. a self-hosted OpenAI-compatible server. */
  apiBase?: string;
}

export interface LiteLlmModelEntry {
  model_name: string;
  litellm_params: {
    model: string;
    api_key: string;
    api_base?: string;
  };
}

// Builds the model_list entry for one AI's own provider key. Inputs are
// validated before anything reaches the gateway; the key is carried only in
// the returned entry.
export function buildUserModelEntry(input: UserProviderKeyInput): LiteLlmModelEntry {
  const entry: LiteLlmModelEntry = {
    model_name: decodeModelName(input.modelName),
    litellm_params: {
      model: decodeProviderModel(input.providerModel),
      api_key: decodeApiKey(input.apiKey),
    },
  };
  if (input.apiBase !== undefined) {
    entry.litellm_params.api_base = decodeApiBase(input.apiBase);
  }
  return entry;
}

// The model group name for an AI. Keeps every AI's provider key in its own
// group, so revoking or rotating one key cannot touch another AI's traffic.
export function modelNameForAi(aiId: string): string {
  return decodeModelName(`ai-${aiId}`);
}
