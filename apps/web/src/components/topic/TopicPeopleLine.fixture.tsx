import type { ChatSummary } from '@zilar/chat-core';
import type { ReactNode } from 'react';
import { AuthProvider, type AuthState } from '@/auth/AuthProvider';
import type { GroupDetail } from '@/lib/api';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createRealChatStore } from '@/store/realStore';
import { TopicPeopleLine } from './TopicPeopleLine';

const TOPIC_ID = 'c-financial';

const PICTURE =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22%3E%3Crect width=%2240%22 height=%2240%22 fill=%22%23333333%22/%3E%3Ccircle cx=%2220%22 cy=%2215%22 r=%227%22 fill=%22%23ededed%22/%3E%3Cpath d=%22M6 40c0-9 6-14 14-14s14 5 14 14z%22 fill=%22%23ededed%22/%3E%3C/svg%3E';

/** The board's topic: `F`, public, with five people and AIs. */
const CHAT: ChatSummary = {
  id: TOPIC_ID,
  title: 'Financial',
  kind: 'group',
  isAI: false,
  space: 'work',
  unread: 0,
  muted: false,
  groupId: 'g-ai-test',
  groupTitle: 'ai test',
  topic: {
    id: 't-financial',
    glyph: 'F',
    kind: 'chat',
    status: 'open',
    visibility: 'public',
    isGeneral: false,
    archived: false,
    doneAt: null,
    owner: null,
    linkUrl: null,
    linkLabel: null,
    activity: [],
    memberIds: ['u-julito', 'u-ana', 'u-luis'],
    ais: [
      { id: 'ai-deepseek', name: 'Deepseek' },
      { id: 'ai-claude', name: 'Claude' },
    ],
  },
};

const GROUP: GroupDetail = {
  id: 'g-ai-test',
  title: 'ai test',
  createdBy: 'u-julito',
  members: [
    { userId: 'u-julito', name: 'JULITO', role: 'owner', avatarUrl: PICTURE },
    { userId: 'u-ana', name: 'Ana', role: 'member' },
    { userId: 'u-luis', name: 'Luis', role: 'member' },
  ],
  ais: [
    { aiId: 'ai-deepseek', jid: 'deepseek@zilar.test', name: 'Deepseek', ownerId: 'u-julito' },
    { aiId: 'ai-claude', jid: 'claude@zilar.test', name: 'Claude', ownerId: 'u-julito' },
  ],
};

const store = createRealChatStore();
store.setState({ groupInfos: { [TOPIC_ID]: GROUP } });

const AUTH: AuthState = {
  status: 'authenticated',
  user: { id: 'u-julito', name: 'JULITO', email: 'julito@zilar.test' },
  refetch: () => Promise.resolve(),
};

function Frame({ children }: { children: ReactNode }) {
  return (
    <AuthProvider value={AUTH}>
      <ChatStoreProvider store={store}>
        <div className="w-[360px] rounded-2xl border border-divider bg-panel px-4 py-3">
          {children}
        </div>
      </ChatStoreProvider>
    </AuthProvider>
  );
}

/** The four board states (WebTopic.dc.html:54-65, PhoneHeader.dc.html:46-99). */
export default {
  IdleFive: (
    <Frame>
      <TopicPeopleLine chat={CHAT} groupTitle="ai test" names={[]} />
    </Frame>
  ),
  OneWriter: (
    <Frame>
      <TopicPeopleLine chat={CHAT} groupTitle="ai test" names={['Deepseek']} />
    </Frame>
  ),
  TwoWriters: (
    <Frame>
      <TopicPeopleLine chat={CHAT} groupTitle="ai test" names={['JULITO', 'Deepseek']} />
    </Frame>
  ),
  ThreeWriters: (
    <Frame>
      <TopicPeopleLine chat={CHAT} groupTitle="ai test" names={['JULITO', 'Deepseek', 'Ana']} />
    </Frame>
  ),
};
