// The owner's AIs (T-0940). They are keyed by the same bare JIDs as
// `data/people.ts` (the unified seed direction of docs/audit/mock-plan.md §2.5),
// so an AI DM and its panel entry point at the same person.
import type { AiLimits, AiTemplate, PublicAi } from '@zilar/api-contract';
import type { MockSeed } from '../../data';

const CREATED_AT = '2026-09-28T09:00:00.000Z';

/**
 * The owner's AIs. Dev-1 sits on the approved machine; the others start on the
 * platform. `usage: null` means "unavailable", like the contract's optional
 * summary. T-1408: Dev-1 has no limits (null bounds) but real spend, so the
 * usage block renders without a meter; Marketing AI keeps a limit so the meter
 * still shows.
 */
export const mockAis: readonly PublicAi[] = [
  {
    id: 'ai-dev-1',
    name: 'Dev-1',
    template: 'dev',
    persona: 'Dev-1 is a concise senior engineer for the mock workspace.',
    model: 'gpt-4o',
    jid: 'ai-dev-1@zilar.test',
    status: 'active',
    providerConnectionId: 'conn-openai',
    limits: { perDayUsd: null, perMonthUsd: null },
    usage: { todayUsd: 0.42, windowUsd: 3.1 },
    machineId: 'mach-approved',
    computerMode: 'off',
    createdAt: CREATED_AT,
  },
  {
    id: 'ai-qa-1',
    name: 'QA-1',
    template: 'dev',
    persona: 'QA-1 reviews changes and runs the regression suite.',
    model: 'gpt-4o',
    jid: 'ai-qa-1@zilar.test',
    status: 'active',
    providerConnectionId: 'conn-openai',
    limits: { perDayUsd: 2, perMonthUsd: 20 },
    usage: null,
    machineId: null,
    computerMode: 'cloud',
    createdAt: CREATED_AT,
  },
  {
    id: 'ai-marketing',
    name: 'Marketing AI',
    template: 'marketing',
    persona: 'Marketing AI is a clear, friendly copywriter.',
    model: 'claude-sonnet-5',
    jid: 'ai-marketing@zilar.test',
    status: 'active',
    providerConnectionId: 'conn-anthropic',
    limits: { perDayUsd: 5, perMonthUsd: 50 },
    usage: { todayUsd: 1.7, windowUsd: 6 },
    machineId: null,
    computerMode: 'off',
    createdAt: CREATED_AT,
  },
];

/** The AI templates the create/patch routes accept, like the contract. */
export const AI_TEMPLATES: readonly AiTemplate[] = ['dev', 'marketing', 'fun', 'custom'];

export function isAiTemplate(value: unknown): value is AiTemplate {
  return typeof value === 'string' && (AI_TEMPLATES as readonly string[]).includes(value);
}

/** Reads an `AiLimits` body value; a missing or non-numeric bound is no limit. */
export function readAiLimits(value: unknown): AiLimits {
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return {
      perDayUsd: typeof record.perDayUsd === 'number' ? record.perDayUsd : null,
      perMonthUsd: typeof record.perMonthUsd === 'number' ? record.perMonthUsd : null,
    };
  }
  return { perDayUsd: null, perMonthUsd: null };
}

export function seedAis(): Partial<MockSeed> {
  return { ais: mockAis };
}
