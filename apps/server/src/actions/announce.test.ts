// T-1919: a cancelled or expired approval names the request from the
// approval's own summary, so two approvals expiring together no longer post
// the same fixed sentence.
import { describe, expect, it } from 'vitest';
import { CANCELLED_NOTICE, FAILED_NOTICE, summaryForOutcome } from './announce';

describe('summaryForOutcome', () => {
  it('names the approval in a cancelled notice', () => {
    expect(summaryForOutcome('cancelled', 'Allow "btc-price" to use the web')).toBe(
      'Not carried out: Allow "btc-price" to use the web',
    );
  });

  it('falls back to the fixed cancelled notice without a summary', () => {
    expect(summaryForOutcome('cancelled', null)).toBe(CANCELLED_NOTICE);
    expect(summaryForOutcome('cancelled', '   ')).toBe(CANCELLED_NOTICE);
  });

  it('never forwards adapter text on a failure', () => {
    expect(summaryForOutcome('failed', 'adapter text')).toBe(FAILED_NOTICE);
  });
});
