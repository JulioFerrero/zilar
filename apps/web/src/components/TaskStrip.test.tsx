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

  it('rejects a non-https link in the form with an inline error', () => {
    renderApp('/c/c-devteam-ideas');
    const strip = screen.getByLabelText('Topic details');
    fireEvent.click(within(strip).getByRole('button', { name: 'Add topic link' }));
    fireEvent.change(screen.getByPlaceholderText('https://…'), {
      target: { value: 'javascript:alert(1)' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Link must be an https URL.')).toBeTruthy();
  });
});
