// The owner's AIs (T-0940). They are keyed by the same bare JIDs as
// `data/people.ts` (the unified seed direction of docs/audit/mock-plan.md §2.5),
// so an AI DM and its panel entry point at the same person.
import type { AiLimits, AiTemplate, PublicAi } from '@zilar/api-contract';
import type { MockSeed } from '../../data';

const CREATED_AT = '2026-09-28T09:00:00.000Z';

/** The default limits the old mocks used when a request carried none. */
export const defaultAiLimits: AiLimits = { perDayUsd: 2, perMonthUsd: 20 };

/**
 * The owner's AIs. Dev-1 sits on the approved machine; the others start on the
 * platform. `usage: null` means "unavailable", like the contract's optional
 * summary (one AI keeps a real summary so the spend bar renders).
 */
export const mockAis: readonly PublicAi[] = [
  {
    id: 'ai-dev-1',
    name: 'Dev-1',
    template: 'dev',
    persona: 'Dev-1 is a concise senior engineer for the mock workspace.',
    model: 'gpt-4o',
    jid: 'dev-1@ai.zilar.test',
    status: 'active',
    providerConnectionId: 'conn-openai',
    limits: { perDayUsd: 2, perMonthUsd: 20 },
    usage: null,
    machineId: 'mach-approved',
    createdAt: CREATED_AT,
  },
  {
    id: 'ai-qa-1',
    name: 'QA-1',
    template: 'dev',
    persona: 'QA-1 reviews changes and runs the regression suite.',
    model: 'gpt-4o',
    jid: 'qa-1@ai.zilar.test',
    status: 'active',
    providerConnectionId: 'conn-openai',
    limits: { perDayUsd: 2, perMonthUsd: 20 },
    usage: null,
    machineId: null,
    createdAt: CREATED_AT,
  },
  {
    id: 'ai-marketing',
    name: 'Marketing AI',
    template: 'marketing',
    persona: 'Marketing AI is a clear, friendly copywriter.',
    model: 'claude-sonnet-5',
    jid: 'marketing@ai.zilar.test',
    status: 'active',
    providerConnectionId: 'conn-anthropic',
    limits: { perDayUsd: 5, perMonthUsd: 50 },
    usage: { todayUsd: 1.7, windowUsd: 6 },
    machineId: null,
    createdAt: CREATED_AT,
  },
];

/** The AI templates the create/patch routes accept, like the contract. */
export const AI_TEMPLATES: readonly AiTemplate[] = ['dev', 'marketing', 'fun', 'custom'];

export function isAiTemplate(value: unknown): value is AiTemplate {
  return typeof value === 'string' && (AI_TEMPLATES as readonly string[]).includes(value);
}

/** Reads an `AiLimits` body value, falling back to the seed's defaults. */
export function readAiLimits(value: unknown): AiLimits {
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.perDayUsd === 'number' && typeof record.perMonthUsd === 'number') {
      return { perDayUsd: record.perDayUsd, perMonthUsd: record.perMonthUsd };
    }
  }
  return { ...defaultAiLimits };
}

export function seedAis(): Partial<MockSeed> {
  return { ais: mockAis };
}
