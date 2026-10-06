import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';
import { resetMockApi, setMockDelay } from '@/mock/api';

beforeEach(() => {
  setMockDelay(0);
  resetMockApi();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('Topic header and task strip (T-0111)', () => {
  it('shows the breadcrumb, the Private chip and the strip on a topic', () => {
    renderApp('/c/c-devteam-bug');
    expect(screen.getAllByText('Checkout button hidden on Safari').length).toBeGreaterThan(0);
    expect(screen.queryByText('Private')).toBeNull();
    const strip = screen.getByLabelText('Topic details');
    expect(within(strip).getByText('BUG')).toBeTruthy();
    expect(within(strip).getByLabelText('Status: In progress. Change status')).toBeTruthy();
    expect(within(strip).getByText('Owner: Dev-1')).toBeTruthy();
    expect(within(strip).getByText('PR #42')).toBeTruthy();
  });

  it('shows the Private chip and GENERAL type on the hiring topic', () => {
    renderApp('/c/c-devteam-hiring');
    expect(screen.getByText('Private')).toBeTruthy();
    expect(screen.getByLabelText('Topic details')).toBeTruthy();
  });

  it('shows GENERAL for General and the kebab menu with Topic info', () => {
    renderApp('/c/c-devteam');
    const strip = screen.getByLabelText('Topic details');
    expect(within(strip).getByText('GENERAL')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    expect(screen.getByRole('menuitem', { name: 'Topic info' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Archive topic' })).toBeNull();
  });

  it('edits the status optimistically and rolls back on failure', async () => {
    renderApp('/c/c-devteam-ui');
    const strip = screen.getByLabelText('Topic details');
    fireEvent.click(within(strip).getByLabelText('Status: Open. Change status'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Done' }));
    expect(within(strip).getByLabelText('Status: Done. Change status')).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText('Could not save. Try again.')).toBeNull();
    });
  });

  it('renders only https links as links', () => {
    renderApp('/c/c-devteam-ui');
    const link = screen.getByRole('link', { name: /example\.com/ });
    expect(link.getAttribute('href')).toMatch(/^https:/);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('compares the AI owner by id, not by display name', async () => {
    // Two AIs share the name "Helper": only the owning one reads checked,
    // and choosing one sends the server AI id (`helper-2`), never the
    // mention JID (`ai-helper-2@…`, which the server would 400).
    // The seed wires the UI topic owner to the second Helper directly, so
    // the row needs no store update after mount.
    const { store } = renderApp('/c/c-devteam-ui', {
      chats: [
        {
          id: 'c-devteam-ui',
          title: 'New pricing page',
          kind: 'group',
          isAI: false,
          space: 'work',
          unread: 0,
          muted: false,
          groupId: 'g-devteam',
          groupTitle: 'Dev team',
          topic: {
            id: 't-devteam-ui',
            glyph: 'U',
            kind: 'ui',
            status: 'open',
            visibility: 'public',
            isGeneral: false,
            archived: false,
            owner: { kind: 'ai', id: 'helper-2', name: 'Helper' },
            linkUrl: null,
            linkLabel: null,
          },
        },
      ],
      messagesByChat: {},
      groupInfos: {
        'c-devteam-ui': {
          id: 'g-devteam',
          title: 'Dev team',
          createdBy: 'u-you',
          members: [{ userId: 'u-you', name: 'You', role: 'owner' }],
          ais: [
            { aiId: 'dev-1', jid: 'ai-dev-1@zilar.test', name: 'Dev-1', ownerId: 'u-you' },
            { aiId: 'helper-1', jid: 'ai-helper-1@zilar.test', name: 'Helper', ownerId: 'u-you' },
            { aiId: 'helper-2', jid: 'ai-helper-2@zilar.test', name: 'Helper', ownerId: 'u-you' },
          ],
        },
      },
    });
    const strip = screen.getByLabelText('Topic details');
    fireEvent.click(within(strip).getByLabelText('Owner: Helper. Change owner'));
    const picker = screen.getByRole('menu', { name: 'Change owner' });
    const options = within(picker).getAllByRole('menuitemradio', { name: 'Helper (AI)' });
    expect(options).toHaveLength(2);
    expect(options[0]?.getAttribute('aria-checked')).toBe('false');
    expect(options[1]?.getAttribute('aria-checked')).toBe('true');
    // Choosing the first (non-owning) Helper PATCHes its server id. The
    // mock PATCH echoes the saved row, so the store + UI follow to it —
    // which also proves the request carried `helper-1`, not a JID.
    const patchTopic = vi.spyOn(store.getState(), 'patchTopic');
    fireEvent.click(options[0]!);
    await waitFor(() => {
      expect(patchTopic).toHaveBeenCalledWith(
        'c-devteam-ui',
        expect.objectContaining({ owner: { kind: 'ai', id: 'helper-1' } }),
      );
    });
    expect(
      within(screen.getByLabelText('Topic details')).getByLabelText('Owner: Helper. Change owner'),
    ).toBeTruthy();
  });

  it('rejects a non-https link in the form with an inline error', () => {
    renderApp('/c/c-devteam-ideas');
    const strip = screen.getByLabelText('Topic details');
    fireEvent.click(within(strip).getByRole('button', { name: 'Add topic link' }));
    expect(screen.getByPlaceholderText('https://…').className).toContain('well-surface');
    fireEvent.change(screen.getByPlaceholderText('https://…'), {
      target: { value: 'javascript:alert(1)' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Link must be an https URL.')).toBeTruthy();
  });
});
