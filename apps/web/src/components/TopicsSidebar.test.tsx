import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';
import { resetMockApi, setMockDelay } from '@/mock/api';

beforeEach(() => {
  setMockDelay(0);
  resetMockApi();
  window.localStorage.clear();
});

describe('Topics sidebar (T-0111)', () => {
  it('renders the group header with nested topics, General first', () => {
    renderApp('/');
    const nav = screen.getByRole('navigation', { name: 'Chats' });
    expect(within(nav).getByText('Dev team')).toBeTruthy();
    expect(within(nav).getByText('7 topics')).toBeTruthy();
    const links = within(nav)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(links).toContain('/c/c-devteam');
    expect(links).toContain('/c/c-devteam-bug');
    // General sorts first.
    const generalIndex = links.indexOf('/c/c-devteam');
    const bugIndex = links.indexOf('/c/c-devteam-bug');
    expect(generalIndex).toBeLessThan(bugIndex);
  });

  it('shows the lock on the private topic and aggregates unread on the header', () => {
    renderApp('/');
    const nav = screen.getByRole('navigation', { name: 'Chats' });
    expect(within(nav).getByLabelText('Private topic')).toBeTruthy();
    expect(within(nav).getByLabelText('3 unread in Dev team')).toBeTruthy();
    expect(within(nav).getByLabelText('3 unread')).toBeTruthy();
  });

  it('collapses the group and remembers it', () => {
    renderApp('/');
    const toggle = screen.getByRole('button', { name: /Collapse Dev team/ });
    fireEvent.click(toggle);
    expect(screen.queryByText('Checkout button hidden on Safari')).toBeNull();
    expect(screen.getByText('Dev team')).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem('galena:collapsedGroups') ?? '[]')).toEqual([
      'g-devteam',
    ]);
  });

  it('navigates the topic list with Up/Down and Enter', () => {
    renderApp('/');
    const nav = screen.getByRole('navigation', { name: 'Chats' });
    const general = within(nav).getByRole('link', { name: /General/ });
    general.focus();
    fireEvent.keyDown(general.closest('div') ?? nav, { key: 'ArrowDown' });
    const focused = document.activeElement;
    expect(focused instanceof HTMLAnchorElement).toBe(true);
    expect((focused as HTMLAnchorElement).getAttribute('href')).toContain('/c/c-devteam-');
  });

  it('search filters topics by name and keeps the group header', () => {
    renderApp('/');
    fireEvent.change(screen.getByLabelText('Search chats'), { target: { value: 'pricing' } });
    expect(screen.getByText('Dev team')).toBeTruthy();
    expect(screen.getByText('New pricing page')).toBeTruthy();
    expect(screen.queryByText('Ideas')).toBeNull();
  });

  it('filters by folder treating topics like their group', () => {
    renderApp('/');
    fireEvent.click(screen.getByRole('tab', { name: /Personal/ }));
    expect(screen.queryByText('Dev team')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Work/ }));
    expect(screen.getByText('Dev team')).toBeTruthy();
  });
});
