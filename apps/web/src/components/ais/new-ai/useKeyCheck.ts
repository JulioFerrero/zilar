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
  onProviderChange?: () => void;
  onVerified?: () => void;
}

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
    setBaseUrl('');
    setCompatibleName('');
    // OpenAI-compatible never reuses a saved connection: its endpoint may differ
    // from the one being entered, so the key starts empty and unverified.
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
    void abandonKeyCheck(KEY_CHECK_API, keyState);
    onProviderChange?.();
  };

  const setKey = (value: string): void => {
    pendingCheck.current = null;
    setKeyState((current) =>
      usingSavedKey
        ? { connectionId: null, created: false, verified: false }
        : { ...current, verified: false },
    );
    setUsingSavedKey(false);
    setKeyValue(value);
    setKeyError('');
  };

  // The base URL and name are fixed when the connection is created, so an
  // endpoint edit needs a fresh connection (a replace would keep the old one).
  const editCompatible = (apply: () => void): void => {
    apply();
    pendingCheck.current = null;
    // A verified connection was created with the old endpoint, so it is deleted
    // here; a saved key (`created: false`) belongs to the user and is never deleted.
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

  // Closing before Create or Save drops what this dialog created, verified or
  // not; a saved key (`created: false`) belongs to the user and is never deleted.
  const dropCreatedConnection = (state: KeyCheckState): void => {
    if (!state.created || state.connectionId === null) return;
    void deleteConnection(state.connectionId).catch(() => {});
  };

  const abandon = (): void => {
    const pending = pendingCheck.current;
    pendingCheck.current = null;
    dropCreatedConnection(keyState);
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

export type KeyCheck = ReturnType<typeof useKeyCheck>;
