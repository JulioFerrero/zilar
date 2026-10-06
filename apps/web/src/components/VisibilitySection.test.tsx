import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VisibilitySection } from './VisibilitySection';
import { checkGroupHandle } from '@/lib/api';
import { AuthProvider } from '@/auth/AuthProvider';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import { createChatStore } from '@/store/store';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    ApiError: class ApiError extends Error {
      readonly status: number;
      readonly code: string;
      readonly detail: Record<string, unknown>;
      constructor(status: number, code: string, message: string, detail = {}) {
        super(message);
        this.status = status;
        this.code = code;
        this.detail = detail;
      }
    },
    checkGroupHandle: vi.fn(),
    setGroupVisibility: vi.fn(async () => ({
      id: 'g-1',
      title: 'Hiking club',
      createdBy: 'u-you',
      visibility: 'public',
      handle: 'hiking_club',
      members: [],
      ais: [],
    })),
  };
});

const checkMock = vi.mocked(checkGroupHandle);

function renderSection(visibility: 'private' | 'public' = 'private', handle: string | null = null) {
  const store = createChatStore({
    groupInfos: {
      'c-hiking': {
        id: 'g-1',
        title: 'Hiking club',
        createdBy: 'u-you',
        visibility,
        handle,
        members: [{ userId: 'u-you', name: 'You', role: 'owner' }],
        ais: [],
      },
    },
  });
  return render(
    <AuthProvider
      value={{
        status: 'authenticated',
        user: { id: 'u-you', name: 'You', email: 'you@zilar.test', handle: 'you' },
        refetch: async () => {},
      }}
    >
      <ChatStoreProvider store={store}>
        <VisibilitySection
          chatId="c-hiking"
          groupId="g-1"
          visibility={visibility}
          handle={handle}
          title="Hiking club"
        />
      </ChatStoreProvider>
    </AuthProvider>,
  );
}

describe('VisibilitySection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to Private and saves public with a live-checked handle', async () => {
    checkMock.mockResolvedValue({ available: true });
    renderSection();

    expect(screen.getByRole('radio', { name: 'Private' })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('radio', { name: 'Public' }));
    expect(screen.getByText('Anyone can find and join “Hiking club”.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Handle'), { target: { value: 'hiking_club' } });
    expect(screen.getByLabelText('Handle').className).toContain('well-surface');
    expect(await screen.findByText('@hiking_club is available')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save visibility' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('asks for confirmation when going private from public', async () => {
    renderSection('public', 'hiking_club');

    fireEvent.click(screen.getByRole('radio', { name: 'Private' }));
    expect(screen.getByText(/Going private removes the group from Explore at once/)).toBeTruthy();
    // First click arms the confirmation, second saves.
    fireEvent.click(screen.getByRole('button', { name: 'Save visibility' }));
    expect(await screen.findByRole('button', { name: 'Confirm going private' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm going private' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('shows the taken reason from the live check', async () => {
    checkMock.mockResolvedValue({ available: false, reason: 'taken' });
    renderSection();

    fireEvent.click(screen.getByRole('radio', { name: 'Public' }));
    fireEvent.change(screen.getByLabelText('Handle'), { target: { value: 'taken_name' } });
    expect(await screen.findByText('That handle is taken. Try another.')).toBeTruthy();
  });

  it('shows the copy share link button while public', async () => {
    renderSection('public', 'hiking_club');
    expect(screen.getByRole('button', { name: 'Copy share link' })).toBeTruthy();
  });

  it('disables Save while unchanged', async () => {
    renderSection('public', 'hiking_club');
    const saveButton = screen.getByRole('button', { name: 'Save visibility' });
    expect(saveButton.getAttribute('data-slot')).toBe('button');
    expect(saveButton).toHaveProperty('disabled', true);
  });

  it('waits for the debounce and shows the error alert', async () => {
    const { setGroupVisibility } = await import('@/lib/api');
    vi.mocked(setGroupVisibility).mockRejectedValueOnce(
      new (class extends Error {
        code = 'handle_taken';
      })('taken'),
    );
    renderSection();

    fireEvent.click(screen.getByRole('radio', { name: 'Public' }));
    fireEvent.change(screen.getByLabelText('Handle'), { target: { value: 'hiking_club' } });
    await waitFor(() => expect(checkMock).toHaveBeenCalledWith('hiking_club'));
  });
});
