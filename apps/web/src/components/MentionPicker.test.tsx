import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { MentionMember } from '@zilar/chat-core';
import { MentionPicker } from './MentionPicker';

const members: MentionMember[] = [
  { jid: 'ai-dev-1@zilar.test', name: 'Dev-1' },
  { jid: 'u-ana@zilar.test', name: 'Ana' },
];

function renderPicker(): void {
  render(
    <MentionPicker
      id="picker"
      members={members}
      activeIndex={0}
      onSelect={() => {}}
      onHover={() => {}}
    />,
  );
}

describe('MentionPicker', () => {
  it('shows the AI badge on the AI row only', () => {
    renderPicker();

    const aiRow = screen.getByRole('option', { name: /Dev-1/ });
    expect(within(aiRow).getByText('AI')).toBeTruthy();

    const humanRow = screen.getByRole('option', { name: /Ana/ });
    expect(within(humanRow).queryByText('AI')).toBeNull();
  });
});
