// Key-derivation labels, mixed into keys that encrypt stored data (provider API keys,
// push subscriptions). Renaming one makes that data undecryptable, so it needs every
// stored row re-encrypted first; the project's former name is intentional.
export const PROVIDER_KEY_KDF_LABEL = 'galena/provider-key/v1';
export const PUSH_STORAGE_KDF_LABEL = 'galena/push-storage/v1';
