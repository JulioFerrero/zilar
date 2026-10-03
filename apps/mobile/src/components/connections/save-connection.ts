import type { ConnectionsApi, ProviderConnection } from '../../lib/connections-api';
import { describeConnectionsError } from './errors';

export interface ConnectionSaveOutcome {
  /** The created connection, or null when the save failed. */
  connection: ProviderConnection | null;
  /** A fixed user-facing sentence, or empty on success. Never raw server text. */
  error: string;
}

/**
 * The add-form save behind the connections screen. A pure async step so the
 * screen stays thin and the key handling is unit testable: the caller hands
 * over the key the user typed, and on success clears its own field state
 * (the key is write-only — it travels only in the POST body and never comes
 * back). On failure the caller keeps the typed key for retry and shows the
 * fixed sentence; the key never lands in error text.
 */
export async function saveConnection(
  api: ConnectionsApi,
  input: { provider: string; key: string; label: string },
): Promise<ConnectionSaveOutcome> {
  try {
    const connection = await api.createConnection({
      provider: input.provider,
      key: input.key,
      ...(input.label === '' ? {} : { label: input.label }),
    });
    return { connection, error: '' };
  } catch (cause: unknown) {
    return {
      connection: null,
      error: describeConnectionsError(cause, 'Could not save the connection.').message,
    };
  }
}

/**
 * The key field's next value after the save settles — the exact transition
 * the form's submit handler runs. Success empties the field (write-only);
 * failure keeps the typed key so the user can retry.
 */
export function keyAfterSave(outcome: ConnectionSaveOutcome, typedKey: string): string {
  return outcome.connection === null ? typedKey : '';
}
