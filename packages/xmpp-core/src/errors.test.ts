import { describe, expect, it } from 'vitest';
import {
  ConnectionFailed,
  ConnectTimeout,
  Disconnected,
  HistoryFailed,
  HistorySendFailed,
  HistoryTimeout,
  IqFailed,
  JoinRejected,
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
} from './errors';

const cases: Array<[string, XmppCoreError, string]> = [
  ['NotOnline', new NotOnline(), 'the XMPP connection is not online'],
  ['NoIdentity', new NoIdentity(), 'the XMPP connection has no identity yet'],
  ['ConnectTimeout', new ConnectTimeout(), 'timed out connecting to XMPP'],
  ['Disconnected', new Disconnected(), 'the XMPP client was disconnected'],
  ['ConnectionFailed', new ConnectionFailed(), 'the XMPP connection failed'],
  [
    'JoinRejected',
    new JoinRejected({ condition: 'forbidden' }),
    'the room rejected the join: forbidden',
  ],
  [
    'JoinTimeout',
    new JoinTimeout({ roomJid: 'room@rooms.example' }),
    'timed out joining room@rooms.example',
  ],
  [
    'JoinSendFailed',
    new JoinSendFailed({ roomJid: 'room@rooms.example', cause: 'socket closed' }),
    'could not send the join presence for room@rooms.example: socket closed',
  ],
  ['IqFailed', new IqFailed({ condition: 'item-not-found' }), 'the request failed: item-not-found'],
  [
    'HistoryFailed',
    new HistoryFailed({ condition: 'service-unavailable' }),
    'the history query failed: service-unavailable',
  ],
  [
    'HistoryTimeout',
    new HistoryTimeout({ chatJid: 'chat@rooms.example' }),
    'timed out loading the history of chat@rooms.example',
  ],
  [
    'HistorySendFailed',
    new HistorySendFailed({ chatJid: 'chat@rooms.example', cause: 'socket closed' }),
    'could not send the history query for chat@rooms.example: socket closed',
  ],
  ['UploadSlotTimeout', new UploadSlotTimeout(), 'timed out requesting an upload slot'],
  ['UploadSlotInvalid', new UploadSlotInvalid(), 'the upload service returned an invalid slot'],
  [
    'UploadSlotFailed',
    new UploadSlotFailed({ cause: 'socket closed' }),
    'could not request an upload slot: socket closed',
  ],
  ['PushToggleTimeout', new PushToggleTimeout(), 'timed out toggling push notifications'],
  [
    'PushToggleFailed',
    new PushToggleFailed({ cause: 'socket closed' }),
    'could not toggle push notifications: socket closed',
  ],
];

describe('XMPP core typed errors', () => {
  it.each(cases)('%s keeps its tag, its message and is an Error', (tag, error, message) => {
    expect(error._tag).toBe(tag);
    expect(error.message).toBe(message);
    expect(error).toBeInstanceOf(Error);
  });
});
