// The groups domain's table. A domain extends the shared `MockSeed`/`MockData`
// from inside its own folder with a module augmentation, so adding a domain
// stays "a folder plus one alphabetical line in `src/domains/index.ts`" (T-0942)
// and parallel domains never edit the same shared file.
import type { GroupDetail } from '@zilar/api-contract';

/** One live group (a channel is a group with `kind: 'channel'`). */
export type MockGroup = GroupDetail;

declare module '../../data' {
  interface MockSeed {
    readonly groups: readonly MockGroup[];
  }
}

declare module '../../state' {
  interface MockData {
    readonly groups: readonly MockGroup[];
    findGroup(id: string): MockGroup | undefined;
    /** Replace the group with the same id, or append a new one. */
    putGroup(group: MockGroup): void;
    /** The next `g-mock-N` id, the mock's fresh group id. */
    nextGroupId(): string;
  }
}
