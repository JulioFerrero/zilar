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

/** The server removed me from the room: my own unavailable MUC presence
 * carried status 110 (self-presence) with 307 (kicked), 301 (banned) or
 * 321 (affiliation changed). The store refreshes the chat list at once, so
 * every device drops the group or topic instead of waiting for the poll. */
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
// New events join the map through interface merging in their own module (see
// `types-ack.ts`), so this file stays the only place the map is listed.
export type EventPayload = EventPayloadMap;
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
