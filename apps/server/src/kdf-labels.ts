// Key-derivation labels. They are mixed into the keys that encrypt data
// already stored in the database (saved provider API keys, push
// subscriptions), so changing a single character makes that data
// undecryptable. They carry the project's former name on purpose and must
// never be renamed without re-encrypting every stored row first.
export const PROVIDER_KEY_KDF_LABEL = 'galena/provider-key/v1';
export const PUSH_STORAGE_KDF_LABEL = 'galena/push-storage/v1';
