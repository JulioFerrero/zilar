import { describe, expect, it } from 'vitest';
import { isPushAllowed } from './branches';

describe('isPushAllowed', () => {
  it("allows a branch in this AI's space", () => {
    expect(isPushAllowed('alice', 'agent/alice/feature')).toEqual({ allowed: true });
    expect(isPushAllowed('alice', 'agent/alice/feature/deep')).toEqual({ allowed: true });
  });

  it('rejects reserved and non-agent branches', () => {
    for (const branch of ['main', 'master', 'develop', 'release/1.0', 'release/x', 'hotfix/y']) {
      expect(isPushAllowed('alice', branch)).toEqual({
        allowed: false,
        reason: 'not-agent-branch',
      });
    }
  });

  it("rejects another AI's branch", () => {
    expect(isPushAllowed('alice', 'agent/bob/feature')).toEqual({
      allowed: false,
      reason: 'wrong-agent',
    });
  });

  it('rejects malformed agent branches', () => {
    for (const branch of ['agent', 'agent/', 'agent/alice', 'agent/alice/']) {
      expect(isPushAllowed('alice', branch).allowed).toBe(false);
    }
  });

  it('rejects a full ref', () => {
    expect(isPushAllowed('alice', 'refs/heads/agent/alice/feature')).toEqual({
      allowed: false,
      reason: 'full-ref',
    });
  });

  it('rejects path-traversal style values before they are used', () => {
    for (const branch of [
      'agent/../../etc/passwd',
      'agent/alice/../../b',
      '/agent/alice/feature',
      'agent//alice/feature',
      'agent/alice/../x',
      'agent/alice/.',
      '',
    ]) {
      expect(isPushAllowed('alice', branch)).toEqual({
        allowed: false,
        reason: 'path-traversal',
      });
    }
  });

  it('compares branch and AI names case-sensitively', () => {
    expect(isPushAllowed('alice', 'Agent/alice/feature').allowed).toBe(false);
    expect(isPushAllowed('alice', 'agent/Alice/feature').allowed).toBe(false);
  });
});
