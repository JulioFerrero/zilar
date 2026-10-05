import { useEffect, useReducer, useRef, useState } from 'react';

import { ContactsApiError, domainOfJid, type ContactsApi } from '../../lib/contacts-api';
import { actOnProfileRequest, addContactSendFailure } from './add-contact';
import { resolveContactChat } from './add-contact-sheet';
import { performBlock, performUnblock } from './blocks';
import { PeopleSearchController, type PeopleSearchView } from './people-search';

/**
 * The `@handle` people search for the chat-list search bar (T-0193): the
 * debounced exact lookup plus the card actions, behaving exactly like the
 * add-contact flow (including refreshing the row after the action).
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
  busy: boolean;
  actionError: string | null;
  lookupNow: () => void;
  send: () => void;
  cancelRequest: () => void;
  acceptRequest: () => void;
  declineRequest: () => void;
  block: () => void;
  unblock: () => void;
  openMessage: () => void;
} {
  const { api, text, chats, myJid, onMessage, submitRequest } = options;
  const [, force] = useReducer((count: number) => count + 1, 0);
  const [controller] = useState(() => new PeopleSearchController({ api, onChange: force }));
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const busyRef = useRef(false);

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

  const runAction = (work: () => Promise<void>): void => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    void work()
      .catch((error: unknown) => {
        setActionError(actionErrorFor(error));
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  };

  const actOnRequest = (work: (id: string) => Promise<unknown>): void => {
    const target = controller.actionTarget();
    if (target === null) {
      return;
    }
    const active = target.profile;
    runAction(() =>
      actOnProfileRequest(
        api,
        { userId: active.userId, handle: target.handle },
        work,
        (found) => controller.setFound(found, false),
        () => controller.setFound(active, false),
      ),
    );
  };

  return {
    view: controller.view,
    busy,
    actionError,
    lookupNow: () => controller.lookupNow(),
    send: () => {
      const target = controller.actionTarget();
      if (target === null) {
        return;
      }
      const active = target.profile;
      runAction(() =>
        api.sendContactRequest(active.handle).then((created) => {
          if (created.incoming === true) {
            controller.setFound({ ...active, relation: 'request_received' }, false);
          } else {
            controller.setFound(active, true);
          }
        }),
      );
    },
    cancelRequest: () => actOnRequest((id) => api.cancelContactRequest(id)),
    acceptRequest: () => actOnRequest((id) => api.acceptContactRequest(id)),
    declineRequest: () => actOnRequest((id) => api.declineContactRequest(id)),
    block: () => {
      const target = controller.actionTarget();
      if (target === null) {
        return;
      }
      const active = target.profile;
      runAction(async () => {
        const failure = await performBlock(api, active.userId, () => {
          controller.setFound({ ...active, relation: 'blocked' }, false);
        });
        if (failure !== null) {
          setActionError(failure);
        }
      });
    },
    unblock: () => {
      const target = controller.actionTarget();
      if (target === null) {
        return;
      }
      const active = target.profile;
      runAction(async () => {
        const failure = await performUnblock(api, active.userId, () => {
          controller.setFound({ ...active, relation: 'none' }, false);
        });
        if (failure !== null) {
          setActionError(failure);
        }
      });
    },
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

function actionErrorFor(error: unknown): string {
  if (error instanceof ContactsApiError && error.status === 404) {
    return 'That request is no longer here.';
  }
  return addContactSendFailure(error);
}
