import { describe, expect, it } from 'vitest';
import { buildHandoffLine } from './handoff';

const FROM = 'ai-dev@zilar.localhost';

describe('buildHandoffLine (T-1572)', () => {
  it('marks one found target and takes the task text after the mention', () => {
    expect(
      buildHandoffLine({
        fromJid: FROM,
        text: 'Dev-1: @QA-1 please check it on an iPhone',
        targets: [{ nick: 'QA-1', jid: 'AI-QA@Zilar.localhost' }],
      }),
    ).toEqual({
      from: FROM,
      to: ['ai-qa@zilar.localhost'],
      task: 'please check it on an iPhone',
    });
  });

  it('returns null when no target mention is found', () => {
    expect(
      buildHandoffLine({
        fromJid: FROM,
        text: 'All done, no handoff here',
        targets: [{ nick: 'QA-1', jid: 'ai-qa@zilar.localhost' }],
      }),
    ).toBeNull();
  });

  it('collects up to two targets and takes the text after the last mention', () => {
    expect(
      buildHandoffLine({
        fromJid: FROM,
        text: 'both @QA-1 and @OPS-1 : deploy the fix',
        targets: [
          { nick: 'QA-1', jid: 'ai-qa@zilar.localhost' },
          { nick: 'OPS-1', jid: 'ai-ops@zilar.localhost' },
        ],
      }),
    ).toEqual({
      from: FROM,
      to: ['ai-qa@zilar.localhost', 'ai-ops@zilar.localhost'],
      task: 'deploy the fix',
    });
  });

  it('collapses the task to one line and cuts it to 200 characters', () => {
    const line = buildHandoffLine({
      fromJid: FROM,
      text: '@QA-1\n\n  check   it\ton an iPhone',
      targets: [{ nick: 'QA-1', jid: 'ai-qa@zilar.localhost' }],
    });
    expect(line?.task).toBe('check it on an iPhone');

    const long = buildHandoffLine({
      fromJid: FROM,
      text: `@QA-1 ${'x'.repeat(300)}`,
      targets: [{ nick: 'QA-1', jid: 'ai-qa@zilar.localhost' }],
    });
    expect(long?.task).toHaveLength(200);
  });
});
