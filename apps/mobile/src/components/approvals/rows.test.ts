import { describe, expect, it } from 'vitest';

import type { ApprovalRule } from '@/lib/approvals-api';

import { mergeRulesFanOut, type RulesFanOut } from './rows';

function rule(id: string): ApprovalRule {
  return {
    id,
    action: 'send_message',
    scope: 'personal',
    groupId: null,
    topicId: null,
    topicName: null,
    createdAt: '2026-10-11T00:00:00.000Z',
    createdBy: 'user-1',
  };
}

const failed = (): RulesFanOut => ({ status: 'rejected', reason: new Error('rules fetch failed') });

describe('mergeRulesFanOut (T-1087)', () => {
  it('returns null when every AI failed', () => {
    const settled: RulesFanOut[] = [failed(), failed()];

    expect(mergeRulesFanOut(settled)).toBeNull();
  });

  it('keeps the empty success when another AI failed', () => {
    const settled: RulesFanOut[] = [
      failed(),
      { status: 'fulfilled', value: { aiId: 'ai-1', rules: [] } },
    ];

    expect(mergeRulesFanOut(settled)).toEqual([]);
  });

  it('keeps the rules of a successful AI when another failed', () => {
    const settled: RulesFanOut[] = [
      failed(),
      { status: 'fulfilled', value: { aiId: 'ai-1', rules: [rule('rule-1')] } },
    ];

    expect(mergeRulesFanOut(settled)).toEqual([{ aiId: 'ai-1', rule: rule('rule-1') }]);
  });
});
