import { Data } from 'effect';

// The typed errors of the XMPP core, one per failure mode. Each `message` is
// the fixed sentence the apps have always shown, so the texts below must not
// change. The fields carry only what the message needs: no tokens, no server
// text beyond a stanza condition name.

export class NotOnline extends Data.TaggedError('NotOnline')<{
  readonly message: string;
}> {
  constructor() {
    super({ message: 'the XMPP connection is not online' });
  }
}

export class NoIdentity extends Data.TaggedError('NoIdentity')<{
  readonly message: string;
}> {
  constructor() {
    super({ message: 'the XMPP connection has no identity yet' });
  }
}

export class ConnectTimeout extends Data.TaggedError('ConnectTimeout')<{
  readonly message: string;
}> {
  constructor() {
    super({ message: 'timed out connecting to XMPP' });
  }
}

export class Disconnected extends Data.TaggedError('Disconnected')<{
  readonly message: string;
}> {
  constructor() {
    super({ message: 'the XMPP client was disconnected' });
  }
}

// A pending request was cut off by a failed connection (not by disconnect()).
export class ConnectionFailed extends Data.TaggedError('ConnectionFailed')<{
  readonly message: string;
}> {
  constructor() {
    super({ message: 'the XMPP connection failed' });
  }
}

export class JoinRejected extends Data.TaggedError('JoinRejected')<{
  readonly condition: string;
  readonly message: string;
}> {
  constructor(args: { readonly condition: string }) {
    super({ condition: args.condition, message: `the room rejected the join: ${args.condition}` });
  }
}

export class JoinTimeout extends Data.TaggedError('JoinTimeout')<{
  readonly roomJid: string;
  readonly message: string;
}> {
  constructor(args: { readonly roomJid: string }) {
    super({ roomJid: args.roomJid, message: `timed out joining ${args.roomJid}` });
  }
}

export class JoinSendFailed extends Data.TaggedError('JoinSendFailed')<{
  readonly roomJid: string;
  readonly cause: string;
  readonly message: string;
}> {
  constructor(args: { readonly roomJid: string; readonly cause: string }) {
    super({
      roomJid: args.roomJid,
      cause: args.cause,
      message: `could not send the join presence for ${args.roomJid}: ${args.cause}`,
    });
  }
}

export class IqFailed extends Data.TaggedError('IqFailed')<{
  readonly condition: string;
  readonly message: string;
}> {
  constructor(args: { readonly condition: string }) {
    super({ condition: args.condition, message: `the request failed: ${args.condition}` });
  }
}

export class HistoryFailed extends Data.TaggedError('HistoryFailed')<{
  readonly condition: string;
  readonly message: string;
}> {
  constructor(args: { readonly condition: string }) {
    super({ condition: args.condition, message: `the history query failed: ${args.condition}` });
  }
}

export class HistoryTimeout extends Data.TaggedError('HistoryTimeout')<{
  readonly chatJid: string;
  readonly message: string;
}> {
  constructor(args: { readonly chatJid: string }) {
    super({ chatJid: args.chatJid, message: `timed out loading the history of ${args.chatJid}` });
  }
}

export class HistorySendFailed extends Data.TaggedError('HistorySendFailed')<{
  readonly chatJid: string;
  readonly cause: string;
  readonly message: string;
}> {
  constructor(args: { readonly chatJid: string; readonly cause: string }) {
    super({
      chatJid: args.chatJid,
      cause: args.cause,
      message: `could not send the history query for ${args.chatJid}: ${args.cause}`,
    });
  }
}

export class UploadSlotTimeout extends Data.TaggedError('UploadSlotTimeout')<{
  readonly message: string;
}> {
  constructor() {
    super({ message: 'timed out requesting an upload slot' });
  }
}

export class UploadSlotInvalid extends Data.TaggedError('UploadSlotInvalid')<{
  readonly message: string;
}> {
  constructor() {
    super({ message: 'the upload service returned an invalid slot' });
  }
}

export class UploadSlotFailed extends Data.TaggedError('UploadSlotFailed')<{
  readonly cause: string;
  readonly message: string;
}> {
  constructor(args: { readonly cause: string }) {
    super({ cause: args.cause, message: `could not request an upload slot: ${args.cause}` });
  }
}

export class PushToggleTimeout extends Data.TaggedError('PushToggleTimeout')<{
  readonly message: string;
}> {
  constructor() {
    super({ message: 'timed out toggling push notifications' });
  }
}

export class PushToggleFailed extends Data.TaggedError('PushToggleFailed')<{
  readonly cause: string;
  readonly message: string;
}> {
  constructor(args: { readonly cause: string }) {
    super({ cause: args.cause, message: `could not toggle push notifications: ${args.cause}` });
  }
}

export type XmppCoreError =
  | NotOnline
  | NoIdentity
  | ConnectTimeout
  | Disconnected
  | ConnectionFailed
  | JoinRejected
  | JoinTimeout
  | JoinSendFailed
  | IqFailed
  | HistoryFailed
  | HistoryTimeout
  | HistorySendFailed
  | UploadSlotTimeout
  | UploadSlotInvalid
  | UploadSlotFailed
  | PushToggleTimeout
  | PushToggleFailed;
