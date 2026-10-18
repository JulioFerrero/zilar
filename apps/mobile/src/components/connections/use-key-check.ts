// effect-plain: the key-check flow is plain React state; its async work uses the
// shared checkKey/abandon helpers over the injected connections promise API.
import type { AiCatalog } from '@zilar/api-contract';
import {
  checkKey,
  isLlmProvider,
  keyPageFor,
  keyPlaceholderFor,
  providerChoices,
  type KeyCheckState,
} from '@zilar/chat-core';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  EMPTY_KEY_STATE,
  discardCreatedKey,
  keyCheckBaseState,
  keyStateAfterBaseUrlEdit,
  settleNewAiKeyCheck,
} from '@/components/ais/form';
import { useAisApi } from '@/components/ais/use-ais-api';
import { useConnectionsApi } from '@/components/connections/use-connections-api';
import type { Connection } from '@/lib/ais-api';

function newestConnection(connections: readonly Connection[], provider: string): Connection | null {
  const mine = connections.filter((connection) => connection.provider === provider);
  return mine.reduce<Connection | null>(
    (best, next) => (best !== null && best.createdAt > next.createdAt ? best : next),
    null,
  );
}

/** A pick clears Base URL/Name; OpenAI-compatible never reuses a saved key. */
export function providerSelection(connections: readonly Connection[], provider: string) {
  const saved = provider === 'openai-compatible' ? null : newestConnection(connections, provider);
  const keyState =
    saved === null ? EMPTY_KEY_STATE : { connectionId: saved.id, created: false, verified: true };
  return { keyState, baseUrl: '', connectionName: '' };
}

export interface UseKeyCheckOptions {
  onProviderChange?: () => void;
  onVerified?: () => void;
}

/**
 * The provider choice, the OpenAI-compatible fields and the key field shared by
 * the New AI flow and the Add key sheet. The key travels to the server only
 * inside `checkKey`, which creates the connection and keeps its id; `abandon`
 * drops an unverified created connection.
 */
export function useKeyCheck({ onProviderChange, onVerified }: UseKeyCheckOptions = {}) {
  const { api } = useAisApi();
  const { api: connectionsApi } = useConnectionsApi();

  const [connections, setConnections] = useState<Connection[]>([]);
  const [catalog, setCatalog] = useState<AiCatalog | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [connectionName, setConnectionName] = useState('');
  const [providerError, setProviderError] = useState('');
  const [keyValue, setKeyValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyState, setKeyStateState] = useState<KeyCheckState>(EMPTY_KEY_STATE);
  const keyStateRef = useRef(keyState);
  function setKeyState(next: KeyCheckState): void {
    keyStateRef.current = next;
    setKeyStateState(next);
  }
  const [keyMessage, setKeyMessage] = useState('');
  const [checking, setChecking] = useState(false);
  const checkToken = useRef(0);
  const keyCheckRef = useRef(false);
  const creatingRef = useRef(false);
  const closedRef = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [listed, catalogResult] = await Promise.allSettled([
        api.listConnections(),
        api.getAiCatalog(),
      ]);
      if (!active) return;
      if (listed.status === 'fulfilled') {
        const rows = listed.value.filter((c) => c.status === 'active' && isLlmProvider(c.provider));
        setConnections(rows);
      }
      if (catalogResult.status === 'fulfilled') setCatalog(catalogResult.value);
    })();
    return () => {
      active = false;
      checkToken.current += 1;
      closedRef.current = true;
      if (!creatingRef.current) void discardCreatedKey(connectionsApi, keyStateRef.current);
    };
  }, [api, connectionsApi]);

  const choices = useMemo(() => providerChoices(catalog, connections), [catalog, connections]);
  const isCompatible = providerId === 'openai-compatible';
  const providerReady =
    providerId !== null &&
    (!isCompatible || (baseUrl.trim() !== '' && connectionName.trim() !== ''));

  function selectProvider(id: string): void {
    // A switch drops our old connection (verified deleted, unverified
    // abandoned) and stales an in-flight check.
    checkToken.current += 1;
    setChecking(false);
    void discardCreatedKey(connectionsApi, keyState);
    const picked = providerSelection(connections, id);
    setProviderId(id);
    setProviderError('');
    setKeyValue('');
    setShowKey(false);
    setKeyMessage('');
    setBaseUrl(picked.baseUrl);
    setConnectionName(picked.connectionName);
    setKeyState(picked.keyState);
    onProviderChange?.();
  }

  // A Base URL or Name edit drops our connection for the old endpoint and
  // starts the key over empty; a saved key (`created: false`) is left alone.
  function editEndpoint(set: (value: string) => void, value: string): void {
    set(value);
    void discardCreatedKey(connectionsApi, keyState);
    setKeyState(keyStateAfterBaseUrlEdit(keyState));
  }

  function continueProvider(): boolean {
    if (providerId === null) return false;
    if (isCompatible && (baseUrl.trim() === '' || connectionName.trim() === '')) {
      setProviderError(baseUrl.trim() === '' ? 'Enter a base URL.' : 'Enter a name.');
      return false;
    }
    setProviderError('');
    return true;
  }

  function continueKey(): void {
    if (keyState.verified && keyValue.trim() === '') {
      onVerified?.();
      return;
    }
    if (keyValue.trim() === '' || checking) {
      setKeyMessage('Paste your key.');
      return;
    }
    if (keyCheckRef.current) return;
    keyCheckRef.current = true;
    setChecking(true);
    setKeyMessage('');
    const token = checkToken.current + 1;
    checkToken.current = token;
    void (async () => {
      const result = await checkKey(connectionsApi, keyCheckBaseState(keyValue, keyState), {
        provider: providerId ?? '',
        key: keyValue.trim(),
        ...(connectionName.trim() === '' ? {} : { label: connectionName.trim() }),
        ...(isCompatible ? { baseUrl: baseUrl.trim() } : {}),
      });
      if (!(await settleNewAiKeyCheck(connectionsApi, token, checkToken.current, result))) return;
      setChecking(false);
      setKeyState(result);
      if (result.verified) {
        setKeyValue('');
        setShowKey(false);
        onVerified?.();
      } else {
        setKeyMessage(result.message ?? 'Could not check the key. Try again.');
      }
    })().finally(() => {
      keyCheckRef.current = false;
    });
  }

  /** The connection is now the AI's (or the user's saved key): it must not be deleted. */
  function claim(): void {
    setKeyState(EMPTY_KEY_STATE);
  }

  /** A close during Create must not discard, so a successful create can adopt the key. */
  function beginCreate(): void {
    creatingRef.current = true;
  }

  function finishCreate(succeeded: boolean): void {
    creatingRef.current = false;
    if (succeeded) {
      claim();
      return;
    }
    if (closedRef.current) void discardCreatedKey(connectionsApi, keyStateRef.current);
  }

  function abandon(): void {
    closedRef.current = true;
    checkToken.current += 1;
    if (!creatingRef.current) void discardCreatedKey(connectionsApi, keyStateRef.current);
  }

  return {
    catalog,
    providerChoices: choices,
    providerId,
    selectProvider,
    providerReady,
    continueProvider,
    isCompatible,
    baseUrl,
    setBaseUrl: (value: string) => editEndpoint(setBaseUrl, value),
    connectionName,
    setConnectionName: (value: string) => editEndpoint(setConnectionName, value),
    providerError,
    keyValue,
    setKeyValue,
    showKey,
    toggleShowKey: () => setShowKey((previous) => !previous),
    keyMessage,
    keyPlaceholder: keyState.verified ? 'Saved key' : keyPlaceholderFor(providerId ?? ''),
    keyPageUrl: providerId === null ? null : keyPageFor(providerId, catalog),
    keyVerified: keyState.verified,
    checking,
    connectionId: keyState.connectionId,
    continueKey,
    claim,
    beginCreate,
    finishCreate,
    abandon,
  };
}

export type KeyCheck = ReturnType<typeof useKeyCheck>;
