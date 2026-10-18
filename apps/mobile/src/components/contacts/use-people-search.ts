import { usePeopleHandleSearch, type PeopleSearchView } from '@zilar/client-core';
import { useState } from 'react';

import { domainOfJid, type ContactsApi, type HandleProfile } from '../../lib/contacts-api';
import { resolveContactChat } from './add-contact';

/**
 * The `@handle` people search for the chat-list search bar (T-0193): the
 * debounced exact lookup, and opening a contact's DM without a refetch.
 * `submitRequest` is bumped by the search field's Enter key to look up at
 * once. The lookup itself is shared with the web (`@zilar/client-core`).
 */
export function usePeopleSearch(options: {
  api: ContactsApi;
  text: string;
  /** The loaded chats, to resolve a contact's DM without a refetch. */
  chats: { id: string; kind: string }[];
  /** The viewer's own bare JID, for the DM domain. */
  myJid: string | null | undefined;
  onMessage: (chatId: string) => void;
  submitRequest?: number | undefined;
}): {
  view: PeopleSearchView<HandleProfile>;
  actionError: string | null;
  openMessage: () => void;
} {
  const { api, text, chats, myJid, onMessage, submitRequest } = options;
  const { view, target } = usePeopleHandleSearch<HandleProfile>(
    (handle) => api.lookupByHandle(handle),
    text,
    submitRequest,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  return {
    view,
    actionError,
    openMessage: () => {
      if (target === null) {
        return;
      }
      const chatId = resolveContactChat(chats, target.userId, domainOfJid(myJid));
      if (chatId === undefined) {
        setActionError('No chat with them yet. Pull to refresh the chats list.');
        return;
      }
      onMessage(chatId);
    },
  };
}
