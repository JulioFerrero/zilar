export const currentUserId = 'u-you';

export interface MockPerson {
  id: string;
  name: string;
}

export const PEOPLE: Record<string, MockPerson> = {
  ana: { id: 'u-ana', name: 'Ana' },
  luis: { id: 'u-luis', name: 'Luis' },
  marta: { id: 'u-marta', name: 'Marta' },
  marco: { id: 'u-marco', name: 'Marco' },
  sofia: { id: 'u-sofia', name: 'Sofía' },
  dev1: { id: 'ai-dev-1', name: 'Dev-1' },
  qa1: { id: 'ai-qa-1', name: 'QA-1' },
  marketing: { id: 'ai-marketing', name: 'Marketing AI' },
};

export const ME: MockPerson = { id: currentUserId, name: 'You' };

export const AI_JIDS = {
  dev1: 'dev-1@ai.zilar.test',
  qa1: 'qa-1@ai.zilar.test',
  marketing: 'marketing@ai.zilar.test',
};

export const ROOMS = {
  devTeam: 'dev-team@rooms.zilar.test',
  viernes: 'viernes@rooms.zilar.test',
};
