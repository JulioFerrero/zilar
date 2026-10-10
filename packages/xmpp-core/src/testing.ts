import { makeEventHub, type EventName, type EventPayload } from './events';
import type { HistoryPage, XmppCore } from './types';

/** The `XmppCore` methods a fake can record and fail; `on` is the event hub. */
export type FakeCoreMethod = Exclude<
  keyof XmppCore,
  'on' | 'setPushEnabled' | 'status' | 'me' | 'occupants'
>;

export interface FakeCall {
  method: FakeCoreMethod;
  args: unknown[];
}

export interface FakeXmppCore extends XmppCore {
  /** Every call to a core method, in order. */
  readonly calls: FakeCall[];
  /** Calls the `on` listeners of `event` synchronously. */
  emit<K extends EventName>(event: K, payload: EventPayload[K]): void;
  /**
   * An error to throw (async methods reject) each time that method is called.
   * Set or delete a key at any time.
   */
  readonly failures: Partial<Record<FakeCoreMethod, Error>>;
}

/**
 * An in-memory `XmppCore` for tests: online as `me@zilar.test`, every call
 * succeeds and is recorded. `overrides` replace single methods; they are not
 * recorded, and `on` stays the fake's own.
 */
export function createFakeXmppCore(overrides: Partial<Omit<XmppCore, 'on'>> = {}): FakeXmppCore {
  const hub = makeEventHub();
  const calls: FakeCall[] = [];
  const failures: Partial<Record<FakeCoreMethod, Error>> = {};

  const tracked = <A extends unknown[], R>(
    method: FakeCoreMethod,
    run: (...args: A) => R,
  ): ((...args: A) => R) => {
    return (...args) => {
      calls.push({ method, args });
      const failure = failures[method];
      if (failure !== undefined) throw failure;
      return run(...args);
    };
  };
  const trackedAsync = <A extends unknown[], R>(
    method: FakeCoreMethod,
    run: (...args: A) => R,
  ): ((...args: A) => Promise<R>) => {
    return async (...args) => {
      calls.push({ method, args });
      const failure = failures[method];
      if (failure !== undefined) throw failure;
      return run(...args);
    };
  };

  const core: FakeXmppCore = {
    calls,
    failures,
    emit: hub.emit,
    status: () => 'online',
    me: () => 'me@zilar.test',
    connect: trackedAsync('connect', () => undefined),
    disconnect: trackedAsync('disconnect', () => undefined),
    joinRoom: trackedAsync('joinRoom', () => undefined),
    leaveRoom: trackedAsync('leaveRoom', () => undefined),
    occupants: () => [],
    sendMessage: trackedAsync('sendMessage', () => ({ id: 'srv-1' })),
    sendReactions: trackedAsync('sendReactions', () => undefined),
    sendCorrection: trackedAsync('sendCorrection', () => ({ id: 'srv-c' })),
    sendRetraction: trackedAsync('sendRetraction', () => undefined),
    loadHistory: trackedAsync('loadHistory', (): HistoryPage => ({ messages: [], complete: true })),
    requestUploadSlot: trackedAsync('requestUploadSlot', () => ({
      putUrl: 'http://upload.test/put',
      getUrl: 'http://upload.test/get',
      headers: {},
    })),
    sendTyping: tracked('sendTyping', () => undefined),
    markDisplayed: tracked('markDisplayed', () => undefined),
    on: ((event: EventName, listener: (payload: never) => void) =>
      hub.on(event, listener)) as XmppCore['on'],
    ...overrides,
  };
  return core;
}
