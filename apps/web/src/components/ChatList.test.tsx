import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';

const ALL_TITLES = [
  'Ana',
  'Dev team',
  'Viernes 🍻',
  'Dev AI',
  'Marta',
  'Familia',
  'QA squad',
  'Luis',
  'Marketing AI',
  'Gym buddies',
  'Product',
];

describe('ChatList', () => {
  it('renders every mock chat with its title', () => {
    renderApp('/');
    for (const title of ALL_TITLES) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it('renders previews, unread badges, mute icons and AI badges', () => {
    renderApp('/');
    expect(screen.getByText('See you tonight ❤️')).toBeTruthy();
    expect(screen.getAllByText('Tests pass. Merge?').length).toBeGreaterThan(0);
    expect(screen.getAllByText('You:').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('2 unread')).toBeTruthy();
    expect(screen.getByLabelText('5 unread')).toBeTruthy();
    expect(screen.getAllByLabelText('Muted')).toHaveLength(2);
    expect(screen.getAllByText('AI')).toHaveLength(2);
  });

  it('filters chats by folder', () => {
    renderApp('/');

    fireEvent.click(screen.getByRole('tab', { name: /AIs/ }));
    expect(screen.getByText('Dev AI')).toBeTruthy();
    expect(screen.getByText('Marketing AI')).toBeTruthy();
    expect(screen.queryByText('Ana')).toBeNull();
    expect(screen.queryByText('Dev team')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Personal/ }));
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.queryByText('Dev team')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Work/ }));
    expect(screen.getByText('Dev team')).toBeTruthy();
    expect(screen.queryByText('Ana')).toBeNull();
  });

  it('filters chats by search query', () => {
    renderApp('/');
    const input = screen.getByLabelText('Search chats');

    fireEvent.change(input, { target: { value: 'ana' } });
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.queryByText('Dev team')).toBeNull();

    fireEvent.change(input, { target: { value: 'dev' } });
    expect(screen.getByText('Dev team')).toBeTruthy();
    expect(screen.getByText('Dev AI')).toBeTruthy();
    expect(screen.queryByText('Ana')).toBeNull();
  });

  it('focuses the search field with Ctrl/Cmd+K', () => {
    renderApp('/');
    const input = screen.getByLabelText('Search chats');
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(input);
  });
});
