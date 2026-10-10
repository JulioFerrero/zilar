import type { ConnectionView } from '@zilar/api-contract';
import type { MockSeed } from '../../data';

/** The provider connections; a key is write-only, so the seed carries none. */
export const mockConnections: readonly ConnectionView[] = [
  {
    id: 'conn-openai',
    provider: 'openai',
    label: 'Work key',
    status: 'active',
    createdAt: '2026-09-20T10:00:00.000Z',
  },
  {
    id: 'conn-anthropic',
    provider: 'anthropic',
    label: 'Personal key',
    status: 'active',
    createdAt: '2026-09-21T10:00:00.000Z',
  },
];

export function seedConnections(): Partial<MockSeed> {
  return { connections: mockConnections };
}
