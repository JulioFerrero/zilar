// The roles domain's table. Like every domain it extends the shared
// `MockSeed`/`MockData` from its own folder (module augmentation), so a new
// domain is a folder plus one line in `src/domains/index.ts`.

/** One custom group role with its holder ids (the contract's `GroupRole`). */
export interface MockGroupRole {
  readonly id: string;
  readonly groupId: string;
  readonly name: string;
  readonly memberIds: readonly string[];
}

declare module '../../data' {
  interface MockSeed {
    readonly groupRoles: readonly MockGroupRole[];
  }
}

declare module '../../state' {
  interface MockData {
    readonly groupRoles: readonly MockGroupRole[];
    findGroupRole(id: string): MockGroupRole | undefined;
    /** Replace the role with the same id, or append a new one. */
    putGroupRole(role: MockGroupRole): void;
    removeGroupRole(id: string): void;
    /** The next `role-mock-N` id, like web's `nextRoleSequence`. */
    nextRoleId(): string;
  }
}
