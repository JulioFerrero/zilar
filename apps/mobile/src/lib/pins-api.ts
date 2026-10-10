import { Exit, Schema } from 'effect';
import {
  ApiError,
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
 * The mobile twin of the web pins client (`apps/web/src/lib/api.ts`): list,
 * pin and unpin, as a Promise port over the client derived from the shared
 * contract (`@zilar/api-contract`, `pins.ts`, T-0864). The contract owns the
 * schemas; a pin `kind` this build does not know decodes to `text`.
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

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const PinsApiError = ApiError;
export type PinsApiError = ApiError;

const LenientPinKind = lenientLiterals(PIN_KINDS, 'text');

/** Unknown kinds fall back to `text`, so a newer server never breaks pins. */
export function parsePinKind(value: unknown): PinKind {
  return Schema.decodeUnknownSync(LenientPinKind)(value);
}

/** A pin row the viewer may see; malformed rows return null and are dropped. */
export function parsePin(value: unknown): Pin | null {
  const decoded = Schema.decodeUnknownExit(PinSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

/** The production `PinsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createPinsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string,
): PinsApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return {
    listPins: (chat) =>
      runApi(client.pins.list({ query: { chat } })).then((body) => [...body.pins]),
    // The server trims `senderName`; the contract encodes the trimmed form.
    pinMessage: (input) =>
      runApi(client.pins.create({ payload: { ...input, senderName: input.senderName.trim() } })),
    // The server echoes the deleted row, so the store can remove it without
    // a refetch.
    unpinMessage: (id) => runApi(client.pins.remove({ params: { id } })),
  };
}

// The snapshot helpers (`pinKindFor`, `pinSnapshotText`, `pinLabel`) live in
// the dependency-free `pin-snapshot.ts`, so components can import them
// without pulling the API client (Vitest cannot resolve `@/` for component
// modules — see `apps/mobile` test notes in T-0112).
export { pinKindFor, pinLabel, pinSnapshotText } from './pin-snapshot';
export type { SnapshotPinKind } from './pin-snapshot';
