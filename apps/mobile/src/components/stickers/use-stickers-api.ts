import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createStickersApi, type StickersApi } from '@/lib/stickers-api';
import { getSessionToken } from '@/lib/session-token';
import { ENV_MOCK, MOCK_ENV, mockParamAllowed } from '@/mock/gate';

import {
  createMockStickersApi,
  stickersMockScenario,
  type StickersMockScenario,
} from './stickers-mock';

export interface StickersApiHandle {
  api: StickersApi;
  /** The active mock scenario, or null when the real API is in use. */
  scenario: StickersMockScenario | null;
}

/** Picks the real API or the mock one from the route's `?mock=` param. */
export function useStickersApi(): StickersApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const scenario = stickersMockScenario(
    MOCK_ENV,
    params,
    mockParamAllowed({ dev: __DEV__, envMock }),
  );
  const api = useMemo(
    () =>
      scenario === null ? createStickersApi(getSessionToken) : createMockStickersApi(scenario),
    [scenario],
  );
  return { api, scenario };
}
