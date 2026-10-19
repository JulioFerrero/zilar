import type { ConnectionView } from '@zilar/api-contract';
import type { MockSeed } from '../../data';

/** The provider connections; a key is write-only, so the seed carries none. */
export const mockConnections: readonly ConnectionView[] = [
  {
    id: 'conn-openai',
    provider: 'openai',
    label: 'Work key',
    baseUrl: null,
    status: 'active',
    createdAt: '2026-09-20T10:00:00.000Z',
  },
  {
    id: 'conn-anthropic',
    provider: 'anthropic',
    label: 'Personal key',
    baseUrl: null,
    status: 'active',
    createdAt: '2026-09-21T10:00:00.000Z',
  },
  // T-1396: a user's own OpenAI-compatible endpoint.
  {
    id: 'conn-groq',
    provider: 'openai-compatible',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    status: 'active',
    createdAt: '2026-09-22T10:00:00.000Z',
  },
  {
    id: 'conn-deepseek',
    provider: 'deepseek',
    label: 'Personal key',
    baseUrl: null,
    status: 'active',
    createdAt: '2026-09-23T10:00:00.000Z',
  },
  {
    id: 'conn-brave',
    provider: 'brave',
    label: null,
    baseUrl: null,
    status: 'active',
    createdAt: '2026-10-19T09:00:00.000Z',
  },
  {
    id: 'conn-jina',
    provider: 'jina',
    label: null,
    baseUrl: null,
    status: 'active',
    createdAt: '2026-10-19T09:05:00.000Z',
  },
];

export function seedConnections(): Partial<MockSeed> {
  return { connections: mockConnections };
}
