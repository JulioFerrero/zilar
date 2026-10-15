// The topics domain's table. Extends the shared `MockSeed`/`MockData` from its
// own folder (module augmentation), so a new domain is a folder plus one line in
// `src/domains/index.ts` (T-0942).

export type TopicVisibility = 'public' | 'private';
export type TopicKind = 'chat' | 'task' | 'bug' | 'ui' | 'routine';
export type TopicStatus = 'open' | 'in_progress' | 'in_review' | 'blocked' | 'done';

export interface MockTopicOwner {
  readonly kind: 'user' | 'ai';
  readonly id: string;
  readonly name: string;
}

/** T-1514: the three AI activity states a mock topic row may carry. */
export type MockTopicAiState = 'working' | 'waiting' | 'done';

/** T-1514: one AI at work in a topic, mirroring the wire shape. */
export interface MockTopicActivity {
  readonly aiId: string;
  readonly name: string;
  readonly avatarUrl?: string;
  /** T-1577: an open question's card message id, so the row can open it. */
  readonly questionId?: string;
  readonly state: MockTopicAiState;
}

/**
 * One live topic. The plain fields are patched in place through `putTopic`; the
 * id lists are always replaced, never mutated.
 */
export interface MockTopic {
  id: string;
  groupId: string;
  name: string;
  glyph: string;
  chatJid: string;
  visibility: TopicVisibility;
  kind: TopicKind;
  status: TopicStatus;
  owner: MockTopicOwner | null;
  linkUrl: string | null;
  linkLabel: string | null;
  isGeneral: boolean;
  archived: boolean;
  /** T-1521: when a person marked the topic done, an ISO time; absent when open. */
  doneAt?: string | null;
  memberIds: string[];
  aiIds: string[];
  roleIds: string[];
  approverRoleId: string | null;
  /** T-1514: the AIs at work here; absent on most rows (idle). */
  activity?: readonly MockTopicActivity[];
}

declare module '../../data' {
  interface MockSeed {
    readonly topics: readonly MockTopic[];
  }
}

declare module '../../state' {
  interface MockData {
    readonly topics: readonly MockTopic[];
    findTopic(id: string): MockTopic | undefined;
    /** Replace the topic with the same id, or append a new one. */
    putTopic(topic: MockTopic): void;
    /** The next `t-mock-N` id, like web's `nextTopicSequence` topic ids. */
    nextTopicId(): string;
  }
}
