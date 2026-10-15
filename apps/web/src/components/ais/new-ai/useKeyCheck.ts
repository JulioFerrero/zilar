import { useRef, useState } from 'react';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import type { AiCatalog } from '@zilar/api-contract';
import {
  abandonKeyCheck,
  checkKey,
  keyPageFor,
  keyPlaceholderFor,
  providerChoices,
  type CatalogView,
  type KeyCheckApi,
  type KeyCheckInput,
  type KeyCheckResult,
  type KeyCheckState,
} from '@zilar/chat-core';
import {
  createConnection,
  deleteConnection,
  getAiCatalog,
  listConnections,
  replaceConnectionKey,
  testConnection,
  type Connection,
} from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';

// The connections client `checkKey` drives.
const KEY_CHECK_API: KeyCheckApi = {
  createConnection,
  testConnection,
  replaceConnectionKey,
  deleteConnection,
};

// `AiCatalog.docUrl` is `string | undefined`, which does not fit `CatalogView`'s
// `docUrl?: string` under exactOptionalPropertyTypes.
function catalogViewOf(catalog: AiCatalog | null): CatalogView | null {
  if (catalog === null) return null;
  return {
    providers: catalog.providers.map((p) => ({ id: p.id, name: p.name, docUrl: p.docUrl ?? '' })),
  };
}

export interface UseKeyCheckOptions {
  /** Called after the provider changes; the New AI flow drops its model draft. */
  onProviderChange?: () => void;
  /** Called once a check verifies the key; the New AI flow moves to the model step. */
  onVerified?: () => void;
}

/**
 * The provider choice, the OpenAI-compatible fields and the key field shared by
 * the New AI flow and the Connections page's Add key dialog. The key travels to
 * the server only inside `checkKey`, which creates the connection on the first
 * check and keeps its id; `abandon` drops an unverified created connection.
 */
export function useKeyCheck({ onProviderChange, onVerified }: UseKeyCheckOptions = {}) {
  const [connectionsResult] = useQuery(() => fromApi(() => listConnections()), []);
  const [catalogResult] = useQuery(() => fromApi(() => getAiCatalog()), []);
  const connections: Connection[] = AsyncResult.isSuccess(connectionsResult)
    ? connectionsResult.value
    : [];
  const catalog = AsyncResult.isSuccess(catalogResult) ? catalogResult.value : null;
  const catalogView = catalogViewOf(catalog);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [compatibleName, setCompatibleName] = useState('');
  const [key, setKeyValue] = useState('');
  const [keyState, setKeyState] = useState<KeyCheckState>({
    connectionId: null,
    created: false,
    verified: false,
  });
  const [keyError, setKeyError] = useState('');
  const [usingSavedKey, setUsingSavedKey] = useState(false);
  // The in-flight key check's promise: `abandon` gives it up; an edit drops it.
  const pendingCheck = useRef<Promise<KeyCheckResult> | null>(null);
  const choices = providerChoices(catalogView, connections);
  const isCompatible = providerId === 'openai-compatible';
  const providerReady =
    providerId !== null &&
    (!isCompatible || (baseUrl.trim() !== '' && compatibleName.trim() !== ''));

  const [checkState, runCheck] = useAction<KeyCheckInput, KeyCheckResult, never>((input) => {
    const pending = (pendingCheck.current = checkKey(KEY_CHECK_API, keyState, input));
    return Effect.promise(() => pending).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          // A newer check, provider switch or abandon cleared the ref: drop it.
          if (pendingCheck.current !== pending) {
            void abandonKeyCheck(KEY_CHECK_API, result);
            return;
          }
          pendingCheck.current = null;
          setKeyState(result);
          if (result.verified) {
            setKeyError('');
            onVerified?.();
          } else {
            setKeyError(result.message ?? 'Could not check the key. Try again.');
          }
        }),
      ),
    );
  });

  const chooseProvider = (id: string): void => {
    setProviderId(id);
    // A provider switch starts the compatible fields empty, so an endpoint typed
    // for the previous choice never carries over to the next one.
    setBaseUrl('');
    setCompatibleName('');
    // OpenAI-compatible never reuses a saved connection: its saved endpoint may
    // differ from the one the user is about to enter, so the key starts empty
    // and unverified. Every other provider keeps its newest active connection.
    let saved: Connection | null = null;
    if (id !== 'openai-compatible') {
      saved =
        connections
          .filter((connection) => connection.provider === id && connection.status === 'active')
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
    }
    setUsingSavedKey(saved !== null);
    setKeyValue('');
    setKeyError('');
    setKeyState({ connectionId: saved?.id ?? null, created: false, verified: saved !== null });
    pendingCheck.current = null;
    // Leaving the provider abandons an unverified connection its check created.
    void abandonKeyCheck(KEY_CHECK_API, keyState);
    onProviderChange?.();
  };

  const setKey = (value: string): void => {
    pendingCheck.current = null;
    // Editing the key drops any verified connection; the next check re-runs.
    setKeyState((current) =>
      usingSavedKey
        ? { connectionId: null, created: false, verified: false }
        : { ...current, verified: false },
    );
    setUsingSavedKey(false);
    setKeyValue(value);
    setKeyError('');
  };

  // The base URL and the name are fixed when the connection is created, so an
  // edit needs a fresh connection (a replace would keep the old endpoint).
  const editCompatible = (apply: () => void): void => {
    apply();
    pendingCheck.current = null;
    // A verified connection was created with the old endpoint, so
    // `abandonKeyCheck` leaves it alone: delete it here instead. A saved key
    // (`created: false`) belongs to the user and is never deleted.
    if (keyState.verified && keyState.created && keyState.connectionId !== null) {
      void deleteConnection(keyState.connectionId).catch(() => {});
    } else {
      void abandonKeyCheck(KEY_CHECK_API, keyState);
    }
    setKeyState({ connectionId: null, created: false, verified: false });
    setKeyError('');
  };

  const continueKey = (): void => {
    if (keyState.verified) {
      onVerified?.();
      return;
    }
    if (key.trim() === '') {
      return;
    }
    setKeyError('');
    runCheck({
      provider: providerId ?? '',
      key: key.trim(),
      ...(isCompatible ? { baseUrl: baseUrl.trim(), label: compatibleName.trim() } : {}),
    });
  };

  // Closing before Create or Save drops what the dialog created, verified or
  // not: `abandonKeyCheck` leaves a verified connection alone. A saved key
  // (`created: false`) belongs to the user and is never deleted.
  const dropCreatedConnection = (state: KeyCheckState): void => {
    if (!state.created || state.connectionId === null) return;
    void deleteConnection(state.connectionId).catch(() => {});
  };

  const abandon = (): void => {
    const pending = pendingCheck.current;
    pendingCheck.current = null;
    dropCreatedConnection(keyState);
    // The check may still create (or already created) a connection; drop its
    // resolved state too, so nothing is left behind with a live key.
    if (pending !== null) void pending.then((result) => dropCreatedConnection(result));
  };

  const providerText = choices.find((choice) => choice.id === providerId)?.label ?? '';

  return {
    catalog,
    choices,
    providerId,
    providerText,
    providerReady,
    chooseProvider,
    isCompatible,
    baseUrl,
    setBaseUrl: (value: string) => editCompatible(() => setBaseUrl(value)),
    compatibleName,
    setCompatibleName: (value: string) => editCompatible(() => setCompatibleName(value)),
    baseUrlReachable: isCompatible && keyState.verified,
    key,
    setKey,
    keyVerified: keyState.verified,
    connectionId: keyState.verified ? keyState.connectionId : null,
    keyError,
    keyPlaceholder:
      keyState.verified && key === '' ? 'Saved key' : keyPlaceholderFor(providerId ?? ''),
    keyPage: providerId === null ? null : keyPageFor(providerId, catalogView),
    checkingKey: isWaiting(checkState),
    continueKey,
    abandon,
  };
}

/** The key-check state and actions, shared by both add-key flows. */
export type KeyCheck = ReturnType<typeof useKeyCheck>;
