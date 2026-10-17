/**
 * Hidden phone topic-header catalog (T-1780): reachable only by the
 * `zilar://dev/topic-header` URL, linked from nowhere. It renders the four
 * `label`/state rows of the `PhoneHeader.dc.html` board — nobody writing, one
 * writer, two writers and three or more — with the board's sample data, so the
 * lead can screenshot them next to the board. It stays unlinked in release
 * builds; the route only loads it behind `__DEV__`.
 */
import { ChevronLeft, MoreVertical, Search } from 'lucide-react-native';
import { type ComponentProps, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { Avatar } from '@/components/chat/avatar';
import { TopicPeopleLine, type TopicLinePerson } from '@/components/chat/topic-people-line';
import { TopicsSection } from '@/components/group-info/topics-section';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';

const noop = (): void => undefined;

const TOPIC = 'Financial';
const GROUP = 'ai test';

// The board's stack: four people, then the topic's AI.
const PEOPLE: readonly TopicLinePerson[] = [
  { id: 'p1', name: 'JULITO' },
  { id: 'p2', name: 'Marta' },
  { id: 'p3', name: 'Luis' },
  { id: 'p4', name: 'Ana' },
];

const AIS: readonly TopicLinePerson[] = [{ id: 'ai-deepseek', name: 'Deepseek' }];

// T-1787: the group screen's topic lists, the board's sample data
// (`PhoneGroup.dc.html:64-107`): General, two joined topics and two others.
type DevTopic = ComponentProps<typeof TopicsSection>['topics'][number];

const GROUP_MEMBERS = [
  { userId: 'p1', name: 'JULITO' },
  { userId: 'p2', name: 'Marta' },
  { userId: 'p3', name: 'Luis' },
  { userId: 'p4', name: 'Ana' },
  { userId: 'p5', name: 'Pablo' },
  { userId: 'p6', name: 'Sofia' },
];

const GROUP_AIS = [
  { aiId: 'ai-deepseek', name: 'Deepseek' },
  { aiId: 'ai-claude', name: 'Claude' },
];

const GROUP_TOPICS: readonly DevTopic[] = [
  {
    id: 'general',
    title: 'General',
    muted: false,
    topic: { isGeneral: true, visibility: 'public', archived: false },
  },
  {
    id: 'financial',
    title: 'Financial',
    muted: false,
    topic: {
      isGeneral: false,
      visibility: 'public',
      archived: false,
      memberIds: ['p1', 'p2', 'p3', 'p4'],
      ais: [{ id: 'ai-deepseek', name: 'Deepseek' }],
    },
  },
  {
    id: 'design',
    title: 'Design',
    muted: true,
    topic: {
      isGeneral: false,
      visibility: 'private',
      archived: false,
      memberIds: ['p1', 'p2'],
      ais: [{ id: 'ai-claude', name: 'Claude' }],
    },
  },
  {
    id: 'marketing',
    title: 'Marketing',
    muted: false,
    memberCount: 6,
    topic: {
      isGeneral: false,
      visibility: 'public',
      archived: false,
      memberIds: ['p2', 'p3', 'p4', 'p5', 'p6'],
      ais: [{ id: 'ai-claude', name: 'Claude' }],
    },
  },
  {
    id: 'random',
    title: 'Random',
    muted: false,
    memberCount: 3,
    topic: {
      isGeneral: false,
      visibility: 'public',
      archived: false,
      memberIds: ['p2', 'p3'],
    },
  },
];

type State = { label: string; writers: readonly string[] };

const STATES: readonly State[] = [
  { label: 'NOBODY WRITING', writers: [] },
  { label: 'ONE WRITING', writers: ['Deepseek'] },
  { label: 'TWO OR MORE WRITING', writers: ['JULITO', 'Deepseek'] },
  { label: 'THREE OR MORE', writers: ['JULITO', 'Deepseek', 'Claude'] },
];

/** The header chrome the state line sits in, drawn like `chat-header.tsx`. */
function HeaderPreview({ children }: { children: ReactNode }) {
  return (
    <View className="min-h-16 flex-row items-center gap-1 border-b border-divider bg-surface px-1">
      <IconButton label="Back" onPress={noop}>
        <ChevronLeft size={24} color={ICON} />
      </IconButton>
      <Avatar seed={TOPIC} name={TOPIC} size={36} />
      <View className="ml-2.5 min-w-0 flex-1 justify-center gap-[3px]">
        <Text
          numberOfLines={1}
          className="shrink text-[17px] font-semibold leading-[22px] text-foreground"
        >
          {TOPIC}
        </Text>
        {children}
      </View>
      <IconButton label="Search" onPress={noop}>
        <Search size={20} color={ICON} />
      </IconButton>
      <IconButton label="More options" onPress={noop}>
        <MoreVertical size={20} color={ICON} />
      </IconButton>
    </View>
  );
}

export default function TopicHeaderDevScreen() {
  return (
    <RequireAuth>
      <SafeAreaView className="flex-1 bg-[#0a0a0a]">
        <ScrollView
          className="flex-1 px-3 pt-6"
          contentContainerStyle={{ paddingBottom: 48 }}
          testID="topic-header-dev-screen"
        >
          <Text variant="h3" color="#ededed">
            Topic header
          </Text>
          <Text className="mt-1 text-[13px] text-[#8a8a8a]">
            The four phone header states, one per board example.
          </Text>
          <View className="mt-6 gap-6">
            {STATES.map((state) => (
              <View key={state.label} className="gap-2">
                <Text className="font-mono text-[11px] tracking-[0.06em] text-[#8a8a8a]">
                  {state.label}
                </Text>
                <HeaderPreview>
                  <TopicPeopleLine
                    people={PEOPLE}
                    ais={AIS}
                    count={PEOPLE.length + AIS.length}
                    writers={state.writers}
                    groupName={GROUP}
                    onOpenGroup={noop}
                  />
                </HeaderPreview>
              </View>
            ))}
          </View>

          <Text variant="h3" color="#ededed" className="mt-10">
            Group topics
          </Text>
          <Text className="mt-1 text-[13px] text-[#8a8a8a]">
            Your topics and Other topics, one per board example.
          </Text>
          <View className="mt-5 gap-3 px-1">
            <TopicsSection
              topics={GROUP_TOPICS}
              currentUserId="p1"
              members={GROUP_MEMBERS}
              ais={GROUP_AIS}
              onOpenTopic={noop}
              onNewTopic={noop}
              onJoinTopic={() => Promise.resolve()}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </RequireAuth>
  );
}
