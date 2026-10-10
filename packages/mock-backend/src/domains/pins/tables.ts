// The pins domain's table. Like every domain it extends the shared
// `MockSeed`/`MockData` from its own folder (module augmentation), so a new
// domain is a folder plus one line in `src/domains/index.ts`.

import type { Pin } from '@zilar/api-contract';

/** One pinned-message row, mirroring the contract's `Pin`. */
export type MockPin = Pin;

declare module '../../data' {
  interface MockSeed {
    readonly pins: readonly MockPin[];
  }
}

declare module '../../state' {
  interface MockData {
    readonly pins: readonly MockPin[];
    findPin(id: string): MockPin | undefined;
    /** Prepend the pin, so the list stays newest first like the server. */
    putPin(pin: MockPin): void;
    removePin(id: string): void;
    /** The next `pin-mock-N` id, like web's `nextPinSequence`. */
    nextPinId(): string;
  }
}
