import { API_URL } from '@/lib/auth';
import { createContactsApi, type ContactsApi } from '@/lib/contacts-api';
import { getSessionToken } from '@/lib/session-token';
import { useMockableApi } from '@/lib/use-mockable-api';
import { mockToken } from '@/mock/gate';

const realContactsApi = () => createContactsApi(getSessionToken);

const mockContactsApi = (mockFetch: typeof fetch) =>
  createContactsApi(mockToken, mockFetch, API_URL);

export interface ContactsApiHandle {
  api: ContactsApi;
  /** True when the mock is active (used by tests/UI to skip the network). */
  mock: boolean;
}

/**
 * Picks the real API or the mock one from the route's `?mock=` param or the
 * bundle-time `EXPO_PUBLIC_ZILAR_MOCK` env. The mock runs on the shared backend
 * through `mockFetch`.
 */
export function useContactsApi(): ContactsApiHandle {
  return useMockableApi(realContactsApi, mockContactsApi);
}
