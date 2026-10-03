import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { MentionMember } from '@zilar/chat-core';
import { MentionPicker } from './MentionPicker';

const members: MentionMember[] = [
  { jid: 'ai-dev-1@zilar.test', name: 'Dev-1' },
  { jid: 'u-ana@zilar.test', name: 'Ana', handle: 'ana' },
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

  it('shows the handle next to the name and in the accessible name', () => {
    renderPicker();

    const humanRow = screen.getByRole('option', { name: 'Ana @ana' });
    expect(within(humanRow).getByText('@ana')).toBeTruthy();
    expect(within(humanRow).getByText('Ana')).toBeTruthy();
  });

  it('tells two same-named members apart by handle', () => {
    render(
      <MentionPicker
        id="picker"
        members={[
          { jid: 'u-alex-1@zilar.test', name: 'Alex', handle: 'alex' },
          { jid: 'u-alex-2@zilar.test', name: 'Alex', handle: 'alex_r' },
        ]}
        activeIndex={0}
        onSelect={() => {}}
        onHover={() => {}}
      />,
    );

    expect(screen.getByRole('option', { name: 'Alex @alex' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Alex @alex_r' })).toBeTruthy();
  });
});
