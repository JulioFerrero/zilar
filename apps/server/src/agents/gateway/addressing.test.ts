// T-1631: the pure addressing core for group messages — V1–V3 name addresses,
// the one-AI-room question rule S and the follow-up-question rule R. Nothing is
// wired yet; these tests pin the decision rules from docs/plan/smart-wake.md §2(a).
import { describe, expect, it } from 'vitest';
import { decideWake, isQuestion, type WakeReason } from './addressing';

const NO_RULES = { oneAiQuestion: false, followUpQuestion: false };

function wake(
  body: string,
  overrides: Partial<Parameters<typeof decideWake>[0]> = {},
): WakeReason | null {
  return decideWake({
    body,
    names: ['Deepseek'],
    liveAisInRoom: 2,
    lastOwnReplyAtMs: null,
    otherAiRepliedSince: false,
    nowMs: 1_000_000,
    rules: NO_RULES,
    ...overrides,
  });
}

describe('isQuestion', () => {
  it('is true when the first line ends with a question mark', () => {
    expect(isQuestion('BTC price?')).toBe(true);
    expect(isQuestion('what is BTC at?')).toBe(true);
  });

  it('is true when the first line opens with a question word', () => {
    expect(isQuestion('what is BTC at')).toBe(true);
    expect(isQuestion('How do I do this')).toBe(true);
    expect(isQuestion('  where is it')).toBe(true);
  });

  it('is false for a statement', () => {
    expect(isQuestion('whatever.')).toBe(false);
    expect(isQuestion('BTC price')).toBe(false);
  });

  it('only looks at the first non-empty line', () => {
    expect(isQuestion('BTC price\n?')).toBe(false);
    expect(isQuestion('\n\nwhat is BTC at?')).toBe(true);
  });
});

describe('decideWake address (V1-V3)', () => {
  it('matches a leading name followed by whitespace (V1)', () => {
    expect(wake('Deepseek run the tests')).toBe('address');
    expect(wake('  deepseek, go')).toBe('address');
    expect(wake('@Deepseek run')).toBe('address');
  });

  it('ignores names shorter than four characters (the floor)', () => {
    expect(wake('Bob run', { names: ['Bob'] })).toBeNull();
    expect(wake('ok Bob, go', { names: ['Bob'] })).toBeNull();
  });

  it('matches a mid-sentence vocative (V3)', () => {
    expect(wake('ok Deepseek, do it')).toBe('address');
    expect(wake('sure Deepseek: go')).toBe('address');
  });

  it('does not match a longer name or an email', () => {
    expect(wake('I like Deepseeker, a lot')).toBeNull();
    expect(wake('mail a@deepseek.com')).toBeNull();
  });

  it('wins over the question rules', () => {
    expect(
      wake('Deepseek, what is BTC at?', {
        liveAisInRoom: 1,
        rules: { oneAiQuestion: true, followUpQuestion: true },
      }),
    ).toBe('address');
  });
});

describe('decideWake one-AI question (S)', () => {
  it('wakes the only AI in the room on a question', () => {
    expect(
      wake('what is BTC at?', {
        liveAisInRoom: 1,
        rules: { oneAiQuestion: true, followUpQuestion: false },
      }),
    ).toBe('one_ai_question');
  });

  it('stays quiet when the rule is off or the room has more than one AI', () => {
    expect(
      wake('what is BTC at?', {
        liveAisInRoom: 1,
        rules: { oneAiQuestion: false, followUpQuestion: false },
      }),
    ).toBeNull();
    expect(
      wake('what is BTC at?', {
        liveAisInRoom: 2,
        rules: { oneAiQuestion: true, followUpQuestion: false },
      }),
    ).toBeNull();
  });

  it('stays quiet when the message is not a question', () => {
    expect(
      wake('BTC is up', {
        liveAisInRoom: 1,
        rules: { oneAiQuestion: true, followUpQuestion: false },
      }),
    ).toBeNull();
  });
});

describe('decideWake follow-up question (R)', () => {
  const rules = { oneAiQuestion: false, followUpQuestion: true };

  it('wakes on a question right after this AI replied', () => {
    expect(
      wake('and why is that?', {
        lastOwnReplyAtMs: 940_000,
        otherAiRepliedSince: false,
        nowMs: 1_000_000,
        rules,
      }),
    ).toBe('follow_up_question');
  });

  it('includes the 120 s edge and excludes a millisecond past it', () => {
    expect(wake('why?', { lastOwnReplyAtMs: 880_000, nowMs: 1_000_000, rules })).toBe(
      'follow_up_question',
    );
    expect(wake('why?', { lastOwnReplyAtMs: 879_999, nowMs: 1_000_000, rules })).toBeNull();
  });

  it('stays quiet when another AI replied, on no reply, or when the rule is off', () => {
    expect(
      wake('why?', {
        lastOwnReplyAtMs: 990_000,
        otherAiRepliedSince: true,
        nowMs: 1_000_000,
        rules,
      }),
    ).toBeNull();
    expect(wake('why?', { lastOwnReplyAtMs: null, nowMs: 1_000_000, rules })).toBeNull();
    expect(
      wake('why?', {
        lastOwnReplyAtMs: 990_000,
        nowMs: 1_000_000,
        rules: { oneAiQuestion: false, followUpQuestion: false },
      }),
    ).toBeNull();
  });
});
