import type { MockSeed } from '../../data';
import type { MockData } from '../../state';
import type { MockTopic } from './tables';

function cloneTopic(topic: MockTopic): MockTopic {
  return {
    ...topic,
    owner: topic.owner === null ? null : { ...topic.owner },
    memberIds: [...topic.memberIds],
    aiIds: [...topic.aiIds],
    roleIds: [...topic.roleIds],
  };
}

/**
 * The topics table and its mutators. Rows are cloned from the seed, so a
 * caller-supplied seed is never changed; every patch is written through
 * `putTopic` and `reset()` rebuilds the table from a fresh seed.
 */
export function createTopicsState(seed: MockSeed): Partial<MockData> {
  let topics: MockTopic[] = seed.topics.map(cloneTopic);
  let topicSequence = 1;
  return {
    get topics(): readonly MockTopic[] {
      return topics;
    },
    findTopic(id: string): MockTopic | undefined {
      return topics.find((topic) => topic.id === id);
    },
    putTopic(topic: MockTopic): void {
      topics = topics.some((item) => item.id === topic.id)
        ? topics.map((item) => (item.id === topic.id ? topic : item))
        : [...topics, topic];
    },
    nextTopicId(): string {
      const id = `t-mock-${topicSequence}`;
      topicSequence += 1;
      return id;
    },
  };
}
