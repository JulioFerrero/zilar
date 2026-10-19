import { CircleCheck, Search } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { AiBadge } from '@/components/chat/ai-badge';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { aiOwnerLabel, InfoGroup } from '@/components/chat/topic-info-sheet';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { SearchField } from '@/components/ui/search-field';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Text } from '@/components/ui/text';
import type { Contact, GroupDetail } from '@/lib/chat-api';
import { SEEN } from '@/lib/colors';
import { runInBackground } from '@/lib/effect/run-in-background';
import type { ChatSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

export type AddTab = 'people' | 'ais';

type RowState = 'busy' | 'added' | 'failed';

function SectionLabel({ label }: { label: string }) {
  return (
    <Text className="px-1 font-mono text-[11px] tracking-[0.06em] text-muted-foreground">
      {label}
    </Text>
  );
}

// One addable row: avatar, name, optional AI badge and sub-label; the right end shows Add, "Adding…", "Here" or a retryable "Couldn't add".
function AddRow({
  id,
  name,
  avatarUrl,
  ai = false,
  sublabel,
  state,
  inTopic,
  onAdd,
}: {
  id: string;
  name: string;
  avatarUrl?: string;
  ai?: boolean;
  sublabel?: { text: string; mono?: boolean };
  state: RowState | undefined;
  inTopic: boolean;
  onAdd: () => void;
}) {
  const here = inTopic || state === 'added';
  return (
    <View className="min-h-[56px] flex-row items-center gap-3 px-3">
      <EntityAvatar
        person={{ id, name, ...(avatarUrl === undefined ? {} : { avatarUrl }) }}
        size={34}
        ai={ai}
      />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text numberOfLines={1} className="shrink text-[16px] text-foreground">
            {name}
          </Text>
          {ai ? <AiBadge /> : null}
        </View>
        {sublabel === undefined ? null : (
          <Text
            numberOfLines={1}
            className={cn(
              'text-muted-foreground',
              sublabel.mono === true ? 'font-mono text-[11px]' : 'text-[13px]',
            )}
          >
            {sublabel.text}
          </Text>
        )}
      </View>
      {here ? (
        <View className="flex-row items-center gap-1.5" accessibilityLabel="Here">
          <CircleCheck size={16} color={SEEN} />
          <Text className="text-[14px] text-muted-foreground">Here</Text>
        </View>
      ) : (
        <View className="flex-row items-center gap-2">
          {state === 'failed' ? (
            <Text className="text-[12px] text-muted-foreground">Couldn't add</Text>
          ) : null}
          <Button
            variant="key"
            size="sm"
            accessibilityLabel={`Add ${name}`}
            disabled={state === 'busy'}
            onPress={onAdd}
          >
            <Text>{state === 'busy' ? 'Adding…' : 'Add'}</Text>
          </Button>
        </View>
      )}
    </View>
  );
}

export type TopicAddContentProps = {
  topicName: string;
  groupTitle: string;
  detail: GroupDetail | undefined;
  myUserId: string;
  // A group owner or admin: only they see people and AIs from outside the group.
  isManager: boolean;
  contacts: readonly Contact[];
  ownedAis: readonly { id: string; name: string }[];
  memberIds: readonly string[] | undefined;
  topicAiIds: readonly string[];
  isGeneral: boolean;
  addMember: (userId: string) => Promise<void>;
  addAi: (aiId: string) => Promise<void>;
  /** The tab shown first; the dev catalog uses it to capture both. */
  initialTab?: AddTab;
};

// The body of the "Add people or AIs" sheet: a People/AIs segment, a search well, the group's people or AIs with Add or "Here", and for a manager the caller's contacts and other AIs. Split from the sheet shell so the dev catalog can render both tabs inline.
export function TopicAddContent({
  topicName,
  groupTitle,
  detail,
  myUserId,
  isManager,
  contacts,
  ownedAis,
  memberIds,
  topicAiIds,
  isGeneral,
  addMember,
  addAi,
  initialTab = 'people',
}: TopicAddContentProps) {
  const [tab, setTab] = useState<AddTab>(initialTab);
  const [search, setSearch] = useState('');
  const [states, setStates] = useState<Record<string, RowState>>({});

  const query = search.trim().toLowerCase();
  const matches = (name: string, handle?: string | null): boolean =>
    query === '' ||
    name.toLowerCase().includes(query) ||
    (handle ?? '').toLowerCase().includes(query);
  const personState = (id: string): RowState | undefined => states[`p:${id}`];
  const aiState = (id: string): RowState | undefined => states[`a:${id}`];
  const personInTopic = (id: string): boolean => {
    if (personState(id) === 'added') {
      return true;
    }
    return memberIds === undefined ? isGeneral : memberIds.includes(id);
  };
  const aiInTopic = (id: string): boolean => aiState(id) === 'added' || topicAiIds.includes(id);
  const runAdd = (key: string, call: () => Promise<void>): void => {
    setStates((previous) => ({ ...previous, [key]: 'busy' }));
    runInBackground(call, {
      onSuccess: () => setStates((previous) => ({ ...previous, [key]: 'added' })),
      onFailure: () => setStates((previous) => ({ ...previous, [key]: 'failed' })),
    });
  };
  const addPerson = (id: string): void => runAdd(`p:${id}`, () => addMember(id));
  const addTopicAi = (id: string): void => runAdd(`a:${id}`, () => addAi(id));
  const members = detail?.members ?? [];
  const memberIdsInGroup = new Set(members.map((member) => member.userId));
  const group = detail?.ais ?? [];
  const groupAiIds = new Set(group.map((ai) => ai.aiId));
  const peopleInGroup = members
    .filter((member) => member.userId !== myUserId && matches(member.name, member.handle))
    .sort((left, right) => left.name.localeCompare(right.name));
  const contactsOutside =
    isManager && detail !== undefined
      ? contacts
          .filter(
            (contact) =>
              contact.userId !== myUserId &&
              !memberIdsInGroup.has(contact.userId) &&
              matches(contact.name, contact.handle),
          )
          .sort((left, right) => left.name.localeCompare(right.name))
      : [];
  const aisInGroup = group
    .filter((ai) => matches(ai.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  const aisOutside =
    isManager && detail !== undefined
      ? ownedAis
          .filter((ai) => !groupAiIds.has(ai.id) && matches(ai.name))
          .sort((left, right) => left.name.localeCompare(right.name))
      : [];
  const peopleCount = peopleInGroup.length + contactsOutside.length;
  const aisCount = aisInGroup.length + aisOutside.length;
  const emptyText =
    query === '' ? `Everyone here is already in ${topicName}.` : 'No one matches that search.';
  return (
    <View className="gap-3">
      <SegmentedControl
        options={[
          { value: 'people', label: 'People' },
          { value: 'ais', label: 'AIs' },
        ]}
        value={tab}
        onChange={(value) => setTab(value === 'ais' ? 'ais' : 'people')}
        accessibilityLabel="Add"
      />
      <SearchField
        icon={Search}
        value={search}
        onChangeText={setSearch}
        onClear={() => setSearch('')}
        accessibilityLabel={tab === 'people' ? 'Search people' : 'Search AIs'}
        placeholder={tab === 'people' ? 'Search people' : 'Search AIs'}
      />

      {tab === 'people' ? (
        peopleCount === 0 ? (
          <Text className="px-1 text-[13px] text-muted-foreground">{emptyText}</Text>
        ) : (
          <View className="gap-3">
            {peopleInGroup.length > 0 ? (
              <View className="gap-2">
                <SectionLabel label={`IN ${groupTitle.toUpperCase()}`} />
                <InfoGroup>
                  {peopleInGroup.map((person) => (
                    <AddRow
                      key={person.userId}
                      id={person.userId}
                      name={person.name}
                      {...(person.avatarUrl === undefined ? {} : { avatarUrl: person.avatarUrl })}
                      state={personState(person.userId)}
                      inTopic={personInTopic(person.userId)}
                      onAdd={() => addPerson(person.userId)}
                    />
                  ))}
                </InfoGroup>
              </View>
            ) : null}
            {contactsOutside.length > 0 ? (
              <View className="gap-2">
                <SectionLabel label="YOUR CONTACTS" />
                <InfoGroup>
                  {contactsOutside.map((contact) => (
                    <AddRow
                      key={contact.userId}
                      id={contact.userId}
                      name={contact.name}
                      {...(contact.avatarUrl === undefined ? {} : { avatarUrl: contact.avatarUrl })}
                      sublabel={{ text: `+ joins ${groupTitle}`, mono: true }}
                      state={personState(contact.userId)}
                      inTopic={personInTopic(contact.userId)}
                      onAdd={() => addPerson(contact.userId)}
                    />
                  ))}
                </InfoGroup>
              </View>
            ) : null}
          </View>
        )
      ) : aisCount === 0 ? (
        <Text className="px-1 text-[13px] text-muted-foreground">{emptyText}</Text>
      ) : (
        <View className="gap-3">
          {aisInGroup.length > 0 ? (
            <View className="gap-2">
              <SectionLabel label={`IN ${groupTitle.toUpperCase()}`} />
              <InfoGroup>
                {aisInGroup.map((ai) => {
                  const owner = aiOwnerLabel(ai.aiId, detail, myUserId, null);
                  return (
                    <AddRow
                      key={ai.aiId}
                      id={ai.aiId}
                      name={ai.name}
                      ai
                      {...(ai.avatarUrl === undefined ? {} : { avatarUrl: ai.avatarUrl })}
                      {...(owner === undefined ? {} : { sublabel: { text: owner } })}
                      state={aiState(ai.aiId)}
                      inTopic={aiInTopic(ai.aiId)}
                      onAdd={() => addTopicAi(ai.aiId)}
                    />
                  );
                })}
              </InfoGroup>
            </View>
          ) : null}
          {aisOutside.length > 0 ? (
            <View className="gap-2">
              <SectionLabel label="YOUR OTHER AIS" />
              <InfoGroup>
                {aisOutside.map((ai) => (
                  <AddRow
                    key={ai.id}
                    id={ai.id}
                    name={ai.name}
                    ai
                    sublabel={{ text: `+ joins ${groupTitle}`, mono: true }}
                    state={aiState(ai.id)}
                    inTopic={aiInTopic(ai.id)}
                    onAdd={() => addTopicAi(ai.id)}
                  />
                ))}
              </InfoGroup>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

type TopicAddSheetProps = {
  chat: ChatSummary | null;
  groupTitle: string;
  detail: GroupDetail | undefined;
  myUserId: string;
  isManager: boolean;
  contacts: readonly Contact[];
  ownedAis: readonly { id: string; name: string }[];
  addMember: (userId: string) => Promise<void>;
  addAi: (aiId: string) => Promise<void>;
  onClose: () => void;
};

// Opened from the topic-info sheet's primary key. The board's "New AI" row is left out: the phone has no new-AI route.
export function TopicAddSheet({
  chat,
  groupTitle,
  detail,
  myUserId,
  isManager,
  contacts,
  ownedAis,
  addMember,
  addAi,
  onClose,
}: TopicAddSheetProps) {
  const topic = chat?.topic;
  return (
    <BottomSheet
      visible={chat !== null && topic !== undefined}
      onClose={onClose}
      closeLabel="Close add people or AIs"
      title={chat === null ? undefined : `Add to ${chat.title}`}
      maxHeightClassName="max-h-[85%]"
    >
      {chat !== null && topic !== undefined ? (
        <TopicAddContent
          topicName={chat.title}
          groupTitle={groupTitle}
          detail={detail}
          myUserId={myUserId}
          isManager={isManager}
          contacts={contacts}
          ownedAis={ownedAis}
          memberIds={topic.memberIds}
          topicAiIds={(topic.ais ?? []).map((ai) => ai.id)}
          isGeneral={topic.isGeneral}
          addMember={addMember}
          addAi={addAi}
        />
      ) : null}
    </BottomSheet>
  );
}
