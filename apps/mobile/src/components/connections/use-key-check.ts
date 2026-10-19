// effect-plain: the key-check flow is plain React state over the shared promise port.
import { useMemo } from 'react';
import {
  makeAisApi,
  providerSelection,
  useKeyCheck as useSharedKeyCheck,
  type KeyCheckPort,
  type UseKeyCheckOptions,
} from '@zilar/client-core';
import { useApi } from '@/lib/use-mockable-api';

export { providerSelection };

export function useKeyCheck(options: UseKeyCheckOptions = {}) {
  const { api } = useApi(makeAisApi);
  const { api: connectionsApi } = useApi(makeAisApi);
  const port = useMemo<KeyCheckPort>(
    () => ({
      ...connectionsApi,
      listConnections: () => api.listConnections(),
      getAiCatalog: () => api.getAiCatalog(),
    }),
    [api, connectionsApi],
  );
  const keys = useSharedKeyCheck(port, options);
  return { ...keys, providerChoices: keys.choices };
}

export type KeyCheck = ReturnType<typeof useKeyCheck>;
