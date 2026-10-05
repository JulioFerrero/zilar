import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { UiReaction } from '@zilar/chat-core';
import { ReactionChips } from './ReactionChips';
import { renderApp } from '@/test/renderApp';

const chips: UiReaction[] = [
  { emoji: '👍', count: 3, mine: true, reactors: ['You', 'Ana', 'Luis'] },
  { emoji: '❤️', count: 1, mine: false, reactors: ['Marta'] },
];

describe('ReactionChips', () => {
  it('renders every chip with its count and a reactor tooltip', () => {
    render(<ReactionChips reactions={chips} own={false} onToggle={() => {}} />);

    const thumbs = screen.getByRole('button', { name: '👍 3, including you' });
    expect(thumbs.textContent).toContain('👍');
    expect(thumbs.textContent).toContain('3');
    expect(thumbs.getAttribute('title')).toBe('You, Ana, Luis');

    const heart = screen.getByRole('button', { name: '❤️ 1' });
    expect(heart.getAttribute('title')).toBe('Marta');
  });

  it('marks my reactions as pressed and the others not', () => {
    render(<ReactionChips reactions={chips} own onToggle={() => {}} />);

    expect(
      screen.getByRole('button', { name: '👍 3, including you' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByRole('button', { name: '❤️ 1' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('toggles the clicked emoji', () => {
    const onToggle = vi.fn();
    render(<ReactionChips reactions={chips} own={false} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('button', { name: '❤️ 1' }));

    expect(onToggle).toHaveBeenCalledWith('❤️');
  });

  it('renders nothing without reactions', () => {
    const { container } = render(<ReactionChips reactions={[]} own={false} onToggle={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('reactions in a chat (mock store)', () => {
  it('reacts from the quick bar and shows the chip', () => {
    renderApp('/c/c-viernes');

    const list = screen.getByTestId('message-list');
    fireEvent.contextMenu(within(list).getByText('Friday plans?'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'React with 👍' }));

    expect(screen.queryByRole('menu', { name: 'Message actions' })).toBeNull();
    const row = within(list).getByText('Friday plans?').closest('[data-message-id]');
    expect(row).not.toBeNull();
    const chip = within(row as HTMLElement).getByRole('button', {
      name: '👍 1, including you',
    });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });

  it('toggles an existing chip on and off', () => {
    renderApp('/c/c-viernes');

    const list = screen.getByTestId('message-list');
    const row = within(list).getByText('MVP 🏆').closest('[data-message-id]');
    expect(row).not.toBeNull();
    const scope = within(row as HTMLElement);

    fireEvent.click(scope.getByRole('button', { name: '🏆 3' }));
    const added = scope.getByRole('button', { name: '🏆 4, including you' });
    expect(added.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(added);
    const removed = scope.getByRole('button', { name: '🏆 3' });
    expect(removed.getAttribute('aria-pressed')).toBe('false');
  });

  it('removes my own reaction when its chip is clicked', () => {
    renderApp('/c/c-viernes');

    const list = screen.getByTestId('message-list');
    const row = within(list).getByText('On my way').closest('[data-message-id]');
    expect(row).not.toBeNull();
    const scope = within(row as HTMLElement);

    const mine = scope.getByRole('button', { name: '🚀 2, including you' });
    expect(mine.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(mine);
    expect(scope.getByRole('button', { name: '🚀 1' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('does not jump the chat-list preview when reacting to an older message', () => {
    renderApp('/c/c-viernes');

    const list = screen.getByTestId('message-list');
    const row = within(list).getByText('MVP 🏆').closest('[data-message-id]');
    expect(row).not.toBeNull();

    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: '🏆 3' }));

    // The list still previews the newest message, not the reacted one.
    const item = screen.getByRole('link', { name: /Viernes/ });
    expect(item.textContent).toContain('On my way');
    expect(item.textContent).not.toContain('MVP');
  });
});
