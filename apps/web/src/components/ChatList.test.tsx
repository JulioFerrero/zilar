import { describe, expect, it, vi } from 'vitest';
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

  it('shows the connecting bar while the XMPP connection is not online', () => {
    renderApp('/', { status: 'connecting' });
    expect(screen.getByText('Connecting…')).toBeTruthy();
  });

  it('shows the waiting-for-network bar when offline', () => {
    renderApp('/', { status: 'offline' });
    expect(screen.getByText('Waiting for network…')).toBeTruthy();
  });

  it('shows skeletons and no empty state while chats load', () => {
    renderApp('/', { chats: [], chatsState: 'loading' });

    expect(screen.queryByText('No chats here yet')).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading chats' })).toBeTruthy();
  });

  it('shows the empty state only once ready and empty', () => {
    renderApp('/', { chats: [], chatsState: 'ready' });

    expect(screen.getByText('No chats here yet')).toBeTruthy();
  });

  it('shows an error with Retry when chats fail to load', () => {
    const { store } = renderApp('/', { chats: [], chatsState: 'error' });

    expect(screen.getByText("Couldn't load chats")).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Retry' });
    const onRetry = vi.fn();
    store.setState({ retryChats: onRetry });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps loaded chats with an inline error bar when a refresh fails', async () => {
    const { store } = renderApp('/');
    store.setState({ chatsState: 'error' });

    expect(screen.getByText('Ana')).toBeTruthy();
    expect(await screen.findByText("Couldn't load chats")).toBeTruthy();
    expect(screen.queryByText('No chats here yet')).toBeNull();
    expect(screen.queryByRole('status', { name: 'Loading chats' })).toBeNull();
    const onRetry = vi.fn();
    store.setState({ retryChats: onRetry });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
