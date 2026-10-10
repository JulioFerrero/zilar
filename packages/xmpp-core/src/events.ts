import type {
  ChatMessage,
  ConnectionStatus,
  DisplayedEvent,
  ErrorEvent,
  InvitedEvent,
  OccupantsEvent,
  PresenceEvent,
  RosterEvent,
  TypingEvent,
} from './types';

export type EventPayload = {
  status: ConnectionStatus;
  message: ChatMessage;
  typing: TypingEvent;
  displayed: DisplayedEvent;
  occupants: OccupantsEvent;
  presence: PresenceEvent;
  invited: InvitedEvent;
  roster: RosterEvent;
  error: ErrorEvent;
  replaced: void;
};
export type EventName = keyof EventPayload;
export type StoredListener = (payload: never) => void;

export type EventHub = {
  /** Calls the `on` listeners synchronously, in subscription order. */
  emit<K extends EventName>(event: K, payload: EventPayload[K]): void;
  /** Callback form; the returned function unsubscribes. */
  on(event: EventName, listener: StoredListener): () => void;
};

export function makeEventHub(): EventHub {
  // `on` callbacks run synchronously inside `emit`, in subscription order:
  // a callback that throws reaches the stanza handler.
  const listeners = new Map<EventName, Set<StoredListener>>();

  return {
    emit: (event, payload) => {
      const set = listeners.get(event);
      if (set !== undefined) {
        for (const listener of set) {
          (listener as (value: typeof payload) => void)(payload);
        }
      }
    },
    on: (event, listener) => {
      let set = listeners.get(event);
      if (set === undefined) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
  };
}
