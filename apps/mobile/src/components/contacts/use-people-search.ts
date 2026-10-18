import { usePeopleHandleSearch, type PeopleSearchView } from '@zilar/client-core';
import { useState } from 'react';

import { domainOfJid, type ContactsApi, type HandleProfile } from '../../lib/contacts-api';
import { resolveContactChat } from './add-contact';

export function usePeopleSearch(options: {
  api: ContactsApi;
  text: string;
  chats: { id: string; kind: string }[];
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
