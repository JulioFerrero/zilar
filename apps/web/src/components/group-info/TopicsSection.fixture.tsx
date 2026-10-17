import type { ChatSummary, TopicInfo } from '@zilar/chat-core';
import type { GroupDetail } from '@/lib/api';
import { Button } from '../ui/button';
import { TopicsList } from './TopicsSection';

// Cosmos fixture (T-1786): the group screen's Your/Other topics on the boards'
// `#0a0a0a` page, next to `docs/design/mockups/topic-people/WebGroup.dc.html:66-109`.
// Static rows so the lists need no store.

/** The group detail the rows draw names and pictures from. */
const INFO: GroupDetail = {
  id: 'g-devteam',
  title: 'Dev team',
  createdBy: 'u-you',
  members: [
    { userId: 'u-you', name: 'You', role: 'owner' },
    { userId: 'u-julio', name: 'Julio', role: 'member' },
    { userId: 'u-marta', name: 'Marta', role: 'member' },
    { userId: 'u-luis', name: 'Luis', role: 'member' },
    { userId: 'u-ana', name: 'Ana', role: 'member' },
  ],
  ais: [],
};

function topicRow(input: {
  id: string;
  title: string;
  glyph: string;
  visibility: TopicInfo['visibility'];
  isGeneral?: boolean;
  muted?: boolean;
  memberIds: string[];
  ais?: TopicInfo['ais'];
}): ChatSummary {
  const topic: TopicInfo = {
    id: input.id,
    glyph: input.glyph,
    visibility: input.visibility,
    isGeneral: input.isGeneral ?? false,
    archived: false,
    doneAt: null,
    linkUrl: null,
    linkLabel: null,
    activity: [],
    memberIds: input.memberIds,
    ...(input.ais === undefined ? {} : { ais: input.ais }),
  };
  return {
    id: input.id,
    title: input.title,
    kind: 'group',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: input.muted ?? false,
    groupId: 'g-devteam',
    groupTitle: 'Dev team',
    topic,
  };
}

const YOUR_TOPICS: ChatSummary[] = [
  topicRow({
    id: 'c-general',
    title: 'General',
    glyph: 'G',
    visibility: 'public',
    isGeneral: true,
    memberIds: ['u-you', 'u-julio', 'u-marta', 'u-luis', 'u-ana'],
  }),
  topicRow({
    id: 'c-financial',
    title: 'Financial',
    glyph: 'F',
    visibility: 'public',
    memberIds: ['u-you', 'u-julio', 'u-marta', 'u-luis'],
    ais: [{ id: 'ai-deepseek', name: 'Deepseek' }],
  }),
  topicRow({
    id: 'c-design',
    title: 'Design',
    glyph: 'D',
    visibility: 'private',
    muted: true,
    memberIds: ['u-julio', 'u-marta'],
    ais: [{ id: 'ai-claude', name: 'Claude' }],
  }),
];

const OTHER_TOPICS: ChatSummary[] = [
  topicRow({
    id: 'c-marketing',
    title: 'Marketing',
    glyph: 'M',
    visibility: 'public',
    memberIds: ['u-ana', 'u-julio', 'u-luis', 'u-marta', 'u-you'],
    ais: [{ id: 'ai-claude', name: 'Claude' }],
  }),
  topicRow({
    id: 'c-random',
    title: 'Random',
    glyph: 'R',
    visibility: 'public',
    memberIds: ['u-ana', 'u-luis', 'u-marta'],
  }),
];

export default {
  Default: (
    <div className="w-[380px] rounded-2xl border border-border bg-[#0a0a0a] p-3">
      <TopicsList
        yourTopics={YOUR_TOPICS}
        otherTopics={OTHER_TOPICS}
        info={INFO}
        onOpen={() => {}}
        onNewTopic={() => {}}
        renderJoin={() => (
          <Button type="button" size="sm" className="rounded-lg px-3 text-[13px] font-medium">
            Join
          </Button>
        )}
      />
    </div>
  ),
  'Your topics only': (
    <div className="w-[380px] rounded-2xl border border-border bg-[#0a0a0a] p-3">
      <TopicsList
        yourTopics={YOUR_TOPICS}
        otherTopics={[]}
        info={INFO}
        onOpen={() => {}}
        onNewTopic={() => {}}
      />
    </div>
  ),
};
