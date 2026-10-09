import { Effect } from 'effect';
import { createCoreEffect, type CoreDependencies } from './core-effect';
import type { XmppCore, XmppCoreOptions } from './types';

export type { ClientFactory, ClientOptions, CoreDependencies } from './core-effect';

/**
 * The Promise facade over the Effect core: each method runs the core's Effect
 * with `Effect.runPromise`, so a rejection is the error the Effect failed
 * with. Typing and read markers are fire and forget, and `on` is the core's
 * synchronous callback form.
 */
export function createCore(options: XmppCoreOptions, deps: CoreDependencies = {}): XmppCore {
  const core = createCoreEffect(options, deps);
  return {
    status: core.status,
    me: core.me,
    occupants: core.occupants,
    connect: () => Effect.runPromise(core.connect()),
    disconnect: () => Effect.runPromise(core.disconnect()),
    joinRoom: (roomJid, nick) => Effect.runPromise(core.joinRoom(roomJid, nick)),
    leaveRoom: (roomJid) => Effect.runPromise(core.leaveRoom(roomJid)),
    sendMessage: (to, kind, text, opts) =>
      Effect.runPromise(core.sendMessage(to, kind, text, opts)),
    sendReactions: (chatJid, kind, targetId, emojis) =>
      Effect.runPromise(core.sendReactions(chatJid, kind, targetId, emojis)),
    sendCorrection: (chatJid, kind, originalId, text, opts) =>
      Effect.runPromise(core.sendCorrection(chatJid, kind, originalId, text, opts)),
    sendRetraction: (chatJid, kind, targetId) =>
      Effect.runPromise(core.sendRetraction(chatJid, kind, targetId)),
    loadHistory: (chatJid, kind, opts) => Effect.runPromise(core.loadHistory(chatJid, kind, opts)),
    requestUploadSlot: (request) => Effect.runPromise(core.requestUploadSlot(request)),
    setPushEnabled: (pushOptions) => Effect.runPromise(core.setPushEnabled(pushOptions)),
    sendTyping: (to, kind, state) => {
      Effect.runFork(core.sendTyping(to, kind, state));
    },
    markDisplayed: (chatJid, kind, messageId) => {
      Effect.runFork(core.markDisplayed(chatJid, kind, messageId));
    },
    on: core.on,
  };
}
