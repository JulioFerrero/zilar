import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';
import { resetMockApi, setMockDelay } from '@/mock/api';

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  setMockDelay(0);
  resetMockApi();
  window.localStorage.clear();
});

describe('New topic dialog (T-0111)', () => {
  it('opens from the New chat menu and creates a public topic', async () => {
    const { store } = renderApp('/');
    const createTopic = vi.fn(async () => 't-fresh');
    store.setState({ createTopic });
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New topic' }));
    fireEvent.change(screen.getByLabelText('Topic name'), { target: { value: 'Fresh task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create topic' }));
    await waitFor(() => {
      expect(createTopic).toHaveBeenCalledWith(
        'c-devteam',
        expect.objectContaining({ name: 'Fresh task', kind: 'task', visibility: 'public' }),
      );
    });
  });

  it('creates a private topic with a locked creator and an AI tick', async () => {
    const { store } = renderApp('/');
    const createTopic = vi.fn(async () => 't-secret');
    const addTopicAi = vi.fn(async () => {});
    store.setState({ createTopic, addTopicAi });
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New topic' }));
    fireEvent.change(screen.getByLabelText('Topic name'), { target: { value: 'Secret work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Private' }));
    // The creator is ticked and locked.
    const creator = screen.getByLabelText('You (you, always included)') as HTMLInputElement;
    expect(creator.checked).toBe(true);
    expect(creator.disabled).toBe(true);
    // Unticked AI with the note.
    expect(await screen.findByText('AIs only read topics you add them to.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Dev-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Create topic' }));
    await waitFor(() => {
      expect(createTopic).toHaveBeenCalledWith(
        'c-devteam',
        expect.objectContaining({ name: 'Secret work', visibility: 'private' }),
      );
    });
    await waitFor(() => {
      expect(addTopicAi).toHaveBeenCalledWith('t-secret', 'dev-1');
    });
  });

  it('closes with Escape', () => {
    renderApp('/');
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New topic' }));
    expect(screen.getByRole('dialog', { name: 'New topic' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'New topic' })).toBeNull();
  });

  it('requires a name', () => {
    renderApp('/');
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New topic' }));
    expect(screen.getByRole('button', { name: 'Create topic' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('picks roles and an approver for a private topic (T-0116)', async () => {
    const { store } = renderApp('/');
    const createTopic = vi.fn(async () => 't-secret');
    const addTopicAi = vi.fn(async () => {});
    const setTopicRoles = vi.fn(async () => {});
    store.setState({ createTopic, addTopicAi, setTopicRoles });
    // The dialog reads the group's roles through the api client (fetch);
    // route fetch to the mock API like the topic panel tests do.
    const { mockRequest } = await import('@/mock/api');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) =>
        mockRequest(String(url), init ?? {}, { delayMs: 0 }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New topic' }));
    fireEvent.change(screen.getByLabelText('Topic name'), { target: { value: 'Secret work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Private' }));

    fireEvent.click(await screen.findByLabelText('Designers (2)'));
    const approvers = (await screen.findByLabelText('Approvers')) as HTMLSelectElement;
    fireEvent.change(approvers, { target: { value: 'role-designers' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create topic' }));

    await waitFor(() => {
      expect(setTopicRoles).toHaveBeenCalledWith('t-secret', {
        roleIds: ['role-designers'],
        approverRoleId: 'role-designers',
      });
    });
  });
});
