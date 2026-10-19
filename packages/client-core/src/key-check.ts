// effect-plain: the key-check flow is plain React state over an injected promise API; there is no product flow to model as an Effect.
import { useEffect, useRef, useState } from 'react';
import {
  WEB_CAPABILITIES,
  WEB_SEARCH_PROVIDER_IDS,
  type AiCatalog,
  type ConnectionView,
} from '@zilar/api-contract';
import {
  abandonKeyCheck,
  checkKey,
  isLlmProvider,
  keyPageFor,
  keyPlaceholderFor,
  providerChoices,
  providerLabel,
  type CatalogView,
  type KeyCheckApi,
  type KeyCheckResult,
  type KeyCheckState,
} from '@zilar/chat-core';
export const EMPTY_KEY_STATE = { connectionId: null, created: false, verified: false };

/** A typed key starts a fresh connection (never a saved one); ours is reused on a retry. */
export function keyCheckBaseState(keyValue: string, state: KeyCheckState): KeyCheckState {
  return keyValue.trim() !== '' && !state.created ? EMPTY_KEY_STATE : state;
}

export function keyStateAfterBaseUrlEdit(state: KeyCheckState): KeyCheckState {
  return state.created || state.verified ? EMPTY_KEY_STATE : state;
}

/** A Base URL edit deletes the connection this flow made for the old URL. */
export async function dropCreatedKey(api: KeyCheckApi, state: KeyCheckState): Promise<void> {
  if (!state.created || !state.verified || state.connectionId === null) return;
  await api.deleteConnection(state.connectionId).catch(() => undefined);
}

/** A verified connection is deleted, an unverified one abandoned; a saved key (`created: false`) is never deleted. */
export async function discardCreatedKey(api: KeyCheckApi, state: KeyCheckState): Promise<void> {
  await dropCreatedKey(api, state);
  await abandonKeyCheck(api, state);
}

/** A settled check counts only while latest; else its connection is abandoned. */
export async function settleNewAiKeyCheck(
  api: KeyCheckApi,
  token: number,
  current: number,
  result: KeyCheckResult,
): Promise<boolean> {
  if (token === current) return true;
  await discardCreatedKey(api, result);
  return false;
}

/** A pick clears Base URL/Name; OpenAI-compatible never reuses a saved key. */
export function providerSelection(connections: readonly ConnectionView[], provider: string) {
  const saved =
    provider === 'openai-compatible'
      ? null
      : (connections
          .filter(
            (connection) => connection.provider === provider && connection.status === 'active',
          )
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null);
  return {
    keyState:
      saved === null ? EMPTY_KEY_STATE : { connectionId: saved.id, created: false, verified: true },
    baseUrl: '',
    connectionName: '',
  };
}

export interface WebChoice {
  readonly id: string;
  readonly label: string;
  readonly hasKey: boolean;
  readonly tag: string;
}

const WEB_SEARCH_IDS: readonly string[] = WEB_SEARCH_PROVIDER_IDS;

function capabilityText(
  capabilities: { readonly search: boolean; readonly read: boolean } | undefined,
): string | undefined {
  if (capabilities === undefined) return undefined;
  if (capabilities.search && capabilities.read) return 'Search · Read';
  if (capabilities.search) return 'Search';
  return capabilities.read ? 'Read' : undefined;
}

/** The capabilities this key actually supplies to AIs: the oldest active key per capability wins, as on the server. */
export function webUseText(
  connection: ConnectionView,
  all: readonly ConnectionView[],
): string | undefined {
  if (connection.provider === 'deepseek') return 'Model, search, read';
  if (!WEB_SEARCH_IDS.includes(connection.provider)) return undefined;
  const active = all
    .filter((row) => row.status === 'active' && WEB_SEARCH_IDS.includes(row.provider))
    .slice()
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const serves = (need: 'search' | 'read'): boolean =>
    active.find((row) => WEB_CAPABILITIES[row.provider]?.[need] === true)?.id === connection.id;
  const search = serves('search');
  const read = serves('read');
  if (search && read) return 'Search · Read';
  if (search) return 'Search';
  return read ? 'Read' : 'Backup';
}

export interface KeyCheckPort extends KeyCheckApi {
  listConnections(): Promise<readonly ConnectionView[]>;
  getAiCatalog(): Promise<AiCatalog>;
}
export interface UseKeyCheckOptions {
  onProviderChange?: () => void;
  onVerified?: () => void;
}
// `AiCatalog.docUrl` is `string | undefined`, which does not fit `CatalogView`'s
// `docUrl?: string` under exactOptionalPropertyTypes.
function catalogViewOf(catalog: AiCatalog | null): CatalogView | null {
  if (catalog === null) return null;
  return {
    providers: catalog.providers.map((p) => ({ id: p.id, name: p.name, docUrl: p.docUrl ?? '' })),
  };
}
/**
 * The provider choice, the OpenAI-compatible fields and the key field shared by
 * the New AI flow and the Add key dialog. The key travels to the server only
 * inside `checkKey`, which creates the connection and keeps its id; `abandon`
 * drops an unverified created connection.
 */
export function useKeyCheck(
  port: KeyCheckPort,
  { onProviderChange, onVerified }: UseKeyCheckOptions = {},
) {
  const [connections, setConnections] = useState<readonly ConnectionView[]>([]);
  const [activeProviders, setActiveProviders] = useState<ReadonlySet<string>>(() => new Set());
  const [catalog, setCatalog] = useState<AiCatalog | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [baseUrl, setBaseUrlValue] = useState('');
  const [compatibleName, setCompatibleNameValue] = useState('');
  const [providerError, setProviderError] = useState('');
  const [keyValue, setKeyValue] = useState('');
  const [keyState, setKeyStateState] = useState<KeyCheckState>(EMPTY_KEY_STATE);
  const [keyError, setKeyError] = useState('');
  const [checking, setChecking] = useState(false);
  const keyStateRef = useRef(keyState);
  const checkToken = useRef(0);
  const keyCheckRef = useRef(false);
  const creatingRef = useRef(false);
  const closedRef = useRef(false);
  function setKeyState(next: KeyCheckState): void {
    keyStateRef.current = next;
    setKeyStateState(next);
  }
  function staleCheck(): void {
    checkToken.current += 1;
    keyCheckRef.current = false;
    setChecking(false);
  }
  useEffect(() => {
    let active = true;
    void (async () => {
      const [listed, catalogResult] = await Promise.allSettled([
        port.listConnections(),
        port.getAiCatalog(),
      ]);
      if (!active) return;
      if (listed.status === 'fulfilled') {
        const activeRows = listed.value.filter((c) => c.status === 'active');
        setActiveProviders(new Set(activeRows.map((c) => c.provider)));
        setConnections(activeRows.filter((c) => isLlmProvider(c.provider)));
      }
      if (catalogResult.status === 'fulfilled') setCatalog(catalogResult.value);
    })();
    return () => {
      active = false;
      checkToken.current += 1;
      closedRef.current = true;
      if (!creatingRef.current) void discardCreatedKey(port, keyStateRef.current);
    };
  }, [port]);

  const catalogView = catalogViewOf(catalog);
  const choices = providerChoices(catalogView, connections).map((choice) => {
    const tag = capabilityText(WEB_CAPABILITIES[choice.id]);
    return tag === undefined ? choice : { ...choice, tag };
  });
  const webChoices: readonly WebChoice[] = WEB_SEARCH_PROVIDER_IDS.map((id) => ({
    id,
    label: providerLabel(id),
    hasKey: activeProviders.has(id),
    tag: capabilityText(WEB_CAPABILITIES[id]) ?? 'Search',
  }));
  const isCompatible = providerId === 'openai-compatible';
  const providerReady =
    providerId !== null &&
    (!isCompatible || (baseUrl.trim() !== '' && compatibleName.trim() !== ''));
  function chooseProvider(id: string): void {
    staleCheck();
    void discardCreatedKey(port, keyStateRef.current);
    setProviderId(id);
    setProviderError('');
    setKeyValue('');
    setBaseUrlValue('');
    setCompatibleNameValue('');
    setKeyError('');
    setKeyState(providerSelection(connections, id).keyState);
    onProviderChange?.();
  }
  function setKey(value: string): void {
    staleCheck();
    setKeyValue(value);
    if (keyState.verified) setKeyState({ ...keyState, verified: false });
    setKeyError('');
  }
  // A Base URL or Name edit drops our connection for the old endpoint and
  // starts the key over empty; a saved key (`created: false`) is left alone.
  function editEndpoint(set: (value: string) => void, value: string): void {
    staleCheck();
    set(value);
    void discardCreatedKey(port, keyStateRef.current);
    setKeyState(keyStateAfterBaseUrlEdit(keyState));
    setKeyError('');
  }
  function continueProvider(): boolean {
    if (providerReady) {
      setProviderError('');
      return true;
    }
    if (providerId === null) return false;
    setProviderError(baseUrl.trim() === '' ? 'Enter a base URL.' : 'Enter a name.');
    return false;
  }
  function continueKey(): void {
    if (keyState.verified && keyValue.trim() === '') {
      onVerified?.();
      return;
    }
    if (keyValue.trim() === '') {
      setKeyError('Paste your key.');
      return;
    }
    if (checking || keyCheckRef.current) return;
    keyCheckRef.current = true;
    setChecking(true);
    setKeyError('');
    const token = checkToken.current + 1;
    checkToken.current = token;
    void (async () => {
      const result = await checkKey(port, keyCheckBaseState(keyValue, keyState), {
        provider: providerId ?? '',
        key: keyValue.trim(),
        ...(compatibleName.trim() === '' ? {} : { label: compatibleName.trim() }),
        ...(isCompatible ? { baseUrl: baseUrl.trim() } : {}),
      });
      if (!(await settleNewAiKeyCheck(port, token, checkToken.current, result))) return;
      setChecking(false);
      setKeyState(result);
      if (result.verified) {
        setKeyValue('');
        onVerified?.();
      } else {
        setKeyError(result.message ?? 'Could not check the key. Try again.');
      }
    })().finally(() => {
      keyCheckRef.current = false;
    });
  }
  /** The connection is now the AI's (or the user's saved key): it must not be deleted. */
  const claim = (): void => setKeyState(EMPTY_KEY_STATE);
  /** A close during Create must not discard, so a successful create can adopt the key. */
  function beginCreate(): void {
    creatingRef.current = true;
  }
  function finishCreate(succeeded: boolean): void {
    creatingRef.current = false;
    if (succeeded) claim();
    else if (closedRef.current) void discardCreatedKey(port, keyStateRef.current);
  }
  function abandon(): void {
    closedRef.current = true;
    staleCheck();
    if (!creatingRef.current) void discardCreatedKey(port, keyStateRef.current);
  }
  return {
    catalog,
    choices,
    webChoices,
    providerId,
    providerText:
      [...choices, ...webChoices].find((choice) => choice.id === providerId)?.label ?? '',
    providerReady,
    providerError,
    chooseProvider,
    isCompatible,
    baseUrl,
    setBaseUrl: (value: string) => editEndpoint(setBaseUrlValue, value),
    compatibleName,
    setCompatibleName: (value: string) => editEndpoint(setCompatibleNameValue, value),
    baseUrlReachable: isCompatible && keyState.verified,
    key: keyValue,
    setKey,
    keyVerified: keyState.verified,
    connectionId: keyState.verified ? keyState.connectionId : null,
    keyError,
    keyPlaceholder: keyState.verified ? 'Saved key' : keyPlaceholderFor(providerId ?? ''),
    keyPage: providerId === null ? null : keyPageFor(providerId, catalogView),
    checkingKey: checking,
    continueProvider,
    continueKey,
    claim,
    beginCreate,
    finishCreate,
    abandon,
  };
}
export type KeyCheck = ReturnType<typeof useKeyCheck>;
