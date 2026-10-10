import { type XmppClient, type XmppElement } from '@xmpp/client';
import { Deferred, Duration, Effect } from 'effect';
import {
  HistorySendFailed,
  HistoryTimeout,
  JoinSendFailed,
  JoinTimeout,
  NoIdentity,
  NotOnline,
  PushToggleFailed,
  PushToggleTimeout,
  UploadSlotFailed,
  UploadSlotInvalid,
  UploadSlotTimeout,
  type XmppCoreError,
} from '../errors';
import { DEFAULT_HISTORY_MAX, buildMamQuery } from '../mam';
import {
  buildCorrection,
  buildDisplayed,
  buildJoinPresence,
  buildLeavePresence,
  buildMessage,
  buildPushDisable,
  buildPushEnable,
  buildReactions,
  buildRetraction,
  buildTyping,
  buildUploadSlotRequest,
  parseUploadSlot,
} from '../stanza';
import type {
  ChatKind,
  HistoryPage,
  LoadHistoryOptions,
  SendCorrectionOptions,
  SendMessageOptions,
  UploadRequest,
  UploadSlot,
} from '../types';
import {
  HISTORY_TIMEOUT_MS,
  JOIN_TIMEOUT_MS,
  PUSH_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
  attempt,
  errorMessage,
  type CoreRuntime,
  type PendingIq,
  type PendingJoin,
  type PendingQuery,
} from './config';

export type OperationsApi = {
  joinRoom: (roomJid: string, nick: string) => Effect.Effect<void, XmppCoreError>;
  leaveRoom: (roomJid: string) => Effect.Effect<void>;
  sendMessage: (
    to: string,
    kind: ChatKind,
    text: string,
    opts?: SendMessageOptions,
  ) => Effect.Effect<{ id: string }, NotOnline | Error>;
  sendReactions: (
    chatJid: string,
    kind: ChatKind,
    targetId: string,
    emojis: string[],
  ) => Effect.Effect<void, NotOnline | Error>;
  sendCorrection: (
    chatJid: string,
    kind: ChatKind,
    originalId: string,
    text: string,
    opts?: SendCorrectionOptions,
  ) => Effect.Effect<{ id: string }, NotOnline | Error>;
  sendRetraction: (
    chatJid: string,
    kind: ChatKind,
    targetId: string,
  ) => Effect.Effect<void, NotOnline | Error>;
  loadHistory: (
    chatJid: string,
    kind: ChatKind,
    opts?: LoadHistoryOptions,
  ) => Effect.Effect<HistoryPage, XmppCoreError>;
  requestUploadSlot: (uploadRequest: UploadRequest) => Effect.Effect<UploadSlot, XmppCoreError>;
  setPushEnabled: (pushOptions: {
    pushJid: string;
    node: string;
    enable: boolean;
  }) => Effect.Effect<void, XmppCoreError>;
  sendTyping: (to: string, kind: ChatKind, state: 'composing' | 'paused') => Effect.Effect<void>;
  markDisplayed: (chatJid: string, kind: ChatKind, messageId: string) => Effect.Effect<void>;
};

export function createOperations(runtime: CoreRuntime): OperationsApi {
  // One request on a Deferred. The caller has already put its map entry in
  // place, so the reply handlers can find it. The send starts at once on a
  // child fiber, so the stanza goes out before the caller's first await: a
  // failed send fails the Deferred (a no-op once a reply or an earlier
  // failure completed it), and a send that never settles cannot hold the
  // request back from its reply or its timeout. Then the request awaits the
  // Deferred, which keeps a reply that arrived early, under the timeout.
  // `release` drops the map entry on every exit, including interruption.
  function request<A>(args: {
    deferred: Deferred.Deferred<A, XmppCoreError>;
    send: Effect.Effect<void, XmppCoreError>;
    timeoutMs: number;
    onTimeout: () => XmppCoreError;
    release: () => void;
  }): Effect.Effect<A, XmppCoreError> {
    const { deferred } = args;
    return Effect.gen(function* () {
      yield* args.send.pipe(
        Effect.tapError((error) => Deferred.fail(deferred, error)),
        Effect.ignore,
        Effect.forkChild({ startImmediately: true }),
      );
      return yield* Deferred.await(deferred).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(args.timeoutMs),
          orElse: () => Effect.fail(args.onTimeout()),
        }),
      );
    }).pipe(Effect.ensuring(Effect.sync(args.release)));
  }

  function requireOnlineEffect(): Effect.Effect<XmppClient, NotOnline> {
    return Effect.suspend(() => {
      const current = runtime.xmpp;
      if (current === undefined || runtime.currentStatus !== 'online') {
        return Effect.fail(new NotOnline());
      }
      return Effect.succeed(current);
    });
  }

  const joinRoomEffect = Effect.fnUntraced(function* (
    roomJid: string,
    nick: string,
  ): Effect.fn.Return<void, XmppCoreError> {
    const current = yield* requireOnlineEffect();
    runtime.joinedRooms.set(roomJid, nick);
    const key = `${roomJid}/${nick}`;

    const deferred = Deferred.makeUnsafe<void, XmppCoreError>();
    const entry: PendingJoin = { deferred };
    runtime.pendingJoins.set(key, entry);
    return yield* request({
      deferred,
      send: Effect.tryPromise({
        try: () => current.send(buildJoinPresence(roomJid, nick)),
        catch: (error) => new JoinSendFailed({ roomJid, cause: errorMessage(error) }),
      }),
      timeoutMs: JOIN_TIMEOUT_MS,
      onTimeout: () => new JoinTimeout({ roomJid }),
      release: () => {
        if (runtime.pendingJoins.get(key) === entry) runtime.pendingJoins.delete(key);
      },
    });
  });

  const leaveRoomEffect = Effect.fnUntraced(function* (roomJid: string): Effect.fn.Return<void> {
    const nick = runtime.joinedRooms.get(roomJid);
    runtime.joinedRooms.delete(roomJid);
    runtime.clearRoster(roomJid);
    const current = runtime.xmpp;
    if (nick === undefined || current === undefined || runtime.currentStatus !== 'online') return;
    yield* runtime.sendQuietly(current, buildLeavePresence(roomJid, nick));
  });

  // The send operations differ only in the stanza they build: each takes a
  // fresh id and fails with `NotOnline`, or with the error the library's
  // `send` rejected with.
  const sendStanzaEffect = Effect.fnUntraced(function* (
    build: (id: string) => XmppElement,
  ): Effect.fn.Return<{ id: string }, NotOnline | Error> {
    const current = yield* requireOnlineEffect();
    const id = runtime.generateId();
    yield* attempt(() => current.send(build(id)));
    return { id };
  });

  const sendMessageEffect = Effect.fnUntraced(function* (
    to: string,
    kind: ChatKind,
    text: string,
    opts: SendMessageOptions = {},
  ): Effect.fn.Return<{ id: string }, NotOnline | Error> {
    return yield* sendStanzaEffect((id) =>
      buildMessage({
        id,
        to,
        kind,
        text,
        payload: opts.payload,
        forward: opts.forward,
        replyTo: opts.replyTo,
        mentions: opts.mentions,
      }),
    );
  });

  const sendReactionsEffect = Effect.fnUntraced(function* (
    chatJid: string,
    kind: ChatKind,
    targetId: string,
    emojis: string[],
  ): Effect.fn.Return<void, NotOnline | Error> {
    yield* sendStanzaEffect((id) => buildReactions({ id, to: chatJid, kind, targetId, emojis }));
  });

  const sendCorrectionEffect = Effect.fnUntraced(function* (
    chatJid: string,
    kind: ChatKind,
    originalId: string,
    text: string,
    opts: SendCorrectionOptions = {},
  ): Effect.fn.Return<{ id: string }, NotOnline | Error> {
    return yield* sendStanzaEffect((id) =>
      buildCorrection({
        id,
        to: chatJid,
        kind,
        originalId,
        text,
        mentions: opts.mentions,
      }),
    );
  });

  const sendRetractionEffect = Effect.fnUntraced(function* (
    chatJid: string,
    kind: ChatKind,
    targetId: string,
  ): Effect.fn.Return<void, NotOnline | Error> {
    yield* sendStanzaEffect((id) => buildRetraction({ id, to: chatJid, kind, targetId }));
  });

  // Typing and read markers are fire-and-forget: offline they do nothing, and
  // a failed send is reported as an `error` event.
  function sendQuietlyIfOnline(build: () => XmppElement): Effect.Effect<void> {
    return Effect.suspend(() => {
      const current = runtime.xmpp;
      if (current === undefined || runtime.currentStatus !== 'online') return Effect.void;
      return runtime.sendQuietly(current, build());
    });
  }

  function sendTypingEffect(
    to: string,
    kind: ChatKind,
    state: 'composing' | 'paused',
  ): Effect.Effect<void> {
    return sendQuietlyIfOnline(() => buildTyping({ to, kind, state }));
  }

  function markDisplayedEffect(
    chatJid: string,
    kind: ChatKind,
    messageId: string,
  ): Effect.Effect<void> {
    return sendQuietlyIfOnline(() => buildDisplayed({ chatJid, kind, messageId }));
  }

  const loadHistoryEffect = Effect.fnUntraced(function* (
    chatJid: string,
    kind: ChatKind,
    opts: LoadHistoryOptions = {},
  ): Effect.fn.Return<HistoryPage, XmppCoreError> {
    const current = yield* requireOnlineEffect();
    const me = runtime.meJid;
    if (me === undefined) {
      return yield* new NoIdentity();
    }

    const queryId = runtime.generateId();
    const iqId = runtime.generateId();
    const max = opts.max ?? DEFAULT_HISTORY_MAX;
    const query = buildMamQuery({
      chatJid,
      kind,
      me,
      queryId,
      iqId,
      max,
      before: opts.before,
    });

    const deferred = Deferred.makeUnsafe<HistoryPage, XmppCoreError>();
    const entry: PendingQuery = { iqId, messages: [], deferred };
    runtime.pendingQueries.set(queryId, entry);
    return yield* request({
      deferred,
      send: Effect.tryPromise({
        try: () => current.send(query),
        catch: (error) => new HistorySendFailed({ chatJid, cause: errorMessage(error) }),
      }),
      timeoutMs: HISTORY_TIMEOUT_MS,
      onTimeout: () => new HistoryTimeout({ chatJid }),
      release: () => {
        if (runtime.pendingQueries.get(queryId) === entry) runtime.pendingQueries.delete(queryId);
      },
    });
  });

  const requestUploadSlotEffect = Effect.fnUntraced(function* (
    uploadRequest: UploadRequest,
  ): Effect.fn.Return<UploadSlot, XmppCoreError> {
    const current = yield* requireOnlineEffect();
    const id = runtime.generateId();
    const service = `upload.${runtime.options.domain}`;
    const stanza = buildUploadSlotRequest({
      id,
      service,
      filename: uploadRequest.filename,
      size: uploadRequest.size,
      contentType: uploadRequest.contentType,
    });

    const deferred = Deferred.makeUnsafe<XmppElement, XmppCoreError>();
    const entry: PendingIq = { deferred };
    runtime.pendingIqs.set(id, entry);
    const reply = yield* request({
      deferred,
      send: Effect.tryPromise({
        try: () => current.send(stanza),
        catch: (error) => new UploadSlotFailed({ cause: errorMessage(error) }),
      }),
      timeoutMs: UPLOAD_TIMEOUT_MS,
      onTimeout: () => new UploadSlotTimeout(),
      release: () => {
        if (runtime.pendingIqs.get(id) === entry) runtime.pendingIqs.delete(id);
      },
    });
    const slot = parseUploadSlot(reply);
    if (slot === undefined) {
      return yield* new UploadSlotInvalid();
    }
    return slot;
  });

  // XEP-0357: enables or disables push for this session's push pair. The
  // request goes over the user's own session (ejabberd requires it) and
  // resolves when the server answers `result`, or rejects on `error`/timeout.
  const setPushEnabledEffect = Effect.fnUntraced(function* (pushOptions: {
    pushJid: string;
    node: string;
    enable: boolean;
  }): Effect.fn.Return<void, XmppCoreError> {
    const current = yield* requireOnlineEffect();
    const id = runtime.generateId();
    const stanza =
      pushOptions.enable === true
        ? buildPushEnable({ id, pushJid: pushOptions.pushJid, node: pushOptions.node })
        : buildPushDisable({ id, pushJid: pushOptions.pushJid, node: pushOptions.node });

    const deferred = Deferred.makeUnsafe<XmppElement, XmppCoreError>();
    const entry: PendingIq = { deferred };
    runtime.pendingIqs.set(id, entry);
    yield* request({
      deferred,
      send: Effect.tryPromise({
        try: () => current.send(stanza),
        catch: (error) => new PushToggleFailed({ cause: errorMessage(error) }),
      }),
      timeoutMs: PUSH_TIMEOUT_MS,
      onTimeout: () => new PushToggleTimeout(),
      release: () => {
        if (runtime.pendingIqs.get(id) === entry) runtime.pendingIqs.delete(id);
      },
    });
  });

  return {
    joinRoom: joinRoomEffect,
    leaveRoom: leaveRoomEffect,
    sendMessage: sendMessageEffect,
    sendReactions: sendReactionsEffect,
    sendCorrection: sendCorrectionEffect,
    sendRetraction: sendRetractionEffect,
    loadHistory: loadHistoryEffect,
    requestUploadSlot: requestUploadSlotEffect,
    setPushEnabled: setPushEnabledEffect,
    sendTyping: sendTypingEffect,
    markDisplayed: markDisplayedEffect,
  };
}
