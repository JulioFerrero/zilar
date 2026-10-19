import { makeChatExtrasApi } from '@zilar/client-core';

export type { Pin } from '@zilar/api-contract';
export type { PinMessageInput } from '@zilar/client-core';

/** A pin `kind` this build does not know decodes to `text`. */
export type { SnapshotPinKind, SnapshotPinKind as PinKind } from './pin-snapshot';

export type PinsApi = ReturnType<typeof makeChatExtrasApi>;

export { pinKindFor, pinLabel, pinSnapshotText } from './pin-snapshot';
