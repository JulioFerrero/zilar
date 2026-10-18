// effect-plain: the key-check flow is plain React state over the shared promise port.
import { useMemo } from 'react';
import {
  providerSelection,
  useKeyCheck as useSharedKeyCheck,
  type KeyCheckPort,
  type UseKeyCheckOptions,
} from '@zilar/client-core';

import { useAisApi } from '@/components/ais/use-ais-api';
import { useConnectionsApi } from '@/components/connections/use-connections-api';

export { providerSelection };

export function useKeyCheck(options: UseKeyCheckOptions = {}) {
  const { api } = useAisApi();
  const { api: connectionsApi } = useConnectionsApi();
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
