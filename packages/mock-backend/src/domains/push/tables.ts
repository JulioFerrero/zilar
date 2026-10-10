// The push domain's tables. Like every domain it extends the shared
// `MockSeed`/`MockData` from its own folder (module augmentation), so a new
// domain is a folder plus one line in `src/domains/index.ts`.

import type { PushDevice } from '@zilar/api-contract';

/** One registered push-device row, mirroring the contract's `PushDevice`. */
export type MockPushDevice = PushDevice;

declare module '../../data' {
  interface MockSeed {
    readonly pushDevices: readonly MockPushDevice[];
    readonly pushShowPreviews: boolean;
  }
}

declare module '../../state' {
  interface MockData {
    readonly pushDevices: readonly MockPushDevice[];
    readonly pushShowPreviews: boolean;
    findPushDevice(id: string): MockPushDevice | undefined;
    /** Replace the row with the same id, or append it when it is new. */
    putPushDevice(device: MockPushDevice): void;
    removePushDevice(id: string): void;
    setPushShowPreviews(show: boolean): void;
    /** The next `mock-push-device-N` id, like web's `nextPushDeviceSequence`. */
    nextPushDeviceId(): string;
  }
}
