import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';
import { mockRequest, resetMockApi, setMockDelay } from '@/mock/api';

beforeEach(() => {
  setMockDelay(0);
  resetMockApi();
  window.localStorage.clear();
  // The panel reads members/AIs/tools/rules through the api client (fetch);
  // the mock store does not serve them, so route fetch to the mock API.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) =>
      mockRequest(String(url), init ?? {}, { delayMs: 0 }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Topic panel (T-0111)', () => {
  it('opens from the kebab Topic info with visibility, members and AIs', async () => {
    renderApp('/c/c-devteam-hiring');
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Topic info' }));
    const dialog = screen.getByRole('dialog', { name: 'Hiring: frontend role topic info' });
    expect(within(dialog).getByText('Private topic')).toBeTruthy();
    expect(await within(dialog).findByText('You')).toBeTruthy();
    expect(within(dialog).getByText('Ana')).toBeTruthy();
  });

  it('shows "All N members" for a public topic', async () => {
    renderApp('/c/c-devteam-ui');
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Topic info' }));
    const dialog = screen.getByRole('dialog', { name: 'New pricing page topic info' });
    expect(within(dialog).getAllByText(/All 4 members/).length).toBeGreaterThan(0);
    expect(await within(dialog).findByText('No AIs in this topic yet.')).toBeTruthy();
  });

  it('shows the bug topic AI with its owner', async () => {
    renderApp('/c/c-devteam-bug');
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Topic info' }));
    const dialog = screen.getByRole('dialog', { name: /topic info/ });
    expect(await within(dialog).findByText('Dev-1')).toBeTruthy();
    expect(within(dialog).getByText('Added by you')).toBeTruthy();
  });

  it('confirms private -> public with the history warning', async () => {
    renderApp('/c/c-devteam-hiring');
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Topic info' }));
    const dialog = screen.getByRole('dialog', { name: /topic info/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make public' }));
    expect(screen.getByRole('dialog', { name: 'Make this topic public?' })).toBeTruthy();
    expect(screen.getByText(/will be able to read the whole history/)).toBeTruthy();
    const confirmButtons = screen.getAllByRole('button', { name: 'Make public' });
    const confirm = confirmButtons[confirmButtons.length - 1];
    if (confirm === undefined) {
      throw new Error('expected a Make public confirm button');
    }
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Make this topic public?' })).toBeNull();
    });
  });

  it('closes with Escape', () => {
    renderApp('/c/c-devteam-ui');
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Topic info' }));
    expect(screen.getByRole('dialog', { name: /topic info/ })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /topic info/ })).toBeNull();
  });
});

describe('Group panel topic switch (T-0111)', () => {
  it('shows the members-can-create-topics switch to the owner', () => {
    // A legacy group without topics (older server shape) still opens the
    // group panel with the switch.
    renderApp('/c/c-qa?panel=group');
    expect(screen.getByRole('switch', { name: 'Members can create topics' })).toBeTruthy();
  });
});
