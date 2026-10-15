// T-1422: the shape of the gateway's turn-stop hook, in its own import-free
// module. The app and the AI routes need only this type, and the runner
// typechecks them with a tsconfig that cannot resolve `@xmpp/client` (only
// `@zilar/xmpp-core` carries those declarations), so the type must not pull in
// `gateway/contracts.ts` and the XMPP core behind it.
export interface TurnStopper {
  stopTurn: (aiId: string, chatJid: string) => boolean;
}

// T-1505: the read side of the gateway's in-memory turn state, for the topic
// AI activity read model. Import-free for the same reason as `TurnStopper`: the
// reader only needs the type, not the XMPP core behind the gateway contracts.
export interface TurnWatcher {
  /** Ids of the live sessions with a turn in flight in one bare room JID. */
  runningAiIds: (roomJid: string) => string[];
}
