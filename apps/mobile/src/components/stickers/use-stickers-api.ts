import { useGlobalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { createStickersApi, type StickersApi } from '@/lib/stickers-api';
import { getSessionToken } from '@/lib/session-token';
import { mockParamAllowed } from '@/mock/gate';

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
  // Referenced as static `process.env.EXPO_PUBLIC_*` expressions so
  // babel-preset-expo inlines them into the bundle at Metro time.
  const envMock = process.env.EXPO_PUBLIC_ZILAR_MOCK;
  const scenario = stickersMockScenario(
    {
      EXPO_PUBLIC_ZILAR_MOCK: envMock,
      EXPO_PUBLIC_ZILAR_MOCK_SCENARIO: process.env.EXPO_PUBLIC_ZILAR_MOCK_SCENARIO,
    },
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
