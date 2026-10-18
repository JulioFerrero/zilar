// T-1617: a mention typed in full, or a message that opens with the AI's name,
// wakes the AI even though the sender never picked an entry from the mention
// list. These tests cover the body matcher the group ingest runs on the server.
import { describe, expect, it } from 'vitest';
import { bodyAddressesAi } from './addressing';

describe('bodyAddressesAi', () => {
  it('matches an @name with a boundary on each side', () => {
    expect(bodyAddressesAi('@Deepseek run', ['Deepseek'])).toBe(true);
    expect(bodyAddressesAi('@deepseek', ['Deepseek'])).toBe(true);
    expect(bodyAddressesAi('hi @Deepseek.', ['Deepseek'])).toBe(true);
  });

  it('does not match an email or a longer name', () => {
    expect(bodyAddressesAi('mail a@deepseek.com', ['Deepseek'])).toBe(false);
    expect(bodyAddressesAi('@Deepseeker', ['Deepseek'])).toBe(false);
  });

  it('matches a leading name followed by a comma or colon', () => {
    expect(bodyAddressesAi('Deepseek, run the tests', ['Deepseek'])).toBe(true);
    expect(bodyAddressesAi('Deepseek is slow', ['Deepseek'])).toBe(false);
  });

  it('handles names that contain spaces', () => {
    expect(bodyAddressesAi('@Dev 1 go', ['Dev 1'])).toBe(true);
  });
});
