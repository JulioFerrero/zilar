// effect-plain: the key-check flow is plain async over an injected connections API; a failure is a value, not a thrown Effect.
// A key is write-only: it travels in the create/replace call and is never stored, returned or logged here.

import { providerLabel } from './ai';
import { keyCheckMessage } from './new-ai';

export interface KeyCheckInput {
  readonly provider: string;
  readonly key: string;
  readonly label?: string;
  // Required for `openai-compatible`, refused for every other provider.
  readonly baseUrl?: string;
}

export interface KeyCheckApi {
  createConnection(input: KeyCheckInput): Promise<{ readonly id: string }>;
  testConnection(id: string): Promise<{ readonly ok: boolean; readonly message?: string }>;
  replaceConnectionKey(id: string, key: string): Promise<{ readonly id: string }>;
  deleteConnection(id: string): Promise<void>;
}

export interface KeyCheckState {
  readonly connectionId: string | null;
  readonly created: boolean;
  readonly verified: boolean;
}

export interface KeyCheckResult extends KeyCheckState {
  readonly message?: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

// Creates the connection on the first check and replaces the key on every later one, then tests it; a failed check carries a plain sentence.
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
    // A thrown create/replace/test still hands the id back, so the caller can abandon the half-made connection.
    return {
      connectionId,
      created,
      verified: false,
      message: keyCheckMessage(label, messageOf(error)),
    };
  }
}

// Deletes the connection only when this flow created it and it was never verified; a pre-existing or working connection is left alone.
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
