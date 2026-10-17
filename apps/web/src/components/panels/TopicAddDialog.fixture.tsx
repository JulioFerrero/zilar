import { Effect } from 'effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { TopicAddDialog, type AddAi, type AddPerson } from './TopicAddDialog';

const people: AddPerson[] = [
  { id: 'u-julito', name: 'JULITO', inGroup: true },
  { id: 'u-marta', name: 'Marta', inGroup: true },
  { id: 'u-ana', name: 'Ana', handle: 'ana', inGroup: false },
  { id: 'u-mikel', name: 'Mikel', handle: 'mikel', inGroup: false },
  { id: 'u-julio', name: 'test_julio', handle: 'julio', inGroup: false },
];

const ais: AddAi[] = [
  { id: 'ai-deepseek', name: 'Deepseek', inGroup: true },
  { id: 'ai-helper', name: 'Helper', inGroup: false },
];

/** A settled promise, as the ops' one-call add resolves. */
const addMember = (_userId: string): Effect.Effect<void, ApiFailure> => Effect.void;
const addAi = (_aiId: string): Effect.Effect<void, ApiFailure> => Effect.void;
const createInvite = (): Effect.Effect<string, ApiFailure> =>
  Effect.succeed('https://zilar.app/invite/financial-2f4a9c');

export default {
  People: (
    <TopicAddDialog
      topicName="Financial"
      groupTitle="ai test"
      isManager
      people={people}
      ais={ais}
      addMember={addMember}
      addAi={addAi}
      createInvite={createInvite}
      onClose={() => undefined}
    />
  ),
  Ais: (
    <TopicAddDialog
      topicName="Financial"
      groupTitle="ai test"
      isManager
      initialTab="ais"
      people={people}
      ais={ais}
      addMember={addMember}
      addAi={addAi}
      createInvite={createInvite}
      onClose={() => undefined}
    />
  ),
};
