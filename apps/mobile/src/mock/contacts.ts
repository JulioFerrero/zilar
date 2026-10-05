import type { Contact } from '../lib/chat-api';

/** Three mock contacts, so the mock new-group flow has people to pick. */
export const mockContacts: Contact[] = [
  { userId: 'u-ana', name: 'Ana', jid: 'ana@zilar.test' },
  { userId: 'u-marco', name: 'Marco', jid: 'marco@zilar.test' },
  { userId: 'u-lena', name: 'Lena', jid: 'lena@zilar.test' },
];
