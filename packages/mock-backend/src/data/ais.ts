// The AIs, provider connections, machines and AI-memory seed (T-0940). The AI
// rows are keyed by the same bare JIDs as `data/people.ts` (the unified seed
// direction of docs/audit/mock-plan.md §2.5), so an AI DM and its panel entry
// point at the same person. Connections and machines mirror web's mock seeds
// (`apps/web/src/mock/api.ts` `seedState`), so the statuses a demo shows match.

import type {
  AiLimits,
  AiMemoryFact,
  AiTemplate,
  ConnectionView,
  Machine,
  PublicAi,
} from '@zilar/api-contract';

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

/** One pending, one approved online, one revoked (the plan's §11.5 sketch). */
export const mockMachines: readonly Machine[] = [
  {
    id: 'mach-pending',
    name: 'office-linux',
    status: 'pending',
    os: 'linux',
    osVersion: '6.6.0',
    arch: 'x86_64',
    cpu: 'AMD Ryzen 9 7950X',
    cores: 16,
    ramGb: 64,
    diskFreeGb: 920,
    drivers: ['docker', 'linux-vm'],
    fingerprint: 'a1b2c3d4e5f60718',
    createdAt: '2026-09-29T08:00:00.000Z',
    approvedAt: null,
    lastSeenAt: null,
  },
  {
    id: 'mach-approved',
    name: 'dev-mac',
    status: 'approved',
    os: 'macos',
    osVersion: '27.0',
    arch: 'arm64',
    cpu: 'Apple M3 Pro',
    cores: 11,
    ramGb: 18,
    diskFreeGb: 200,
    drivers: ['docker', 'apple-container', 'macos-vm'],
    fingerprint: 'b2c3d4e5f607182a',
    createdAt: '2026-09-25T10:00:00.000Z',
    approvedAt: '2026-09-25T10:01:00.000Z',
    lastSeenAt: '2026-09-29T07:55:00.000Z',
    online: true,
  },
  {
    id: 'mach-revoked',
    name: 'old-macbook',
    status: 'revoked',
    os: 'macos',
    osVersion: '26.4',
    arch: 'arm64',
    cpu: 'Apple M2',
    cores: 8,
    ramGb: 16,
    diskFreeGb: 320,
    drivers: ['docker', 'macos-vm'],
    fingerprint: 'c3d4e5f607182a3b',
    createdAt: '2026-08-10T10:00:00.000Z',
    approvedAt: '2026-08-10T10:01:00.000Z',
    lastSeenAt: '2026-09-20T11:00:00.000Z',
  },
];

/** One chat's AI memory; `canChange` is added by the route. */
export interface MockAiMemory {
  readonly facts: readonly AiMemoryFact[];
  readonly lines: readonly string[];
}

/** The memory a chat+AI key starts with (two facts, three cover lines). */
export function seedAiMemory(): MockAiMemory {
  return {
    facts: [
      { id: 'fact-1', text: 'Julio prefers short answers.' },
      { id: 'fact-2', text: 'The launch is on Friday.' },
    ],
    lines: [
      '#0-15 Summary: the team agreed on the launch plan and pricing.',
      '#16 2026-10-01 Julio: Let us keep the pricing simple.',
      '#17 2026-10-01 Dev-1: Agreed, two tiers only.',
    ],
  };
}

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
