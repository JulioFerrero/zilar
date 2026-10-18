import { Exit, Schema } from 'effect';
import {
  Pin as PinSchema,
  lenientLiterals,
  PIN_KINDS,
  runApi,
  type Pin as ContractPin,
} from '@zilar/api-contract';

import { createApiClient } from './effect/api-client';
import type { SnapshotPinKind } from './pin-snapshot';

export type PinKind = SnapshotPinKind;

/**
 * A pin `kind` this build does not know decodes to `text`.
 */

export type Pin = ContractPin;

export interface PinMessageInput {
  chat: string;
  messageId: string;
  senderName: string;
  text: string;
  kind: PinKind;
}

export interface PinsApi {
  listPins(chat: string): Promise<Pin[]>;
  pinMessage(input: PinMessageInput): Promise<Pin>;
  unpinMessage(id: string): Promise<Pin>;
}

const LenientPinKind = lenientLiterals(PIN_KINDS, 'text');

/** Unknown kinds fall back to `text`, so a newer server never breaks pins. */
export function parsePinKind(value: unknown): PinKind {
  return Schema.decodeUnknownSync(LenientPinKind)(value);
}

export function parsePin(value: unknown): Pin | null {
  const decoded = Schema.decodeUnknownExit(PinSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

export function createPinsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string,
): PinsApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return {
    listPins: (chat) =>
      runApi(client.pins.list({ query: { chat } })).then((body) => [...body.pins]),
    pinMessage: (input) =>
      runApi(client.pins.create({ payload: { ...input, senderName: input.senderName.trim() } })),
    // The server echoes the deleted row, so the store removes it without a refetch.
    unpinMessage: (id) => runApi(client.pins.remove({ params: { id } })),
  };
}

export { pinKindFor, pinLabel, pinSnapshotText } from './pin-snapshot';
export type { SnapshotPinKind } from './pin-snapshot';
