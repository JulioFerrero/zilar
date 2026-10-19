import { useApi } from '@/lib/use-mockable-api';
import { makePhoneContactsApi, type ContactsApi } from '@/lib/contacts-api';

export interface ContactsApiHandle {
  api: ContactsApi;
  mock: boolean;
}

export function useContactsApi(): ContactsApiHandle {
  return useApi(makePhoneContactsApi);
}
