import { useEffect, useReducer, useRef, useState } from 'react';

import { domainOfJid, type ContactsApi } from '../../lib/contacts-api';
import { resolveContactChat } from './add-contact';
import { PeopleSearchController, type PeopleSearchView } from './people-search';

/**
 * The `@handle` people search for the chat-list search bar (T-0193): the
 * debounced exact lookup, and opening a contact's DM without a refetch.
 * `submitRequest` is bumped by the search field's Enter key to look up at
 * once.
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
  view: PeopleSearchView;
  actionError: string | null;
  openMessage: () => void;
} {
  const { api, text, chats, myJid, onMessage, submitRequest } = options;
  const [, force] = useReducer((count: number) => count + 1, 0);
  const [controller] = useState(() => new PeopleSearchController({ api, onChange: force }));
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    controller.setApi(api);
  }, [controller, api]);

  useEffect(() => {
    controller.setText(text);
  }, [controller, text]);

  useEffect(() => () => controller.dispose(), [controller]);

  // The search field's Enter key: look up at once instead of waiting out the
  // debounce. The initial zero never submits (the debounce owns first paint).
  const lastSubmit = useRef(0);
  useEffect(() => {
    if (submitRequest === undefined || submitRequest === lastSubmit.current) {
      return;
    }
    lastSubmit.current = submitRequest;
    if (submitRequest !== 0) {
      controller.lookupNow();
    }
  }, [controller, submitRequest]);

  return {
    view: controller.view,
    actionError,
    openMessage: () => {
      const target = controller.actionTarget();
      if (target === null) {
        return;
      }
      const chatId = resolveContactChat(chats, target.profile.userId, domainOfJid(myJid));
      if (chatId === undefined) {
        setActionError('No chat with them yet. Pull to refresh the chats list.');
        return;
      }
      onMessage(chatId);
    },
  };
}
