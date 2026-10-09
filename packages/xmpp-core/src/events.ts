import { Effect, PubSub, Stream } from 'effect';
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

export type EventStreams = { readonly [K in EventName]: Stream.Stream<EventPayload[K]> };

export type EventHub = {
  /** Calls the `on` listeners synchronously, then publishes to the PubSub of this event kind. */
  emit<K extends EventName>(event: K, payload: EventPayload[K]): void;
  /** Callback form; the returned function unsubscribes. */
  on(event: EventName, listener: StoredListener): () => void;
  /** One `Stream` per event kind; each subscriber sees events published after it subscribed. */
  streams: EventStreams;
};

function makePubSubs(): { [K in EventName]: PubSub.PubSub<EventPayload[K]> } {
  return {
    status: Effect.runSync(PubSub.unbounded<EventPayload['status']>()),
    message: Effect.runSync(PubSub.unbounded<EventPayload['message']>()),
    typing: Effect.runSync(PubSub.unbounded<EventPayload['typing']>()),
    displayed: Effect.runSync(PubSub.unbounded<EventPayload['displayed']>()),
    occupants: Effect.runSync(PubSub.unbounded<EventPayload['occupants']>()),
    presence: Effect.runSync(PubSub.unbounded<EventPayload['presence']>()),
    invited: Effect.runSync(PubSub.unbounded<EventPayload['invited']>()),
    roster: Effect.runSync(PubSub.unbounded<EventPayload['roster']>()),
    error: Effect.runSync(PubSub.unbounded<EventPayload['error']>()),
    replaced: Effect.runSync(PubSub.unbounded<EventPayload['replaced']>()),
  };
}

export function makeEventHub(): EventHub {
  const pubsubs = makePubSubs();
  const streams: EventStreams = {
    status: Stream.fromPubSub(pubsubs.status),
    message: Stream.fromPubSub(pubsubs.message),
    typing: Stream.fromPubSub(pubsubs.typing),
    displayed: Stream.fromPubSub(pubsubs.displayed),
    occupants: Stream.fromPubSub(pubsubs.occupants),
    presence: Stream.fromPubSub(pubsubs.presence),
    invited: Stream.fromPubSub(pubsubs.invited),
    roster: Stream.fromPubSub(pubsubs.roster),
    error: Stream.fromPubSub(pubsubs.error),
    replaced: Stream.fromPubSub(pubsubs.replaced),
  };

  // `on` callbacks run synchronously inside `emit`, in subscription order,
  // exactly as before: a consumer fiber on the PubSub would deliver a tick
  // later, and a callback that throws would kill the fiber and silence every
  // later event, where today the throw reaches the stanza handler. The
  // PubSubs feed the `Stream` accessors.
  const listeners = new Map<EventName, Set<StoredListener>>();

  return {
    emit: (event, payload) => {
      const set = listeners.get(event);
      if (set !== undefined) {
        for (const listener of set) {
          (listener as (value: typeof payload) => void)(payload);
        }
      }
      PubSub.publishUnsafe(pubsubs[event] as PubSub.PubSub<typeof payload>, payload);
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
    streams,
  };
}
