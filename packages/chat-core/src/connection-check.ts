// effect-plain: the key-check flow is plain async over an injected connections
// API (each app passes its own client); a failure is a value, not a thrown Effect.
//
// The key-check flow of the New AI wizard (T-1442): the one place where web and
// mobile create, test, replace and abandon a connection, so both flows behave
// the same. The API is injected, so an app passes its own client and tests pass
// a fake.
//
// A key is write-only: it travels in the create/replace call and is never
// stored, returned or logged here. `testConnection` only ever receives the id.

import { providerLabel } from './ai-providers';
import { keyCheckMessage } from './new-ai';

export interface KeyCheckInput {
  readonly provider: string;
  readonly key: string;
  readonly label?: string;
  /** Required for `openai-compatible`, refused for every other provider. */
  readonly baseUrl?: string;
}

/** The slice of a connections client this flow uses. */
export interface KeyCheckApi {
  createConnection(input: KeyCheckInput): Promise<{ readonly id: string }>;
  testConnection(id: string): Promise<{ readonly ok: boolean; readonly message?: string }>;
  replaceConnectionKey(id: string, key: string): Promise<{ readonly id: string }>;
  deleteConnection(id: string): Promise<void>;
}

export interface KeyCheckState {
  /** The connection this flow works on; null before the first check. */
  readonly connectionId: string | null;
  /** True when this flow created the connection, so abandoning may delete it. */
  readonly created: boolean;
  /** True once a check passed. */
  readonly verified: boolean;
}

export interface KeyCheckResult extends KeyCheckState {
  /** The plain sentence when the check failed; absent on success. */
  readonly message?: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

/**
 * Creates the connection on the first check and replaces the key on every later
 * one (the provider and base URL never change here), then tests it. The result
 * is the next state, so the caller keeps passing it back in. A failed check
 * carries a plain sentence from `keyCheckMessage`.
 */
export async function checkKey(
  api: KeyCheckApi,
  state: KeyCheckState,
  input: KeyCheckInput,
): Promise<KeyCheckResult> {
  const label = providerLabel(input.provider);
  let { connectionId } = state;
  let { created } = state;

  try {
    if (connectionId === null) {
      const connection = await api.createConnection(input);
      connectionId = connection.id;
      created = true;
    } else {
      await api.replaceConnectionKey(connectionId, input.key);
    }

    const result = await api.testConnection(connectionId);
    if (result.ok) {
      return { connectionId, created, verified: true };
    }
    return {
      connectionId,
      created,
      verified: false,
      message: keyCheckMessage(label, result.message ?? ''),
    };
  } catch (error) {
    // A thrown create/replace/test still hands the id back, so the caller can
    // abandon the half-made connection instead of leaving it behind.
    return {
      connectionId,
      created,
      verified: false,
      message: keyCheckMessage(label, messageOf(error)),
    };
  }
}

/**
 * Cleans up after a key check that was given up: deletes the connection only
 * when this flow created it and it was never verified. A pre-existing
 * connection, or one that works, is left alone. A failed delete is ignored:
 * there is nothing useful to tell the user at that point.
 */
export async function abandonKeyCheck(api: KeyCheckApi, state: KeyCheckState): Promise<void> {
  if (!state.created || state.verified || state.connectionId === null) {
    return;
  }
  try {
    await api.deleteConnection(state.connectionId);
  } catch {
    // Ignored on purpose; the connection stays and a later run can reuse it.
  }
}
