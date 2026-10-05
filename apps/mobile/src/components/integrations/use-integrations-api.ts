import { useMemo } from 'react';

import { createIntegrationsApi, type IntegrationsApi } from '@/lib/integrations-api';
import { getSessionToken } from '@/lib/session-token';

export interface IntegrationsApiHandle {
  api: IntegrationsApi;
}

/**
 * The integrations API handle. There is no mock scenario: owner settings
 * always talk to the real server, and a non-owner gets the same 404 as an
 * unknown route (the screen gates on it).
 */
export function useIntegrationsApi(): IntegrationsApiHandle {
  const api = useMemo(() => createIntegrationsApi(getSessionToken), []);
  return { api };
}
