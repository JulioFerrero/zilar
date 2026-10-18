import {
  useKeyCheck as useSharedKeyCheck,
  type KeyCheckPort,
  type UseKeyCheckOptions,
} from '@zilar/client-core';

import {
  createConnection,
  deleteConnection,
  getAiCatalog,
  listConnections,
  replaceConnectionKey,
  testConnection,
} from '@/lib/api';

const PORT: KeyCheckPort = {
  listConnections,
  getAiCatalog,
  createConnection,
  testConnection,
  replaceConnectionKey,
  deleteConnection,
};

export function useKeyCheck(options: UseKeyCheckOptions = {}) {
  return useSharedKeyCheck(PORT, options);
}

export type KeyCheck = ReturnType<typeof useKeyCheck>;
