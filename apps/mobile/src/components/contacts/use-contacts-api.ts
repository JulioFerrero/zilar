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
  mock: boolean;
}

export function useContactsApi(): ContactsApiHandle {
  return useMockableApi(realContactsApi, mockContactsApi);
}
