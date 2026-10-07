import { describe, expect, it } from 'vitest';
import { looksLikeSecret } from './secrets';

describe('looksLikeSecret', () => {
  it('flags an sk- key and ignores a short sk- prefix', () => {
    expect(looksLikeSecret('here is sk-abcdefghijklmnop1234')).toBe(true);
    expect(looksLikeSecret('ask-a-friend')).toBe(false);
  });

  it('flags a GitHub gh[pousr]_ token and an unknown gh_ prefix', () => {
    expect(looksLikeSecret('ghp_0123456789abcdefghijklmnop')).toBe(true);
    expect(looksLikeSecret('github_pat_whatever')).toBe(true);
    expect(looksLikeSecret('ghx_abcdefghijklmnopqrstuvwx')).toBe(false);
  });

  it('flags an AWS access key id and ignores a malformed one', () => {
    expect(looksLikeSecret('AKIA0123456789ABCDEF')).toBe(true);
    expect(looksLikeSecret('AKIA0123456789abcde')).toBe(false);
  });

  it('flags a Slack token prefix and ignores another xox letter', () => {
    expect(looksLikeSecret('xoxb-123456789012-abcdef')).toBe(true);
    expect(looksLikeSecret('xoxz-abcdef')).toBe(false);
  });

  it('flags a JWT and ignores short segments', () => {
    expect(
      looksLikeSecret('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop'),
    ).toBe(true);
    expect(looksLikeSecret('eyJshort.a.b')).toBe(false);
  });

  it('flags a PEM header and ignores a header without the dashes', () => {
    expect(looksLikeSecret('-----BEGIN PRIVATE KEY-----')).toBe(true);
    expect(looksLikeSecret('----BEGIN PRIVATE KEY-----')).toBe(false);
  });

  it('flags a labelled password value and ignores an unlabelled sentence', () => {
    expect(looksLikeSecret('password: hunter22')).toBe(true);
    expect(looksLikeSecret('api key = CHANGE_ME')).toBe(true);
    expect(looksLikeSecret('the password is hidden')).toBe(false);
  });

  it('flags a long mixed run and ignores a long word or a long number', () => {
    expect(looksLikeSecret('id aB3defghijklmnopqrstuvwxyz012345')).toBe(true);
    expect(looksLikeSecret('abcdefghijklmnopqrstuvwxyzabcdef')).toBe(false);
    expect(looksLikeSecret('01234567890123456789012345678901')).toBe(false);
  });

  it('leaves a plain sentence, a URL and a date alone', () => {
    expect(looksLikeSecret('The launch is on Friday.')).toBe(false);
    expect(looksLikeSecret('https://example.com/docs/getting-started')).toBe(false);
    expect(looksLikeSecret('2026-10-06')).toBe(false);
  });
});
