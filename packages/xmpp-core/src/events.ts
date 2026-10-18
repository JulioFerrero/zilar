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
import './types-ack';
import './types-delivered';

/** The server removed me: my own unavailable MUC presence carried status 110 with 307
 * (kicked), 301 (banned) or 321. The store refreshes the chat list at once. */
export interface RemovedEvent {
  roomJid: string;
}

declare module './types' {
  interface XmppCore {
    /** My own unavailable MUC presence carried 307, 301 or 321: the server removed me. */
    on(event: 'removed', cb: (e: RemovedEvent) => void): () => void;
  }
}

export interface EventPayloadMap {
  status: ConnectionStatus;
  message: ChatMessage;
  typing: TypingEvent;
  displayed: DisplayedEvent;
  occupants: OccupantsEvent;
  presence: PresenceEvent;
  invited: InvitedEvent;
  roster: RosterEvent;
  error: ErrorEvent;
  removed: RemovedEvent;
  replaced: void;
}
export type EventPayload = EventPayloadMap;
export type EventName = keyof EventPayload;
export type StoredListener = (payload: never) => void;

export type EventHub = {
  /** Calls the `on` listeners synchronously, in subscription order. */
  emit<K extends EventName>(event: K, payload: EventPayload[K]): void;
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
